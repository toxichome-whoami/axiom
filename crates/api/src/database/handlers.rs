/*
 * Database HTTP API route handlers, AST validation, and query execution pipeline.
 * Owned by: api/database
 * Key deps: axum, sqlparser, axiom_db::pool, axiom_db::engines, axiom_policy::PolicyEngine
 * Invariants: Uncached queries parse through dialect AST parser; PolicyEngine evaluates table-level RBAC on every operation.
 * Last structural change: Phase 2 integrating PolicyEngine authorization across queries, tables, and CRUD endpoints.
 */

use axum::http::StatusCode;
use serde_json::Value;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axiom_core::AxiomError;
use axiom_core::config::schema::DatabaseDefConfig;
use axiom_core::QueryResult;
use axiom_db::DatabasePoolManager;
use axiom_policy::PolicyEngine;
use axiom_core::AuthContext;

// Consecutive execution failure counter per database alias for circuit breaker (Debt #4 fix).
static CIRCUIT_FAILURES: once_cell::sync::Lazy<dashmap::DashMap<String, u32>> = once_cell::sync::Lazy::new(dashmap::DashMap::new);

// Fast heuristic regex to skip cache key allocation on obvious mutation statements.
static MUTATION_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"(?i)\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|GRANT|REVOKE|PRAGMA)\b").unwrap()
});

/// Precomputed AST analysis and formatted query statement for fast-path execution.
#[derive(Clone, Debug)]
pub struct CachedAstInfo {
    pub is_mutation: bool,
    pub operations: Vec<(&'static str, Vec<String>)>,
    pub formatted_sql: Option<String>,
    pub multiple_statements: Option<Vec<String>>,
}

/// Bounded AST metadata cache mapping "{dialect}:{sql}" -> CachedAstInfo.
/// Avoids repeated sqlparser allocations and AST tree traversals on frequent parameterized queries.
static AST_CACHE: once_cell::sync::Lazy<dashmap::DashMap<String, Arc<CachedAstInfo>>> =
    once_cell::sync::Lazy::new(dashmap::DashMap::new);

const MAX_AST_CACHE_ENTRIES: usize = 4096;

pub async fn warm_cache_from_turso(entries: Vec<(String, bytes::Bytes, i64)>) {
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    for (key, bytes, expires_at) in entries {
        let remaining = expires_at - now_unix;
        if remaining > 0 {
            axiom_cache::CacheEngine::set(&key, bytes, remaining as u64, axiom_cache::Durability::MemoryOnly).await;
        }
    }
}

pub struct QueryExecutionPipeline;

fn extract_table_name(raw: &str) -> String {
    let clean = raw.trim().trim_matches('"').trim_matches('`').trim_matches('\'');
    if let Some((_, right)) = clean.rsplit_once('.') {
        right.trim_matches('"').trim_matches('`').to_string()
    } else {
        clean.to_string()
    }
}

fn collect_tables_from_factor(factor: &sqlparser::ast::TableFactor, tables: &mut Vec<String>) {
    match factor {
        sqlparser::ast::TableFactor::Table { name, .. } => {
            tables.push(extract_table_name(&name.to_string()));
        }
        sqlparser::ast::TableFactor::Derived { subquery, .. } => {
            collect_tables_from_query(subquery, tables);
        }
        sqlparser::ast::TableFactor::NestedJoin { table_with_joins, .. } => {
            collect_tables_from_table_with_joins(table_with_joins, tables);
        }
        _ => {}
    }
}

fn collect_tables_from_table_with_joins(twj: &sqlparser::ast::TableWithJoins, tables: &mut Vec<String>) {
    collect_tables_from_factor(&twj.relation, tables);
    for join in &twj.joins {
        collect_tables_from_factor(&join.relation, tables);
    }
}

fn collect_tables_from_set_expr(expr: &sqlparser::ast::SetExpr, tables: &mut Vec<String>) {
    match expr {
        sqlparser::ast::SetExpr::Select(select) => {
            for twj in &select.from {
                collect_tables_from_table_with_joins(twj, tables);
            }
        }
        sqlparser::ast::SetExpr::Query(q) => {
            collect_tables_from_query(q, tables);
        }
        sqlparser::ast::SetExpr::SetOperation { left, right, .. } => {
            collect_tables_from_set_expr(left, tables);
            collect_tables_from_set_expr(right, tables);
        }
        _ => {}
    }
}

fn collect_tables_from_query(query: &sqlparser::ast::Query, tables: &mut Vec<String>) {
    if let Some(with) = &query.with {
        for cte in &with.cte_tables {
            collect_tables_from_query(&cte.query, tables);
        }
    }
    collect_tables_from_set_expr(&query.body, tables);
}

impl QueryExecutionPipeline {
    /// Executes a database query through the complete pipeline: circuit breaker, cache, blacklist, AST, and engine.
    /// CONTRACT:
    ///  - Precondition: Caller holds valid AuthContext with database permissions.
    ///  - Returns `Ok((Arc<QueryResult>, Bytes))` on success.
    ///  - Throws `AxiomError` on timeout, circuit open, parse failure, or engine error.
    ///  - Side effects: Writes to cache on cacheable queries; increments circuit breaker on engine failure.
    pub async fn run_query(
        db_name: &str,
        sql: &str,
        params: Vec<Value>,
        auth: &AuthContext,
        _db_cfg: &DatabaseDefConfig,
    ) -> Result<(Arc<QueryResult>, bytes::Bytes), AxiomError> {
        // Debt #1: Fetch configuration once per request pipeline run
        let config = axiom_core::ConfigManager::get();
        if config.circuit_breaker.enabled {
            if let Some(failures) = CIRCUIT_FAILURES.get(db_name) {
                if *failures.value() as i32 >= config.circuit_breaker.failure_threshold {
                    return Err(AxiomError::new("CIRCUIT_BREAKER_OPEN", "Database connection temporarily blocked due to repeated failures", StatusCode::SERVICE_UNAVAILABLE));
                }
            }
        }

        let engine = DatabasePoolManager::get_engine(db_name)
            .await
            .ok_or_else(|| {
                AxiomError::new("DB_NOT_FOUND", "Database not found", StatusCode::NOT_FOUND)
            })?;

        let is_mutation_regex = MUTATION_RE.is_match(sql);

        let cache_enabled = config.cache.enabled && config.cache.query_cache;
        let cache_ttl = config.cache.query_results_ttl as u64;

        // Cache key computed now but the lookup is deferred until AFTER RBAC passes.
        // WHY: returning bytes before PolicyEngine::evaluate would silently bypass
        // permission revocations for the duration of the TTL.
        let cache_key = if cache_enabled && !is_mutation_regex {
            Some(format!("{}:{}:{}:{:?}", auth.api_key_name, db_name, sql, params))
        } else {
            None
        };

        // Cache miss or mutation. Check AST Cache before falling back to full sqlparser.
        let dialect_name = engine.dialect();
        let ast_cache_key = format!("{}:{}", dialect_name, sql);

        let (is_mutation, formatted_sql, multiple_statements) = if let Some(cached) = AST_CACHE.get(&ast_cache_key) {
            for (op, tables) in &cached.operations {
                if tables.is_empty() {
                    PolicyEngine::evaluate(auth, db_name, "*", op)?;
                } else {
                    for tbl in tables {
                        PolicyEngine::evaluate(auth, db_name, tbl, op)?;
                    }
                }
            }
            let cow = cached.formatted_sql.clone().map(std::borrow::Cow::Owned).unwrap_or_else(|| std::borrow::Cow::Borrowed(sql));
            (cached.is_mutation, cow, cached.multiple_statements.clone())
        } else {
            let ast_result = if dialect_name == "postgres" {
                sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::PostgreSqlDialect {}, sql)
            } else if dialect_name == "clickhouse" {
                sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::ClickHouseDialect {}, sql)
            } else if dialect_name == "mssql" {
                sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::MsSqlDialect {}, sql)
            } else if dialect_name == "mysql" {
                sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::MySqlDialect {}, sql)
            } else if dialect_name == "sqlite" {
                sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::SQLiteDialect {}, sql)
            } else {
                sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::GenericDialect {}, sql)
            };

            let statements = ast_result.map_err(|e| {
                tracing::error!("SQL parse error: {}", e);
                AxiomError::new(
                    "SQL_PARSE_ERROR",
                    "SQL parsing failed",
                    StatusCode::BAD_REQUEST,
                )
            })?;

            let mut is_mutation = false;
            let mut operations = Vec::with_capacity(statements.len());

            for stmt in &statements {
                let (op, tables) = match stmt {
                    sqlparser::ast::Statement::Query(query) => {
                        let mut tbls = Vec::new();
                        collect_tables_from_query(query, &mut tbls);
                        ("SELECT", tbls)
                    }
                    sqlparser::ast::Statement::Explain { .. }
                    | sqlparser::ast::Statement::ShowVariable { .. }
                    | sqlparser::ast::Statement::ShowColumns { .. } => ("SELECT", Vec::new()),
                    sqlparser::ast::Statement::Insert(insert) => {
                        is_mutation = true;
                        ("INSERT", vec![extract_table_name(&insert.table.to_string())])
                    }
                    sqlparser::ast::Statement::Update(update) => {
                        is_mutation = true;
                        let mut tbls = Vec::new();
                        collect_tables_from_table_with_joins(&update.table, &mut tbls);
                        if tbls.is_empty() {
                            tbls.push(extract_table_name(&update.table.to_string()));
                        }
                        ("UPDATE", tbls)
                    }
                    sqlparser::ast::Statement::Delete(delete) => {
                        is_mutation = true;
                        let mut tbls = Vec::new();
                        if let sqlparser::ast::FromTable::WithFromKeyword(from_tables) = &delete.from {
                            for twj in from_tables {
                                collect_tables_from_table_with_joins(twj, &mut tbls);
                            }
                        } else {
                            for name in &delete.tables {
                                tbls.push(extract_table_name(&name.to_string()));
                            }
                        };
                        ("DELETE", tbls)
                    }
                    sqlparser::ast::Statement::Drop { .. }
                    | sqlparser::ast::Statement::AlterTable { .. }
                    | sqlparser::ast::Statement::Truncate { .. } => {
                        is_mutation = true;
                        ("DDL", Vec::new())
                    }
                    _ => {
                        is_mutation = true;
                        ("DENY", Vec::new())
                    }
                };

                if tables.is_empty() {
                    PolicyEngine::evaluate(auth, db_name, "*", op)?;
                } else {
                    for tbl in &tables {
                        PolicyEngine::evaluate(auth, db_name, tbl, op)?;
                    }
                }
                operations.push((op, tables));
            }

            // Format placeholders based on engine dialect
            let opt_formatted_sql = if (dialect_name == "postgres" || dialect_name == "any") && sql.contains('?') {
                use std::fmt::Write;
                let mut final_sql = String::with_capacity(sql.len() + 16);
                let mut param_index = 1;
                for c in sql.chars() {
                    if c == '?' {
                        let _ = write!(final_sql, "${}", param_index);
                        param_index += 1;
                    } else {
                        final_sql.push(c);
                    }
                }
                Some(final_sql)
            } else {
                None
            };

            let mult_stmts = if statements.len() > 1 {
                Some(statements.iter().map(|s| s.to_string()).collect())
            } else {
                None
            };

            if AST_CACHE.len() < MAX_AST_CACHE_ENTRIES {
                AST_CACHE.insert(
                    ast_cache_key,
                    Arc::new(CachedAstInfo {
                        is_mutation,
                        operations,
                        formatted_sql: opt_formatted_sql.clone(),
                        multiple_statements: mult_stmts.clone(),
                    }),
                );
            }

            let cow = opt_formatted_sql.map(std::borrow::Cow::Owned).unwrap_or_else(|| std::borrow::Cow::Borrowed(sql));
            (is_mutation, cow, mult_stmts)
        };

        // Result cache lookup: only reached after PolicyEngine::evaluate passes above.
        // WHY deferred: permission revocations must take effect immediately, not after TTL.
        if !is_mutation {
            if let Some(ref key) = cache_key {
                if let Some(bytes) = axiom_cache::CacheEngine::get(key).await {
                    return Ok((
                        Arc::new(QueryResult { affected_rows: Some(0), ..Default::default() }),
                        bytes,
                    ));
                }
            }
        }

        let start_time = std::time::Instant::now();
        let exec_result: Result<QueryResult, String> = if let Some(stmt_strs) = multiple_statements {
            let mut last_res = None;
            let mut exec_err = None;
            for (idx, stmt_str) in stmt_strs.iter().enumerate() {
                let stmt_formatted = if (dialect_name == "postgres" || dialect_name == "any") && stmt_str.contains('?') {
                    use std::fmt::Write;
                    let mut s = String::with_capacity(stmt_str.len() + 16);
                    let mut p_idx = 1;
                    for c in stmt_str.chars() {
                        if c == '?' {
                            let _ = write!(s, "${}", p_idx);
                            p_idx += 1;
                        } else {
                            s.push(c);
                        }
                    }
                    s
                } else {
                    stmt_str.clone()
                };

                let is_last = idx == stmt_strs.len() - 1;
                let stmt_params = if is_last { params.as_slice() } else { &[] };
                match engine.execute(&stmt_formatted, stmt_params).await {
                    Ok(r) => {
                        last_res = Some(r);
                    }
                    Err(e) => {
                        exec_err = Some(e.to_string());
                        break;
                    }
                }
            }
            if let Some(err) = exec_err {
                Err(err)
            } else {
                Ok(last_res.unwrap_or_else(|| QueryResult {
                    affected_rows: Some(0),
                    ..Default::default()
                }))
            }
        } else {
            engine.execute(&formatted_sql, &params).await.map_err(|e| e.to_string())
        };
        let duration_secs = start_time.elapsed().as_secs_f64();
        let op_label = if is_mutation { "MUTATION" } else { "SELECT" };
        crate::metrics::MetricsEngine::record_db_query(db_name, op_label, duration_secs);

        match exec_result {
            Ok(res) => {
                if config.circuit_breaker.enabled {
                    CIRCUIT_FAILURES.remove(db_name);
                }
                if res.truncated == Some(true) {
                    tracing::warn!(
                        "Database query on '{}' exceeded max row limit ({}). Results were truncated to protect server memory.",
                        db_name,
                        axiom_core::DEFAULT_MAX_QUERY_ROWS
                    );
                }
                let arc_res = Arc::new(res);
                let json_bytes = match serde_json::to_vec(&*arc_res) {
                    Ok(b) => bytes::Bytes::from(b),
                    Err(e) => {
                        tracing::error!("Serialization error: {}", e);
                        return Err(AxiomError::new("SERIALIZATION_FAILED", "Failed to serialize response", StatusCode::INTERNAL_SERVER_ERROR));
                    }
                };

                if !is_mutation {
                    if let Some(key) = cache_key {
                        let durability = match config.cache.backend.as_str() {
                            "turso" | "hybrid" => axiom_cache::Durability::Journaled,
                            _ => axiom_cache::Durability::MemoryOnly,
                        };
                        axiom_cache::CacheEngine::set(&key, json_bytes.clone(), cache_ttl, durability).await;
                    }
                }
                Ok((arc_res, json_bytes))
            }
            Err(e) => {
                let err_lower = e.to_lowercase();
                let is_connection_failure = err_lower.contains("connection")
                    || err_lower.contains("refused")
                    || err_lower.contains("timed out")
                    || err_lower.contains("broken pipe")
                    || err_lower.contains("closed pool");

                if config.circuit_breaker.enabled && is_connection_failure {
                    let mut count = CIRCUIT_FAILURES.entry(db_name.to_string()).or_insert(0);
                    *count += 1;
                }
                tracing::error!("Database query failed on '{}': {}", db_name, e);

                let (status, err_code, client_msg) = if is_connection_failure {
                    (StatusCode::SERVICE_UNAVAILABLE, "DB_CONNECTION_FAILED", "Upstream database unavailable")
                } else {
                    (StatusCode::BAD_REQUEST, "DB_QUERY_FAILED", "Database query execution failed")
                };

                Err(AxiomError::new(err_code, client_msg, status))
            },
        }
    }
}

pub async fn get_db_config(
    db_name: &str,
    auth: &AuthContext,
) -> Result<DatabaseDefConfig, AxiomError> {
    let allowed = if auth.is_session {
        true
    } else if !auth.permissions.is_empty() {
        auth.permissions
            .iter()
            .any(|p| p.database == "*" || p.database.eq_ignore_ascii_case(db_name))
    } else {
        auth.db_scope
            .iter()
            .any(|s| s == "*" || s.eq_ignore_ascii_case(db_name))
    };

    if !allowed {
        return Err(AxiomError::new(
            "AUTH_SCOPE_DENIED",
            &format!("API key does not have access to database '{}'", db_name),
            StatusCode::FORBIDDEN,
        ));
    }

    let config = axiom_core::ConfigManager::get();
    if let Some(db_cfg) = config.database.get(db_name) {
        Ok(db_cfg.clone())
    } else if let Some(snap_db) = axiom_metadata::snapshot::get_snapshot().databases.get(db_name) {
        Ok(DatabaseDefConfig {
            url: snap_db.url.clone(),
            pool_min: snap_db.pool_min as i32,
            pool_max: snap_db.pool_max as i32,
            ..Default::default()
        })
    } else {
        Err(AxiomError::new(
            "DB_NOT_FOUND",
            "Database not found",
            StatusCode::NOT_FOUND,
        ))
    }
}

pub async fn list_tables(
    axum::extract::Path(db_name): axum::extract::Path<String>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::extract::Query(params): axum::extract::Query<
        crate::database::schemas::ListTablesParams,
    >,
) -> Result<axum::Json<Value>, AxiomError> {
    PolicyEngine::evaluate(&auth, &db_name, "*", "SELECT")?;
    let _db_cfg = get_db_config(&db_name, &auth).await?;

    let engine = DatabasePoolManager::get_engine(&db_name)
        .await
        .ok_or_else(|| {
            AxiomError::new("DB_NOT_FOUND", "Database not found", StatusCode::NOT_FOUND)
        })?;

    let limit = params.limit.clamp(1, 500) as usize;
    match engine.list_tables(params.cursor, limit).await {
        Ok(tables) => {
            let mut next_cursor = None;
            if !tables.is_empty() && tables.len() == limit {
                if let Some(last_table) = tables.last() {
                    next_cursor = Some(last_table.name.clone());
                }
            }

            Ok(axum::Json(serde_json::json!({
                "success": true,
                "data": {
                    "database": db_name,
                    "tables": tables,
                },
                "pagination": {
                    "limit": limit,
                    "has_more": next_cursor.is_some(),
                    "next_cursor": next_cursor
                },
                "error": serde_json::Value::Null
            })))
        }
        Err(e) => {
            tracing::error!("Database list tables failed: {}", e);
            Err(AxiomError::new(
                "DB_QUERY_FAILED",
                "Database query execution failed",
                StatusCode::INTERNAL_SERVER_ERROR,
            ))
        },
    }
}

pub async fn insert_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::Json(payload): axum::Json<crate::database::schemas::InsertRequest>,
) -> Result<axum::Json<Value>, AxiomError> {
    PolicyEngine::evaluate(&auth, &db_name, &table_name, "INSERT")?;
    let db_cfg = get_db_config(&db_name, &auth).await?;

    let rows_to_insert = if let Some(r) = payload.rows {
        r
    } else if let Some(single) = payload.row {
        vec![single]
    } else {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "No rows provided",
            StatusCode::BAD_REQUEST,
        ));
    };

    if rows_to_insert.is_empty() {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "No rows provided",
            StatusCode::BAD_REQUEST,
        ));
    }

    // Dynamically build a parameterized multi-insert query from the provided rows.
    let first_row = &rows_to_insert[0];
    let column_pairs: Vec<(&String, std::borrow::Cow<'_, str>)> = first_row
        .keys()
        .map(|k| (k, crate::database::filter_builder::sanitize_ident(k)))
        .collect();
    let cols_str = column_pairs
        .iter()
        .map(|(_, col)| col.as_ref())
        .collect::<Vec<_>>()
        .join(", ");

    let mut all_params = Vec::new();
    let mut values_strings = Vec::new();

    for row in &rows_to_insert {
        let mut row_placeholders = Vec::new();
        for (raw_k, _) in &column_pairs {
            let val = row.get(*raw_k).unwrap_or(&Value::Null);
            all_params.push(val.clone());
            row_placeholders.push("?");
        }
        values_strings.push(format!("({})", row_placeholders.join(", ")));
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES {}",
        crate::database::filter_builder::sanitize_ident(&table_name),
        cols_str,
        values_strings.join(", ")
    );

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, all_params, &auth, &db_cfg).await?;

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "affected_rows": result.affected_rows,
        "data": {
            "affected_rows": result.affected_rows
        },
        "error": serde_json::Value::Null
    })))
}

pub async fn fetch_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::extract::Query(params): axum::extract::Query<
        crate::database::schemas::FetchRowsParams,
    >,
) -> Result<axum::Json<Value>, AxiomError> {
    PolicyEngine::evaluate(&auth, &db_name, &table_name, "SELECT")?;
    let db_cfg = get_db_config(&db_name, &auth).await?;

    let mut values = Vec::new();
    let mut where_clauses = Vec::new();

    if let Some(filter_str) = &params.filter {
        if let Ok(filter_json) =
            serde_json::from_str::<std::collections::HashMap<String, Value>>(filter_str)
        {
            let (clause, mut vals) =
                crate::database::filter_builder::build_where_clause(&filter_json);
            if !clause.is_empty() {
                where_clauses.push(clause);
                values.append(&mut vals);
            }
        }
    }

    let where_sql = if where_clauses.is_empty() {
        "".to_string()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let sort_col = params.sort.as_deref().unwrap_or("id");
    let order_col = crate::database::filter_builder::sanitize_ident(sort_col);
    let order_dir = if params.order.eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    };

    let limit = params.limit.clamp(1, 500);

    let mut final_where = where_sql.clone();

    if let Some(cursor) = &params.cursor {
        // If WHERE already exists, append with AND, else start new WHERE
        let cursor_op = if order_dir == "DESC" { "<" } else { ">" };
        
        // Parametrize the cursor to prevent SQL injection
        let cursor_cond = format!("{} {} ?", order_col, cursor_op);
        values.push(Value::String(cursor.clone()));

        if final_where.trim().is_empty() {
            final_where = format!("WHERE {}", cursor_cond);
        } else {
            final_where = format!("{} AND {}", final_where, cursor_cond);
        }
    }

    let sql = format!(
        "SELECT * FROM {} {} ORDER BY {} {} LIMIT {}",
        crate::database::filter_builder::sanitize_ident(&table_name),
        final_where,
        order_col,
        order_dir,
        limit
    );

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;

    let result_inner = Arc::try_unwrap(result).unwrap_or_else(|arc| (*arc).clone());

    let mut next_cursor = None;
    if let Some(ref rows) = result_inner.rows {
        if !rows.is_empty() && rows.len() == limit as usize {
            if let Some(last_row) = rows.last() {
                // Determine cursor value by grabbing the column we sorted by
                if let Some(val) = last_row.get(&*order_col) {
                    next_cursor = match val {
                        Value::String(s) => Some(s.clone()),
                        Value::Number(n) => Some(n.to_string()),
                        _ => None, // nulls or booleans not supported as cursors
                    };
                }
            }
        }
    }

    let rows_data = result_inner.rows.unwrap_or_default();

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "data": {
            "rows": rows_data,
            "pagination": {
                "limit": limit,
                "has_more": next_cursor.is_some(),
                "next_cursor": next_cursor
            }
        },
        "pagination": {
            "limit": limit,
            "has_more": next_cursor.is_some(),
            "next_cursor": next_cursor
        },
        "error": serde_json::Value::Null
    })))
}

pub async fn update_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::Json(payload): axum::Json<crate::database::schemas::UpdateRequest>,
) -> Result<axum::Json<Value>, AxiomError> {
    PolicyEngine::evaluate(&auth, &db_name, &table_name, "UPDATE")?;
    let db_cfg = get_db_config(&db_name, &auth).await?;

    if payload.filter.is_empty() {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "Update requires a non-empty filter",
            StatusCode::BAD_REQUEST,
        ));
    }

    if payload.update.is_empty() {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "Update requires non-empty update fields",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (sql, values) = crate::database::filter_builder::construct_update(
        &table_name,
        &payload.update,
        &payload.filter,
    );

    if sql.ends_with("WHERE ") || sql.contains("SET  WHERE") {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "Invalid update or filter criteria",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "affected_rows": result.affected_rows,
        "data": {
            "affected_rows": result.affected_rows
        },
        "error": serde_json::Value::Null
    })))
}

pub async fn delete_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::Json(payload): axum::Json<crate::database::schemas::DeleteRequest>,
) -> Result<axum::Json<Value>, AxiomError> {
    PolicyEngine::evaluate(&auth, &db_name, &table_name, "DELETE")?;
    let db_cfg = get_db_config(&db_name, &auth).await?;

    if payload.filter.is_empty() {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "Delete requires a non-empty filter",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (sql, values) =
        crate::database::filter_builder::construct_delete(&table_name, &payload.filter);

    if sql.ends_with("WHERE ") {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "Invalid delete filter criteria",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "affected_rows": result.affected_rows,
        "data": {
            "affected_rows": result.affected_rows
        },
        "error": serde_json::Value::Null
    })))
}

pub async fn describe_table(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
) -> Result<axum::Json<serde_json::Value>, AxiomError> {
    PolicyEngine::evaluate(&auth, &db_name, &table_name, "SELECT")?;
    let _db_cfg = get_db_config(&db_name, &auth).await?;

    let engine = DatabasePoolManager::get_engine(&db_name)
        .await
        .ok_or_else(|| {
            AxiomError::new("DB_NOT_FOUND", "Database not found", axum::http::StatusCode::NOT_FOUND)
        })?;

    let columns = engine
        .describe_table(&table_name)
        .await
        .map_err(|e| { tracing::error!("Describe failed: {}", e); AxiomError::new("DESCRIBE_FAILED", "Failed to retrieve table schema", axum::http::StatusCode::INTERNAL_SERVER_ERROR) })?;

    let foreign_keys = engine
        .get_foreign_keys(&table_name)
        .await
        .map_err(|e| { tracing::error!("FK fetch failed: {}", e); AxiomError::new("FK_FETCH_FAILED", "Failed to retrieve foreign keys", axum::http::StatusCode::INTERNAL_SERVER_ERROR) })?;

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "data": {
            "database": db_name,
            "table": table_name,
            "columns": columns,
            "foreign_keys": foreign_keys
        },
        "error": serde_json::Value::Null
    })))
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_multi_statement_sqlparser() {
        let sql = "CREATE TABLE customers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL); INSERT INTO customers (name) VALUES ('Alice'); SELECT * FROM customers;";
        let stmts = sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::MySqlDialect {}, sql).unwrap();
        assert_eq!(stmts.len(), 3);
        assert_eq!(stmts[0].to_string(), "CREATE TABLE customers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)");
        assert_eq!(stmts[1].to_string(), "INSERT INTO customers (name) VALUES ('Alice')");
        assert_eq!(stmts[2].to_string(), "SELECT * FROM customers");
    }

    #[test]
    fn test_ast_cache_hit_and_consistency() {
        let sql = "SELECT id, name, email FROM users WHERE status = ? AND active = true";
        let cache_key = format!("postgres:{}", sql);

        let info = std::sync::Arc::new(super::CachedAstInfo {
            is_mutation: false,
            operations: vec![("SELECT", vec!["users".to_string()])],
            formatted_sql: Some("SELECT id, name, email FROM users WHERE status = $1 AND active = true".to_string()),
            multiple_statements: None,
        });

        super::AST_CACHE.insert(cache_key.clone(), info);
        let cached = super::AST_CACHE.get(&cache_key).expect("cached AST entry should exist");
        assert_eq!(cached.is_mutation, false);
        assert_eq!(cached.operations[0].0, "SELECT");
        assert_eq!(cached.operations[0].1, vec!["users".to_string()]);
        assert_eq!(cached.formatted_sql.as_deref(), Some("SELECT id, name, email FROM users WHERE status = $1 AND active = true"));
    }
}


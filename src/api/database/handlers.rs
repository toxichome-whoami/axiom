use axum::http::StatusCode;
use serde_json::Value;
use std::sync::Arc;

use crate::api::errors::AxiomError;
use crate::config::schema::DatabaseDefConfig;
use crate::db::engines::base::QueryResult;
use crate::db::pool::DatabasePoolManager;
use crate::utils::types::{AuthContext, ServerMode};

pub struct QueryExecutionPipeline;

impl QueryExecutionPipeline {
    pub async fn run_query(
        db_name: &str,
        sql: &str,
        params: Vec<Value>,
        auth: &AuthContext,
        db_cfg: &DatabaseDefConfig,
    ) -> Result<(Arc<QueryResult>, bytes::Bytes), AxiomError> {
        let engine = DatabasePoolManager::get_engine(db_name)
            .await
            .ok_or_else(|| {
                AxiomError::new("DB_NOT_FOUND", "Database not found", StatusCode::NOT_FOUND)
            })?;

        static MUTATION_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(
            || {
                regex::Regex::new(r"(?i)\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|GRANT|REVOKE|PRAGMA)\b").unwrap()
            },
        );

        let is_mutation_regex = MUTATION_RE.is_match(sql);

        let config = crate::config::loader::ConfigManager::get();
        let cache_enabled = config.cache.enabled && config.cache.query_cache;
        let cache_ttl = config.cache.query_results_ttl as u64;

        let cache_key = if cache_enabled && !is_mutation_regex {
            let key = format!("{}:{}:{:?}", db_name, sql, params);
            static QUERY_CACHE: once_cell::sync::Lazy<
                dashmap::DashMap<String, (std::time::Instant, Arc<QueryResult>, bytes::Bytes)>,
            > = once_cell::sync::Lazy::new(|| dashmap::DashMap::new());

            if let Some(entry) = QUERY_CACHE.get(&key) {
                if entry.0.elapsed().as_secs() < cache_ttl {
                    return Ok((entry.1.clone(), entry.2.clone()));
                }
            }
            Some((key, &QUERY_CACHE))
        } else {
            None
        };

        // Cache miss or mutation. Now we MUST run the strict AST parser to prevent bypasses.
        let dialect_name = engine.dialect();

        let ast_result = if dialect_name == "postgres" {
            sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::PostgreSqlDialect {}, sql)
        } else if dialect_name == "mysql" {
            sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::MySqlDialect {}, sql)
        } else if dialect_name == "sqlite" {
            sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::SQLiteDialect {}, sql)
        } else {
            sqlparser::parser::Parser::parse_sql(&sqlparser::dialect::GenericDialect {}, sql)
        };

        let statements = ast_result.map_err(|e| {
            AxiomError::new(
                "SQL_PARSE_ERROR",
                &format!("SQL parsing failed: {}", e),
                StatusCode::BAD_REQUEST,
            )
        })?;

        let mut is_mutation = false;
        let mut is_dangerous = false;

        for stmt in statements {
            match stmt {
                sqlparser::ast::Statement::Query(_)
                | sqlparser::ast::Statement::Explain { .. }
                | sqlparser::ast::Statement::ShowVariable { .. }
                | sqlparser::ast::Statement::ShowColumns { .. } => {
                    // Safe for readonly
                }
                sqlparser::ast::Statement::Drop { .. }
                | sqlparser::ast::Statement::AlterTable { .. }
                | sqlparser::ast::Statement::Truncate { .. } => {
                    is_mutation = true;
                    is_dangerous = true;
                }
                _ => {
                    // Treat any other statements (Insert, Update, Delete, Create, etc.) as mutations
                    is_mutation = true;
                }
            }
        }

        if is_mutation && auth.mode == ServerMode::Readonly {
            return Err(AxiomError::new(
                "AUTH_INSUFFICIENT_MODE",
                "Read-only keys cannot execute mutations or dangerous commands",
                StatusCode::FORBIDDEN,
            ));
        }

        if is_dangerous && !db_cfg.dangerous_operations {
            return Err(AxiomError::new(
                "DB_DANGEROUS_OP_DENIED",
                "Dangerous operations are disabled",
                StatusCode::FORBIDDEN,
            ));
        }

        // Format placeholders based on engine dialect
        let formatted_sql = if dialect_name == "postgres" || dialect_name == "any" {
            // Primitive placeholder conversion for postgres `$1, $2`
            let mut final_sql = String::new();
            let mut param_index = 1;
            let mut chars = sql.chars().peekable();
            while let Some(c) = chars.next() {
                if c == '?' {
                    final_sql.push_str(&format!("${}", param_index));
                    param_index += 1;
                } else {
                    final_sql.push(c);
                }
            }
            final_sql
        } else {
            sql.to_string()
        };

        match engine.execute(&formatted_sql, &params).await {
            Ok(res) => {
                let arc_res = Arc::new(res);
                let json_bytes = bytes::Bytes::from(serde_json::to_vec(&*arc_res).unwrap());

                if !is_mutation {
                    if let Some((key, cache_ref)) = cache_key {
                        cache_ref.insert(
                            key,
                            (
                                std::time::Instant::now(),
                                arc_res.clone(),
                                json_bytes.clone(),
                            ),
                        );
                    }
                }
                Ok((arc_res, json_bytes))
            }
            Err(e) => Err(AxiomError::new(
                "DB_QUERY_FAILED",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )),
        }
    }
}

pub async fn get_db_config(
    db_name: &str,
    auth: &AuthContext,
) -> Result<DatabaseDefConfig, AxiomError> {
    if !auth.db_scope.iter().any(|s| s == "*" || s == db_name) {
        return Err(AxiomError::new(
            "AUTH_SCOPE_DENIED",
            "API key does not have access to database",
            StatusCode::FORBIDDEN,
        ));
    }

    let config = crate::config::loader::ConfigManager::get();
    if let Some(db_cfg) = config.database.get(db_name) {
        Ok(db_cfg.clone())
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
        crate::api::database::schemas::ListTablesParams,
    >,
) -> Result<axum::Json<Value>, AxiomError> {
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
                }
            })))
        }
        Err(e) => Err(AxiomError::new(
            "DB_QUERY_FAILED",
            &e.to_string(),
            StatusCode::INTERNAL_SERVER_ERROR,
        )),
    }
}

pub async fn insert_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::Json(payload): axum::Json<crate::api::database::schemas::InsertRequest>,
) -> Result<axum::Json<Value>, AxiomError> {
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

    // In a production ORM, this would map keys and use properly bound parameters.
    // For this stub, we dynamically build a multi-insert query.
    let first_row = &rows_to_insert[0];
    let columns: Vec<String> = first_row
        .keys()
        .cloned()
        .map(|k| crate::api::database::filter_builder::sanitize_ident(&k))
        .collect();
    let cols_str = columns.join(", ");

    let mut all_params = Vec::new();
    let mut values_strings = Vec::new();

    for row in &rows_to_insert {
        let mut row_placeholders = Vec::new();
        for col in &columns {
            let val = row.get(col).unwrap_or(&Value::Null);
            all_params.push(val.clone());
            row_placeholders.push("?");
        }
        values_strings.push(format!("({})", row_placeholders.join(", ")));
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES {}",
        crate::api::database::filter_builder::sanitize_ident(&table_name),
        cols_str,
        values_strings.join(", ")
    );

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, all_params, &auth, &db_cfg).await?;

    // Webhook/SSE triggering logic
    use crate::api::sse::connection_manager::SSE_MGR;
    let topic = format!("db:{}:{}", db_name, table_name);
    SSE_MGR
        .publish(
            &topic,
            "INSERT",
            serde_json::json!({
                "table": table_name,
                "affected_rows": result.affected_rows,
                "rows": rows_to_insert
            })
            .to_string(),
        )
        .await;

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "affected_rows": result.affected_rows
    })))
}
pub async fn fetch_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::extract::Query(params): axum::extract::Query<
        crate::api::database::schemas::FetchRowsParams,
    >,
) -> Result<axum::Json<Value>, AxiomError> {
    let db_cfg = get_db_config(&db_name, &auth).await?;

    let mut values = Vec::new();
    let mut where_clauses = Vec::new();

    if let Some(filter_str) = &params.filter {
        if let Ok(filter_json) =
            serde_json::from_str::<std::collections::HashMap<String, Value>>(filter_str)
        {
            let (clause, mut vals) =
                crate::api::database::filter_builder::build_where_clause(&filter_json);
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

    let order_col = crate::api::database::filter_builder::sanitize_ident(
        &params.sort.clone().unwrap_or_else(|| "id".to_string()),
    );
    let order_dir = if params.order.to_lowercase() == "desc" {
        "DESC"
    } else {
        "ASC"
    };

    let limit = params.limit.clamp(1, 500);

    let mut final_where = where_sql.clone();

    if let Some(cursor) = &params.cursor {
        // If WHERE already exists, append with AND, else start new WHERE
        let cursor_op = if order_dir == "DESC" { "<" } else { ">" };
        let cursor_cond = format!("{} {} '{}'", order_col, cursor_op, cursor);

        if final_where.trim().is_empty() {
            final_where = format!("WHERE {}", cursor_cond);
        } else {
            final_where = format!("{} AND {}", final_where, cursor_cond);
        }
    }

    let sql = format!(
        "SELECT * FROM {} {} ORDER BY {} {} LIMIT {}",
        crate::api::database::filter_builder::sanitize_ident(&table_name),
        final_where,
        order_col,
        order_dir,
        limit
    );

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;

    let mut next_cursor = None;
    if let Some(rows) = &result.rows {
        if !rows.is_empty() && rows.len() == limit as usize {
            if let Some(last_row) = rows.last() {
                // Determine cursor value by grabbing the column we sorted by
                if let Some(val) = last_row.get(&order_col) {
                    next_cursor = match val {
                        Value::String(s) => Some(s.clone()),
                        Value::Number(n) => Some(n.to_string()),
                        _ => None, // nulls or booleans not supported as cursors
                    };
                }
            }
        }
    }

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "data": {
            "rows": result.rows,
            "pagination": {
                "limit": limit,
                "has_more": next_cursor.is_some(),
                "next_cursor": next_cursor
            }
        }
    })))
}

pub async fn update_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::Json(payload): axum::Json<crate::api::database::schemas::UpdateRequest>,
) -> Result<axum::Json<Value>, AxiomError> {
    let db_cfg = get_db_config(&db_name, &auth).await?;

    if payload.filter.is_empty() {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "Update requires a filter",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (sql, values) = crate::api::database::filter_builder::construct_update(
        &table_name,
        &payload.update,
        &payload.filter,
    );

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;

    use crate::api::sse::connection_manager::SSE_MGR;
    let topic = format!("db:{}:{}", db_name, table_name);
    SSE_MGR
        .publish(
            &topic,
            "UPDATE",
            serde_json::json!({ "table": table_name, "affected_rows": result.affected_rows })
                .to_string(),
        )
        .await;

    Ok(axum::Json(
        serde_json::json!({ "success": true, "affected_rows": result.affected_rows }),
    ))
}

pub async fn delete_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::Json(payload): axum::Json<crate::api::database::schemas::DeleteRequest>,
) -> Result<axum::Json<Value>, AxiomError> {
    let db_cfg = get_db_config(&db_name, &auth).await?;

    if payload.filter.is_empty() {
        return Err(AxiomError::new(
            "BAD_REQUEST",
            "Delete requires a filter",
            StatusCode::BAD_REQUEST,
        ));
    }

    let (sql, values) =
        crate::api::database::filter_builder::construct_delete(&table_name, &payload.filter);

    let (result, _) =
        QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;

    use crate::api::sse::connection_manager::SSE_MGR;
    let topic = format!("db:{}:{}", db_name, table_name);
    SSE_MGR
        .publish(
            &topic,
            "DELETE",
            serde_json::json!({ "table": table_name, "affected_rows": result.affected_rows })
                .to_string(),
        )
        .await;

    Ok(axum::Json(
        serde_json::json!({ "success": true, "affected_rows": result.affected_rows }),
    ))
}

use axum::http::StatusCode;
use serde_json::Value;

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
    ) -> Result<QueryResult, AxiomError> {
        let is_mutation = sql.trim().to_uppercase().starts_with("INSERT")
            || sql.trim().to_uppercase().starts_with("UPDATE")
            || sql.trim().to_uppercase().starts_with("DELETE")
            || sql.trim().to_uppercase().starts_with("CREATE")
            || sql.trim().to_uppercase().starts_with("DROP")
            || sql.trim().to_uppercase().starts_with("ALTER");

        if is_mutation && auth.mode == ServerMode::Readonly {
            return Err(AxiomError::new(
                "AUTH_INSUFFICIENT_MODE",
                "Read-only keys cannot mutate data",
                StatusCode::FORBIDDEN,
            ));
        }

        if !db_cfg.dangerous_operations
            && (sql.trim().to_uppercase().starts_with("DROP")
                || sql.trim().to_uppercase().starts_with("TRUNCATE")
                || sql.trim().to_uppercase().starts_with("ALTER"))
        {
            return Err(AxiomError::new(
                "DB_DANGEROUS_OP_DENIED",
                "Dangerous operations are disabled",
                StatusCode::FORBIDDEN,
            ));
        }

        // Stub WAF / validation
        // In a real system, we'd parse the SQL string to validate constraints.

        let engine = DatabasePoolManager::get_engine(db_name)
            .await
            .ok_or_else(|| {
                AxiomError::new("DB_NOT_FOUND", "Database not found", StatusCode::NOT_FOUND)
            })?;

        // Format placeholders based on engine dialect
        let dialect = engine.dialect();
        let formatted_sql = if dialect == "postgres" || dialect == "any" {
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

        // In the true migration, we would bind `params` safely into `sqlx::query().bind()`.
        // Since `DatabaseEngine::execute(sql: &str)` only takes a string currently in our Rust stub,
        // we'll format the values inline for demonstration purposes.
        // WARNING: INSECURE STUB. Real code MUST use bound parameters.
        let mut final_bound_sql = formatted_sql.clone();
        for val in params {
            let val_str = match val {
                Value::String(s) => format!("'{}'", s.replace("'", "''")),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                Value::Null => "NULL".to_string(),
                _ => format!("'{}'", val.to_string().replace("'", "''")),
            };
            // Replace the first occurrence of `?` or `$N` with the value
            // Extremely hacky stub.
            if let Some(pos) = final_bound_sql.find('?') {
                final_bound_sql.replace_range(pos..pos + 1, &val_str);
            } else if let Some(pos) = final_bound_sql.find('$') {
                // remove the $N
                let end = final_bound_sql[pos + 1..]
                    .find(|c: char| !c.is_numeric())
                    .map(|i| i + pos + 1)
                    .unwrap_or(final_bound_sql.len());
                final_bound_sql.replace_range(pos..end, &val_str);
            }
        }

        match engine.execute(&final_bound_sql).await {
            Ok(res) => Ok(res),
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
) -> Result<axum::Json<Value>, AxiomError> {
    let _db_cfg = get_db_config(&db_name, &auth).await?;

    let engine = DatabasePoolManager::get_engine(&db_name)
        .await
        .ok_or_else(|| {
            AxiomError::new("DB_NOT_FOUND", "Database not found", StatusCode::NOT_FOUND)
        })?;

    match engine.list_tables().await {
        Ok(tables) => Ok(axum::Json(serde_json::json!({
            "success": true,
            "data": {
                "database": db_name,
                "tables": tables,
            }
        }))),
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
    let columns: Vec<String> = first_row.keys().cloned().collect();
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
        table_name,
        cols_str,
        values_strings.join(", ")
    );

    let result =
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
    axum::extract::Query(params): axum::extract::Query<crate::api::database::schemas::FetchRowsParams>,
) -> Result<axum::Json<Value>, AxiomError> {
    let db_cfg = get_db_config(&db_name, &auth).await?;
    
    let mut values = Vec::new();
    let mut where_clauses = Vec::new();
    
    if let Some(filter_str) = &params.filter {
        if let Ok(filter_json) = serde_json::from_str::<std::collections::HashMap<String, Value>>(filter_str) {
            let (clause, mut vals) = crate::api::database::filter_builder::build_where_clause(&filter_json);
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
    
    let order_col = params.sort.clone().unwrap_or_else(|| "id".to_string());
    let order_dir = if params.order.to_lowercase() == "desc" { "DESC" } else { "ASC" };
    
    let limit = params.limit.clamp(1, 500);
    let offset = (params.page.max(1) - 1) * limit;
    
    let sql = format!(
        "SELECT * FROM {} {} ORDER BY {} {} LIMIT {} OFFSET {}",
        table_name, where_sql, order_col, order_dir, limit, offset
    );
    
    let result = QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;
    
    Ok(axum::Json(serde_json::json!({
        "success": true,
        "data": {
            "rows": result.rows,
            "pagination": {
                "page": params.page,
                "limit": limit,
                "has_more": result.rows.as_ref().map(|r| r.len()).unwrap_or(0) as i32 == limit
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
        return Err(AxiomError::new("BAD_REQUEST", "Update requires a filter", StatusCode::BAD_REQUEST));
    }
    
    let (sql, values) = crate::api::database::filter_builder::construct_update(&table_name, &payload.update, &payload.filter);
    
    let result = QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;
    
    use crate::api::sse::connection_manager::SSE_MGR;
    let topic = format!("db:{}:{}", db_name, table_name);
    SSE_MGR.publish(&topic, "UPDATE", serde_json::json!({ "table": table_name, "affected_rows": result.affected_rows }).to_string()).await;
    
    Ok(axum::Json(serde_json::json!({ "success": true, "affected_rows": result.affected_rows })))
}

pub async fn delete_rows(
    axum::extract::Path((db_name, table_name)): axum::extract::Path<(String, String)>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
    axum::Json(payload): axum::Json<crate::api::database::schemas::DeleteRequest>,
) -> Result<axum::Json<Value>, AxiomError> {
    let db_cfg = get_db_config(&db_name, &auth).await?;
    
    if payload.filter.is_empty() {
        return Err(AxiomError::new("BAD_REQUEST", "Delete requires a filter", StatusCode::BAD_REQUEST));
    }
    
    let (sql, values) = crate::api::database::filter_builder::construct_delete(&table_name, &payload.filter);
    
    let result = QueryExecutionPipeline::run_query(&db_name, &sql, values, &auth, &db_cfg).await?;
    
    use crate::api::sse::connection_manager::SSE_MGR;
    let topic = format!("db:{}:{}", db_name, table_name);
    SSE_MGR.publish(&topic, "DELETE", serde_json::json!({ "table": table_name, "affected_rows": result.affected_rows }).to_string()).await;
    
    Ok(axum::Json(serde_json::json!({ "success": true, "affected_rows": result.affected_rows })))
}

use std::collections::HashMap;
use axum::http::StatusCode;
use serde_json::Value;

use crate::config::schema::DatabaseDefConfig;
use crate::utils::types::{AuthContext, ServerMode};
use crate::api::errors::AxiomError;
use crate::db::engines::base::{DatabaseEngine, QueryResult};
use crate::db::pool::DatabasePoolManager;
use crate::api::database::filter_builder;

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
            return Err(AxiomError::new("AUTH_INSUFFICIENT_MODE", "Read-only keys cannot mutate data", StatusCode::FORBIDDEN));
        }

        if !db_cfg.dangerous_operations && (sql.trim().to_uppercase().starts_with("DROP") || sql.trim().to_uppercase().starts_with("TRUNCATE") || sql.trim().to_uppercase().starts_with("ALTER")) {
            return Err(AxiomError::new("DB_DANGEROUS_OP_DENIED", "Dangerous operations are disabled", StatusCode::FORBIDDEN));
        }

        // Stub WAF / validation
        // In a real system, we'd parse the SQL string to validate constraints.

        let engine = DatabasePoolManager::get_engine(db_name).await
            .ok_or_else(|| AxiomError::new("DB_NOT_FOUND", "Database not found", StatusCode::NOT_FOUND))?;

        let engine_guard = engine.lock().await;

        // Format placeholders based on engine dialect
        let dialect = engine_guard.dialect();
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
                final_bound_sql.replace_range(pos..pos+1, &val_str);
            } else if let Some(pos) = final_bound_sql.find('$') {
                // remove the $N
                let end = final_bound_sql[pos..].find(|c: char| !c.is_numeric()).unwrap_or(final_bound_sql.len() - pos) + pos;
                final_bound_sql.replace_range(pos..end, &val_str);
            }
        }

        match engine_guard.execute(&final_bound_sql).await {
            Ok(res) => Ok(res),
            Err(e) => Err(AxiomError::new("DB_QUERY_FAILED", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR)),
        }
    }
}

pub async fn get_db_config(db_name: &str, auth: &AuthContext) -> Result<DatabaseDefConfig, AxiomError> {
    if !auth.db_scope.iter().any(|s| s == "*" || s == db_name) {
        return Err(AxiomError::new("AUTH_SCOPE_DENIED", "API key does not have access to database", StatusCode::FORBIDDEN));
    }

    let config = crate::config::loader::ConfigManager::get();
    if let Some(db_cfg) = config.database.get(db_name) {
        Ok(db_cfg.clone())
    } else {
        Err(AxiomError::new("DB_NOT_FOUND", "Database not found", StatusCode::NOT_FOUND))
    }
}

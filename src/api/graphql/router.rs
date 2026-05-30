use axum::{
    extract::{Extension, Json},
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::api::errors::AxiomError;
use crate::api::database::handlers::{QueryExecutionPipeline, get_db_config};
use crate::api::graphql::compiler::{ASTCompiler, ASTOperation};
use crate::utils::types::AuthContext;
use crate::config::loader::ConfigManager;

#[derive(Deserialize)]
pub struct GraphQLRequest {
    pub query: String,
    #[serde(rename = "operationName")]
    pub operation_name: Option<String>,
    pub variables: Option<HashMap<String, Value>>,
}

pub fn get_router() -> Router {
    Router::new().route("/", post(execute_graphql))
}

async fn execute_graphql(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<GraphQLRequest>,
) -> Result<Json<Value>, AxiomError> {
    let config = ConfigManager::get();

    // In Rust we don't have python's feature flag system globally, so we check config directly
    if !auth.full_admin && auth.db_scope.is_empty() {
        return Err(AxiomError::new("AUTH_FAILED", "GraphQL access denied", axum::http::StatusCode::FORBIDDEN));
    }

    let compiler = ASTCompiler::new(config.graphql.max_query_depth as i32);
    let operations = compiler.compile(&payload.query)
        .map_err(|e| AxiomError::new("GRAPHQL_COMPILE_ERROR", &e, axum::http::StatusCode::BAD_REQUEST))?;

    let mut results = serde_json::Map::new();

    for op in operations {
        match op {
            ASTOperation::ExecuteSql { db_alias, sql, params, alias } => {
                let db_cfg = get_db_config(&db_alias, &auth).await?;
                let mut params_vec = Vec::new();
                for (_, v) in params {
                    params_vec.push(v);
                }

                let db_result = QueryExecutionPipeline::run_query(
                    &db_alias,
                    &sql,
                    params_vec,
                    &auth,
                    &db_cfg
                ).await?;

                results.insert(alias, json!({
                    "columns": db_result.columns,
                    "rows": db_result.rows,
                    "affectedRows": db_result.affected_rows
                }));
            }
            ASTOperation::QueryTable { db_alias, table, columns, alias, limit, offset, .. } => {
                let db_cfg = get_db_config(&db_alias, &auth).await?;

                let cols = if columns.is_empty() {
                    "*".to_string()
                } else {
                    columns.join(", ")
                };

                let sql = format!("SELECT {} FROM {} LIMIT {} OFFSET {}", cols, table, limit, offset);

                let db_result = QueryExecutionPipeline::run_query(
                    &db_alias,
                    &sql,
                    vec![],
                    &auth,
                    &db_cfg
                ).await?;

                results.insert(alias, json!(db_result.rows.unwrap_or_default()));
            }
            ASTOperation::ListDatabases { alias } => {
                let mut active_dbs = Vec::new();
                for (name, db_cfg) in &config.database {
                    if auth.db_scope.iter().any(|s| s == "*" || s == name) {
                        active_dbs.push(json!({
                            "alias": name,
                            "engine": db_cfg.engine,
                            "mode": db_cfg.mode
                        }));
                    }
                }
                results.insert(alias, json!(active_dbs));
            }
        }
    }

    Ok(Json(json!({
        "data": results,
        "extensions": {
            "duration_ms": 0.0 // Stubbed
        }
    })))
}

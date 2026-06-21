use axum::{
    extract::{Extension, Json},
    routing::post,
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::api::database::handlers::{get_db_config, QueryExecutionPipeline};
use crate::api::errors::AxiomError;
use crate::api::graphql::compiler::{ASTCompiler, ASTOperation};
use crate::config::loader::ConfigManager;
use crate::utils::types::AuthContext;

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

    if !auth.full_admin
        && !auth
            .feature_scope
            .iter()
            .any(|s| s == "*" || s == "graphql")
    {
        return Err(AxiomError::new(
            "AUTH_FEATURE_DENIED",
            "GraphQL feature is not enabled for this key",
            axum::http::StatusCode::FORBIDDEN,
        ));
    }

    let compiler = ASTCompiler::new(config.graphql.max_query_depth);
    let operations = compiler.compile(&payload.query).map_err(|e| {
        AxiomError::new(
            "GRAPHQL_COMPILE_ERROR",
            &e,
            axum::http::StatusCode::BAD_REQUEST,
        )
    })?;

    let mut results = serde_json::Map::new();

    for op in operations {
        match op {
            ASTOperation::ExecuteSql {
                db_alias,
                sql,
                params,
                alias,
            } => {
                let db_cfg = get_db_config(&db_alias, &auth).await?;
                let mut params_vec = Vec::new();
                for (_, v) in params {
                    params_vec.push(v);
                }

                let (db_result, _) =
                    QueryExecutionPipeline::run_query(&db_alias, &sql, params_vec, &auth, &db_cfg)
                        .await?;

                results.insert(
                    alias,
                    json!({
                        "columns": db_result.columns,
                        "rows": db_result.rows,
                        "affectedRows": db_result.affected_rows
                    }),
                );
            }
            ASTOperation::QueryTable {
                db_alias,
                table,
                columns,
                alias,
                limit,
                cursor,
                sort,
                order,
                ..
            } => {
                let db_cfg = get_db_config(&db_alias, &auth).await?;

                let is_valid_ident = |s: &str| -> bool {
                    let mut chars = s.chars();
                    if let Some(first) = chars.next() {
                        if !first.is_ascii_alphabetic() && first != '_' {
                            return false;
                        }
                    } else {
                        return false;
                    }
                    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
                };

                let order_lower = order.to_lowercase();
                if order_lower != "asc" && order_lower != "desc" {
                    return Err(AxiomError::new(
                        "INVALID_ORDER",
                        "order must be asc or desc",
                        axum::http::StatusCode::BAD_REQUEST,
                    ));
                }

                if !is_valid_ident(&sort) {
                    return Err(AxiomError::new(
                        "INVALID_SORT",
                        "invalid sort column",
                        axum::http::StatusCode::BAD_REQUEST,
                    ));
                }

                if !is_valid_ident(&table) {
                    return Err(AxiomError::new(
                        "INVALID_TABLE",
                        "invalid table name",
                        axum::http::StatusCode::BAD_REQUEST,
                    ));
                }

                for col in &columns {
                    if !is_valid_ident(col) {
                        return Err(AxiomError::new(
                            "INVALID_COLUMN",
                            "invalid column name",
                            axum::http::StatusCode::BAD_REQUEST,
                        ));
                    }
                }

                let cols = if columns.is_empty() {
                    "*".to_string()
                } else {
                    columns.join(", ")
                };

                let mut params_vec = Vec::new();
                let mut where_clause = String::new();
                if let Some(c) = cursor {
                    let op = if order_lower == "desc" { "<" } else { ">" };
                    params_vec.push(serde_json::json!(c));
                    where_clause = format!("WHERE {} {} ?", sort, op);
                }

                params_vec.push(serde_json::json!(limit));
                let sql = format!(
                    "SELECT {} FROM {} {} ORDER BY {} {} LIMIT ?",
                    cols, table, where_clause, sort, order_lower
                );

                let (db_result, _) =
                    QueryExecutionPipeline::run_query(&db_alias, &sql, params_vec, &auth, &db_cfg)
                        .await?;

                results.insert(alias, json!(db_result.rows.as_ref().unwrap_or(&vec![])));
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

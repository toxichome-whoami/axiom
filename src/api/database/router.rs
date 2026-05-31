use axum::{
    extract::{Path, Extension},
    routing::{get, post},
    Router, Json,
};
use serde_json::Value;

use crate::api::errors::AxiomError;
use crate::api::database::schemas::QueryRequest;
use crate::api::database::handlers::{QueryExecutionPipeline, get_db_config};
use crate::utils::types::AuthContext;
use crate::config::loader::ConfigManager;

pub fn get_router() -> Router {
    Router::new()
        .route("/databases", get(list_databases))
        .route("/:db_name/query", post(execute_query))
        .route("/:db_name/:table_name/rows", post(crate::api::database::handlers::insert_rows))
}

async fn list_databases(
    Extension(auth): Extension<AuthContext>
) -> Result<Json<Value>, AxiomError> {
    let config = ConfigManager::get();
    let mut active_dbs = Vec::new();

    for (name, db_cfg) in &config.database {
        if !auth.db_scope.iter().any(|s| s == "*" || s == name) {
            continue;
        }

        active_dbs.push(serde_json::json!({
            "name": name,
            "engine": db_cfg.engine,
            "mode": db_cfg.mode,
            "status": "connected", // Stubbed
            "tables_count": 0,     // Stubbed
            "federated": false
        }));
    }

    Ok(Json(serde_json::json!({ "databases": active_dbs })))
}

async fn execute_query(
    Path(db_name): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<QueryRequest>,
) -> Result<Json<Value>, AxiomError> {
    let db_cfg = get_db_config(&db_name, &auth).await?;

    // In Rust, parameters are typically array based for positional arguments
    // In Python they were dict based. For simplicity, we convert dict to array.
    let mut params_array = Vec::new();
    if let Some(map) = payload.params {
        // Warning: This ignores parameter ordering.
        // A true implementation maps named to positional via parsing.
        for (_, v) in map {
            params_array.push(v);
        }
    }

    let result = QueryExecutionPipeline::run_query(
        &db_name,
        &payload.sql,
        params_array,
        &auth,
        &db_cfg
    ).await?;

    Ok(Json(serde_json::json!({
        "columns": result.columns,
        "rows": result.rows,
        "affected_rows": result.affected_rows
    })))
}

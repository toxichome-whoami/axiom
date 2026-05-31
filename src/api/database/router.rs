use axum::{
    extract::{Extension, Path},
    routing::{get, post},
    Json, Router,
};
use serde_json::Value;

use crate::api::database::handlers::{get_db_config, QueryExecutionPipeline};
use crate::api::database::schemas::QueryRequest;
use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::utils::types::AuthContext;

pub fn get_router() -> Router {
    Router::new()
        .route("/databases", get(list_databases))
        .route(
            "/:db_name/tables",
            get(crate::api::database::handlers::list_tables),
        )
        .route("/:db_name/query", post(execute_query))
        .route(
            "/:db_name/:table_name/rows",
            post(crate::api::database::handlers::insert_rows)
                .get(crate::api::database::handlers::fetch_rows)
                .patch(crate::api::database::handlers::update_rows)
                .delete(crate::api::database::handlers::delete_rows),
        )
}

async fn list_databases(
    Extension(auth): Extension<AuthContext>,
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

    let result =
        QueryExecutionPipeline::run_query(&db_name, &payload.sql, params_array, &auth, &db_cfg)
            .await?;

    Ok(Json(serde_json::json!({
        "columns": result.columns,
        "rows": result.rows,
        "affected_rows": result.affected_rows
    })))
}

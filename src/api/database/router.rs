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
        .route(
            "/:db_name/:table_name/schema",
            get(crate::api::database::handlers::describe_table),
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

        let mut status = "down";
        let mut tables_count_str = "0".to_string();
        if let Some(engine) = crate::db::pool::DatabasePoolManager::get_engine(name).await {
            if engine.health_check().await {
                status = "connected";
                // Use a strict limit of 100 to prevent heavy schema scanning on the DB
                if let Ok(tables) = engine.list_tables(None, 100).await {
                    if tables.len() >= 100 {
                        tables_count_str = "99+".to_string();
                    } else {
                        tables_count_str = tables.len().to_string();
                    }
                }
            }
        }

        active_dbs.push(serde_json::json!({
            "name": name,
            "engine": db_cfg.engine,
            "mode": db_cfg.mode,
            "status": status,
            "tables_count": tables_count_str
        }));
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "databases": active_dbs
    })))
}

async fn execute_query(
    Path(db_name): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<QueryRequest>,
) -> Result<axum::response::Response, AxiomError> {
    let db_cfg = get_db_config(&db_name, &auth).await?;

    // In Rust, parameters are typically array based for positional arguments
    // In Python they were dict based. For simplicity, we convert dict to array.
    let mut params_array = Vec::new();
    if let Some(map) = payload.params {
        // Sort keys to ensure deterministic ordering
        // The SDKs typically send "1", "2", "3" as keys for positional args
        let mut keys: Vec<_> = map.keys().collect();
        keys.sort_by(|a, b| {
            match (a.parse::<i32>(), b.parse::<i32>()) {
                (Ok(n1), Ok(n2)) => n1.cmp(&n2),
                _ => a.cmp(b),
            }
        });
        
        for k in keys {
            params_array.push(map.get(k).unwrap().clone());
        }
    }

    let timeout_duration = std::time::Duration::from_secs(payload.timeout.unwrap_or(30) as u64);
    let (_arc_result, json_bytes) = match tokio::time::timeout(
        timeout_duration,
        QueryExecutionPipeline::run_query(&db_name, &payload.sql, params_array, &auth, &db_cfg)
    ).await {
        Ok(result) => result?,
        Err(_) => {
            return Err(AxiomError::new("QUERY_TIMEOUT", "Query execution timed out", axum::http::StatusCode::GATEWAY_TIMEOUT));
        }
    };

    axum::response::Response::builder()
        .header("content-type", "application/json")
        .body(axum::body::Body::from(json_bytes))
        .map_err(|e| {
            tracing::error!("Response build failed: {}", e);
            AxiomError::new("INTERNAL_ERROR", "Failed to build response", axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        })
}

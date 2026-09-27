use axum::{
    extract::{Extension, Path},
    routing::{get, post},
    Json, Router,
};
use serde_json::Value;

use crate::database::handlers::{get_db_config, QueryExecutionPipeline};
use crate::database::schemas::QueryRequest;
use axiom_core::AxiomError;
use axiom_core::ConfigManager;
use axiom_core::AuthContext;

pub fn get_router() -> Router {
    Router::new()
        .route("/databases", get(list_databases))
        .route(
            "/:db_name/tables",
            get(crate::database::handlers::list_tables),
        )
        .route(
            "/:db_name/:table_name/schema",
            get(crate::database::handlers::describe_table),
        )
        .route("/:db_name/query", post(execute_query))
        .route(
            "/:db_name/:table_name/rows",
            post(crate::database::handlers::insert_rows)
                .get(crate::database::handlers::fetch_rows)
                .patch(crate::database::handlers::update_rows)
                .delete(crate::database::handlers::delete_rows),
        )
}

use axiom_policy::PolicyEngine;

async fn list_databases(
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Value>, AxiomError> {
    let config = ConfigManager::get();
    let snapshot = axiom_metadata::snapshot::get_snapshot();

    // Aggregate unique database aliases from static config and dynamic metadata snapshot
    let mut all_aliases = std::collections::HashSet::new();
    for name in config.database.keys() {
        all_aliases.insert(name.clone());
    }
    for name in snapshot.databases.keys() {
        all_aliases.insert(name.clone());
    }

    let mut sorted_aliases: Vec<String> = all_aliases.into_iter().collect();
    sorted_aliases.sort();

    // Filter by user role permissions
    let authorized_dbs = PolicyEngine::filter_databases(&auth, &sorted_aliases);
    let mut active_dbs = Vec::new();

    for name in &authorized_dbs {
        let (engine_str, mode_str) = if let Some(db_cfg) = config.database.get(name) {
            (format!("{:?}", db_cfg.engine).to_lowercase(), format!("{:?}", db_cfg.mode).to_lowercase())
        } else if let Some(snap_db) = snapshot.databases.get(name) {
            (snap_db.engine.clone(), "readwrite".to_string())
        } else {
            continue;
        };

        let mut status = "down";
        let mut tables_count_str = "0".to_string();
        if let Some(engine) = axiom_db::DatabasePoolManager::get_engine(name).await {
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
            "engine": engine_str,
            "mode": mode_str,
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
    headers: axum::http::HeaderMap,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<QueryRequest>,
) -> Result<axum::response::Response, AxiomError> {
    
    static IDEMPOTENCY_CACHE: once_cell::sync::Lazy<dashmap::DashMap<String, bytes::Bytes>> = once_cell::sync::Lazy::new(dashmap::DashMap::new);
    let idempotency_key = headers.get("Idempotency-Key").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    
    if let Some(ref key) = idempotency_key {
        if let Some(cached_response) = IDEMPOTENCY_CACHE.get(key) {
            return axum::response::Response::builder()
                .header("content-type", "application/json")
                .header("x-idempotency-hit", "true")
                .body(axum::body::Body::from(cached_response.clone()))
                .map_err(|e| {
                    tracing::error!("Response build failed: {}", e);
                    AxiomError::new("INTERNAL_ERROR", "Failed to build response", axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                });
        }
    }
    let db_cfg = get_db_config(&db_name, &auth).await?;

    // Named params arrive as a JSON object {"1": val, "2": val}.
    // Sort numerically so positional binding order is always deterministic.
    let mut params_array = Vec::new();
    if let Some(map) = payload.params {
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

    if let Some(key) = idempotency_key {
        IDEMPOTENCY_CACHE.insert(key, json_bytes.clone());
    }

    axum::response::Response::builder()
        .header("content-type", "application/json")
        .body(axum::body::Body::from(json_bytes))
        .map_err(|e| {
            tracing::error!("Response build failed: {}", e);
            AxiomError::new("INTERNAL_ERROR", "Failed to build response", axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        })
}

/*
 * Database route dispatcher for Data API v1 endpoints.
 * Owned by: crates/api (database)
 * Key deps: axum, axiom_core, axiom_policy, axiom_db
 * Invariants: Endpoints require valid AuthContext extension injected by authentication middleware.
 * Last structural change: Standardized response envelope and cursor pagination (v4.0).
 */

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

/// Builds and returns the Axum router for the `/api/v1/db` endpoint subtree.
/// CONTRACT:
///  - Returns `axum::Router` configured with routes for databases, tables, schemas, queries, and CRUD rows.
///  - Idempotent: Yes.
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

/// Lists all configured and active databases authorized for the caller's role.
/// CONTRACT:
///  - Precondition: Caller holds valid AuthContext.
///  - Returns list of database telemetry objects (name, engine, mode, status, tables_count).
///  - Side effects: Performs lightweight health check probe per alias.
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

    // Parallelize connectivity probes across authorized databases for minimum latency
    let check_futures = authorized_dbs.into_iter().map(|name| {
        let config = config.clone();
        let snapshot = snapshot.clone();
        async move {
            let (engine_str, mode_str) = if let Some(db_cfg) = config.database.get(&name) {
                (format!("{:?}", db_cfg.engine).to_lowercase(), format!("{:?}", db_cfg.mode).to_lowercase())
            } else if let Some(snap_db) = snapshot.databases.get(&name) {
                (snap_db.engine.clone(), "readwrite".to_string())
            } else {
                return None;
            };

            let mut status = "down";
            let mut tables_count_str = "0".to_string();
            if let Some(engine) = axiom_db::DatabasePoolManager::get_engine(&name).await {
                if engine.health_check().await {
                    status = "connected";
                    if let Ok(count) = engine.count_tables().await {
                        tables_count_str = count.to_string();
                    }
                }
            }

            Some(serde_json::json!({
                "name": name,
                "engine": engine_str,
                "mode": mode_str,
                "status": status,
                "tables_count": tables_count_str
            }))
        }
    });

    let results = futures::future::join_all(check_futures).await;
    let active_dbs: Vec<Value> = results.into_iter().flatten().collect();

    Ok(Json(serde_json::json!({
        "success": true,
        "data": active_dbs,
        "error": serde_json::Value::Null
    })))
}

/// Executes a raw SQL query against a configured database engine with AST validation and timeouts.
/// CONTRACT:
///  - Precondition: Valid AuthContext with database permissions; non-empty SQL string in payload.
///  - Supports `Idempotency-Key` header for deduplicated safe retries on mutation/query replays.
///  - Returns HTTP Response with tabular rows, columns, affected_rows, and next_cursor.
async fn execute_query(
    Path(db_name): Path<String>,
    headers: axum::http::HeaderMap,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<QueryRequest>,
) -> Result<axum::response::Response, AxiomError> {
    let idempotency_key = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| format!("idemp:{}", s));
    
    if let Some(ref key) = idempotency_key {
        if let Some(cached_response) = axiom_cache::CacheEngine::get(key).await {
            return axum::response::Response::builder()
                .header("content-type", "application/json")
                .header("x-idempotency-hit", "true")
                .body(axum::body::Body::from(cached_response))
                .map_err(|e| {
                    tracing::error!("Response build failed: {}", e);
                    AxiomError::new("INTERNAL_ERROR", "Failed to build response", axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                });
        }
    }
    let db_cfg = get_db_config(&db_name, &auth).await?;

    // Params can arrive as a JSON array [val1, val2] or object {"1": val1, "2": val2}.
    let mut params_array = Vec::new();
    if let Some(p) = payload.params {
        match p {
            serde_json::Value::Array(arr) => {
                params_array = arr;
            }
            serde_json::Value::Object(mut map) => {
                let mut keys: Vec<String> = map.keys().cloned().collect();
                keys.sort_by(|a, b| {
                    match (a.parse::<i32>(), b.parse::<i32>()) {
                        (Ok(n1), Ok(n2)) => n1.cmp(&n2),
                        _ => a.cmp(b),
                    }
                });
                for k in keys {
                    if let Some(val) = map.remove(&k) {
                        params_array.push(val);
                    }
                }
            }
            _ => {}
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
        axiom_cache::CacheEngine::set(
            &key,
            json_bytes.clone(),
            86400,
            axiom_cache::Durability::Journaled,
        )
        .await;
    }

    axum::response::Response::builder()
        .header("content-type", "application/json")
        .body(axum::body::Body::from(json_bytes))
        .map_err(|e| {
            tracing::error!("Response build failed: {}", e);
            AxiomError::new("INTERNAL_ERROR", "Failed to build response", axum::http::StatusCode::INTERNAL_SERVER_ERROR)
        })
}

/*
 * Database route dispatcher for Data API v1 endpoints.
 * Owned by: crates/api (database)
 * Key deps: axum, axiom_core, axiom_policy, axiom_db
 * Invariants: Endpoints require valid AuthContext extension injected by authentication middleware.
 * Last structural change: Standardized response envelope and cursor pagination (v4.0).
 */

use axum::{
    extract::{Extension, Path},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::Value;

use crate::database::handlers::{get_db_config, QueryExecutionPipeline};
use crate::database::schemas::QueryRequest;
use axiom_core::AuthContext;
use axiom_core::AxiomError;
use axiom_core::ConfigManager;

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
        .route("/:db_name/query", post(execute_query))
        .route(
            "/:db_name/:table_name/rows",
            post(crate::database::handlers::insert_rows)
                .get(crate::database::handlers::fetch_rows)
                .patch(crate::database::handlers::update_rows)
                .delete(crate::database::handlers::delete_rows),
        )
        .route(
            "/:db_name/:table_name/columns",
            get(crate::database::handlers::describe_table)
                .post(crate::database::handlers::add_column),
        )
        .route(
            "/:db_name/:table_name/columns/:column_name",
            delete(crate::database::handlers::drop_column)
                .patch(crate::database::handlers::modify_column),
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
    let snapshot = axiom_metadata::snapshot::get_snapshot();

    let mut sorted_aliases: Vec<String> = snapshot.databases.keys().cloned().collect();
    sorted_aliases.sort();

    // Filter by user role permissions
    let authorized_dbs = PolicyEngine::filter_databases(&auth, &sorted_aliases);

    // Parallelize connectivity probes across authorized databases for minimum latency
    let check_futures = authorized_dbs.into_iter().map(|name| {
        let snapshot = snapshot.clone();
        async move {
            let snap_db = snapshot.databases.get(&name)?;
            let engine_str = snap_db.engine.clone();
            let mode_str = "readwrite".to_string();

            let cache_key = format!("meta:db_status:{}", name);
            if let Some(cached_bytes) = axiom_cache::CacheEngine::get(&cache_key).await {
                if let Ok(cached_val) = serde_json::from_slice::<Value>(&cached_bytes) {
                    return Some(cached_val);
                }
            }

            let mut status = "down";
            let mut tables_count_str = "0".to_string();
            let probe_res = tokio::time::timeout(
                std::time::Duration::from_millis(500),
                axiom_db::DatabasePoolManager::get_engine(&name),
            )
            .await;
            if let Ok(Some(engine)) = probe_res {
                let hc_res = tokio::time::timeout(
                    std::time::Duration::from_millis(500),
                    engine.health_check(),
                )
                .await;
                if let Ok(true) = hc_res {
                    status = "connected";
                    if let Ok(count) = engine.count_tables().await {
                        tables_count_str = count.to_string();
                    }
                }
            }

            let res_json = serde_json::json!({
                "name": name,
                "engine": engine_str,
                "mode": mode_str,
                "status": status,
                "tables_count": tables_count_str
            });

            if let Ok(serialized) = serde_json::to_vec(&res_json) {
                axiom_cache::CacheEngine::set(
                    &cache_key,
                    serialized.into(),
                    15,
                    axiom_cache::Durability::MemoryOnly,
                )
                .await;
            }

            Some(res_json)
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

#[derive(serde::Serialize, serde::Deserialize)]
struct IdempotentEntry {
    fingerprint: String,
    body: String,
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
    // Params can arrive as a JSON array [val1, val2] or object {"1": val1, "2": val2}.
    let mut params_array = Vec::new();
    if let Some(p) = payload.params {
        match p {
            serde_json::Value::Array(arr) => {
                params_array = arr;
            }
            serde_json::Value::Object(mut map) => {
                let mut keys: Vec<String> = map.keys().cloned().collect();
                keys.sort_by(|a, b| match (a.parse::<i32>(), b.parse::<i32>()) {
                    (Ok(n1), Ok(n2)) => n1.cmp(&n2),
                    _ => a.cmp(b),
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

    // SECURITY (H-4d): compute cryptographic payload fingerprint to bind Idempotency-Key
    // strictly to the database, SQL text, and bound parameters.
    let payload_fingerprint = {
        let mut hasher = blake3::Hasher::new();
        hasher.update(db_name.as_bytes());
        hasher.update(payload.sql.as_bytes());
        if let Ok(p_str) = serde_json::to_string(&params_array) {
            hasher.update(p_str.as_bytes());
        }
        hasher.finalize().to_hex().to_string()
    };

    let idempotency_key = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| format!("idemp:{}:{}", auth.api_key_name, s));

    if let Some(ref key) = idempotency_key {
        if let Some(cached_response) = axiom_cache::CacheEngine::get(key).await {
            // Validate that the request matches the original cached fingerprint
            if let Ok(entry) = serde_json::from_slice::<IdempotentEntry>(&cached_response) {
                if entry.fingerprint != payload_fingerprint {
                    return Err(AxiomError::new(
                        "IDEMPOTENCY_CONFLICT",
                        "This Idempotency-Key was previously used with a different SQL query or parameters",
                        axum::http::StatusCode::CONFLICT,
                    ));
                }
                return axum::response::Response::builder()
                    .header("content-type", "application/json")
                    .header("x-idempotency-hit", "true")
                    .body(axum::body::Body::from(entry.body))
                    .map_err(|e| {
                        tracing::error!("Response build failed: {}", e);
                        AxiomError::new(
                            "INTERNAL_ERROR",
                            "Failed to build response",
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        )
                    });
            } else {
                // Legacy cache entry fallback
                return axum::response::Response::builder()
                    .header("content-type", "application/json")
                    .header("x-idempotency-hit", "true")
                    .body(axum::body::Body::from(cached_response))
                    .map_err(|e| {
                        tracing::error!("Response build failed: {}", e);
                        AxiomError::new(
                            "INTERNAL_ERROR",
                            "Failed to build response",
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        )
                    });
            }
        }
    }
    let db_cfg = get_db_config(&db_name, &auth).await?;

    let timeout_duration =
        std::time::Duration::from_secs(payload.timeout.unwrap_or(30).clamp(1, 300) as u64);
    let (_arc_result, json_bytes) = match tokio::time::timeout(
        timeout_duration,
        QueryExecutionPipeline::run_query(&db_name, &payload.sql, params_array, &auth, &db_cfg),
    )
    .await
    {
        Ok(result) => result?,
        Err(_) => {
            return Err(AxiomError::new(
                "QUERY_TIMEOUT",
                "Query execution timed out",
                axum::http::StatusCode::GATEWAY_TIMEOUT,
            ));
        }
    };

    if let Some(key) = idempotency_key {
        let config = ConfigManager::get();
        let idemp_ttl = if config.cache.idempotency_ttl > 0 {
            config.cache.idempotency_ttl as u64
        } else {
            86400
        };
        let body_str = String::from_utf8_lossy(&json_bytes).to_string();
        let entry = IdempotentEntry {
            fingerprint: payload_fingerprint,
            body: body_str,
        };
        if let Ok(entry_bytes) = serde_json::to_vec(&entry) {
            axiom_cache::CacheEngine::set(
                &key,
                entry_bytes.into(),
                idemp_ttl,
                axiom_cache::Durability::Journaled,
            )
            .await;
        }
    }

    let is_ndjson = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.contains("ndjson"))
        .unwrap_or(false);

    if is_ndjson {
        let rows = _arc_result.rows.clone().unwrap_or_default();
        let stream = crate::database::streaming::stream_ndjson_rows(rows);
        return axum::response::Response::builder()
            .header("content-type", "application/x-ndjson")
            .body(axum::body::Body::from_stream(stream))
            .map_err(|e| {
                tracing::error!("Response build failed: {}", e);
                AxiomError::new(
                    "INTERNAL_ERROR",
                    "Failed to build response",
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                )
            });
    }

    axum::response::Response::builder()
        .header("content-type", "application/json")
        .body(axum::body::Body::from(json_bytes))
        .map_err(|e| {
            tracing::error!("Response build failed: {}", e);
            AxiomError::new(
                "INTERNAL_ERROR",
                "Failed to build response",
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idempotent_entry_fingerprint_matching() {
        let entry = IdempotentEntry {
            fingerprint: "abc123hash".to_string(),
            body: r#"{"success":true,"rows":[]}"#.to_string(),
        };
        let bytes = serde_json::to_vec(&entry).unwrap();
        let decoded: IdempotentEntry = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.fingerprint, "abc123hash");
        assert_ne!(decoded.fingerprint, "different_hash");
        assert_eq!(decoded.body, r#"{"success":true,"rows":[]}"#);
    }
}

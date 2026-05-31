use axum::{routing::get, Json, Router};
use once_cell::sync::Lazy;
use serde_json::{json, Value};

use crate::config::loader::ConfigManager;
use crate::db::pool::DatabasePoolManager;

static START_TIME: Lazy<std::time::Instant> = Lazy::new(std::time::Instant::now);
const VERSION: &str = "1.0.5";

pub fn get_router() -> Router {
    Router::new()
        .route("/", get(root))
        .route("/ready", get(ready))
        .route("/health", get(health))
}

async fn root() -> Json<Value> {
    Json(json!({
        "name": "Axiom",
        "version": VERSION,
        "status": "online"
    }))
}

async fn ready() -> Json<Value> {
    Json(json!({"ready": true}))
}

async fn health() -> Json<Value> {
    let config = ConfigManager::get();

    let mut db_status = serde_json::Map::new();
    let mut all_dbs_up = true;

    for (alias, _) in &config.database {
        if let Some(engine) = DatabasePoolManager::get_engine(alias).await {
            let is_up = engine.lock().await.health_check().await;
            db_status.insert(alias.clone(), json!(if is_up { "up" } else { "down" }));
            if !is_up {
                all_dbs_up = false;
            }
        } else {
            db_status.insert(alias.clone(), json!("down"));
            all_dbs_up = false;
        }
    }

    let cache_status = json!({
        "enabled": config.cache.enabled,
        "backend": config.cache.backend,
        "status": "up" // Stubbed
    });

    // Storage is stubbed since we don't have the scanner here yet
    let mut storage_status = serde_json::Map::new();
    for (alias, _) in &config.storage {
        storage_status.insert(
            alias.clone(),
            json!({
                "status": "up",
                "free_space_bytes": 0
            }),
        );
    }

    Json(json!({
        "status": if all_dbs_up { "healthy" } else { "degraded" },
        "checks": {
            "server": { "status": "up" },
            "databases": db_status,
            "storages": storage_status,
            "cache": cache_status,
            "federation": {}
        },
        "system": {
            "memory_used_mb": 0,
            "cpu_percent": 0.0,
            "uptime_seconds": START_TIME.elapsed().as_secs()
        }
    }))
}

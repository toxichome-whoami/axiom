use axum::{routing::get, Json, Router};
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::sync::Mutex;
use sysinfo::System;

use crate::config::loader::ConfigManager;
use crate::db::pool::DatabasePoolManager;

static START_TIME: Lazy<std::time::Instant> = Lazy::new(std::time::Instant::now);
static SYSTEM: Lazy<Mutex<System>> = Lazy::new(|| {
    let mut sys = System::new_all();
    sys.refresh_all();
    Mutex::new(sys)
});

pub fn get_system_stats() -> (f32, u64) {
    if let Ok(mut sys) = SYSTEM.lock() {
        let pid = sysinfo::Pid::from_u32(std::process::id());
        // Refresh process stats to get actual server footprint
        sys.refresh_all();
        if let Some(process) = sys.process(pid) {
            (process.cpu_usage(), process.memory() / 1024 / 1024)
        } else {
            (0.0, 0)
        }
    } else {
        (0.0, 0)
    }
}

pub fn get_uptime() -> f64 {
    START_TIME.elapsed().as_secs_f64()
}

const VERSION: &str = "1.0.5";

use crate::middleware::auth::auth_middleware;
use axum::middleware;

pub fn get_router() -> Router {
    Router::new()
        .route("/", get(root))
        .route("/ready", get(ready))
        .nest(
            "/health",
            Router::new()
                .route("/", get(health))
                .layer(middleware::from_fn(auth_middleware)),
        )
}

pub fn init_health_timer() {
    let _ = *START_TIME;
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

async fn health(
    axum::extract::Extension(_ctx): axum::extract::Extension<crate::utils::types::AuthContext>,
) -> Result<Json<Value>, crate::api::errors::AxiomError> {
    let config = ConfigManager::get();

    let mut db_status = serde_json::Map::new();
    let mut all_dbs_up = true;

    for (alias, _) in &config.database {
        if let Some(engine) = DatabasePoolManager::get_engine(alias).await {
            let is_up = engine.health_check().await;
            db_status.insert(alias.clone(), json!(if is_up { "up" } else { "down" }));
            if !is_up {
                all_dbs_up = false;
            }
        } else {
            db_status.insert(alias.clone(), json!("down"));
            all_dbs_up = false;
        }
    }

    let (cpu_percent, memory_used_mb) = get_system_stats();

    Ok(Json(json!({
        "status": if all_dbs_up { "healthy" } else { "degraded" },
        "checks": {
            "server": {
                "status": "up",
                "host": &config.server.host,
                "port": config.server.port,
                "max_connections": config.server.max_connections
            },
            "databases": db_status
        },
        "system": {
            "memory_used_mb": memory_used_mb,
            "cpu_percent": cpu_percent,
            "uptime_seconds": START_TIME.elapsed().as_secs()
        }
    })))
}

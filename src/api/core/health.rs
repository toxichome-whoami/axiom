use axum::{routing::get, Json, Router};
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::sync::Mutex;
use sysinfo::{Disks, System};

use crate::config::loader::ConfigManager;
use crate::db::pool::DatabasePoolManager;
use crate::utils::size_parser::parse_size;

static START_TIME: Lazy<std::time::Instant> = Lazy::new(std::time::Instant::now);
static SYSTEM: Lazy<Mutex<System>> = Lazy::new(|| {
    let mut sys = System::new_all();
    sys.refresh_all();
    Mutex::new(sys)
});

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

#[utoipa::path(
    get,
    path = "/",
    responses(
        (status = 200, description = "Root server info")
    )
)]
async fn root() -> Json<Value> {
    Json(json!({
        "name": "Axiom",
        "version": VERSION,
        "status": "online"
    }))
}

#[utoipa::path(
    get,
    path = "/ready",
    responses(
        (status = 200, description = "Server readiness check")
    )
)]
async fn ready() -> Json<Value> {
    Json(json!({"ready": true}))
}

#[utoipa::path(
    get,
    path = "/health",
    security(
        ("api_key" = [])
    ),
    responses(
        (status = 200, description = "Detailed hardware and subsystem health check"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn health(
    axum::extract::Extension(ctx): axum::extract::Extension<crate::utils::types::AuthContext>,
) -> Result<Json<Value>, crate::api::errors::AxiomError> {
    if ctx.api_key_name == "anonymous" {
        return Err(crate::api::errors::AxiomError::new(
            "UNAUTHORIZED",
            "Missing or invalid API key.",
            axum::http::StatusCode::UNAUTHORIZED,
        ));
    }

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

    let cache_status = json!({
        "enabled": config.cache.enabled,
        "backend": config.cache.backend,
        "status": "up" // Stubbed
    });

    let disks = Disks::new_with_refreshed_list();
    let mut storage_status = serde_json::Map::new();

    let current_dir = std::env::current_dir().unwrap_or_default();

    for (alias, cfg) in &config.storage {
        let path = current_dir.join(&cfg.path);
        let path_str = path.to_string_lossy().to_lowercase().replace("\\\\?\\", "");

        let mut best_match = None;
        let mut max_len = 0;

        for disk in disks.list() {
            let mp = disk.mount_point().to_string_lossy().to_lowercase();
            if path_str.starts_with(&mp) {
                let mp_len = mp.len();
                if mp_len > max_len {
                    max_len = mp_len;
                    best_match = Some(disk);
                }
            }
        }

        let hw_free = best_match.map(|d| d.available_space()).unwrap_or(0);
        let allocated_bytes = parse_size(&cfg.limit).unwrap_or(u64::MAX);

        let free_space = hw_free.min(allocated_bytes);

        storage_status.insert(
            alias.clone(),
            json!({
                "status": "up",
                "free_space_bytes": free_space
            }),
        );
    }

    let (cpu_percent, memory_used_mb) = {
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
    };

    Ok(Json(json!({
        "status": if all_dbs_up { "healthy" } else { "degraded" },
        "checks": {
            "server": {
                "status": "up",
                "host": &config.server.host,
                "port": config.server.port,
                "max_connections": config.server.max_connections
            },
            "databases": db_status,
            "storages": storage_status,
            "cache": cache_status,
            "federation": {}
        },
        "system": {
            "memory_used_mb": memory_used_mb,
            "cpu_percent": cpu_percent,
            "uptime_seconds": START_TIME.elapsed().as_secs()
        }
    })))
}

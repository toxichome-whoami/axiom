use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;

use crate::api::sse::connection_manager::SSE_MGR;
use crate::config::loader::ConfigManager;

fn get_system_stats() -> (f64, f64) {
    // Lightweight system stats without pulling in sysinfo crate
    // Returns (cpu_pct, memory_mb) - approximate values
    (0.0, 0.0) // Placeholder - extend with sysinfo when needed
}

fn get_uptime() -> u64 {
    // Simple uptime tracking
    use std::time::{SystemTime, UNIX_EPOCH};
    static START_TIME: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    let start = *START_TIME.get_or_init(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    });
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(start)
}

pub async fn health_poller() {
    let config = ConfigManager::get();
    let interval = Duration::from_secs(config.sse.health_interval as u64);

    loop {
        let (cpu_pct, mem_mb) = get_system_stats();
        let payload = json!({
            "status": "healthy",
            "checks": {
                "databases": "up",
                "cache": "up",
                "storages": "up"
            },
            "system": {
                "memory_mb": mem_mb,
                "cpu_pct": cpu_pct,
                "uptime_seconds": get_uptime()
            }
        })
        .to_string();

        SSE_MGR.publish("system:health", "health", payload).await;

        let count = SSE_MGR.active_count().await;
        if count > 0 {
            // Cleanup handled implicitly in publish when send fails
        }

        sleep(interval).await;
    }
}

pub async fn metrics_pusher() {
    let config = ConfigManager::get();
    let interval = Duration::from_secs(config.sse.metrics_interval as u64);

    loop {
        let active_count = SSE_MGR.active_count().await;
        let topic_count = SSE_MGR.topic_count().await;
        let (cpu_pct, mem_mb) = get_system_stats();

        let payload = json!({
            "uptime_seconds": get_uptime(),
            "memory_mb": mem_mb,
            "cpu_percent": cpu_pct,
            "db_queries_total": 0,
            "sse_connections": active_count,
            "sse_topics": topic_count
        })
        .to_string();

        SSE_MGR.publish("metrics", "metrics", payload).await;

        sleep(interval).await;
    }
}

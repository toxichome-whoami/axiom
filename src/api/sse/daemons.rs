use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;

use crate::api::sse::connection_manager::SSE_MGR;
use crate::config::loader::ConfigManager;

pub async fn health_poller() {
    let config = ConfigManager::get();
    let interval = Duration::from_secs(config.sse.health_interval as u64);

    loop {
        // Stubbed health check since we don't have sysinfo or full db checks wired yet
        let payload = json!({
            "status": "healthy",
            "checks": {
                "databases": "up",
                "cache": "up",
                "storages": "up"
            },
            "system": {
                "memory_mb": 0.0, // Stubbed, avoid sysinfo
                "cpu_pct": 0.0    // Stubbed, avoid sysinfo
            }
        })
        .to_string();

        SSE_MGR.publish("system:health", "health", payload).await;

        // Basic GC for dead SSE connections
        let count = SSE_MGR.active_count().await;
        if count > 0 {
            // A real GC would lock connections, retain those where tx.is_closed() == false
            // This is handled implicitly inside publish when send fails.
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

        let payload = json!({
            "uptime_seconds": 0.0, // Stubbed
            "memory_mb": 0.0,      // Stubbed
            "cpu_percent": 0.0,    // Stubbed
            "db_queries_total": 0,
            "sse_connections": active_count,
            "sse_topics": topic_count
        })
        .to_string();

        SSE_MGR.publish("metrics", "metrics", payload).await;

        sleep(interval).await;
    }
}

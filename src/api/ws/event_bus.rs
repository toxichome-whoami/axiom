use once_cell::sync::Lazy;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::api::events::schemas::EventPayload;
use crate::api::ws::connection_manager::CONN_MGR;
use crate::config::loader::ConfigManager;

pub struct EventBus {
    redis_client: RwLock<Option<redis::Client>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            redis_client: RwLock::new(None),
        }
    }

    async fn ensure_redis(&self) {
        let mut client_lock = self.redis_client.write().await;
        if client_lock.is_none() {
            let config = ConfigManager::get();
            if config.eda.enabled && config.eda.backend == "redis" {
                let url = &config.eda.redis_url;
                if !url.is_empty() {
                    if let Ok(client) = redis::Client::open(url.as_str()) {
                        *client_lock = Some(client);
                    }
                }
            }
        }
    }

    pub async fn publish(
        &self,
        module: &str,
        resource: &str,
        target: &str,
        action: &str,
        details: serde_json::Value,
        request_id: &str,
    ) {
        let event = EventPayload {
            action: action.to_string(),
            module: module.to_string(),
            resource: resource.to_string(),
            target: target.to_string(),
            details,
            request_id: request_id.to_string(),
        };

        self.ensure_redis().await;

        let config = ConfigManager::get();
        if config.eda.enabled && config.eda.backend == "redis" {
            let client_lock = self.redis_client.read().await;
            if let Some(client) = client_lock.as_ref() {
                if let Ok(mut con) = client.get_multiplexed_async_connection().await {
                    let payload_str = serde_json::to_string(&event).unwrap_or_default();
                    let maxlen = config.eda.max_stream_length as usize;

                    // XADD axiom_events MAXLEN ~ {maxlen} * payload payload_str
                    let _: redis::RedisResult<()> = redis::cmd("XADD")
                        .arg("axiom_events")
                        .arg("MAXLEN")
                        .arg("~")
                        .arg(maxlen)
                        .arg("*")
                        .arg("payload")
                        .arg(payload_str)
                        .query_async(&mut con)
                        .await;
                }
            }
        }

        let specific_topic = format!("{}:{}:{}", module, resource, target);
        let wildcard_topic = format!("{}:{}:*", module, resource);

        let ws_payload = json!({
            "type": "event",
            "topic": specific_topic,
            "data": event
        })
        .to_string();

        // Broadcast locally to WebSocket subscribers
        CONN_MGR
            .broadcast(&specific_topic, ws_payload.clone())
            .await;
        CONN_MGR.broadcast(&wildcard_topic, ws_payload).await;
    }

    pub async fn publish_metrics(&self) {
        let active_ws = CONN_MGR.active_count().await;

        let payload = json!({
            "type": "event",
            "topic": "metrics",
            "data": {
                "ws_connections": active_ws,
                // other stats can go here
            }
        })
        .to_string();

        CONN_MGR.broadcast("metrics", payload).await;
    }
}

pub static EVENT_BUS: Lazy<Arc<EventBus>> = Lazy::new(|| Arc::new(EventBus::new()));

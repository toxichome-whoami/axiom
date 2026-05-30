use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;

fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationNodeState {
    pub status: String,             // "up" | "down" | "degraded" | "unknown"
    pub latency_ms: f64,
    pub last_check: f64,
    pub consecutive_failures: u32,
    pub next_retry_at: f64,
    pub databases: HashMap<String, serde_json::Value>,
    pub storages: HashMap<String, serde_json::Value>,
}

impl Default for FederationNodeState {
    fn default() -> Self {
        Self {
            status: "unknown".to_string(),
            latency_ms: 0.0,
            last_check: 0.0,
            consecutive_failures: 0,
            next_retry_at: 0.0,
            databases: HashMap::new(),
            storages: HashMap::new(),
        }
    }
}

// In-memory node states backed by DashMap for concurrent access
static NODE_STATES: Lazy<DashMap<String, FederationNodeState>> = Lazy::new(DashMap::new);

pub struct FederationStateManager;

impl FederationStateManager {
    pub fn new() -> Self {
        Self
    }

    pub async fn load(&self) {
        // In a full implementation, we'd load from SQLite via sqlx here.
        // For now, an empty in-memory map is sufficient.
        tracing::debug!("FederationStateManager loaded (in-memory)");
    }

    pub async fn persist(&self) {
        // In a full implementation, we'd persist all entries to SQLite here.
        tracing::debug!("FederationStateManager persisted (no-op in stub)");
    }

    pub fn get_state(&self, node_id: &str) -> Option<FederationNodeState> {
        NODE_STATES.get(node_id).map(|v| v.clone())
    }

    pub fn set_state(&self, node_id: &str, state: FederationNodeState) {
        NODE_STATES.insert(node_id.to_string(), state);
    }

    pub fn get_healthy_nodes(&self) -> Vec<String> {
        NODE_STATES.iter()
            .filter(|e| e.value().status == "up")
            .map(|e| e.key().clone())
            .collect()
    }

    pub fn get_next_retry_nodes(&self) -> Vec<String> {
        let now = now_secs();
        NODE_STATES.iter()
            .filter(|e| {
                let state = e.value();
                state.status == "unknown" || state.next_retry_at <= now
            })
            .map(|e| e.key().clone())
            .collect()
    }
}

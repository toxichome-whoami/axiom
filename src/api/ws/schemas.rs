use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPayload {
    pub action: String,
    pub module: String,
    pub resource: String,
    pub target: String,
    #[serde(default)]
    pub details: Value,
    #[serde(default)]
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DLQEvent {
    pub original_event: EventPayload,
    pub error_reason: String,
    pub failed_attempts: u32,
    pub timestamp: f64,
}

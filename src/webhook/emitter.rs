use base64::{engine::general_purpose::STANDARD as b64, Engine as _};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::webhook::persistence::WebhookPersistence;
use crate::webhook::queue::WebhookQueueList;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub struct CompiledRule {
    pub module: String,
    pub operation: String,
    pub alias: String,
    pub targets: Vec<String>,
}

// Thread-safe cache of compiled rules
static COMPILED_RULES: OnceLock<std::sync::RwLock<HashMap<String, CompiledRule>>> = OnceLock::new();

pub fn get_rules_cache() -> &'static std::sync::RwLock<HashMap<String, CompiledRule>> {
    COMPILED_RULES.get_or_init(|| std::sync::RwLock::new(HashMap::new()))
}

pub fn compile_rules() -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn is_token_matched(hook_secret: &str, provided_token: &Option<String>) -> bool {
    if let Some(token) = provided_token {
        if let Ok(decoded) = b64.decode(token) {
            if let Ok(decoded_str) = String::from_utf8(decoded) {
                return hook_secret.as_bytes().len() == decoded_str.as_bytes().len()
                    && hook_secret
                        .as_bytes()
                        .iter()
                        .zip(decoded_str.as_bytes())
                        .all(|(a, b)| a == b);
            }
        }
    }
    false
}

pub fn process_event(
    persistence: Option<WebhookPersistence>,
    queue: WebhookQueueList,
    module: String,
    operation: String,
    resource: String,
    target: String,
    action: String,
    details_json_str: String,
    trigger_api_key: String,
    trigger_ip: Option<String>,
    trigger_request_id: String,
    trigger_webhook_token: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

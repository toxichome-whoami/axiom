use base64::{engine::general_purpose::STANDARD as b64, Engine as _};
use hmac::Hmac;
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::OnceLock;

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
                // Constant-time comparison: always compare all bytes up to max length
                let secret_bytes = hook_secret.as_bytes();
                let token_bytes = decoded_str.as_bytes();
                let max_len = secret_bytes.len().max(token_bytes.len());
                let mut result: u8 = if secret_bytes.len() == token_bytes.len() {
                    0
                } else {
                    1
                };
                for i in 0..max_len {
                    let a = secret_bytes.get(i).unwrap_or(&0);
                    let b = token_bytes.get(i).unwrap_or(&0);
                    result |= a ^ b;
                }
                return result == 0;
            }
        }
    }
    false
}

#[allow(clippy::too_many_arguments)]
pub fn process_event(
    _persistence: Option<WebhookPersistence>,
    _queue: WebhookQueueList,
    _module: String,
    _operation: String,
    _resource: String,
    _target: String,
    _action: String,
    _details_json_str: String,
    _trigger_api_key: String,
    _trigger_ip: Option<String>,
    _trigger_request_id: String,
    _trigger_webhook_token: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

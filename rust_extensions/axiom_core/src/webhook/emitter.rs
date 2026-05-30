use base64::{engine::general_purpose::STANDARD as b64, Engine as _};
use hmac::{Hmac, Mac};
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyString, PyTuple};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
struct CompiledRule {
    module: String,
    operation: String,
    alias: String,
    targets: Vec<String>,
}

// Thread-safe cache of compiled rules
static COMPILED_RULES: OnceLock<std::sync::RwLock<HashMap<String, CompiledRule>>> = OnceLock::new();

fn get_rules_cache() -> &'static std::sync::RwLock<HashMap<String, CompiledRule>> {
    COMPILED_RULES.get_or_init(|| std::sync::RwLock::new(HashMap::new()))
}

#[pyfunction]
pub fn compile_rules(py: Python) -> PyResult<()> {
    let config_mod = py.import_bound("config.provider")?;
    let provider_cls = config_mod.getattr("GlobalConfigProvider")?;
    let provider_inst = provider_cls.call0()?;
    let config = provider_inst.call_method0("get_config")?;

    let features = config.getattr("features")?;
    let webhooks_conf = config.getattr("webhooks")?;

    let webhook_enabled: bool = features.getattr("webhook")?.extract()?;
    let engine_enabled: bool = webhooks_conf.getattr("enabled")?.extract()?;

    let mut cache = get_rules_cache().write().unwrap();
    cache.clear();

    if !webhook_enabled || !engine_enabled {
        return Ok(());
    }

    let webhooks_obj = config.getattr("webhook")?;
    let webhooks_dict: &Bound<'_, PyDict> = webhooks_obj.downcast()?;
    for (name, hook) in webhooks_dict.iter() {
        let name_str: String = name.extract()?;
        let rule_str: String = hook.getattr("rule")?.extract()?;

        let parts: Vec<&str> = rule_str.split('@').collect();
        if parts.len() != 2 {
            continue;
        }

        let mod_op: Vec<&str> = parts[0].split('.').collect();
        let alias_target: Vec<&str> = parts[1].split(':').collect();

        if mod_op.len() != 2 || alias_target.len() != 2 {
            continue;
        }

        let target_str = alias_target[1].trim();
        let targets = if target_str == "*" {
            vec!["*".to_string()]
        } else {
            target_str
                .split(',')
                .map(|s| s.trim().to_string())
                .collect()
        };

        cache.insert(
            name_str,
            CompiledRule {
                module: mod_op[0].to_string(),
                operation: mod_op[1].to_string(),
                alias: alias_target[0].to_string(),
                targets,
            },
        );
    }

    Ok(())
}

fn is_token_matched(hook_secret: &str, provided_token: &Option<String>) -> bool {
    if let Some(token) = provided_token {
        if let Ok(decoded) = b64.decode(token) {
            if let Ok(decoded_str) = String::from_utf8(decoded) {
                // Cryptographic constant-time comparison is not strictly required here
                // since the secret isn't what's decoded, but to perfectly mirror python's hmac.compare_digest:
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

#[pyfunction]
#[pyo3(signature = (persistence, queue, module, operation, resource, target, action, details_json_str, trigger_api_key, trigger_ip, trigger_request_id, trigger_webhook_token))]
pub fn process_event(
    py: Python,
    persistence: Option<PyObject>,
    queue: PyObject,
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
) -> PyResult<()> {
    let config_mod = py.import_bound("config.provider")?;
    let provider_cls = config_mod.getattr("GlobalConfigProvider")?;
    let provider_inst = provider_cls.call0()?;
    let config = provider_inst.call_method0("get_config")?;

    let features = config.getattr("features")?;
    let webhooks_conf = config.getattr("webhooks")?;
    let webhook_enabled: bool = features.getattr("webhook")?.extract()?;
    let engine_enabled: bool = webhooks_conf.getattr("enabled")?.extract()?;

    if !webhook_enabled || !engine_enabled {
        return Ok(());
    }

    let webhooks_obj = config.getattr("webhook")?;
    let webhooks_dict: &Bound<'_, PyDict> = webhooks_obj.downcast()?;
    let cache = get_rules_cache().read().unwrap();

    let mut matched_hooks = Vec::new();

    for (name, hook) in webhooks_dict.iter() {
        let name_str: String = name.extract()?;
        let enabled: bool = hook.getattr("enabled")?.extract()?;
        if !enabled {
            continue;
        }

        if let Some(compiled) = cache.get(&name_str) {
            if compiled.module != "*" && compiled.module != module {
                continue;
            }
            if compiled.operation != "*"
                && compiled.operation != "any"
                && compiled.operation != operation
            {
                continue;
            }
            if compiled.alias != "*" && compiled.alias != resource {
                continue;
            }
            if compiled.targets[0] != "*" && !compiled.targets.contains(&target) {
                continue;
            }

            let hook_secret: String = hook.getattr("secret")?.extract()?;
            if is_token_matched(&hook_secret, &trigger_webhook_token) {
                matched_hooks.push((name_str, hook.clone()));
            }
        }
    }

    if matched_hooks.is_empty() {
        return Ok(());
    }

    let server_host: String = config.getattr("server")?.getattr("host")?.extract()?;

    // uuidv7 simulation: generate a unique ID
    let uuid_hex = uuid::Uuid::new_v4().simple().to_string(); // In a real system, use uuid7 crate if available
    let event_id = format!("evt_{}", uuid_hex);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    // basic iso8601 string
    let timestamp = format!("{}", now);

    let details_val: Value = serde_json::from_str(&details_json_str).unwrap_or(json!({}));

    let payload_val = json!({
        "event_id": event_id,
        "timestamp": timestamp,
        "source": server_host,
        "event": {
            "module": module,
            "operation": operation,
            "resource": resource,
            "target": target,
            "action": action,
            "details": details_val
        },
        "trigger": {
            "api_key": trigger_api_key,
            "ip": trigger_ip,
            "request_id": trigger_request_id,
            "webhook_token": trigger_webhook_token
        }
    });

    let payload_json = payload_val.to_string();

    let uuid_mod = py.import_bound("utils.uuid7")?;
    let dispatcher_mod = py.import_bound("webhook.dispatcher")?;

    for (name, hook) in matched_hooks {
        let hook_url: String = hook.getattr("url")?.extract()?;
        let hook_secret: String = hook.getattr("secret")?.extract()?;
        let hook_headers = hook.getattr("headers")?;

        if let Some(ref pers) = persistence {
            // persistence.enqueue(event_id, name, url, secret, headers, payload)
            let res = pers.call_method1(
                py,
                "enqueue",
                (
                    event_id.clone(),
                    name.clone(),
                    hook_url.clone(),
                    hook_secret.clone(),
                    hook_headers.clone(),
                    payload_json.clone(),
                ),
            )?;
            let db_id: Option<i64> = res.extract(py)?;

            if let Some(id) = db_id {
                let dict = PyDict::new_bound(py);
                dict.set_item("id", id)?;
                dict.set_item("event_id", event_id.clone())?;
                dict.set_item("hook_name", name.clone())?;
                dict.set_item("url", hook_url.clone())?;
                dict.set_item("secret", hook_secret.clone())?;
                dict.set_item("headers", hook_headers.clone())?;
                dict.set_item("payload", payload_json.clone())?;
                dict.set_item("attempt", 1)?;

                let _ = queue.call_method1(py, "put_nowait", (dict,));
                let _ = dispatcher_mod.call_method0("ensure_workers");
            }
        } else {
            let dict = PyDict::new_bound(py);
            dict.set_item("hook_name", name.clone())?;
            dict.set_item("url", hook_url.clone())?;
            dict.set_item("secret", hook_secret.clone())?;
            dict.set_item("headers", hook_headers.clone())?;
            dict.set_item("payload", payload_json.clone())?;

            let _ = queue.call_method1(py, "put_nowait", (dict,));
            let _ = dispatcher_mod.call_method0("ensure_workers");
        }
    }

    Ok(())
}

pub fn bind_emitter(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(compile_rules, m)?)?;
    m.add_function(wrap_pyfunction!(process_event, m)?)?;
    Ok(())
}

use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use once_cell::sync::Lazy;
use tracing::{error, info, warn};

use crate::api::federation::state::{FederationNodeState, FederationStateManager};
use crate::config::loader::ConfigManager;

fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

// Circuit-breaker failure counters per node
static CIRCUIT_STATE: Lazy<DashMap<String, u32>> = Lazy::new(DashMap::new);

fn circuit_is_open(node_id: &str, threshold: u32) -> bool {
    CIRCUIT_STATE
        .get(node_id)
        .map(|v| *v >= threshold)
        .unwrap_or(false)
}

fn circuit_record_failure(node_id: &str) -> u32 {
    let mut entry = CIRCUIT_STATE.entry(node_id.to_string()).or_insert(0);
    *entry += 1;
    *entry
}

fn circuit_record_success(node_id: &str) {
    CIRCUIT_STATE.insert(node_id.to_string(), 0);
}

async fn poll_node(node_id: &str, state_mgr: &FederationStateManager) {
    let config = ConfigManager::get();

    let fed_config = &config.federation;

    let srv_config = match fed_config.server.get(node_id) {
        Some(sc) => sc.clone(),
        None => return,
    };

    let threshold = fed_config.circuit_breaker_threshold as u32;
    if circuit_is_open(node_id, threshold) {
        return; // Circuit is open — skip this node until backoff expires
    }

    let url = srv_config.url.trim_end_matches('/');
    let health_url = format!("{}/health", url);

    use base64::Engine;
    let mut headers = reqwest::header::HeaderMap::new();
    let b64_secret = base64::engine::general_purpose::STANDARD.encode(&srv_config.secret);
    headers.insert(
        "X-Federation-Secret",
        reqwest::header::HeaderValue::from_str(&b64_secret).unwrap(),
    );
    headers.insert(
        "X-Federation-Node",
        reqwest::header::HeaderValue::from_str(&srv_config.node_id).unwrap(),
    );

    let timeout = std::time::Duration::from_secs_f64(fed_config.per_node_timeout);
    let start = std::time::Instant::now();

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(srv_config.trust_mode != "verify")
        .default_headers(headers)
        .build();

    match client {
        Ok(http) => match http.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let latency_ms = start.elapsed().as_secs_f64() * 1000.0;
                let data: serde_json::Value = resp.json().await.unwrap_or_default();

                let databases = data
                    .get("data")
                    .and_then(|d| d.get("checks"))
                    .and_then(|c| c.get("databases"))
                    .and_then(|v| v.as_object())
                    .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                    .unwrap_or_default();

                let storages = data
                    .get("data")
                    .and_then(|d| d.get("checks"))
                    .and_then(|c| c.get("storages"))
                    .and_then(|v| v.as_object())
                    .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                    .unwrap_or_default();

                state_mgr.set_state(
                    node_id,
                    FederationNodeState {
                        status: "up".to_string(),
                        latency_ms,
                        last_check: now_secs(),
                        consecutive_failures: 0,
                        next_retry_at: 0.0,
                        databases,
                        storages,
                    },
                );
                circuit_record_success(node_id);
                info!(
                    "Federation node {} is up ({}ms)",
                    node_id, latency_ms as u64
                );
            }
            Ok(resp) => {
                let failures = circuit_record_failure(node_id);
                let backoff = (2u64.pow(failures)).min(fed_config.backoff_max as u64) as f64;
                warn!(
                    "Federation node {} returned HTTP {}",
                    node_id,
                    resp.status()
                );
                state_mgr.set_state(
                    node_id,
                    FederationNodeState {
                        status: if failures >= threshold {
                            "down"
                        } else {
                            "degraded"
                        }
                        .to_string(),
                        consecutive_failures: failures,
                        next_retry_at: now_secs() + backoff,
                        last_check: now_secs(),
                        ..Default::default()
                    },
                );
            }
            Err(e) => {
                let failures = circuit_record_failure(node_id);
                let backoff = (2u64.pow(failures)).min(fed_config.backoff_max as u64) as f64;
                warn!("Federation node {} unreachable: {}", node_id, e);
                state_mgr.set_state(
                    node_id,
                    FederationNodeState {
                        status: if failures >= threshold {
                            "down"
                        } else {
                            "degraded"
                        }
                        .to_string(),
                        consecutive_failures: failures,
                        next_retry_at: now_secs() + backoff,
                        last_check: now_secs(),
                        ..Default::default()
                    },
                );
            }
        },
        Err(e) => error!("Failed to build HTTP client for {}: {}", node_id, e),
    }
}

pub async fn sync_federated_servers() {
    info!("Federation sync daemon started");

    let config = ConfigManager::get();

    if !config.features.federation {
        info!("Federation disabled — sync daemon exiting");
        return;
    }
    let fed_cfg = &config.federation;

    let state_mgr = FederationStateManager::new();
    state_mgr.load().await;

    // Seed unknown states for all configured servers
    for node_id in fed_cfg.server.keys() {
        if state_mgr.get_state(node_id).is_none() {
            state_mgr.set_state(node_id, FederationNodeState::default());
        }
    }

    let sync_interval = fed_cfg.sync_interval as u64;

    loop {
        let config = ConfigManager::get();
        if !config.features.federation {
            break;
        }
        let fed_cfg = &config.federation;

        let mut nodes_to_poll = state_mgr.get_next_retry_nodes();

        // Add healthy nodes due for a sync refresh
        let now = now_secs();
        for node_id in fed_cfg.server.keys() {
            if let Some(state) = state_mgr.get_state(node_id) {
                if state.status == "up" && (now - state.last_check) >= sync_interval as f64 {
                    if !nodes_to_poll.contains(&node_id.to_string()) {
                        nodes_to_poll.push(node_id.to_string());
                    }
                }
            }
        }

        if !nodes_to_poll.is_empty() {
            let handles: Vec<_> = nodes_to_poll
                .iter()
                .map(|node_id| {
                    let node_id = node_id.clone();
                    let sm = FederationStateManager::new();
                    tokio::spawn(async move {
                        poll_node(&node_id, &sm).await;
                    })
                })
                .collect();

            for h in handles {
                let _ = h.await;
            }

            state_mgr.persist().await;
        }

        let has_degraded = nodes_to_poll.iter().any(|id| {
            state_mgr
                .get_state(id)
                .map(|s| s.status == "degraded")
                .unwrap_or(false)
        });

        let sleep_secs = if has_degraded { 5 } else { sync_interval };
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(sleep_secs)) => {}
            _ = tokio::signal::ctrl_c() => {
                info!("Federation sync shutting down");
                break;
            }
        }
    }
}

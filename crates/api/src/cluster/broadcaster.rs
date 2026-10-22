/*
 * Non-blocking peer event broadcaster and heartbeat synchronization manager.
 * Owned by: api::cluster
 * Key deps: reqwest, tokio, axiom-metadata, crate::cluster::signing
 * Invariants: Broadcast operations must NEVER block data plane traffic; timeouts capped at 1500ms per peer.
 */

use once_cell::sync::Lazy;
use serde_json::json;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::cluster::signing::sign_outbound_packet;
use axiom_metadata::MetadataStore;

static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to initialize cluster mesh HTTP client")
});

pub struct ClusterBroadcaster;

impl ClusterBroadcaster {
    /// Broadcasts an IP ban event across all connected cluster mesh peers asynchronously.
    pub fn broadcast_ban_ip(ip: &str, reason: &str, ttl_secs: u64) {
        let ip_owned = ip.to_string();
        let reason_owned = reason.to_string();

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                Self::emit_cluster_event(
                    "ban.ip",
                    json!({
                        "ip": ip_owned,
                        "reason": reason_owned,
                        "ttl_secs": ttl_secs
                    }),
                )
                .await;
            });
        }
    }

    /// Broadcasts an IP unban event across all connected cluster mesh peers asynchronously.
    pub fn broadcast_unban_ip(ip: &str) {
        let ip_owned = ip.to_string();

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                Self::emit_cluster_event(
                    "unban.ip",
                    json!({
                        "ip": ip_owned
                    }),
                )
                .await;
            });
        }
    }

    /// Broadcasts an API key ban event across all connected cluster mesh peers asynchronously.
    pub fn broadcast_ban_key(key_name: &str, reason: &str, ttl_secs: u64) {
        let key_owned = key_name.to_string();
        let reason_owned = reason.to_string();

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                Self::emit_cluster_event(
                    "ban.key",
                    json!({
                        "key_name": key_owned,
                        "reason": reason_owned,
                        "ttl_secs": ttl_secs
                    }),
                )
                .await;
            });
        }
    }

    /// Broadcasts an API key unban event across all connected cluster mesh peers asynchronously.
    pub fn broadcast_unban_key(key_name: &str) {
        let key_owned = key_name.to_string();

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                Self::emit_cluster_event(
                    "unban.key",
                    json!({
                        "key_name": key_owned
                    }),
                )
                .await;
            });
        }
    }

    /// Core fanout function that transmits a signed cluster event to all active peers in parallel.
    async fn emit_cluster_event(event_type: &str, payload: serde_json::Value) {
        let identity = match MetadataStore::get_or_create_cluster_identity().await {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!("Skipping cluster broadcast, cannot load identity: {}", e);
                return;
            }
        };
        let (my_node_id, _moniker, cluster_secret) = identity;

        let peers = match MetadataStore::list_peers().await {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("Failed to query peers for cluster broadcast: {}", e);
                return;
            }
        };

        if peers.is_empty() {
            return;
        }

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let event_id = format!("evt_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));

        // Deduplicate locally so this node never re-executes its own event if reflected
        let _ = MetadataStore::record_cluster_event(
            &event_id,
            event_type,
            &payload.to_string(),
            &my_node_id,
        )
        .await;

        let packet = json!({
            "event_id": event_id,
            "event_type": event_type,
            "payload": payload,
            "origin_node_id": my_node_id,
            "timestamp": now_unix
        });

        let body_bytes = match serde_json::to_vec(&packet) {
            Ok(b) => b,
            Err(_) => return,
        };

        for peer in peers {
            if peer.status == "unreachable" {
                continue;
            }

            let peer_url = peer.url.clone();
            let peer_node_id = peer.node_id.clone();
            let my_id = my_node_id.clone();
            let secret = cluster_secret.clone();
            let payload_bytes = body_bytes.clone();

            tokio::spawn(async move {
                let target_url = format!(
                    "{}/internal/v1/cluster/event",
                    peer_url.trim_end_matches('/')
                );
                let (node_header, ts_header, nonce_header, sig_header) =
                    sign_outbound_packet(&my_id, &secret, &payload_bytes);

                let start = Instant::now();
                let res = HTTP_CLIENT
                    .post(&target_url)
                    .header("X-Axiom-Node-Id", node_header)
                    .header("X-Axiom-Timestamp", ts_header.to_string())
                    .header("X-Axiom-Nonce", nonce_header)
                    .header("X-Axiom-Signature", sig_header)
                    .header("Content-Type", "application/json")
                    .body(payload_bytes)
                    .send()
                    .await;

                let latency_ms = start.elapsed().as_millis() as i64;

                match res {
                    Ok(resp) if resp.status().is_success() => {
                        let _ = MetadataStore::update_peer_status(
                            &peer_node_id,
                            "connected",
                            latency_ms,
                        )
                        .await;
                    }
                    Ok(resp) => {
                        tracing::warn!(
                            "Peer {} responded with HTTP {} on cluster event broadcast",
                            peer_node_id,
                            resp.status()
                        );
                    }
                    Err(e) => {
                        tracing::warn!("Failed to broadcast event to peer {}: {}", peer_node_id, e);
                        let _ = MetadataStore::update_peer_status(
                            &peer_node_id,
                            "unreachable",
                            latency_ms,
                        )
                        .await;
                    }
                }
            });
        }
    }

    /// Background heartbeat prober that verifies peer connectivity and measures latency every 30 seconds.
    pub async fn run_heartbeat_loop() {
        let mut interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            interval.tick().await;

            let identity = match MetadataStore::get_or_create_cluster_identity().await {
                Ok(id) => id,
                Err(_) => continue,
            };
            let (my_node_id, _moniker, cluster_secret) = identity;

            let peers = match MetadataStore::list_peers().await {
                Ok(p) => p,
                Err(_) => continue,
            };

            for peer in peers {
                let peer_url = peer.url.clone();
                let peer_node_id = peer.node_id.clone();
                let my_id = my_node_id.clone();
                let secret = cluster_secret.clone();

                tokio::spawn(async move {
                    let target_url = format!(
                        "{}/internal/v1/cluster/ping",
                        peer_url.trim_end_matches('/')
                    );
                    let (node_header, ts_header, nonce_header, sig_header) =
                        sign_outbound_packet(&my_id, &secret, b"");

                    let start = Instant::now();
                    let res = HTTP_CLIENT
                        .get(&target_url)
                        .header("X-Axiom-Node-Id", node_header)
                        .header("X-Axiom-Timestamp", ts_header.to_string())
                        .header("X-Axiom-Nonce", nonce_header)
                        .header("X-Axiom-Signature", sig_header)
                        .send()
                        .await;

                    let latency_ms = start.elapsed().as_millis() as i64;

                    match res {
                        Ok(resp) if resp.status().is_success() => {
                            let _ = MetadataStore::update_peer_status(
                                &peer_node_id,
                                "connected",
                                latency_ms,
                            )
                            .await;
                        }
                        _ => {
                            let _ = MetadataStore::update_peer_status(
                                &peer_node_id,
                                "unreachable",
                                latency_ms,
                            )
                            .await;
                        }
                    }
                });
            }
        }
    }
}

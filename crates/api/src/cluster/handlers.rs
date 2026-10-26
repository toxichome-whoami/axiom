/*
 * HTTP handlers for internal cluster mesh communication: mutual handshakes, pings, events, and sync.
 * Owned by: api::cluster
 * Key deps: axum, bytes, serde, axiom-metadata, crate::cluster::signing
 * Invariants: All cluster endpoints (except handshake) enforce cryptographic signature validation; zero plaintext secrets in wire payloads.
 */

use axum::{
    extract::Json,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cluster::signing::{constant_time_str_eq, verify_inbound_packet};
use crate::security::ban_list::BanList;
use axiom_metadata::{get_snapshot, models::*, MetadataStore};

#[derive(Debug, Deserialize, Serialize)]
pub struct HandshakeRequest {
    pub node_id: String,
    pub moniker: String,
    pub advertise_url: String,
    pub cluster_secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HandshakeResponse {
    pub node_id: String,
    pub moniker: String,
    pub status: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ClusterEventPacket {
    pub event_id: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub origin_node_id: String,
    pub timestamp: i64,
}

/// Mutual peer pairing endpoint: validates shared cluster secret and symmetrically registers peer.
pub async fn handle_handshake(Json(req): Json<HandshakeRequest>) -> impl IntoResponse {
    let identity = match MetadataStore::get_or_create_cluster_identity().await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Cluster identity error: {}", e) })),
            );
        }
    };
    let (my_node_id, my_moniker, my_secret) = identity;

    // Verify provided cluster secret in constant time
    if !constant_time_str_eq(&req.cluster_secret, &my_secret) {
        tracing::warn!(
            "Cluster handshake rejected: invalid secret from node '{}' ({})",
            req.node_id,
            req.advertise_url
        );
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid cluster secret" })),
        );
    }

    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let peer = PeerNodeRecord {
        node_id: req.node_id.clone(),
        moniker: req.moniker.clone(),
        url: req.advertise_url.clone(),
        shared_secret_hash: blake3::hash(my_secret.as_bytes()).as_bytes().to_vec(),
        status: "connected".to_string(),
        last_ping_ms: 0,
        last_seen_at: now_unix,
        created_at: now_unix,
    };

    if let Err(e) = MetadataStore::upsert_peer(&peer).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to register peer: {}", e) })),
        );
    }

    tracing::info!(
        "Cluster peer registered successfully: '{}' ({})",
        peer.moniker,
        peer.node_id
    );

    (
        StatusCode::OK,
        Json(serde_json::json!(HandshakeResponse {
            node_id: my_node_id,
            moniker: my_moniker,
            status: "connected".to_string(),
        })),
    )
}

// ─── Fast In-Memory Deduplication & Auth Extraction ───────────────────────

static SEEN_CLUSTER_EVENTS: once_cell::sync::Lazy<dashmap::DashMap<String, i64>> =
    once_cell::sync::Lazy::new(dashmap::DashMap::new);

/// Marks an outbound or processed event as seen in the in-memory deduplication registry.
pub fn mark_cluster_event_seen(event_id: &str, now_unix: i64) {
    if SEEN_CLUSTER_EVENTS.len() > 2000 {
        SEEN_CLUSTER_EVENTS.retain(|_, &mut exp| exp > now_unix);
    }
    SEEN_CLUSTER_EVENTS.insert(event_id.to_string(), now_unix + 600);
}

/// Checks whether an event ID was previously processed; if not, registers it in memory.
fn check_and_mark_cluster_event(event_id: &str, now_unix: i64) -> bool {
    if SEEN_CLUSTER_EVENTS.len() > 2000 {
        SEEN_CLUSTER_EVENTS.retain(|_, &mut exp| exp > now_unix);
    }
    if SEEN_CLUSTER_EVENTS.contains_key(event_id) {
        return true;
    }
    SEEN_CLUSTER_EVENTS.insert(event_id.to_string(), now_unix + 600);
    false
}

/// Zero-copy borrowed extractor for internal cluster cryptographic headers.
#[derive(Debug)]
pub struct ClusterAuthHeaders<'a> {
    pub node_id: &'a str,
    pub timestamp: i64,
    pub nonce: &'a str,
    pub signature: &'a str,
}

impl<'a> ClusterAuthHeaders<'a> {
    pub fn extract(headers: &'a HeaderMap) -> Result<Self, (StatusCode, &'static str)> {
        let node_id = headers
            .get("X-Axiom-Node-Id")
            .and_then(|h| h.to_str().ok())
            .ok_or((StatusCode::BAD_REQUEST, "Missing X-Axiom-Node-Id header"))?;

        let timestamp: i64 = headers
            .get("X-Axiom-Timestamp")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse().ok())
            .ok_or((
                StatusCode::BAD_REQUEST,
                "Missing or invalid X-Axiom-Timestamp header",
            ))?;

        let nonce = headers
            .get("X-Axiom-Nonce")
            .and_then(|h| h.to_str().ok())
            .ok_or((StatusCode::BAD_REQUEST, "Missing X-Axiom-Nonce header"))?;

        let signature = headers
            .get("X-Axiom-Signature")
            .and_then(|h| h.to_str().ok())
            .ok_or((StatusCode::BAD_REQUEST, "Missing X-Axiom-Signature header"))?;

        Ok(Self {
            node_id,
            timestamp,
            nonce,
            signature,
        })
    }
}

/// Heartbeat ping endpoint: verifies signature and confirms peer liveness.
pub async fn handle_ping(headers: HeaderMap) -> impl IntoResponse {
    let identity = match MetadataStore::get_or_create_cluster_identity().await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            );
        }
    };
    let (my_node_id, _moniker, cluster_secret) = identity;

    let auth = match ClusterAuthHeaders::extract(&headers) {
        Ok(a) => a,
        Err((status, msg)) => {
            return (status, Json(serde_json::json!({ "error": msg })));
        }
    };

    if let Err(err) = verify_inbound_packet(
        auth.node_id,
        &cluster_secret,
        auth.timestamp,
        auth.nonce,
        b"",
        auth.signature,
    ) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": err.to_string() })),
        );
    }

    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "node_id": my_node_id,
            "timestamp": now_unix
        })),
    )
}

/// Inbound cluster event receiver (e.g., instant ban propagation from peer).
pub async fn handle_event(headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    let identity = match MetadataStore::get_or_create_cluster_identity().await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            );
        }
    };
    let (_my_node_id, _moniker, cluster_secret) = identity;

    let auth = match ClusterAuthHeaders::extract(&headers) {
        Ok(a) => a,
        Err((status, msg)) => {
            return (status, Json(serde_json::json!({ "error": msg })));
        }
    };

    if let Err(err) = verify_inbound_packet(
        auth.node_id,
        &cluster_secret,
        auth.timestamp,
        auth.nonce,
        &body,
        auth.signature,
    ) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": err.to_string() })),
        );
    }

    let packet: ClusterEventPacket = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": format!("Invalid JSON event packet: {}", e) })),
            );
        }
    };

    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Fast in-memory deduplication check: rejects loops or retransmissions without hitting SQLite disk
    if check_and_mark_cluster_event(&packet.event_id, now_unix) {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "duplicate_ignored", "event_id": packet.event_id })),
        );
    }

    // Persist event record in SQLite asynchronously
    let event_id_clone = packet.event_id.clone();
    let event_type_clone = packet.event_type.clone();
    let payload_str = packet.payload.to_string();
    let origin_id = packet.origin_node_id.clone();
    tokio::spawn(async move {
        let _ = MetadataStore::record_cluster_event(
            &event_id_clone,
            &event_type_clone,
            &payload_str,
            &origin_id,
        )
        .await;
    });

    // Process event based on type
    match packet.event_type.as_str() {
        "ban.ip" => {
            if let Some(ip) = packet.payload.get("ip").and_then(|v| v.as_str()) {
                let reason = packet
                    .payload
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Banned by cluster peer");
                let ttl_secs = packet
                    .payload
                    .get("ttl_secs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);

                BanList::ban_ip_local(ip, reason, ttl_secs);
                tracing::info!(
                    "Cluster event applied: Suspended IP '{}' propagated from peer node '{}'",
                    ip,
                    packet.origin_node_id
                );
            }
        }
        "unban.ip" => {
            if let Some(ip) = packet.payload.get("ip").and_then(|v| v.as_str()) {
                BanList::unban_ip_local(ip);
                tracing::info!(
                    "Cluster event applied: Lifted suspension for IP '{}' propagated from peer node '{}'",
                    ip,
                    packet.origin_node_id
                );
            }
        }
        "ban.key" => {
            if let Some(key_name) = packet.payload.get("key_name").and_then(|v| v.as_str()) {
                let reason = packet
                    .payload
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Suspended by cluster peer");
                let ttl_secs = packet
                    .payload
                    .get("ttl_secs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);

                BanList::ban_key_local(key_name, reason, ttl_secs);
                tracing::info!(
                    "Cluster event applied: Suspended API key '{}' propagated from peer node '{}'",
                    key_name,
                    packet.origin_node_id
                );
            }
        }
        "unban.key" => {
            if let Some(key_name) = packet.payload.get("key_name").and_then(|v| v.as_str()) {
                BanList::unban_key_local(key_name);
                tracing::info!(
                    "Cluster event applied: Lifted suspension for API key '{}' propagated from peer node '{}'",
                    key_name,
                    packet.origin_node_id
                );
            }
        }
        unknown => {
            tracing::warn!("Received unrecognized cluster event type: '{}'", unknown);
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({ "status": "applied", "event_id": packet.event_id })),
    )
}

/// Metadata catalog synchronization endpoint: returns complete snapshot for peer cross-node introspection.
pub async fn handle_sync(headers: HeaderMap) -> impl IntoResponse {
    let identity = match MetadataStore::get_or_create_cluster_identity().await {
        Ok(id) => id,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            );
        }
    };
    let (my_node_id, _moniker, cluster_secret) = identity;

    let auth = match ClusterAuthHeaders::extract(&headers) {
        Ok(a) => a,
        Err((status, msg)) => {
            return (status, Json(serde_json::json!({ "error": msg })));
        }
    };

    if let Err(err) = verify_inbound_packet(
        auth.node_id,
        &cluster_secret,
        auth.timestamp,
        auth.nonce,
        b"",
        auth.signature,
    ) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": err.to_string() })),
        );
    }

    let snapshot = get_snapshot();
    let active_bans = BanList::list_active_banned_ips();

    let roles_records: Vec<RoleRecord> = snapshot
        .roles
        .iter()
        .map(|(name, role)| RoleRecord {
            name: name.clone(),
            description: None,
            created_at: 0,
            permissions: role
                .permissions
                .iter()
                .map(|p| PermissionRecord {
                    id: 0,
                    role_name: name.clone(),
                    database: p.database.clone(),
                    table_name: p.table_name.clone(),
                    operations: p.operations.clone(),
                    rls_filter: p.rls_filter.clone(),
                })
                .collect(),
        })
        .collect();

    let api_keys_records: Vec<ApiKeyRecord> = snapshot
        .keys
        .iter()
        .map(|(name, key)| ApiKeyRecord {
            name: name.clone(),
            secret_hash: key.secret_hash.to_vec(),
            role_name: key.role_name.clone(),
            rate_limit: key.rate_limit_override as i64,
            expires_at: key.expires_at,
            created_at: 0,
        })
        .collect();

    let databases_records: Vec<DatabaseRecord> = snapshot
        .databases
        .iter()
        .map(|(alias, db)| DatabaseRecord {
            alias: alias.clone(),
            url: String::new(), // Invariant: Connection secrets are NEVER leaked in sync payloads
            engine: db.engine.clone(),
            pool_min: db.pool_min as i64,
            pool_max: db.pool_max as i64,
            created_at: 0,
        })
        .collect();

    let payload = ClusterSyncPayload {
        node_id: my_node_id,
        epoch_version: snapshot.loaded_at_unix as u64,
        roles: roles_records,
        api_keys: api_keys_records,
        databases: databases_records,
        active_bans,
    };

    (StatusCode::OK, Json(serde_json::json!(payload)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_cluster_auth_headers_extraction_success() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Axiom-Node-Id", HeaderValue::from_static("node_1"));
        headers.insert("X-Axiom-Timestamp", HeaderValue::from_static("1700000000"));
        headers.insert("X-Axiom-Nonce", HeaderValue::from_static("nonce_xyz"));
        headers.insert("X-Axiom-Signature", HeaderValue::from_static("sig_123"));

        let auth = ClusterAuthHeaders::extract(&headers).expect("should extract valid headers");
        assert_eq!(auth.node_id, "node_1");
        assert_eq!(auth.timestamp, 1700000000);
        assert_eq!(auth.nonce, "nonce_xyz");
        assert_eq!(auth.signature, "sig_123");
    }

    #[test]
    fn test_cluster_auth_headers_missing_rejection() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Axiom-Node-Id", HeaderValue::from_static("node_1"));
        // Missing timestamp, nonce, signature

        let err = ClusterAuthHeaders::extract(&headers).unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(err.1.contains("Timestamp"));
    }

    #[test]
    fn test_in_memory_event_deduplication() {
        let event_id = format!("test_evt_{}", uuid::Uuid::new_v4());
        let now = 1700000000;

        assert!(!check_and_mark_cluster_event(&event_id, now));
        assert!(check_and_mark_cluster_event(&event_id, now));
    }
}

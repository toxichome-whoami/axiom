/*
 * Cryptographic challenge/response and BLAKE3 MAC verification for internal cluster communication.
 * Owned by: api::cluster
 * Key deps: blake3, dashmap, uuid
 * Invariants: Timestamps must fall within 30-second skew window; nonces must be strictly unique within replay window.
 */

use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::time::{SystemTime, UNIX_EPOCH};

// ─── Replay Attack Prevention ──────────────────────────────────────────────
// Stores recently seen nonces mapped to their expiration timestamp (Unix seconds).
// Any repeated nonce within the replay window is instantly rejected.
static SEEN_NONCES: Lazy<DashMap<String, i64>> = Lazy::new(DashMap::new);

#[derive(Debug, PartialEq, Eq)]
pub enum ClusterAuthError {
    MissingHeaders,
    TimestampSkewExceeded,
    ReplayDetected,
    InvalidSignature,
    PeerNotFound,
    InternalError(String),
}

impl std::fmt::Display for ClusterAuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingHeaders => write!(f, "Missing required cluster security headers"),
            Self::TimestampSkewExceeded => write!(f, "Timestamp skew exceeds 30-second allowable drift"),
            Self::ReplayDetected => write!(f, "Nonce replay attack detected"),
            Self::InvalidSignature => write!(f, "Cryptographic cluster signature validation failed"),
            Self::PeerNotFound => write!(f, "Unregistered or untrusted peer node identifier"),
            Self::InternalError(e) => write!(f, "Internal cluster auth error: {}", e),
        }
    }
}

/// Computes a BLAKE3 keyed hash over canonical packet metadata and payload.
/// Format: `node_id:timestamp:nonce:body_blake3_hex`
pub fn compute_cluster_mac(
    node_id: &str,
    secret: &str,
    timestamp: i64,
    nonce: &str,
    body: &[u8],
) -> String {
    let key_hash = blake3::hash(secret.as_bytes());
    let body_hash_hex = blake3::hash(body).to_hex();
    let canonical = format!("{}:{}:{}:{}", node_id, timestamp, nonce, body_hash_hex);

    let mac = blake3::keyed_hash(key_hash.as_bytes(), canonical.as_bytes());
    mac.to_hex().to_string()
}

/// Generates headers `(X-Axiom-Node-Id, X-Axiom-Timestamp, X-Axiom-Nonce, X-Axiom-Signature)` for an outbound cluster packet.
pub fn sign_outbound_packet(
    node_id: &str,
    secret: &str,
    body: &[u8],
) -> (String, i64, String, String) {
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let nonce = uuid::Uuid::new_v4().to_string().replace('-', "");
    let signature = compute_cluster_mac(node_id, secret, now_unix, &nonce, body);

    (node_id.to_string(), now_unix, nonce, signature)
}

/// Validates an incoming cluster request using timing-safe comparison, timestamp drift check, and nonce uniqueness.
pub fn verify_inbound_packet(
    node_id: &str,
    secret: &str,
    timestamp: i64,
    nonce: &str,
    body: &[u8],
    provided_signature: &str,
) -> Result<(), ClusterAuthError> {
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // 1. Check timestamp drift (+/- 30 seconds)
    if (now_unix - timestamp).abs() > 30 {
        return Err(ClusterAuthError::TimestampSkewExceeded);
    }

    // 2. Prevent replay attacks via nonce deduplication
    prune_expired_nonces(now_unix);
    if SEEN_NONCES.contains_key(nonce) {
        return Err(ClusterAuthError::ReplayDetected);
    }
    SEEN_NONCES.insert(nonce.to_string(), now_unix + 60);

    // 3. Verify signature in constant time
    let expected_mac = compute_cluster_mac(node_id, secret, timestamp, nonce, body);
    if !constant_time_str_eq(expected_mac.as_str(), provided_signature) {
        return Err(ClusterAuthError::InvalidSignature);
    }

    Ok(())
}

/// Constant-time string equality check to mitigate timing side-channel attacks.
pub fn constant_time_str_eq(a: &str, b: &str) -> bool {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();

    if a_bytes.len() != b_bytes.len() {
        return false;
    }

    let mut diff = 0u8;
    for (x, y) in a_bytes.iter().zip(b_bytes.iter()) {
        diff |= x ^ y;
    }

    diff == 0
}

/// Evicts expired nonces to bound memory consumption of the replay protection registry.
fn prune_expired_nonces(now_unix: i64) {
    if SEEN_NONCES.len() > 1000 {
        SEEN_NONCES.retain(|_, &mut exp| exp > now_unix);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_roundtrip_and_verification() {
        let node_id = "axm_node_alpha";
        let secret = "cluster_shared_secret_789";
        let body = b"{\"action\":\"ban.ip\",\"ip\":\"1.2.3.4\"}";

        let (node, ts, nonce, sig) = sign_outbound_packet(node_id, secret, body);
        assert_eq!(node, node_id);

        // Verification should succeed
        let result = verify_inbound_packet(&node, secret, ts, &nonce, body, &sig);
        assert!(result.is_ok());

        // Replay of identical nonce should fail
        let replay = verify_inbound_packet(&node, secret, ts, &nonce, body, &sig);
        assert_eq!(replay, Err(ClusterAuthError::ReplayDetected));

        // Tampered body should fail
        let tampered_body = b"{\"action\":\"ban.ip\",\"ip\":\"5.6.7.8\"}";
        let bad_sig = verify_inbound_packet(&node, secret, ts, "fresh_nonce_1", tampered_body, &sig);
        assert_eq!(bad_sig, Err(ClusterAuthError::InvalidSignature));

        // Expired timestamp should fail
        let old_ts = ts - 60;
        let old_sig = compute_cluster_mac(node_id, secret, old_ts, "fresh_nonce_2", body);
        let expired = verify_inbound_packet(&node, secret, old_ts, "fresh_nonce_2", body, &old_sig);
        assert_eq!(expired, Err(ClusterAuthError::TimestampSkewExceeded));
    }
}

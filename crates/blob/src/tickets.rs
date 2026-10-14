/*
 * Zero-state cryptographic capability tickets (pre-signed URLs) for blob operations.
 * Owned by: blob
 * Key deps: blake3, crate::hash::constant_time_eq, crate::error::BlobError
 * Invariants: Tickets are stateless, tamper-proof via BLAKE3-keyed MAC, and time-bounded.
 * Last structural change: Automated persistent ticket secret resolution backed by metadata store.
 */

use crate::error::BlobError;
use crate::hash::constant_time_eq;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const CONTEXT_STRING: &str = "axiom_blob_presigned_ticket_v1";

static ACTIVE_TICKET_SECRET: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Registers the persistent capability ticket secret.
/// CONTRACT:
///  - Precondition: `secret` must not be empty.
///  - Side effects: Stores `secret` in `ACTIVE_TICKET_SECRET` OnceLock.
///  - Idempotent: Yes (subsequent calls will no-op if already set).
pub fn set_ticket_secret(secret: &str) {
    if !secret.is_empty() {
        let _ = ACTIVE_TICKET_SECRET.set(secret.to_string());
    }
}

/// Retrieves the active capability ticket secret.
/// CONTRACT:
///  - Returns the persistent secret loaded from metadata store if initialized.
///  - Falls back to generating a session-scoped ephemeral random secret if uninitialized (e.g., standalone tests).
///  - Guarantees zero allocation on repeated calls.
pub fn get_ticket_secret() -> &'static str {
    ACTIVE_TICKET_SECRET.get_or_init(|| {
        tracing::debug!("Notice: 'blob_ticket_secret' uninitialized at call time. Generating ephemeral random secret.");
        format!("{}_{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4())
    })
}

/// Resolves an effective ticket secret with an optional explicit override.
/// CONTRACT:
///  - If `explicit_secret` is `Some` and non-empty, returns that slice.
///  - Otherwise, returns `get_ticket_secret()`.
pub fn resolve_ticket_secret(explicit_secret: Option<&str>) -> &str {
    if let Some(s) = explicit_secret {
        if !s.is_empty() {
            return s;
        }
    }
    get_ticket_secret()
}

/// Max ticket lifetime: 24h. Min: 60s. Default: 1h. Prevents near-eternal capabilities (M-3).
pub const MAX_TICKET_TTL_SECS: u64 = 86_400;
pub const MIN_TICKET_TTL_SECS: u64 = 60;
pub const DEFAULT_TICKET_TTL_SECS: u64 = 3_600;

/// Validate ticket operation against allowlist (READ/WRITE only; DELETE must never be ticket-scoped).
pub fn normalize_ticket_operation(op: &str) -> Result<String, BlobError> {
    let upper = op.to_uppercase();
    if upper == "READ" || upper == "WRITE" {
        Ok(upper)
    } else {
        Err(BlobError::InvalidTicket(format!(
            "Unsupported ticket operation '{}' (allowed: READ, WRITE)",
            op
        )))
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedTicket {
    /// Target namespace.
    pub namespace: String,
    /// Target object key.
    pub key: String,
    /// Authorized operation: "READ" or "WRITE".
    pub operation: String,
    /// Expiration timestamp in Unix epoch seconds.
    pub expires_at: i64,
    /// Hex-encoded BLAKE3 keyed hash signature.
    pub signature: String,
}

/// Signs a capability ticket for a given namespace, key, and operation.
/// CONTRACT:
///  - Precondition: `secret` must not be empty.
///  - `operation` is typically "READ" or "WRITE".
///  - `ttl_seconds` defines validity window into the future.
///  - Returns `SignedTicket` containing the signature and expiration.
pub fn generate_ticket(
    secret: &str,
    namespace: &str,
    key: &str,
    operation: &str,
    ttl_seconds: u64,
) -> SignedTicket {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let ttl_clamped = ttl_seconds.clamp(MIN_TICKET_TTL_SECS, MAX_TICKET_TTL_SECS);
    let ttl_i64: i64 = ttl_clamped.try_into().unwrap_or(MAX_TICKET_TTL_SECS as i64);
    let expires_at = now.checked_add(ttl_i64).unwrap_or(i64::MAX);
    let op_norm = normalize_ticket_operation(operation).unwrap_or_else(|_| "READ".to_string());

    let signature = compute_signature(secret, namespace, key, &op_norm, expires_at);

    SignedTicket {
        namespace: namespace.to_string(),
        key: key.to_string(),
        operation: op_norm,
        expires_at,
        signature,
    }
}

// ─── Verification & Key Derivation ─────────────────────────────────────────

/// Verifies whether an incoming ticket signature and expiration are valid.
/// CONTRACT:
///  - Timing attack resistant: uses constant-time comparison to eliminate side-channels.
///  - Fails with `BlobError::InvalidTicket` if `current_time > expires_at`.
///  - Fails with `BlobError::InvalidTicket` if signature does not match recomputed keyed hash.
pub fn verify_ticket(
    secret: &str,
    namespace: &str,
    key: &str,
    operation: &str,
    expires_at: i64,
    signature: &str,
) -> Result<(), BlobError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    if now > expires_at {
        return Err(BlobError::InvalidTicket("Ticket has expired".to_string()));
    }

    let expected_sig = compute_signature(secret, namespace, key, operation, expires_at);

    if !constant_time_eq(signature, &expected_sig) {
        return Err(BlobError::InvalidTicket("Invalid ticket signature".to_string()));
    }

    Ok(())
}

/// Derives a 32-byte subkey and computes keyed BLAKE3 hash across ticket fields.
/// INVARIANT: `blake3::derive_key` applies cryptographic domain separation using `CONTEXT_STRING`,
/// preventing subkey reuse across different cryptographic protocols in the codebase.
fn compute_signature(
    secret: &str,
    namespace: &str,
    key: &str,
    operation: &str,
    expires_at: i64,
) -> String {
    let derived_key = blake3::derive_key(CONTEXT_STRING, secret.as_bytes());
    let op_upper = operation.to_uppercase();
    // Colon delimiter is safe because namespace and operation are strictly validated character sets.
    let message = format!("{}:{}:{}:{}", namespace, key, op_upper, expires_at);
    blake3::keyed_hash(&derived_key, message.as_bytes())
        .to_hex()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ticket_signing_and_verification() {
        let secret = "axiom_master_dev_secret_key_12345";
        let ticket = generate_ticket(secret, "media", "videos/intro.mp4", "READ", 300);

        // Verification passes with valid parameters
        let res = verify_ticket(
            secret,
            &ticket.namespace,
            &ticket.key,
            &ticket.operation,
            ticket.expires_at,
            &ticket.signature,
        );
        assert!(res.is_ok());

        // Tampering with operation fails
        let res_tampered_op = verify_ticket(
            secret,
            &ticket.namespace,
            &ticket.key,
            "WRITE",
            ticket.expires_at,
            &ticket.signature,
        );
        assert!(res_tampered_op.is_err());

        // Tampering with key fails
        let res_tampered_key = verify_ticket(
            secret,
            &ticket.namespace,
            "videos/other.mp4",
            &ticket.operation,
            ticket.expires_at,
            &ticket.signature,
        );
        assert!(res_tampered_key.is_err());

        // Wrong secret fails
        let res_wrong_secret = verify_ticket(
            "different_secret_key",
            &ticket.namespace,
            &ticket.key,
            &ticket.operation,
            ticket.expires_at,
            &ticket.signature,
        );
        assert!(res_wrong_secret.is_err());
    }

    #[test]
    fn test_ticket_expiration() {
        let secret = "axiom_master_dev_secret_key_12345";
        let mut ticket = generate_ticket(secret, "docs", "file.pdf", "READ", 60);
        // Artificially set expiration into the past (TTL is clamped to >=60s, so force past)
        ticket.expires_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
            - 10;
        // Recompute signature for expired timestamp to test the expiry check specifically
        ticket.signature = compute_signature(secret, &ticket.namespace, &ticket.key, &ticket.operation, ticket.expires_at);

        let res = verify_ticket(
            secret,
            &ticket.namespace,
            &ticket.key,
            &ticket.operation,
            ticket.expires_at,
            &ticket.signature,
        );
        assert!(res.is_err());
        match res.unwrap_err() {
            BlobError::InvalidTicket(msg) => assert!(msg.contains("expired")),
            other => panic!("Unexpected error: {:?}", other),
        }
    }

    #[test]
    fn test_set_and_get_ticket_secret() {
        let sec = get_ticket_secret();
        assert!(!sec.is_empty());

        let custom = "test_custom_ticket_secret_value";
        set_ticket_secret(custom);
        let resolved = resolve_ticket_secret(Some(custom));
        assert_eq!(resolved, custom);
    }
}

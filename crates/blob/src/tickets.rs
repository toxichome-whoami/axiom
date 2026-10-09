/*
 * Zero-state cryptographic capability tickets (pre-signed URLs) for blob operations.
 * Owned by: blob
 * Key deps: blake3, crate::hash::constant_time_eq, crate::error::BlobError
 * Invariants: Tickets are stateless, tamper-proof via BLAKE3-keyed MAC, and time-bounded.
 * Last structural change: Initial implementation of Phase 2 Next-Gen Blob Storage Engine.
 */

use crate::error::BlobError;
use crate::hash::constant_time_eq;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const CONTEXT_STRING: &str = "axiom_blob_presigned_ticket_v1";

/// Structured representation of a signed capability ticket.
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
    let expires_at = now + ttl_seconds as i64;

    let signature = compute_signature(secret, namespace, key, operation, expires_at);

    SignedTicket {
        namespace: namespace.to_string(),
        key: key.to_string(),
        operation: operation.to_uppercase(),
        expires_at,
        signature,
    }
}

/// Verifies whether an incoming ticket signature and expiration are valid.
/// CONTRACT:
///  - Constant-time signature comparison to eliminate timing channels.
///  - Fails if `current_time > expires_at`.
///  - Fails if signature does not match recomputed keyed hash.
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
fn compute_signature(
    secret: &str,
    namespace: &str,
    key: &str,
    operation: &str,
    expires_at: i64,
) -> String {
    let derived_key = blake3::derive_key(CONTEXT_STRING, secret.as_bytes());
    let op_upper = operation.to_uppercase();
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
        let mut ticket = generate_ticket(secret, "docs", "file.pdf", "READ", 0);
        // Artificially set expiration into the past
        ticket.expires_at -= 10;
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
}

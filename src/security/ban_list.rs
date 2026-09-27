/*
 * In-memory IP and API key suspension registry with distributed brute-force protection.
 * Owned by: security
 * Key deps: dashmap::DashMap, once_cell::sync::Lazy
 * Invariants: Suspended entities reject traffic immediately; failed attempt windows slide or reset on success.
 * Last structural change: Phase 0 hot-path cleanup adding global per-key failure tracking (S3 bypass fix).
 */

use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::time::{Duration, Instant};

// ─── Ban Registries ────────────────────────────────────────────────────────
// Thread-safe concurrent maps tracking temporary and permanent bans.
// Keyed by raw IP address or API key name, values contain ban rationale for audit logs.
static IP_BANS: Lazy<DashMap<String, String>> = Lazy::new(DashMap::new);
static KEY_BANS: Lazy<DashMap<String, String>> = Lazy::new(DashMap::new);

// ─── Brute-Force Defense State ─────────────────────────────────────────────
// Tracks failed authentication attempts globally per API key name across all source IPs.
// Counter resets after `window_secs` elapses or on successful credential verification.
static FAILED_AUTH_BY_KEY: Lazy<DashMap<String, (u32, Instant)>> = Lazy::new(DashMap::new);

pub struct BanList;

impl BanList {
    /// Checks whether an incoming IPv4/IPv6 client address is currently banned.
    /// CONTRACT:
    ///  - Precondition: `ip` should be pre-trimmed without port numbers.
    ///  - Returns `(true, reason)` if active ban exists, `(false, "")` otherwise.
    ///  - Side effects: None (read-only lock-free lookup).
    ///  - Idempotent: Yes.
    pub fn is_ip_banned(ip: &str) -> (bool, String) {
        if let Some(reason) = IP_BANS.get(ip) {
            return (true, reason.clone());
        }
        (false, String::new())
    }

    /// Checks whether an API key identity has been suspended.
    /// CONTRACT:
    ///  - Precondition: `key_name` must be the extracted identifier (not the raw secret).
    ///  - Returns `(true, reason)` if suspended, `(false, "")` otherwise.
    ///  - Side effects: None.
    ///  - Idempotent: Yes.
    pub fn is_key_banned(key_name: &str) -> (bool, String) {
        if let Some(reason) = KEY_BANS.get(key_name) {
            return (true, reason.clone());
        }
        (false, String::new())
    }

    /// Suspends an IP address immediately and records the reason.
    /// CONTRACT:
    ///  - Precondition: `reason` must not contain unescaped PII or secrets.
    ///  - Side effects: Inserts into `IP_BANS` map, immediately blocking future requests.
    ///  - Idempotent: Yes (overwrites previous reason).
    pub fn ban_ip(ip: &str, reason: &str) {
        IP_BANS.insert(ip.to_string(), reason.to_string());
    }

    /// Suspends an API key name immediately and records the reason.
    /// CONTRACT:
    ///  - Precondition: `key_name` is the key identifier, never the secret or base64 blob.
    ///  - Side effects: Inserts into `KEY_BANS`, immediately invalidating future authentication.
    ///  - Idempotent: Yes.
    pub fn ban_key(key_name: &str, reason: &str) {
        KEY_BANS.insert(key_name.to_string(), reason.to_string());
    }

    /// Records a failed authentication attempt against an API key name across any IP.
    /// CONTRACT:
    ///  - Precondition: `key_name` must be non-empty.
    ///  - Returns `true` if this failure triggered an automatic key suspension.
    ///  - Side effects: Increments failure counter; automatically calls `ban_key` when threshold reached.
    ///  - Idempotent: No (increments state).
    pub fn record_failed_auth(key_name: &str, threshold: u32, window_secs: u64) -> bool {
        let now = Instant::now();
        let window = Duration::from_secs(window_secs);

        let mut entry = FAILED_AUTH_BY_KEY.entry(key_name.to_string()).or_insert((0, now));
        let (count, first_seen) = entry.value_mut();

        // Sliding reset: if window expired without breaching threshold, restart count
        if now.duration_since(*first_seen) > window {
            *count = 1;
            *first_seen = now;
            return false;
        }

        *count += 1;
        if *count >= threshold {
            let reason = format!(
                "Suspended due to {} failed authentication attempts within {}s window",
                *count, window_secs
            );
            Self::ban_key(key_name, &reason);
            true
        } else {
            false
        }
    }

    /// Clears any recorded authentication failures for a key upon successful authentication.
    /// CONTRACT:
    ///  - Precondition: Called only after constant-time secret verification succeeds.
    ///  - Side effects: Removes entry from `FAILED_AUTH_BY_KEY`.
    ///  - Idempotent: Yes.
    pub fn record_successful_auth(key_name: &str) {
        FAILED_AUTH_BY_KEY.remove(key_name);
    }
}

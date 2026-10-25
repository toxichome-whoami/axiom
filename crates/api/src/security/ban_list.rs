/*
 * In-memory IP and API key suspension registry with distributed brute-force protection.
 * Owned by: security
 * Key deps: dashmap::DashMap, once_cell::sync::Lazy
 * Invariants: Suspended entities reject traffic immediately; failed attempt windows slide or reset on success.
 * Last structural change: Phase 0 hot-path cleanup adding global per-key failure tracking (S3 bypass fix).
 */

use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct BanEntry {
    pub reason: String,
    pub expires_at: i64, // 0 = permanent
}

// ─── Ban Registries ────────────────────────────────────────────────────────
// Thread-safe concurrent maps tracking temporary and permanent bans.
// Keyed by raw IP address or API key name, values contain ban rationale and expiration.
static IP_BANS: Lazy<DashMap<String, BanEntry>> = Lazy::new(DashMap::new);
static KEY_BANS: Lazy<DashMap<String, BanEntry>> = Lazy::new(DashMap::new);

// ─── Brute-Force Defense State ─────────────────────────────────────────────
// Tracks failed authentication attempts globally per API key name across all source IPs.
// Counter resets after `window_secs` elapses or on successful credential verification.
static FAILED_AUTH_BY_KEY: Lazy<DashMap<String, (u32, Instant)>> = Lazy::new(DashMap::new);

// Tracks failed authentication attempts per (client_ip:key_name) to penalize attacking IPs
// without locking out legitimate clients sharing the same key identity.
static FAILED_AUTH_BY_IP_KEY: Lazy<DashMap<String, (u32, Instant)>> = Lazy::new(DashMap::new);

pub struct BanList;

impl BanList {
    /// Loads active bans from SQLite metadata store into memory on startup (M-7).
    pub async fn init_persistent() {
        if let Ok(ip_bans) = axiom_metadata::MetadataStore::load_active_ip_bans().await {
            let count = ip_bans.len();
            for (ip, reason, expires_at) in ip_bans {
                IP_BANS.insert(ip, BanEntry { reason, expires_at });
            }
            if count > 0 {
                tracing::info!("Loaded {} persistent IP bans from metadata store", count);
            }
        }
        if let Ok(key_bans) = axiom_metadata::MetadataStore::load_active_key_bans().await {
            let count = key_bans.len();
            for (key, reason, expires_at) in key_bans {
                KEY_BANS.insert(key, BanEntry { reason, expires_at });
            }
            if count > 0 {
                tracing::info!(
                    "Loaded {} persistent API key suspensions from metadata store",
                    count
                );
            }
        }
    }

    /// Checks whether an incoming IPv4/IPv6 client address is currently banned.
    /// CONTRACT:
    ///  - Precondition: `ip` should be pre-trimmed without port numbers.
    ///  - Returns `(true, reason)` if active ban exists, `(false, "")` otherwise.
    ///  - Side effects: Lazily evicts expired ban if encountered.
    ///  - Idempotent: Yes.
    pub fn is_ip_banned(ip: &str) -> (bool, String) {
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        if let Some(entry) = IP_BANS.get(ip) {
            if entry.expires_at > 0 && now_unix >= entry.expires_at {
                drop(entry);
                IP_BANS.remove(ip);
                let ip_str = ip.to_string();
                if let Ok(handle) = tokio::runtime::Handle::try_current() {
                    handle.spawn(async move {
                        let _ = axiom_metadata::MetadataStore::remove_ip_ban(&ip_str).await;
                    });
                }
                return (false, String::new());
            }
            return (true, entry.reason.clone());
        }
        (false, String::new())
    }

    /// Checks whether an API key identity has been suspended.
    /// CONTRACT:
    ///  - Precondition: `key_name` must be the extracted identifier (not the raw secret).
    ///  - Returns `(true, reason)` if suspended, `(false, "")` otherwise.
    ///  - Side effects: Lazily evicts expired suspension if encountered.
    ///  - Idempotent: Yes.
    pub fn is_key_banned(key_name: &str) -> (bool, String) {
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        if let Some(entry) = KEY_BANS.get(key_name) {
            if entry.expires_at > 0 && now_unix >= entry.expires_at {
                drop(entry);
                KEY_BANS.remove(key_name);
                let key_str = key_name.to_string();
                if let Ok(handle) = tokio::runtime::Handle::try_current() {
                    handle.spawn(async move {
                        let _ = axiom_metadata::MetadataStore::remove_key_ban(&key_str).await;
                    });
                }
                return (false, String::new());
            }
            return (true, entry.reason.clone());
        }
        (false, String::new())
    }

    /// Suspends an IP address permanently and persists to SQLite.
    pub fn ban_ip(ip: &str, reason: &str) {
        Self::ban_ip_with_ttl(ip, reason, 0);
    }

    /// Suspends an IP address with a TTL in seconds and persists to SQLite, broadcasting to cluster peers.
    pub fn ban_ip_with_ttl(ip: &str, reason: &str, ttl_secs: u64) {
        Self::ban_ip_local(ip, reason, ttl_secs);
        crate::cluster::ClusterBroadcaster::broadcast_ban_ip(ip, reason, ttl_secs);
    }

    /// Suspends an IP address locally without triggering peer cluster fanout (used by cluster event receivers).
    pub fn ban_ip_local(ip: &str, reason: &str, ttl_secs: u64) {
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let expires_at = if ttl_secs > 0 {
            now_unix + ttl_secs as i64
        } else {
            0
        };

        IP_BANS.insert(
            ip.to_string(),
            BanEntry {
                reason: reason.to_string(),
                expires_at,
            },
        );

        let ip_owned = ip.to_string();
        let reason_owned = reason.to_string();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = axiom_metadata::MetadataStore::save_ip_ban(
                    &ip_owned,
                    &reason_owned,
                    expires_at,
                )
                .await;
            });
        }
    }

    /// Lifts an IP address suspension in memory and SQLite, broadcasting to cluster peers.
    pub fn unban_ip(ip: &str) {
        Self::unban_ip_local(ip);
        crate::cluster::ClusterBroadcaster::broadcast_unban_ip(ip);
    }

    /// Lifts an IP address suspension locally without triggering peer cluster fanout.
    pub fn unban_ip_local(ip: &str) {
        IP_BANS.remove(ip);
        let ip_owned = ip.to_string();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = axiom_metadata::MetadataStore::remove_ip_ban(&ip_owned).await;
            });
        }
    }

    /// Suspends an API key name permanently and persists to SQLite.
    pub fn ban_key(key_name: &str, reason: &str) {
        Self::ban_key_with_ttl(key_name, reason, 0);
    }

    /// Suspends an API key name with a TTL in seconds and persists to SQLite, broadcasting to cluster peers.
    pub fn ban_key_with_ttl(key_name: &str, reason: &str, ttl_secs: u64) {
        Self::ban_key_local(key_name, reason, ttl_secs);
        crate::cluster::ClusterBroadcaster::broadcast_ban_key(key_name, reason, ttl_secs);
    }

    /// Suspends an API key name locally without triggering peer cluster fanout.
    pub fn ban_key_local(key_name: &str, reason: &str, ttl_secs: u64) {
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let expires_at = if ttl_secs > 0 {
            now_unix + ttl_secs as i64
        } else {
            0
        };

        KEY_BANS.insert(
            key_name.to_string(),
            BanEntry {
                reason: reason.to_string(),
                expires_at,
            },
        );

        let key_owned = key_name.to_string();
        let reason_owned = reason.to_string();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = axiom_metadata::MetadataStore::save_key_ban(
                    &key_owned,
                    &reason_owned,
                    expires_at,
                )
                .await;
            });
        }
    }

    /// Lifts an API key suspension in memory and SQLite, broadcasting to cluster peers.
    pub fn unban_key(key_name: &str) {
        Self::unban_key_local(key_name);
        crate::cluster::ClusterBroadcaster::broadcast_unban_key(key_name);
    }

    /// Clears all in-memory ban and brute-force tracking state.
    pub fn clear() {
        IP_BANS.clear();
        KEY_BANS.clear();
        FAILED_AUTH_BY_KEY.clear();
        FAILED_AUTH_BY_IP_KEY.clear();
    }

    /// Lifts an API key suspension locally without triggering peer cluster fanout.
    pub fn unban_key_local(key_name: &str) {
        KEY_BANS.remove(key_name);
        let key_owned = key_name.to_string();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = axiom_metadata::MetadataStore::remove_key_ban(&key_owned).await;
            });
        }
    }

    /// Records a failed authentication attempt targeting an API key name from a specific client IP.
    /// CONTRACT:
    ///  - Precondition: `client_ip` and `key_name` must be non-empty.
    ///  - Returns `true` if this failure triggered an automatic IP suspension.
    ///  - Security Invariant: Suspends the offending CLIENT IP rather than globally banning the key,
    ///    preventing unauthenticated attackers from causing Denial of Service against legitimate key owners.
    ///  - Side effects: Increments failure counter for (ip, key); automatically calls `ban_ip_with_ttl` when threshold reached.
    ///  - Idempotent: No (increments state).
    pub fn record_failed_auth_for_ip(
        client_ip: &str,
        key_name: &str,
        threshold: u32,
        window_secs: u64,
        cooldown_secs: u64,
    ) -> bool {
        let now = Instant::now();
        let window = Duration::from_secs(window_secs);
        let tracking_key = format!("{}:{}", client_ip, key_name);

        let mut entry = FAILED_AUTH_BY_IP_KEY
            .entry(tracking_key)
            .or_insert((0, now));
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
                "Suspended IP due to {} failed authentication attempts for key '{}' within {}s window",
                *count, key_name, window_secs
            );
            Self::ban_ip_with_ttl(client_ip, &reason, cooldown_secs);
            true
        } else {
            false
        }
    }

    /// Records a failed authentication attempt against an API key name across any IP.
    /// CONTRACT:
    ///  - Precondition: `key_name` must be non-empty.
    ///  - Returns `true` if this failure triggered an automatic key suspension.
    ///  - Side effects: Increments failure counter; automatically calls `ban_key` when threshold reached.
    ///  - Idempotent: No (increments state).
    pub fn record_failed_auth(
        key_name: &str,
        threshold: u32,
        window_secs: u64,
        cooldown_secs: u64,
    ) -> bool {
        let now = Instant::now();
        let window = Duration::from_secs(window_secs);

        let mut entry = FAILED_AUTH_BY_KEY
            .entry(key_name.to_string())
            .or_insert((0, now));
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
            Self::ban_key_with_ttl(key_name, &reason, cooldown_secs);
            true
        } else {
            false
        }
    }

    /// Clears any recorded authentication failures for a key and client IP upon successful authentication.
    /// CONTRACT:
    ///  - Precondition: Called only after constant-time secret verification succeeds.
    ///  - Side effects: Removes entry from `FAILED_AUTH_BY_KEY` and `FAILED_AUTH_BY_IP_KEY`.
    ///  - Idempotent: Yes.
    pub fn record_successful_auth(key_name: &str) {
        FAILED_AUTH_BY_KEY.remove(key_name);
    }

    /// Clears any recorded authentication failures for a specific IP + key pair upon successful authentication.
    pub fn record_successful_auth_for_ip(client_ip: &str, key_name: &str) {
        FAILED_AUTH_BY_KEY.remove(key_name);
        let tracking_key = format!("{}:{}", client_ip, key_name);
        FAILED_AUTH_BY_IP_KEY.remove(&tracking_key);
    }

    /// Returns a list of all currently active suspended IPv4/IPv6 client addresses.
    pub fn list_active_banned_ips() -> Vec<String> {
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        IP_BANS
            .iter()
            .filter(|entry| entry.value().expires_at == 0 || entry.value().expires_at > now_unix)
            .map(|entry| entry.key().clone())
            .collect()
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────
// Tests for brute-force protection logic and ban registries.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_successful_auth_clears_failed_count() {
        let key = "test_sp_key_clear_success_1";
        // 4 failed attempts
        for _ in 0..4 {
            BanList::record_failed_auth(key, 5, 60, 0);
        }
        BanList::record_successful_auth(key);
        // 5th attempt after success should NOT ban (since it was cleared)
        let banned = BanList::record_failed_auth(key, 5, 60, 0);
        assert!(!banned);
        assert!(!BanList::is_key_banned(key).0);
    }

    #[test]
    fn test_ban_key_and_is_key_banned() {
        let key = "test_sp_key_manual_ban_1";
        BanList::ban_key(key, "manual ban reason");
        let (is_banned, reason) = BanList::is_key_banned(key);
        assert!(is_banned);
        assert_eq!(reason, "manual ban reason");
    }

    #[test]
    fn test_key_suspension_reason_string() {
        let key = "test_sp_key_suspension_reason_1";
        for _ in 0..4 {
            BanList::record_failed_auth(key, 5, 60, 0);
        }
        let banned = BanList::record_failed_auth(key, 5, 60, 0);
        assert!(banned);
        let (is_banned, reason) = BanList::is_key_banned(key);
        assert!(is_banned);
        assert!(reason.contains("5"));
        assert!(reason.contains("60"));
    }

    #[test]
    fn test_ip_ban_ttl_and_expiration() {
        let ip = "192.0.2.1";
        // Ban for 1 second
        BanList::ban_ip_with_ttl(ip, "Temporary test ban", 1);
        let (banned, reason) = BanList::is_ip_banned(ip);
        assert!(banned);
        assert_eq!(reason, "Temporary test ban");

        // Manually simulate expiration by modifying entry's expires_at to the past
        if let Some(mut entry) = IP_BANS.get_mut(ip) {
            entry.expires_at = 1; // Expired long ago in 1970
        }

        // is_ip_banned should detect expiration, evict it, and return false
        let (banned_after, _) = BanList::is_ip_banned(ip);
        assert!(!banned_after);
    }

    #[test]
    fn test_unban_ip_and_key() {
        let ip = "192.0.2.2";
        BanList::ban_ip(ip, "Test ban");
        assert!(BanList::is_ip_banned(ip).0);
        BanList::unban_ip(ip);
        assert!(!BanList::is_ip_banned(ip).0);

        let key = "test_unban_key";
        BanList::ban_key(key, "Test ban");
        assert!(BanList::is_key_banned(key).0);
        BanList::unban_key(key);
        assert!(!BanList::is_key_banned(key).0);
    }

    #[test]
    fn test_record_failed_auth_for_ip_bans_ip_not_key() {
        let ip = "198.51.100.42";
        let key = "victim_key_not_banned";

        for _ in 0..4 {
            assert!(!BanList::record_failed_auth_for_ip(ip, key, 5, 60, 0));
        }

        // 5th attempt triggers IP ban
        assert!(BanList::record_failed_auth_for_ip(ip, key, 5, 60, 0));

        // Offending IP must be banned
        let (ip_banned, reason) = BanList::is_ip_banned(ip);
        assert!(ip_banned);
        assert!(reason.contains(key));

        // Victim key MUST NOT be banned (prevents DoS)
        assert!(!BanList::is_key_banned(key).0);

        // Success from another IP or reset
        BanList::record_successful_auth_for_ip(ip, key);
        BanList::unban_ip(ip);
    }
}

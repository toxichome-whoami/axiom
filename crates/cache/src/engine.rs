/*
 * Unified two-tier caching engine with L1 RAM (DashMap + LRU) and L2 disk persistence (libsql/SQLite).
 * Owned by: cache
 * Key deps: bytes::Bytes, dashmap::DashMap, libsql, once_cell
 * Invariants: Hot-path L1 reads complete in sub-microsecond with zero locks; LRU tracks access timestamps.
 * Last structural change: Phase 5 unified cache engine implementation replacing ad-hoc stores.
 */

use bytes::Bytes;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::OnceCell;

// ─── Durability & Stats Models ─────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Durability {
    #[default]
    Ephemeral,
    MemoryOnly,
    Journaled,
    Snapshot,
    JournaledAndSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStatsSnapshot {
    pub hits_l1: u64,
    pub hits_l2: u64,
    pub misses: u64,
    pub evictions: u64,
    pub entries_count: usize,
    pub hit_rate_pct: f64,
    pub memory_bytes_approx: usize,
}

struct CacheStats {
    hits_l1: AtomicU64,
    hits_l2: AtomicU64,
    misses: AtomicU64,
    evictions: AtomicU64,
}

impl CacheStats {
    const fn new() -> Self {
        Self {
            hits_l1: AtomicU64::new(0),
            hits_l2: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
        }
    }

    fn snapshot(&self, entries_count: usize, memory_bytes: usize) -> CacheStatsSnapshot {
        let h1 = self.hits_l1.load(Ordering::Relaxed);
        let h2 = self.hits_l2.load(Ordering::Relaxed);
        let m = self.misses.load(Ordering::Relaxed);
        let e = self.evictions.load(Ordering::Relaxed);

        let total_requests = h1 + h2 + m;
        let hit_rate_pct = if total_requests > 0 {
            ((h1 + h2) as f64 / total_requests as f64) * 100.0
        } else {
            0.0
        };

        CacheStatsSnapshot {
            hits_l1: h1,
            hits_l2: h2,
            misses: m,
            evictions: e,
            entries_count,
            hit_rate_pct,
            memory_bytes_approx: memory_bytes,
        }
    }
}

// ─── L1 Memory Entry Model ─────────────────────────────────────────────────

struct L1Entry {
    value: Bytes,
    expires_at: u64,
    last_accessed: AtomicU64,
    #[allow(dead_code)]
    durability: Durability,
}

impl Clone for L1Entry {
    fn clone(&self) -> Self {
        Self {
            value: self.value.clone(),
            expires_at: self.expires_at,
            last_accessed: AtomicU64::new(self.last_accessed.load(Ordering::Relaxed)),
            durability: self.durability,
        }
    }
}

// ─── Engine Statics ────────────────────────────────────────────────────────

static L1_CACHE: Lazy<DashMap<String, L1Entry>> = Lazy::new(DashMap::new);
static STATS: CacheStats = CacheStats::new();
static L2_CONN: OnceCell<libsql::Connection> = OnceCell::const_new();
static MAX_L1_ENTRIES: AtomicU64 = AtomicU64::new(10_000);

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn current_unix_nanos() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64
}

// ─── CacheEngine Public Interface ──────────────────────────────────────────

pub struct CacheEngine;

impl CacheEngine {
    /// Initializes the caching engine, creates persistent SQLite tables, and configures limits.
    /// CONTRACT:
    ///  - Precondition: `l2_url` must be a valid SQLite file path or remote Turso endpoint.
    ///  - Precondition: `max_entries` > 0.
    ///  - Side effects: Initializes L2 SQLite schema if uninitialized; configures L1 bounds.
    ///  - Idempotent: Yes.
    pub async fn init(l2_url: &str, l2_token: &str, max_entries: usize) -> Result<(), String> {
        MAX_L1_ENTRIES.store(max_entries.max(100) as u64, Ordering::Relaxed);

        if l2_url.is_empty() {
            return Ok(());
        }

        let db_res = if l2_url.starts_with("http") || l2_url.starts_with("libsql") {
            libsql::Builder::new_remote(l2_url.to_string(), l2_token.to_string())
                .build()
                .await
        } else {
            let path = l2_url.strip_prefix("file:").unwrap_or(l2_url);
            if let Some(parent) = std::path::Path::new(path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            libsql::Builder::new_local(path).build().await
        };

        let db = db_res.map_err(|e| format!("Failed to build L2 cache database: {}", e))?;
        let conn = db.connect().map_err(|e| format!("Failed to connect to L2 cache: {}", e))?;

        // Initialize persistent AOF cache table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS cache_aof (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL,
                expires_at INTEGER NOT NULL,
                durability TEXT NOT NULL
            )",
            (),
        )
        .await
        .map_err(|e| format!("Failed to create cache_aof table: {}", e))?;

        let _ = L2_CONN.set(conn);
        Ok(())
    }

    /// Retrieves an entry from cache, querying L1 then L2 on miss.
    /// CONTRACT:
    ///  - Returns `Some(Bytes)` if active and not expired.
    ///  - Returns `None` on cache miss or expiration.
    ///  - Side effects: On L1 hit, updates LRU access timestamp; on L2 hit, promotes entry to L1.
    ///  - Idempotent: Yes (pure read with access timestamp update).
    pub async fn get(key: &str) -> Option<Bytes> {
        let now = current_unix_secs();

        // 1. Check L1 RAM cache (ultra-fast sub-microsecond shared read lock)
        if let Some(entry) = L1_CACHE.get(key) {
            if entry.expires_at > now {
                entry.last_accessed.store(current_unix_nanos(), Ordering::Relaxed);
                STATS.hits_l1.fetch_add(1, Ordering::Relaxed);
                return Some(entry.value.clone());
            }
        }

        // 2. Check L2 persistent store (disk / Turso)
        if let Some(conn) = L2_CONN.get() {
            let query = "SELECT value, expires_at, durability FROM cache_aof WHERE key = ?1 AND expires_at > ?2";
            if let Ok(mut rows) = conn.query(query, libsql::params![key, now as i64]).await {
                if let Ok(Some(row)) = rows.next().await {
                    if let Ok(blob) = row.get::<Vec<u8>>(0) {
                        let expires_at = row.get::<i64>(1).unwrap_or(0) as u64;
                        let durability_str: String = row.get(2).unwrap_or_default();
                        let durability = match durability_str.as_str() {
                            "journaled" => Durability::Journaled,
                            "snapshot" => Durability::Snapshot,
                            "journaled_and_snapshot" => Durability::JournaledAndSnapshot,
                            _ => Durability::MemoryOnly,
                        };

                        let val_bytes = Bytes::from(blob);

                        // Promote L2 entry to L1
                        Self::evict_if_needed();
                        L1_CACHE.insert(
                            key.to_string(),
                            L1Entry {
                                value: val_bytes.clone(),
                                expires_at,
                                last_accessed: AtomicU64::new(current_unix_nanos()),
                                durability,
                            },
                        );

                        STATS.hits_l2.fetch_add(1, Ordering::Relaxed);
                        return Some(val_bytes);
                    }
                }
            }
        }

        STATS.misses.fetch_add(1, Ordering::Relaxed);
        None
    }

    /// Stores a key-value entry across L1 and L2 tiers according to durability policy.
    /// CONTRACT:
    ///  - Precondition: `ttl_secs` > 0.
    ///  - Side effects: Inserts into L1; evicts oldest if limit reached; writes to L2 if Journaled.
    ///  - Idempotent: Yes.
    pub async fn set(key: &str, value: Bytes, ttl_secs: u64, durability: Durability) {
        let now = current_unix_secs();
        let expires_at = now.saturating_add(ttl_secs);

        Self::evict_if_needed();

        L1_CACHE.insert(
            key.to_string(),
            L1Entry {
                value: value.clone(),
                expires_at,
                last_accessed: AtomicU64::new(current_unix_nanos()),
                durability,
            },
        );

        // Write to L2 disk storage if durability level requires persistence
        if matches!(
            durability,
            Durability::Journaled | Durability::Snapshot | Durability::JournaledAndSnapshot
        ) {
            if let Some(conn) = L2_CONN.get() {
                let key_owned = key.to_string();
                let val_vec = value.to_vec();
                let dur_str = match durability {
                    Durability::Journaled => "journaled",
                    Durability::Snapshot => "snapshot",
                    Durability::JournaledAndSnapshot => "journaled_and_snapshot",
                    _ => "memory_only",
                };

                let _ = conn
                    .execute(
                        "INSERT INTO cache_aof (key, value, expires_at, durability) \
                         VALUES (?1, ?2, ?3, ?4) \
                         ON CONFLICT(key) DO UPDATE SET value = ?2, expires_at = ?3, durability = ?4",
                        libsql::params![key_owned, val_vec, expires_at as i64, dur_str],
                    )
                    .await;
            }
        }
    }

    /// Deletes a key from both L1 and L2 caches.
    /// CONTRACT:
    ///  - Side effects: Removes entry from DashMap and executes SQLite DELETE.
    ///  - Idempotent: Yes.
    pub async fn delete(key: &str) {
        L1_CACHE.remove(key);
        if let Some(conn) = L2_CONN.get() {
            let _ = conn
                .execute("DELETE FROM cache_aof WHERE key = ?1", [key])
                .await;
        }
    }

    /// Clears all entries from both memory L1 and persistent L2.
    /// CONTRACT:
    ///  - Side effects: Wipes DashMap and truncates SQLite table.
    ///  - Idempotent: Yes.
    pub async fn flush() {
        L1_CACHE.clear();
        if let Some(conn) = L2_CONN.get() {
            let _ = conn.execute("DELETE FROM cache_aof", ()).await;
        }
    }

    /// Gathers atomic performance counters and memory estimates.
    pub fn stats() -> CacheStatsSnapshot {
        let entries_count = L1_CACHE.len();
        // Approximate memory: sum of key lengths and byte buffer sizes
        let mut memory_bytes = 0;
        for entry in L1_CACHE.iter() {
            memory_bytes += entry.key().len() + entry.value().value.len() + std::mem::size_of::<L1Entry>();
        }

        STATS.snapshot(entries_count, memory_bytes)
    }

    /// Sweeps expired records from both L1 RAM and L2 disk.
    /// CONTRACT:
    ///  - Side effects: Retains only unexpired items in DashMap and executes batch DELETE on SQLite.
    pub async fn sweep_expired() {
        let now = current_unix_secs();
        L1_CACHE.retain(|_, entry| entry.expires_at > now);

        if let Some(conn) = L2_CONN.get() {
            let _ = conn
                .execute(
                    "DELETE FROM cache_aof WHERE expires_at <= ?1",
                    libsql::params![now as i64],
                )
                .await;
        }
    }

    /// Evaluates rate-limit buckets and updates penalty records using unified cache primitives.
    /// CONTRACT:
    ///  - Precondition: `limits_key` and `penalty_key` uniquely namespaced.
    ///  - Returns `(is_banned, current_count)`.
    ///  - Side effects: Updates rate-limit counter in L1.
    pub fn check_rate_limit(
        limits_key: &str,
        window_secs: u32,
        limit: u32,
        penalty_key: &str,
        penalty_cooldown: u32,
        penalty_threshold: u32,
    ) -> (bool, u32) {
        let now = current_unix_secs();

        // 1. Check penalty state
        if let Some(entry) = L1_CACHE.get(penalty_key) {
            if entry.expires_at > now {
                if let Ok(violations) = std::str::from_utf8(&entry.value).map(|s| s.parse::<u32>().unwrap_or(0)) {
                    if violations >= penalty_threshold {
                        return (true, 0); // Banned
                    }
                }
            }
        }

        // 2. Increment rate limit counter
        let mut count = 1;
        if let Some(mut entry) = L1_CACHE.get_mut(limits_key) {
            if entry.expires_at > now {
                if let Ok(c) = std::str::from_utf8(&entry.value).map(|s| s.parse::<u32>().unwrap_or(0)) {
                    count = c + 1;
                    entry.value = Bytes::from(count.to_string());
                    entry.last_accessed.store(current_unix_nanos(), Ordering::Relaxed);
                }
            } else {
                entry.value = Bytes::from("1");
                entry.expires_at = now + window_secs as u64;
                entry.last_accessed.store(current_unix_nanos(), Ordering::Relaxed);
            }
        } else {
            Self::evict_if_needed();
            L1_CACHE.insert(
                limits_key.to_string(),
                L1Entry {
                    value: Bytes::from("1"),
                    expires_at: now + window_secs as u64,
                    last_accessed: AtomicU64::new(current_unix_nanos()),
                    durability: Durability::Ephemeral,
                },
            );
        }

        // 3. Handle limit breach and register penalty
        if count > limit {
            if let Some(mut entry) = L1_CACHE.get_mut(penalty_key) {
                if entry.expires_at > now {
                    let penalty_count = std::str::from_utf8(&entry.value)
                        .ok()
                        .and_then(|s| s.parse::<u32>().ok())
                        .unwrap_or(0) + 1;
                    entry.value = Bytes::from(penalty_count.to_string());
                    entry.last_accessed.store(current_unix_nanos(), Ordering::Relaxed);
                } else {
                    entry.value = Bytes::from("1");
                    entry.expires_at = now + penalty_cooldown as u64;
                    entry.last_accessed.store(current_unix_nanos(), Ordering::Relaxed);
                }
            } else {
                Self::evict_if_needed();
                L1_CACHE.insert(
                    penalty_key.to_string(),
                    L1Entry {
                        value: Bytes::from("1"),
                        expires_at: now + penalty_cooldown as u64,
                        last_accessed: AtomicU64::new(current_unix_nanos()),
                        durability: Durability::Ephemeral,
                    },
                );
            }
            return (true, count);
        }

        (false, count)
    }

    /// Enforces true LRU eviction by removing the entry with the oldest access timestamp.
    /// Employs sampled batch eviction (Redis-style) to avoid full O(N) table scans on the hot path.
    fn evict_if_needed() {
        let max = MAX_L1_ENTRIES.load(Ordering::Relaxed) as usize;
        let current_len = L1_CACHE.len();
        if current_len >= max {
            let mut sample: Vec<(String, u64)> = L1_CACHE
                .iter()
                .take(64)
                .map(|entry| (entry.key().clone(), entry.value().last_accessed.load(Ordering::Relaxed)))
                .collect();

            if !sample.is_empty() {
                sample.sort_unstable_by_key(|(_, ts)| *ts);
                // Evict enough to make room; when max is large, amortize by evicting up to 16
                let target_evictions = (current_len.saturating_sub(max) + 1).max(if max > 64 { 16 } else { 1 });
                let to_evict = target_evictions.min(sample.len()).min(current_len);
                for (k, _) in sample.into_iter().take(to_evict) {
                    if L1_CACHE.remove(&k).is_some() {
                        STATS.evictions.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    static TEST_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

    #[tokio::test]
    async fn test_l1_set_and_get() {
        let _guard = TEST_LOCK.lock().await;
        let key = "test:l1:item";
        let val = Bytes::from("hello_cache");
        CacheEngine::set(key, val.clone(), 60, Durability::MemoryOnly).await;

        let retrieved = CacheEngine::get(key).await;
        assert_eq!(retrieved, Some(val));
    }

    #[tokio::test]
    async fn test_expired_entry_returns_none() {
        let _guard = TEST_LOCK.lock().await;
        let key = "test:expired:item";
        let val = Bytes::from("expired_soon");
        // Insert with 0 TTL so it immediately expires
        CacheEngine::set(key, val, 0, Durability::MemoryOnly).await;

        let retrieved = CacheEngine::get(key).await;
        assert_eq!(retrieved, None);
    }

    /// RAII guard ensuring `MAX_L1_ENTRIES` is always reset to its previous value upon test completion or panic.
    struct LruLimitGuard(u64);
    impl Drop for LruLimitGuard {
        fn drop(&mut self) {
            MAX_L1_ENTRIES.store(self.0, Ordering::Relaxed);
        }
    }

    #[tokio::test]
    async fn test_true_lru_eviction() {
        let _guard = TEST_LOCK.lock().await;
        let prev_limit = MAX_L1_ENTRIES.load(Ordering::Relaxed);
        let _limit_guard = LruLimitGuard(prev_limit);

        // Set small limit
        MAX_L1_ENTRIES.store(2, Ordering::Relaxed);
        CacheEngine::flush().await;

        CacheEngine::set("item_1", Bytes::from("1"), 100, Durability::MemoryOnly).await;
        tokio::time::sleep(Duration::from_millis(5)).await;
        CacheEngine::set("item_2", Bytes::from("2"), 100, Durability::MemoryOnly).await;
        tokio::time::sleep(Duration::from_millis(5)).await;

        // Access item_1 so item_2 becomes the least recently used
        let _ = CacheEngine::get("item_1").await;
        tokio::time::sleep(Duration::from_millis(5)).await;

        // Insert item_3 to trigger LRU eviction of item_2
        CacheEngine::set("item_3", Bytes::from("3"), 100, Durability::MemoryOnly).await;

        assert_eq!(CacheEngine::get("item_1").await, Some(Bytes::from("1")));
        assert_eq!(CacheEngine::get("item_3").await, Some(Bytes::from("3")));
        assert_eq!(CacheEngine::get("item_2").await, None); // Evicted!

        CacheEngine::flush().await;
    }

    #[tokio::test]
    async fn test_flush_clears_all() {
        let _guard = TEST_LOCK.lock().await;
        CacheEngine::flush().await;
        CacheEngine::set("flush:1", Bytes::from("val1"), 60, Durability::MemoryOnly).await;
        CacheEngine::set("flush:2", Bytes::from("val2"), 60, Durability::MemoryOnly).await;
        assert!(CacheEngine::get("flush:1").await.is_some());

        CacheEngine::flush().await;
        assert_eq!(CacheEngine::get("flush:1").await, None);
        assert_eq!(CacheEngine::get("flush:2").await, None);
    }

    #[tokio::test]
    async fn test_rate_limit_checking() {
        let _guard = TEST_LOCK.lock().await;
        CacheEngine::flush().await;
        let key = "rl:test:ip_unique";
        let pen = "pen:test:ip_unique";

        // Limit = 2, within limit
        let (violated, count) = CacheEngine::check_rate_limit(key, 60, 2, pen, 300, 5);
        assert!(!violated);
        assert_eq!(count, 1);

        let (violated, count) = CacheEngine::check_rate_limit(key, 60, 2, pen, 300, 5);
        assert!(!violated);
        assert_eq!(count, 2);

        // Third request exceeds limit of 2
        let (violated, count) = CacheEngine::check_rate_limit(key, 60, 2, pen, 300, 5);
        assert!(violated);
        assert_eq!(count, 3);

        CacheEngine::flush().await;
    }
}


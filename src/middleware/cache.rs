use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU32, Ordering};

static RATE_LIMIT_CACHE: Lazy<DashMap<String, AtomicU32>> = Lazy::new(|| DashMap::new());
static PENALTY_CACHE: Lazy<DashMap<String, AtomicU32>> = Lazy::new(|| DashMap::new());

pub struct MemoryCache;

impl MemoryCache {
    pub async fn check_rate_limit(
        limits_key: &str,
        _window: u32,
        limit: u32,
        penalty_key: &str,
        _burst: u32,
        _penalty_cooldown: u32,
        penalty_threshold: u32,
    ) -> (bool, u32) {
        // Penalty check
        if let Some(penalty) = PENALTY_CACHE.get(penalty_key) {
            if penalty.load(Ordering::Relaxed) >= penalty_threshold {
                return (true, 0); // Banned
            }
        }

        let current = {
            if let Some(entry) = RATE_LIMIT_CACHE.get(limits_key) {
                entry.fetch_add(1, Ordering::Relaxed) + 1
            } else {
                RATE_LIMIT_CACHE.insert(limits_key.to_string(), AtomicU32::new(1));
                1
            }
        };

        if current > limit {
            // Apply penalty if exceeded
            if let Some(entry) = PENALTY_CACHE.get(penalty_key) {
                entry.fetch_add(1, Ordering::Relaxed);
            } else {
                PENALTY_CACHE.insert(penalty_key.to_string(), AtomicU32::new(1));
            }
            return (true, current);
        }

        (false, current)
    }
}

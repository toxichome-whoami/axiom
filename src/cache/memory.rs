use dashmap::DashMap;
use once_cell::sync::Lazy;

static RATE_LIMIT_CACHE: Lazy<DashMap<String, u32>> = Lazy::new(|| DashMap::new());
static PENALTY_CACHE: Lazy<DashMap<String, u32>> = Lazy::new(|| DashMap::new());

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
            if *penalty >= penalty_threshold {
                return (true, 0); // Banned
            }
        }

        let mut current = RATE_LIMIT_CACHE.entry(limits_key.to_string()).or_insert(0);
        *current += 1;

        if *current > limit {
            // Apply penalty if exceeded
            let mut penalty = PENALTY_CACHE.entry(penalty_key.to_string()).or_insert(0);
            *penalty += 1;
            return (true, *current);
        }

        (false, *current)
    }
}

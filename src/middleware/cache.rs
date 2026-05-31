use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

static RATE_LIMIT_CACHE: Lazy<DashMap<String, (u32, u64)>> = Lazy::new(|| DashMap::new());
static PENALTY_CACHE: Lazy<DashMap<String, (u32, u64)>> = Lazy::new(|| DashMap::new());

pub struct MemoryCache;

impl MemoryCache {
    pub async fn check_rate_limit(
        limits_key: &str,
        window: u32,
        limit: u32,
        penalty_key: &str,
        _burst: u32,
        penalty_cooldown: u32,
        penalty_threshold: u32,
    ) -> (bool, u32) {
        let now = now_secs();

        // Lazy garbage collection (1/256 chance per request)
        if rand::random::<u8>() == 0 {
            RATE_LIMIT_CACHE.retain(|_, v| v.1 > now);
            PENALTY_CACHE.retain(|_, v| v.1 > now);
        }

        if let Some(mut penalty) = PENALTY_CACHE.get_mut(penalty_key) {
            if penalty.1 < now {
                penalty.0 = 0;
            }
            if penalty.0 >= penalty_threshold {
                return (true, 0); // Temporary banned
            }
        }

        let current_count;
        let mut rl_entry = RATE_LIMIT_CACHE
            .entry(limits_key.to_string())
            .or_insert((0, now + window as u64));
        if rl_entry.1 < now {
            rl_entry.0 = 1;
            rl_entry.1 = now + window as u64;
            current_count = 1;
        } else {
            rl_entry.0 += 1;
            current_count = rl_entry.0;
        }

        if current_count > limit {
            let mut penalty_entry = PENALTY_CACHE
                .entry(penalty_key.to_string())
                .or_insert((0, now + penalty_cooldown as u64));
            if penalty_entry.1 < now {
                penalty_entry.0 = 1;
                penalty_entry.1 = now + penalty_cooldown as u64;
            } else {
                penalty_entry.0 += 1;
            }
            return (true, current_count);
        }

        (false, current_count)
    }
}

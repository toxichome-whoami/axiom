use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BANS: usize = 100_000;
const BAN_TTL_SECS: u64 = 86400; // 24 hours

static IP_BANS: Lazy<DashMap<String, (String, u64)>> = Lazy::new(DashMap::new);
static KEY_BANS: Lazy<DashMap<String, (String, u64)>> = Lazy::new(DashMap::new);

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn gc(map: &DashMap<String, (String, u64)>) {
    let current = now();
    map.retain(|_, v| v.1 > current);
    if map.len() > MAX_BANS {
        let excess = map.len() - MAX_BANS;
        let keys: Vec<String> = map.iter().map(|e| e.key().clone()).take(excess).collect();
        for key in keys {
            map.remove(&key);
        }
    }
}

pub struct BanList;

impl BanList {
    pub fn is_ip_banned(ip: &str) -> (bool, String) {
        if rand::random::<u8>() == 0 {
            gc(&IP_BANS);
        }
        if let Some(entry) = IP_BANS.get(ip) {
            return (true, entry.0.clone());
        }
        (false, "".to_string())
    }

    pub fn is_key_banned(key: &str) -> (bool, String) {
        if rand::random::<u8>() == 0 {
            gc(&KEY_BANS);
        }
        if let Some(entry) = KEY_BANS.get(key) {
            return (true, entry.0.clone());
        }
        (false, "".to_string())
    }

    pub fn ban_ip(ip: &str, reason: &str) {
        if IP_BANS.len() < MAX_BANS {
            IP_BANS.insert(ip.to_string(), (reason.to_string(), now() + BAN_TTL_SECS));
        }
    }

    pub fn ban_key(key: &str, reason: &str) {
        if KEY_BANS.len() < MAX_BANS {
            KEY_BANS.insert(key.to_string(), (reason.to_string(), now() + BAN_TTL_SECS));
        }
    }
}

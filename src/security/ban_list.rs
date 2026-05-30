use dashmap::DashMap;
use once_cell::sync::Lazy;

static IP_BANS: Lazy<DashMap<String, String>> = Lazy::new(|| DashMap::new());
static KEY_BANS: Lazy<DashMap<String, String>> = Lazy::new(|| DashMap::new());

pub struct BanList;

impl BanList {
    pub fn is_ip_banned(ip: &str) -> (bool, String) {
        if let Some(reason) = IP_BANS.get(ip) {
            return (true, reason.clone());
        }
        (false, "".to_string())
    }

    pub fn is_key_banned(key: &str) -> (bool, String) {
        if let Some(reason) = KEY_BANS.get(key) {
            return (true, reason.clone());
        }
        (false, "".to_string())
    }

    pub fn ban_ip(ip: &str, reason: &str) {
        IP_BANS.insert(ip.to_string(), reason.to_string());
    }

    pub fn ban_key(key: &str, reason: &str) {
        KEY_BANS.insert(key.to_string(), reason.to_string());
    }
}

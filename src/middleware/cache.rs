use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

static RATE_LIMIT_CACHE: Lazy<DashMap<String, (u32, u64)>> = Lazy::new(DashMap::new);
static PENALTY_CACHE: Lazy<DashMap<String, (u32, u64)>> = Lazy::new(DashMap::new);

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

pub struct TursoCache;

static TURSO_DB: tokio::sync::OnceCell<libsql::Connection> = tokio::sync::OnceCell::const_new();

impl TursoCache {
    pub async fn init(url: &str, token: &str) -> Result<(), Box<dyn std::error::Error>> {
        let db = if url.starts_with("http") || url.starts_with("libsql") {
            libsql::Builder::new_remote(url.to_string(), token.to_string())
                .build()
                .await?
        } else {
            let path = url.strip_prefix("file:").unwrap_or(url);
            if let Some(parent) = std::path::Path::new(path).parent() {
                std::fs::create_dir_all(parent)?;
            }
            libsql::Builder::new_local(path).build().await?
        };

        let conn = db.connect()?;
        
        // Initialize tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS rate_limits (
                ip TEXT PRIMARY KEY,
                hits INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )",
            (),
        ).await?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS penalties (
                ip TEXT PRIMARY KEY,
                violations INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )",
            (),
        ).await?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS query_cache (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL,
                expires_at INTEGER NOT NULL
            )",
            (),
        ).await?;

        let _ = TURSO_DB.set(conn);
        
        // Start cleanup daemon
        let handle = tokio::spawn(async move {
            let conn = TURSO_DB.get().unwrap();
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                let now = now_secs() as i64;
                let _ = conn.execute("DELETE FROM rate_limits WHERE expires_at < ?1", libsql::params![now]).await;
                let _ = conn.execute("DELETE FROM penalties WHERE expires_at < ?1", libsql::params![now]).await;
                let _ = conn.execute("DELETE FROM query_cache WHERE expires_at < ?1", libsql::params![now]).await;
            }
        });
        crate::server::lifespan::register_daemon(handle);

        Ok(())
    }

    pub async fn check_rate_limit(
        client_ip: &str,
        window: u32,
        limit: u32,
        _burst: u32,
        penalty_cooldown: u32,
        penalty_threshold: u32,
    ) -> (bool, u32) {
        let Some(conn) = TURSO_DB.get() else {
            return MemoryCache::check_rate_limit(
                &format!("rl:ip:{}", client_ip), window, limit, &format!("penalty:{}", client_ip), _burst, penalty_cooldown, penalty_threshold
            ).await;
        };

        let now = now_secs() as i64;
        let expires_at = now + window as i64;
        let penalty_expires = now + penalty_cooldown as i64;

        // Check if IP is currently banned
        if let Ok(mut rows) = conn.query("SELECT violations FROM penalties WHERE ip = ?1 AND expires_at > ?2", libsql::params![client_ip.to_string(), now]).await {
            if let Ok(Some(row)) = rows.next().await {
                let violations: i32 = row.get(0).unwrap_or(0);
                if violations >= penalty_threshold as i32 {
                    return (true, 0);
                }
            }
        }

        // Increment hit count
        let _ = conn.execute(
            "INSERT INTO rate_limits (ip, hits, expires_at) 
             VALUES (?1, 1, ?2) 
             ON CONFLICT(ip) DO UPDATE SET 
             hits = CASE WHEN expires_at < ?3 THEN 1 ELSE hits + 1 END,
             expires_at = CASE WHEN expires_at < ?3 THEN ?2 ELSE expires_at END",
             libsql::params![client_ip.to_string(), expires_at, now]
        ).await;

        let mut hits = 1;
        if let Ok(mut rows) = conn.query("SELECT hits FROM rate_limits WHERE ip = ?1", libsql::params![client_ip.to_string()]).await {
            if let Ok(Some(row)) = rows.next().await {
                hits = row.get(0).unwrap_or(1);
            }
        }

        if hits > limit as i32 {
            // Apply penalty
            let _ = conn.execute(
                "INSERT INTO penalties (ip, violations, expires_at)
                 VALUES (?1, 1, ?2)
                 ON CONFLICT(ip) DO UPDATE SET 
                 violations = CASE WHEN expires_at < ?3 THEN 1 ELSE violations + 1 END,
                 expires_at = CASE WHEN expires_at < ?3 THEN ?2 ELSE expires_at END",
                 libsql::params![client_ip.to_string(), penalty_expires, now]
            ).await;
            return (true, hits as u32);
        }

        (false, hits as u32)
    }

    pub async fn get_query_cache(key: &str) -> Option<bytes::Bytes> {
        let conn = TURSO_DB.get()?;
        let now = now_secs() as i64;
        if let Ok(mut rows) = conn.query("SELECT value FROM query_cache WHERE key = ?1 AND expires_at > ?2", libsql::params![key.to_string(), now]).await {
            if let Ok(Some(row)) = rows.next().await {
                let bytes: Vec<u8> = row.get(0).ok()?;
                return Some(bytes::Bytes::from(bytes));
            }
        }
        None
    }

    pub async fn set_query_cache(key: &str, value: &[u8], ttl_secs: u32) {
        if let Some(conn) = TURSO_DB.get() {
            let expires_at = now_secs() as i64 + ttl_secs as i64;
            let _ = conn.execute(
                "INSERT INTO query_cache (key, value, expires_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
                 libsql::params![key.to_string(), value.to_vec(), expires_at]
            ).await;
        }
    }
}

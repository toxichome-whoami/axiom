
use crate::logging::rotator::LogRotator;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use tokio::task::JoinHandle;

static DAEMONS: Lazy<Mutex<Vec<JoinHandle<()>>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub async fn start_daemons() {

    let config = crate::config::loader::ConfigManager::get();
    let cache_needs_turso = config.cache.backend == "turso" || config.cache.backend == "hybrid";
    let rl_needs_turso = config.rate_limit.backend == "turso";

    if cache_needs_turso || rl_needs_turso {
        let url = if cache_needs_turso { &config.cache.turso_url } else { &config.rate_limit.turso_url };
        let token = if cache_needs_turso { &config.cache.turso_token } else { &config.rate_limit.turso_token };
        if let Err(e) = crate::middleware::cache::TursoCache::init(url, token).await {
            tracing::error!("Failed to initialize Turso cache: {}", e);
        } else if config.cache.backend == "hybrid" && config.cache.enabled && config.cache.query_cache {
            let entries = crate::middleware::cache::TursoCache::get_all_active_query_cache().await;
            let count = entries.len();
            crate::api::database::handlers::warm_cache_from_turso(entries);
            tracing::info!("Pre-warmed L1 RAM cache with {} entries from Turso L2 storage", count);
        }
    }

    let mut tasks = DAEMONS.lock().unwrap();

    let rotator_handle = LogRotator::start();
    tasks.push(rotator_handle);

    // Core daemons only
}


pub fn register_daemon(handle: tokio::task::JoinHandle<()>) {
    if let Ok(mut tasks) = DAEMONS.lock() {
        tasks.push(handle);
    }
}

pub async fn stop_daemons() {
    let mut tasks = DAEMONS.lock().unwrap();
    for task in tasks.drain(..) {
        task.abort();
    }
}

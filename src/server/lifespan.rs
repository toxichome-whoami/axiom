
use crate::logging::rotator::LogRotator;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use tokio::task::JoinHandle;

static DAEMONS: Lazy<Mutex<Vec<JoinHandle<()>>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub async fn start_daemons() {

    let config = crate::config::loader::ConfigManager::get();
    if config.cache.backend == "turso" || config.rate_limit.backend == "turso" {
        let url = if config.cache.backend == "turso" { &config.cache.turso_url } else { &config.rate_limit.turso_url };
        let token = if config.cache.backend == "turso" { &config.cache.turso_token } else { &config.rate_limit.turso_token };
        if let Err(e) = crate::middleware::cache::TursoCache::init(url, token).await {
            tracing::error!("Failed to initialize Turso cache: {}", e);
        }
    }

    let mut tasks = DAEMONS.lock().unwrap();

    let rotator_handle = LogRotator::start();
    tasks.push(rotator_handle);

    // Core daemons only
}

pub async fn stop_daemons() {
    let mut tasks = DAEMONS.lock().unwrap();
    for task in tasks.drain(..) {
        task.abort();
    }
}

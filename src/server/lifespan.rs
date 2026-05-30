use crate::config::loader::ConfigManager;
use crate::server::backup_engine::BackupEngine;
use std::sync::Mutex;
use tokio::task::JoinHandle;
use once_cell::sync::Lazy;

static DAEMONS: Lazy<Mutex<Vec<JoinHandle<()>>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub fn start_daemons() {
    let config = ConfigManager::get();
    let mut tasks = DAEMONS.lock().unwrap();

    if config.backups.enabled {
        let handle = BackupEngine::start();
        tasks.push(handle);
    }

    let rotator_handle = crate::logger::rotator::LogRotator::start();
    tasks.push(rotator_handle);

    let health_handle = tokio::spawn(crate::api::sse::daemons::health_poller());
    tasks.push(health_handle);

    let metrics_handle = tokio::spawn(crate::api::sse::daemons::metrics_pusher());
    tasks.push(metrics_handle);

    // Future daemon spawns (Webhook retries, Federation gRPC server) go here
}

pub async fn stop_daemons() {
    let mut tasks = DAEMONS.lock().unwrap();
    for task in tasks.drain(..) {
        task.abort();
    }
}

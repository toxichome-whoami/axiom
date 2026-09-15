
use crate::logging::rotator::LogRotator;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use tokio::task::JoinHandle;

static DAEMONS: Lazy<Mutex<Vec<JoinHandle<()>>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub fn start_daemons() {

    let mut tasks = DAEMONS.lock().unwrap();

    let rotator_handle = LogRotator::start();
    tasks.push(rotator_handle);

    // Future daemon spawns (Webhook retries, Federation gRPC server) go here
}

pub async fn stop_daemons() {
    let mut tasks = DAEMONS.lock().unwrap();
    for task in tasks.drain(..) {
        task.abort();
    }
}

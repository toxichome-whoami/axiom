use once_cell::sync::Lazy;
use std::sync::Arc;
use dashmap::DashMap;

use crate::config::loader::ConfigManager;
use crate::db::engines::any::AnyDatabaseEngine;
use crate::db::engines::base::DatabaseEngine;

static ENGINES: Lazy<DashMap<String, Arc<dyn DatabaseEngine>>> =
    Lazy::new(|| DashMap::new());

pub struct DatabasePoolManager;

impl DatabasePoolManager {
    pub async fn get_engine(alias: &str) -> Option<Arc<dyn DatabaseEngine>> {
        if let Some(engine) = ENGINES.get(alias) {
            return Some(engine.clone());
        }

        let config = ConfigManager::get();
        let db_config = config.database.get(alias)?;

        // Only mount if no federated alias exists
        if let Some(fed_alias) = &db_config.federated_alias {
            if !fed_alias.is_empty() {
                return None;
            }
        }

        // Global initialization lock to prevent thundering herd
        static INIT_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
        let _guard = INIT_LOCK.lock().await;

        // Double-check inside the lock
        if let Some(engine) = ENGINES.get(alias) {
            return Some(engine.clone());
        }

        println!("Initializing database pool: {}", alias);

        let mut engine = AnyDatabaseEngine::new(db_config.clone());
        if let Err(e) = engine.connect().await {
            eprintln!("Failed to connect to database {}: {}", alias, e);
            return None;
        }

        let arc_engine: Arc<dyn DatabaseEngine> = Arc::new(engine);
        ENGINES.insert(alias.to_string(), arc_engine.clone());

        Some(arc_engine)
    }

    pub async fn remove_engine(alias: &str) {
        if let Some((_, engine)) = ENGINES.remove(alias) {
            println!("Closing pool for dynamically removed database: {}", alias);
            let _ = engine.disconnect().await;
        }
    }

    pub async fn shutdown() {
        println!("Shutting down database pools");
        for entry in ENGINES.iter() {
            println!("Closing pool: {}", entry.key());
            let _ = entry.value().disconnect().await;
        }
        ENGINES.clear();
        println!("Database shutdown complete");
    }
}

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::loader::ConfigManager;
use crate::db::engines::any::AnyDatabaseEngine;
use crate::db::engines::base::DatabaseEngine;

static ENGINES: Lazy<Arc<RwLock<HashMap<String, Arc<tokio::sync::RwLock<dyn DatabaseEngine>>>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

pub struct DatabasePoolManager;

impl DatabasePoolManager {
    pub async fn get_engine(alias: &str) -> Option<Arc<tokio::sync::RwLock<dyn DatabaseEngine>>> {
        let readers = ENGINES.read().await;
        if let Some(engine) = readers.get(alias) {
            return Some(engine.clone());
        }
        drop(readers);

        let config = ConfigManager::get();
        let db_config = config.database.get(alias)?;

        // Only mount if no federated alias exists
        if let Some(fed_alias) = &db_config.federated_alias {
            if !fed_alias.is_empty() {
                return None;
            }
        }

        let mut writers = ENGINES.write().await;
        // Double-check inside the write lock to prevent thundering herd under high concurrency
        if let Some(engine) = writers.get(alias) {
            return Some(engine.clone());
        }

        println!("Initializing database pool: {}", alias);

        let mut engine = AnyDatabaseEngine::new(db_config.clone());
        if let Err(e) = engine.connect().await {
            eprintln!("Failed to connect to database {}: {}", alias, e);
            return None;
        }

        let arc_engine: Arc<tokio::sync::RwLock<dyn DatabaseEngine>> =
            Arc::new(tokio::sync::RwLock::new(engine));
        writers.insert(alias.to_string(), arc_engine.clone());

        Some(arc_engine)
    }

    pub async fn remove_engine(alias: &str) {
        let mut writers = ENGINES.write().await;
        if let Some(engine) = writers.remove(alias) {
            println!("Closing pool for dynamically removed database: {}", alias);
            let locked = engine.write().await;
            let _ = locked.disconnect().await;
        }
    }

    pub async fn shutdown() {
        println!("Shutting down database pools");
        let mut writers = ENGINES.write().await;
        for (alias, engine) in writers.drain() {
            println!("Closing pool: {}", alias);
            let locked = engine.write().await;
            let _ = locked.disconnect().await;
        }
        println!("Database shutdown complete");
    }
}

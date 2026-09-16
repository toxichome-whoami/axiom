use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::Arc;

use crate::config::loader::ConfigManager;
use crate::db::engines::base::DatabaseEngine;
use crate::db::engines::libsql::LibsqlDatabaseEngine;
use crate::db::engines::mssql::MssqlDatabaseEngine;
use crate::db::engines::mysql::MysqlDatabaseEngine;
use crate::db::engines::postgres::PostgresDatabaseEngine;
use crate::db::engines::clickhouse::ClickHouseDatabaseEngine;

static ENGINES: Lazy<DashMap<String, Arc<dyn DatabaseEngine>>> = Lazy::new(DashMap::new);

pub struct DatabasePoolManager;

impl DatabasePoolManager {
    pub async fn get_engine(alias: &str) -> Option<Arc<dyn DatabaseEngine>> {
        if let Some(engine) = ENGINES.get(alias) {
            return Some(engine.clone());
        }

        let config = ConfigManager::get();
        let db_config = config.database.get(alias)?;

        // Do not attempt to connect if the URL is empty
        if db_config.url.is_empty() {
            eprintln!("Database {} has an empty URL, skipping connection.", alias);
            return None;
        }

        // Global initialization lock to prevent thundering herd
        static INIT_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
        let _guard = INIT_LOCK.lock().await;

        // Double-check inside the lock
        if let Some(engine) = ENGINES.get(alias) {
            return Some(engine.clone());
        }

        println!("Initializing database pool: {}", alias);

        let url = db_config.url.as_str();
        let arc_engine: Arc<dyn DatabaseEngine> =
            if url.starts_with("mssql://") || url.starts_with("sqlserver://") {
                let mut engine = MssqlDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    eprintln!("Failed to connect to MSSQL {}: {}", alias, e);
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("sqlite://") || url.starts_with("libsql://") {
                let mut engine = LibsqlDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    eprintln!("Failed to connect to SQLite/Turso {}: {}", alias, e);
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("postgres://") || url.starts_with("postgresql://") {
                let mut engine = PostgresDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    eprintln!("Failed to connect to Postgres {}: {}", alias, e);
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("clickhouse://") || url.starts_with("clickhouse+https://") {
                let mut engine = ClickHouseDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    eprintln!("Failed to connect to ClickHouse {}: {}", alias, e);
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("mysql://") || url.starts_with("mariadb://") {
                let mut engine = MysqlDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    eprintln!("Failed to connect to MySQL {}: {}", alias, e);
                    return None;
                }
                Arc::new(engine)
            } else {
                eprintln!("Unsupported database URL protocol: {}", url);
                return None;
            };

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


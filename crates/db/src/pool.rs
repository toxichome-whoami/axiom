/*
 * Database connection pool registry and lazy engine initialization manager.
 * Owned by: db
 * Key deps: dashmap::DashMap, tokio::sync::Mutex, crate::config, crate::db::engines
 * Invariants: Engine initialization is lazy and locked per-alias; shutdown cleanly disconnects all active pools.
 * Last structural change: Phase 0 cleanup replacing global INIT_LOCK with per-alias locks (Debt #8).
 */

use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::Arc;

use axiom_core::ConfigManager;
use crate::engines::base::DatabaseEngine;
use crate::engines::clickhouse::ClickHouseDatabaseEngine;
use crate::engines::libsql::LibsqlDatabaseEngine;
use crate::engines::mssql::MssqlDatabaseEngine;
use crate::engines::mysql::MysqlDatabaseEngine;
use crate::engines::postgres::PostgresDatabaseEngine;

// ─── Engine Registry & Per-Alias Synchronization ───────────────────────────
// Active connected database engine singletons keyed by configuration alias name.
static ENGINES: Lazy<DashMap<String, Arc<dyn DatabaseEngine>>> = Lazy::new(DashMap::new);

// Per-alias mutex map. Prevents thundering-herd connection attempts on cold-start
// without creating head-of-line blocking across unrelated databases (Debt #8).
static INIT_LOCKS: Lazy<DashMap<String, Arc<tokio::sync::Mutex<()>>>> = Lazy::new(DashMap::new);

pub struct DatabasePoolManager;

impl DatabasePoolManager {
    /// Retrieves an existing engine instance or lazily initializes a new connection pool.
    /// CONTRACT:
    ///  - Precondition: `alias` corresponds to a configured entry in `config.toml`.
    ///  - Returns `Some(Arc<dyn DatabaseEngine>)` if connected or already active, `None` on failure or empty URL.
    ///  - Side effects: Initializes pool on first call and caches engine in `ENGINES`.
    ///  - Idempotent: Yes (subsequent calls return the cached Arc).
    pub async fn get_engine(alias: &str) -> Option<Arc<dyn DatabaseEngine>> {
        // Fast-path: Lock-free read for pre-initialized engines
        if let Some(engine) = ENGINES.get(alias) {
            return Some(engine.clone());
        }

        let config = ConfigManager::get();
        let db_config = if let Some(cfg) = config.database.get(alias) {
            cfg.clone()
        } else {
            let snapshot = axiom_metadata::get_snapshot();
            let snap_db = snapshot.databases.get(alias)?;
            axiom_core::config::schema::DatabaseDefConfig {
                url: snap_db.url.clone(),
                pool_min: snap_db.pool_min as i32,
                pool_max: snap_db.pool_max as i32,
                ..Default::default()
            }
        };

        // Do not attempt to connect if the URL is empty
        if db_config.url.is_empty() {
            tracing::warn!(database = alias, "Database has an empty URL, skipping connection");
            return None;
        }

        // Per-alias mutex avoids thundering herd on single alias without blocking other aliases
        let lock = INIT_LOCKS
            .entry(alias.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        let _guard = lock.lock().await;

        // Double-check inside the lock to ensure another task didn't connect while waiting
        if let Some(engine) = ENGINES.get(alias) {
            return Some(engine.clone());
        }

        tracing::info!(database = alias, "Initializing database connection pool");

        let url = db_config.url.as_str();
        let arc_engine: Arc<dyn DatabaseEngine> =
            if url.starts_with("mssql://") || url.starts_with("sqlserver://") {
                let mut engine = MssqlDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    tracing::error!(database = alias, error = %e, "Failed to connect to MSSQL");
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("sqlite://") || url.starts_with("libsql://") {
                let mut engine = LibsqlDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    tracing::error!(database = alias, error = %e, "Failed to connect to SQLite/Turso");
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("postgres://") || url.starts_with("postgresql://") {
                let mut engine = PostgresDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    tracing::error!(database = alias, error = %e, "Failed to connect to Postgres");
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("clickhouse://") || url.starts_with("clickhouse+https://") {
                let mut engine = ClickHouseDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    tracing::error!(database = alias, error = %e, "Failed to connect to ClickHouse");
                    return None;
                }
                Arc::new(engine)
            } else if url.starts_with("mysql://") || url.starts_with("mariadb://") {
                let mut engine = MysqlDatabaseEngine::new(db_config.clone());
                if let Err(e) = engine.connect().await {
                    tracing::error!(database = alias, error = %e, "Failed to connect to MySQL");
                    return None;
                }
                Arc::new(engine)
            } else {
                tracing::error!(database = alias, url = url, "Unsupported database URL protocol");
                return None;
            };

        ENGINES.insert(alias.to_string(), arc_engine.clone());

        Some(arc_engine)
    }

    /// Disconnects and removes an engine from the active pool registry.
    /// CONTRACT:
    ///  - Side effects: Removes entry from `ENGINES` and invokes engine `disconnect()`.
    ///  - Idempotent: Yes.
    pub async fn remove_engine(alias: &str) {
        if let Some((_, engine)) = ENGINES.remove(alias) {
            tracing::info!(database = alias, "Closing pool for dynamically removed database");
            let _ = engine.disconnect().await;
        }
    }

    /// Gracefully closes all active database connections during server shutdown.
    /// CONTRACT:
    ///  - Side effects: Drains `ENGINES` map and awaits `disconnect()` across all active pools.
    ///  - Idempotent: Yes.
    pub async fn shutdown() {
        tracing::info!("Shutting down database connection pools");
        for entry in ENGINES.iter() {
            tracing::info!(database = entry.key().as_str(), "Closing pool");
            let _ = entry.value().disconnect().await;
        }
        ENGINES.clear();
        INIT_LOCKS.clear();
        tracing::info!("Database shutdown complete");
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────
// Unit tests for the connection pool manager, dynamic lazy loading, and shutdown.

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pool_manager_unknown_alias_returns_none() {
        let engine = DatabasePoolManager::get_engine("unknown_alias_xyz_123").await;
        assert!(engine.is_none());
    }

    #[tokio::test]
    async fn test_pool_manager_dynamic_metadata_lookup_and_removal() {
        let snapshot = axiom_metadata::get_snapshot();
        let db_snap = axiom_metadata::DatabaseSnapshot {
            alias: "unit_test_mem_db".to_string(),
            url: "sqlite://:memory:".to_string(),
            engine: "sqlite".to_string(),
            pool_min: 1,
            pool_max: 2,
        };
        let mut databases = snapshot.databases.clone();
        databases.insert("unit_test_mem_db".to_string(), db_snap);
        axiom_metadata::update_snapshot(axiom_metadata::MetadataSnapshot {
            keys: snapshot.keys.clone(),
            roles: snapshot.roles.clone(),
            databases,
            loaded_at_unix: 1,
        });

        // 1. Lazy connect through pool manager
        let engine = DatabasePoolManager::get_engine("unit_test_mem_db").await;
        assert!(engine.is_some());
        let engine = engine.unwrap();
        assert_eq!(engine.dialect(), "sqlite");
        assert!(engine.health_check().await);

        // 2. Remove engine from active pool
        DatabasePoolManager::remove_engine("unit_test_mem_db").await;
        assert!(!ENGINES.contains_key("unit_test_mem_db"));
    }
}


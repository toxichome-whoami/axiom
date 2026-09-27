/*
 * Persistent SQLite/Turso metadata store operations, schema migration, and snapshot synchronization.
 * Owned by: metadata
 * Key deps: libsql, argon2, blake3, crate::config, crate::metadata::snapshot
 * Invariants: Database mutations write to SQLite first, then immediately publish an updated ArcSwap snapshot.
 * Last structural change: Phase 1 initial implementation of MetadataStore with auto-seeding.
 */

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use libsql::{Builder, Connection, Database};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, OnceCell};

use crate::config::schema::AxiomConfig;
use crate::metadata::models::*;
use crate::metadata::snapshot::{
    update_snapshot, ApiKeySnapshot, DatabaseSnapshot, MetadataSnapshot, PermissionSnapshot,
    RoleSnapshot,
};

// ─── Connection Registry ───────────────────────────────────────────────────
static METADATA_CONN: OnceCell<Arc<Mutex<Connection>>> = OnceCell::const_new();
static STORE_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

pub struct MetadataStore;

impl MetadataStore {
    /// Initializes the metadata database connection and creates required schema tables.
    /// CONTRACT:
    ///  - Precondition: `url` must be a valid libsql or sqlite URI.
    ///  - Side effects: Creates local directory if needed; runs table DDL; populates OnceCell.
    ///  - Idempotent: Yes (subsequent calls return active connection).
    pub async fn init(url: &str, token: &str) -> Result<(), String> {
        if METADATA_CONN.get().is_some() {
            return Ok(());
        }

        // Ensure parent directory exists if using local file path
        if url.starts_with("file:") || url.starts_with("sqlite:") {
            let path_str = url.replace("sqlite://", "").replace("file:", "");
            if let Some(parent) = std::path::Path::new(&path_str).parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
            }
        }

        let db: Database = if url.starts_with("libsql://") || url.starts_with("https://") {
            Builder::new_remote(url.to_string(), token.to_string())
                .build()
                .await
                .map_err(|e| format!("Failed to connect to remote Turso metadata: {}", e))?
        } else {
            let path = url.replace("sqlite://", "").replace("file:", "");
            Builder::new_local(path)
                .build()
                .await
                .map_err(|e| format!("Failed to initialize local metadata SQLite: {}", e))?
        };

        let conn = db
            .connect()
            .map_err(|e| format!("Failed to open metadata connection: {}", e))?;

        // Initialize schema tables
        Self::create_tables(&conn).await?;

        let _ = METADATA_CONN.set(Arc::new(Mutex::new(conn)));

        // Synchronize in-memory snapshot immediately upon connection
        Self::sync_snapshot().await?;

        Ok(())
    }

    /// Executes table creation DDL statements.
    async fn create_tables(conn: &Connection) -> Result<(), String> {
        let statements = [
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS roles (
                name TEXT PRIMARY KEY,
                description TEXT,
                created_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
                database TEXT NOT NULL,
                table_name TEXT NOT NULL,
                operations TEXT NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS api_keys (
                name TEXT PRIMARY KEY,
                secret_hash BLOB NOT NULL,
                role_name TEXT REFERENCES roles(name) ON DELETE SET NULL,
                rate_limit INTEGER DEFAULT 0,
                expires_at INTEGER,
                created_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS databases (
                alias TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                engine TEXT NOT NULL,
                pool_min INTEGER DEFAULT 1,
                pool_max INTEGER DEFAULT 10,
                created_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                details TEXT
            );",
        ];

        for stmt in statements {
            conn.execute(stmt, ())
                .await
                .map_err(|e| format!("Metadata schema creation failed on '{}': {}", stmt, e))?;
        }

        Ok(())
    }

    /// Acquires a lock on the connection handle.
    async fn get_conn() -> Result<tokio::sync::MutexGuard<'static, Connection>, String> {
        let conn_arc = METADATA_CONN
            .get()
            .ok_or_else(|| "Metadata store not initialized".to_string())?;
        Ok(conn_arc.lock().await)
    }

    /// Reads all active configuration records from SQLite and constructs an immutable snapshot.
    /// CONTRACT:
    ///  - Returns `MetadataSnapshot` ready to be loaded into `GLOBAL_METADATA`.
    ///  - Side effects: Reads SQLite tables.
    ///  - Idempotent: Yes.
    pub async fn load_snapshot() -> Result<MetadataSnapshot, String> {
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // 1. Load roles and permissions
        let mut roles_map: HashMap<String, RoleSnapshot> = HashMap::new();
        let mut role_rows = conn
            .query("SELECT name FROM roles", ())
            .await
            .map_err(|e| format!("Query roles failed: {}", e))?;

        while let Ok(Some(row)) = role_rows.next().await {
            if let Ok(name) = row.get_str(0) {
                roles_map.insert(
                    name.to_string(),
                    RoleSnapshot {
                        name: name.to_string(),
                        permissions: Vec::new(),
                    },
                );
            }
        }

        let mut perm_rows = conn
            .query(
                "SELECT role_name, database, table_name, operations FROM permissions",
                (),
            )
            .await
            .map_err(|e| format!("Query permissions failed: {}", e))?;

        while let Ok(Some(row)) = perm_rows.next().await {
            if let (Ok(role_name), Ok(database), Ok(table_name), Ok(ops_json)) = (
                row.get_str(0),
                row.get_str(1),
                row.get_str(2),
                row.get_str(3),
            ) {
                let operations: Vec<String> = serde_json::from_str(ops_json).unwrap_or_default();
                if let Some(role) = roles_map.get_mut(role_name) {
                    role.permissions.push(PermissionSnapshot {
                        database: database.to_string(),
                        table_name: table_name.to_string(),
                        operations,
                    });
                }
            }
        }

        // 2. Load API keys
        let mut keys_map: HashMap<String, ApiKeySnapshot> = HashMap::new();
        let mut key_rows = conn
            .query(
                "SELECT name, secret_hash, role_name, rate_limit, expires_at FROM api_keys",
                (),
            )
            .await
            .map_err(|e| format!("Query api_keys failed: {}", e))?;

        while let Ok(Some(row)) = key_rows.next().await {
            let name: String = row.get(0).map_err(|e| e.to_string())?;
            let hash_blob: Vec<u8> = row.get(1).map_err(|e| e.to_string())?;
            let role_name: Option<String> = row.get(2).ok();
            let rate_limit: i64 = row.get(3).unwrap_or(0);
            let expires_at: Option<i64> = row.get(4).ok();

            if hash_blob.len() == 32 {
                let mut secret_hash = [0u8; 32];
                secret_hash.copy_from_slice(&hash_blob);

                keys_map.insert(
                    name.clone(),
                    ApiKeySnapshot {
                        name,
                        secret_hash,
                        role_name,
                        rate_limit_override: rate_limit as u32,
                        expires_at,
                    },
                );
            }
        }

        // 3. Load database configurations
        let mut dbs_map: HashMap<String, DatabaseSnapshot> = HashMap::new();
        let mut db_rows = conn
            .query(
                "SELECT alias, url, engine, pool_min, pool_max FROM databases",
                (),
            )
            .await
            .map_err(|e| format!("Query databases failed: {}", e))?;

        while let Ok(Some(row)) = db_rows.next().await {
            let alias: String = row.get(0).map_err(|e| e.to_string())?;
            let url: String = row.get(1).map_err(|e| e.to_string())?;
            let engine: String = row.get(2).map_err(|e| e.to_string())?;
            let pool_min: i64 = row.get(3).unwrap_or(1);
            let pool_max: i64 = row.get(4).unwrap_or(10);

            dbs_map.insert(
                alias.clone(),
                DatabaseSnapshot {
                    alias,
                    url,
                    engine,
                    pool_min: pool_min as u32,
                    pool_max: pool_max as u32,
                },
            );
        }

        Ok(MetadataSnapshot {
            keys: keys_map,
            roles: roles_map,
            databases: dbs_map,
            loaded_at_unix: now_unix,
        })
    }

    /// Loads the latest state from SQLite and atomically publishes the new ArcSwap snapshot.
    pub async fn sync_snapshot() -> Result<(), String> {
        let snapshot = Self::load_snapshot().await?;
        update_snapshot(snapshot);
        Ok(())
    }

    /// Seeds legacy `[api_key.*]` and `[database.*]` from `config.toml` on first boot if store is empty.
    /// CONTRACT:
    ///  - Precondition: Invoked once during server startup after `MetadataStore::init`.
    ///  - Side effects: Inserts legacy configurations into SQLite and logs to audit table.
    ///  - Idempotent: Yes (skips seeding if api_keys table contains records).
    pub async fn seed_from_config(config: &AxiomConfig) -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        // Check if api_keys is already populated
        let mut count_rows = conn
            .query("SELECT COUNT(*) FROM api_keys", ())
            .await
            .map_err(|e| e.to_string())?;

        let key_count: i64 = if let Ok(Some(row)) = count_rows.next().await {
            row.get(0).unwrap_or(0)
        } else {
            0
        };

        if key_count > 0 {
            // Already initialized; do not overwrite live state with static config
            return Ok(());
        }

        tracing::info!("First-boot detected: auto-seeding metadata store from config.toml");
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // Seed databases
        for (alias, db_cfg) in &config.database {
            let engine_dialect = if db_cfg.url.starts_with("postgres") {
                "postgres"
            } else if db_cfg.url.starts_with("mysql") || db_cfg.url.starts_with("mariadb") {
                "mysql"
            } else if db_cfg.url.starts_with("mssql") || db_cfg.url.starts_with("sqlserver") {
                "mssql"
            } else if db_cfg.url.starts_with("clickhouse") {
                "clickhouse"
            } else {
                "sqlite"
            };

            conn.execute(
                "INSERT OR REPLACE INTO databases (alias, url, engine, pool_min, pool_max, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                libsql::params![
                    alias.as_str(),
                    db_cfg.url.as_str(),
                    engine_dialect,
                    db_cfg.pool_min as i64,
                    db_cfg.pool_max as i64,
                    now_unix
                ],
            )
            .await
            .map_err(|e| format!("Seeding database {} failed: {}", alias, e))?;
        }

        // Seed API keys and their synthesized initial roles
        for (key_name, key_cfg) in &config.api_key {
            let role_name = format!("{}_role", key_name);

            // Create synthesized role
            conn.execute(
                "INSERT OR IGNORE INTO roles (name, description, created_at) VALUES (?1, ?2, ?3)",
                libsql::params![
                    role_name.as_str(),
                    format!("Auto-generated role for key {}", key_name),
                    now_unix
                ],
            )
            .await
            .map_err(|e| format!("Seeding role {} failed: {}", role_name, e))?;

            // Determine permissions based on full_admin or mode
            let ops = if key_cfg.full_admin {
                vec!["SELECT", "INSERT", "UPDATE", "DELETE"]
            } else {
                match key_cfg.mode {
                    crate::utils::types::ServerMode::Readonly => vec!["SELECT"],
                    _ => vec!["SELECT", "INSERT", "UPDATE", "DELETE"],
                }
            };
            let ops_json = serde_json::to_string(&ops).unwrap_or_else(|_| "[\"SELECT\"]".into());

            for db_target in &key_cfg.db_scope {
                conn.execute(
                    "INSERT INTO permissions (role_name, database, table_name, operations) \
                     VALUES (?1, ?2, ?3, ?4)",
                    libsql::params![
                        role_name.as_str(),
                        db_target.as_str(),
                        "*",
                        ops_json.as_str()
                    ],
                )
                .await
                .map_err(|e| format!("Seeding permission failed: {}", e))?;
            }

            // Hash secret using BLAKE3
            let secret_hash = blake3::hash(key_cfg.secret.as_bytes());
            let hash_blob = secret_hash.as_bytes().to_vec();

            conn.execute(
                "INSERT OR REPLACE INTO api_keys (name, secret_hash, role_name, rate_limit, expires_at, created_at) \
                 VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
                libsql::params![
                    key_name.as_str(),
                    hash_blob,
                    role_name.as_str(),
                    key_cfg.rate_limit_override as i64,
                    now_unix
                ],
            )
            .await
            .map_err(|e| format!("Seeding API key {} failed: {}", key_name, e))?;
        }

        // Record audit entry
        conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'system', 'metadata.seed', 'axiom.db', 'Auto-seeded initial configuration from config.toml')",
            libsql::params![now_unix],
        )
        .await
        .map_err(|e| format!("Recording seed audit failed: {}", e))?;

        drop(conn);
        Self::sync_snapshot().await?;
        tracing::info!("Auto-seeding completed; live ArcSwap metadata snapshot published");

        Ok(())
    }

    // ─── Key Management API ────────────────────────────────────────────────

    /// Creates a new API key, persists BLAKE3 hash to SQLite, and returns generated secret.
    pub async fn create_key(
        name: &str,
        role_name: Option<&str>,
        custom_secret: Option<&str>,
        rate_limit: i64,
        expires_at: Option<i64>,
    ) -> Result<String, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let secret = match custom_secret {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => uuid::Uuid::new_v4().to_string().replace('-', ""),
        };

        let secret_hash = blake3::hash(secret.as_bytes());
        let hash_blob = secret_hash.as_bytes().to_vec();

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO api_keys (name, secret_hash, role_name, rate_limit, expires_at, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            libsql::params![
                name,
                hash_blob,
                role_name.unwrap_or(""),
                rate_limit,
                expires_at,
                now_unix
            ],
        )
        .await
        .map_err(|e| format!("Failed to create API key: {}", e))?;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(secret)
    }

    /// Deletes an API key by name and refreshes the in-memory snapshot.
    pub async fn delete_key(name: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute("DELETE FROM api_keys WHERE name = ?1", [name])
            .await
            .map_err(|e| format!("Failed to delete API key: {}", e))?;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(affected > 0)
    }

    /// Lists all registered API keys (without disclosing secret hashes).
    pub async fn list_keys() -> Result<Vec<ApiKeyRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT name, role_name, rate_limit, expires_at, created_at FROM api_keys ORDER BY created_at DESC",
                (),
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut keys = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let name: String = row.get(0).map_err(|e| e.to_string())?;
            let role_name: Option<String> = row.get(1).ok();
            let rate_limit: i64 = row.get(2).unwrap_or(0);
            let expires_at: Option<i64> = row.get(3).ok();
            let created_at: i64 = row.get(4).unwrap_or(0);

            keys.push(ApiKeyRecord {
                name,
                secret_hash: Vec::new(), // Redacted for security
                role_name,
                rate_limit,
                expires_at,
                created_at,
            });
        }
        Ok(keys)
    }

    // ─── Managed Database Management ──────────────────────────────────────
    // Direct manipulation of connected upstream databases. Any mutation here must
    // sync to the live snapshot to maintain routing integrity across concurrent queries.

    /// Adds or updates a target database configuration and refreshes the snapshot.
    /// CONTRACT:
    ///  - Precondition: `alias` non-empty identifier; `url` valid connection string.
    ///  - Side effects: Writes to SQLite `databases` table, logs audit event, updates ArcSwap snapshot.
    ///  - Idempotent: Yes (upsert behavior).
    pub async fn add_database(
        alias: &str,
        url: &str,
        engine: Option<&str>,
        pool_min: Option<i64>,
        pool_max: Option<i64>,
    ) -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        // Dialect inference if not explicitly provided
        let engine_dialect = if let Some(e) = engine {
            e.to_string()
        } else if url.starts_with("postgres") {
            "postgres".to_string()
        } else if url.starts_with("mysql") || url.starts_with("mariadb") {
            "mysql".to_string()
        } else if url.starts_with("mssql") || url.starts_with("sqlserver") {
            "mssql".to_string()
        } else if url.starts_with("clickhouse") {
            "clickhouse".to_string()
        } else {
            "sqlite".to_string()
        };

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT OR REPLACE INTO databases (alias, url, engine, pool_min, pool_max, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            libsql::params![
                alias,
                url,
                engine_dialect.as_str(),
                pool_min.unwrap_or(1),
                pool_max.unwrap_or(10),
                now_unix
            ],
        )
        .await
        .map_err(|e| format!("Failed to register database: {}", e))?;

        // Audit log entry for tracking infrastructure modifications
        let _ = conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'db.add', ?2, ?3)",
            libsql::params![now_unix, alias, format!("engine={}", engine_dialect)],
        ).await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(())
    }

    /// Removes a registered database configuration and removes it from the snapshot.
    /// CONTRACT:
    ///  - Side effects: Deletes from `databases` table, logs audit event, updates snapshot.
    ///  - Idempotent: Yes.
    pub async fn delete_database(alias: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute("DELETE FROM databases WHERE alias = ?1", [alias])
            .await
            .map_err(|e| format!("Failed to delete database: {}", e))?;

        if affected > 0 {
            let now_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let _ = conn.execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'db.delete', ?2, NULL)",
                libsql::params![now_unix, alias],
            ).await;
        }

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(affected > 0)
    }

    /// Lists all configured databases from the metadata store.
    /// CONTRACT:
    ///  - Returns list of DatabaseRecord models.
    ///  - Invariant: Connection URL credentials are masked/skipped during serialization.
    pub async fn list_databases() -> Result<Vec<DatabaseRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT alias, url, engine, pool_min, pool_max, created_at FROM databases ORDER BY alias ASC",
                (),
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut databases = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let alias: String = row.get(0).map_err(|e| e.to_string())?;
            let url: String = row.get(1).map_err(|e| e.to_string())?;
            let engine: String = row.get(2).map_err(|e| e.to_string())?;
            let pool_min: i64 = row.get(3).unwrap_or(1);
            let pool_max: i64 = row.get(4).unwrap_or(10);
            let created_at: i64 = row.get(5).unwrap_or(0);

            databases.push(DatabaseRecord {
                alias,
                url,
                engine,
                pool_min,
                pool_max,
                created_at,
            });
        }
        Ok(databases)
    }

    // ─── Human User (Admin) Management ─────────────────────────────────────

    /// Creates the initial admin user using Argon2id password hashing.
    pub async fn create_user(username: &str, password: &str) -> Result<(), String> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| format!("Argon2 hashing failed: {}", e))?
            .to_string();

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let conn = Self::get_conn().await?;
        conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?1, ?2, ?3)",
            libsql::params![username, password_hash.as_str(), now_unix],
        )
        .await
        .map_err(|e| format!("Failed to create user: {}", e))?;

        Ok(())
    }

    /// Verifies an admin user's credentials using constant-time Argon2 verification.
    pub async fn verify_user(username: &str, password: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT password_hash FROM users WHERE username = ?1",
                [username],
            )
            .await
            .map_err(|e| e.to_string())?;

        if let Ok(Some(row)) = rows.next().await {
            let stored_hash: String = row.get(0).map_err(|e| e.to_string())?;
            let parsed_hash = PasswordHash::new(&stored_hash)
                .map_err(|e| format!("Invalid stored password hash: {}", e))?;
            Ok(Argon2::default()
                .verify_password(password.as_bytes(), &parsed_hash)
                .is_ok())
        } else {
            Ok(false)
        }
    }

    /// Checks if any admin users exist in the system (used by setup wizard).
    pub async fn has_users() -> Result<bool, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query("SELECT COUNT(*) FROM users", ())
            .await
            .map_err(|e| e.to_string())?;
        if let Ok(Some(row)) = rows.next().await {
            let count: i64 = row.get(0).unwrap_or(0);
            Ok(count > 0)
        } else {
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blake3_hashing_properties() {
        let secret = "axiom_super_secret_key_12345";
        let hash1 = blake3::hash(secret.as_bytes());
        let hash2 = blake3::hash(secret.as_bytes());

        // Invariant: BLAKE3 hashes must be 32 bytes and deterministic
        assert_eq!(hash1.as_bytes().len(), 32);
        assert_eq!(hash1.as_bytes(), hash2.as_bytes());

        let wrong_hash = blake3::hash(b"wrong_secret");
        assert_ne!(hash1.as_bytes(), wrong_hash.as_bytes());
    }

    #[test]
    fn test_argon2_password_hash_and_verify() {
        let password = "AdminSecurePassword987!";
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .unwrap()
            .to_string();

        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(argon2.verify_password(password.as_bytes(), &parsed).is_ok());
        assert!(argon2.verify_password(b"WrongPassword", &parsed).is_err());
    }
}


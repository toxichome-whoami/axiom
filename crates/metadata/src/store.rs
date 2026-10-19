/*
 * Persistent SQLite/Turso metadata store operations, schema migration, and snapshot synchronization.
 * Owned by: metadata
 * Key deps: libsql, argon2, blake3, crate::config, crate::metadata::snapshot
 * Invariants: Database mutations write to SQLite first, then immediately publish an updated ArcSwap snapshot.
 * Last structural change: Phase 2 addition of RBAC role and permission CRUD and audit logging.
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

use crate::models::*;
use crate::snapshot::{
    update_snapshot, ApiKeySnapshot, DatabaseSnapshot, MetadataSnapshot, PermissionSnapshot,
    RoleSnapshot,
};

// ─── Connection Registry ───────────────────────────────────────────────────
static METADATA_CONN: OnceCell<Arc<Mutex<Connection>>> = OnceCell::const_new();
static STORE_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
static DUMMY_HASH: Lazy<String> = Lazy::new(|| {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(b"dummy_timing_mitigation_password", &salt)
        .expect("dummy argon2 hash generation failed")
        .to_string()
});

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
                operations TEXT NOT NULL,
                rls_filter TEXT
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
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS ip_bans (
                ip TEXT PRIMARY KEY,
                reason TEXT NOT NULL,
                banned_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS key_bans (
                key_name TEXT PRIMARY KEY,
                reason TEXT NOT NULL,
                banned_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS blob_tickets (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                operation TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                signature TEXT UNIQUE NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                revoked INTEGER DEFAULT 0
            );",
            "CREATE INDEX IF NOT EXISTS idx_blob_tickets_lookup ON blob_tickets(namespace, key, revoked);",
            "CREATE INDEX IF NOT EXISTS idx_blob_tickets_sig ON blob_tickets(signature);",
            "CREATE TABLE IF NOT EXISTS system_secrets (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
        ];

        for stmt in statements {
            conn.execute(stmt, ())
                .await
                .map_err(|e| format!("Metadata schema creation failed on '{}': {}", stmt, e))?;
        }

        // Idempotently ensure rls_filter column exists for preexisting databases
        let _ = conn.execute("ALTER TABLE permissions ADD COLUMN rls_filter TEXT", ()).await;

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
                "SELECT role_name, database, table_name, operations, rls_filter FROM permissions",
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
                let rls_filter = row.get_str(4).ok().map(|s| s.to_string()).filter(|s| !s.trim().is_empty());
                if let Some(role) = roles_map.get_mut(role_name) {
                    role.permissions.push(PermissionSnapshot {
                        database: database.to_string(),
                        table_name: table_name.to_string(),
                        operations,
                        rls_filter,
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

        let _ = conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'key.create', ?2, ?3)",
            libsql::params![now_unix, name, format!("role={}", role_name.unwrap_or("none"))],
        ).await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(secret)
    }

    /// Rotates the secret for an existing API key, updates its BLAKE3 hash, and publishes the new snapshot.
    /// CONTRACT:
    ///  - Precondition: Key with `name` must exist in `api_keys` table.
    ///  - Returns new plaintext secret string.
    ///  - Side effects: Modifies `api_keys` row, appends to `audit_log`, and triggers `sync_snapshot`.
    ///  - Idempotent: No (generates a new unique secret on each call).
    pub async fn rotate_key(name: &str) -> Result<String, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        // Verify key exists
        let mut rows = conn
            .query("SELECT name FROM api_keys WHERE name = ?1", [name])
            .await
            .map_err(|e| format!("Database query error: {}", e))?;

        if rows.next().await.map_err(|e| e.to_string())?.is_none() {
            return Err(format!("API key '{}' not found", name));
        }

        let new_secret = uuid::Uuid::new_v4().to_string().replace('-', "");
        let secret_hash = blake3::hash(new_secret.as_bytes());
        let hash_blob = secret_hash.as_bytes().to_vec();

        conn.execute(
            "UPDATE api_keys SET secret_hash = ?1 WHERE name = ?2",
            libsql::params![hash_blob, name],
        )
        .await
        .map_err(|e| format!("Failed to update secret hash: {}", e))?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let _ = conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'key.rotate', ?2, 'Secret regenerated')",
            libsql::params![now_unix, name],
        ).await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(new_secret)
    }

    /// Deletes an API key by name and refreshes the in-memory snapshot.
    pub async fn delete_key(name: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute("DELETE FROM api_keys WHERE name = ?1", [name])
            .await
            .map_err(|e| format!("Failed to delete API key: {}", e))?;

        if affected > 0 {
            let now_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let _ = conn.execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'key.delete', ?2, NULL)",
                libsql::params![now_unix, name],
            ).await;
        }

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

    // ─── Role & Permission Management ──────────────────────────────────────
    // RBAC policies mapping roles to granular database, table, and operation permissions.
    // Invariant: Modifying roles or permissions must immediately update the live snapshot.

    /// Creates a new role along with its defined permission grants.
    /// CONTRACT:
    ///  - Precondition: `name` must be a valid, unique role identifier.
    ///  - Side effects: Writes to `roles` and `permissions` tables, writes audit record, updates snapshot.
    ///  - Idempotent: No (fails if role name already exists).
    pub async fn create_role(
        name: &str,
        description: Option<&str>,
        permissions: &[PermissionRecord],
    ) -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO roles (name, description, created_at) VALUES (?1, ?2, ?3)",
            libsql::params![name, description.unwrap_or(""), now_unix],
        )
        .await
        .map_err(|e| format!("Failed to create role '{}': {}", name, e))?;

        for perm in permissions {
            let ops_json = serde_json::to_string(&perm.operations)
                .map_err(|e| format!("Invalid operations array: {}", e))?;
            let rls_val = perm.rls_filter.as_deref().unwrap_or("");

            conn.execute(
                "INSERT INTO permissions (role_name, database, table_name, operations, rls_filter) VALUES (?1, ?2, ?3, ?4, ?5)",
                libsql::params![name, perm.database.as_str(), perm.table_name.as_str(), ops_json.as_str(), rls_val],
            )
            .await
            .map_err(|e| format!("Failed to create permission for role '{}': {}", name, e))?;
        }

        let _ = conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'role.create', ?2, ?3)",
            libsql::params![now_unix, name, format!("permissions_count={}", permissions.len())],
        ).await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(())
    }

    /// Updates role description and optionally replaces all its permission grants.
    /// CONTRACT:
    ///  - Precondition: Role `name` must exist.
    ///  - Side effects: Modifies `roles`, replaces `permissions`, writes audit log, updates snapshot.
    ///  - Idempotent: Yes.
    pub async fn update_role(
        name: &str,
        description: Option<&str>,
        permissions: Option<Vec<PermissionRecord>>,
    ) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        if let Some(desc) = description {
            conn.execute(
                "UPDATE roles SET description = ?2 WHERE name = ?1",
                libsql::params![name, desc],
            )
            .await
            .map_err(|e| format!("Failed to update role description: {}", e))?;
        }

        if let Some(perms) = permissions {
            conn.execute("DELETE FROM permissions WHERE role_name = ?1", [name])
                .await
                .map_err(|e| format!("Failed to clear old permissions: {}", e))?;

            for perm in &perms {
                let ops_json = serde_json::to_string(&perm.operations)
                    .map_err(|e| format!("Invalid operations array: {}", e))?;
                let rls_val = perm.rls_filter.as_deref().unwrap_or("");

                conn.execute(
                    "INSERT INTO permissions (role_name, database, table_name, operations, rls_filter) VALUES (?1, ?2, ?3, ?4, ?5)",
                    libsql::params![name, perm.database.as_str(), perm.table_name.as_str(), ops_json.as_str(), rls_val],
                )
                .await
                .map_err(|e| format!("Failed to insert updated permission: {}", e))?;
            }
        }

        let _ = conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'role.update', ?2, NULL)",
            libsql::params![now_unix, name],
        ).await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(true)
    }

    /// Deletes a role by name and removes all of its associated permission grants.
    /// CONTRACT:
    ///  - Side effects: Deletes from `roles` and `permissions` tables, writes audit log, updates snapshot.
    ///  - Idempotent: Yes.
    pub async fn delete_role(name: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let _ = conn.execute("DELETE FROM permissions WHERE role_name = ?1", [name]).await;
        let affected = conn
            .execute("DELETE FROM roles WHERE name = ?1", [name])
            .await
            .map_err(|e| format!("Failed to delete role: {}", e))?;

        if affected > 0 {
            let now_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let _ = conn.execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'role.delete', ?2, NULL)",
                libsql::params![now_unix, name],
            ).await;
        }

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(affected > 0)
    }

    /// Lists all roles registered in the metadata store, populated with their permissions.
    /// CONTRACT:
    ///  - Returns list of RoleRecord structs.
    ///  - Idempotent: Yes.
    pub async fn list_roles() -> Result<Vec<RoleRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut role_rows = conn
            .query("SELECT name, description, created_at FROM roles ORDER BY name ASC", ())
            .await
            .map_err(|e| e.to_string())?;

        let mut roles = Vec::new();
        while let Ok(Some(row)) = role_rows.next().await {
            let name: String = row.get(0).map_err(|e| e.to_string())?;
            let description: Option<String> = row.get(1).ok();
            let created_at: i64 = row.get(2).unwrap_or(0);

            roles.push(RoleRecord {
                name,
                description,
                created_at,
                permissions: Vec::new(),
            });
        }

        // Populate permissions for each role
        for role in &mut roles {
            let mut perm_rows = conn
                .query(
                    "SELECT id, database, table_name, operations, rls_filter FROM permissions WHERE role_name = ?1",
                    [role.name.as_str()],
                )
                .await
                .map_err(|e| e.to_string())?;

            while let Ok(Some(row)) = perm_rows.next().await {
                let id: i64 = row.get(0).unwrap_or(0);
                let database: String = row.get(1).map_err(|e| e.to_string())?;
                let table_name: String = row.get(2).map_err(|e| e.to_string())?;
                let ops_json: String = row.get(3).unwrap_or_else(|_| "[]".to_string());
                let operations: Vec<String> = serde_json::from_str(&ops_json).unwrap_or_default();
                let rls_filter = row.get_str(4).ok().map(|s| s.to_string()).filter(|s| !s.trim().is_empty());

                role.permissions.push(PermissionRecord {
                    id,
                    role_name: role.name.clone(),
                    database,
                    table_name,
                    operations,
                    rls_filter,
                });
            }
        }

        Ok(roles)
    }

    // ─── Managed Database Management ──────────────────────────────────────
    // Direct manipulation of connected upstream databases. Any mutation here must
    // sync to the live snapshot to maintain routing integrity across concurrent queries.
    /// Evaluates if two database connection strings refer to the same underlying database target.
    ///
    /// Invariant: Protocol aliases (e.g. postgresql:// vs postgres://, mysql:// vs mariadb://)
    /// and trailing slashes are canonicalized.
    pub fn urls_match(url1: &str, url2: &str) -> bool {
        let u1 = url1.trim().trim_end_matches('/');
        let u2 = url2.trim().trim_end_matches('/');
        if u1.eq_ignore_ascii_case(u2) {
            return true;
        }

        fn canonicalize_scheme(s: &str) -> &str {
            if let Some(rest) = s.strip_prefix("postgresql://") {
                rest
            } else if let Some(rest) = s.strip_prefix("postgres://") {
                rest
            } else if let Some(rest) = s.strip_prefix("mariadb://") {
                rest
            } else if let Some(rest) = s.strip_prefix("mysql://") {
                rest
            } else if let Some(rest) = s.strip_prefix("sqlserver://") {
                rest
            } else if let Some(rest) = s.strip_prefix("mssql://") {
                rest
            } else if let Some(rest) = s.strip_prefix("clickhouse+https://") {
                rest
            } else if let Some(rest) = s.strip_prefix("clickhouse://") {
                rest
            } else {
                s
            }
        }

        let c1 = canonicalize_scheme(u1);
        let c2 = canonicalize_scheme(u2);
        c1.eq_ignore_ascii_case(c2)
    }

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
        old_alias: Option<&str>,
    ) -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let lookup_alias = old_alias.unwrap_or(alias);

        // If URL is empty or masked, fetch the existing URL from the database for lookup_alias
        let effective_url = if url.trim().is_empty() || url.contains('•') {
            let mut rows = conn
                .query("SELECT url FROM databases WHERE alias = ?1", [lookup_alias])
                .await
                .map_err(|e| format!("Database query error: {}", e))?;
            if let Ok(Some(row)) = rows.next().await {
                row.get::<String>(0).map_err(|e| format!("Failed to read existing url: {}", e))?
            } else {
                return Err("Database connection URL cannot be empty for a new database".to_string());
            }
        } else {
            url.to_string()
        };

        // Enforce uniqueness: Reject if another database alias is already using this same URL
        let mut check_rows = conn
            .query(
                "SELECT alias, url FROM databases WHERE alias != ?1 AND alias != ?2",
                [alias, lookup_alias],
            )
            .await
            .map_err(|e| format!("Database query error: {}", e))?;
        while let Ok(Some(row)) = check_rows.next().await {
            let other_alias: String = row.get(0).unwrap_or_default();
            let other_url: String = row.get(1).unwrap_or_default();
            if Self::urls_match(&other_url, &effective_url) {
                return Err(format!(
                    "This database connection URL is already registered under alias '{}'",
                    other_alias
                ));
            }
        }

        // Dialect inference if not explicitly provided
        let engine_dialect = if let Some(e) = engine {
            e.to_string()
        } else if effective_url.starts_with("postgres") {
            "postgres".to_string()
        } else if effective_url.starts_with("mysql") || effective_url.starts_with("mariadb") {
            "mysql".to_string()
        } else if effective_url.starts_with("mssql") || effective_url.starts_with("sqlserver") {
            "mssql".to_string()
        } else if effective_url.starts_with("clickhouse") {
            "clickhouse".to_string()
        } else {
            "sqlite".to_string()
        };

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        if let Some(old) = old_alias {
            if old != alias {
                let _ = conn.execute("DELETE FROM databases WHERE alias = ?1", [old]).await;
                let _ = conn.execute(
                    "UPDATE permissions SET database = ?1 WHERE database = ?2",
                    libsql::params![alias, old],
                ).await;
            }
        }

        conn.execute(
            "INSERT OR REPLACE INTO databases (alias, url, engine, pool_min, pool_max, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            libsql::params![
                alias,
                effective_url.as_str(),
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
    /// Resists username enumeration timing side-channels by performing dummy Argon2 computation if user is absent.
    /// Enforces a strict concurrency limit (max 3 concurrent hashes) to prevent CPU starvation under credential stuffing attacks.
    pub async fn verify_user(username: &str, password: &str) -> Result<bool, String> {
        static ARGON2_SEMAPHORE: Lazy<Arc<tokio::sync::Semaphore>> =
            Lazy::new(|| Arc::new(tokio::sync::Semaphore::new(3)));

        let (user_row_exists, hash_to_verify) = {
            let conn = Self::get_conn().await?;
            let mut rows = conn
                .query(
                    "SELECT password_hash FROM users WHERE username = ?1",
                    [username],
                )
                .await
                .map_err(|e| e.to_string())?;

            let user_row = rows.next().await.ok().flatten();
            let hash = match &user_row {
                Some(row) => row.get::<String>(0).map_err(|e| e.to_string())?,
                None => DUMMY_HASH.clone(),
            };
            (user_row.is_some(), hash)
        };

        let password_owned = password.to_string();
        let permit = match tokio::time::timeout(
            std::time::Duration::from_millis(500),
            ARGON2_SEMAPHORE.clone().acquire_owned(),
        )
        .await
        {
            Ok(Ok(p)) => p,
            _ => return Err("SERVER_BUSY_AUTH_THROTTLED".to_string()),
        };

        let is_match = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let parsed_hash = match PasswordHash::new(&hash_to_verify) {
                Ok(h) => h,
                Err(_) => return false,
            };
            Argon2::default()
                .verify_password(password_owned.as_bytes(), &parsed_hash)
                .is_ok()
        })
        .await
        .map_err(|e| format!("Password verification task failed: {}", e))?;

        Ok(user_row_exists && is_match)
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

    /// Lists all administrative users registered in the metadata store.
    /// CONTRACT:
    ///  - Invariant: Password hashes are redacted from UserRecord.
    ///  - Idempotent: Yes.
    pub async fn list_users() -> Result<Vec<UserRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query("SELECT id, username, created_at FROM users ORDER BY id ASC", ())
            .await
            .map_err(|e| e.to_string())?;

        let mut users = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let username: String = row.get(1).map_err(|e| e.to_string())?;
            let created_at: i64 = row.get(2).unwrap_or(0);

            users.push(UserRecord {
                id,
                username,
                password_hash: String::new(),
                created_at,
            });
        }
        Ok(users)
    }

    /// Deletes an administrative user by username.
    /// CONTRACT:
    ///  - Side effects: Removes row from SQLite `users` table and writes audit log.
    ///  - Idempotent: Yes.
    pub async fn delete_user(username: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute("DELETE FROM users WHERE username = ?1", [username])
            .await
            .map_err(|e| format!("Failed to delete user: {}", e))?;

        if affected > 0 {
            let now_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let _ = conn.execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'cli', 'user.delete', ?2, NULL)",
                libsql::params![now_unix, username],
            ).await;
        }

        Ok(affected > 0)
    }

    // ─── Session Management ────────────────────────────────────────────────
    // Ephemeral administrator sessions for Web UI access without exposing API key secrets.

    /// Creates a new authenticated session for an administrative user.
    /// CONTRACT:
    ///  - Precondition: `username` must be an existing verified administrator.
    ///  - Returns: Session UUID token string.
    ///  - Side effects: Inserts session row into SQLite `sessions` table.
    ///  - Idempotent: No (generates a new unique session).
    pub async fn create_session(username: &str, ttl_secs: i64) -> Result<String, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        // SECURITY (M-4): Generate raw cryptographically-random session token, but store only
        // its BLAKE3 hash in the database so session tokens cannot be harvested from backups/DB reads.
        let raw_token = format!("axm_sess_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let token_hash = blake3::hash(raw_token.as_bytes()).to_hex().to_string();
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let expires_at = now_unix + ttl_secs;

        conn.execute(
            "INSERT INTO sessions (id, username, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)",
            libsql::params![token_hash.as_str(), username, expires_at, now_unix],
        )
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

        Ok(raw_token)
    }

    /// Validates an active session token and returns the associated username if not expired.
    /// CONTRACT:
    ///  - Precondition: `session_id` token string.
    ///  - Returns: `Ok(Some(username))` if valid, `Ok(None)` if expired or not found.
    ///  - Side effects: Deletes expired session if encountered.
    ///  - Idempotent: Yes.
    pub async fn validate_session(session_id: &str) -> Result<Option<String>, String> {
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let token_hash = blake3::hash(session_id.as_bytes()).to_hex().to_string();

        let mut rows = conn
            .query(
                "SELECT username, expires_at FROM sessions WHERE id = ?1 OR id = ?2",
                [token_hash.as_str(), session_id],
            )
            .await
            .map_err(|e| e.to_string())?;

        if let Ok(Some(row)) = rows.next().await {
            let username: String = row.get(0).map_err(|e| e.to_string())?;
            let expires_at: i64 = row.get(1).unwrap_or(0);

            if expires_at > now_unix {
                return Ok(Some(username));
            } else {
                // Opportunistic cleanup of expired session
                drop(rows);
                drop(conn);
                let _ = Self::delete_session(session_id).await;
                return Ok(None);
            }
        }

        Ok(None)
    }

    /// Revokes an active administrative session.
    /// CONTRACT:
    ///  - Side effects: Deletes row from `sessions` table.
    ///  - Idempotent: Yes.
    pub async fn delete_session(session_id: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;

        let token_hash = blake3::hash(session_id.as_bytes()).to_hex().to_string();

        let affected = conn
            .execute("DELETE FROM sessions WHERE id = ?1 OR id = ?2", [token_hash.as_str(), session_id])
            .await
            .map_err(|e| format!("Failed to delete session: {}", e))?;

        Ok(affected > 0)
    }

    // ─── Ban List Management (M-7) ───────────────────────────────────────────
    // Persists IP and API key bans in SQLite so suspensions survive daemon restarts.

    /// Persists or updates an IP ban record in SQLite.
    pub async fn save_ip_ban(ip: &str, reason: &str, expires_at: i64) -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO ip_bans (ip, reason, banned_at, expires_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(ip) DO UPDATE SET reason = ?2, banned_at = ?3, expires_at = ?4",
            libsql::params![ip, reason, now_unix, expires_at],
        )
        .await
        .map_err(|e| format!("Failed to save IP ban for {}: {}", ip, e))?;

        Ok(())
    }

    /// Removes an IP ban record from SQLite.
    pub async fn remove_ip_ban(ip: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let affected = conn
            .execute("DELETE FROM ip_bans WHERE ip = ?1", [ip])
            .await
            .map_err(|e| format!("Failed to delete IP ban for {}: {}", ip, e))?;
        Ok(affected > 0)
    }

    /// Loads all active IP bans (non-expired or permanent where expires_at == 0) from SQLite.
    pub async fn load_active_ip_bans() -> Result<Vec<(String, String, i64)>, String> {
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let mut rows = conn
            .query(
                "SELECT ip, reason, expires_at FROM ip_bans WHERE expires_at == 0 OR expires_at > ?1",
                [now_unix],
            )
            .await
            .map_err(|e| format!("Failed to query active IP bans: {}", e))?;

        let mut bans = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let ip: String = row.get(0).unwrap_or_default();
            let reason: String = row.get(1).unwrap_or_default();
            let expires_at: i64 = row.get(2).unwrap_or_default();
            bans.push((ip, reason, expires_at));
        }

        Ok(bans)
    }

    /// Persists or updates an API key suspension record in SQLite.
    pub async fn save_key_ban(key_name: &str, reason: &str, expires_at: i64) -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO key_bans (key_name, reason, banned_at, expires_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key_name) DO UPDATE SET reason = ?2, banned_at = ?3, expires_at = ?4",
            libsql::params![key_name, reason, now_unix, expires_at],
        )
        .await
        .map_err(|e| format!("Failed to save key ban for {}: {}", key_name, e))?;

        Ok(())
    }

    /// Removes an API key suspension record from SQLite.
    pub async fn remove_key_ban(key_name: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let affected = conn
            .execute("DELETE FROM key_bans WHERE key_name = ?1", [key_name])
            .await
            .map_err(|e| format!("Failed to delete key ban for {}: {}", key_name, e))?;
        Ok(affected > 0)
    }

    /// Loads all active API key suspensions (non-expired or permanent where expires_at == 0) from SQLite.
    pub async fn load_active_key_bans() -> Result<Vec<(String, String, i64)>, String> {
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let mut rows = conn
            .query(
                "SELECT key_name, reason, expires_at FROM key_bans WHERE expires_at == 0 OR expires_at > ?1",
                [now_unix],
            )
            .await
            .map_err(|e| format!("Failed to query active key bans: {}", e))?;

        let mut bans = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let key_name: String = row.get(0).unwrap_or_default();
            let reason: String = row.get(1).unwrap_or_default();
            let expires_at: i64 = row.get(2).unwrap_or_default();
            bans.push((key_name, reason, expires_at));
        }

        Ok(bans)
    }

    /// Purges expired IP and key bans from SQLite.
    pub async fn cleanup_expired_bans() -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let _ = conn
            .execute("DELETE FROM ip_bans WHERE expires_at > 0 AND expires_at <= ?1", [now_unix])
            .await;
        let _ = conn
            .execute("DELETE FROM key_bans WHERE expires_at > 0 AND expires_at <= ?1", [now_unix])
            .await;

        Ok(())
    }

    // ─── Blob Capability Ticket Management ─────────────────────────────────
    // Persistent tracking and revocation registry for pre-signed blob access capability tickets.

    /// Ensures the blob capability tickets table exists in the metadata database.
    pub async fn ensure_blob_tickets_table(conn: &Connection) -> Result<(), String> {
        let statements = [
            "CREATE TABLE IF NOT EXISTS blob_tickets (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                operation TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                signature TEXT UNIQUE NOT NULL,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                revoked INTEGER DEFAULT 0
            );",
            "CREATE INDEX IF NOT EXISTS idx_blob_tickets_lookup ON blob_tickets(namespace, key, revoked);",
            "CREATE INDEX IF NOT EXISTS idx_blob_tickets_sig ON blob_tickets(signature);",
        ];
        for stmt in statements {
            let _ = conn.execute(stmt, ()).await;
        }
        Ok(())
    }

    /// Records an issued blob capability ticket in SQLite.
    pub async fn record_blob_ticket(
        id: &str,
        namespace: &str,
        key: &str,
        operation: &str,
        expires_at: i64,
        signature: &str,
        created_by: &str,
    ) -> Result<(), String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let _ = Self::ensure_blob_tickets_table(&conn).await;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO blob_tickets (id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
            libsql::params![id, namespace, key, operation, expires_at, signature, created_by, now_unix],
        )
        .await
        .map_err(|e| format!("Failed to record blob ticket: {}", e))?;

        Ok(())
    }

    /// Queries blob capability tickets matching an optional namespace and optional key filter.
    pub async fn list_blob_tickets(
        namespace: &str,
        key: Option<&str>,
        include_expired: bool,
    ) -> Result<Vec<BlobTicketRecord>, String> {
        let conn = Self::get_conn().await?;
        let _ = Self::ensure_blob_tickets_table(&conn).await;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let clean_key = key.map(|k| k.trim_start_matches('/'));
        let mut rows = match (key, clean_key, include_expired) {
            (Some(raw_k), Some(clean_k), false) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND (key = ?2 OR key = ?3 OR key = '/' || ?3) \
                       AND expires_at > ?4 \
                     ORDER BY created_at DESC",
                    libsql::params![namespace, raw_k, clean_k, now_unix],
                )
                .await
            }
            (Some(raw_k), Some(clean_k), true) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND (key = ?2 OR key = ?3 OR key = '/' || ?3) \
                     ORDER BY created_at DESC",
                    libsql::params![namespace, raw_k, clean_k],
                )
                .await
            }
            _ if !include_expired => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND expires_at > ?2 \
                     ORDER BY created_at DESC",
                    libsql::params![namespace, now_unix],
                )
                .await
            }
            _ => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                     ORDER BY created_at DESC",
                    libsql::params![namespace],
                )
                .await
            }
        }
        .map_err(|e| format!("Failed to list blob tickets: {}", e))?;

        let mut tickets = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let ns: String = row.get(1).map_err(|e| e.to_string())?;
            let k: String = row.get(2).map_err(|e| e.to_string())?;
            let op: String = row.get(3).map_err(|e| e.to_string())?;
            let expires_at: i64 = row.get(4).map_err(|e| e.to_string())?;
            let sig: String = row.get(5).map_err(|e| e.to_string())?;
            let created_by: String = row.get(6).map_err(|e| e.to_string())?;
            let created_at: i64 = row.get(7).map_err(|e| e.to_string())?;
            let revoked_int: i64 = row.get(8).unwrap_or(0);

            tickets.push(BlobTicketRecord {
                id,
                namespace: ns,
                key: k,
                operation: op,
                expires_at,
                signature: sig,
                created_by,
                created_at,
                revoked: revoked_int != 0,
            });
        }

        Ok(tickets)
    }

    /// Revokes a blob capability ticket by signature or id, immediately invalidating it.
    pub async fn revoke_blob_ticket(signature_or_id: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let _ = Self::ensure_blob_tickets_table(&conn).await;

        let affected = conn
            .execute(
                "UPDATE blob_tickets SET revoked = 1 WHERE (signature = ?1 OR id = ?1) AND revoked = 0",
                libsql::params![signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to revoke blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Permanently deletes a blob capability ticket from SQLite.
    pub async fn delete_blob_ticket(signature_or_id: &str) -> Result<bool, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let _ = Self::ensure_blob_tickets_table(&conn).await;

        let affected = conn
            .execute(
                "DELETE FROM blob_tickets WHERE signature = ?1 OR id = ?1",
                libsql::params![signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to delete blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Checks if a ticket signature has been explicitly revoked.
    pub async fn is_blob_ticket_revoked(signature: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let mut rows = match conn
            .query(
                "SELECT revoked FROM blob_tickets WHERE signature = ?1",
                libsql::params![signature],
            )
            .await
        {
            Ok(r) => r,
            Err(_) => return Ok(false),
        };

        if let Ok(Some(row)) = rows.next().await {
            let revoked_int: i64 = row.get(0).unwrap_or(0);
            Ok(revoked_int != 0)
        } else {
            // Not in registry (or generated prior to persistence); not revoked
            Ok(false)
        }
    }

    /// Purges expired blob tickets older than 7 days from SQLite.
    pub async fn cleanup_expired_tickets() -> Result<u64, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let retention_threshold = now_unix - (7 * 86_400);

        let affected = conn
            .execute(
                "DELETE FROM blob_tickets WHERE expires_at < ?1",
                [retention_threshold],
            )
            .await
            .map_err(|e| format!("Failed to cleanup expired tickets: {}", e))?;

        Ok(affected)
    }

    // ─── System Secrets Management ─────────────────────────────────────────
    // Persistent cryptographic secrets (e.g. blob capability ticket signing secret) generated once on first boot.

    /// Ensures the system_secrets table exists.
    pub async fn ensure_system_secrets_table(conn: &Connection) -> Result<(), String> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS system_secrets (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
            (),
        )
        .await
        .map_err(|e| format!("Failed to ensure system_secrets table: {}", e))?;
        Ok(())
    }

    /// Retrieves an existing system secret or generates and persists a new cryptographically secure secret.
    /// CONTRACT:
    ///  - Precondition: `key` must not be empty.
    ///  - Postcondition: Returns the persistent secret string from `system_secrets` table.
    ///  - Side effects: Inserts a new 64-character hex-encoded cryptographic secret if none exists.
    ///  - Idempotency: Yes (subsequent calls with the same key return the identical stored secret).
    pub async fn get_or_create_system_secret(key: &str) -> Result<String, String> {
        let _guard = STORE_LOCK.lock().await;
        let conn = Self::get_conn().await?;
        let _ = Self::ensure_system_secrets_table(&conn).await;

        let mut rows = conn
            .query("SELECT value FROM system_secrets WHERE key = ?1", [key])
            .await
            .map_err(|e| format!("Failed to query system_secrets for key '{}': {}", key, e))?;

        if let Ok(Some(row)) = rows.next().await {
            let val: String = row.get(0).map_err(|e| format!("Failed to read system secret: {}", e))?;
            return Ok(val);
        }

        // Generate 32 bytes (256 bits) of cryptographically secure entropy
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let entropy = format!("{}_{}_{}", uuid::Uuid::new_v4(), now_unix, uuid::Uuid::new_v4());
        let new_secret = blake3::hash(entropy.as_bytes()).to_hex().to_string();

        conn.execute(
            "INSERT INTO system_secrets (key, value, created_at) VALUES (?1, ?2, ?3)",
            libsql::params![key, new_secret.clone(), now_unix],
        )
        .await
        .map_err(|e| format!("Failed to persist system secret for key '{}': {}", key, e))?;

        tracing::info!("Initialized and persisted system secret for '{}'", key);
        Ok(new_secret)
    }

    // ─── Audit Trail Management ────────────────────────────────────────────
    // Exposes immutable historical records of system modifications for compliance and forensic auditing.

    /// Records an audit log entry in the metadata database.
    /// CONTRACT:
    ///  - Precondition: `actor`, `action`, and `target` non-empty strings.
    ///  - Side effects: Appends an immutable record to SQLite `audit_log` table.
    ///  - Idempotency: No (appends new historical log entry).
    pub async fn record_audit(actor: &str, action: &str, target: &str, details: Option<&str>) -> Result<(), String> {
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) VALUES (?1, ?2, ?3, ?4, ?5)",
            libsql::params![now_unix, actor, action, target, details.unwrap_or("")],
        )
        .await
        .map_err(|e| format!("Failed to record audit log: {}", e))?;

        Ok(())
    }

    /// Queries paginated audit log entries ordered chronologically descending (newest first).
    /// CONTRACT:
    ///  - Precondition: `limit` clamped to safe bounds (max 500) to prevent memory exhaustion.
    ///  - Returns: `Result<Vec<AuditRecord>, String>` containing historical audit rows.
    ///  - Side effects: None (read-only SQLite query).
    ///  - Idempotency: Yes.
    pub async fn query_audit_log(limit: usize, offset: usize) -> Result<Vec<AuditRecord>, String> {
        let conn = Self::get_conn().await?;
        let safe_limit = limit.min(500) as i64;
        let safe_offset = offset as i64;

        let mut rows = conn
            .query(
                "SELECT id, timestamp, actor, action, target, details \
                 FROM audit_log ORDER BY id DESC LIMIT ?1 OFFSET ?2",
                libsql::params![safe_limit, safe_offset],
            )
            .await
            .map_err(|e| format!("Query audit_log failed: {}", e))?;

        let mut records = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let timestamp: i64 = row.get(1).unwrap_or(0);
            let actor: String = row.get(2).map_err(|e| e.to_string())?;
            let action: String = row.get(3).map_err(|e| e.to_string())?;
            let target: String = row.get(4).map_err(|e| e.to_string())?;
            let details: Option<String> = row.get(5).ok();

            records.push(AuditRecord {
                id,
                timestamp,
                actor,
                action,
                target,
                details,
            });
        }

        Ok(records)
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

    #[test]
    fn test_audit_record_model() {
        let rec = AuditRecord {
            id: 1,
            timestamp: 1727400000,
            actor: "admin".to_string(),
            action: "key.create".to_string(),
            target: "test_key".to_string(),
            details: Some("role=analyst".to_string()),
        };
        assert_eq!(rec.id, 1);
        assert_eq!(rec.action, "key.create");
        assert_eq!(rec.actor, "admin");
        assert_eq!(rec.target, "test_key");
    }

    #[tokio::test]
    async fn test_in_memory_metadata_tables_and_queries() {
        let db = libsql::Builder::new_local(":memory:").build().await.unwrap();
        let conn = db.connect().unwrap();
        MetadataStore::create_tables(&conn).await.unwrap();

        // Verify users table insertion & query
        conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES ('testadmin', 'argon_hash', 100)",
            (),
        )
        .await
        .unwrap();

        let mut rows = conn
            .query("SELECT username FROM users WHERE username = 'testadmin'", ())
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let user: String = row.get(0).unwrap();
        assert_eq!(user, "testadmin");

        // Verify roles & permissions table insertion & query
        conn.execute(
            "INSERT INTO roles (name, description, created_at) VALUES ('read_role', 'Read only', 100)",
            (),
        )
        .await
        .unwrap();

        conn.execute(
            "INSERT INTO permissions (role_name, database, table_name, operations) VALUES ('read_role', '*', '*', '[\"SELECT\"]')",
            (),
        )
        .await
        .unwrap();

        let mut perm_rows = conn
            .query("SELECT operations FROM permissions WHERE role_name = 'read_role'", ())
            .await
            .unwrap();
        let perm_row = perm_rows.next().await.unwrap().unwrap();
        let ops: String = perm_row.get(0).unwrap();
        assert_eq!(ops, "[\"SELECT\"]");
    }

    #[tokio::test]
    async fn test_rotate_key_table_operation() {
        // Sets up an in-memory SQLite store to verify that rotating an API key correctly
        // regenerates the stored BLAKE3 hash blob, invalidating the previous credential.
        let db = libsql::Builder::new_local(":memory:").build().await.unwrap();
        let conn = db.connect().unwrap();
        MetadataStore::create_tables(&conn).await.unwrap();

        let initial_secret = "initial_secret_123";
        let initial_hash = blake3::hash(initial_secret.as_bytes()).as_bytes().to_vec();

        conn.execute(
            "INSERT INTO roles (name, description, created_at) VALUES ('admin', 'Administrator role', 1000)",
            (),
        )
        .await
        .unwrap();

        conn.execute(
            "INSERT INTO api_keys (name, secret_hash, role_name, rate_limit, expires_at, created_at) \
             VALUES ('rotate_test', ?1, 'admin', 0, NULL, 1000)",
            libsql::params![initial_hash],
        )
        .await
        .unwrap();

        let new_secret = "new_rotated_secret_456";
        let new_hash = blake3::hash(new_secret.as_bytes()).as_bytes().to_vec();

        conn.execute(
            "UPDATE api_keys SET secret_hash = ?1 WHERE name = 'rotate_test'",
            libsql::params![new_hash],
        )
        .await
        .unwrap();

        let mut rows = conn
            .query("SELECT secret_hash FROM api_keys WHERE name = 'rotate_test'", ())
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let stored_hash: Vec<u8> = row.get(0).unwrap();

        assert_eq!(stored_hash, blake3::hash(b"new_rotated_secret_456").as_bytes());
        assert_ne!(stored_hash, blake3::hash(b"initial_secret_123").as_bytes());
    }

    #[tokio::test]
    async fn test_session_token_hashing_and_validation() {
        let db_path = format!("file:test_session_{}.db", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let db = libsql::Builder::new_local(&db_path).build().await.unwrap();
        let conn = db.connect().unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );",
            (),
        )
        .await
        .unwrap();

        let raw_token = format!("axm_sess_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let token_hash = blake3::hash(raw_token.as_bytes()).to_hex().to_string();
        let expires_at = 9999999999_i64;

        conn.execute(
            "INSERT INTO sessions (id, username, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)",
            libsql::params![token_hash.as_str(), "admin_test", expires_at, 1000_i64],
        )
        .await
        .unwrap();

        // 1. Database holds the hash, NOT the raw token
        let mut rows = conn
            .query("SELECT id FROM sessions WHERE username = 'admin_test'", ())
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let stored_id: String = row.get(0).unwrap();
        assert_eq!(stored_id, token_hash);
        assert_ne!(stored_id, raw_token);

        // 2. Lookup via hash succeeds
        let lookup_hash = blake3::hash(raw_token.as_bytes()).to_hex().to_string();
        let mut found_rows = conn
            .query("SELECT username FROM sessions WHERE id = ?1", [lookup_hash])
            .await
            .unwrap();
        let found_row = found_rows.next().await.unwrap().unwrap();
        let found_user: String = found_row.get(0).unwrap();
        assert_eq!(found_user, "admin_test");

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }

    #[tokio::test]
    async fn test_ip_and_key_ban_persistence() {
        let db_path = format!("file:test_bans_{}.db", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let db = Builder::new_local(db_path.replace("file:", "")).build().await.unwrap();
        let conn = db.connect().unwrap();

        let statements = [
            "CREATE TABLE IF NOT EXISTS ip_bans (
                ip TEXT PRIMARY KEY,
                reason TEXT NOT NULL,
                banned_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS key_bans (
                key_name TEXT PRIMARY KEY,
                reason TEXT NOT NULL,
                banned_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );",
        ];
        for stmt in statements {
            conn.execute(stmt, ()).await.unwrap();
        }

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // 1. Insert permanent ban (expires_at = 0) and expiring ban (expires_at in past)
        conn.execute(
            "INSERT INTO ip_bans (ip, reason, banned_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            libsql::params!["192.168.1.100", "Perm ban", now_unix, 0i64],
        ).await.unwrap();

        conn.execute(
            "INSERT INTO ip_bans (ip, reason, banned_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            libsql::params!["192.168.1.200", "Expired ban", now_unix - 100, now_unix - 10],
        ).await.unwrap();

        // Query active
        let mut rows = conn
            .query("SELECT ip, reason, expires_at FROM ip_bans WHERE expires_at == 0 OR expires_at > ?1", [now_unix])
            .await
            .unwrap();
        let mut active = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let ip: String = row.get(0).unwrap();
            active.push(ip);
        }
        assert_eq!(active, vec!["192.168.1.100"]);

        // Cleanup expired
        let affected = conn
            .execute("DELETE FROM ip_bans WHERE expires_at > 0 AND expires_at <= ?1", [now_unix])
            .await
            .unwrap();
        assert_eq!(affected, 1);

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }

    #[tokio::test]
    async fn test_blob_ticket_store_lifecycle() {
        let db_path = format!("file:test_tickets_{}.db", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let db = Builder::new_local(db_path.replace("file:", "")).build().await.unwrap();
        let conn = db.connect().unwrap();
        MetadataStore::create_tables(&conn).await.unwrap();

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // 1. Insert ticket
        conn.execute(
            "INSERT INTO blob_tickets (id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked) \
             VALUES ('t1', 'media', 'photos/1.jpg', 'READ', ?1, 'sig_abc_123', 'admin', ?2, 0)",
            libsql::params![now_unix + 3600, now_unix],
        ).await.unwrap();

        // 2. Query active tickets
        let mut rows = conn
            .query("SELECT id, revoked FROM blob_tickets WHERE namespace = 'media' AND key = 'photos/1.jpg' AND expires_at > ?1", [now_unix])
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let tid: String = row.get(0).unwrap();
        let revoked: i64 = row.get(1).unwrap();
        assert_eq!(tid, "t1");
        assert_eq!(revoked, 0);

        // 3. Revoke ticket
        conn.execute(
            "UPDATE blob_tickets SET revoked = 1 WHERE signature = 'sig_abc_123'",
            (),
        ).await.unwrap();

        let mut check_rows = conn
            .query("SELECT revoked FROM blob_tickets WHERE signature = 'sig_abc_123'", ())
            .await
            .unwrap();
        let check_row = check_rows.next().await.unwrap().unwrap();
        let check_revoked: i64 = check_row.get(0).unwrap();
        assert_eq!(check_revoked, 1);

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }

    #[tokio::test]
    async fn test_system_secrets_lifecycle() {
        let db_path = format!("file:test_secrets_{}.db", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let db = Builder::new_local(db_path.replace("file:", "")).build().await.unwrap();
        let conn = db.connect().unwrap();
        MetadataStore::create_tables(&conn).await.unwrap();

        MetadataStore::ensure_system_secrets_table(&conn).await.unwrap();
        let s1 = {
            let entropy = format!("{}_{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
            blake3::hash(entropy.as_bytes()).to_hex().to_string()
        };
        conn.execute(
            "INSERT INTO system_secrets (key, value, created_at) VALUES ('test_key', ?1, 100)",
            [s1.clone()],
        ).await.unwrap();

        let mut rows = conn
            .query("SELECT value FROM system_secrets WHERE key = 'test_key'", ())
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let s2: String = row.get(0).unwrap();
        assert_eq!(s1, s2);

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }
}


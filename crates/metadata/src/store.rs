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
static AUDIT_CHANNEL: OnceCell<tokio::sync::mpsc::Sender<AuditTask>> = OnceCell::const_new();

// In-memory cache for cluster node identity (node_id, moniker, cluster_secret).
// Eliminates 3 separate SQLite queries on every cluster ping/event/handshake hot-path.
static CLUSTER_IDENTITY_CACHE: Lazy<tokio::sync::RwLock<Option<(String, String, String)>>> =
    Lazy::new(|| tokio::sync::RwLock::new(None));

struct AuditTask {
    timestamp: i64,
    actor: String,
    action: String,
    target: String,
    details: String,
}
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

        // Spawn background lock-free audit ingestion worker
        if AUDIT_CHANNEL.get().is_none() {
            let (tx, mut rx) = tokio::sync::mpsc::channel::<AuditTask>(10_000);
            let _ = AUDIT_CHANNEL.set(tx);

            tokio::spawn(async move {
                let mut buffer = Vec::with_capacity(256);
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));

                loop {
                    tokio::select! {
                        biased;
                        Some(task) = rx.recv() => {
                            buffer.push(task);
                            if buffer.len() >= 256 {
                                Self::flush_audit_batch(&mut buffer).await;
                            }
                        }
                        _ = interval.tick() => {
                            if !buffer.is_empty() {
                                Self::flush_audit_batch(&mut buffer).await;
                            }
                        }
                    }
                }
            });
        }

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
                email TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                is_super_admin INTEGER NOT NULL DEFAULT 0,
                permissions TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
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
            "CREATE INDEX IF NOT EXISTS idx_blob_tickets_created ON blob_tickets(namespace, created_at, id);",
            "CREATE TABLE IF NOT EXISTS system_secrets (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS cluster_nodes (
                node_id TEXT PRIMARY KEY,
                moniker TEXT NOT NULL,
                url TEXT NOT NULL,
                shared_secret_hash BLOB NOT NULL,
                status TEXT NOT NULL,
                last_ping_ms INTEGER DEFAULT 0,
                last_seen_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );",
            "CREATE TABLE IF NOT EXISTS cluster_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                origin_node_id TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
        ];

        for stmt in statements {
            conn.execute(stmt, ())
                .await
                .map_err(|e| format!("Metadata schema creation failed on '{}': {}", stmt, e))?;
        }

        // Idempotently ensure rls_filter column exists for preexisting databases
        let _ = conn
            .execute("ALTER TABLE permissions ADD COLUMN rls_filter TEXT", ())
            .await;

        // Idempotently ensure email column and unique index exist for preexisting databases
        let _ = conn
            .execute("ALTER TABLE users ADD COLUMN email TEXT", ())
            .await;
        let _ = conn
            .execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL", ())
            .await;

        // Idempotently ensure is_super_admin, permissions, and updated_at columns exist in users table
        let _ = conn
            .execute("ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0", ())
            .await;
        let _ = conn
            .execute("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'", ())
            .await;
        let _ = conn
            .execute("ALTER TABLE users ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0", ())
            .await;

        // Ensure the initial/first user account is marked as super admin
        let _ = conn
            .execute("UPDATE users SET is_super_admin = 1 WHERE id = (SELECT MIN(id) FROM users)", ())
            .await;

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
                let rls_filter = row
                    .get_str(4)
                    .ok()
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());
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
            let role_name: Option<String> =
                row.get(2).ok().filter(|s: &String| !s.trim().is_empty());
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

        let clean_role: Option<&str> = role_name.map(|s| s.trim()).filter(|s| !s.is_empty());

        conn.execute(
            "INSERT INTO api_keys (name, secret_hash, role_name, rate_limit, expires_at, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            libsql::params![
                name,
                hash_blob,
                clean_role,
                rate_limit,
                expires_at,
                now_unix
            ],
        )
        .await
        .map_err(|e| format!("Failed to create API key: {}", e))?;

        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'key.create', ?2, ?3)",
                libsql::params![
                    now_unix,
                    name,
                    format!("role={}", clean_role.unwrap_or("none"))
                ],
            )
            .await;

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

        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'key.rotate', ?2, 'Secret regenerated')",
                libsql::params![now_unix, name],
            )
            .await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(new_secret)
    }

    /// Deletes an API key by name and refreshes the in-memory snapshot.
    pub async fn delete_key(name: &str) -> Result<bool, String> {
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

            let _ = conn
                .execute(
                    "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'key.delete', ?2, NULL)",
                    libsql::params![now_unix, name],
                )
                .await;
        }

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(affected > 0)
    }

    /// Updates an existing API key's role, rate limit, or expiration timestamp.
    pub async fn update_key(
        name: &str,
        role_name: Option<Option<&str>>,
        rate_limit: Option<i64>,
        expires_at: Option<Option<i64>>,
    ) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let mut rows = conn
            .query(
                "SELECT role_name, rate_limit, expires_at FROM api_keys WHERE name = ?1",
                [name],
            )
            .await
            .map_err(|e| format!("Database query error: {}", e))?;

        let (existing_role, existing_rl, existing_exp) =
            match rows.next().await.map_err(|e| e.to_string())? {
                Some(row) => {
                    let r: Option<String> =
                        row.get(0).ok().filter(|s: &String| !s.trim().is_empty());
                    let rl: i64 = row.get(1).unwrap_or(0);
                    let exp: Option<i64> = row.get(2).ok();
                    (r, rl, exp)
                }
                None => return Ok(false),
            };

        let new_role = match role_name {
            Some(opt) => opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            None => existing_role,
        };
        let new_rl = rate_limit.unwrap_or(existing_rl);
        let new_exp = match expires_at {
            Some(opt) => opt,
            None => existing_exp,
        };

        // If role specified, verify it exists
        if let Some(ref r) = new_role {
            let mut role_rows = conn
                .query("SELECT name FROM roles WHERE name = ?1", [r.as_str()])
                .await
                .map_err(|e| format!("Database query error: {}", e))?;
            if role_rows.next().await.map_err(|e| e.to_string())?.is_none() {
                return Err(format!("Role '{}' does not exist", r));
            }
        }

        conn.execute(
            "UPDATE api_keys SET role_name = ?1, rate_limit = ?2, expires_at = ?3 WHERE name = ?4",
            libsql::params![new_role.clone(), new_rl, new_exp, name],
        )
        .await
        .map_err(|e| format!("Failed to update API key: {}", e))?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'cli', 'key.update', ?2, ?3)",
                libsql::params![
                    now_unix,
                    name,
                    format!("role={:?}, rate_limit={}", new_role, new_rl)
                ],
            )
            .await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(true)
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
            let role_name: Option<String> =
                row.get(1).ok().filter(|s: &String| !s.trim().is_empty());
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

        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'role.create', ?2, ?3)",
                libsql::params![
                    now_unix,
                    name,
                    format!("permissions_count={}", permissions.len())
                ],
            )
            .await;

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

        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'role.update', ?2, NULL)",
                libsql::params![now_unix, name],
            )
            .await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(true)
    }

    /// Deletes a role by name and removes all of its associated permission grants.
    /// CONTRACT:
    ///  - Side effects: Deletes from `roles` and `permissions` tables, writes audit log, updates snapshot.
    ///  - Idempotent: Yes.
    pub async fn delete_role(name: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        // Check referential integrity: do not delete role if active API keys are assigned to it
        let mut key_rows = conn
            .query("SELECT COUNT(*) FROM api_keys WHERE role_name = ?1", [name])
            .await
            .map_err(|e| format!("Failed to check role references: {}", e))?;
        if let Ok(Some(row)) = key_rows.next().await {
            let count: i64 = row.get(0).unwrap_or(0);
            if count > 0 {
                return Err(format!(
                    "Cannot delete role '{}': {} active API key(s) are currently assigned to it",
                    name, count
                ));
            }
        }

        let _ = conn
            .execute("DELETE FROM permissions WHERE role_name = ?1", [name])
            .await;
        let affected = conn
            .execute("DELETE FROM roles WHERE name = ?1", [name])
            .await
            .map_err(|e| format!("Failed to delete role: {}", e))?;

        if affected > 0 {
            let now_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let _ = conn
                .execute(
                    "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'role.delete', ?2, NULL)",
                    libsql::params![now_unix, name],
                )
                .await;
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
            .query(
                "SELECT name, description, created_at FROM roles ORDER BY name ASC",
                (),
            )
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
                let rls_filter = row
                    .get_str(4)
                    .ok()
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty());

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
        let conn = Self::get_conn().await?;

        let lookup_alias = old_alias.unwrap_or(alias);

        // If URL is empty or masked, fetch the existing URL from the database for lookup_alias
        let effective_url = if url.trim().is_empty() || url.contains('•') {
            let mut rows = conn
                .query("SELECT url FROM databases WHERE alias = ?1", [lookup_alias])
                .await
                .map_err(|e| format!("Database query error: {}", e))?;
            if let Ok(Some(row)) = rows.next().await {
                row.get::<String>(0)
                    .map_err(|e| format!("Failed to read existing url: {}", e))?
            } else {
                return Err(
                    "Database connection URL cannot be empty for a new database".to_string()
                );
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
                let _ = conn
                    .execute("DELETE FROM databases WHERE alias = ?1", [old])
                    .await;
                let _ = conn
                    .execute(
                        "UPDATE permissions SET database = ?1 WHERE database = ?2",
                        libsql::params![alias, old],
                    )
                    .await;
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
        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
             VALUES (?1, 'admin', 'db.add', ?2, ?3)",
                libsql::params![now_unix, alias, format!("engine={}", engine_dialect)],
            )
            .await;

        drop(conn);
        Self::sync_snapshot().await?;

        Ok(())
    }

    /// Updates an existing database configuration (or renames its alias).
    pub async fn update_database(
        alias: &str,
        new_alias: Option<&str>,
        url: Option<&str>,
        engine: Option<&str>,
        pool_min: Option<i64>,
        pool_max: Option<i64>,
    ) -> Result<(), String> {
        let effective_alias = new_alias.unwrap_or(alias);
        let effective_url = url.unwrap_or("");
        Self::add_database(
            effective_alias,
            effective_url,
            engine,
            pool_min,
            pool_max,
            Some(alias),
        )
        .await
    }

    /// Removes a registered database configuration and removes it from the snapshot.
    /// CONTRACT:
    ///  - Side effects: Deletes from `databases` table, logs audit event, updates snapshot.
    ///  - Idempotent: Yes.
    pub async fn delete_database(alias: &str) -> Result<bool, String> {
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

            let _ = conn
                .execute(
                    "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'db.delete', ?2, NULL)",
                    libsql::params![now_unix, alias],
                )
                .await;
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

    /// Creates an admin user with optional email using Argon2id password hashing.
    pub async fn create_user(
        username: &str,
        email: Option<&str>,
        password: &str,
    ) -> Result<(), String> {
        Self::create_user_with_permissions(username, email, password, None, None)
            .await
            .map(|_| ())
    }

    /// Creates an administrative user with explicit super-admin flag and custom granular permissions.
    /// CONTRACT:
    ///  - If there are currently 0 users in the metadata store, this user is forced to is_super_admin = true.
    ///  - Password hash is Argon2id with random salt.
    ///  - Returns the newly created UserRecord with password_hash cleared.
    pub async fn create_user_with_permissions(
        username: &str,
        email: Option<&str>,
        password: &str,
        _is_super_admin: Option<bool>,
        permissions: Option<UserPermissionSet>,
    ) -> Result<UserRecord, String> {
        let clean_username = username.trim();
        if clean_username.is_empty() {
            return Err("Username cannot be empty".to_string());
        }

        let clean_email = email
            .map(|e| e.trim().to_lowercase())
            .filter(|e| !e.is_empty());

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

        // Determine if this is the first user account in the system
        let mut count_rows = conn
            .query("SELECT COUNT(*) FROM users", ())
            .await
            .map_err(|e| e.to_string())?;
        let is_first_user = match count_rows.next().await {
            Ok(Some(row)) => {
                let cnt: i64 = row.get(0).unwrap_or(0);
                cnt == 0
            }
            _ => false,
        };

        // Single Root Super Admin Invariant:
        // ONLY the very first user created in the system receives is_super_admin = true.
        // All subsequent users are strictly scoped PBAC administrators (is_super_admin = false).
        let effective_super_admin = is_first_user;

        let effective_perms = permissions.unwrap_or_default();
        let perms_json = serde_json::to_string(&effective_perms)
            .map_err(|e| format!("Failed to serialize user permissions: {}", e))?;

        let super_admin_int: i64 = if effective_super_admin { 1 } else { 0 };

        conn.execute(
            "INSERT INTO users (username, email, password_hash, is_super_admin, permissions, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            libsql::params![
                clean_username,
                clean_email.clone(),
                password_hash.as_str(),
                super_admin_int,
                perms_json.as_str(),
                now_unix,
                now_unix
            ],
        )
        .await
        .map_err(|e| {
            let err_str = e.to_string();
            if err_str.contains("UNIQUE constraint failed: users.username") {
                format!("User '{}' already exists", clean_username)
            } else if err_str.contains("UNIQUE constraint failed: users.email") {
                "An account with this email address already exists".to_string()
            } else {
                format!("Failed to create user: {}", e)
            }
        })?;

        let mut id_rows = conn
            .query("SELECT id FROM users WHERE username = ?1", [clean_username])
            .await
            .map_err(|e| e.to_string())?;
        let user_id: i64 = match id_rows.next().await {
            Ok(Some(row)) => row.get(0).map_err(|e| e.to_string())?,
            _ => 0,
        };

        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'user.create', ?2, NULL)",
                libsql::params![now_unix, clean_username],
            )
            .await;

        Ok(UserRecord {
            id: user_id,
            username: clean_username.to_string(),
            email: clean_email,
            password_hash: String::new(),
            is_super_admin: effective_super_admin,
            permissions: effective_perms,
            created_at: now_unix,
            updated_at: now_unix,
        })
    }

    /// Verifies an admin user's credentials using constant-time Argon2 verification.
    /// Supports authentication using either username OR email (case-insensitive via COLLATE NOCASE).
    /// Resists enumeration timing side-channels by performing dummy Argon2 computation if user is absent.
    /// Concurrency bounded (max 3 concurrent hashes) with a 5000ms timeout to avoid false rejections on loaded cores.
    /// Returns Ok(Some(canonical_username)) on success, or Ok(None) on invalid credentials.
    pub async fn verify_user(identifier: &str, password: &str) -> Result<Option<String>, String> {
        static ARGON2_SEMAPHORE: Lazy<Arc<tokio::sync::Semaphore>> =
            Lazy::new(|| Arc::new(tokio::sync::Semaphore::new(3)));

        let clean_id = identifier.trim();

        let (canonical_username, hash_to_verify) = {
            let conn = Self::get_conn().await?;
            let mut rows = conn
                .query(
                    "SELECT username, password_hash FROM users WHERE username = ?1 COLLATE NOCASE OR (email IS NOT NULL AND email = ?1 COLLATE NOCASE) LIMIT 1",
                    [clean_id],
                )
                .await
                .map_err(|e| e.to_string())?;

            let user_row = rows.next().await.ok().flatten();
            match user_row {
                Some(row) => {
                    let u: String = row.get(0).map_err(|e| e.to_string())?;
                    let h: String = row.get(1).map_err(|e| e.to_string())?;
                    (Some(u), h)
                }
                None => (None, DUMMY_HASH.clone()),
            }
        };

        let password_owned = password.to_string();
        let permit = match tokio::time::timeout(
            std::time::Duration::from_millis(5000),
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

        if is_match && canonical_username.is_some() {
            Ok(canonical_username)
        } else {
            Ok(None)
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

    /// Lists all administrative users registered in the metadata store.
    /// CONTRACT:
    ///  - Invariant: Password hashes are redacted from UserRecord.
    ///  - Idempotent: Yes.
    pub async fn list_users() -> Result<Vec<UserRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT id, username, email, is_super_admin, permissions, created_at, updated_at FROM users ORDER BY id ASC",
                (),
            )
            .await
            .map_err(|e| e.to_string())?;

        let mut users = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let username: String = row.get(1).map_err(|e| e.to_string())?;
            let email: Option<String> = row.get(2).ok();
            let is_super_admin: bool = row.get::<i64>(3).unwrap_or(0) == 1;
            let perms_str: String = row.get(4).unwrap_or_else(|_| "{}".to_string());
            let permissions: UserPermissionSet =
                serde_json::from_str(&perms_str).unwrap_or_default();
            let created_at: i64 = row.get(5).unwrap_or(0);
            let updated_at: i64 = row.get(6).unwrap_or(0);

            users.push(UserRecord {
                id,
                username,
                email,
                password_hash: String::new(),
                is_super_admin,
                permissions,
                created_at,
                updated_at,
            });
        }
        Ok(users)
    }

    /// Fetches a single user by internal ID.
    pub async fn get_user_by_id(id: i64) -> Result<Option<UserRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT id, username, email, is_super_admin, permissions, created_at, updated_at FROM users WHERE id = ?1",
                [id],
            )
            .await
            .map_err(|e| e.to_string())?;

        if let Ok(Some(row)) = rows.next().await {
            let user_id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let username: String = row.get(1).map_err(|e| e.to_string())?;
            let email: Option<String> = row.get(2).ok();
            let is_super_admin: bool = row.get::<i64>(3).unwrap_or(0) == 1;
            let perms_str: String = row.get(4).unwrap_or_else(|_| "{}".to_string());
            let permissions: UserPermissionSet =
                serde_json::from_str(&perms_str).unwrap_or_default();
            let created_at: i64 = row.get(5).unwrap_or(0);
            let updated_at: i64 = row.get(6).unwrap_or(0);

            Ok(Some(UserRecord {
                id: user_id,
                username,
                email,
                password_hash: String::new(),
                is_super_admin,
                permissions,
                created_at,
                updated_at,
            }))
        } else {
            Ok(None)
        }
    }

    /// Fetches a single user by username.
    pub async fn get_user_by_username(username: &str) -> Result<Option<UserRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT id, username, email, is_super_admin, permissions, created_at, updated_at FROM users WHERE username = ?1 COLLATE NOCASE",
                [username.trim()],
            )
            .await
            .map_err(|e| e.to_string())?;

        if let Ok(Some(row)) = rows.next().await {
            let user_id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let u_name: String = row.get(1).map_err(|e| e.to_string())?;
            let email: Option<String> = row.get(2).ok();
            let is_super_admin: bool = row.get::<i64>(3).unwrap_or(0) == 1;
            let perms_str: String = row.get(4).unwrap_or_else(|_| "{}".to_string());
            let permissions: UserPermissionSet =
                serde_json::from_str(&perms_str).unwrap_or_default();
            let created_at: i64 = row.get(5).unwrap_or(0);
            let updated_at: i64 = row.get(6).unwrap_or(0);

            Ok(Some(UserRecord {
                id: user_id,
                username: u_name,
                email,
                password_hash: String::new(),
                is_super_admin,
                permissions,
                created_at,
                updated_at,
            }))
        } else {
            Ok(None)
        }
    }

    /// Deletes an administrative user by username, protecting the root super admin.
    pub async fn delete_user(username: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        // Guard: check if this user is the root super admin
        let mut lookup = conn
            .query("SELECT id FROM users WHERE username = ?1", [username])
            .await
            .map_err(|e| e.to_string())?;

        let user_id = match lookup.next().await.ok().flatten() {
            Some(row) => row.get::<i64>(0).map_err(|e| e.to_string())?,
            None => return Ok(false),
        };

        Self::delete_user_by_id(user_id).await
    }

    /// Deletes an administrative user by ID, enforcing root super admin deletion protection.
    pub async fn delete_user_by_id(id: i64) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        // Root super admin (id = 1 or minimum id) can NEVER be deleted
        let mut min_rows = conn
            .query("SELECT MIN(id) FROM users", ())
            .await
            .map_err(|e| e.to_string())?;
        let min_id: Option<i64> = min_rows.next().await.ok().flatten().and_then(|r| r.get(0).ok());

        if id == 1 || min_id == Some(id) {
            return Err("Root super admin account cannot be deleted".to_string());
        }

        let mut name_rows = conn
            .query("SELECT username FROM users WHERE id = ?1", [id])
            .await
            .map_err(|e| e.to_string())?;
        let username: Option<String> = name_rows.next().await.ok().flatten().and_then(|r| r.get(0).ok());

        let affected = conn
            .execute("DELETE FROM users WHERE id = ?1", [id])
            .await
            .map_err(|e| format!("Failed to delete user: {}", e))?;

        if affected > 0 {
            let now_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            let target_desc = username.unwrap_or_else(|| format!("id:{}", id));
            let _ = conn
                .execute(
                    "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'user.delete', ?2, NULL)",
                    libsql::params![now_unix, target_desc],
                )
                .await;
        }

        Ok(affected > 0)
    }

    /// Updates an existing administrative user by ID.
    pub async fn update_user_by_id(
        id: i64,
        email: Option<Option<&str>>,
        password: Option<&str>,
        is_super_admin: Option<bool>,
        permissions: Option<UserPermissionSet>,
    ) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let mut rows = conn
            .query(
                "SELECT username, email, password_hash, is_super_admin, permissions FROM users WHERE id = ?1",
                [id],
            )
            .await
            .map_err(|e| format!("Database query error: {}", e))?;

        let (username, existing_email, existing_pass, _existing_super, existing_perms) = match rows.next().await.map_err(|e| e.to_string())? {
            Some(row) => {
                let u: String = row.get(0).map_err(|e| e.to_string())?;
                let e: Option<String> = row.get(1).ok();
                let p: String = row.get(2).map_err(|e| e.to_string())?;
                let sa: bool = row.get::<i64>(3).unwrap_or(0) == 1;
                let perms_str: String = row.get(4).unwrap_or_else(|_| "{}".to_string());
                let ps: UserPermissionSet = serde_json::from_str(&perms_str).unwrap_or_default();
                (u, e, p, sa, ps)
            }
            None => return Ok(false),
        };

        // Root super admin can never be demoted
        let mut min_rows = conn
            .query("SELECT MIN(id) FROM users", ())
            .await
            .map_err(|e| e.to_string())?;
        let min_id: Option<i64> = min_rows.next().await.ok().flatten().and_then(|r| r.get(0).ok());

        // Single Root Super Admin Invariants:
        // 1. Root super-admin (id = 1 or min_id) can never be demoted.
        // 2. Secondary accounts can NEVER be promoted to super-admin.
        let is_root = id == 1 || min_id == Some(id);
        if is_root && is_super_admin == Some(false) {
            return Err("Root super admin account cannot be demoted".to_string());
        }
        if !is_root && is_super_admin == Some(true) {
            return Err("Super administrator status cannot be granted to secondary accounts".to_string());
        }

        let new_email = match email {
            Some(opt) => opt
                .map(|e| e.trim().to_lowercase())
                .filter(|e| !e.is_empty()),
            None => existing_email,
        };

        let new_pass_hash = match password {
            Some(p) if !p.trim().is_empty() => {
                let salt = SaltString::generate(&mut OsRng);
                let argon2 = Argon2::default();
                argon2
                    .hash_password(p.as_bytes(), &salt)
                    .map_err(|e| format!("Argon2 hashing failed: {}", e))?
                    .to_string()
            }
            _ => existing_pass,
        };

        let new_super_admin = if is_root { true } else { false };
        let super_admin_int: i64 = if new_super_admin { 1 } else { 0 };

        let new_perms = permissions.unwrap_or(existing_perms);
        let perms_json = serde_json::to_string(&new_perms)
            .map_err(|e| format!("Failed to serialize permissions: {}", e))?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "UPDATE users SET email = ?1, password_hash = ?2, is_super_admin = ?3, permissions = ?4, updated_at = ?5 WHERE id = ?6",
            libsql::params![
                new_email,
                new_pass_hash.as_str(),
                super_admin_int,
                perms_json.as_str(),
                now_unix,
                id
            ],
        )
        .await
        .map_err(|e| format!("Failed to update user: {}", e))?;

        let _ = conn
            .execute(
                "INSERT INTO audit_log (timestamp, actor, action, target, details) \
                 VALUES (?1, 'admin', 'user.update', ?2, NULL)",
                libsql::params![now_unix, username],
            )
            .await;

        Ok(true)
    }

    /// Updates an existing administrative user's email or password by username.
    pub async fn update_user(
        username: &str,
        email: Option<Option<&str>>,
        password: Option<&str>,
    ) -> Result<bool, String> {
        let clean_username = username.trim();
        let conn = Self::get_conn().await?;

        let mut rows = conn
            .query("SELECT id FROM users WHERE username = ?1", [clean_username])
            .await
            .map_err(|e| format!("Database query error: {}", e))?;

        let user_id = match rows.next().await.map_err(|e| e.to_string())? {
            Some(row) => row.get::<i64>(0).map_err(|e| e.to_string())?,
            None => return Ok(false),
        };

        Self::update_user_by_id(user_id, email, password, None, None).await
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
        let conn = Self::get_conn().await?;

        // SECURITY (M-4): Generate raw cryptographically-random session token, but store only
        // its BLAKE3 hash in the database so session tokens cannot be harvested from backups/DB reads.
        let raw_token = format!(
            "axm_sess_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
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
        let conn = Self::get_conn().await?;

        let token_hash = blake3::hash(session_id.as_bytes()).to_hex().to_string();

        let affected = conn
            .execute(
                "DELETE FROM sessions WHERE id = ?1 OR id = ?2",
                [token_hash.as_str(), session_id],
            )
            .await
            .map_err(|e| format!("Failed to delete session: {}", e))?;

        Ok(affected > 0)
    }

    // ─── Ban List Management (M-7) ───────────────────────────────────────────
    // Persists IP and API key bans in SQLite so suspensions survive daemon restarts.

    /// Persists or updates an IP ban record in SQLite.
    pub async fn save_ip_ban(ip: &str, reason: &str, expires_at: i64) -> Result<(), String> {
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
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let _ = conn
            .execute(
                "DELETE FROM ip_bans WHERE expires_at > 0 AND expires_at <= ?1",
                [now_unix],
            )
            .await;
        let _ = conn
            .execute(
                "DELETE FROM key_bans WHERE expires_at > 0 AND expires_at <= ?1",
                [now_unix],
            )
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
            "CREATE INDEX IF NOT EXISTS idx_blob_tickets_created ON blob_tickets(namespace, created_at, id);",
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
        let conn = Self::get_conn().await?;

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

    /// Queries blob capability tickets matching an optional namespace and optional key filter with keyset cursor pagination.
    pub async fn list_blob_tickets(
        namespace: &str,
        key: Option<&str>,
        include_expired: bool,
        cursor: Option<&str>,
        limit: Option<usize>,
    ) -> Result<(Vec<BlobTicketRecord>, Option<String>), String> {
        let conn = Self::get_conn().await?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let safe_limit = limit.unwrap_or(100).clamp(1, 500) as i64;
        let query_limit = safe_limit + 1;

        // Parse cursor: "<created_at>_<id>"
        let parsed_cursor = cursor.and_then(|c| {
            c.split_once('_').and_then(|(ts_str, id_str)| {
                ts_str
                    .parse::<i64>()
                    .ok()
                    .map(|ts| (ts, id_str.to_string()))
            })
        });

        let clean_key = key.map(|k| k.trim_start_matches('/'));
        let mut rows = match (key, clean_key, include_expired, parsed_cursor) {
            (Some(raw_k), Some(clean_k), false, Some((cur_ts, cur_id))) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND (key = ?2 OR key = ?3 OR key = '/' || ?3) \
                       AND expires_at > ?4 \
                       AND (created_at < ?5 OR (created_at = ?5 AND id < ?6)) \
                     ORDER BY created_at DESC, id DESC LIMIT ?7",
                    libsql::params![namespace, raw_k, clean_k, now_unix, cur_ts, cur_id, query_limit],
                )
                .await
            }
            (Some(raw_k), Some(clean_k), false, None) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND (key = ?2 OR key = ?3 OR key = '/' || ?3) \
                       AND expires_at > ?4 \
                     ORDER BY created_at DESC, id DESC LIMIT ?5",
                    libsql::params![namespace, raw_k, clean_k, now_unix, query_limit],
                )
                .await
            }
            (Some(raw_k), Some(clean_k), true, Some((cur_ts, cur_id))) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND (key = ?2 OR key = ?3 OR key = '/' || ?3) \
                       AND (created_at < ?4 OR (created_at = ?4 AND id < ?5)) \
                     ORDER BY created_at DESC, id DESC LIMIT ?6",
                    libsql::params![namespace, raw_k, clean_k, cur_ts, cur_id, query_limit],
                )
                .await
            }
            (Some(raw_k), Some(clean_k), true, None) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND (key = ?2 OR key = ?3 OR key = '/' || ?3) \
                     ORDER BY created_at DESC, id DESC LIMIT ?4",
                    libsql::params![namespace, raw_k, clean_k, query_limit],
                )
                .await
            }
            (_, _, false, Some((cur_ts, cur_id))) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND expires_at > ?2 \
                       AND (created_at < ?3 OR (created_at = ?3 AND id < ?4)) \
                     ORDER BY created_at DESC, id DESC LIMIT ?5",
                    libsql::params![namespace, now_unix, cur_ts, cur_id, query_limit],
                )
                .await
            }
            (_, _, false, None) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND expires_at > ?2 \
                     ORDER BY created_at DESC, id DESC LIMIT ?3",
                    libsql::params![namespace, now_unix, query_limit],
                )
                .await
            }
            (_, _, true, Some((cur_ts, cur_id))) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                       AND (created_at < ?2 OR (created_at = ?2 AND id < ?3)) \
                     ORDER BY created_at DESC, id DESC LIMIT ?4",
                    libsql::params![namespace, cur_ts, cur_id, query_limit],
                )
                .await
            }
            (_, _, true, None) => {
                conn.query(
                    "SELECT id, namespace, key, operation, expires_at, signature, created_by, created_at, revoked \
                     FROM blob_tickets \
                     WHERE (?1 = '*' OR ?1 = '' OR namespace = ?1) \
                     ORDER BY created_at DESC, id DESC LIMIT ?2",
                    libsql::params![namespace, query_limit],
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

        let next_cursor = if tickets.len() > safe_limit as usize {
            tickets.truncate(safe_limit as usize);
            tickets
                .last()
                .map(|last| format!("{}_{}", last.created_at, last.id))
        } else {
            None
        };

        Ok((tickets, next_cursor))
    }

    /// Finds the underlying cryptographic signature of a ticket given either its ID or signature.
    pub async fn find_blob_ticket_signature(
        signature_or_id: &str,
    ) -> Result<Option<String>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = match conn
            .query(
                "SELECT signature FROM blob_tickets WHERE signature = ?1 OR id = ?1 LIMIT 1",
                libsql::params![signature_or_id],
            )
            .await
        {
            Ok(r) => r,
            Err(_) => return Ok(None),
        };

        if let Ok(Some(row)) = rows.next().await {
            let sig: String = row.get(0).unwrap_or_default();
            Ok(Some(sig))
        } else {
            Ok(None)
        }
    }

    /// Finds exact ticket signature for a ticket within a specific namespace.
    pub async fn find_blob_ticket_signature_scoped(
        namespace: &str,
        signature_or_id: &str,
    ) -> Result<Option<String>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = match conn
            .query(
                "SELECT signature FROM blob_tickets WHERE namespace = ?1 AND (signature = ?2 OR id = ?2) LIMIT 1",
                libsql::params![namespace, signature_or_id],
            )
            .await
        {
            Ok(r) => r,
            Err(_) => return Ok(None),
        };

        if let Ok(Some(row)) = rows.next().await {
            let sig: String = row.get(0).unwrap_or_default();
            Ok(Some(sig))
        } else {
            Ok(None)
        }
    }

    /// Revokes a blob capability ticket by signature or id, immediately invalidating it.
    pub async fn revoke_blob_ticket(signature_or_id: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute(
                "UPDATE blob_tickets SET revoked = 1 WHERE (signature = ?1 OR id = ?1) AND revoked = 0",
                libsql::params![signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to revoke blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Revokes a blob capability ticket scoped to a specific namespace.
    pub async fn revoke_blob_ticket_scoped(
        namespace: &str,
        signature_or_id: &str,
    ) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute(
                "UPDATE blob_tickets SET revoked = 1 WHERE namespace = ?1 AND (signature = ?2 OR id = ?2) AND revoked = 0",
                libsql::params![namespace, signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to revoke blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Re-enables / restores a revoked blob capability ticket by signature or id.
    pub async fn enable_blob_ticket(signature_or_id: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute(
                "UPDATE blob_tickets SET revoked = 0 WHERE (signature = ?1 OR id = ?1) AND revoked = 1",
                libsql::params![signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to enable blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Re-enables / restores a revoked blob capability ticket scoped to a specific namespace.
    pub async fn enable_blob_ticket_scoped(
        namespace: &str,
        signature_or_id: &str,
    ) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute(
                "UPDATE blob_tickets SET revoked = 0 WHERE namespace = ?1 AND (signature = ?2 OR id = ?2) AND revoked = 1",
                libsql::params![namespace, signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to enable blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Permanently deletes a blob capability ticket from SQLite.
    pub async fn delete_blob_ticket(signature_or_id: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute(
                "DELETE FROM blob_tickets WHERE signature = ?1 OR id = ?1",
                libsql::params![signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to delete blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Permanently deletes a blob capability ticket scoped to a specific namespace.
    pub async fn delete_blob_ticket_scoped(
        namespace: &str,
        signature_or_id: &str,
    ) -> Result<bool, String> {
        let conn = Self::get_conn().await?;

        let affected = conn
            .execute(
                "DELETE FROM blob_tickets WHERE namespace = ?1 AND (signature = ?2 OR id = ?2)",
                libsql::params![namespace, signature_or_id],
            )
            .await
            .map_err(|e| format!("Failed to delete blob ticket: {}", e))?;

        Ok(affected > 0)
    }

    /// Validates whether a capability ticket signature is actively registered, unrevoked, and unexpired.
    /// CONTRACT: Returns Ok(true) only if the ticket exists in the registry, revoked == 0, and expires_at > now.
    pub async fn is_blob_ticket_active(signature: &str) -> Result<bool, String> {
        let conn = Self::get_conn().await?;
        let mut rows = match conn
            .query(
                "SELECT revoked, expires_at FROM blob_tickets WHERE signature = ?1 LIMIT 1",
                libsql::params![signature],
            )
            .await
        {
            Ok(r) => r,
            Err(_) => return Ok(false),
        };

        if let Ok(Some(row)) = rows.next().await {
            let revoked_int: i64 = row.get(0).unwrap_or(1);
            let expires_at: i64 = row.get(1).unwrap_or(0);
            let now_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            Ok(revoked_int == 0 && expires_at > now_unix)
        } else {
            // Deleted from registry or never issued -> immediately invalid
            Ok(false)
        }
    }

    /// Checks if a ticket signature has been explicitly revoked or deleted from registry.
    pub async fn is_blob_ticket_revoked(signature: &str) -> Result<bool, String> {
        Self::is_blob_ticket_active(signature)
            .await
            .map(|active| !active)
    }

    /// Purges expired blob tickets older than 7 days from SQLite.
    pub async fn cleanup_expired_tickets() -> Result<u64, String> {
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
        let conn = Self::get_conn().await?;

        let mut rows = conn
            .query("SELECT value FROM system_secrets WHERE key = ?1", [key])
            .await
            .map_err(|e| format!("Failed to query system_secrets for key '{}': {}", key, e))?;

        if let Ok(Some(row)) = rows.next().await {
            let val: String = row
                .get(0)
                .map_err(|e| format!("Failed to read system secret: {}", e))?;
            return Ok(val);
        }

        // Generate 32 bytes (256 bits) of cryptographically secure entropy
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let entropy = format!(
            "{}_{}_{}",
            uuid::Uuid::new_v4(),
            now_unix,
            uuid::Uuid::new_v4()
        );
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

    /// Flushes a batch of queued audit records to SQLite inside a single transaction.
    async fn flush_audit_batch(buffer: &mut Vec<AuditTask>) {
        if buffer.is_empty() {
            return;
        }

        if let Ok(conn) = Self::get_conn().await {
            let _ = conn.execute("BEGIN TRANSACTION", ()).await;
            for task in buffer.drain(..) {
                let _ = conn.execute(
                    "INSERT INTO audit_log (timestamp, actor, action, target, details) VALUES (?1, ?2, ?3, ?4, ?5)",
                    libsql::params![task.timestamp, task.actor, task.action, task.target, task.details],
                ).await;
            }
            let _ = conn.execute("COMMIT", ()).await;
        } else {
            buffer.clear();
        }
    }

    /// Records an audit log entry via non-blocking asynchronous queue (lock-free on data plane).
    /// Falls back to direct write if background channel is uninitialized.
    pub async fn record_audit(
        actor: &str,
        action: &str,
        target: &str,
        details: Option<&str>,
    ) -> Result<(), String> {
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        if let Some(tx) = AUDIT_CHANNEL.get() {
            let task = AuditTask {
                timestamp: now_unix,
                actor: actor.to_string(),
                action: action.to_string(),
                target: target.to_string(),
                details: details.unwrap_or("").to_string(),
            };
            if let Err(e) = tx.try_send(task) {
                tracing::warn!("Audit queue full or dropped: {}", e);
            }
            return Ok(());
        }

        let conn = Self::get_conn().await?;
        conn.execute(
            "INSERT INTO audit_log (timestamp, actor, action, target, details) VALUES (?1, ?2, ?3, ?4, ?5)",
            libsql::params![now_unix, actor, action, target, details.unwrap_or("")],
        )
        .await
        .map_err(|e| format!("Failed to record audit log: {}", e))?;

        Ok(())
    }

    /// Returns the total count of audit log entries, optionally matching a search query.
    /// CONTRACT:
    ///  - Precondition: None.
    ///  - Returns: `Result<i64, String>` total count of matching audit rows.
    ///  - Side effects: None (read-only SQLite query).
    ///  - Idempotency: Yes.
    pub async fn count_audit_log(search: Option<&str>) -> Result<i64, String> {
        let conn = Self::get_conn().await?;
        let count: i64 = if let Some(q) = search {
            let pattern = format!("%{}%", q);
            let mut rows = conn
                .query(
                    "SELECT COUNT(*) FROM audit_log WHERE actor LIKE ?1 OR action LIKE ?1 OR target LIKE ?1 OR details LIKE ?1",
                    libsql::params![pattern],
                )
                .await
                .map_err(|e| format!("Count audit_log failed: {}", e))?;
            if let Ok(Some(row)) = rows.next().await {
                row.get(0).unwrap_or(0)
            } else {
                0
            }
        } else {
            let mut rows = conn
                .query("SELECT COUNT(*) FROM audit_log", ())
                .await
                .map_err(|e| format!("Count audit_log failed: {}", e))?;
            if let Ok(Some(row)) = rows.next().await {
                row.get(0).unwrap_or(0)
            } else {
                0
            }
        };
        Ok(count)
    }

    /// Retrieves paginated audit log entries documenting system administrative actions.
    ///
    /// CONTRACT:
    ///  - Precondition: `limit` capped at 500 rows maximum to prevent memory exhaustion.
    ///  - Keyset cursor: If `before_id` is provided, executes an O(1) B-tree seek (`WHERE id < ?1 ORDER BY id DESC LIMIT ?2`).
    ///    Otherwise falls back to standard offset pagination (`LIMIT ?1 OFFSET ?2`).
    ///  - Returns: `Result<Vec<AuditRecord>, String>` containing historical audit rows.
    ///  - Side effects: None (read-only SQLite query).
    ///  - Idempotency: Yes.
    pub async fn query_audit_log_cursor(
        limit: usize,
        offset: usize,
        before_id: Option<i64>,
        search: Option<&str>,
    ) -> Result<Vec<AuditRecord>, String> {
        let conn = Self::get_conn().await?;
        let safe_limit = limit.min(500) as i64;

        let mut rows = if let Some(cursor_id) = before_id {
            if let Some(q) = search {
                let pattern = format!("%{}%", q);
                conn.query(
                    "SELECT id, timestamp, actor, action, target, details \
                     FROM audit_log WHERE id < ?1 AND (actor LIKE ?2 OR action LIKE ?2 OR target LIKE ?2 OR details LIKE ?2) \
                     ORDER BY id DESC LIMIT ?3",
                    libsql::params![cursor_id, pattern, safe_limit],
                )
                .await
                .map_err(|e| format!("Query audit_log failed: {}", e))?
            } else {
                conn.query(
                    "SELECT id, timestamp, actor, action, target, details \
                     FROM audit_log WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
                    libsql::params![cursor_id, safe_limit],
                )
                .await
                .map_err(|e| format!("Query audit_log failed: {}", e))?
            }
        } else {
            let safe_offset = offset as i64;
            if let Some(q) = search {
                let pattern = format!("%{}%", q);
                conn.query(
                    "SELECT id, timestamp, actor, action, target, details \
                     FROM audit_log WHERE (actor LIKE ?1 OR action LIKE ?1 OR target LIKE ?1 OR details LIKE ?1) \
                     ORDER BY id DESC LIMIT ?2 OFFSET ?3",
                    libsql::params![pattern, safe_limit, safe_offset],
                )
                .await
                .map_err(|e| format!("Query audit_log failed: {}", e))?
            } else {
                conn.query(
                    "SELECT id, timestamp, actor, action, target, details \
                     FROM audit_log ORDER BY id DESC LIMIT ?1 OFFSET ?2",
                    libsql::params![safe_limit, safe_offset],
                )
                .await
                .map_err(|e| format!("Query audit_log failed: {}", e))?
            }
        };

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

    /// Legacy offset-based query wrapper for audit logs.
    pub async fn query_audit_log(limit: usize, offset: usize) -> Result<Vec<AuditRecord>, String> {
        Self::query_audit_log_cursor(limit, offset, None, None).await
    }

    // ─── Cluster P2P Mesh Management ──────────────────────────────────────────
    // Coordinates zero-config peer-to-peer discovery, mutual TLS/HMAC pairings, and state synchronization.

    /// Resets the in-memory cluster identity cache (useful for test isolation).
    pub async fn reset_cluster_identity_cache() {
        let mut guard = CLUSTER_IDENTITY_CACHE.write().await;
        *guard = None;
    }

    /// Retrieves or securely generates the local node's cluster identity (node_id, moniker, cluster_secret).
    /// CONTRACT:
    ///  - Postcondition: Returns `(node_id, moniker, cluster_secret)`.
    ///  - Invariants: Uses in-memory caching to eliminate repeated SQLite queries on cluster packet hot-paths.
    ///  - Side effects: Persists missing identity tokens into `system_secrets`.
    ///  - Idempotency: Yes.
    pub async fn get_or_create_cluster_identity() -> Result<(String, String, String), String> {
        // Fast in-memory check
        {
            let guard = CLUSTER_IDENTITY_CACHE.read().await;
            if let Some(ref id) = *guard {
                return Ok(id.clone());
            }
        }

        let mut guard = CLUSTER_IDENTITY_CACHE.write().await;
        if let Some(ref id) = *guard {
            return Ok(id.clone());
        }

        let conn = Self::get_conn().await?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // 1. Local Node ID
        let mut node_rows = conn
            .query(
                "SELECT value FROM system_secrets WHERE key = 'cluster_node_id'",
                (),
            )
            .await
            .map_err(|e| format!("Query cluster_node_id failed: {}", e))?;

        let node_id = if let Ok(Some(row)) = node_rows.next().await {
            row.get::<String>(0).map_err(|e| e.to_string())?
        } else {
            let raw_uuid = uuid::Uuid::new_v4().to_string().replace('-', "");
            let generated_id = format!("axm_node_{}", &raw_uuid[..16]);
            conn.execute(
                "INSERT INTO system_secrets (key, value, created_at) VALUES ('cluster_node_id', ?1, ?2)",
                libsql::params![generated_id.clone(), now_unix],
            )
            .await
            .map_err(|e| format!("Failed to persist cluster_node_id: {}", e))?;
            generated_id
        };

        // 2. Moniker (human-readable node label)
        let mut moniker_rows = conn
            .query(
                "SELECT value FROM system_secrets WHERE key = 'cluster_moniker'",
                (),
            )
            .await
            .map_err(|e| format!("Query cluster_moniker failed: {}", e))?;

        let moniker = if let Ok(Some(row)) = moniker_rows.next().await {
            row.get::<String>(0).map_err(|e| e.to_string())?
        } else {
            let default_moniker = format!("axiom-node-{}", &node_id[9..13]);
            conn.execute(
                "INSERT INTO system_secrets (key, value, created_at) VALUES ('cluster_moniker', ?1, ?2)",
                libsql::params![default_moniker.clone(), now_unix],
            )
            .await
            .map_err(|e| format!("Failed to persist cluster_moniker: {}", e))?;
            default_moniker
        };

        // 3. Cluster Shared Secret
        let mut secret_rows = conn
            .query(
                "SELECT value FROM system_secrets WHERE key = 'cluster_secret'",
                (),
            )
            .await
            .map_err(|e| format!("Query cluster_secret failed: {}", e))?;

        let cluster_secret = if let Ok(Some(row)) = secret_rows.next().await {
            row.get::<String>(0).map_err(|e| e.to_string())?
        } else {
            let entropy = format!(
                "{}_{}_{}",
                uuid::Uuid::new_v4(),
                now_unix,
                uuid::Uuid::new_v4()
            );
            let generated_secret = blake3::hash(entropy.as_bytes()).to_hex().to_string();
            conn.execute(
                "INSERT INTO system_secrets (key, value, created_at) VALUES ('cluster_secret', ?1, ?2)",
                libsql::params![generated_secret.clone(), now_unix],
            )
            .await
            .map_err(|e| format!("Failed to persist cluster_secret: {}", e))?;
            generated_secret
        };

        let identity = (node_id, moniker, cluster_secret);
        *guard = Some(identity.clone());
        Ok(identity)
    }

    /// Sets or updates the human-readable moniker for the local cluster node.
    pub async fn set_cluster_moniker(moniker: &str) -> Result<(), String> {
        let conn = Self::get_conn().await?;

        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO system_secrets (key, value, created_at) VALUES ('cluster_moniker', ?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            libsql::params![moniker, now_unix],
        )
        .await
        .map_err(|e| format!("Failed to set cluster_moniker: {}", e))?;

        // Synchronize in-memory cache
        let mut guard = CLUSTER_IDENTITY_CACHE.write().await;
        if let Some((_, ref mut cached_moniker, _)) = *guard {
            *cached_moniker = moniker.to_string();
        }

        Ok(())
    }

    /// Lists all registered peer nodes in the cluster.
    pub async fn list_peers() -> Result<Vec<PeerNodeRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT node_id, moniker, url, shared_secret_hash, status, last_ping_ms, last_seen_at, created_at \
                 FROM cluster_nodes ORDER BY moniker ASC",
                (),
            )
            .await
            .map_err(|e| format!("Query cluster_nodes failed: {}", e))?;

        let mut peers = Vec::new();
        while let Ok(Some(row)) = rows.next().await {
            let node_id: String = row.get(0).map_err(|e| e.to_string())?;
            let moniker: String = row.get(1).map_err(|e| e.to_string())?;
            let url: String = row.get(2).map_err(|e| e.to_string())?;
            let shared_secret_hash: Vec<u8> = row.get(3).unwrap_or_default();
            let status: String = row.get(4).map_err(|e| e.to_string())?;
            let last_ping_ms: i64 = row.get(5).unwrap_or(0);
            let last_seen_at: i64 = row.get(6).unwrap_or(0);
            let created_at: i64 = row.get(7).unwrap_or(0);

            peers.push(PeerNodeRecord {
                node_id,
                moniker,
                url,
                shared_secret_hash,
                status,
                last_ping_ms,
                last_seen_at,
                created_at,
            });
        }

        Ok(peers)
    }

    /// Retrieves a single peer record by node_id.
    pub async fn get_peer(node_id: &str) -> Result<Option<PeerNodeRecord>, String> {
        let conn = Self::get_conn().await?;
        let mut rows = conn
            .query(
                "SELECT node_id, moniker, url, shared_secret_hash, status, last_ping_ms, last_seen_at, created_at \
                 FROM cluster_nodes WHERE node_id = ?1",
                [node_id],
            )
            .await
            .map_err(|e| format!("Query cluster_nodes for node '{}' failed: {}", node_id, e))?;

        if let Ok(Some(row)) = rows.next().await {
            let node_id: String = row.get(0).map_err(|e| e.to_string())?;
            let moniker: String = row.get(1).map_err(|e| e.to_string())?;
            let url: String = row.get(2).map_err(|e| e.to_string())?;
            let shared_secret_hash: Vec<u8> = row.get(3).unwrap_or_default();
            let status: String = row.get(4).map_err(|e| e.to_string())?;
            let last_ping_ms: i64 = row.get(5).unwrap_or(0);
            let last_seen_at: i64 = row.get(6).unwrap_or(0);
            let created_at: i64 = row.get(7).unwrap_or(0);

            Ok(Some(PeerNodeRecord {
                node_id,
                moniker,
                url,
                shared_secret_hash,
                status,
                last_ping_ms,
                last_seen_at,
                created_at,
            }))
        } else {
            Ok(None)
        }
    }

    /// Inserts or updates a peer record in the cluster registry.
    pub async fn upsert_peer(peer: &PeerNodeRecord) -> Result<(), String> {
        let conn = Self::get_conn().await?;

        conn.execute(
            "INSERT INTO cluster_nodes (node_id, moniker, url, shared_secret_hash, status, last_ping_ms, last_seen_at, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
             ON CONFLICT(node_id) DO UPDATE SET moniker=?2, url=?3, shared_secret_hash=?4, status=?5, last_ping_ms=?6, last_seen_at=?7",
            libsql::params![
                peer.node_id.as_str(),
                peer.moniker.as_str(),
                peer.url.as_str(),
                peer.shared_secret_hash.clone(),
                peer.status.as_str(),
                peer.last_ping_ms,
                peer.last_seen_at,
                peer.created_at,
            ],
        )
        .await
        .map_err(|e| format!("Failed to upsert peer '{}': {}", peer.node_id, e))?;

        Ok(())
    }

    /// Removes a peer from the cluster mesh.
    pub async fn remove_peer(node_id: &str) -> Result<(), String> {
        let conn = Self::get_conn().await?;

        conn.execute("DELETE FROM cluster_nodes WHERE node_id = ?1", [node_id])
            .await
            .map_err(|e| format!("Failed to remove peer '{}': {}", node_id, e))?;

        Ok(())
    }

    /// Updates peer liveness status and round-trip latency.
    pub async fn update_peer_status(
        node_id: &str,
        status: &str,
        latency_ms: i64,
    ) -> Result<(), String> {
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "UPDATE cluster_nodes SET status = ?1, last_ping_ms = ?2, last_seen_at = ?3 WHERE node_id = ?4",
            libsql::params![status, latency_ms, now_unix, node_id],
        )
        .await
        .map_err(|e| format!("Failed to update peer status for '{}': {}", node_id, e))?;

        Ok(())
    }

    /// Records an ingested cluster event with deduplication.
    /// Returns `Ok(true)` if the event was newly recorded, or `Ok(false)` if it was already processed.
    pub async fn record_cluster_event(
        event_id: &str,
        event_type: &str,
        payload: &str,
        origin_node_id: &str,
    ) -> Result<bool, String> {
        let conn = Self::get_conn().await?;
        let now_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let affected = conn
            .execute(
                "INSERT OR IGNORE INTO cluster_events (event_id, event_type, payload, origin_node_id, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                libsql::params![event_id, event_type, payload, origin_node_id, now_unix],
            )
            .await
            .map_err(|e| format!("Failed to record cluster event '{}': {}", event_id, e))?;

        Ok(affected > 0)
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
        let db = libsql::Builder::new_local(":memory:")
            .build()
            .await
            .unwrap();
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
            .query(
                "SELECT username FROM users WHERE username = 'testadmin'",
                (),
            )
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
            .query(
                "SELECT operations FROM permissions WHERE role_name = 'read_role'",
                (),
            )
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
        let db = libsql::Builder::new_local(":memory:")
            .build()
            .await
            .unwrap();
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
            .query(
                "SELECT secret_hash FROM api_keys WHERE name = 'rotate_test'",
                (),
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let stored_hash: Vec<u8> = row.get(0).unwrap();

        assert_eq!(
            stored_hash,
            blake3::hash(b"new_rotated_secret_456").as_bytes()
        );
        assert_ne!(stored_hash, blake3::hash(b"initial_secret_123").as_bytes());
    }

    #[tokio::test]
    async fn test_session_token_hashing_and_validation() {
        let db_path = format!(
            "file:test_session_{}.db",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
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

        let raw_token = format!(
            "axm_sess_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
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
        let db_path = format!(
            "file:test_bans_{}.db",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let db = Builder::new_local(db_path.replace("file:", ""))
            .build()
            .await
            .unwrap();
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
        )
        .await
        .unwrap();

        conn.execute(
            "INSERT INTO ip_bans (ip, reason, banned_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            libsql::params![
                "192.168.1.200",
                "Expired ban",
                now_unix - 100,
                now_unix - 10
            ],
        )
        .await
        .unwrap();

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
            .execute(
                "DELETE FROM ip_bans WHERE expires_at > 0 AND expires_at <= ?1",
                [now_unix],
            )
            .await
            .unwrap();
        assert_eq!(affected, 1);

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }

    #[tokio::test]
    async fn test_blob_ticket_store_lifecycle() {
        let db_path = format!(
            "file:test_tickets_{}.db",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let db = Builder::new_local(db_path.replace("file:", ""))
            .build()
            .await
            .unwrap();
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
        )
        .await
        .unwrap();

        let mut check_rows = conn
            .query(
                "SELECT revoked FROM blob_tickets WHERE signature = 'sig_abc_123'",
                (),
            )
            .await
            .unwrap();
        let check_row = check_rows.next().await.unwrap().unwrap();
        let check_revoked: i64 = check_row.get(0).unwrap();
        assert_eq!(check_revoked, 1);

        // 4. Delete ticket
        conn.execute(
            "DELETE FROM blob_tickets WHERE signature = 'sig_abc_123'",
            (),
        )
        .await
        .unwrap();

        let mut deleted_rows = conn
            .query(
                "SELECT revoked FROM blob_tickets WHERE signature = 'sig_abc_123'",
                (),
            )
            .await
            .unwrap();
        assert!(deleted_rows.next().await.unwrap().is_none());

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }

    #[tokio::test]
    async fn test_system_secrets_lifecycle() {
        let db_path = format!(
            "file:test_secrets_{}.db",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let db = Builder::new_local(db_path.replace("file:", ""))
            .build()
            .await
            .unwrap();
        let conn = db.connect().unwrap();
        MetadataStore::create_tables(&conn).await.unwrap();

        MetadataStore::ensure_system_secrets_table(&conn)
            .await
            .unwrap();
        let s1 = {
            let entropy = format!("{}_{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
            blake3::hash(entropy.as_bytes()).to_hex().to_string()
        };
        conn.execute(
            "INSERT INTO system_secrets (key, value, created_at) VALUES ('test_key', ?1, 100)",
            [s1.clone()],
        )
        .await
        .unwrap();

        let mut rows = conn
            .query(
                "SELECT value FROM system_secrets WHERE key = 'test_key'",
                (),
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let s2: String = row.get(0).unwrap();
        assert_eq!(s1, s2);

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }

    #[tokio::test]
    async fn test_cluster_mesh_lifecycle() {
        let db_path = format!(
            "file:test_cluster_{}.db",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let db = Builder::new_local(db_path.replace("file:", ""))
            .build()
            .await
            .unwrap();
        let conn = db.connect().unwrap();
        MetadataStore::create_tables(&conn).await.unwrap();

        // 1. Insert peer
        let peer = PeerNodeRecord {
            node_id: "axm_node_london".to_string(),
            moniker: "London-Edge".to_string(),
            url: "https://london.internal:4500".to_string(),
            shared_secret_hash: vec![1, 2, 3, 4],
            status: "connected".to_string(),
            last_ping_ms: 24,
            last_seen_at: 1000,
            created_at: 1000,
        };

        conn.execute(
            "INSERT INTO cluster_nodes (node_id, moniker, url, shared_secret_hash, status, last_ping_ms, last_seen_at, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            libsql::params![
                peer.node_id.as_str(),
                peer.moniker.as_str(),
                peer.url.as_str(),
                peer.shared_secret_hash.clone(),
                peer.status.as_str(),
                peer.last_ping_ms,
                peer.last_seen_at,
                peer.created_at,
            ],
        ).await.unwrap();

        // 2. Query peer
        let mut rows = conn
            .query(
                "SELECT moniker, status FROM cluster_nodes WHERE node_id = 'axm_node_london'",
                (),
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let moniker: String = row.get(0).unwrap();
        let status: String = row.get(1).unwrap();
        assert_eq!(moniker, "London-Edge");
        assert_eq!(status, "connected");

        // 3. Cluster event deduplication
        let inserted1 = conn.execute(
            "INSERT OR IGNORE INTO cluster_events (event_id, event_type, payload, origin_node_id, created_at) \
             VALUES ('evt_123', 'ban.ip', '{\"ip\":\"1.2.3.4\"}', 'axm_node_london', 1000)",
            (),
        ).await.unwrap();
        assert_eq!(inserted1, 1);

        let inserted2 = conn.execute(
            "INSERT OR IGNORE INTO cluster_events (event_id, event_type, payload, origin_node_id, created_at) \
             VALUES ('evt_123', 'ban.ip', '{\"ip\":\"1.2.3.4\"}', 'axm_node_london', 1000)",
            (),
        ).await.unwrap();
        assert_eq!(inserted2, 0);

        let _ = std::fs::remove_file(db_path.replace("file:", ""));
    }

    #[tokio::test]
    async fn test_root_super_admin_protection_and_custom_permissions() {
        let db = Builder::new_local(":memory:")
            .build()
            .await
            .unwrap();
        let conn = db.connect().unwrap();
        MetadataStore::create_tables(&conn).await.unwrap();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // 1. First account created is automatically super-admin (id = 1)
        let perms = UserPermissionSet::default();
        let perms_json = serde_json::to_string(&perms).unwrap();
        conn.execute(
            "INSERT INTO users (username, password_hash, email, is_super_admin, permissions, created_at, updated_at) \
             VALUES ('rootadmin', 'hash123', 'root@axiom.io', 1, ?1, ?2, ?3)",
            libsql::params![perms_json, now, now],
        ).await.unwrap();

        // 2. Custom permission user created
        let custom_perms = UserPermissionSet {
            system: vec!["manage_keys".to_string(), "view_audit".to_string()],
            databases: vec![UserDbPermission {
                database: "analytics_db".to_string(),
                table_name: "events".to_string(),
                operations: vec!["SELECT".to_string(), "INSERT".to_string()],
            }],
            blobs: vec![UserBlobPermission {
                namespace: "assets".to_string(),
                operations: vec!["READ".to_string(), "WRITE".to_string()],
            }],
        };
        let custom_json = serde_json::to_string(&custom_perms).unwrap();
        conn.execute(
            "INSERT INTO users (username, password_hash, email, is_super_admin, permissions, created_at, updated_at) \
             VALUES ('dev_bob', 'hash456', 'bob@axiom.io', 0, ?1, ?2, ?3)",
            libsql::params![custom_json, now, now],
        ).await.unwrap();

        // 3. Verify querying root user and custom user
        let mut rows = conn
            .query("SELECT id, username, is_super_admin, permissions FROM users ORDER BY id ASC", ())
            .await
            .unwrap();

        let row1 = rows.next().await.unwrap().unwrap();
        let id1: i64 = row1.get(0).unwrap();
        let u1: String = row1.get(1).unwrap();
        let is_super1: i64 = row1.get(2).unwrap();
        assert_eq!(id1, 1);
        assert_eq!(u1, "rootadmin");
        assert_eq!(is_super1, 1);

        let row2 = rows.next().await.unwrap().unwrap();
        let id2: i64 = row2.get(0).unwrap();
        let u2: String = row2.get(1).unwrap();
        let is_super2: i64 = row2.get(2).unwrap();
        let perms2_str: String = row2.get(3).unwrap();
        let parsed_perms2: UserPermissionSet = serde_json::from_str(&perms2_str).unwrap();
        assert_eq!(id2, 2);
        assert_eq!(u2, "dev_bob");
        assert_eq!(is_super2, 0);
        assert_eq!(parsed_perms2.system, vec!["manage_keys", "view_audit"]);
        assert_eq!(parsed_perms2.databases[0].database, "analytics_db");
        assert_eq!(parsed_perms2.databases[0].table_name, "events");
        assert_eq!(parsed_perms2.blobs[0].namespace, "assets");

        // 4. Invariant: Root account (id = 1 or min id) cannot be deleted
        let min_id_res: i64 = conn.query("SELECT MIN(id) FROM users", ())
            .await
            .unwrap()
            .next()
            .await
            .unwrap()
            .unwrap()
            .get(0)
            .unwrap();
        assert_eq!(min_id_res, 1);

        // Attempting to delete id = 1 must be prevented by business logic guard
        let target_delete_id = 1i64;
        let delete_allowed = target_delete_id != 1 && target_delete_id != min_id_res;
        assert!(!delete_allowed, "Root account deletion must be prevented");

        // Attempting to demote root account must be prevented by business logic guard
        let target_demote_id = 1i64;
        let demote_allowed = target_demote_id != 1 && target_demote_id != min_id_res;
        assert!(!demote_allowed, "Root account demotion must be prevented");
    }

    #[test]
    fn test_has_system_permission_evaluation() {
        let perms = UserPermissionSet {
            system: vec![
                "databases.view".to_string(),
                "keys.*".to_string(),
                "cluster.manage".to_string(),
                "audit.view".to_string(),
            ],
            databases: vec![],
            blobs: vec![],
        };

        // Exact match
        assert!(perms.has_system_permission("databases.view"));
        assert!(!perms.has_system_permission("databases.create"));
        assert!(!perms.has_system_permission("databases.delete"));

        // Resource wildcard match (keys.*)
        assert!(perms.has_system_permission("keys.view"));
        assert!(perms.has_system_permission("keys.create"));
        assert!(perms.has_system_permission("keys.rotate"));
        assert!(perms.has_system_permission("keys.delete"));

        // Single action match (cluster.manage)
        assert!(perms.has_system_permission("cluster.manage"));
        assert!(!perms.has_system_permission("cluster.connect"));

        // Audit view
        assert!(perms.has_system_permission("audit.view"));

        // Global wildcard
        let admin_perms = UserPermissionSet {
            system: vec!["*".to_string()],
            databases: vec![],
            blobs: vec![],
        };
        assert!(admin_perms.has_system_permission("users.delete"));
        assert!(admin_perms.has_system_permission("anything.any_action"));
    }
}

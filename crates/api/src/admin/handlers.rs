/*
 * Admin HTTP API route handlers for keys, databases, status, and metadata synchronization.
 * Owned by: api/admin
 * Key deps: axum, serde, serde_json, base64, crate::metadata
 * Invariants: Endpoints require an active admin session token; keys are returned in plaintext only upon creation.
 * Last structural change: Phase 1 initial implementation of Admin API.
 */

use axum::{
    extract::{Path, Query},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use base64::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use axiom_core::{AuthContext, AxiomError};
use axiom_db::DatabasePoolManager;
use axiom_metadata::models::{PermissionRecord, UserPermissionSet};
use axiom_metadata::store::MetadataStore;
use axiom_policy::PolicyEngine;

pub const SETUP_SESSION_TTL_SECS: i64 = 30 * 24 * 60 * 60; // 30 days initial admin setup session
pub const LOGIN_SESSION_TTL_SECS: i64 = 7 * 24 * 60 * 60; // 7 days standard admin login session

/// Validates that an administrative identifier (database alias, role name, or API key name)
/// is strictly lowercase alphanumeric with underscores or hyphens (`^[a-z0-9_-]+$`).
/// Rejects spaces, uppercase characters, and special symbols.
pub fn validate_clean_name(kind: &str, name: &str) -> Result<(), AxiomError> {
    if name.is_empty() {
        return Err(AxiomError::new(
            "INVALID_NAME",
            &format!("{} cannot be empty", kind),
            StatusCode::BAD_REQUEST,
        ));
    }

    if name.len() > 64 {
        return Err(AxiomError::new(
            "INVALID_NAME",
            &format!("{} exceeds maximum length of 64 characters", kind),
            StatusCode::BAD_REQUEST,
        ));
    }

    // Require first and last characters to be alphanumeric
    let bytes = name.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return Err(AxiomError::new(
            "INVALID_NAME",
            &format!("{} must start with a lowercase letter or digit", kind),
            StatusCode::BAD_REQUEST,
        ));
    }
    if !bytes[bytes.len() - 1].is_ascii_lowercase() && !bytes[bytes.len() - 1].is_ascii_digit() {
        return Err(AxiomError::new(
            "INVALID_NAME",
            &format!("{} must end with a lowercase letter or digit", kind),
            StatusCode::BAD_REQUEST,
        ));
    }

    for c in name.chars() {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '_' && c != '-' {
            return Err(AxiomError::new(
                "INVALID_NAME",
                &format!(
                    "{} '{}' is invalid: must be strictly lowercase alphanumeric with hyphens or underscores (e.g. 'data_element' or 'data-element')",
                    kind, name
                ),
                StatusCode::BAD_REQUEST,
            ));
        }
    }

    Ok(())
}

/// Enforces that the calling operator session possesses the required PBAC capability.
/// Super-admin accounts (role == "admin" or is_super_admin == true) bypass all checks.
pub async fn check_permission(auth: &AuthContext, required: &str) -> Result<(), AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    // Fast-path: Super-administrator session bypasses all capability checks
    if auth.role.as_deref() == Some("admin") {
        return Ok(());
    }

    // Check operator's granular capabilities
    let actor = auth
        .api_key_name
        .strip_prefix("user:")
        .unwrap_or(&auth.api_key_name);
    if let Ok(Some(calling_user)) = MetadataStore::get_user_by_username(actor).await {
        if calling_user.is_super_admin || calling_user.permissions.has_system_permission(required) {
            return Ok(());
        }
    }

    Err(AxiomError::new(
        "FORBIDDEN",
        &format!(
            "Insufficient privileges: permission '{}' is required for this action",
            required
        ),
        StatusCode::FORBIDDEN,
    ))
}

/// Resolves and sanitizes database connection URLs with security constraints:
/// - LibSQL / SQLite:
///   - If URL is empty or whitespace: defaults to local file `sqlite://data/{alias}.db`
///   - If local file path: enforces strict jail to the `data/` directory.
///     Rejects directory traversal (`..`), absolute drive paths (e.g. `C:`), and root paths.
///   - If token is provided (for Turso or remote LibSQL): appends `?authToken={token}` if not already present.
/// - Other engines:
///   - Requires non-empty URL.
pub fn resolve_and_sanitize_db_url(
    alias: &str,
    raw_url: &str,
    engine: Option<&str>,
    token: Option<&str>,
) -> Result<String, AxiomError> {
    let trimmed = raw_url.trim();
    let engine_lower = engine.unwrap_or("").trim().to_lowercase();
    let is_libsql = engine_lower == "libsql"
        || engine_lower == "sqlite"
        || trimmed.starts_with("libsql://")
        || trimmed.starts_with("sqlite://")
        || trimmed.starts_with("file:")
        || trimmed.starts_with("file://");

    let mut resolved = if is_libsql {
        if trimmed.is_empty() {
            // Default to embedded sqlite file in data/ directory
            let clean_alias = alias.trim();
            if clean_alias.is_empty() {
                "sqlite://data/database.db".to_string()
            } else {
                format!("sqlite://data/{}.db", clean_alias)
            }
        } else if trimmed == ":memory:"
            || trimmed == "sqlite://:memory:"
            || trimmed == "file::memory:"
            || trimmed == "file://:memory:"
        {
            "sqlite://:memory:".to_string()
        } else if trimmed.starts_with("libsql://")
            || trimmed.starts_with("https://")
            || trimmed.starts_with("http://")
        {
            // Remote Turso or LibSQL server
            trimmed.to_string()
        } else {
            // Local file path - must be jailed strictly to data/
            let stripped = trimmed
                .strip_prefix("sqlite://")
                .or_else(|| trimmed.strip_prefix("file://"))
                .or_else(|| trimmed.strip_prefix("file:"))
                .unwrap_or(trimmed);

            let normalized = stripped.replace('\\', "/");

            // Disallow directory traversal
            if normalized.contains("..") {
                return Err(AxiomError::new(
                    "FORBIDDEN_PATH",
                    "Local database files are restricted to the 'data/' directory. Directory traversal ('..') is prohibited.",
                    StatusCode::FORBIDDEN,
                ));
            }

            // Disallow Windows drive letters (e.g. C:, D:)
            if normalized.contains(':') {
                return Err(AxiomError::new(
                    "FORBIDDEN_PATH",
                    "Local database files are restricted to the 'data/' directory. Absolute drive paths are prohibited.",
                    StatusCode::FORBIDDEN,
                ));
            }

            // Disallow Unix root paths (e.g. /etc/passwd)
            if normalized.starts_with('/') {
                return Err(AxiomError::new(
                    "FORBIDDEN_PATH",
                    "Local database files are restricted to the 'data/' directory. Absolute root paths are prohibited.",
                    StatusCode::FORBIDDEN,
                ));
            }

            let path_part = normalized.trim_start_matches("./");
            if path_part.starts_with("data/") {
                format!("sqlite://{}", path_part)
            } else {
                format!("sqlite://data/{}", path_part.trim_start_matches('/'))
            }
        }
    } else {
        if trimmed.is_empty() {
            return Err(AxiomError::new(
                "INVALID_URL",
                "Database connection URL cannot be empty",
                StatusCode::BAD_REQUEST,
            ));
        }
        trimmed.to_string()
    };

    // If an auth token was supplied and the resolved URL doesn't already contain authToken
    if let Some(tok) = token.map(|t| t.trim()).filter(|t| !t.is_empty()) {
        if !resolved.contains("authToken=") {
            if resolved.contains('?') {
                resolved.push_str(&format!("&authToken={}", tok));
            } else {
                resolved.push_str(&format!("?authToken={}", tok));
            }
        }
    }

    Ok(resolved)
}

// ─── Request Schemas ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub cursor: Option<i64>,
    pub before_id: Option<i64>,
    pub search: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct SetupAccountRequest {
    pub username: String,
    pub email: Option<String>,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateKeyRequest {
    pub name: String,
    pub role: Option<String>,
    pub secret: Option<String>,
    pub rate_limit: Option<i64>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AddDatabaseRequest {
    pub alias: String,
    pub url: String,
    pub engine: Option<String>,
    pub pool_min: Option<i64>,
    pub pool_max: Option<i64>,
    #[serde(default)]
    pub old_alias: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PermissionPayload {
    pub database: String,
    pub table_name: String,
    pub operations: Vec<String>,
    #[serde(default)]
    pub rls_filter: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: Vec<PermissionPayload>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoleRequest {
    pub description: Option<String>,
    pub permissions: Option<Vec<PermissionPayload>>,
}

// ─── Route Handlers ────────────────────────────────────────────────────────

/// Returns general server status, uptime, and metadata telemetry.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns JSON containing server version, uptime, key counts, and snapshot time.
///  - Idempotent: Yes.
pub async fn get_status(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "settings.view").await?;

    let snapshot = axiom_metadata::snapshot::get_snapshot();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    Ok(Json(json!({
        "success": true,
        "data": {
            "version": env!("CARGO_PKG_VERSION"),
            "status": "healthy",
            "active_keys": snapshot.keys.len(),
            "active_databases": snapshot.databases.len(),
            "snapshot_loaded_at": snapshot.loaded_at_unix,
            "current_time": now
        },
        "error": Value::Null
    })))
}

/// Triggers an immediate reload and publication of the metadata snapshot from SQLite.
/// CONTRACT:
///  - Side effects: Reloads database tables and calls `update_snapshot()`.
///  - Idempotent: Yes.
pub async fn reload_metadata(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "settings.manage").await?;

    MetadataStore::sync_snapshot().await.map_err(|e| {
        AxiomError::new(
            "METADATA_SYNC_FAILED",
            &e,
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;

    let actor = if !auth.api_key_name.is_empty() {
        &auth.api_key_name
    } else {
        "admin"
    };
    let _ = MetadataStore::record_audit(
        actor,
        "metadata.reload",
        "all",
        Some("Metadata snapshot reloaded from database"),
    )
    .await;

    let snapshot = axiom_metadata::snapshot::get_snapshot();
    Ok(Json(json!({
        "success": true,
        "data": {
            "message": "Metadata snapshot successfully synchronized",
            "active_keys": snapshot.keys.len(),
            "active_databases": snapshot.databases.len(),
            "loaded_at": snapshot.loaded_at_unix
        },
        "error": Value::Null
    })))
}

/// Lists all registered API keys (with secret hashes safely redacted).
pub async fn list_keys(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "keys.view").await?;

    let keys = MetadataStore::list_keys()
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "keys": keys
        },
        "error": Value::Null
    })))
}

/// Generates a new API key, stores its BLAKE3 hash, and returns the single-use plaintext token.
/// CONTRACT:
///  - Precondition: `payload.name` must be alphanumeric without colons.
///  - Side effects: Writes to SQLite, triggers snapshot reload, and publishes audit log.
///  - Idempotent: No (creates new key identity).
pub async fn create_key(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CreateKeyRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "keys.create").await?;

    validate_clean_name("Key name", &payload.name)?;

    let secret = MetadataStore::create_key(
        &payload.name,
        payload.role.as_deref(),
        payload.secret.as_deref(),
        payload.rate_limit.unwrap_or(0),
        payload.expires_at,
    )
    .await
    .map_err(|e| AxiomError::new("KEY_CREATION_FAILED", &e, StatusCode::BAD_REQUEST))?;

    // Format single-use credentials token as base64(name:secret)
    let raw_token = format!("{}:{}", payload.name, secret);
    let encoded_token = BASE64_STANDARD.encode(raw_token.as_bytes());

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": {
                "name": payload.name,
                "role": payload.role,
                "token": encoded_token,
                "secret": secret,
                "note": "Save this token now; the plaintext secret cannot be recovered."
            },
            "error": Value::Null
        })),
    ))
}

/// Deletes an API key identity and immediately evicts it from the active snapshot.
pub async fn delete_key(
    Extension(auth): Extension<AuthContext>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "keys.delete").await?;

    let deleted = MetadataStore::delete_key(&name).await.map_err(|e| {
        AxiomError::new("KEY_DELETION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR)
    })?;

    if !deleted {
        return Err(AxiomError::new(
            "KEY_NOT_FOUND",
            "API key does not exist",
            StatusCode::NOT_FOUND,
        ));
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("API key '{}' deleted successfully", name)
        },
        "error": Value::Null
    })))
}

/// Rotates the secret for an existing API key, updates its BLAKE3 hash, and returns the new credentials token.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Precondition: Key `name` must exist in `api_keys` table.
///  - Side effects: Modifies `api_keys` row, appends to `audit_log`, and triggers `sync_snapshot`.
///  - Returns JSON containing the new single-use token and secret.
///  - Idempotent: No (generates a new unique secret).
pub async fn rotate_key(
    Extension(auth): Extension<AuthContext>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "keys.rotate").await?;

    let secret = MetadataStore::rotate_key(&name).await.map_err(|e| {
        if e.contains("not found") {
            AxiomError::new("KEY_NOT_FOUND", &e, StatusCode::NOT_FOUND)
        } else {
            AxiomError::new("KEY_ROTATION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR)
        }
    })?;

    // Encode standard base64(name:secret) token payload for API client authentication
    let raw_token = format!("{}:{}", name, secret);
    let encoded_token = BASE64_STANDARD.encode(raw_token.as_bytes());

    Ok(Json(json!({
        "success": true,
        "data": {
            "name": name,
            "token": encoded_token,
            "secret": secret,
            "note": "Save this token now; the plaintext secret cannot be recovered."
        },
        "error": Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct UpdateKeyRequest {
    pub role: Option<Option<String>>,
    pub rate_limit: Option<i64>,
    pub expires_at: Option<Option<i64>>,
}

/// Updates an existing API key's role, rate limit, or expiration timestamp.
pub async fn update_key(
    Extension(auth): Extension<AuthContext>,
    Path(name): Path<String>,
    Json(payload): Json<UpdateKeyRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "keys.update").await?;

    let role_ref = payload.role.as_ref().map(|opt| opt.as_deref());
    let updated =
        MetadataStore::update_key(&name, role_ref, payload.rate_limit, payload.expires_at)
            .await
            .map_err(|e| AxiomError::new("KEY_UPDATE_FAILED", &e, StatusCode::BAD_REQUEST))?;

    if !updated {
        return Err(AxiomError::new(
            "KEY_NOT_FOUND",
            "API key does not exist",
            StatusCode::NOT_FOUND,
        ));
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "name": name,
            "status": "updated"
        },
        "error": Value::Null
    })))
}

// ─── Managed Database Endpoints ──────────────────────────────────────────
// Database endpoints allow live registration and deregistration of upstream engines.
// Passwords and raw connection strings must never leak in API response bodies.

/// Lists all configured database connections.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns list of registered database metadata (raw credentials redacted).
///  - Idempotent: Yes.
pub async fn list_databases(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    let is_super = auth.role.as_deref() == Some("admin");
    let has_view_perm = check_permission(&auth, "databases.view").await.is_ok();
    let has_granular_db = auth
        .permissions
        .iter()
        .any(|p| !p.database.starts_with("blob:"));

    if !is_super && !has_view_perm && !has_granular_db {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Insufficient privileges: databases.view permission required",
            StatusCode::FORBIDDEN,
        ));
    }

    let databases = MetadataStore::list_databases()
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let filtered_dbs: Vec<_> = if has_granular_db {
        let aliases: Vec<String> = databases.iter().map(|d| d.alias.clone()).collect();
        let allowed_aliases = PolicyEngine::filter_databases(&auth, &aliases);
        databases
            .into_iter()
            .filter(|d| {
                allowed_aliases
                    .iter()
                    .any(|a| a.eq_ignore_ascii_case(&d.alias))
            })
            .collect()
    } else {
        databases
    };

    Ok(Json(json!({
        "success": true,
        "data": {
            "databases": filtered_dbs
        },
        "error": Value::Null
    })))
}

/// Registers a new upstream database connection or updates an existing alias.
/// CONTRACT:
///  - Precondition: `payload.alias` and `payload.url` must be non-empty strings.
///  - Side effects: Persists to SQLite `databases` table and updates `ArcSwap` snapshot.
///  - Idempotent: Yes (upsert behavior).
pub async fn add_database(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<AddDatabaseRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "databases.create").await?;

    validate_clean_name("Database alias", &payload.alias)?;

    let url_trimmed = payload.url.trim();
    let lookup_alias = payload.old_alias.as_deref().unwrap_or(&payload.alias);
    let is_existing = axiom_metadata::snapshot::get_snapshot()
        .databases
        .contains_key(lookup_alias);

    // Determine the effective connection URL to test and save
    let effective_url = if is_existing && (url_trimmed.is_empty() || url_trimmed.contains('•')) {
        if let Some(existing) = axiom_metadata::snapshot::get_snapshot()
            .databases
            .get(lookup_alias)
        {
            existing.url.clone()
        } else {
            return Err(AxiomError::new(
                "INVALID_URL",
                "Database connection URL cannot be empty",
                StatusCode::BAD_REQUEST,
            ));
        }
    } else {
        resolve_and_sanitize_db_url(
            &payload.alias,
            url_trimmed,
            payload.engine.as_deref(),
            payload.token.as_deref(),
        )?
    };

    // Enforce uniqueness: Reject if another database alias already uses this connection URL
    let snapshot = axiom_metadata::snapshot::get_snapshot();
    for (existing_alias, existing_db) in snapshot.databases.iter() {
        if existing_alias != &payload.alias
            && existing_alias != lookup_alias
            && MetadataStore::urls_match(&existing_db.url, &effective_url)
        {
            return Err(AxiomError::new(
                "DATABASE_URL_ALREADY_EXISTS",
                &format!(
                    "This database connection URL is already registered under alias '{}'",
                    existing_alias
                ),
                StatusCode::CONFLICT,
            ));
        }
    }

    // Mandatory live connection check every time when adding or updating
    let dialect = DatabasePoolManager::test_url(&effective_url)
        .await
        .map_err(|e| {
            AxiomError::new(
                "DATABASE_CONNECTION_FAILED",
                &format!("Connection check failed: {}", e),
                StatusCode::BAD_REQUEST,
            )
        })?;

    let engine_to_use = payload.engine.as_deref().unwrap_or(&dialect);

    MetadataStore::add_database(
        &payload.alias,
        &effective_url,
        Some(engine_to_use),
        payload.pool_min,
        payload.pool_max,
        payload.old_alias.as_deref(),
    )
    .await
    .map_err(|e| AxiomError::new("DATABASE_REGISTRATION_FAILED", &e, StatusCode::BAD_REQUEST))?;

    // Invalidate cached engine in pool manager so next call connects with updated configuration
    if let Some(ref old) = payload.old_alias {
        if old != &payload.alias {
            DatabasePoolManager::remove_engine(old).await;
        }
    }
    DatabasePoolManager::remove_engine(&payload.alias).await;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": {
                "alias": payload.alias,
                "dialect": dialect,
                "engine": engine_to_use,
                "message": format!("Database '{}' successfully verified and configured", payload.alias)
            },
            "error": Value::Null
        })),
    ))
}

/// Deregisters an upstream database connection and evicts it from the active snapshot.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Side effects: Removes database row from SQLite and updates `ArcSwap` snapshot.
///  - Idempotent: Yes.
pub async fn delete_database(
    Extension(auth): Extension<AuthContext>,
    Path(alias): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "databases.delete").await?;

    let deleted = MetadataStore::delete_database(&alias).await.map_err(|e| {
        AxiomError::new(
            "DATABASE_DELETION_FAILED",
            &e,
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;

    if !deleted {
        return Err(AxiomError::new(
            "DATABASE_NOT_FOUND",
            "Database alias does not exist",
            StatusCode::NOT_FOUND,
        ));
    }

    // Invalidate and disconnect cached pool in DatabasePoolManager
    DatabasePoolManager::remove_engine(&alias).await;

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("Database '{}' deleted successfully", alias)
        },
        "error": Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct UpdateDatabaseRequest {
    pub new_alias: Option<String>,
    pub url: Option<String>,
    pub engine: Option<String>,
    pub pool_min: Option<i64>,
    pub pool_max: Option<i64>,
}

/// Updates an existing database configuration (and tests connection if URL provided).
pub async fn update_database(
    Extension(auth): Extension<AuthContext>,
    Path(alias): Path<String>,
    Json(payload): Json<UpdateDatabaseRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "databases.update").await?;

    if let Some(ref new_a) = payload.new_alias {
        validate_clean_name("Database alias", new_a)?;
    }

    // Call MetadataStore::update_database
    MetadataStore::update_database(
        &alias,
        payload.new_alias.as_deref(),
        payload.url.as_deref(),
        payload.engine.as_deref(),
        payload.pool_min,
        payload.pool_max,
    )
    .await
    .map_err(|e| AxiomError::new("DATABASE_UPDATE_FAILED", &e, StatusCode::BAD_REQUEST))?;

    // Invalidate old connection pool so new settings take effect immediately
    DatabasePoolManager::remove_engine(&alias).await;
    if let Some(ref new_a) = payload.new_alias {
        DatabasePoolManager::remove_engine(new_a).await;
    }

    let effective_alias = payload.new_alias.unwrap_or(alias);
    Ok(Json(json!({
        "success": true,
        "data": {
            "alias": effective_alias,
            "status": "updated"
        },
        "error": Value::Null
    })))
}

/// Tests connectivity and queries health status for a configured database target.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Precondition: `alias` must match a configured database connection.
///  - Returns JSON payload reporting health status and engine dialect.
///  - Idempotent: Yes.
pub async fn test_database(
    Extension(auth): Extension<AuthContext>,
    Path(alias): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "databases.view").await?;

    let exists = axiom_metadata::snapshot::get_snapshot()
        .databases
        .contains_key(&alias);

    if !exists {
        return Err(AxiomError::new(
            "DATABASE_NOT_FOUND",
            &format!("Database alias '{}' not configured", alias),
            StatusCode::NOT_FOUND,
        ));
    }

    let engine = DatabasePoolManager::get_engine(&alias)
        .await
        .ok_or_else(|| {
            AxiomError::new(
                "CONNECTION_FAILED",
                &format!("Failed to connect to database '{}'", alias),
                StatusCode::BAD_GATEWAY,
            )
        })?;

    let healthy = engine.health_check().await;
    if !healthy {
        return Err(AxiomError::new(
            "HEALTH_CHECK_FAILED",
            &format!("Database '{}' health check failed", alias),
            StatusCode::BAD_GATEWAY,
        ));
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "alias": alias,
            "status": "connected",
            "dialect": engine.dialect(),
            "message": "Connection healthy"
        },
        "error": Value::Null
    })))
}

// ─── Role & Permission Endpoints ─────────────────────────────────────────
// RBAC administrative endpoints allowing definition and assignment of fine-grained
// table and operation permissions. Updates immediately sync to the ArcSwap snapshot.

/// Lists all configured RBAC roles with their attached permission grants.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns list of role records and their operations.
///  - Idempotent: Yes.
pub async fn list_roles(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "roles.view").await?;

    let roles = MetadataStore::list_roles()
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "roles": roles
        },
        "error": Value::Null
    })))
}

/// Creates a new role and defines its initial permission grants.
/// CONTRACT:
///  - Precondition: `payload.name` must be non-empty and alphanumeric/underscores.
///  - Side effects: Writes to SQLite `roles` and `permissions` tables, updates snapshot.
///  - Idempotent: No (fails if role already exists).
pub async fn create_role(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CreateRoleRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "roles.create").await?;

    let role_name = payload.name.trim();
    validate_clean_name("Role name", role_name)?;

    let permissions: Vec<PermissionRecord> = payload
        .permissions
        .into_iter()
        .map(|p| PermissionRecord {
            id: 0,
            role_name: role_name.to_string(),
            database: p.database,
            table_name: p.table_name,
            operations: p.operations,
            rls_filter: p.rls_filter,
        })
        .collect();

    MetadataStore::create_role(role_name, payload.description.as_deref(), &permissions)
        .await
        .map_err(|e| AxiomError::new("ROLE_CREATION_FAILED", &e, StatusCode::BAD_REQUEST))?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": {
                "name": role_name,
                "message": format!("Role '{}' created successfully", role_name)
            },
            "error": Value::Null
        })),
    ))
}

/// Updates an existing role's description and/or replaces its permission grants.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Side effects: Updates SQLite `roles` and `permissions` tables, updates snapshot.
///  - Idempotent: Yes.
pub async fn update_role(
    Extension(auth): Extension<AuthContext>,
    Path(name): Path<String>,
    Json(payload): Json<UpdateRoleRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "roles.update").await?;

    let permissions = payload.permissions.map(|perms| {
        perms
            .into_iter()
            .map(|p| PermissionRecord {
                id: 0,
                role_name: name.clone(),
                database: p.database,
                table_name: p.table_name,
                operations: p.operations,
                rls_filter: p.rls_filter,
            })
            .collect()
    });

    let updated = MetadataStore::update_role(&name, payload.description.as_deref(), permissions)
        .await
        .map_err(|e| {
            AxiomError::new("ROLE_UPDATE_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    if !updated {
        return Err(AxiomError::new(
            "ROLE_NOT_FOUND",
            "Role does not exist",
            StatusCode::NOT_FOUND,
        ));
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("Role '{}' updated successfully", name)
        },
        "error": Value::Null
    })))
}

/// Deletes a role and its attached permissions.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Side effects: Deletes from SQLite `roles` and `permissions` tables, updates snapshot.
///  - Idempotent: Yes.
pub async fn delete_role(
    Extension(auth): Extension<AuthContext>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "roles.delete").await?;

    let deleted = MetadataStore::delete_role(&name).await.map_err(|e| {
        if e.contains("active API key") {
            AxiomError::new("ROLE_IN_USE", &e, StatusCode::CONFLICT)
        } else {
            AxiomError::new(
                "ROLE_DELETION_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        }
    })?;

    if !deleted {
        return Err(AxiomError::new(
            "ROLE_NOT_FOUND",
            "Role does not exist",
            StatusCode::NOT_FOUND,
        ));
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("Role '{}' deleted successfully", name)
        },
        "error": Value::Null
    })))
}

/// Returns runtime caching performance statistics and memory usage.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns CacheStatsSnapshot JSON payload.
///  - Idempotent: Yes.
pub async fn get_cache_stats(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "settings.view").await?;

    let stats = axiom_cache::CacheEngine::stats();
    Ok(Json(json!({
        "success": true,
        "data": stats,
        "error": Value::Null
    })))
}

/// Flushes all entries from L1 RAM cache and persistent L2 disk cache.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Side effects: Clears DashMap and empties SQLite cache table.
///  - Idempotent: Yes.
pub async fn flush_cache(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "settings.manage").await?;

    axiom_cache::CacheEngine::flush().await;

    let actor = if !auth.api_key_name.is_empty() {
        &auth.api_key_name
    } else {
        "admin"
    };
    let _ = MetadataStore::record_audit(
        actor,
        "cache.flush",
        "all",
        Some("All L1 and L2 cache entries invalidated"),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": "All cache entries flushed successfully"
        },
        "error": Value::Null
    })))
}

/// Retrieves paginated audit logs documenting administrative control plane events.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns JSON list of AuditRecord entries.
///  - Side effects: None.
///  - Idempotent: Yes.
pub async fn get_audit_log(
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<AuditQuery>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "audit.view").await?;

    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let offset = query.offset.unwrap_or(0);
    let before_id = query.cursor.or(query.before_id);
    let search_term = query.search.as_deref().filter(|s| !s.trim().is_empty());

    let logs = MetadataStore::query_audit_log_cursor(limit, offset, before_id, search_term)
        .await
        .map_err(|e| {
            AxiomError::new("AUDIT_QUERY_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    let total = MetadataStore::count_audit_log(search_term)
        .await
        .unwrap_or(0);

    let has_more = offset + logs.len() < total as usize;
    let next_cursor = if has_more {
        logs.last().map(|r| r.id)
    } else {
        None
    };

    Ok(Json(json!({
        "success": true,
        "data": {
            "records": logs,
            "total": total,
            "has_more": has_more
        },
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total,
            "has_more": has_more,
            "next_offset": if has_more { Some(offset + limit) } else { None },
            "next_cursor": next_cursor
        },
        "error": Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct MetricsQuery {
    pub format: Option<String>,
}

/// Returns Prometheus exposition format or JSON metrics for admin monitoring.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Supports `?format=json` or `Accept: application/json` for structured JSON output.
///  - Defaults to text/plain formatted Prometheus metrics.
///  - Side effects: None.
///  - Idempotent: Yes.
pub async fn get_metrics(
    Query(query): Query<MetricsQuery>,
    headers: axum::http::HeaderMap,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "settings.view").await?;

    let is_json = query.format.as_deref() == Some("json")
        || headers
            .get(axum::http::header::ACCEPT)
            .and_then(|h| h.to_str().ok())
            .map(|a| a.contains("application/json"))
            .unwrap_or(false);

    if is_json {
        let snapshot = crate::metrics::MetricsEngine::snapshot();
        let body = serde_json::to_string(&json!({
            "success": true,
            "data": snapshot,
            "error": Value::Null
        }))
        .unwrap_or_default();
        return axum::response::Response::builder()
            .header(
                axum::http::header::CONTENT_TYPE,
                "application/json; charset=utf-8",
            )
            .body(axum::body::Body::from(body))
            .map_err(|e| {
                AxiomError::new(
                    "HTTP_ERROR",
                    &e.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            });
    }

    let metrics_text = crate::metrics::MetricsEngine::render_prometheus();
    axum::response::Response::builder()
        .header(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )
        .body(axum::body::Body::from(metrics_text))
        .map_err(|e| {
            AxiomError::new(
                "HTTP_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

/// Detailed health check for administrators.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns JSON status of server uptime, system metrics, and upstream database targets.
///  - Idempotent: Yes.
pub async fn get_admin_health(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "settings.view").await?;

    let snapshot = axiom_metadata::snapshot::get_snapshot();

    let mut db_status = serde_json::Map::new();
    let mut all_dbs_up = true;

    // Parallelize engine health probes with a strict 3-second timeout per target
    // to prevent worker thread starvation and slow response degradation when upstreams hang.
    let aliases: Vec<String> = snapshot.databases.keys().cloned().collect();
    let probe_results = futures::future::join_all(aliases.into_iter().map(|alias| async move {
        let is_up = if let Some(engine) = DatabasePoolManager::get_engine(&alias).await {
            tokio::time::timeout(std::time::Duration::from_secs(3), engine.health_check())
                .await
                .unwrap_or(false)
        } else {
            false
        };
        (alias, is_up)
    }))
    .await;

    for (alias, is_up) in probe_results {
        db_status.insert(alias, json!(if is_up { "up" } else { "down" }));
        if !is_up {
            all_dbs_up = false;
        }
    }

    let (cpu_percent, memory_used_mb) =
        tokio::task::spawn_blocking(crate::core::health::get_system_stats)
            .await
            .unwrap_or((0.0, 0));

    Ok(Json(json!({
        "success": true,
        "data": {
            "status": if all_dbs_up { "healthy" } else { "degraded" },
            "uptime_seconds": crate::core::health::get_uptime(),
            "system": {
                "cpu_percent": cpu_percent,
                "memory_used_mb": memory_used_mb
            },
            "databases": db_status
        },
        "error": Value::Null
    })))
}

// ─── Setup Wizard Handlers ─────────────────────────────────────────────────

/// Evaluates if the initial setup wizard needs to be run.
/// CONTRACT:
///  - Returns: { setup_required: bool }
///  - Side effects: None.
///  - Idempotent: Yes.
pub async fn setup_begin() -> Result<impl IntoResponse, AxiomError> {
    let has_users = MetadataStore::has_users().await.map_err(|e| {
        AxiomError::new(
            "METADATA_STORE_ERROR",
            &e,
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;
    Ok(Json(json!({
        "success": true,
        "data": {
            "setup_required": !has_users
        },
        "error": Value::Null
    })))
}

/// Creates the initial administrative account and logs in automatically.
/// CONTRACT:
///  - Precondition: No admin users exist in axiom.db.
///  - Returns: Session token and Set-Cookie header.
///  - Throws: 403 FORBIDDEN if setup has already been completed.
///  - Side effects: Inserts user and session, logs audit event.
pub async fn setup_account(
    headers: axum::http::HeaderMap,
    Json(payload): Json<SetupAccountRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let has_users = MetadataStore::has_users().await.map_err(|e| {
        AxiomError::new(
            "METADATA_STORE_ERROR",
            &e,
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;
    if has_users {
        return Err(AxiomError::new(
            "SETUP_ALREADY_COMPLETED",
            "Setup wizard is permanently locked.",
            StatusCode::FORBIDDEN,
        ));
    }

    if payload.username.trim().is_empty() || payload.password.len() < 8 {
        return Err(AxiomError::new(
            "INVALID_INPUT",
            "Username required and password must be at least 8 characters",
            StatusCode::BAD_REQUEST,
        ));
    }

    let clean_email = payload
        .email
        .as_deref()
        .map(|e| e.trim())
        .filter(|e| !e.is_empty());

    let em = match clean_email {
        Some(em) if em.contains('@') && em.contains('.') && em.len() <= 255 => em,
        Some(_) => {
            return Err(AxiomError::new(
                "INVALID_INPUT",
                "Email format is invalid",
                StatusCode::BAD_REQUEST,
            ));
        }
        None => {
            return Err(AxiomError::new(
                "INVALID_INPUT",
                "Email address is required for administrator setup",
                StatusCode::BAD_REQUEST,
            ));
        }
    };

    MetadataStore::create_user(&payload.username, Some(em), &payload.password)
        .await
        .map_err(|e| {
            let status = if e.contains("already exists") {
                StatusCode::CONFLICT
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            AxiomError::new("USER_CREATION_FAILED", &e, status)
        })?;

    let session_id = MetadataStore::create_session(&payload.username, SETUP_SESSION_TTL_SECS)
        .await
        .map_err(|e| {
            AxiomError::new(
                "SESSION_CREATION_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    let config = axiom_core::ConfigManager::get();
    let is_https = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.eq_ignore_ascii_case("https"))
        .unwrap_or(false)
        || !config.server.tls_cert.is_empty();
    let secure_flag = if is_https { "; Secure" } else { "" };

    let cookie_header = format!(
        "axiom_session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}{}",
        session_id, SETUP_SESSION_TTL_SECS, secure_flag
    );

    let user_record = MetadataStore::get_user_by_username(&payload.username)
        .await
        .ok()
        .flatten();

    Ok((
        [(axum::http::header::SET_COOKIE, cookie_header)],
        Json(json!({
            "success": true,
            "data": {
                "token": session_id,
                "session_token": session_id,
                "username": payload.username,
                "user": user_record
            },
            "error": Value::Null
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct TestUrlRequest {
    pub url: String,
    pub alias: Option<String>,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
}

/// Tests connectivity against a raw database URL directly without saving it.
pub async fn test_database_url(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<TestUrlRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let has_users = MetadataStore::has_users().await.map_err(|e| {
        AxiomError::new(
            "METADATA_STORE_ERROR",
            &e,
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;
    if has_users {
        check_permission(&auth, "databases.view").await?;
    }

    let effective_url = resolve_and_sanitize_db_url(
        payload.alias.as_deref().unwrap_or("test_db"),
        &payload.url,
        payload.engine.as_deref(),
        payload.token.as_deref(),
    )?;

    let dialect = DatabasePoolManager::test_url(&effective_url)
        .await
        .map_err(|e| AxiomError::new("DATABASE_CONNECTION_FAILED", &e, StatusCode::BAD_REQUEST))?;

    // Check if this URL is already registered under another database alias
    let snapshot = axiom_metadata::snapshot::get_snapshot();
    for (existing_alias, existing_db) in snapshot.databases.iter() {
        if Some(existing_alias) != payload.alias.as_ref()
            && MetadataStore::urls_match(&existing_db.url, &effective_url)
        {
            return Err(AxiomError::new(
                "DATABASE_URL_ALREADY_EXISTS",
                &format!(
                    "This database connection URL is already registered under alias '{}'",
                    existing_alias
                ),
                StatusCode::CONFLICT,
            ));
        }
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "status": "connected",
            "dialect": dialect,
            "resolved_url": effective_url,
            "message": "Connection healthy"
        },
        "error": Value::Null
    })))
}

/// Adds the first database during the setup wizard.
/// CONTRACT:
///  - Tests database connection before registering.
///  - Side effects: Registers database in axiom.db.
pub async fn setup_database(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<AddDatabaseRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    validate_clean_name("Database alias", &payload.alias)?;

    let effective_url = resolve_and_sanitize_db_url(
        &payload.alias,
        &payload.url,
        payload.engine.as_deref(),
        payload.token.as_deref(),
    )?;

    // 1. Verify database connectivity before saving
    let dialect = DatabasePoolManager::test_url(&effective_url)
        .await
        .map_err(|e| {
            AxiomError::new(
                "DATABASE_CONNECTION_FAILED",
                &format!("Connection failed: {}", e),
                StatusCode::BAD_REQUEST,
            )
        })?;

    // 2. Enforce uniqueness: Check if this URL is already registered
    let snapshot = axiom_metadata::snapshot::get_snapshot();
    for (existing_alias, existing_db) in snapshot.databases.iter() {
        if existing_alias != &payload.alias
            && MetadataStore::urls_match(&existing_db.url, &effective_url)
        {
            return Err(AxiomError::new(
                "DATABASE_URL_ALREADY_EXISTS",
                &format!(
                    "This database connection URL is already registered under alias '{}'",
                    existing_alias
                ),
                StatusCode::CONFLICT,
            ));
        }
    }

    MetadataStore::add_database(
        &payload.alias,
        &effective_url,
        payload.engine.as_deref().or(Some(&dialect)),
        payload.pool_min,
        payload.pool_max,
        None,
    )
    .await
    .map_err(|e| {
        AxiomError::new(
            "DATABASE_REGISTRATION_FAILED",
            &e,
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;

    let actor = if !auth.api_key_name.is_empty() {
        &auth.api_key_name
    } else {
        "admin"
    };
    let _ = MetadataStore::record_audit(actor, "database.add", &payload.alias, None).await;

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("Database '{}' registered and verified", payload.alias),
            "dialect": dialect
        },
        "error": Value::Null
    })))
}

/// Finalizes the setup wizard, permanently locking it.
/// CONTRACT:
///  - Returns: Success confirmation.
pub async fn setup_complete(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": "Axiom setup finalized successfully"
        },
        "error": Value::Null
    })))
}

// ─── Authentication Handlers ───────────────────────────────────────────────

/// Verifies admin credentials and issues a session token and cookie.
/// CONTRACT:
///  - Precondition: `payload` contains valid username and password.
///  - Returns: Session token and Set-Cookie header.
pub const TRUSTED_DEVICE_TTL_SECS: i64 = 30 * 24 * 60 * 60; // 30 days trusted device token
pub const MAX_ACCOUNT_FAILED_ATTEMPTS: u32 = 5;
pub const MAX_TRUSTED_ACCOUNT_FAILED_ATTEMPTS: u32 = 15;
pub const ACCOUNT_LOCKOUT_WINDOW_SECS: u64 = 15 * 60; // 15 minutes lockout window

/// Helper to generate and verify HMAC-signed trusted device tokens
fn verify_trusted_device_token(cookie_val: &str, username: &str, secret: &str) -> bool {
    let parts: Vec<&str> = cookie_val.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    let (u, exp_str, sig) = (parts[0], parts[1], parts[2]);
    if u != username {
        return false;
    }
    let exp: i64 = match exp_str.parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    if exp < now {
        return false;
    }
    let msg = format!("{}.{}.{}", u, exp, secret);
    let expected_sig = blake3::hash(msg.as_bytes()).to_hex().to_string();
    crate::cluster::signing::constant_time_str_eq(sig, &expected_sig)
}

fn create_trusted_device_token(username: &str, secret: &str) -> (String, i64) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let exp = now + TRUSTED_DEVICE_TTL_SECS;
    let msg = format!("{}.{}.{}", username, exp, secret);
    let sig = blake3::hash(msg.as_bytes()).to_hex().to_string();
    (format!("{}.{}.{}", username, exp, sig), exp)
}

/// Verifies admin credentials and issues a session token and cookie.
/// CONTRACT:
///  - Precondition: `payload` contains non-empty username (<= 128 chars) and password (<= 256 chars).
///  - Pre-Argon2 Defense:
///    1. Cheap input bounds validation (0ms, 0 CPU).
///    2. Trusted-device cookie detection (`axiom_trusted_device`).
///    3. Distributed per-account sliding window rate limiting across all IPs.
///    4. Argon2 concurrency bounding via semaphore in `MetadataStore::verify_user`.
///  - Returns: Session token, session cookie, and trusted device cookie.
///  - Side effects: Inserts session row and resets failed account counters on success.
pub async fn login_handler(
    headers: axum::http::HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    // 1. Cheap Input Format and Length Pre-validation (Zero CPU Burn)
    let username = payload.username.trim();
    if username.is_empty()
        || username.len() > 128
        || payload.password.is_empty()
        || payload.password.len() > 256
    {
        return Err(AxiomError::new(
            "INVALID_INPUT",
            "Username or password does not meet length requirements",
            StatusCode::BAD_REQUEST,
        ));
    }

    let device_secret =
        match MetadataStore::get_or_create_system_secret("trusted_device_hmac_key").await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Failed to retrieve system secret for trusted device: {}", e);
                return Err(AxiomError::new(
                    "INTERNAL_SECURITY_ERROR",
                    "Internal security configuration error",
                    StatusCode::INTERNAL_SERVER_ERROR,
                ));
            }
        };

    // 2. Evaluate Trusted Device Cookie
    let mut is_trusted_device = false;
    if let Some(cookie_hdr) = headers
        .get(axum::http::header::COOKIE)
        .and_then(|h| h.to_str().ok())
    {
        for cookie_part in cookie_hdr.split(';') {
            let trimmed = cookie_part.trim();
            if let Some(token_val) = trimmed.strip_prefix("axiom_trusted_device=") {
                if verify_trusted_device_token(token_val, username, &device_secret) {
                    is_trusted_device = true;
                    break;
                }
            }
        }
    }

    // 3. Distributed Per-Account Rate Limiting (Prevents CPU exhaustion across distributed IPs)
    let account_key = format!("rl:account:{}", username.to_lowercase());
    let allowed_attempts = if is_trusted_device {
        MAX_TRUSTED_ACCOUNT_FAILED_ATTEMPTS
    } else {
        MAX_ACCOUNT_FAILED_ATTEMPTS
    };

    let current_failures: u32 = axiom_cache::CacheEngine::get(&account_key)
        .await
        .and_then(|b| String::from_utf8(b.to_vec()).ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    if current_failures >= allowed_attempts {
        crate::metrics::MetricsEngine::record_auth_failure("account_locked");
        return Err(AxiomError::new(
            "ACCOUNT_LOCKED",
            "Account temporarily locked due to excessive failed attempts. Please try again later.",
            StatusCode::TOO_MANY_REQUESTS,
        ));
    }

    // 4. Compute-Intensive Password Verification (Semaphore-guarded on blocking thread)
    let verify_res = MetadataStore::verify_user(username, &payload.password).await;
    let canonical_user = match verify_res {
        Ok(Some(u)) => u,
        Ok(None) => {
            crate::metrics::MetricsEngine::record_auth_failure("invalid_admin_password");
            let new_failures = current_failures.saturating_add(1);
            axiom_cache::CacheEngine::set(
                &account_key,
                bytes::Bytes::from(new_failures.to_string()),
                ACCOUNT_LOCKOUT_WINDOW_SECS,
                axiom_cache::Durability::Ephemeral,
            )
            .await;

            return Err(AxiomError::new(
                "INVALID_CREDENTIALS",
                "Invalid administrative username or password",
                StatusCode::UNAUTHORIZED,
            ));
        }
        Err(err) if err == "SERVER_BUSY_AUTH_THROTTLED" => {
            crate::metrics::MetricsEngine::record_auth_failure("server_busy_throttled");
            return Err(AxiomError::new(
                "SERVER_BUSY",
                "Authentication service is operating under high load. Please retry shortly.",
                StatusCode::SERVICE_UNAVAILABLE,
            ));
        }
        Err(e) => {
            return Err(AxiomError::new(
                "AUTH_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    // 5. Successful Login: Clear Account Failures and Issue Tokens
    axiom_cache::CacheEngine::set(
        &account_key,
        bytes::Bytes::from("0"),
        ACCOUNT_LOCKOUT_WINDOW_SECS,
        axiom_cache::Durability::Ephemeral,
    )
    .await;
    let canonical_account_key = format!("rl:account:{}", canonical_user.to_lowercase());
    if canonical_account_key != account_key {
        axiom_cache::CacheEngine::set(
            &canonical_account_key,
            bytes::Bytes::from("0"),
            ACCOUNT_LOCKOUT_WINDOW_SECS,
            axiom_cache::Durability::Ephemeral,
        )
        .await;
    }

    let session_id = MetadataStore::create_session(&canonical_user, LOGIN_SESSION_TTL_SECS)
        .await
        .map_err(|e| {
            AxiomError::new(
                "SESSION_CREATION_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    let config = axiom_core::ConfigManager::get();
    let is_https = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.eq_ignore_ascii_case("https"))
        .unwrap_or(false)
        || !config.server.tls_cert.is_empty();
    let secure_flag = if is_https { "; Secure" } else { "" };
    let (trusted_token, _) = create_trusted_device_token(&canonical_user, &device_secret);
    let cookie_header = format!(
        "axiom_session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}{}",
        session_id, LOGIN_SESSION_TTL_SECS, secure_flag
    );
    let trusted_cookie_header = format!(
        "axiom_trusted_device={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}{}",
        trusted_token, TRUSTED_DEVICE_TTL_SECS, secure_flag
    );

    let mut headers_map = axum::http::HeaderMap::new();
    if let Ok(val) = axum::http::HeaderValue::from_str(&cookie_header) {
        headers_map.append(axum::http::header::SET_COOKIE, val);
    }
    if let Ok(val) = axum::http::HeaderValue::from_str(&trusted_cookie_header) {
        headers_map.append(axum::http::header::SET_COOKIE, val);
    }

    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
        + LOGIN_SESSION_TTL_SECS;

    let user_record = MetadataStore::get_user_by_username(&canonical_user)
        .await
        .ok()
        .flatten();

    Ok((
        headers_map,
        Json(json!({
            "success": true,
            "data": {
                "token": session_id,
                "session_token": session_id,
                "username": canonical_user,
                "user": user_record,
                "expires_at": expires_at
            },
            "error": Value::Null
        })),
    ))
}

/// Returns the authenticated caller's user record and effective permissions.
pub async fn get_me_handler(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required",
            StatusCode::FORBIDDEN,
        ));
    }

    let actor = auth
        .api_key_name
        .strip_prefix("user:")
        .unwrap_or(&auth.api_key_name);
    let user = MetadataStore::get_user_by_username(actor)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?
        .ok_or_else(|| {
            AxiomError::new("NOT_FOUND", "User record not found", StatusCode::NOT_FOUND)
        })?;

    Ok(Json(json!({
        "success": true,
        "data": user,
        "error": Value::Null
    })))
}

/// Revokes an active administrative session.
/// CONTRACT:
///  - Side effects: Removes session from axiom.db and clears cookie.
pub async fn logout_handler(
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, AxiomError> {
    let mut token = None;
    if let Some(auth_hdr) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
    {
        if let Some(stripped) = auth_hdr.strip_prefix("Bearer ") {
            token = Some(stripped.to_string());
        }
    }
    if token.is_none() {
        if let Some(cookie_hdr) = headers
            .get(axum::http::header::COOKIE)
            .and_then(|h| h.to_str().ok())
        {
            for part in cookie_hdr.split(';') {
                let trimmed = part.trim();
                if let Some(val) = trimmed.strip_prefix("axiom_session=") {
                    token = Some(val.to_string());
                    break;
                }
            }
        }
    }

    if let Some(t) = token {
        let _ = MetadataStore::delete_session(&t).await;
        axiom_cache::CacheEngine::delete(&format!("sess:{}", t)).await;
    }

    let clear_cookie = "axiom_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
    Ok((
        [(axum::http::header::SET_COOKIE, clear_cookie)],
        Json(json!({
            "success": true,
            "data": {
                "message": "Logged out successfully"
            },
            "error": Value::Null
        })),
    ))
}

/// Lists all registered administrative accounts.
/// CONTRACT:
///  - Invariant: Password hashes are redacted from UserRecord.
///  - Idempotent: Yes.
pub async fn list_users_handler(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "users.view").await?;

    let users = MetadataStore::list_users().await.map_err(|e| {
        AxiomError::new("USERS_FETCH_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR)
    })?;

    Ok(Json(json!({
        "success": true,
        "data": users,
        "error": Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub email: Option<String>,
    pub permissions: Option<UserPermissionSet>,
}

/// Creates a new administrator account with granular custom permissions or super-admin status.
pub async fn create_user_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "users.create").await?;

    let actor = auth
        .api_key_name
        .strip_prefix("user:")
        .unwrap_or(&auth.api_key_name);
    let caller_user = MetadataStore::get_user_by_username(actor)
        .await
        .ok()
        .flatten();
    let is_caller_super = caller_user
        .as_ref()
        .map(|u| u.is_super_admin || u.id == 1)
        .unwrap_or(false);

    let username = payload.username.trim();
    if username.is_empty() {
        return Err(AxiomError::new(
            "INVALID_USERNAME",
            "Username cannot be empty",
            StatusCode::BAD_REQUEST,
        ));
    }

    if payload.password.len() < 8 {
        return Err(AxiomError::new(
            "WEAK_PASSWORD",
            "Password must be at least 8 characters long",
            StatusCode::BAD_REQUEST,
        ));
    }

    let perms = payload.permissions.unwrap_or_default();

    // Security Invariant (Anti-Privilege-Escalation):
    // A non-root administrator cannot grant any privilege that they do not personally hold.
    if !is_caller_super {
        if let Some(ref caller) = caller_user {
            caller.permissions.subsumes(&perms).map_err(|e| {
                AxiomError::new("PRIVILEGE_ESCALATION_BLOCKED", &e, StatusCode::FORBIDDEN)
            })?;
        } else {
            return Err(AxiomError::new(
                "FORBIDDEN",
                "Unauthorized identity cannot provision permissions",
                StatusCode::FORBIDDEN,
            ));
        }
    }

    // Invariant: Non-root accounts can NEVER be super-admin.
    let created = MetadataStore::create_user_with_permissions(
        username,
        payload.email.as_deref(),
        &payload.password,
        None,
        Some(perms),
    )
    .await
    .map_err(|e| AxiomError::new("USER_CREATION_FAILED", &e, StatusCode::BAD_REQUEST))?;

    let _ = MetadataStore::record_audit(
        actor,
        "user.create",
        &created.username,
        Some(&format!(
            "Created user id={} (super_admin={})",
            created.id, created.is_super_admin
        )),
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": created,
            "error": Value::Null
        })),
    ))
}

/// Retrieves a single administrator account by internal ID.
pub async fn get_user_handler(
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "users.view").await?;

    let user = MetadataStore::get_user_by_id(id)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    match user {
        Some(u) => Ok(Json(json!({
            "success": true,
            "data": u,
            "error": Value::Null
        }))),
        None => Err(AxiomError::new(
            "NOT_FOUND",
            "User does not exist",
            StatusCode::NOT_FOUND,
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub username: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
    pub permissions: Option<UserPermissionSet>,
}

/// Updates an existing administrator's credentials or custom permission set.
/// CONTRACT:
///  - Invariant: Root administrator (id = 1) cannot be demoted to non-super-admin.
///  - Invariant: Root administrator credentials can only be modified by the root administrator themselves.
pub async fn update_user_handler(
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "users.update").await?;

    let actor = auth
        .api_key_name
        .strip_prefix("user:")
        .unwrap_or(&auth.api_key_name);

    // Resolve caller identity and privileges
    let caller_user = MetadataStore::get_user_by_username(actor)
        .await
        .ok()
        .flatten();
    let is_caller_root = caller_user
        .as_ref()
        .map(|u| u.id == 1 || u.is_super_admin)
        .unwrap_or(false);

    // Verify target existence and protect root account from modification by secondary accounts
    let target_user = MetadataStore::get_user_by_id(id)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?
        .ok_or_else(|| {
            AxiomError::new(
                "NOT_FOUND",
                &format!("User with id {} not found", id),
                StatusCode::NOT_FOUND,
            )
        })?;

    let is_target_root = target_user.id == 1 || target_user.is_super_admin;
    if is_target_root && !is_caller_root {
        return Err(AxiomError::new(
            "ROOT_ACCOUNT_PROTECTED",
            "Root super-administrator account credentials can only be updated by the root administrator account itself",
            StatusCode::FORBIDDEN,
        ));
    }

    // Security Invariant (Anti-Privilege-Escalation):
    // A non-root administrator cannot grant any privilege that they do not personally hold.
    if let Some(ref req_perms) = payload.permissions {
        if !is_caller_root {
            if let Some(ref caller) = caller_user {
                caller.permissions.subsumes(req_perms).map_err(|e| {
                    AxiomError::new("PRIVILEGE_ESCALATION_BLOCKED", &e, StatusCode::FORBIDDEN)
                })?;
            } else {
                return Err(AxiomError::new(
                    "FORBIDDEN",
                    "Unauthorized identity cannot update user permissions",
                    StatusCode::FORBIDDEN,
                ));
            }
        }
    }

    if let Some(ref pwd) = payload.password {
        if !pwd.is_empty() && pwd.len() < 8 {
            return Err(AxiomError::new(
                "WEAK_PASSWORD",
                "Password must be at least 8 characters long",
                StatusCode::BAD_REQUEST,
            ));
        }
    }

    if let Some(ref u) = payload.username {
        let clean = u.trim();
        if clean.is_empty() {
            return Err(AxiomError::new(
                "INVALID_USERNAME",
                "Username cannot be empty",
                StatusCode::BAD_REQUEST,
            ));
        }
        if clean.len() < 3 {
            return Err(AxiomError::new(
                "INVALID_USERNAME",
                "Username must be at least 3 characters long",
                StatusCode::BAD_REQUEST,
            ));
        }
    }

    let email_arg = payload.email.as_deref().map(Some);
    MetadataStore::update_user_by_id(
        id,
        payload.username.as_deref(),
        email_arg,
        payload.password.as_deref(),
        None,
        payload.permissions,
    )
    .await
    .map_err(|e| {
        if e.contains("cannot be demoted") {
            AxiomError::new("ROOT_ACCOUNT_PROTECTED", &e, StatusCode::FORBIDDEN)
        } else if e.contains("already taken") {
            AxiomError::new("USERNAME_TAKEN", &e, StatusCode::CONFLICT)
        } else if e.contains("not found") {
            AxiomError::new("NOT_FOUND", &e, StatusCode::NOT_FOUND)
        } else {
            AxiomError::new("USER_UPDATE_FAILED", &e, StatusCode::BAD_REQUEST)
        }
    })?;

    let updated = MetadataStore::get_user_by_id(id)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?
        .ok_or_else(|| {
            AxiomError::new(
                "NOT_FOUND",
                "User not found after update",
                StatusCode::NOT_FOUND,
            )
        })?;

    let _ = MetadataStore::record_audit(
        actor,
        "user.update",
        &updated.username,
        Some(&format!("Updated user id={}", updated.id)),
    )
    .await;

    // Instantly invalidate RAM session caches so updated permissions take effect immediately
    axiom_cache::CacheEngine::invalidate_prefix("sess:");

    Ok(Json(json!({
        "success": true,
        "data": updated,
        "error": Value::Null
    })))
}

/// Deletes an administrator account.
/// CONTRACT:
///  - Invariant: Root administrator (id = 1 or is_super_admin) cannot be deleted under any circumstances.
///  - Invariant: An administrator cannot delete their own active session account.
pub async fn delete_user_handler(
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "users.delete").await?;

    let actor = auth
        .api_key_name
        .strip_prefix("user:")
        .unwrap_or(&auth.api_key_name);
    if let Ok(Some(target_user)) = MetadataStore::get_user_by_id(id).await {
        // Enforce root super administrator account protection
        if target_user.id == 1 || target_user.is_super_admin {
            return Err(AxiomError::new(
                "ROOT_ACCOUNT_PROTECTED",
                "Root super admin account cannot be deleted",
                StatusCode::FORBIDDEN,
            ));
        }

        // Enforce self-deletion prevention for active operator account
        if target_user.username.eq_ignore_ascii_case(actor) {
            return Err(AxiomError::new(
                "FORBIDDEN",
                "Cannot delete your own active administrator account",
                StatusCode::FORBIDDEN,
            ));
        }
    }

    MetadataStore::delete_user_by_id(id).await.map_err(|e| {
        if e.contains("cannot be deleted") {
            AxiomError::new("ROOT_ACCOUNT_PROTECTED", &e, StatusCode::FORBIDDEN)
        } else if e.contains("not found") {
            AxiomError::new("NOT_FOUND", &e, StatusCode::NOT_FOUND)
        } else {
            AxiomError::new(
                "USER_DELETION_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        }
    })?;

    let _ = MetadataStore::record_audit(
        actor,
        "user.delete",
        &format!("user_id:{}", id),
        Some("Deleted administrator user account"),
    )
    .await;

    // Purge cached sessions on user deletion
    axiom_cache::CacheEngine::invalidate_prefix("sess:");

    Ok(Json(json!({
        "success": true,
        "data": {
            "id": id,
            "message": "User successfully deleted"
        },
        "error": Value::Null
    })))
}

// ─── Cluster Administration Endpoints ─────────────────────────────────────
// Coordinates peer pairing, cluster overview metrics, and manual peer lifecycle management.

#[derive(Debug, Deserialize)]
pub struct ConnectPeerRequest {
    pub url: String,
    pub cluster_secret: String,
    pub moniker: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMonikerRequest {
    pub moniker: String,
}

/// Returns the local cluster node identity, cluster secret, and connected peer counts.
pub async fn get_cluster_status(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "cluster.view").await?;

    let identity = MetadataStore::get_or_create_cluster_identity()
        .await
        .map_err(|e| AxiomError::new("CLUSTER_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;
    let (node_id, moniker, cluster_secret) = identity;

    let peers = MetadataStore::list_peers()
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let total_peers = peers.len();
    let connected_peers = peers.iter().filter(|p| p.status == "connected").count();

    Ok(Json(json!({
        "success": true,
        "data": {
            "node_id": node_id,
            "moniker": moniker,
            "cluster_secret": cluster_secret,
            "total_peers": total_peers,
            "connected_peers": connected_peers
        },
        "error": Value::Null
    })))
}

/// Lists all known peers in the cluster mesh.
pub async fn list_cluster_peers(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "cluster.view").await?;

    let peers = MetadataStore::list_peers()
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "peers": peers
        },
        "error": Value::Null
    })))
}

/// Initiates an authenticated pairing handshake with a remote Axiom node.
pub async fn connect_cluster_peer(
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<ConnectPeerRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "cluster.connect").await?;

    let target_url = req.url.trim().trim_end_matches('/').to_string();
    if !target_url.starts_with("http://") && !target_url.starts_with("https://") {
        return Err(AxiomError::new(
            "INVALID_URL",
            "Peer URL must begin with http:// or https://",
            StatusCode::BAD_REQUEST,
        ));
    }

    let identity = MetadataStore::get_or_create_cluster_identity()
        .await
        .map_err(|e| AxiomError::new("CLUSTER_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;
    let (my_node_id, my_moniker, _my_secret) = identity;

    let config = axiom_core::ConfigManager::get();
    let my_advertise_url = format!(
        "http://{}:{}",
        if config.server.host == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &config.server.host
        },
        config.server.port
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| {
            AxiomError::new(
                "CLIENT_INIT_FAILED",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    let handshake_payload = json!({
        "node_id": my_node_id,
        "moniker": my_moniker,
        "advertise_url": my_advertise_url,
        "cluster_secret": req.cluster_secret,
    });

    let endpoint = format!("{}/internal/v1/cluster/handshake", target_url);
    let start = std::time::Instant::now();
    let resp = client
        .post(&endpoint)
        .json(&handshake_payload)
        .send()
        .await
        .map_err(|e| {
            AxiomError::new(
                "HANDSHAKE_NETWORK_ERROR",
                &format!("Could not reach peer at {}: {}", endpoint, e),
                StatusCode::BAD_GATEWAY,
            )
        })?;

    let latency_ms = start.elapsed().as_millis() as i64;

    if !resp.status().is_success() {
        let err_text = resp
            .text()
            .await
            .unwrap_or_else(|_| "Peer rejected handshake".to_string());
        return Err(AxiomError::new(
            "HANDSHAKE_REJECTED",
            &format!("Peer rejected handshake: {}", err_text),
            StatusCode::UNAUTHORIZED,
        ));
    }

    let handshake_res: crate::cluster::handlers::HandshakeResponse =
        resp.json().await.map_err(|e| {
            AxiomError::new(
                "INVALID_HANDSHAKE_RESPONSE",
                &format!("Malformed response from peer: {}", e),
                StatusCode::BAD_GATEWAY,
            )
        })?;

    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let peer = axiom_metadata::models::PeerNodeRecord {
        node_id: handshake_res.node_id.clone(),
        moniker: req.moniker.unwrap_or(handshake_res.moniker),
        url: target_url,
        shared_secret_hash: blake3::hash(req.cluster_secret.as_bytes())
            .as_bytes()
            .to_vec(),
        status: "connected".to_string(),
        last_ping_ms: latency_ms,
        last_seen_at: now_unix,
        created_at: now_unix,
    };

    MetadataStore::upsert_peer(&peer)
        .await
        .map_err(|e| AxiomError::new("STORE_PEER_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": peer,
        "error": Value::Null
    })))
}

/// Removes a registered peer from the cluster mesh.
pub async fn remove_cluster_peer(
    Extension(auth): Extension<AuthContext>,
    Path(node_id): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "cluster.manage").await?;

    MetadataStore::remove_peer(&node_id)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("Peer '{}' successfully removed", node_id)
        },
        "error": Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct UpdatePeerRequest {
    pub moniker: Option<String>,
    pub url: Option<String>,
    pub cluster_secret: Option<String>,
}

/// Updates configuration (moniker, advertise URL, shared secret) for an existing registered peer node.
pub async fn update_cluster_peer(
    Extension(auth): Extension<AuthContext>,
    Path(node_id): Path<String>,
    Json(req): Json<UpdatePeerRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "cluster.manage").await?;

    let mut peer = MetadataStore::get_peer(&node_id)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?
        .ok_or_else(|| {
            AxiomError::new(
                "PEER_NOT_FOUND",
                "Peer node not found",
                StatusCode::NOT_FOUND,
            )
        })?;

    if let Some(m) = req.moniker {
        let trimmed = m.trim();
        if !trimmed.is_empty() {
            peer.moniker = trimmed.to_string();
        }
    }

    if let Some(u) = req.url {
        let trimmed = u.trim();
        if !trimmed.is_empty() {
            peer.url = trimmed.trim_end_matches('/').to_string();
        }
    }

    if let Some(s) = req.cluster_secret {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            peer.shared_secret_hash = blake3::hash(trimmed.as_bytes()).as_bytes().to_vec();
        }
    }

    MetadataStore::upsert_peer(&peer)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": peer,
        "error": Value::Null
    })))
}

/// Dispatches an immediate signed ping heartbeat to verify peer liveness and refresh latency telemetry.
pub async fn ping_cluster_peer(
    Extension(auth): Extension<AuthContext>,
    Path(node_id): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "cluster.view").await?;

    let mut peer = MetadataStore::get_peer(&node_id)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?
        .ok_or_else(|| {
            AxiomError::new(
                "PEER_NOT_FOUND",
                "Peer node not found",
                StatusCode::NOT_FOUND,
            )
        })?;

    let identity = MetadataStore::get_or_create_cluster_identity()
        .await
        .map_err(|e| AxiomError::new("CLUSTER_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;
    let (my_node_id, _moniker, cluster_secret) = identity;

    let target_url = format!(
        "{}/internal/v1/cluster/ping",
        peer.url.trim_end_matches('/')
    );
    let (node_header, ts_header, nonce_header, sig_header) =
        crate::cluster::signing::sign_outbound_packet(&my_node_id, &cluster_secret, b"");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| {
            AxiomError::new(
                "CLIENT_INIT_FAILED",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    let start = std::time::Instant::now();
    let res = client
        .get(&target_url)
        .header("X-Axiom-Node-Id", node_header)
        .header("X-Axiom-Timestamp", ts_header.to_string())
        .header("X-Axiom-Nonce", nonce_header)
        .header("X-Axiom-Signature", sig_header)
        .send()
        .await;

    let latency_ms = start.elapsed().as_millis() as i64;
    let (new_status, new_latency) = match res {
        Ok(resp) if resp.status().is_success() => ("connected", latency_ms),
        _ => ("unreachable", latency_ms),
    };

    let _ = MetadataStore::update_peer_status(&node_id, new_status, new_latency).await;
    peer.status = new_status.to_string();
    peer.last_ping_ms = new_latency;
    peer.last_seen_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    Ok(Json(json!({
        "success": true,
        "data": peer,
        "error": Value::Null
    })))
}

/// Updates the local node moniker.
pub async fn update_cluster_moniker(
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<UpdateMonikerRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    check_permission(&auth, "cluster.manage").await?;

    let moniker = req.moniker.trim();
    if moniker.is_empty() {
        return Err(AxiomError::new(
            "INVALID_MONIKER",
            "Node moniker cannot be empty",
            StatusCode::BAD_REQUEST,
        ));
    }

    MetadataStore::set_cluster_moniker(moniker)
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let actor = if !auth.api_key_name.is_empty() {
        &auth.api_key_name
    } else {
        "admin"
    };
    let _ = MetadataStore::record_audit(actor, "cluster.moniker_update", moniker, None).await;

    Ok(Json(json!({
        "success": true,
        "data": {
            "moniker": moniker
        },
        "error": Value::Null
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trusted_device_token_lifecycle() {
        let username = "admin_sec_test";
        let secret = "axiom_secret_test_entropy_9988";
        let (token, exp) = create_trusted_device_token(username, secret);

        assert!(exp > 0);
        assert!(verify_trusted_device_token(&token, username, secret));

        // Tampered username fails
        assert!(!verify_trusted_device_token(&token, "attacker", secret));

        // Tampered secret fails
        assert!(!verify_trusted_device_token(
            &token,
            username,
            "wrong_secret"
        ));

        // Malformed token fails
        assert!(!verify_trusted_device_token(
            "garbage.token",
            username,
            secret
        ));
    }

    #[test]
    fn test_lockout_constants() {
        assert_eq!(MAX_ACCOUNT_FAILED_ATTEMPTS, 5);
        assert_eq!(MAX_TRUSTED_ACCOUNT_FAILED_ATTEMPTS, 15);
        assert_eq!(ACCOUNT_LOCKOUT_WINDOW_SECS, 900);
    }

    #[test]
    fn test_validate_clean_name() {
        // Valid names
        assert!(validate_clean_name("database", "data_element").is_ok());
        assert!(validate_clean_name("role", "data-element").is_ok());
        assert!(validate_clean_name("key", "analytics_db_01").is_ok());
        assert!(validate_clean_name("role", "admin-read-only").is_ok());

        // Invalid names: uppercase, spaces, special symbols
        assert!(validate_clean_name("database", "adadad ADADAD").is_err());
        assert!(validate_clean_name("database", "DataElement").is_err());
        assert!(validate_clean_name("database", "DATA_ELEMENT").is_err());
        assert!(validate_clean_name("role", "role with spaces").is_err());
        assert!(validate_clean_name("key", "key@name!").is_err());
        assert!(validate_clean_name("key", "-start_with_dash").is_err());
        assert!(validate_clean_name("key", "end_with_dash-").is_err());
        assert!(validate_clean_name("key", "").is_err());
    }

    #[test]
    fn test_resolve_and_sanitize_db_url() {
        // 1. LibSQL / SQLite empty URL defaults to sqlite://data/{alias}.db
        let default_url = resolve_and_sanitize_db_url("mydb", "", Some("libsql"), None).unwrap();
        assert_eq!(default_url, "sqlite://data/mydb.db");

        // 2. LibSQL / SQLite with relative filename puts it in data/
        let rel_url =
            resolve_and_sanitize_db_url("mydb", "my_custom.db", Some("libsql"), None).unwrap();
        assert_eq!(rel_url, "sqlite://data/my_custom.db");

        // 3. LibSQL / SQLite with data/ prefix stays intact
        let in_data =
            resolve_and_sanitize_db_url("mydb", "data/nested.db", Some("libsql"), None).unwrap();
        assert_eq!(in_data, "sqlite://data/nested.db");

        let sqlite_in_data =
            resolve_and_sanitize_db_url("mydb", "sqlite://data/nested.db", None, None).unwrap();
        assert_eq!(sqlite_in_data, "sqlite://data/nested.db");

        // 4. Memory databases permitted
        let mem = resolve_and_sanitize_db_url("mydb", ":memory:", Some("libsql"), None).unwrap();
        assert_eq!(mem, "sqlite://:memory:");

        // 5. Remote Turso URL with token
        let turso = resolve_and_sanitize_db_url(
            "turso_db",
            "libsql://my-org.turso.io",
            Some("libsql"),
            Some("jwt_token_123"),
        )
        .unwrap();
        assert_eq!(turso, "libsql://my-org.turso.io?authToken=jwt_token_123");

        // 6. Remote Turso with existing param
        let turso_existing = resolve_and_sanitize_db_url(
            "turso_db",
            "libsql://my-org.turso.io?tls=true",
            Some("libsql"),
            Some("jwt_token_123"),
        )
        .unwrap();
        assert_eq!(
            turso_existing,
            "libsql://my-org.turso.io?tls=true&authToken=jwt_token_123"
        );

        // 7. Security: Directory traversal rejected
        let trav = resolve_and_sanitize_db_url("mydb", "../evil.db", Some("libsql"), None);
        assert!(trav.is_err());
        assert_eq!(trav.unwrap_err().code, "FORBIDDEN_PATH");

        let trav_nested =
            resolve_and_sanitize_db_url("mydb", "data/../../evil.db", Some("libsql"), None);
        assert!(trav_nested.is_err());
        assert_eq!(trav_nested.unwrap_err().code, "FORBIDDEN_PATH");

        // 8. Security: Absolute drive paths rejected
        let drive = resolve_and_sanitize_db_url("mydb", "C:/Windows/win.db", Some("libsql"), None);
        assert!(drive.is_err());
        assert_eq!(drive.unwrap_err().code, "FORBIDDEN_PATH");

        // 9. Security: Root paths rejected
        let root = resolve_and_sanitize_db_url("mydb", "/etc/shadow.db", Some("libsql"), None);
        assert!(root.is_err());
        assert_eq!(root.unwrap_err().code, "FORBIDDEN_PATH");

        // 10. Non-libsql empty URL rejected
        let empty_pg = resolve_and_sanitize_db_url("pgdb", "", Some("postgres"), None);
        assert!(empty_pg.is_err());
        assert_eq!(empty_pg.unwrap_err().code, "INVALID_URL");
    }

    #[tokio::test]
    async fn test_check_permission_enforcement() {
        // 1. Non-session auth context must be rejected unconditionally
        let non_session_ctx = AuthContext {
            api_key_name: "test_key".to_string(),
            role: Some("admin".to_string()),
            is_session: false,
            ..Default::default()
        };
        let res = check_permission(&non_session_ctx, "databases.create").await;
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, "FORBIDDEN");

        // 2. Superadmin session bypasses check_permission
        let superadmin_ctx = AuthContext {
            api_key_name: "user:root".to_string(),
            role: Some("admin".to_string()),
            is_session: true,
            ..Default::default()
        };
        assert!(check_permission(&superadmin_ctx, "databases.create")
            .await
            .is_ok());
        assert!(check_permission(&superadmin_ctx, "blobs.delete")
            .await
            .is_ok());
        assert!(check_permission(&superadmin_ctx, "users.delete")
            .await
            .is_ok());

        // 3. Custom session user without privileges must be rejected
        let custom_missing = AuthContext {
            api_key_name: "user:ghost_operator".to_string(),
            role: Some("custom".to_string()),
            is_session: true,
            ..Default::default()
        };
        assert!(check_permission(&custom_missing, "databases.create")
            .await
            .is_err());
    }
}

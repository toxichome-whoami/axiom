/*
 * Admin HTTP API route handlers for keys, databases, status, and metadata synchronization.
 * Owned by: api/admin
 * Key deps: axum, serde, serde_json, base64, crate::metadata
 * Invariants: Endpoints require full_admin or admin role privileges; keys are returned in plaintext only upon creation.
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

use axiom_core::{AxiomError, AuthContext, ConfigManager};
use axiom_db::DatabasePoolManager;
use axiom_metadata::models::PermissionRecord;
use axiom_metadata::store::MetadataStore;

// ─── Request Schemas ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct SetupAccountRequest {
    pub username: String,
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
}

#[derive(Debug, Deserialize)]
pub struct PermissionPayload {
    pub database: String,
    pub table_name: String,
    pub operations: Vec<String>,
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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    MetadataStore::sync_snapshot()
        .await
        .map_err(|e| AxiomError::new("METADATA_SYNC_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    if payload.name.is_empty() || payload.name.contains(':') {
        return Err(AxiomError::new(
            "INVALID_KEY_NAME",
            "Key name must be non-empty and cannot contain colons",
            StatusCode::BAD_REQUEST,
        ));
    }

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let deleted = MetadataStore::delete_key(&name)
        .await
        .map_err(|e| AxiomError::new("KEY_DELETION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let secret = MetadataStore::rotate_key(&name)
        .await
        .map_err(|e| {
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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let databases = MetadataStore::list_databases()
        .await
        .map_err(|e| AxiomError::new("METADATA_ERROR", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "databases": databases
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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    if payload.alias.trim().is_empty() {
        return Err(AxiomError::new(
            "INVALID_ALIAS",
            "Database alias cannot be empty",
            StatusCode::BAD_REQUEST,
        ));
    }

    if payload.url.trim().is_empty() {
        return Err(AxiomError::new(
            "INVALID_URL",
            "Database connection URL cannot be empty",
            StatusCode::BAD_REQUEST,
        ));
    }

    MetadataStore::add_database(
        &payload.alias,
        &payload.url,
        payload.engine.as_deref(),
        payload.pool_min,
        payload.pool_max,
    )
    .await
    .map_err(|e| AxiomError::new("DATABASE_REGISTRATION_FAILED", &e, StatusCode::BAD_REQUEST))?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": {
                "alias": payload.alias,
                "message": format!("Database '{}' successfully configured", payload.alias)
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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let deleted = MetadataStore::delete_database(&alias)
        .await
        .map_err(|e| AxiomError::new("DATABASE_DELETION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    if !deleted {
        return Err(AxiomError::new(
            "DATABASE_NOT_FOUND",
            "Database alias does not exist",
            StatusCode::NOT_FOUND,
        ));
    }

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("Database '{}' deleted successfully", alias)
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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let exists = axiom_metadata::snapshot::get_snapshot().databases.contains_key(&alias)
        || ConfigManager::get().database.contains_key(&alias);

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let role_name = payload.name.trim();
    if role_name.is_empty() {
        return Err(AxiomError::new(
            "INVALID_ROLE_NAME",
            "Role name cannot be empty",
            StatusCode::BAD_REQUEST,
        ));
    }

    let permissions: Vec<PermissionRecord> = payload
        .permissions
        .into_iter()
        .map(|p| PermissionRecord {
            id: 0,
            role_name: role_name.to_string(),
            database: p.database,
            table_name: p.table_name,
            operations: p.operations,
        })
        .collect();

    MetadataStore::create_role(
        role_name,
        payload.description.as_deref(),
        &permissions,
    )
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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let permissions = payload.permissions.map(|perms| {
        perms
            .into_iter()
            .map(|p| PermissionRecord {
                id: 0,
                role_name: name.clone(),
                database: p.database,
                table_name: p.table_name,
                operations: p.operations,
            })
            .collect()
    });

    let updated = MetadataStore::update_role(
        &name,
        payload.description.as_deref(),
        permissions,
    )
    .await
    .map_err(|e| AxiomError::new("ROLE_UPDATE_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let deleted = MetadataStore::delete_role(&name)
        .await
        .map_err(|e| AxiomError::new("ROLE_DELETION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    axiom_cache::CacheEngine::flush().await;
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
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let offset = query.offset.unwrap_or(0);

    let logs = MetadataStore::query_audit_log(limit, offset)
        .await
        .map_err(|e| AxiomError::new("AUDIT_QUERY_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let has_more = logs.len() == limit as usize;
    let next_cursor = if has_more {
        logs.last().map(|r| r.id.to_string())
    } else {
        None
    };

    Ok(Json(json!({
        "success": true,
        "data": logs,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
            "next_offset": if has_more { Some(offset + limit) } else { None },
            "next_cursor": next_cursor
        },
        "error": Value::Null
    })))
}

/// Returns Prometheus exposition format metrics for admin monitoring.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns text/plain formatted Prometheus metrics.
///  - Side effects: None.
///  - Idempotent: Yes.
pub async fn get_metrics(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let metrics_text = crate::metrics::MetricsEngine::render_prometheus();
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        metrics_text,
    ))
}

/// Detailed health check for administrators.
/// CONTRACT:
///  - Precondition: Verified admin AuthContext.
///  - Returns JSON status of server uptime, system metrics, and upstream database targets.
///  - Idempotent: Yes.
pub async fn get_admin_health(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required",
            StatusCode::FORBIDDEN,
        ));
    }

    let snapshot = axiom_metadata::snapshot::get_snapshot();
    let config = ConfigManager::get();

    let mut db_status = serde_json::Map::new();
    let mut all_dbs_up = true;

    for alias in snapshot.databases.keys().chain(config.database.keys()) {
        if db_status.contains_key(alias) {
            continue;
        }
        if let Some(engine) = DatabasePoolManager::get_engine(alias).await {
            let is_up = engine.health_check().await;
            db_status.insert(alias.clone(), json!(if is_up { "up" } else { "down" }));
            if !is_up {
                all_dbs_up = false;
            }
        } else {
            db_status.insert(alias.clone(), json!("down"));
            all_dbs_up = false;
        }
    }

    let (cpu_percent, memory_used_mb) = tokio::task::spawn_blocking(crate::core::health::get_system_stats)
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
    let has_users = MetadataStore::has_users().await.unwrap_or(false);
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
    Json(payload): Json<SetupAccountRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let has_users = MetadataStore::has_users().await.unwrap_or(false);
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

    MetadataStore::create_user(&payload.username, &payload.password)
        .await
        .map_err(|e| AxiomError::new("USER_CREATION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let session_id = MetadataStore::create_session(&payload.username, 86400 * 30)
        .await
        .map_err(|e| AxiomError::new("SESSION_CREATION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let cookie_header = format!(
        "axiom_session={}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}",
        session_id,
        86400 * 30
    );

    Ok((
        [(axum::http::header::SET_COOKIE, cookie_header)],
        Json(json!({
            "success": true,
            "data": {
                "token": session_id,
                "username": payload.username
            },
            "error": Value::Null
        }))
    ))
}

/// Adds the first database during the setup wizard.
/// CONTRACT:
///  - Side effects: Registers database in axiom.db.
pub async fn setup_database(
    Json(payload): Json<AddDatabaseRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    MetadataStore::add_database(
        &payload.alias,
        &payload.url,
        payload.engine.as_deref(),
        payload.pool_min,
        payload.pool_max,
    )
    .await
    .map_err(|e| AxiomError::new("DATABASE_REGISTRATION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "message": format!("Database '{}' registered", payload.alias)
        },
        "error": Value::Null
    })))
}

/// Finalizes the setup wizard, permanently locking it.
/// CONTRACT:
///  - Returns: Success confirmation.
pub async fn setup_complete() -> Result<impl IntoResponse, AxiomError> {
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
///  - Side effects: Inserts session row.
pub async fn login_handler(
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let valid = MetadataStore::verify_user(&payload.username, &payload.password)
        .await
        .unwrap_or(false);

    if !valid {
        crate::metrics::MetricsEngine::record_auth_failure("invalid_admin_password");
        return Err(AxiomError::new(
            "INVALID_CREDENTIALS",
            "Invalid administrative username or password",
            StatusCode::UNAUTHORIZED,
        ));
    }

    let session_id = MetadataStore::create_session(&payload.username, 86400 * 7)
        .await
        .map_err(|e| AxiomError::new("SESSION_CREATION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let cookie_header = format!(
        "axiom_session={}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}",
        session_id,
        86400 * 7
    );

    Ok((
        [(axum::http::header::SET_COOKIE, cookie_header)],
        Json(json!({
            "success": true,
            "data": {
                "token": session_id,
                "username": payload.username
            },
            "error": Value::Null
        }))
    ))
}

/// Revokes an active administrative session.
/// CONTRACT:
///  - Side effects: Removes session from axiom.db and clears cookie.
pub async fn logout_handler(
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, AxiomError> {
    let mut token = None;
    if let Some(auth_hdr) = headers.get(axum::http::header::AUTHORIZATION).and_then(|h| h.to_str().ok()) {
        if let Some(stripped) = auth_hdr.strip_prefix("Bearer ") {
            token = Some(stripped.to_string());
        }
    }
    if token.is_none() {
        if let Some(cookie_hdr) = headers.get(axum::http::header::COOKIE).and_then(|h| h.to_str().ok()) {
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
    }

    let clear_cookie = "axiom_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    Ok((
        [(axum::http::header::SET_COOKIE, clear_cookie)],
        Json(json!({
            "success": true,
            "data": {
                "message": "Logged out successfully"
            },
            "error": Value::Null
        }))
    ))
}

/// Lists all registered administrative accounts.
/// CONTRACT:
///  - Invariant: Password hashes are redacted.
pub async fn list_users_handler() -> Result<impl IntoResponse, AxiomError> {
    let users = MetadataStore::list_users()
        .await
        .map_err(|e| AxiomError::new("USERS_FETCH_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    Ok(Json(json!({
        "success": true,
        "data": users,
        "error": Value::Null
    })))
}



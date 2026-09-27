/*
 * Admin HTTP API route handlers for keys, databases, status, and metadata synchronization.
 * Owned by: api/admin
 * Key deps: axum, serde, serde_json, base64, crate::metadata
 * Invariants: Endpoints require full_admin or admin role privileges; keys are returned in plaintext only upon creation.
 * Last structural change: Phase 1 initial implementation of Admin API.
 */

use axum::{
    extract::Path,
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use base64::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::api::errors::AxiomError;
use crate::metadata::models::PermissionRecord;
use crate::metadata::store::MetadataStore;
use crate::utils::types::AuthContext;

// ─── Request Schemas ───────────────────────────────────────────────────────

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

    let snapshot = crate::metadata::snapshot::get_snapshot();
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

    let snapshot = crate::metadata::snapshot::get_snapshot();
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



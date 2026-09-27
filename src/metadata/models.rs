/*
 * Domain models for the persistent metadata store (axiom.db).
 * Owned by: metadata
 * Key deps: serde, serde_json
 * Invariants: Secrets are never serialized or exported in plaintext; hashes are stored as raw bytes or Argon2 strings.
 * Last structural change: Phase 1 initial implementation of metadata models.
 */

use serde::{Deserialize, Serialize};

// ─── Human Admin User Model ────────────────────────────────────────────────
// Stored in `users` table; used exclusively for Web UI authentication.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRecord {
    pub id: i64,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub created_at: i64,
}

// ─── Role & Permission Models ──────────────────────────────────────────────
// Define granular access policies applied against API keys.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleRecord {
    pub name: String,
    pub description: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub permissions: Vec<PermissionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRecord {
    pub id: i64,
    pub role_name: String,
    pub database: String,    // '*' = all databases
    pub table_name: String,  // '*' = all tables
    pub operations: Vec<String>, // ["SELECT", "INSERT", "UPDATE", "DELETE"]
}

// ─── Machine API Key Model ─────────────────────────────────────────────────
// Stored in `api_keys` table; used for data API access.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyRecord {
    pub name: String,
    #[serde(skip_serializing)]
    pub secret_hash: Vec<u8>, // BLAKE3 32-byte hash
    pub role_name: Option<String>,
    pub rate_limit: i64,
    pub expires_at: Option<i64>,
    pub created_at: i64,
}

// ─── Managed Database Connection Model ─────────────────────────────────────
// Stored in `databases` table; enables runtime addition/removal of data targets.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseRecord {
    pub alias: String,
    #[serde(skip_serializing)]
    pub url: String,
    pub engine: String,
    pub pool_min: i64,
    pub pool_max: i64,
    pub created_at: i64,
}

// ─── Audit Log Entry Model ─────────────────────────────────────────────────
// Stored in `audit_log` table; immutable record of control plane mutations.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord {
    pub id: i64,
    pub timestamp: i64,
    pub actor: String,
    pub action: String,
    pub target: String,
    pub details: Option<String>,
}

/*
 * Common system types and contextual data models across Axiom services.
 * Owned by: core
 * Key deps: serde
 * Invariants: Types are shared across all crates without circular dependencies.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use serde::{Deserialize, Serialize};

// ─── Operational Modes ─────────────────────────────────────────────────────
// Controls HTTP execution permission scope for database operations.

/// Access permission mode restricting allowed SQL statement types.
/// INVARIANT: Readonly rejects all mutations (INSERT, UPDATE, DELETE);
/// Writeonly rejects SELECT projections.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ServerMode {
    /// Full read and write access across all permitted tables.
    #[default]
    Readwrite,
    /// Read-only access; mutations fail with AUTH_INSUFFICIENT_MODE.
    Readonly,
    /// Write-only access; select queries fail with AUTH_INSUFFICIENT_MODE.
    Writeonly,
}

// ─── Database Dialects ─────────────────────────────────────────────────────
// Enumeration of supported database backend engine types.

/// Target SQL database driver and dialect classification.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum DbEngineType {
    Postgres,
    Mysql,
    #[default]
    Sqlite,
    Mssql,
    Oracle,
    Mariadb,
    Db2,
    Cockroachdb,
}

// ─── RBAC Context Models ───────────────────────────────────────────────────
// Request-scoped authorization snapshots and caller identity.

/// Evaluated permission entry mapping role access to a database and table scope.
/// INVARIANT: Wildcard "*" indicates blanket access across all databases, tables, or operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PermissionSnapshot {
    /// Target database alias, or "*" for all databases.
    pub database: String,
    /// Target table name, or "*" for all tables.
    pub table_name: String,
    /// Allowed operations array (e.g. ["SELECT", "INSERT", "UPDATE", "DELETE"]).
    pub operations: Vec<String>,
    /// Optional row-level security (RLS) SQL predicate filter applied to queries.
    #[serde(default)]
    pub rls_filter: Option<String>,
}

/// Injected request extension containing caller identity, session state, and permissions.
/// CONTRACT:
///  - Invariant: Populated exclusively by auth middleware (`crates/api/src/middleware/auth.rs`).
///  - Precondition: Verified against either session cookie (`is_session = true`) or active API key.
///  - `rate_limit_override`: When non-zero, overrides global default rate limit for this caller.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct AuthContext {
    /// API key identifier or username. Empty for unauthenticated requests.
    pub api_key_name: String,
    /// Legacy operational mode for flat API keys.
    pub mode: ServerMode,
    /// Legacy database alias scope for flat API keys.
    pub db_scope: Vec<String>,
    /// Optional per-key rate limit override in requests-per-window (0 = inherit global).
    pub rate_limit_override: u32,
    /// True if authenticated via admin Web UI session cookie (bypasses granular RBAC).
    #[serde(default)]
    pub is_session: bool,
    /// Associated RBAC role name, if configured.
    #[serde(default)]
    pub role: Option<String>,
    /// Granular permissions snapshot evaluated at request entry time.
    #[serde(default)]
    pub permissions: Vec<PermissionSnapshot>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_types_defaults() {
        assert_eq!(ServerMode::default(), ServerMode::Readwrite);
        assert_eq!(DbEngineType::default(), DbEngineType::Sqlite);
        let ctx = AuthContext::default();
        assert_eq!(ctx.api_key_name, "");
        assert_eq!(ctx.permissions.len(), 0);
    }
}

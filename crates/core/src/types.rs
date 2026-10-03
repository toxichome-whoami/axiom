/*
 * Common system types and contextual data models across Axiom services.
 * Owned by: core
 * Key deps: serde
 * Invariants: Types are shared across all crates without circular dependencies.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ServerMode {
    #[default]
    Readwrite,
    Readonly,
    Writeonly,
}

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PermissionSnapshot {
    pub database: String,
    pub table_name: String,
    pub operations: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct AuthContext {
    pub api_key_name: String,
    pub mode: ServerMode,
    pub db_scope: Vec<String>,
    pub rate_limit_override: u32,
    #[serde(default)]
    pub is_session: bool,
    #[serde(default)]
    pub role: Option<String>,
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

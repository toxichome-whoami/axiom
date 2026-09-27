/*
 * Core shared domain enums, engine discriminators, and request identity context.
 * Owned by: utils
 * Key deps: serde, crate::metadata::snapshot::PermissionSnapshot
 * Invariants: AuthContext is populated exclusively by authentication middleware; downstream handlers read it read-only.
 * Last structural change: Phase 2 addition of RBAC role and permission snapshots to AuthContext.
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

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AuthContext {
    pub api_key_name: String,
    pub mode: ServerMode,
    pub db_scope: Vec<String>,
    pub rate_limit_override: u32,
    #[serde(default)]
    pub full_admin: bool,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub permissions: Vec<crate::metadata::snapshot::PermissionSnapshot>,
}

/*
 * RBAC authorization evaluation engine checking database, table, and operation permissions.
 * Owned by: policy
 * Key deps: axum::http::StatusCode, crate::api::errors::AxiomError, crate::utils::types::{AuthContext, ServerMode}
 * Invariants: Single authorization checkpoint; denies by default; zero locks and zero allocations on hot path.
 * Last structural change: Phase 2 initial implementation of PolicyEngine.
 */

use axum::http::StatusCode;
use axiom_core::{AxiomError, AuthContext, ServerMode};

pub struct PolicyEngine;

impl PolicyEngine {
    /// Evaluates whether an authenticated identity has permission to perform an operation on a database table.
    /// CONTRACT:
    ///  - Precondition: `auth` contains verified identity context from authentication middleware.
    ///  - Precondition: `operation` should be one of "SELECT", "INSERT", "UPDATE", "DELETE", or "*" (case-insensitive).
    ///  - Returns `Ok(())` if authorized.
    ///  - Throws `AxiomError(FORBIDDEN, 403)` if permission is denied.
    ///  - Side effects: None (pure evaluator).
    ///  - Idempotent: Yes.
    pub fn evaluate(
        auth: &AuthContext,
        database: &str,
        table: &str,
        operation: &str,
    ) -> Result<(), AxiomError> {
        // Fast-path: Full system administrators bypass granular policy evaluation
        if auth.full_admin {
            return Ok(());
        }

        // Granular RBAC evaluation using snapshot permissions
        if !auth.permissions.is_empty() {
            let op_normalized = operation.to_ascii_uppercase();

            for perm in &auth.permissions {
                let db_match = perm.database == "*" || perm.database.eq_ignore_ascii_case(database);
                let table_match = perm.table_name == "*" || perm.table_name.eq_ignore_ascii_case(table);

                if db_match && table_match {
                    let op_allowed = perm.operations.iter().any(|op| {
                        op == "*" || op.eq_ignore_ascii_case(&op_normalized)
                    });

                    if op_allowed {
                        return Ok(());
                    }
                }
            }

            return Err(AxiomError::new(
                "AUTH_FORBIDDEN",
                &format!(
                    "Operation '{}' on '{}.{}' denied by role policy",
                    operation, database, table
                ),
                StatusCode::FORBIDDEN,
            ));
        }

        // Backward compatibility fallback: evaluate legacy `db_scope` and `mode`
        let db_in_scope = auth.db_scope.iter().any(|s| s == "*" || s.eq_ignore_ascii_case(database));
        if !db_in_scope {
            return Err(AxiomError::new(
                "AUTH_SCOPE_DENIED",
                &format!("API key does not have access to database '{}'", database),
                StatusCode::FORBIDDEN,
            ));
        }

        let op_normalized = operation.to_ascii_uppercase();
        match auth.mode {
            ServerMode::Readonly => {
                if op_normalized == "SELECT" {
                    Ok(())
                } else {
                    Err(AxiomError::new(
                        "AUTH_INSUFFICIENT_MODE",
                        "Read-only keys cannot execute mutations or modifications",
                        StatusCode::FORBIDDEN,
                    ))
                }
            }
            ServerMode::Writeonly => {
                if op_normalized == "SELECT" {
                    Err(AxiomError::new(
                        "AUTH_INSUFFICIENT_MODE",
                        "Write-only keys cannot execute SELECT queries",
                        StatusCode::FORBIDDEN,
                    ))
                } else {
                    Ok(())
                }
            }
            ServerMode::Readwrite => Ok(()),
        }
    }

    /// Filters a list of database aliases to only those accessible to the current identity.
    /// CONTRACT:
    ///  - Returns vector of database alias strings authorized for the caller.
    ///  - Idempotent: Yes.
    pub fn filter_databases(auth: &AuthContext, databases: &[String]) -> Vec<String> {
        if auth.full_admin {
            return databases.to_vec();
        }

        databases
            .iter()
            .filter(|db| {
                if !auth.permissions.is_empty() {
                    auth.permissions.iter().any(|p| {
                        p.database == "*" || p.database.eq_ignore_ascii_case(db)
                    })
                } else {
                    auth.db_scope.iter().any(|s| s == "*" || s.eq_ignore_ascii_case(db))
                }
            })
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axiom_core::PermissionSnapshot;

    #[test]
    fn test_admin_bypass() {
        let admin_ctx = AuthContext {
            api_key_name: "admin_key".to_string(),
            mode: ServerMode::Readwrite,
            db_scope: vec![],
            rate_limit_override: 0,
            full_admin: true,
            role: Some("admin".to_string()),
            permissions: vec![],
        };

        assert!(PolicyEngine::evaluate(&admin_ctx, "prod_db", "secrets", "DELETE").is_ok());
    }

    #[test]
    fn test_granular_table_permission() {
        let user_ctx = AuthContext {
            api_key_name: "app_key".to_string(),
            mode: ServerMode::Readwrite,
            db_scope: vec!["*".to_string()],
            rate_limit_override: 0,
            full_admin: false,
            role: Some("app_role".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "analytics".to_string(),
                table_name: "events".to_string(),
                operations: vec!["SELECT".to_string(), "INSERT".to_string()],
            }],
        };

        // Allowed actions
        assert!(PolicyEngine::evaluate(&user_ctx, "analytics", "events", "SELECT").is_ok());
        assert!(PolicyEngine::evaluate(&user_ctx, "analytics", "events", "INSERT").is_ok());

        // Denied: Disallowed operation on permitted table
        assert!(PolicyEngine::evaluate(&user_ctx, "analytics", "events", "DELETE").is_err());

        // Denied: Disallowed table in permitted database
        assert!(PolicyEngine::evaluate(&user_ctx, "analytics", "users", "SELECT").is_err());

        // Denied: Disallowed database
        assert!(PolicyEngine::evaluate(&user_ctx, "production", "events", "SELECT").is_err());
    }

    #[test]
    fn test_wildcard_permissions() {
        let read_all_ctx = AuthContext {
            api_key_name: "audit_key".to_string(),
            mode: ServerMode::Readwrite,
            db_scope: vec![],
            rate_limit_override: 0,
            full_admin: false,
            role: Some("auditor".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "*".to_string(),
                table_name: "*".to_string(),
                operations: vec!["SELECT".to_string()],
            }],
        };

        assert!(PolicyEngine::evaluate(&read_all_ctx, "db1", "table_x", "SELECT").is_ok());
        assert!(PolicyEngine::evaluate(&read_all_ctx, "db2", "table_y", "SELECT").is_ok());
        assert!(PolicyEngine::evaluate(&read_all_ctx, "db1", "table_x", "INSERT").is_err());
    }

    #[test]
    fn test_legacy_backward_compatibility() {
        let legacy_ro = AuthContext {
            api_key_name: "old_ro".to_string(),
            mode: ServerMode::Readonly,
            db_scope: vec!["my_db".to_string()],
            rate_limit_override: 0,
            full_admin: false,
            role: None,
            permissions: vec![],
        };

        assert!(PolicyEngine::evaluate(&legacy_ro, "my_db", "any_table", "SELECT").is_ok());
        assert!(PolicyEngine::evaluate(&legacy_ro, "my_db", "any_table", "INSERT").is_err());
        assert!(PolicyEngine::evaluate(&legacy_ro, "other_db", "any_table", "SELECT").is_err());
    }

    #[test]
    fn test_select_only_role_cannot_insert() {
        let readonly_role_ctx = AuthContext {
            api_key_name: "ro_key".to_string(),
            mode: ServerMode::Readwrite,
            db_scope: vec![],
            rate_limit_override: 0,
            full_admin: false,
            role: Some("readonly_role".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "app_db".to_string(),
                table_name: "customers".to_string(),
                operations: vec!["SELECT".to_string()],
            }],
        };

        // Allowed to SELECT
        assert!(PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "SELECT").is_ok());

        // Strictly forbidden to INSERT, UPDATE, or DELETE
        let insert_err = PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "INSERT").unwrap_err();
        assert_eq!(insert_err.code, "AUTH_FORBIDDEN");

        let update_err = PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "UPDATE").unwrap_err();
        assert_eq!(update_err.code, "AUTH_FORBIDDEN");

        let delete_err = PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "DELETE").unwrap_err();
        assert_eq!(delete_err.code, "AUTH_FORBIDDEN");
    }
}


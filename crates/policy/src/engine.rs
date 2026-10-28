/*
 * RBAC authorization evaluation engine checking database, table, and operation permissions.
 * Owned by: policy
 * Key deps: axum::http::StatusCode, crate::api::errors::AxiomError, crate::utils::types::{AuthContext, ServerMode}
 * Invariants: Single authorization checkpoint; denies by default; zero locks and zero allocations on hot path.
 * Last structural change: Phase 2 initial implementation of PolicyEngine.
 */

use axiom_core::{AuthContext, AxiomError, ServerMode};
use axum::http::StatusCode;

pub struct PolicyEngine;

impl PolicyEngine {
    // ─── SQL Database Policy Evaluation ─────────────────────────────────────────

    /// Evaluates whether an authenticated identity has permission to perform an operation on a database table.
    /// CONTRACT:
    ///  - Precondition: `auth` contains verified identity context from authentication middleware.
    ///  - Precondition: `operation` should be one of "SELECT", "INSERT", "UPDATE", "DELETE", or "*" (case-insensitive).
    ///  - Returns `Ok(())` if authorized.
    ///  - Throws `AxiomError(AUTH_FORBIDDEN, 403)` or `AxiomError(AUTH_SCOPE_DENIED, 403)` if permission is denied.
    ///  - Side effects: None (pure evaluator).
    ///  - Concurrency: Zero locks, zero dynamic allocations on hot path.
    pub fn evaluate(
        auth: &AuthContext,
        database: &str,
        table: &str,
        operation: &str,
    ) -> Result<(), AxiomError> {
        // Fast-path: Full system administrators bypass granular policy evaluation
        if auth.is_session && auth.role.as_deref() != Some("custom") {
            return Ok(());
        }

        // Granular RBAC evaluation using snapshot permissions
        if !auth.permissions.is_empty() {
            let op_normalized = operation.to_ascii_uppercase();
            let is_wildcard_table = table == "*";

            for perm in &auth.permissions {
                // Database match: explicit wildcard "*" or case-insensitive alias match
                let db_match = perm.database == "*" || perm.database.eq_ignore_ascii_case(database);
                if !db_match {
                    continue;
                }

                let op_allowed = perm
                    .operations
                    .iter()
                    .any(|op| op == "*" || op.eq_ignore_ascii_case(&op_normalized));
                if !op_allowed {
                    continue;
                }

                // Table match:
                // If table is explicit: must match perm table or wildcard "*"
                // If table is wildcard "*" (e.g. list_tables or table-less scalar query):
                // caller is authorized if they have ANY permission for this operation in the database
                if is_wildcard_table
                    || perm.table_name == "*"
                    || perm.table_name.eq_ignore_ascii_case(table)
                {
                    return Ok(());
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

        // Session users with role=custom must NEVER fall through to legacy API key checks
        if auth.is_session {
            return Err(AxiomError::new(
                "AUTH_FORBIDDEN",
                &format!(
                    "Operation '{}' on '{}.{}' denied by user policy: no permissions granted",
                    operation, database, table
                ),
                StatusCode::FORBIDDEN,
            ));
        }

        // Backward compatibility fallback: evaluate legacy `db_scope` and `mode`
        let db_in_scope = auth
            .db_scope
            .iter()
            .any(|s| s == "*" || s.eq_ignore_ascii_case(database));
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
                } else if op_normalized == "INSERT"
                    || op_normalized == "UPDATE"
                    || op_normalized == "DELETE"
                {
                    Ok(())
                } else {
                    Err(AxiomError::new(
                        "AUTH_INSUFFICIENT_MODE",
                        "Write-only keys can only execute INSERT, UPDATE, or DELETE operations",
                        StatusCode::FORBIDDEN,
                    ))
                }
            }
            ServerMode::Readwrite => {
                if op_normalized == "DENY" {
                    Err(AxiomError::new(
                        "AUTH_FORBIDDEN",
                        "Operation forbidden",
                        StatusCode::FORBIDDEN,
                    ))
                } else {
                    Ok(())
                }
            }
        }
    }

    /// Extracts any active Row-Level Security (RLS) predicate for the specified table and operation.
    /// CONTRACT:
    ///  - Precondition: `auth` contains verified identity context.
    ///  - Returns `Some(String)` containing the SQL filter expression if an RLS policy is active.
    ///  - Returns `None` if the caller has full unrestricted access or no RLS filter is defined.
    ///  - Substituted tokens: `:auth_key` or `:auth.key_name` replaced with sanitized API key identifier.
    ///  - Concurrency: Zero locks, zero dynamic allocations on hot path unless RLS is configured.
    pub fn get_rls_predicate(
        auth: &AuthContext,
        database: &str,
        table: &str,
        operation: &str,
    ) -> Option<String> {
        if auth.is_session && auth.role.as_deref() != Some("custom") {
            return None;
        }

        let op_normalized = operation.to_ascii_uppercase();

        for perm in &auth.permissions {
            let db_match = perm.database == "*" || perm.database.eq_ignore_ascii_case(database);
            let table_match = perm.table_name == "*" || perm.table_name.eq_ignore_ascii_case(table);

            if db_match && table_match {
                let op_allowed = perm
                    .operations
                    .iter()
                    .any(|op| op == "*" || op.eq_ignore_ascii_case(&op_normalized));

                if op_allowed {
                    if let Some(ref raw_filter) = perm.rls_filter {
                        let trimmed = raw_filter.trim();
                        if !trimmed.is_empty() {
                            let sanitized_key = auth.api_key_name.replace('\'', "''");
                            let expanded = trimmed
                                .replace(":auth.key_name", &format!("'{}'", sanitized_key))
                                .replace(":auth_key", &format!("'{}'", sanitized_key));
                            return Some(expanded);
                        }
                    }
                }
            }
        }

        None
    }

    // ─── Resource Listing Filters ───────────────────────────────────────────────

    /// Filters a list of database aliases to only those accessible to the current identity.
    ///
    /// CONTRACT:
    ///  - Returns vector of database alias strings authorized for the caller.
    ///  - Idempotent: Yes.
    pub fn filter_databases(auth: &AuthContext, databases: &[String]) -> Vec<String> {
        if auth.is_session && auth.role.as_deref() != Some("custom") {
            return databases.to_vec();
        }

        databases
            .iter()
            .filter(|db| {
                if !auth.permissions.is_empty() {
                    auth.permissions
                        .iter()
                        .any(|p| p.database == "*" || p.database.eq_ignore_ascii_case(db))
                } else if auth.is_session {
                    false
                } else {
                    auth.db_scope
                        .iter()
                        .any(|s| s == "*" || s.eq_ignore_ascii_case(db))
                }
            })
            .cloned()
            .collect()
    }

    /// Checks whether the caller is authorized to view or access a specific table within a database.
    pub fn can_access_table(auth: &AuthContext, database: &str, table: &str) -> bool {
        if auth.is_session && auth.role.as_deref() != Some("custom") {
            return true;
        }

        if !auth.permissions.is_empty() {
            auth.permissions.iter().any(|p| {
                let db_match = p.database == "*" || p.database.eq_ignore_ascii_case(database);
                if !db_match {
                    return false;
                }
                p.table_name == "*" || p.table_name.eq_ignore_ascii_case(table)
            })
        } else if auth.is_session {
            false
        } else {
            auth.db_scope
                .iter()
                .any(|s| s == "*" || s.eq_ignore_ascii_case(database))
        }
    }

    /// Filters a list of table names to only those accessible to the current identity.
    pub fn filter_tables(auth: &AuthContext, database: &str, tables: &[String]) -> Vec<String> {
        if auth.is_session && auth.role.as_deref() != Some("custom") {
            return tables.to_vec();
        }

        tables
            .iter()
            .filter(|tbl| Self::can_access_table(auth, database, tbl))
            .cloned()
            .collect()
    }

    /// Filters a list of blob namespaces to only those accessible to the current identity for READ.
    /// CONTRACT:
    ///  - Returns vector of namespace strings authorized for the caller.
    ///  - Idempotent: Yes.
    pub fn filter_blob_namespaces(auth: &AuthContext, namespaces: &[String]) -> Vec<String> {
        if auth.is_session && auth.role.as_deref() != Some("custom") {
            return namespaces.to_vec();
        }

        namespaces
            .iter()
            .filter(|ns| {
                if !auth.permissions.is_empty() {
                    let ns_prefix = format!("blob:{}", ns);
                    auth.permissions.iter().any(|p| {
                        (p.database == "*"
                            || p.database.eq_ignore_ascii_case("blob:*")
                            || p.database.eq_ignore_ascii_case(ns)
                            || p.database.eq_ignore_ascii_case(&ns_prefix))
                            && p.operations.iter().any(|op| {
                                op == "*"
                                    || op.eq_ignore_ascii_case("READ")
                                    || op.eq_ignore_ascii_case("SELECT")
                                    || op.eq_ignore_ascii_case("BLOB_READ")
                            })
                    })
                } else if auth.is_session {
                    false
                } else {
                    let in_scope = auth
                        .db_scope
                        .iter()
                        .any(|s| s == "*" || s.eq_ignore_ascii_case(ns));
                    in_scope && auth.mode != ServerMode::Writeonly
                }
            })
            .cloned()
            .collect()
    }

    // ─── Native Blob Storage Policy Evaluation ──────────────────────────────────

    /// Evaluates authorization for native blob storage operations.
    /// CONTRACT:
    ///  - Precondition: `operation` is "READ", "WRITE", or "DELETE" (case-insensitive).
    ///  - Checks granular permissions matching `*`, `namespace`, or `blob:{namespace}`.
    ///  - Throws `AxiomError(AUTH_FORBIDDEN, 403)` or `AxiomError(AUTH_SCOPE_DENIED, 403)` on unauthorized access.
    ///  - Invariant: Capability tickets can NEVER execute DELETE operations regardless of mode.
    ///  - Idempotent: Yes.
    pub fn evaluate_blob(
        auth: &AuthContext,
        namespace: &str,
        key: &str,
        operation: &str,
    ) -> Result<(), AxiomError> {
        // Fast-path: Human admin sessions bypass policy evaluation
        if auth.is_session && auth.role.as_deref() != Some("custom") {
            return Ok(());
        }

        let op_normalized = operation.to_ascii_uppercase();

        if !auth.permissions.is_empty() {
            let ns_prefix = format!("blob:{}", namespace);

            for perm in &auth.permissions {
                // Namespace matching: allows "*", "blob:*", explicit namespace, or "blob:<namespace>"
                let db_match = perm.database == "*"
                    || perm.database.eq_ignore_ascii_case("blob:*")
                    || perm.database.eq_ignore_ascii_case(namespace)
                    || perm.database.eq_ignore_ascii_case(&ns_prefix);

                // Key pattern matching: allows "*" wildcard, exact match, or prefix matching when pattern ends with "*"
                let key_match = perm.table_name == "*"
                    || perm.table_name.eq_ignore_ascii_case(key)
                    || (perm.table_name.ends_with('*')
                        && key.starts_with(&perm.table_name[..perm.table_name.len() - 1]));

                if db_match && key_match {
                    let op_allowed = perm.operations.iter().any(|op| {
                        op == "*"
                            || op.eq_ignore_ascii_case(&op_normalized)
                            || (op_normalized == "READ" && (op == "SELECT" || op == "BLOB_READ"))
                            || (op_normalized == "WRITE"
                                && (op == "INSERT" || op == "UPDATE" || op == "BLOB_WRITE"))
                            || (op_normalized == "DELETE"
                                && (op == "DELETE" || op == "BLOB_DELETE"))
                    });

                    if op_allowed {
                        return Ok(());
                    }
                }
            }

            return Err(AxiomError::new(
                "AUTH_FORBIDDEN",
                &format!(
                    "Operation '{}' on blob '{}/{}' denied by role policy",
                    operation, namespace, key
                ),
                StatusCode::FORBIDDEN,
            ));
        }

        // Session users with role=custom must NEVER fall through to legacy API key checks
        if auth.is_session {
            return Err(AxiomError::new(
                "AUTH_FORBIDDEN",
                &format!(
                    "Operation '{}' on blob '{}/{}' denied by user policy: no permissions granted",
                    operation, namespace, key
                ),
                StatusCode::FORBIDDEN,
            ));
        }

        // Backward compatibility fallback for legacy API keys.
        // SECURITY (H-4/A5): capability tickets must never escalate WRITE -> DELETE.
        // A WRITE ticket yields mode=Readwrite; explicitly deny DELETE for ticket identities.
        if auth.role.as_deref() == Some("ticket") && op_normalized == "DELETE" {
            return Err(AxiomError::new(
                "AUTH_FORBIDDEN",
                "Ticket capabilities do not grant DELETE (request a dedicated grant)",
                StatusCode::FORBIDDEN,
            ));
        }
        let db_in_scope = auth
            .db_scope
            .iter()
            .any(|s| s == "*" || s.eq_ignore_ascii_case(namespace));
        if !db_in_scope {
            return Err(AxiomError::new(
                "AUTH_SCOPE_DENIED",
                &format!(
                    "API key does not have access to blob namespace '{}'",
                    namespace
                ),
                StatusCode::FORBIDDEN,
            ));
        }

        match auth.mode {
            ServerMode::Readonly => {
                if op_normalized == "READ" {
                    Ok(())
                } else {
                    Err(AxiomError::new(
                        "AUTH_INSUFFICIENT_MODE",
                        "Read-only keys cannot mutate blob storage",
                        StatusCode::FORBIDDEN,
                    ))
                }
            }
            ServerMode::Writeonly => {
                if op_normalized == "READ" {
                    Err(AxiomError::new(
                        "AUTH_INSUFFICIENT_MODE",
                        "Write-only keys cannot read blob objects",
                        StatusCode::FORBIDDEN,
                    ))
                } else if op_normalized == "WRITE" {
                    // WRITE-only: DELETE requires an explicit DELETE/BLOB_DELETE grant (see granular path above).
                    Ok(())
                } else {
                    Err(AxiomError::new(
                        "AUTH_INSUFFICIENT_MODE",
                        "Write-only keys cannot DELETE blob objects",
                        StatusCode::FORBIDDEN,
                    ))
                }
            }
            ServerMode::Readwrite => {
                // Legacy Readwrite keys retain full access, but ticket identities are
                // already denied DELETE above. Non-ticket legacy keys keep compat.
                Ok(())
            }
        }
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
            is_session: true,
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
            is_session: false,
            role: Some("app_role".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "analytics".to_string(),
                table_name: "events".to_string(),
                operations: vec!["SELECT".to_string(), "INSERT".to_string()],
                rls_filter: None,
            }],
        };

        // Allowed actions
        assert!(PolicyEngine::evaluate(&user_ctx, "analytics", "events", "SELECT").is_ok());
        // Verify wildcard table query (e.g. list_tables or scalar SELECT) succeeds for table-scoped role
        assert!(PolicyEngine::evaluate(&user_ctx, "analytics", "*", "SELECT").is_ok());
        // Verify wildcard table query (e.g. list_tables or scalar SELECT) succeeds for table-scoped role
        assert!(PolicyEngine::evaluate(&user_ctx, "analytics", "*", "SELECT").is_ok());
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
            is_session: false,
            role: Some("auditor".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "*".to_string(),
                table_name: "*".to_string(),
                operations: vec!["SELECT".to_string()],
                rls_filter: None,
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
            is_session: false,
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
            is_session: false,
            role: Some("readonly_role".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "app_db".to_string(),
                table_name: "customers".to_string(),
                operations: vec!["SELECT".to_string()],
                rls_filter: None,
            }],
        };

        // Allowed to SELECT
        assert!(
            PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "SELECT").is_ok()
        );

        // Strictly forbidden to INSERT, UPDATE, or DELETE
        let insert_err =
            PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "INSERT")
                .unwrap_err();
        assert_eq!(insert_err.code, "AUTH_FORBIDDEN");

        let update_err =
            PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "UPDATE")
                .unwrap_err();
        assert_eq!(update_err.code, "AUTH_FORBIDDEN");

        let delete_err =
            PolicyEngine::evaluate(&readonly_role_ctx, "app_db", "customers", "DELETE")
                .unwrap_err();
        assert_eq!(delete_err.code, "AUTH_FORBIDDEN");
    }

    #[test]
    fn test_blob_policy_evaluation() {
        let user_ctx = AuthContext {
            api_key_name: "blob_writer".to_string(),
            mode: ServerMode::Readwrite,
            db_scope: vec![],
            rate_limit_override: 0,
            is_session: false,
            role: Some("blob_role".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "blob:media".to_string(),
                table_name: "*".to_string(),
                operations: vec!["READ".to_string(), "WRITE".to_string()],
                rls_filter: None,
            }],
        };

        // Allowed actions on "media" namespace
        assert!(PolicyEngine::evaluate_blob(&user_ctx, "media", "avatar.png", "READ").is_ok());
        assert!(PolicyEngine::evaluate_blob(&user_ctx, "media", "avatar.png", "WRITE").is_ok());

        // Denied DELETE on "media"
        let del_err =
            PolicyEngine::evaluate_blob(&user_ctx, "media", "avatar.png", "DELETE").unwrap_err();
        assert_eq!(del_err.code, "AUTH_FORBIDDEN");

        // Denied on another namespace "documents"
        let doc_err = PolicyEngine::evaluate_blob(&user_ctx, "documents", "contract.pdf", "READ")
            .unwrap_err();
        assert_eq!(doc_err.code, "AUTH_FORBIDDEN");
    }

    #[test]
    fn test_blob_wildcard_and_prefix_policy() {
        let wildcard_ctx = AuthContext {
            api_key_name: "global_blob_key".to_string(),
            mode: ServerMode::Readwrite,
            db_scope: vec![],
            rate_limit_override: 0,
            is_session: false,
            role: Some("global_blob".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "blob:*".to_string(),
                table_name: "uploads/*".to_string(),
                operations: vec!["READ".to_string()],
                rls_filter: None,
            }],
        };

        // Matching prefix on any namespace
        assert!(PolicyEngine::evaluate_blob(
            &wildcard_ctx,
            "photos",
            "uploads/profile.jpg",
            "READ"
        )
        .is_ok());
        assert!(
            PolicyEngine::evaluate_blob(&wildcard_ctx, "docs", "uploads/invoice.pdf", "READ")
                .is_ok()
        );

        // Non-matching key prefix
        let non_prefix_err =
            PolicyEngine::evaluate_blob(&wildcard_ctx, "photos", "system/config.json", "READ")
                .unwrap_err();
        assert_eq!(non_prefix_err.code, "AUTH_FORBIDDEN");

        // Write disallowed
        let write_err =
            PolicyEngine::evaluate_blob(&wildcard_ctx, "photos", "uploads/profile.jpg", "WRITE")
                .unwrap_err();
        assert_eq!(write_err.code, "AUTH_FORBIDDEN");

        // Namespace filtering
        let all_ns = vec![
            "photos".to_string(),
            "docs".to_string(),
            "private".to_string(),
        ];
        let filtered = PolicyEngine::filter_blob_namespaces(&wildcard_ctx, &all_ns);
        assert_eq!(filtered.len(), 3);
    }

    #[test]
    fn test_rls_predicate_extraction() {
        let rls_ctx = AuthContext {
            api_key_name: "tenant_tenantA".to_string(),
            mode: ServerMode::Readwrite,
            db_scope: vec![],
            rate_limit_override: 0,
            is_session: false,
            role: Some("tenant_role".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "analytics".to_string(),
                table_name: "orders".to_string(),
                operations: vec!["SELECT".to_string(), "UPDATE".to_string()],
                rls_filter: Some("org_id = :auth_key".to_string()),
            }],
        };

        // Matching SELECT
        let pred = PolicyEngine::get_rls_predicate(&rls_ctx, "analytics", "orders", "SELECT");
        assert_eq!(pred, Some("org_id = 'tenant_tenantA'".to_string()));

        // Matching UPDATE
        let pred_update =
            PolicyEngine::get_rls_predicate(&rls_ctx, "analytics", "orders", "UPDATE");
        assert_eq!(pred_update, Some("org_id = 'tenant_tenantA'".to_string()));

        // Non-matching operation DELETE
        let pred_del = PolicyEngine::get_rls_predicate(&rls_ctx, "analytics", "orders", "DELETE");
        assert_eq!(pred_del, None);

        // Different table
        let pred_other = PolicyEngine::get_rls_predicate(&rls_ctx, "analytics", "users", "SELECT");
        assert_eq!(pred_other, None);

        // Admin session bypasses RLS
        let admin_ctx = AuthContext {
            api_key_name: "admin".to_string(),
            is_session: true,
            ..Default::default()
        };
        assert_eq!(
            PolicyEngine::get_rls_predicate(&admin_ctx, "analytics", "orders", "SELECT"),
            None
        );
    }

    #[test]
    fn test_custom_permission_session_evaluation() {
        use axiom_core::PermissionSnapshot;

        // Custom session user with only SELECT on public.posts
        let custom_ctx = AuthContext {
            api_key_name: "user:editor_alice".to_string(),
            is_session: true,
            role: Some("custom".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "main_db".to_string(),
                table_name: "posts".to_string(),
                operations: vec!["SELECT".to_string()],
                rls_filter: None,
            }],
            ..Default::default()
        };

        // Permitted SELECT on posts
        assert!(PolicyEngine::evaluate(&custom_ctx, "main_db", "posts", "SELECT").is_ok());

        // Denied INSERT on posts
        let insert_res = PolicyEngine::evaluate(&custom_ctx, "main_db", "posts", "INSERT");
        assert!(insert_res.is_err());

        // Denied SELECT on comments
        let comments_res = PolicyEngine::evaluate(&custom_ctx, "main_db", "comments", "SELECT");
        assert!(comments_res.is_err());

        // Denied access on other database
        let other_db_res = PolicyEngine::evaluate(&custom_ctx, "finance_db", "invoices", "SELECT");
        assert!(other_db_res.is_err());
    }

    #[test]
    fn test_custom_session_blob_permissions_enforcement() {
        use axiom_core::PermissionSnapshot;

        // 1. Custom session with zero permissions
        let unprivileged_ctx = AuthContext {
            api_key_name: "user:bob".to_string(),
            is_session: true,
            role: Some("custom".to_string()),
            permissions: vec![],
            ..Default::default()
        };
        assert!(
            PolicyEngine::evaluate_blob(&unprivileged_ctx, "photos", "avatar.png", "READ").is_err()
        );
        assert!(
            PolicyEngine::evaluate_blob(&unprivileged_ctx, "photos", "avatar.png", "WRITE")
                .is_err()
        );
        assert!(
            PolicyEngine::evaluate_blob(&unprivileged_ctx, "photos", "avatar.png", "DELETE")
                .is_err()
        );
        let filtered_empty = PolicyEngine::filter_blob_namespaces(
            &unprivileged_ctx,
            &["photos".to_string(), "backups".to_string()],
        );
        assert!(filtered_empty.is_empty());

        // 2. Custom session with only database permissions
        let db_only_ctx = AuthContext {
            api_key_name: "user:charlie".to_string(),
            is_session: true,
            role: Some("custom".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "db1".to_string(),
                table_name: "*".to_string(),
                operations: vec!["SELECT".to_string()],
                rls_filter: None,
            }],
            ..Default::default()
        };
        assert!(PolicyEngine::evaluate_blob(&db_only_ctx, "photos", "avatar.png", "READ").is_err());
        assert!(
            PolicyEngine::filter_blob_namespaces(&db_only_ctx, &["photos".to_string()]).is_empty()
        );

        // 3. Custom session with granular READ on namespace 'photos'
        let blob_reader_ctx = AuthContext {
            api_key_name: "user:david".to_string(),
            is_session: true,
            role: Some("custom".to_string()),
            permissions: vec![PermissionSnapshot {
                database: "blob:photos".to_string(),
                table_name: "*".to_string(),
                operations: vec!["READ".to_string()],
                rls_filter: None,
            }],
            ..Default::default()
        };
        assert!(
            PolicyEngine::evaluate_blob(&blob_reader_ctx, "photos", "avatar.png", "READ").is_ok()
        );
        assert!(
            PolicyEngine::evaluate_blob(&blob_reader_ctx, "photos", "avatar.png", "WRITE").is_err()
        );
        assert!(
            PolicyEngine::evaluate_blob(&blob_reader_ctx, "photos", "avatar.png", "DELETE")
                .is_err()
        );
        assert!(
            PolicyEngine::evaluate_blob(&blob_reader_ctx, "secret_docs", "file.pdf", "READ")
                .is_err()
        );
        let filtered_reader = PolicyEngine::filter_blob_namespaces(
            &blob_reader_ctx,
            &["photos".to_string(), "secret_docs".to_string()],
        );
        assert_eq!(filtered_reader, vec!["photos".to_string()]);

        // 4. Super-administrator session bypasses evaluation
        let admin_ctx = AuthContext {
            api_key_name: "user:superadmin".to_string(),
            is_session: true,
            role: Some("admin".to_string()),
            permissions: vec![],
            ..Default::default()
        };
        assert!(PolicyEngine::evaluate_blob(&admin_ctx, "photos", "avatar.png", "DELETE").is_ok());
        let filtered_admin = PolicyEngine::filter_blob_namespaces(
            &admin_ctx,
            &["photos".to_string(), "secret_docs".to_string()],
        );
        assert_eq!(filtered_admin.len(), 2);
    }

    #[test]
    fn test_custom_session_database_and_table_filtering() {
        use axiom_core::PermissionSnapshot;

        let custom_user_ctx = AuthContext {
            api_key_name: "user:analyst".to_string(),
            is_session: true,
            role: Some("custom".to_string()),
            permissions: vec![
                PermissionSnapshot {
                    database: "analytics".to_string(),
                    table_name: "events".to_string(),
                    operations: vec!["SELECT".to_string()],
                    rls_filter: None,
                },
                PermissionSnapshot {
                    database: "analytics".to_string(),
                    table_name: "metrics".to_string(),
                    operations: vec!["SELECT".to_string()],
                    rls_filter: None,
                },
            ],
            ..Default::default()
        };

        // Filter databases
        let all_dbs = vec![
            "analytics".to_string(),
            "finance".to_string(),
            "users_db".to_string(),
        ];
        let allowed_dbs = PolicyEngine::filter_databases(&custom_user_ctx, &all_dbs);
        assert_eq!(allowed_dbs, vec!["analytics".to_string()]);

        // Filter tables in analytics
        let all_tables = vec![
            "events".to_string(),
            "metrics".to_string(),
            "salary_secrets".to_string(),
        ];
        let allowed_tables =
            PolicyEngine::filter_tables(&custom_user_ctx, "analytics", &all_tables);
        assert_eq!(
            allowed_tables,
            vec!["events".to_string(), "metrics".to_string()]
        );

        // Filter tables in unauthorized db
        let unauthorized_db_tables =
            PolicyEngine::filter_tables(&custom_user_ctx, "finance", &all_tables);
        assert!(unauthorized_db_tables.is_empty());

        // Unprivileged custom session user
        let empty_ctx = AuthContext {
            api_key_name: "user:stranger".to_string(),
            is_session: true,
            role: Some("custom".to_string()),
            permissions: vec![],
            ..Default::default()
        };
        assert!(PolicyEngine::filter_databases(&empty_ctx, &all_dbs).is_empty());
        assert!(PolicyEngine::filter_tables(&empty_ctx, "analytics", &all_tables).is_empty());
    }

    #[test]
    fn test_granular_table_and_blob_isolation() {
        use axiom_core::PermissionSnapshot;

        let scoped_user = AuthContext {
            api_key_name: "user:scoped_operator".to_string(),
            is_session: true,
            role: Some("custom".to_string()),
            permissions: vec![
                PermissionSnapshot {
                    database: "localdb".to_string(),
                    table_name: "categories".to_string(),
                    operations: vec!["SELECT".to_string(), "INSERT".to_string()],
                    rls_filter: None,
                },
                PermissionSnapshot {
                    database: "blob:public_assets".to_string(),
                    table_name: "*".to_string(),
                    operations: vec!["READ".to_string()],
                    rls_filter: None,
                },
            ],
            ..Default::default()
        };

        // Table access checks
        assert!(PolicyEngine::can_access_table(
            &scoped_user,
            "localdb",
            "categories"
        ));
        assert!(!PolicyEngine::can_access_table(
            &scoped_user,
            "localdb",
            "users"
        ));
        assert!(!PolicyEngine::can_access_table(
            &scoped_user,
            "localdb",
            "products"
        ));
        assert!(!PolicyEngine::can_access_table(
            &scoped_user,
            "otherdb",
            "categories"
        ));

        let tables = vec![
            "categories".to_string(),
            "users".to_string(),
            "products".to_string(),
        ];
        let filtered_tables = PolicyEngine::filter_tables(&scoped_user, "localdb", &tables);
        assert_eq!(filtered_tables, vec!["categories".to_string()]);

        // Blob namespace access checks
        let namespaces = vec!["public_assets".to_string(), "private_vault".to_string()];
        let filtered_ns = PolicyEngine::filter_blob_namespaces(&scoped_user, &namespaces);
        assert_eq!(filtered_ns, vec!["public_assets".to_string()]);

        // Evaluation
        assert!(PolicyEngine::evaluate(&scoped_user, "localdb", "categories", "SELECT").is_ok());
        assert!(PolicyEngine::evaluate(&scoped_user, "localdb", "categories", "INSERT").is_ok());
        assert!(PolicyEngine::evaluate(&scoped_user, "localdb", "categories", "DELETE").is_err());
        assert!(PolicyEngine::evaluate(&scoped_user, "localdb", "users", "SELECT").is_err());
    }
}

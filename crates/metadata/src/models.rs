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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct UserPermissionSet {
    /// System module privileges (e.g. "databases.view", "keys.create", "cluster.*")
    #[serde(default)]
    pub system: Vec<String>,
    /// Granular database permissions
    #[serde(default)]
    pub databases: Vec<UserDbPermission>,
    /// Granular blob namespace permissions
    #[serde(default)]
    pub blobs: Vec<UserBlobPermission>,
}

impl UserPermissionSet {
    /// Checks whether this permission set satisfies the required system capability.
    /// Supports exact matches ("keys.create"), resource wildcards ("keys.*"),
    /// or global wildcards ("*").
    pub fn has_system_permission(&self, required: &str) -> bool {
        let (req_resource, req_action) = match required.split_once('.') {
            Some((r, a)) => (r, a),
            None => (required, "*"),
        };

        self.system.iter().any(|perm| {
            let p = perm.trim();
            if p == "*" || p.eq_ignore_ascii_case(required) {
                return true;
            }
            if let Some((res, act)) = p.split_once('.') {
                let res_match = res.eq_ignore_ascii_case(req_resource)
                    || (res.eq_ignore_ascii_case("db")
                        && req_resource.eq_ignore_ascii_case("databases"))
                    || (res.eq_ignore_ascii_case("databases")
                        && req_resource.eq_ignore_ascii_case("db"))
                    || (res.eq_ignore_ascii_case("blob")
                        && req_resource.eq_ignore_ascii_case("blobs"))
                    || (res.eq_ignore_ascii_case("blobs")
                        && req_resource.eq_ignore_ascii_case("blob"));
                if res_match && (act == "*" || act.eq_ignore_ascii_case(req_action)) {
                    return true;
                }
            }
            // Backward compatibility for legacy flat tokens (e.g. "manage_keys", "view_audit")
            if (required.starts_with("keys.")) && p == "manage_keys" {
                return true;
            }
            if (required.starts_with("users.")) && p == "manage_users" {
                return true;
            }
            if (required.starts_with("cluster.")) && p == "manage_cluster" {
                return true;
            }
            if (required.starts_with("settings.")) && p == "manage_settings" {
                return true;
            }
            if (required.starts_with("databases.") || required.starts_with("db."))
                && p == "manage_databases"
            {
                return true;
            }
            if (required.starts_with("blobs.") || required.starts_with("blob."))
                && p == "manage_blobs"
            {
                return true;
            }
            if required == "audit.view" && (p == "view_audit" || p == "audit.view") {
                return true;
            }
            if (required == "settings.view" || required == "cluster.view") && p == "view_metrics" {
                return true;
            }
            false
        })
    }

    /// Checks whether this permission set satisfies the requested database operation.
    pub fn has_db_permission(&self, db: &str, table: &str, operation: &str) -> bool {
        if self.system.iter().any(|p| p == "*") {
            return true;
        }
        self.databases.iter().any(|d| {
            let db_match = d.database == "*" || d.database.eq_ignore_ascii_case(db);
            let tbl_match = d.table_name == "*"
                || d.table_name.is_empty()
                || table == "*"
                || d.table_name.eq_ignore_ascii_case(table);
            let op_match = d
                .operations
                .iter()
                .any(|o| o == "*" || o.eq_ignore_ascii_case(operation));
            db_match && tbl_match && op_match
        })
    }

    /// Checks whether this permission set satisfies the requested blob operation.
    pub fn has_blob_permission(&self, namespace: &str, operation: &str) -> bool {
        if self.system.iter().any(|p| p == "*") {
            return true;
        }
        self.blobs.iter().any(|b| {
            let ns_match = b.namespace == "*"
                || namespace == "*"
                || b.namespace.eq_ignore_ascii_case(namespace);
            let op_match = b
                .operations
                .iter()
                .any(|o| o == "*" || o.eq_ignore_ascii_case(operation));
            ns_match && op_match
        })
    }

    /// Enforces the Anti-Privilege-Escalation invariant:
    /// A user cannot grant or delegate any capability they do not already possess.
    pub fn subsumes(&self, requested: &UserPermissionSet) -> Result<(), String> {
        // If caller has global wildcard, all permissions are subsumed
        if self.system.iter().any(|p| p == "*") {
            return Ok(());
        }

        // 1. Verify system capabilities
        for perm in &requested.system {
            if !self.has_system_permission(perm) {
                return Err(format!(
                    "Cannot grant system capability '{}' which you do not possess",
                    perm
                ));
            }
        }

        // 2. Verify database scopes and operations
        for req_db in &requested.databases {
            for op in &req_db.operations {
                if !self.has_db_permission(&req_db.database, &req_db.table_name, op) {
                    return Err(format!(
                        "Cannot grant database operation '{}' on '{}.{}' which you do not possess",
                        op, req_db.database, req_db.table_name
                    ));
                }
            }
        }

        // 3. Verify blob scopes and operations
        for req_blob in &requested.blobs {
            for op in &req_blob.operations {
                if !self.has_blob_permission(&req_blob.namespace, op) {
                    return Err(format!(
                        "Cannot grant blob operation '{}' on namespace '{}' which you do not possess",
                        op, req_blob.namespace
                    ));
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct UserDbPermission {
    pub database: String,        // "*" or alias (e.g. "main_db")
    pub table_name: String,      // "*" or table name (e.g. "users")
    pub operations: Vec<String>, // ["SELECT", "INSERT", "UPDATE", "DELETE", "DDL"]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct UserBlobPermission {
    pub namespace: String,       // "*" or namespace name (e.g. "assets")
    pub operations: Vec<String>, // ["READ", "WRITE", "DELETE", "MANAGE_NS"]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRecord {
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: String,
    #[serde(default)]
    pub is_super_admin: bool,
    #[serde(default)]
    pub permissions: UserPermissionSet,
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
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
    pub database: String,        // '*' = all databases
    pub table_name: String,      // '*' = all tables
    pub operations: Vec<String>, // ["SELECT", "INSERT", "UPDATE", "DELETE"]
    #[serde(default)]
    pub rls_filter: Option<String>,
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

// ─── Capability Ticket Model ───────────────────────────────────────────────
// Stored in `blob_tickets` table; tracks issued tickets and their revocation status.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobTicketRecord {
    pub id: String,
    pub namespace: String,
    pub key: String,
    pub operation: String,
    pub expires_at: i64,
    pub signature: String,
    pub created_by: String,
    pub created_at: i64,
    pub revoked: bool,
}

// ─── Peer Node Cluster Model ───────────────────────────────────────────────
// Stored in `cluster_nodes` table; coordinates authenticated P2P mesh peers.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerNodeRecord {
    pub node_id: String,
    pub moniker: String,
    pub url: String,
    #[serde(skip_serializing)]
    pub shared_secret_hash: Vec<u8>,
    pub status: String, // 'connected', 'unreachable', 'pending'
    pub last_ping_ms: i64,
    pub last_seen_at: i64,
    pub created_at: i64,
}

// ─── Cluster Full Sync Payload ─────────────────────────────────────────────
// Transferred during peer state reconciliation to synchronize metadata.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterSyncPayload {
    pub node_id: String,
    pub epoch_version: u64,
    pub roles: Vec<RoleRecord>,
    pub api_keys: Vec<ApiKeyRecord>,
    pub databases: Vec<DatabaseRecord>,
    pub active_bans: Vec<String>,
}

// ─── Tests ─────────────────────────────────────────────────────────────────
// Tests for security invariants around serialization of models.

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{from_value, to_value};

    #[test]
    fn test_user_record_serialization_hides_password_hash() {
        let user = UserRecord {
            id: 1,
            username: "test".to_string(),
            email: Some("test@example.com".to_string()),
            password_hash: "secret_hash".to_string(),
            is_super_admin: true,
            permissions: UserPermissionSet::default(),
            created_at: 0,
            updated_at: 0,
        };
        let val = to_value(&user).unwrap();
        assert!(val.get("password_hash").is_none());
    }

    #[test]
    fn test_api_key_record_serialization_hides_secret_hash() {
        let key = ApiKeyRecord {
            name: "test_key".to_string(),
            secret_hash: vec![1, 2, 3],
            role_name: None,
            rate_limit: 100,
            expires_at: None,
            created_at: 0,
        };
        let val = to_value(&key).unwrap();
        assert!(val.get("secret_hash").is_none());
    }

    #[test]
    fn test_database_record_serialization_hides_url() {
        let db = DatabaseRecord {
            alias: "test_db".to_string(),
            url: "postgres://secret".to_string(),
            engine: "postgres".to_string(),
            pool_min: 1,
            pool_max: 5,
            created_at: 0,
        };
        let val = to_value(&db).unwrap();
        assert!(val.get("url").is_none());
    }

    #[test]
    fn test_role_record_serialization_contains_name_and_permissions() {
        let role = RoleRecord {
            name: "admin".to_string(),
            description: None,
            created_at: 0,
            permissions: vec![],
        };
        let val = to_value(&role).unwrap();
        assert!(val.get("name").is_some());
        assert!(val.get("permissions").is_some());
    }

    #[test]
    fn test_audit_record_roundtrip() {
        let audit = AuditRecord {
            id: 1,
            timestamp: 1000,
            actor: "user1".to_string(),
            action: "CREATE".to_string(),
            target: "table1".to_string(),
            details: Some("info".to_string()),
        };
        let val = to_value(&audit).unwrap();
        let decoded: AuditRecord = from_value(val).unwrap();
        assert_eq!(decoded.id, 1);
        assert_eq!(decoded.actor, "user1");
    }

    #[test]
    fn test_anti_privilege_escalation_subsumes() {
        use super::{UserBlobPermission, UserDbPermission};

        // Caller only has user view and create
        let caller_perms = UserPermissionSet {
            system: vec!["users.view".to_string(), "users.create".to_string()],
            databases: vec![UserDbPermission {
                database: "db1".to_string(),
                table_name: "orders".to_string(),
                operations: vec!["SELECT".to_string()],
            }],
            blobs: vec![],
        };

        // Target request with same or subset: OK
        let valid_target = UserPermissionSet {
            system: vec!["users.view".to_string()],
            databases: vec![UserDbPermission {
                database: "db1".to_string(),
                table_name: "orders".to_string(),
                operations: vec!["SELECT".to_string()],
            }],
            blobs: vec![],
        };
        assert!(caller_perms.subsumes(&valid_target).is_ok());

        // Target requests users.delete which caller lacks: MUST FAIL
        let escalating_target = UserPermissionSet {
            system: vec!["users.delete".to_string()],
            databases: vec![],
            blobs: vec![],
        };
        assert!(caller_perms.subsumes(&escalating_target).is_err());

        // Target requests INSERT on orders which caller lacks: MUST FAIL
        let escalating_db = UserPermissionSet {
            system: vec!["users.view".to_string()],
            databases: vec![UserDbPermission {
                database: "db1".to_string(),
                table_name: "orders".to_string(),
                operations: vec!["SELECT".to_string(), "INSERT".to_string()],
            }],
            blobs: vec![],
        };
        assert!(caller_perms.subsumes(&escalating_db).is_err());

        // Target requests blob access which caller lacks: MUST FAIL
        let escalating_blob = UserPermissionSet {
            system: vec![],
            databases: vec![],
            blobs: vec![UserBlobPermission {
                namespace: "assets".to_string(),
                operations: vec!["READ".to_string()],
            }],
        };
        assert!(caller_perms.subsumes(&escalating_blob).is_err());

        // Root wildcard caller subsumes all requests
        let root_caller = UserPermissionSet {
            system: vec!["*".to_string()],
            databases: vec![],
            blobs: vec![],
        };
        assert!(root_caller.subsumes(&escalating_target).is_ok());
        assert!(root_caller.subsumes(&escalating_db).is_ok());
        assert!(root_caller.subsumes(&escalating_blob).is_ok());
    }

    #[test]
    fn test_has_system_permission_aliasing_and_enforcement() {
        // 1. Dual alias matching: db.view <-> databases.view
        let db_set = UserPermissionSet {
            system: vec!["db.view".to_string()],
            databases: vec![],
            blobs: vec![],
        };
        assert!(db_set.has_system_permission("databases.view"));
        assert!(db_set.has_system_permission("db.view"));
        assert!(!db_set.has_system_permission("databases.create"));
        assert!(!db_set.has_system_permission("blobs.view"));

        // 2. Dual alias matching: blobs.view <-> blob.view
        let blob_set = UserPermissionSet {
            system: vec!["blobs.create".to_string(), "blob.view".to_string()],
            databases: vec![],
            blobs: vec![],
        };
        assert!(blob_set.has_system_permission("blob.create"));
        assert!(blob_set.has_system_permission("blobs.create"));
        assert!(blob_set.has_system_permission("blobs.view"));
        assert!(blob_set.has_system_permission("blob.view"));
        assert!(!blob_set.has_system_permission("blobs.delete"));

        // 3. Resource wildcard matching
        let wildcard_set = UserPermissionSet {
            system: vec!["databases.*".to_string()],
            databases: vec![],
            blobs: vec![],
        };
        assert!(wildcard_set.has_system_permission("databases.view"));
        assert!(wildcard_set.has_system_permission("databases.create"));
        assert!(wildcard_set.has_system_permission("db.delete"));
        assert!(!wildcard_set.has_system_permission("users.view"));

        // 4. Global wildcard matching
        let global_set = UserPermissionSet {
            system: vec!["*".to_string()],
            databases: vec![],
            blobs: vec![],
        };
        assert!(global_set.has_system_permission("anything.view"));
        assert!(global_set.has_system_permission("users.delete"));

        // 5. Empty permissions reject everything
        let empty_set = UserPermissionSet::default();
        assert!(!empty_set.has_system_permission("databases.view"));
        assert!(!empty_set.has_system_permission("users.view"));
        assert!(!empty_set.has_system_permission("blobs.view"));
    }
}

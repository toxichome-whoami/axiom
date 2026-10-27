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
                if res.eq_ignore_ascii_case(req_resource)
                    && (act == "*" || act.eq_ignore_ascii_case(req_action))
                {
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
            if (required.starts_with("databases.")) && p == "manage_databases" {
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
}

/*
 * Lock-free in-memory snapshot of identity, roles, permissions, and database connections.
 * Owned by: metadata
 * Key deps: arc_swap::ArcSwap, once_cell::sync::Lazy, std::collections::HashMap
 * Invariants: Hot-path data plane reads never lock or query SQLite; atomic pointer swap updates snapshot.
 * Last structural change: Phase 1 initial implementation of ArcSwap metadata snapshot.
 */

use arc_swap::ArcSwap;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;

// ─── Fast-Lookup Snapshot Structures ───────────────────────────────────────
// In-memory representations optimized for zero-copy, zero-allocation lookups during request handling.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiKeySnapshot {
    pub name: String,
    pub secret_hash: [u8; 32], // BLAKE3 hash for constant-time comparison
    pub role_name: Option<String>,
    pub rate_limit_override: u32,
    pub expires_at: Option<i64>,
}

pub use axiom_core::PermissionSnapshot;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RoleSnapshot {
    pub name: String,
    pub permissions: Vec<PermissionSnapshot>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DatabaseSnapshot {
    pub alias: String,
    pub url: String,
    pub engine: String,
    pub pool_min: u32,
    pub pool_max: u32,
}

#[derive(Debug, Clone, Default)]
pub struct MetadataSnapshot {
    pub keys: HashMap<String, ApiKeySnapshot>,
    pub roles: HashMap<String, RoleSnapshot>,
    pub databases: HashMap<String, DatabaseSnapshot>,
    pub loaded_at_unix: i64,
}

// ─── Global Atomic Snapshot Registry ───────────────────────────────────────
// ArcSwap enables lock-free concurrent reads by hundreds of worker threads while allowing
// background workers or admin mutations to publish an entirely new snapshot with a single pointer swap.
static GLOBAL_METADATA: Lazy<ArcSwap<MetadataSnapshot>> =
    Lazy::new(|| ArcSwap::from_pointee(MetadataSnapshot::default()));

/// Loads the current metadata snapshot pointer without acquiring any mutex locks.
/// CONTRACT:
///  - Returns an `Arc<MetadataSnapshot>` clone.
///  - Side effects: None.
///  - Idempotent: Yes.
pub fn get_snapshot() -> Arc<MetadataSnapshot> {
    GLOBAL_METADATA.load_full()
}

/// Atomically replaces the active metadata snapshot with a newly synchronized version.
/// CONTRACT:
///  - Precondition: `new_snapshot` was loaded and verified from `axiom.db`.
///  - Side effects: Atomically swaps pointer in `GLOBAL_METADATA`; old snapshot dropped when readers finish.
///  - Idempotent: Yes.
pub fn update_snapshot(new_snapshot: MetadataSnapshot) {
    GLOBAL_METADATA.store(Arc::new(new_snapshot));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_snapshot_atomic_update_and_read() {
        let initial = get_snapshot();
        assert!(initial.keys.is_empty());

        let mut custom_keys = HashMap::new();
        custom_keys.insert(
            "test_app".to_string(),
            ApiKeySnapshot {
                name: "test_app".to_string(),
                secret_hash: [42u8; 32],
                role_name: Some("readonly".to_string()),
                rate_limit_override: 100,
                expires_at: None,
            },
        );

        let new_snap = MetadataSnapshot {
            keys: custom_keys,
            roles: HashMap::new(),
            databases: HashMap::new(),
            loaded_at_unix: 1700000000,
        };

        update_snapshot(new_snap);

        let updated = get_snapshot();
        assert_eq!(updated.loaded_at_unix, 1700000000);
        assert!(updated.keys.contains_key("test_app"));
        let key = updated.keys.get("test_app").unwrap();
        assert_eq!(key.rate_limit_override, 100);
        assert_eq!(key.secret_hash[0], 42);
    }
}


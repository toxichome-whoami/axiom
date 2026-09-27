/*
 * Axiom Metadata — SQLite/Turso persistence, schema migrations, and ArcSwap identity snapshots.
 * Owned by: metadata
 * Key deps: libsql, argon2, blake3, arc-swap, axiom-core
 * Invariants: Hot-path data plane reads zero DBs; atomic pointer swap refreshes ArcSwap<MetadataSnapshot>.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod models;
pub mod snapshot;
pub mod store;

pub use models::*;
pub use snapshot::{
    get_snapshot, update_snapshot, ApiKeySnapshot, DatabaseSnapshot, MetadataSnapshot,
    PermissionSnapshot, RoleSnapshot,
};
pub use store::MetadataStore;

/*
 * Metadata subsystem root providing schema storage, snapshot distribution, and auto-seeding.
 * Owned by: metadata
 * Key deps: libsql, arc_swap
 * Invariants: Single source of truth for runtime configuration state.
 * Last structural change: Phase 1 initial implementation.
 */

pub mod models;
pub mod snapshot;
pub mod store;

pub use models::*;
pub use snapshot::{get_snapshot, update_snapshot, MetadataSnapshot};
pub use store::MetadataStore;

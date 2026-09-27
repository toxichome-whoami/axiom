/*
 * Chronologically monotonic UUID generation utility (UUID v7).
 * Owned by: core
 * Key deps: uuid
 * Invariants: UUID v7 guarantees chronological monotonicity for DB indexing.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use uuid::Uuid;

pub fn uuid7() -> String {
    Uuid::now_v7().to_string()
}

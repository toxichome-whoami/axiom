/*
 * Security subsystem modules including IP ban lists and brute-force mitigations.
 * Owned by: crates/api (security)
 * Key deps: dashmap
 * Invariants: Ban list state is accessible in-memory with sub-microsecond lookup.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod ban_list;

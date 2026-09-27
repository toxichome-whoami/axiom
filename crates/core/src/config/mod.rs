/*
 * Gateway configuration schemas, defaults, and file/environment loader.
 * Owned by: crates/core (config)
 * Key deps: serde, figment
 * Invariants: Config options are strongly typed with safe production defaults.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod loader;
pub mod schema;

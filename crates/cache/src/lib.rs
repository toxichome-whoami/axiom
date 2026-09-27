/*
 * Unified caching subsystem root re-exporting engine, durability levels, and statistics.
 * Owned by: cache
 * Key deps: crate::cache::engine
 * Invariants: Single entry point for all application and data-plane caching.
 * Last structural change: Phase 5 cache consolidation.
 */

pub mod engine;

pub use engine::{CacheEngine, CacheStatsSnapshot, Durability};

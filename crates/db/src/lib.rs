/*
 * Axiom Database — Connection pooling and dialect engine implementations.
 * Owned by: db
 * Key deps: sqlx, tiberius, libsql, reqwest, axiom-core, axiom-metadata
 * Invariants: Engine initialization is lazy and per-alias locked; trait returns typed EngineError.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod engines;
pub mod pool;

pub use engines::base::{ColumnInfo, DatabaseEngine, EngineError, ForeignKeyInfo, QueryResult, TableInfo};
pub use pool::DatabasePoolManager;

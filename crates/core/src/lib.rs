/*
 * Axiom Core — Foundational types, errors, configurations, and logging infrastructure.
 * Owned by: core
 * Key deps: serde, axum, figment, tracing
 * Invariants: Zero dependencies on sibling crates; strictly leaf dependency.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod config;
pub mod db_types;
pub mod error;
pub mod logging;
pub mod size_parser;
pub mod types;
pub mod uuid_util;

pub use config::loader::ConfigManager;
pub use config::schema::AxiomConfig;
pub use db_types::{ColumnInfo, EngineError, ForeignKeyInfo, QueryResult, TableInfo};
pub use error::AxiomError;
pub use size_parser::{format_size, normalize_size, parse_size};
pub use types::{AuthContext, DbEngineType, PermissionSnapshot, ServerMode};
pub use uuid_util::uuid7;

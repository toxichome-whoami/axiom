/*
 * Database route handlers, AST firewall parsing, filter builder, and schema descriptors.
 * Owned by: crates/api (database)
 * Key deps: axum, sqlparser, axiom_db
 * Invariants: Endpoints require valid authentication and table-level RBAC policy evaluation.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod filter_builder;
pub mod handlers;
pub mod router;
pub mod schemas;

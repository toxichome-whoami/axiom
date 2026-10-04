/*
 * Axiom API — Axum HTTP routing, middleware pipeline, admin/MCP handlers, and embedded UI.
 * Owned by: api
 * Key deps: axum, tower, axiom-core, axiom-metadata, axiom-policy, axiom-cache, axiom-db
 * Invariants: Middleware runs in strict pipeline order; zero direct DB calls on hot path.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod admin;
pub mod blobs;
pub mod core;
pub mod database;
pub mod mcp;
pub mod metrics;
pub mod middleware;
pub mod security;
pub mod server;
pub mod ui;

pub use server::app::create_app;
pub use server::lifespan;

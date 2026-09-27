/*
 * HTTP application router construction and background daemon lifespan coordinator.
 * Owned by: crates/api (server)
 * Key deps: axum, tokio
 * Invariants: Router wires WAF, rate-limiting, auth, and response middlewares in strictly validated order.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

pub mod app;
pub mod lifespan;

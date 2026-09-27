/*
 * Admin API module root for system configuration, identity management, and observability.
 * Owned by: api/admin
 * Key deps: axum
 * Invariants: Endpoints restricted to administrative operators.
 * Last structural change: Phase 1 initial implementation.
 */

pub mod handlers;
pub mod router;

pub use router::get_router;

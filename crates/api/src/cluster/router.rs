/*
 * Router registration for internal cluster mesh communication endpoints.
 * Owned by: api::cluster
 * Key deps: axum, crate::cluster::handlers
 * Invariants: Mounted at `/internal/v1/cluster`; isolated from public data API routing.
 */

use axum::{
    routing::{get, post},
    Router,
};

use crate::cluster::handlers::*;

/// Builds the Axum router for all internal cluster coordination endpoints.
pub fn cluster_router() -> Router {
    Router::new()
        .route("/handshake", post(handle_handshake))
        .route("/ping", get(handle_ping))
        .route("/event", post(handle_event))
        .route("/sync", get(handle_sync))
}

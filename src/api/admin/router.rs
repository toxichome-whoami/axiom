/*
 * Admin API router definition mounted under `/admin/v1`.
 * Owned by: api/admin
 * Key deps: axum, crate::api::admin::handlers
 * Invariants: Mounted behind authentication middleware enforcing administrative capabilities.
 * Last structural change: Phase 1 initial implementation of Admin router.
 */

use axum::{
    routing::{delete, get, post},
    Router,
};
use crate::api::admin::handlers::*;

/// Constructs the Admin API sub-router.
/// CONTRACT:
///  - Returns Router configured with `/status`, `/reload`, and `/keys` endpoints.
///  - Upstream must attach authentication middleware to populate AuthContext extension.
pub fn get_router() -> Router {
    Router::new()
        .route("/status", get(get_status))
        .route("/reload", post(reload_metadata))
        .route("/keys", get(list_keys).post(create_key))
        .route("/keys/:name", delete(delete_key))
        .route("/databases", get(list_databases).post(add_database))
        .route("/databases/:alias", delete(delete_database))
}

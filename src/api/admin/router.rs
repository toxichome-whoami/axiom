/*
 * Admin API router definition mounted under `/admin/v1`.
 * Owned by: api/admin
 * Key deps: axum, crate::api::admin::handlers
 * Invariants: Mounted behind authentication middleware enforcing administrative capabilities.
 * Last structural change: Phase 1 initial implementation of Admin router.
 */

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use crate::api::admin::handlers::*;

/// Constructs the Admin API sub-router.
/// CONTRACT:
///  - Returns Router configured with `/status`, `/reload`, `/keys`, `/roles`, and `/databases` endpoints.
///  - Upstream must attach authentication middleware to populate AuthContext extension.
pub fn get_router() -> Router {
    Router::new()
        .route("/status", get(get_status))
        .route("/reload", post(reload_metadata))
        .route("/keys", get(list_keys).post(create_key))
        .route("/keys/:name", delete(delete_key))
        .route("/roles", get(list_roles).post(create_role))
        .route("/roles/:name", patch(update_role).delete(delete_role))
        .route("/databases", get(list_databases).post(add_database))
        .route("/databases/:alias", delete(delete_database))
        .route("/cache/stats", get(get_cache_stats))
        .route("/cache/flush", post(flush_cache))
}

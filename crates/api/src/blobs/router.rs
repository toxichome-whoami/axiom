/*
 * Router configuration and URL mapping for native blob endpoints.
 * Owned by: api/blobs
 * Key deps: axum, crate::blobs::handlers
 * Invariants: Endpoints mounted under /api/v1/blobs; administrative routes mounted under /admin/v1/blobs.
 * Last structural change: Initial implementation of Phase 1-3 Blob Engine API.
 */

use crate::blobs::handlers::*;
use axum::{
    routing::{get, post, put},
    Router,
};

/// Builds the public Data API router for blob storage mounted at `/api/v1/blobs`.
pub fn get_router() -> Router {
    Router::new()
        .route("/:namespace", get(list_blobs_handler))
        .route(
            "/:namespace/*key",
            put(put_blob_handler)
                .get(get_blob_handler)
                .head(head_blob_handler)
                .delete(delete_blob_handler),
        )
}

/// Builds the Admin API router for blob storage mounted at `/admin/v1/blobs`.
pub fn get_admin_router() -> Router {
    Router::new()
        .route("/stats", get(blob_stats_handler))
        .route("/namespaces", get(list_namespaces_handler))
        .route("/verify/:namespace/*key", post(verify_blob_handler))
}

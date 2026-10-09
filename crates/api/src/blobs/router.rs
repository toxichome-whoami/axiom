/*
 * Router configuration and URL mapping for native blob endpoints.
 * Owned by: api/blobs
 * Key deps: axum, crate::blobs::handlers
 * Invariants: Endpoints mounted under /api/v1/blobs; administrative routes mounted under /admin/v1/blobs.
 * Last structural change: Initial implementation of Phase 1-3 Blob Engine API.
 */

use crate::blobs::handlers::*;
use axum::{
    routing::{get, patch, post, put},
    Router,
};

/// Builds the public Data API router for blob storage mounted at `/api/v1/blobs`.
pub fn get_router() -> Router {
    Router::new()
        .route("/:namespace", get(list_blobs_handler))
        .route("/:namespace/ticket", post(create_ticket_handler))
        .route("/:namespace/uploads", post(init_upload_handler))
        .route(
            "/:namespace/uploads/:upload_id/parts/:part",
            put(put_part_handler),
        )
        .route(
            "/:namespace/uploads/:upload_id/complete",
            post(complete_upload_handler),
        )
        .route(
            "/:namespace/uploads/:upload_id",
            axum::routing::delete(abort_upload_handler),
        )
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
        .route("/scrub", post(scrub_blobs_handler))
        .route("/sweep", post(sweep_expired_handler))
        .route(
            "/namespaces",
            get(list_namespaces_handler).post(create_namespace_handler),
        )
        .route(
            "/namespaces/:namespace",
            patch(update_namespace_handler).delete(delete_namespace_handler),
        )
        .route("/copy", post(copy_blob_handler))
        .route("/move", post(move_blob_handler))
        .route("/delete-prefix", post(delete_prefix_handler))
        .route("/verify/:namespace/*key", post(verify_blob_handler))
}

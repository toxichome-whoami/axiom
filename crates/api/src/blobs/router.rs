/*
 * Router configuration and URL mapping for native blob endpoints.
 * Owned by: api/blobs
 * Key deps: axum, crate::blobs::handlers
 * Invariants: Endpoints mounted under /api/v1/blobs; administrative routes mounted under /admin/v1/blobs.
 * Last structural change: Unified first-class URL hierarchy for namespaces, objects, uploads, tickets.
 */

use crate::blobs::handlers::*;
use axum::{
    routing::{get, post, put},
    Router,
};

/// Builds the public Data API router for blob storage mounted at `/api/v1/blobs`.
pub fn get_router() -> Router {
    Router::new()
        // 1. Edge Streaming & Public CDN
        .route(
            "/public/:namespace/*key",
            get(get_public_blob_handler).head(head_public_blob_handler),
        )
        // 2. Namespaces & Storage Quota Headroom (Read-only in Data Plane; Mutations reserved for Admin API)
        .route(
            "/namespaces",
            get(list_namespaces_handler),
        )
        .route(
            "/namespaces/:namespace",
            get(get_namespace_handler),
        )
        .route(
            "/namespaces/:namespace/usage",
            get(get_namespace_usage_handler),
        )
        // 3. Object Operations (First-Class REST Data Plane)
        .route("/objects/copy", post(copy_blob_handler))
        .route("/objects/move", post(move_blob_handler))
        .route(
            "/objects/:namespace/copy",
            post(copy_blob_scoped_handler),
        )
        .route(
            "/objects/:namespace/move",
            post(move_blob_scoped_handler),
        )
        .route(
            "/objects/:namespace/batch-delete",
            post(batch_delete_blobs_handler),
        )
        .route(
            "/objects/:namespace/verify/*key",
            post(verify_blob_handler),
        )
        .route(
            "/objects/:namespace",
            get(list_blobs_handler),
        )
        .route(
            "/objects/:namespace/*key",
            put(put_blob_handler)
                .get(get_blob_handler)
                .head(head_blob_handler)
                .delete(delete_blob_handler),
        )
        // 4. Resumable & Direct Uploads
        .route(
            "/uploads/:namespace",
            post(init_upload_handler),
        )
        .route(
            "/uploads/:namespace/sign",
            post(create_upload_link_handler),
        )
        .route(
            "/uploads/:namespace/:upload_id",
            get(get_upload_status_handler)
                .put(upload_chunk_handler)
                .patch(upload_chunk_handler)
                .delete(abort_upload_handler),
        )
        .route(
            "/uploads/:namespace/:upload_id/parts/:part",
            put(put_part_handler),
        )
        .route(
            "/uploads/:namespace/:upload_id/complete",
            post(complete_upload_handler),
        )
        // 5. Capability Tickets (Namespace-Scoped Security Plane)
        .route(
            "/tickets/:namespace",
            get(list_namespace_tickets_handler).post(create_ticket_handler),
        )
        .route(
            "/tickets/:namespace/:signature/revoke",
            post(revoke_ticket_scoped_handler),
        )
        .route(
            "/tickets/:namespace/:signature/enable",
            post(enable_ticket_scoped_handler),
        )
        .route(
            "/tickets/:namespace/:signature",
            axum::routing::delete(delete_ticket_scoped_handler),
        )
        // Backward compatibility alias for namespace tickets
        .route(
            "/namespaces/:namespace/tickets",
            get(list_namespace_tickets_handler).post(create_ticket_handler),
        )
        // 6. Legacy / Backward Compatibility Aliases
        .route(
            "/:namespace/delete-objects",
            post(batch_delete_blobs_handler),
        )
        .route("/:namespace", get(list_blobs_handler))
        .route("/:namespace/ticket", post(create_ticket_handler))
        .route("/:namespace/uploads", post(init_upload_handler))
        .route(
            "/:namespace/uploads/:upload_id",
            get(get_upload_status_handler)
                .put(upload_chunk_handler)
                .patch(upload_chunk_handler)
                .delete(abort_upload_handler),
        )
        .route(
            "/:namespace/uploads/:upload_id/parts/:part",
            put(put_part_handler),
        )
        .route(
            "/:namespace/uploads/:upload_id/complete",
            post(complete_upload_handler),
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
            get(get_namespace_handler)
                .patch(update_namespace_handler)
                .delete(delete_namespace_handler),
        )
        .route(
            "/namespaces/:namespace/usage",
            get(get_namespace_usage_handler),
        )
        .route("/tickets", get(list_tickets_handler))
        .route("/tickets/:signature/revoke", post(revoke_ticket_handler))
        .route("/tickets/:signature/enable", post(enable_ticket_handler))
        .route(
            "/tickets/:signature",
            axum::routing::delete(delete_ticket_handler),
        )
}

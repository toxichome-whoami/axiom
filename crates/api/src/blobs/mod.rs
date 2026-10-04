/*
 * Native embedded blob storage API integration and lifecycle management.
 * Owned by: api/blobs
 * Key deps: axiom-blob, axiom-core, tokio::sync::OnceCell
 * Invariants: Zero runtime allocations or threads spawned if config.blob.enabled is false.
 * Last structural change: Initial implementation of Phase 1-3 Blob Engine API.
 */

pub mod handlers;
pub mod router;

use axiom_blob::BlobEngine;
use axiom_core::AxiomError;
use axum::http::StatusCode;
use std::sync::Arc;
use tokio::sync::OnceCell;

static GLOBAL_BLOB_ENGINE: OnceCell<Arc<BlobEngine>> = OnceCell::const_new();

/// Initializes the global BlobEngine instance.
/// CONTRACT:
///  - Precondition: Called during application startup if `config.blob.enabled` is true.
///  - Side effects: Initializes Fjall LSM keyspaces and file store at `base_path`.
///  - Idempotent: Yes (subsequent calls return already initialized handle).
pub async fn init_blob_engine(
    base_path: &str,
    inline_max_bytes: u64,
    max_object_bytes: u64,
    verify_reads: bool,
) -> Result<(), String> {
    if GLOBAL_BLOB_ENGINE.get().is_some() {
        return Ok(());
    }

    let engine = BlobEngine::new(base_path, inline_max_bytes, max_object_bytes, verify_reads)
        .await
        .map_err(|e| format!("BlobEngine initialization error: {}", e))?;

    let _ = GLOBAL_BLOB_ENGINE.set(Arc::new(engine));
    Ok(())
}

/// Retrieves the active BlobEngine instance or returns a 503 SERVICE_UNAVAILABLE error.
/// CONTRACT:
///  - Returns `Arc<BlobEngine>` if enabled and initialized.
///  - Throws `AxiomError(BLOB_ENGINE_DISABLED, 503)` if blob subsystem is not active.
pub fn get_blob_engine() -> Result<Arc<BlobEngine>, AxiomError> {
    GLOBAL_BLOB_ENGINE.get().cloned().ok_or_else(|| {
        AxiomError::new(
            "BLOB_ENGINE_DISABLED",
            "Native blob storage is currently disabled on this gateway",
            StatusCode::SERVICE_UNAVAILABLE,
        )
    })
}

pub use router::{get_admin_router, get_router};

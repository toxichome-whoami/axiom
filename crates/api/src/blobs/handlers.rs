 /*
 * Axum HTTP request handlers for native embedded blob storage operations.
 * Owned by: api/blobs
 * Key deps: axum, bytes, axiom-blob, axiom-policy, axiom-metadata
 * Invariants: PolicyEngine evaluates permissions before data access; security headers attached to all blob downloads.
 * Last structural change: Initial implementation of Phase 1-3 Blob Engine API.
 */

use crate::blobs::get_blob_engine;
use axiom_blob::{BlobData, BlobError};
use axiom_core::{AxiomError, AuthContext};
use axiom_metadata::MetadataStore;
use axiom_policy::PolicyEngine;
use axum::{
    body::Body,
    extract::{Extension, Path, Query},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::json;
use tokio_util::io::ReaderStream;

/// Converts internal `BlobError` into an appropriate public `AxiomError` HTTP response.
fn map_blob_error(err: BlobError) -> AxiomError {
    match err {
        BlobError::InvalidNamespace(msg) => {
            AxiomError::new("INVALID_NAMESPACE", &msg, StatusCode::BAD_REQUEST)
        }
        BlobError::InvalidKey(msg) => AxiomError::new("INVALID_KEY", &msg, StatusCode::BAD_REQUEST),
        BlobError::NamespaceNotFound(ns) => AxiomError::new(
            "NAMESPACE_NOT_FOUND",
            &format!("Namespace '{}' not found", ns),
            StatusCode::NOT_FOUND,
        ),
        BlobError::NotFound { namespace, key } => AxiomError::new(
            "BLOB_NOT_FOUND",
            &format!("Object '{}/{}' not found", namespace, key),
            StatusCode::NOT_FOUND,
        ),
        BlobError::AlreadyExists { namespace, key } => AxiomError::new(
            "BLOB_ALREADY_EXISTS",
            &format!("Object '{}/{}' already exists", namespace, key),
            StatusCode::CONFLICT,
        ),
        BlobError::PayloadTooLarge { size, max } => AxiomError::new(
            "PAYLOAD_TOO_LARGE",
            &format!("Payload size {} exceeds allowed max of {} bytes", size, max),
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
        BlobError::QuotaExceeded {
            namespace,
            current,
            requested,
            max,
        } => AxiomError::new(
            "QUOTA_EXCEEDED",
            &format!(
                "Namespace '{}' storage quota exceeded (current: {} B, requested: {} B, quota: {} B)",
                namespace, current, requested, max
            ),
            StatusCode::INSUFFICIENT_STORAGE,
        ),
        BlobError::ChecksumMismatch { expected, actual } => AxiomError::new(
            "CHECKSUM_MISMATCH",
            &format!("Integrity check failed: expected {}, got {}", expected, actual),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        BlobError::InvalidRange(msg) => AxiomError::new(
            "BLOB_RANGE_NOT_SATISFIABLE",
            &msg,
            StatusCode::RANGE_NOT_SATISFIABLE,
        ),
        BlobError::InvalidTicket(msg) => AxiomError::new(
            "BLOB_INVALID_TICKET",
            &msg,
            StatusCode::UNAUTHORIZED,
        ),
        BlobError::UploadSessionNotFound(id) => AxiomError::new(
            "BLOB_UPLOAD_SESSION_NOT_FOUND",
            &format!("Upload session '{}' not found or expired", id),
            StatusCode::NOT_FOUND,
        ),
        BlobError::Io(msg) => AxiomError::new(
            "STORAGE_IO_ERROR",
            &format!("Storage I/O error: {}", msg),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        BlobError::Engine(msg) => AxiomError::new(
            "STORAGE_ENGINE_ERROR",
            &format!("Storage engine error: {}", msg),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    }
}

/// Stores or overwrites a blob in the designated namespace.
/// CONTRACT:
///  - Precondition: Caller must be authorized for `WRITE` on `namespace/key`.
///  - Side effects: Stores blob data, commits metadata, logs audit trail.
///  - Idempotent: Yes on identical payload.
pub async fn put_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &key, "WRITE")?;

    let engine = get_blob_engine()?;

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("application/octet-stream");

    let ttl_seconds = headers
        .get("X-Axiom-TTL")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let meta = engine
        .put_with_options(&namespace, &key, Some(content_type), &body, ttl_seconds)
        .await
        .map_err(map_blob_error)?;

    // Audit logging for write mutation
    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let target = format!("{}/{}", namespace, key);
    let details = format!("hash={}, size={}, inline={}", meta.hash, meta.size, meta.inline);
    let _ = MetadataStore::record_audit(actor, "blob.put", &target, Some(&details)).await;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": meta,
            "error": serde_json::Value::Null
        })),
    ))
}

/// Retrieves an existing blob payload from storage.
/// CONTRACT:
///  - Precondition: Caller must be authorized for `READ` on `namespace/key`.
///  - Supports: HTTP 206 Partial Content via `Range: bytes=start-end`.
///  - Enforces: `nosniff`, `attachment` disposition (stored XSS defense), ETag calculation.
pub async fn get_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
) -> Result<Response, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &key, "READ")?;

    let engine = get_blob_engine()?;

    // Determine filename for safe Content-Disposition
    let filename = key.rsplit(['/', '\\']).next().unwrap_or("blob.bin");
    let safe_filename: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    let disposition = format!("attachment; filename=\"{}\"", safe_filename);

    // Check for HTTP Range header. Max single range: 256 MB (bandwidth/DoS cap, L-fix).
    // Malformed or multi-range headers fail closed with 416 (was: silent full 200).
    const MAX_RANGE_BYTES: u64 = 256 * 1024 * 1024;
    let range_hdr = headers.get(header::RANGE).and_then(|h| h.to_str().ok());
    let parsed_range = if let Some(r) = range_hdr {
        if r.contains(',') {
            return Err(AxiomError::new(
                "RANGE_NOT_SATISFIABLE",
                "Multiple ranges are not supported",
                StatusCode::RANGE_NOT_SATISFIABLE,
            ));
        }
        if let Some(spec) = r.strip_prefix("bytes=") {
            let mut parts = spec.split('-');
            let start_str = parts.next().unwrap_or("").trim();
            let end_str = parts.next().unwrap_or("").trim();

            if start_str.is_empty() && !end_str.is_empty() {
                // Suffix range: bytes=-500 (last 500 bytes), capped at 256 MB.
                if let Ok(suffix) = end_str.parse::<u64>() {
                    let suffix = suffix.min(MAX_RANGE_BYTES);
                    let total = engine.head(&namespace, &key).map_err(map_blob_error)?.size;
                    let start = total.saturating_sub(suffix);
                    Some((start, None))
                } else {
                    return Err(AxiomError::new(
                        "RANGE_NOT_SATISFIABLE",
                        "Invalid Range header",
                        StatusCode::RANGE_NOT_SATISFIABLE,
                    ));
                }
            } else if let Ok(start) = start_str.parse::<u64>() {
                // Cap open-ended / huge ranges at 256 MB from start.
                let end = if end_str.is_empty() {
                    Some(start.saturating_add(MAX_RANGE_BYTES))
                } else {
                    end_str.parse::<u64>().ok().map(|e| {
                        if e < start {
                            e
                        } else {
                            start.saturating_add((e.saturating_sub(start)).min(MAX_RANGE_BYTES))
                        }
                    })
                };
                // Unparseable end with explicit `-` still fails closed.
                let end = match (end_str.is_empty(), end) {
                    (false, None) => {
                        return Err(AxiomError::new(
                            "RANGE_NOT_SATISFIABLE",
                            "Invalid Range header",
                            StatusCode::RANGE_NOT_SATISFIABLE,
                        ));
                    }
                    (_, e) => e,
                };
                Some((start, end))
            } else {
                return Err(AxiomError::new(
                    "RANGE_NOT_SATISFIABLE",
                    "Invalid Range header",
                    StatusCode::RANGE_NOT_SATISFIABLE,
                ));
            }
        } else {
            return Err(AxiomError::new(
                "RANGE_NOT_SATISFIABLE",
                "Invalid Range header",
                StatusCode::RANGE_NOT_SATISFIABLE,
            ));
        }
    } else {
        None
    };

    if let Some((start, end)) = parsed_range {
        let (meta, byte_range, data) = engine
            .get_range(&namespace, &key, start, end)
            .await
            .map_err(map_blob_error)?;

        let etag_val = format!("\"{}\"", meta.hash);
        let range_len = byte_range.length();
        let content_range = format!("bytes {}-{}/{}", byte_range.start, byte_range.end, byte_range.total);

        let response_builder = Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, meta.content_type)
            .header(header::CONTENT_LENGTH, range_len.to_string())
            .header(header::CONTENT_RANGE, content_range)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ETAG, etag_val)
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_DISPOSITION, disposition);

        return match data {
            BlobData::Inline(bytes) => {
                let body = Body::from(bytes);
                response_builder
                    .body(body)
                    .map_err(|e| AxiomError::new("RESPONSE_BUILD_FAILED", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))
            }
            BlobData::File(file, len) => {
                use tokio::io::AsyncReadExt;
                let stream = ReaderStream::new(file.take(len));
                let body = Body::from_stream(stream);
                response_builder
                    .body(body)
                    .map_err(|e| AxiomError::new("RESPONSE_BUILD_FAILED", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))
            }
        };
    }

    let (meta, data) = engine.get(&namespace, &key).await.map_err(map_blob_error)?;
    let etag_val = format!("\"{}\"", meta.hash);

    // Conditional GET: check If-None-Match for cache revalidation
    if let Some(inm) = headers.get(header::IF_NONE_MATCH).and_then(|h| h.to_str().ok()) {
        if inm.trim() == etag_val.as_str() || inm.trim() == meta.hash.as_str() {
            return Ok(StatusCode::NOT_MODIFIED.into_response());
        }
    }

    let response_builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, meta.content_type)
        .header(header::CONTENT_LENGTH, meta.size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ETAG, etag_val)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_DISPOSITION, disposition);

    match data {
        BlobData::Inline(bytes) => {
            let body = Body::from(bytes);
            response_builder
                .body(body)
                .map_err(|e| AxiomError::new("RESPONSE_BUILD_FAILED", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))
        }
        BlobData::File(file, len) => {
            use tokio::io::AsyncReadExt;
            let stream = ReaderStream::new(file.take(len));
            let body = Body::from_stream(stream);
            response_builder
                .body(body)
                .map_err(|e| AxiomError::new("RESPONSE_BUILD_FAILED", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))
        }
    }
}

/// Retrieves metadata only for a blob.
pub async fn head_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Response, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &key, "READ")?;

    let engine = get_blob_engine()?;
    let meta = engine.head(&namespace, &key).map_err(map_blob_error)?;

    let filename = key.rsplit(['/', '\\']).next().unwrap_or("blob.bin");
    let safe_filename: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    let disposition = format!("attachment; filename=\"{}\"", safe_filename);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, meta.content_type)
        .header(header::CONTENT_LENGTH, meta.size.to_string())
        .header(header::ETAG, format!("\"{}\"", meta.hash))
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::empty())
        .map_err(|e| AxiomError::new("RESPONSE_BUILD_FAILED", &e.to_string(), StatusCode::INTERNAL_SERVER_ERROR))
}

/// Deletes a blob from storage.
pub async fn delete_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &key, "DELETE")?;

    let engine = get_blob_engine()?;
    let deleted = engine.delete(&namespace, &key).await.map_err(map_blob_error)?;

    if !deleted {
        return Err(AxiomError::new(
            "BLOB_NOT_FOUND",
            &format!("Object '{}/{}' not found", namespace, key),
            StatusCode::NOT_FOUND,
        ));
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let target = format!("{}/{}", namespace, key);
    let _ = MetadataStore::record_audit(actor, "blob.delete", &target, None).await;

    Ok(Json(json!({
        "success": true,
        "data": { "deleted": true, "namespace": namespace, "key": key },
        "error": serde_json::Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct ListBlobsQuery {
    pub prefix: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

/// Lists objects within a namespace.
pub async fn list_blobs_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListBlobsQuery>,
) -> Result<impl IntoResponse, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, "*", "READ")?;

    let engine = get_blob_engine()?;
    let list_res = engine
        .list(
            &namespace,
            query.prefix.as_deref(),
            query.cursor.as_deref(),
            query.limit.unwrap_or(100),
        )
        .map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": list_res,
        "error": serde_json::Value::Null
    })))
}

/// Administrative storage telemetry handler.
pub async fn blob_stats_handler(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required to view storage telemetry",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let stats = engine.stats().map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": stats,
        "error": serde_json::Value::Null
    })))
}

#[derive(serde::Deserialize)]
pub struct CreateNamespaceRequest {
    pub name: String,
    pub max_bytes: Option<u64>,
}

#[derive(serde::Deserialize)]
pub struct UpdateNamespaceRequest {
    pub new_name: Option<String>,
    pub max_bytes: Option<Option<u64>>,
}

/// Administrative handler returning all configured storage namespaces with usage metrics.
pub async fn list_namespaces_handler(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required to list storage namespaces",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let namespaces = engine.list_namespaces_info().map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": namespaces,
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler creating a new storage namespace with an optional quota.
pub async fn create_namespace_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CreateNamespaceRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required to create storage namespaces",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let info = engine
        .create_namespace(&payload.name, payload.max_bytes)
        .map_err(map_blob_error)?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": info,
            "error": serde_json::Value::Null
        })),
    ))
}

/// Administrative handler updating an existing namespace quota or renaming it.
pub async fn update_namespace_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<UpdateNamespaceRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required to update storage namespaces",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let info = engine
        .update_namespace(&namespace, payload.new_name.as_deref(), payload.max_bytes)
        .map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": info,
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler permanently deleting a namespace and all stored objects inside it.
pub async fn delete_namespace_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required to delete storage namespaces",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let deleted_count = engine.delete_namespace(&namespace).await.map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": { "deleted_objects": deleted_count },
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler verifying cryptographic integrity of a blob against recorded BLAKE3 hash.
pub async fn verify_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required to verify object integrity",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let valid = engine.verify_integrity(&namespace, &key).await.map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": { "valid": valid },
        "error": serde_json::Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct CopyBlobRequest {
    pub src_namespace: String,
    pub src_key: String,
    pub dest_namespace: Option<String>,
    pub dest_key: String,
    pub is_prefix: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct MoveBlobRequest {
    pub src_namespace: String,
    pub src_key: String,
    pub dest_namespace: Option<String>,
    pub dest_key: String,
    pub is_prefix: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct DeletePrefixRequest {
    pub namespace: String,
    pub prefix: String,
}

/// Administrative handler copying an object or folder prefix.
pub async fn copy_blob_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CopyBlobRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let dest_ns = payload
        .dest_namespace
        .as_deref()
        .unwrap_or(&payload.src_namespace);

    if !auth.is_session {
        PolicyEngine::evaluate_blob(&auth, &payload.src_namespace, &payload.src_key, "READ")?;
        PolicyEngine::evaluate_blob(&auth, dest_ns, &payload.dest_key, "WRITE")?;
    }

    let engine = get_blob_engine()?;

    if payload.is_prefix.unwrap_or(false) {
        let count = engine
            .copy_prefix(
                &payload.src_namespace,
                &payload.src_key,
                dest_ns,
                &payload.dest_key,
            )
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.copy_prefix",
            &format!("{}/{} -> {}/{}", payload.src_namespace, payload.src_key, dest_ns, payload.dest_key),
            Some(&format!("copied_count={}", count)),
        )
        .await;

        Ok((
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": { "copied_count": count },
                "error": serde_json::Value::Null
            })),
        ))
    } else {
        let meta = engine
            .copy_blob(
                &payload.src_namespace,
                &payload.src_key,
                dest_ns,
                &payload.dest_key,
            )
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.copy",
            &format!("{}/{} -> {}/{}", payload.src_namespace, payload.src_key, dest_ns, payload.dest_key),
            Some(&format!("hash={}, size={}", meta.hash, meta.size)),
        )
        .await;

        Ok((
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": meta,
                "error": serde_json::Value::Null
            })),
        ))
    }
}

/// Administrative handler moving or renaming an object or folder prefix.
pub async fn move_blob_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<MoveBlobRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let dest_ns = payload
        .dest_namespace
        .as_deref()
        .unwrap_or(&payload.src_namespace);

    if !auth.is_session {
        PolicyEngine::evaluate_blob(&auth, &payload.src_namespace, &payload.src_key, "WRITE")?;
        PolicyEngine::evaluate_blob(&auth, dest_ns, &payload.dest_key, "WRITE")?;
    }

    let engine = get_blob_engine()?;

    if payload.is_prefix.unwrap_or(false) {
        let count = engine
            .move_prefix(
                &payload.src_namespace,
                &payload.src_key,
                dest_ns,
                &payload.dest_key,
            )
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.move_prefix",
            &format!("{}/{} -> {}/{}", payload.src_namespace, payload.src_key, dest_ns, payload.dest_key),
            Some(&format!("moved_count={}", count)),
        )
        .await;

        Ok((
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": { "moved_count": count },
                "error": serde_json::Value::Null
            })),
        ))
    } else {
        let meta = engine
            .move_blob(
                &payload.src_namespace,
                &payload.src_key,
                dest_ns,
                &payload.dest_key,
            )
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.move",
            &format!("{}/{} -> {}/{}", payload.src_namespace, payload.src_key, dest_ns, payload.dest_key),
            Some(&format!("hash={}, size={}", meta.hash, meta.size)),
        )
        .await;

        Ok((
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": meta,
                "error": serde_json::Value::Null
            })),
        ))
    }
}

/// Administrative handler deleting an entire directory/prefix.
pub async fn delete_prefix_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<DeletePrefixRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        PolicyEngine::evaluate_blob(&auth, &payload.namespace, &payload.prefix, "WRITE")?;
    }

    let engine = get_blob_engine()?;
    let count = engine
        .delete_prefix(&payload.namespace, &payload.prefix)
        .await
        .map_err(map_blob_error)?;

    let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.delete_prefix",
        &format!("{}/{}", payload.namespace, payload.prefix),
        Some(&format!("deleted_count={}", count)),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": { "deleted_objects": count },
        "error": serde_json::Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct CreateTicketRequest {
    pub key: String,
    pub operation: Option<String>,
    pub ttl_seconds: Option<u64>,
}

/// Generates a pre-signed cryptographic capability ticket URL for browser or client use.
pub async fn create_ticket_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CreateTicketRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let op_raw = payload.operation.as_deref().unwrap_or("READ");
    let op = axiom_blob::tickets::normalize_ticket_operation(op_raw).map_err(|e| {
        AxiomError::new("BAD_TICKET_OP", &e.to_string(), StatusCode::BAD_REQUEST)
    })?;
    PolicyEngine::evaluate_blob(&auth, &namespace, &payload.key, &op)?;

    let secret = axiom_blob::tickets::get_ticket_secret();

    let ttl = payload
        .ttl_seconds
        .unwrap_or(axiom_blob::tickets::DEFAULT_TICKET_TTL_SECS)
        .clamp(
            axiom_blob::tickets::MIN_TICKET_TTL_SECS,
            axiom_blob::tickets::MAX_TICKET_TTL_SECS,
        );
    let ticket = axiom_blob::generate_ticket(secret, &namespace, &payload.key, &op, ttl);

    let ticket_id = axiom_core::uuid7();
    let creator = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    if let Err(e) = MetadataStore::record_blob_ticket(
        &ticket_id,
        &namespace,
        &payload.key,
        &op,
        ticket.expires_at,
        &ticket.signature,
        creator,
    )
    .await
    {
        tracing::error!("Failed to record blob ticket in database: {}", e);
        return Err(AxiomError::new(
            "TICKET_RECORD_FAILED",
            &format!("Failed to record capability ticket: {}", e),
            StatusCode::INTERNAL_SERVER_ERROR,
        ));
    }

    let url = format!(
        "/api/v1/blobs/{}/{}?ticket_sig={}&ticket_exp={}",
        urlencoding::encode(&namespace),
        urlencoding::encode(&payload.key),
        ticket.signature,
        ticket.expires_at
    );

    let sig = ticket.signature.clone();
    let op_str = ticket.operation.clone();
    let exp = ticket.expires_at;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": {
                "ticket": ticket,
                "signature": sig,
                "operation": op_str,
                "expires_at": exp,
                "url": url,
            },
            "error": serde_json::Value::Null
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ListTicketsQuery {
    pub namespace: Option<String>,
    pub key: Option<String>,
    pub all: Option<bool>,
}

/// Administrative handler listing active or all capability tickets.
pub async fn list_tickets_handler(
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListTicketsQuery>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "AUTH_FORBIDDEN",
            "Listing capability tickets requires administrative access",
            StatusCode::FORBIDDEN,
        ));
    }

    let ns = query.namespace.as_deref().unwrap_or("*");
    let key = query.key.as_deref();
    // Default to true so active, revoked, and recently expired tickets are all returned to the dashboard
    let include_expired = query.all.unwrap_or(true);

    let tickets = MetadataStore::list_blob_tickets(ns, key, include_expired)
        .await
        .map_err(|e| AxiomError::new("TICKET_LIST_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    let formatted: Vec<_> = tickets
        .into_iter()
        .map(|t| {
            let url = format!(
                "/api/v1/blobs/{}/{}?ticket_sig={}&ticket_exp={}",
                urlencoding::encode(&t.namespace),
                urlencoding::encode(&t.key),
                t.signature,
                t.expires_at
            );
            json!({
                "id": t.id,
                "namespace": t.namespace,
                "key": t.key,
                "operation": t.operation,
                "expires_at": t.expires_at,
                "signature": t.signature,
                "created_by": t.created_by,
                "created_at": t.created_at,
                "revoked": t.revoked,
                "url": url,
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "data": formatted,
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler revoking a capability ticket immediately.
pub async fn revoke_ticket_handler(
    Path(signature_or_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "AUTH_FORBIDDEN",
            "Revoking capability tickets requires administrative access",
            StatusCode::FORBIDDEN,
        ));
    }

    let found = MetadataStore::revoke_blob_ticket(&signature_or_id)
        .await
        .map_err(|e| AxiomError::new("TICKET_REVOCATION_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found or already revoked",
            StatusCode::NOT_FOUND,
        ));
    }

    // Write instant revocation key to CacheEngine L1 RAM
    let cache_key = format!("ticket:revoked:{}", signature_or_id);
    axiom_cache::CacheEngine::set(
        &cache_key,
        bytes::Bytes::from_static(b"1"),
        86_400,
        axiom_cache::Durability::MemoryOnly,
    )
    .await;

    let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.ticket_revoked",
        &signature_or_id,
        Some("Capability ticket revoked"),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": { "revoked": true },
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler permanently deleting a capability ticket.
pub async fn delete_ticket_handler(
    Path(signature_or_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "AUTH_FORBIDDEN",
            "Deleting capability tickets requires administrative access",
            StatusCode::FORBIDDEN,
        ));
    }

    // Always invalidate in CacheEngine L1 RAM before deleting from SQLite
    let cache_key = format!("ticket:revoked:{}", signature_or_id);
    axiom_cache::CacheEngine::set(
        &cache_key,
        bytes::Bytes::from_static(b"1"),
        86_400,
        axiom_cache::Durability::MemoryOnly,
    )
    .await;

    let found = MetadataStore::delete_blob_ticket(&signature_or_id)
        .await
        .map_err(|e| AxiomError::new("TICKET_DELETE_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR))?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found",
            StatusCode::NOT_FOUND,
        ));
    }

    let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.ticket_deleted",
        &signature_or_id,
        Some("Capability ticket deleted and revoked"),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": { "deleted": true },
        "error": serde_json::Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct InitUploadRequest {
    pub key: String,
    pub content_type: Option<String>,
    pub ttl_seconds: Option<u64>,
}

/// Starts an asynchronous chunked upload session for large objects.
pub async fn init_upload_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<InitUploadRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &payload.key, "WRITE")?;

    let engine = get_blob_engine()?;
    let session = engine
        .init_chunked_upload(
            &namespace,
            &payload.key,
            payload.content_type.as_deref(),
            payload.ttl_seconds,
        )
        .await
        .map_err(map_blob_error)?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": session,
            "error": serde_json::Value::Null
        })),
    ))
}

/// Uploads an individual chunk part into an active upload session.
pub async fn put_part_handler(
    Path((namespace, upload_id, part)): Path<(String, String, u32)>,
    Extension(auth): Extension<AuthContext>,
    body: Bytes,
) -> Result<impl IntoResponse, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| AxiomError::new("UPLOAD_SESSION_NOT_FOUND", "Upload session not found", StatusCode::NOT_FOUND))?;

    if session.namespace != namespace {
        return Err(AxiomError::new("INVALID_NAMESPACE", "Upload session belongs to different namespace", StatusCode::BAD_REQUEST));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    engine
        .write_chunk(&upload_id, part, &body)
        .await
        .map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "upload_id": upload_id,
            "part": part,
            "size": body.len()
        },
        "error": serde_json::Value::Null
    })))
}

/// Completes a chunked upload by assembling parts and committing metadata.
pub async fn complete_upload_handler(
    Path((namespace, upload_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| AxiomError::new("UPLOAD_SESSION_NOT_FOUND", "Upload session not found", StatusCode::NOT_FOUND))?;

    if session.namespace != namespace {
        return Err(AxiomError::new("INVALID_NAMESPACE", "Upload session belongs to different namespace", StatusCode::BAD_REQUEST));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    let meta = engine
        .complete_chunked_upload(&upload_id)
        .await
        .map_err(map_blob_error)?;

    let actor = if auth.is_session { "admin" } else { &auth.api_key_name };
    let target = format!("{}/{}", namespace, session.key);
    let details = format!("hash={}, size={}, parts={}", meta.hash, meta.size, session.parts.len());
    let _ = MetadataStore::record_audit(actor, "blob.upload_complete", &target, Some(&details)).await;

    Ok(Json(json!({
        "success": true,
        "data": meta,
        "error": serde_json::Value::Null
    })))
}

/// Aborts an active chunked upload and purges staging data.
pub async fn abort_upload_handler(
    Path((namespace, upload_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| AxiomError::new("UPLOAD_SESSION_NOT_FOUND", "Upload session not found", StatusCode::NOT_FOUND))?;

    if session.namespace != namespace {
        return Err(AxiomError::new("INVALID_NAMESPACE", "Upload session belongs to different namespace", StatusCode::BAD_REQUEST));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    engine
        .abort_chunked_upload(&upload_id)
        .await
        .map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": { "aborted": upload_id },
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler performing storage-wide cryptographic integrity audit.
pub async fn scrub_blobs_handler(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new("FORBIDDEN", "Admin session required for integrity scrubbing", StatusCode::FORBIDDEN));
    }

    let engine = get_blob_engine()?;
    let (verified, corrupted) = engine.scrub_all().await.map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "verified_blobs": verified,
            "corrupted_blobs": corrupted,
        },
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler triggering automatic cleanup of expired objects (TTL sweep).
pub async fn sweep_expired_handler(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session {
        return Err(AxiomError::new("FORBIDDEN", "Admin session required for TTL sweep", StatusCode::FORBIDDEN));
    }

    let engine = get_blob_engine()?;
    let count = engine.sweep_expired().await.map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": {
            "swept_objects": count,
        },
        "error": serde_json::Value::Null
    })))
}


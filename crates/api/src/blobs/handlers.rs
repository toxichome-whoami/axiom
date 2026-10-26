/*
 * Axum HTTP request handlers for native embedded blob storage operations.
 * Owned by: api/blobs
 * Key deps: axum, bytes, axiom-blob, axiom-policy, axiom-metadata
 * Invariants: PolicyEngine evaluates permissions before data access; security headers attached to all blob downloads.
 * Last structural change: Initial implementation of Phase 1-3 Blob Engine API.
 */

use crate::blobs::get_blob_engine;
use axiom_blob::{BlobData, BlobError};
use axiom_core::{AuthContext, AxiomError};
use axiom_metadata::MetadataStore;
use axiom_policy::PolicyEngine;
use axum::{
    body::Body,
    extract::{Extension, Path, Query, RawQuery},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bytes::Bytes;
use futures::TryStreamExt;
use serde::Deserialize;
use serde_json::json;
use tokio_util::io::{ReaderStream, StreamReader};

/// High-throughput 128 KB async buffer size for blob streaming (video, audio, downloads).
/// Reduces syscalls, Tokio wakeups, and TCP window starvation by ~16x compared to default 8 KB chunks.
const STREAM_CHUNK_BUFFER_SIZE: usize = 128 * 1024;

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
        BlobError::OffsetMismatch { expected, actual } => AxiomError::new(
            "UPLOAD_OFFSET_MISMATCH",
            &format!("Upload offset mismatch: expected offset {}, but received {}", expected, actual),
            StatusCode::CONFLICT,
        ),
        BlobError::InsufficientStorage(msg) => AxiomError::new(
            "INSUFFICIENT_STORAGE",
            &format!("Host filesystem out of disk space: {}", msg),
            StatusCode::INSUFFICIENT_STORAGE,
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
    body: Body,
) -> Result<impl IntoResponse, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &key, "WRITE")?;

    let engine = get_blob_engine()?;

    // Fast-path header pre-flight verification:
    // If client supplied Content-Length, validate against maximum object limit and namespace quota headroom
    // upfront to reject oversized requests immediately in 0 ms without consuming socket buffers or disk I/O.
    if let Some(content_length) = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
    {
        if content_length > engine.max_object_bytes() {
            return Err(AxiomError::new(
                "PAYLOAD_TOO_LARGE",
                &format!(
                    "Payload size {} exceeds allowed max of {} bytes",
                    content_length,
                    engine.max_object_bytes()
                ),
                StatusCode::PAYLOAD_TOO_LARGE,
            ));
        }

        if let Ok(Some(ns_info)) = engine.get_namespace(&namespace) {
            if let Some(max_quota) = ns_info.max_bytes {
                let existing_size = engine.head(&namespace, &key).map(|m| m.size).unwrap_or(0);
                let net_bytes = ns_info.total_bytes.saturating_sub(existing_size);
                if net_bytes + content_length > max_quota {
                    return Err(AxiomError::new(
                        "QUOTA_EXCEEDED",
                        &format!(
                            "Namespace '{}' storage quota exceeded (current: {} B, requested: {} B, quota: {} B)",
                            namespace, net_bytes, content_length, max_quota
                        ),
                        StatusCode::INSUFFICIENT_STORAGE,
                    ));
                }
            }
        }
    }

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("application/octet-stream");

    let ttl_seconds = headers
        .get("X-Axiom-TTL")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    // Extract custom user metadata headers (X-Axiom-Meta-* or x-amz-meta-*)
    let mut custom_metadata = std::collections::HashMap::new();
    for (hdr_name, hdr_val) in headers.iter() {
        let name_lower = hdr_name.as_str().to_ascii_lowercase();
        if let Some(key_suffix) = name_lower
            .strip_prefix("x-axiom-meta-")
            .or_else(|| name_lower.strip_prefix("x-amz-meta-"))
        {
            if let Ok(val_str) = hdr_val.to_str() {
                custom_metadata.insert(key_suffix.to_string(), val_str.to_string());
            }
        }
    }
    let custom_opt = if custom_metadata.is_empty() {
        None
    } else {
        Some(custom_metadata)
    };

    let stream = body.into_data_stream().map_err(std::io::Error::other);
    let mut reader = StreamReader::new(stream);

    let meta = engine
        .put_stream(
            &namespace,
            &key,
            Some(content_type),
            &mut reader,
            ttl_seconds,
            custom_opt,
        )
        .await
        .map_err(map_blob_error)?;

    // Audit logging for write mutation
    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let target = format!("{}/{}", namespace, key);
    let details = format!(
        "hash={}, size={}, inline={}",
        meta.hash, meta.size, meta.inline
    );
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
///  - Enforces: `nosniff`, `attachment` disposition by default (or `inline` when requested via `inline=1`), ETag calculation.
pub async fn get_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    RawQuery(raw_query): RawQuery,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
) -> Result<Response, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &key, "READ")?;

    let engine = get_blob_engine()?;

    // 1. Fetch metadata first to evaluate conditional caching and validators before reading body
    let meta = engine.head(&namespace, &key).map_err(map_blob_error)?;
    let etag_val = format!("\"{}\"", meta.hash);
    let last_modified =
        chrono::DateTime::from_timestamp(meta.created_at, 0).map(|dt| dt.to_rfc2822());

    // 2. Conditional GET: check If-None-Match for cache revalidation
    if let Some(inm) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|h| h.to_str().ok())
    {
        if inm.trim() == etag_val.as_str() || inm.trim() == meta.hash.as_str() {
            let mut res_builder = Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::ETAG, &etag_val);
            if let Some(ref lm) = last_modified {
                res_builder = res_builder.header(header::LAST_MODIFIED, lm.as_str());
            }
            return res_builder.body(Body::empty()).map_err(|e| {
                AxiomError::new(
                    "RESPONSE_BUILD_FAILED",
                    &e.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            });
        }
    }

    // 3. Conditional GET: check If-Modified-Since
    if let Some(ims) = headers
        .get(header::IF_MODIFIED_SINCE)
        .and_then(|h| h.to_str().ok())
    {
        if let Ok(client_time) = chrono::DateTime::parse_from_rfc2822(ims) {
            if meta.created_at <= client_time.timestamp() {
                let mut res_builder = Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header(header::ETAG, &etag_val);
                if let Some(ref lm) = last_modified {
                    res_builder = res_builder.header(header::LAST_MODIFIED, lm.as_str());
                }
                return res_builder.body(Body::empty()).map_err(|e| {
                    AxiomError::new(
                        "RESPONSE_BUILD_FAILED",
                        &e.to_string(),
                        StatusCode::INTERNAL_SERVER_ERROR,
                    )
                });
            }
        }
    }

    // Determine filename for safe Content-Disposition
    let filename = key.rsplit(['/', '\\']).next().unwrap_or("blob.bin");
    let safe_filename: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    // Check if inline disposition is explicitly requested (e.g. video/audio streaming or preview)
    let is_inline = raw_query
        .as_deref()
        .map(|q| q.contains("inline=1") || q.contains("inline=true"))
        .unwrap_or(false);

    // SECURITY (SEC-3.2 / XSS): Active or executable file formats (HTML, SVG, XML, scripts)
    // MUST NEVER be rendered inline in the browser origin to prevent stored XSS attacks.
    let is_dangerous_type = meta.content_type.contains("html")
        || meta.content_type.contains("xml")
        || meta.content_type.contains("svg")
        || meta.content_type.contains("javascript")
        || meta.content_type.contains("json")
        || meta.content_type.contains("x-sh")
        || meta.content_type.contains("x-executable");

    let is_safe_media = !is_dangerous_type
        && (meta.content_type.starts_with("video/")
            || meta.content_type.starts_with("audio/")
            || (meta.content_type.starts_with("image/") && !meta.content_type.contains("svg")));

    let is_media = is_safe_media || (is_inline && !is_dangerous_type);

    let disposition = if is_media {
        format!("inline; filename=\"{}\"", safe_filename)
    } else {
        format!("attachment; filename=\"{}\"", safe_filename)
    };

    let cache_control = if is_media {
        "public, max-age=86400, stale-while-revalidate=604800"
    } else {
        "public, max-age=3600, must-revalidate"
    };

    // 4. RFC 9110 §13.1.2: If-Range validator check
    let if_range_matches =
        if let Some(ir) = headers.get(header::IF_RANGE).and_then(|h| h.to_str().ok()) {
            let ir = ir.trim();
            ir == etag_val || ir == meta.hash || last_modified.as_deref() == Some(ir)
        } else {
            true
        };

    // Check for HTTP Range header. Max single range: 256 MB (bandwidth/DoS cap, L-fix).
    const MAX_RANGE_BYTES: u64 = 256 * 1024 * 1024;
    let range_hdr = headers.get(header::RANGE).and_then(|h| h.to_str().ok());
    let parsed_range = if range_hdr.is_some() && !if_range_matches {
        // RFC 9110: If If-Range validator does not match current representation, ignore Range and serve entire 200 OK
        None
    } else if let Some(r) = range_hdr {
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
                    let start = meta.size.saturating_sub(suffix);
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

        let range_len = byte_range.length();
        let content_range = format!(
            "bytes {}-{}/{}",
            byte_range.start, byte_range.end, byte_range.total
        );

        let mut response_builder = Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, meta.content_type)
            .header(header::CONTENT_LENGTH, range_len.to_string())
            .header(header::CONTENT_RANGE, content_range)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ETAG, etag_val)
            .header(header::CACHE_CONTROL, cache_control)
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_DISPOSITION, disposition.clone())
            .header(
                header::CONTENT_SECURITY_POLICY,
                if is_media {
                    "default-src 'none'; media-src 'self' * blob: data:; img-src 'self' * blob: data:; style-src 'unsafe-inline'; font-src 'self' data:;"
                } else {
                    "default-src 'none'; frame-ancestors 'none';"
                },
            );

        if let Some(ref lm) = last_modified {
            response_builder = response_builder.header(header::LAST_MODIFIED, lm.as_str());
        }

        return match data {
            BlobData::Inline(bytes) => {
                let body = Body::from(bytes);
                response_builder.body(body).map_err(|e| {
                    AxiomError::new(
                        "RESPONSE_BUILD_FAILED",
                        &e.to_string(),
                        StatusCode::INTERNAL_SERVER_ERROR,
                    )
                })
            }
            BlobData::File(file, len) => {
                use tokio::io::AsyncReadExt;
                let stream = ReaderStream::with_capacity(file.take(len), STREAM_CHUNK_BUFFER_SIZE);
                let body = Body::from_stream(stream);
                response_builder.body(body).map_err(|e| {
                    AxiomError::new(
                        "RESPONSE_BUILD_FAILED",
                        &e.to_string(),
                        StatusCode::INTERNAL_SERVER_ERROR,
                    )
                })
            }
        };
    }

    let (meta, data) = engine.get(&namespace, &key).await.map_err(map_blob_error)?;

    let mut response_builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, meta.content_type)
        .header(header::CONTENT_LENGTH, meta.size.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ETAG, etag_val)
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(
            header::CONTENT_SECURITY_POLICY,
            if is_media {
                "default-src 'none'; media-src 'self' * blob: data:; img-src 'self' * blob: data:; style-src 'unsafe-inline'; font-src 'self' data:;"
            } else {
                "default-src 'none'; frame-ancestors 'none';"
            },
        );

    if let Some(ref lm) = last_modified {
        response_builder = response_builder.header(header::LAST_MODIFIED, lm.as_str());
    }

    match data {
        BlobData::Inline(bytes) => {
            let body = Body::from(bytes);
            response_builder.body(body).map_err(|e| {
                AxiomError::new(
                    "RESPONSE_BUILD_FAILED",
                    &e.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })
        }
        BlobData::File(file, len) => {
            use tokio::io::AsyncReadExt;
            let stream = ReaderStream::with_capacity(file.take(len), STREAM_CHUNK_BUFFER_SIZE);
            let body = Body::from_stream(stream);
            response_builder.body(body).map_err(|e| {
                AxiomError::new(
                    "RESPONSE_BUILD_FAILED",
                    &e.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })
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
        .map_err(|e| {
            AxiomError::new(
                "RESPONSE_BUILD_FAILED",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

/// Deletes a blob from storage.
pub async fn delete_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &key, "DELETE")?;

    let engine = get_blob_engine()?;
    let deleted = engine
        .delete(&namespace, &key)
        .await
        .map_err(map_blob_error)?;

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
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required to view storage telemetry",
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
    pub is_public: Option<bool>,
}

#[derive(serde::Deserialize)]
pub struct UpdateNamespaceRequest {
    pub new_name: Option<String>,
    pub max_bytes: Option<Option<u64>>,
    pub is_public: Option<bool>,
    pub cors_origins: Option<Vec<String>>,
}

/// Lists storage namespaces with usage metrics. Admin sees all namespaces; API keys see authorized namespaces.
pub async fn list_namespaces_handler(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    let engine = get_blob_engine()?;
    let namespaces = engine.list_namespaces_info().map_err(map_blob_error)?;

    let filtered = if auth.is_session || auth.role.as_deref() == Some("admin") {
        namespaces
    } else {
        namespaces
            .into_iter()
            .filter(|ns| {
                PolicyEngine::evaluate_blob(&auth, &ns.name, "*", "READ").is_ok()
                    || PolicyEngine::evaluate_blob(&auth, &ns.name, "*", "WRITE").is_ok()
            })
            .collect()
    };

    Ok(Json(json!({
        "success": true,
        "data": filtered,
        "error": serde_json::Value::Null
    })))
}

/// Handler returning storage quota, used bytes, space left, and object count for a namespace.
pub async fn get_namespace_usage_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, "*", "READ")?;
    }

    let engine = get_blob_engine()?;
    let info = engine
        .get_namespace(&namespace)
        .map_err(map_blob_error)?
        .ok_or_else(|| {
            AxiomError::new(
                "NAMESPACE_NOT_FOUND",
                &format!("Namespace '{}' not found", namespace),
                StatusCode::NOT_FOUND,
            )
        })?;

    let max_bytes = info.max_bytes;
    let used_bytes = info.total_bytes;
    let remaining_bytes = max_bytes.map(|max| max.saturating_sub(used_bytes));
    let percent_used = max_bytes.map(|max| {
        if max > 0 {
            ((used_bytes as f64 / max as f64) * 100.0).min(100.0)
        } else {
            0.0
        }
    });
    let is_quota_exceeded = max_bytes.map(|max| used_bytes >= max).unwrap_or(false);

    Ok(Json(json!({
        "success": true,
        "data": {
            "namespace": info.name,
            "created_at": info.created_at,
            "is_public": info.is_public,
            "max_bytes": max_bytes,
            "used_bytes": used_bytes,
            "remaining_bytes": remaining_bytes,
            "percent_used": percent_used,
            "total_objects": info.total_objects,
            "is_quota_exceeded": is_quota_exceeded,
        },
        "error": serde_json::Value::Null
    })))
}

/// Handler returning detailed metadata for a specific storage namespace.
pub async fn get_namespace_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, "*", "READ")?;
    }

    let engine = get_blob_engine()?;
    let info = engine
        .get_namespace(&namespace)
        .map_err(map_blob_error)?
        .ok_or_else(|| {
            AxiomError::new(
                "NAMESPACE_NOT_FOUND",
                &format!("Namespace '{}' not found", namespace),
                StatusCode::NOT_FOUND,
            )
        })?;

    Ok(Json(json!({
        "success": true,
        "data": info,
        "error": serde_json::Value::Null
    })))
}

/// Administrative handler creating a new storage namespace with an optional quota.
pub async fn create_namespace_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CreateNamespaceRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required to create storage namespaces",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let info = engine
        .create_namespace(
            &payload.name,
            payload.max_bytes,
            payload.is_public.unwrap_or(false),
        )
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

/// Administrative handler updating an existing namespace quota, public status, CORS, or renaming it.
pub async fn update_namespace_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<UpdateNamespaceRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required to update storage namespaces",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let info = engine
        .update_namespace(
            &namespace,
            payload.new_name.as_deref(),
            payload.max_bytes,
            payload.is_public,
            payload.cors_origins,
        )
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
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin privileges required to delete storage namespaces",
            StatusCode::FORBIDDEN,
        ));
    }

    let engine = get_blob_engine()?;
    let deleted_count = engine
        .delete_namespace(&namespace)
        .await
        .map_err(map_blob_error)?;

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
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, &key, "READ")?;
    }

    let engine = get_blob_engine()?;
    let valid = engine
        .verify_integrity(&namespace, &key)
        .await
        .map_err(map_blob_error)?;

    Ok(Json(json!({
        "success": true,
        "data": { "valid": valid },
        "error": serde_json::Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct CopyBlobRequest {
    pub src_namespace: Option<String>,
    pub src_key: String,
    pub dest_namespace: Option<String>,
    pub dest_key: String,
    pub is_prefix: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct MoveBlobRequest {
    pub src_namespace: Option<String>,
    pub src_key: String,
    pub dest_namespace: Option<String>,
    pub dest_key: String,
    pub is_prefix: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct DeletePrefixRequest {
    pub namespace: Option<String>,
    pub prefix: String,
}

/// Handler copying an object or folder prefix.
pub async fn copy_blob_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CopyBlobRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let src_ns = payload.src_namespace.as_deref().ok_or_else(|| {
        AxiomError::new(
            "MISSING_NAMESPACE",
            "src_namespace must be provided in request payload or route path",
            StatusCode::BAD_REQUEST,
        )
    })?;
    let dest_ns = payload.dest_namespace.as_deref().unwrap_or(src_ns);

    if !auth.is_session {
        PolicyEngine::evaluate_blob(&auth, src_ns, &payload.src_key, "READ")?;
        PolicyEngine::evaluate_blob(&auth, dest_ns, &payload.dest_key, "WRITE")?;
    }

    let engine = get_blob_engine()?;

    if payload.is_prefix.unwrap_or(false) {
        let count = engine
            .copy_prefix(src_ns, &payload.src_key, dest_ns, &payload.dest_key)
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session {
            "admin"
        } else {
            &auth.api_key_name
        };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.copy_prefix",
            &format!(
                "{}/{} -> {}/{}",
                src_ns, payload.src_key, dest_ns, payload.dest_key
            ),
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
            .copy_blob(src_ns, &payload.src_key, dest_ns, &payload.dest_key)
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session {
            "admin"
        } else {
            &auth.api_key_name
        };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.copy",
            &format!(
                "{}/{} -> {}/{}",
                src_ns, payload.src_key, dest_ns, payload.dest_key
            ),
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

pub async fn move_blob_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<MoveBlobRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let src_ns = payload.src_namespace.as_deref().ok_or_else(|| {
        AxiomError::new(
            "MISSING_NAMESPACE",
            "src_namespace must be provided in request payload or route path",
            StatusCode::BAD_REQUEST,
        )
    })?;
    let dest_ns = payload.dest_namespace.as_deref().unwrap_or(src_ns);

    if !auth.is_session {
        PolicyEngine::evaluate_blob(&auth, src_ns, &payload.src_key, "WRITE")?;
        PolicyEngine::evaluate_blob(&auth, dest_ns, &payload.dest_key, "WRITE")?;
    }

    let engine = get_blob_engine()?;

    if payload.is_prefix.unwrap_or(false) {
        let count = engine
            .move_prefix(src_ns, &payload.src_key, dest_ns, &payload.dest_key)
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session {
            "admin"
        } else {
            &auth.api_key_name
        };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.move_prefix",
            &format!(
                "{}/{} -> {}/{}",
                src_ns, payload.src_key, dest_ns, payload.dest_key
            ),
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
            .move_blob(src_ns, &payload.src_key, dest_ns, &payload.dest_key)
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session {
            "admin"
        } else {
            &auth.api_key_name
        };
        let _ = MetadataStore::record_audit(
            actor,
            "blob.move",
            &format!(
                "{}/{} -> {}/{}",
                src_ns, payload.src_key, dest_ns, payload.dest_key
            ),
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

/// Scoped handler for copying an object or prefix via /objects/:namespace/copy.
pub async fn copy_blob_scoped_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(mut payload): Json<CopyBlobRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if payload.src_namespace.is_none() {
        payload.src_namespace = Some(namespace);
    }
    copy_blob_handler(Extension(auth), Json(payload)).await
}

/// Scoped handler for moving or renaming an object or prefix via /objects/:namespace/move.
pub async fn move_blob_scoped_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(mut payload): Json<MoveBlobRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if payload.src_namespace.is_none() {
        payload.src_namespace = Some(namespace);
    }
    move_blob_handler(Extension(auth), Json(payload)).await
}

/// Handler deleting an entire directory/prefix.
pub async fn delete_prefix_handler(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<DeletePrefixRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    let ns = payload.namespace.as_deref().ok_or_else(|| {
        AxiomError::new(
            "MISSING_NAMESPACE",
            "namespace must be provided in request payload or route path",
            StatusCode::BAD_REQUEST,
        )
    })?;

    if !auth.is_session {
        PolicyEngine::evaluate_blob(&auth, ns, &payload.prefix, "WRITE")?;
    }

    let engine = get_blob_engine()?;
    let count = engine
        .delete_prefix(ns, &payload.prefix)
        .await
        .map_err(map_blob_error)?;

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.delete_prefix",
        &format!("{}/{}", ns, payload.prefix),
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
    let op = axiom_blob::tickets::normalize_ticket_operation(op_raw)
        .map_err(|e| AxiomError::new("BAD_TICKET_OP", &e.to_string(), StatusCode::BAD_REQUEST))?;
    PolicyEngine::evaluate_blob(&auth, &namespace, &payload.key, &op)?;

    // Public namespaces do not support/require capability tickets for reading; public CDN URLs must be used.
    let engine = get_blob_engine()?;
    if engine
        .is_namespace_public(&namespace)
        .map_err(map_blob_error)?
        && op == "READ"
    {
        return Err(AxiomError::new(
            "PUBLIC_NAMESPACE_TICKET_DISABLED",
            &format!(
                "Namespace '{}' is public. Capability tickets are disabled for public namespaces; access objects directly via the public CDN endpoint (/api/v1/blobs/public/{}/...).",
                namespace, namespace
            ),
            StatusCode::BAD_REQUEST,
        ));
    }

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
        if !auth.api_key_name.is_empty() {
            &auth.api_key_name
        } else {
            "admin"
        }
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

    let _ = MetadataStore::record_audit(
        creator,
        "blob.ticket_created",
        &format!("{}/{}", namespace, payload.key),
        Some(&format!("op={}, expires_at={}", op, ticket.expires_at)),
    )
    .await;

    let url = format!(
        "/api/v1/blobs/objects/{}/{}?ticket_sig={}&ticket_exp={}",
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
pub struct CreateUploadLinkRequest {
    pub key: String,
    pub content_type: Option<String>,
    pub ttl_seconds: Option<u64>,
}

/// Generates a pre-signed capability upload URL for direct browser or client upload.
pub async fn create_upload_link_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<CreateUploadLinkRequest>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, &payload.key, "WRITE")?;
    }

    let secret = axiom_blob::tickets::get_ticket_secret();
    let ttl = payload
        .ttl_seconds
        .unwrap_or(axiom_blob::tickets::DEFAULT_TICKET_TTL_SECS)
        .clamp(
            axiom_blob::tickets::MIN_TICKET_TTL_SECS,
            axiom_blob::tickets::MAX_TICKET_TTL_SECS,
        );

    let ticket = axiom_blob::generate_ticket(secret, &namespace, &payload.key, "WRITE", ttl);
    let ticket_id = axiom_core::uuid7();
    let creator = if auth.is_session {
        if !auth.api_key_name.is_empty() {
            &auth.api_key_name
        } else {
            "admin"
        }
    } else {
        &auth.api_key_name
    };

    if let Err(e) = MetadataStore::record_blob_ticket(
        &ticket_id,
        &namespace,
        &payload.key,
        "WRITE",
        ticket.expires_at,
        &ticket.signature,
        creator,
    )
    .await
    {
        tracing::error!(
            "Failed to record upload capability ticket in database: {}",
            e
        );
        return Err(AxiomError::new(
            "TICKET_RECORD_FAILED",
            &format!("Failed to record capability ticket: {}", e),
            StatusCode::INTERNAL_SERVER_ERROR,
        ));
    }

    let _ = MetadataStore::record_audit(
        creator,
        "blob.upload_link_created",
        &format!("{}/{}", namespace, payload.key),
        Some(&format!("expires_at={}", ticket.expires_at)),
    )
    .await;

    let url = format!(
        "/api/v1/blobs/objects/{}/{}?ticket_sig={}&ticket_exp={}",
        urlencoding::encode(&namespace),
        urlencoding::encode(&payload.key),
        ticket.signature,
        ticket.expires_at
    );

    let mut headers = serde_json::Map::new();
    if let Some(ct) = payload.content_type {
        headers.insert("Content-Type".to_string(), serde_json::Value::String(ct));
    }

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "success": true,
            "data": {
                "url": url,
                "method": "PUT",
                "headers": headers,
                "expires_at": ticket.expires_at,
                "signature": ticket.signature
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
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

/// Administrative handler listing active or all capability tickets across the cluster with keyset pagination.
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
    let cursor = query.cursor.as_deref();
    let limit = query.limit;

    let (tickets, next_cursor) =
        MetadataStore::list_blob_tickets(ns, key, include_expired, cursor, limit)
            .await
            .map_err(|e| {
                AxiomError::new("TICKET_LIST_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR)
            })?;

    let formatted: Vec<_> = tickets
        .into_iter()
        .map(|t| {
            let url = format!(
                "/api/v1/blobs/objects/{}/{}?ticket_sig={}&ticket_exp={}",
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
        "data": {
            "items": formatted,
            "next_cursor": next_cursor
        },
        "error": serde_json::Value::Null
    })))
}

/// Handler listing capability tickets scoped to a specific namespace with keyset pagination.
pub async fn list_namespace_tickets_handler(
    Path(namespace): Path<String>,
    Query(query): Query<ListTicketsQuery>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, "*", "READ")?;
    }

    let key = query.key.as_deref();
    let include_expired = query.all.unwrap_or(true);
    let cursor = query.cursor.as_deref();
    let limit = query.limit;

    let (tickets, next_cursor) =
        MetadataStore::list_blob_tickets(&namespace, key, include_expired, cursor, limit)
            .await
            .map_err(|e| {
                AxiomError::new("TICKET_LIST_FAILED", &e, StatusCode::INTERNAL_SERVER_ERROR)
            })?;

    let formatted: Vec<_> = tickets
        .into_iter()
        .map(|t| {
            let url = format!(
                "/api/v1/blobs/objects/{}/{}?ticket_sig={}&ticket_exp={}",
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
        "data": {
            "items": formatted,
            "next_cursor": next_cursor
        },
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

    // Find the exact ticket signature before revoking in SQLite
    let ticket_sig = MetadataStore::find_blob_ticket_signature(&signature_or_id)
        .await
        .unwrap_or(None);

    let found = MetadataStore::revoke_blob_ticket(&signature_or_id)
        .await
        .map_err(|e| {
            AxiomError::new(
                "TICKET_REVOCATION_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found or already revoked",
            StatusCode::NOT_FOUND,
        ));
    }

    // Write instant revocation key to CacheEngine L1 RAM for both ID and cryptographic signature
    let mut sigs_to_invalidate = vec![signature_or_id.clone()];
    if let Some(ref s) = ticket_sig {
        if s != &signature_or_id {
            sigs_to_invalidate.push(s.clone());
        }
    }
    for s in &sigs_to_invalidate {
        axiom_cache::CacheEngine::delete(&format!("ticket:valid:{}", s)).await;
        axiom_cache::CacheEngine::set(
            &format!("ticket:revoked:{}", s),
            bytes::Bytes::from_static(b"1"),
            86_400,
            axiom_cache::Durability::MemoryOnly,
        )
        .await;
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
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

/// Administrative handler re-enabling a revoked capability ticket.
pub async fn enable_ticket_handler(
    Path(signature_or_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        return Err(AxiomError::new(
            "AUTH_FORBIDDEN",
            "Enabling capability tickets requires administrative access",
            StatusCode::FORBIDDEN,
        ));
    }

    // Find the exact ticket signature before enabling in SQLite
    let ticket_sig = MetadataStore::find_blob_ticket_signature(&signature_or_id)
        .await
        .unwrap_or(None);

    let found = MetadataStore::enable_blob_ticket(&signature_or_id)
        .await
        .map_err(|e| {
            AxiomError::new(
                "TICKET_ENABLE_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found or already active",
            StatusCode::NOT_FOUND,
        ));
    }

    // Clear revocation tombstone from CacheEngine L1 RAM for both ID and cryptographic signature
    let mut sigs_to_clear = vec![signature_or_id.clone()];
    if let Some(ref s) = ticket_sig {
        if s != &signature_or_id {
            sigs_to_clear.push(s.clone());
        }
    }
    for s in &sigs_to_clear {
        axiom_cache::CacheEngine::delete(&format!("ticket:revoked:{}", s)).await;
        axiom_cache::CacheEngine::delete(&format!("ticket:valid:{}", s)).await;
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.ticket_enabled",
        &signature_or_id,
        Some("Capability ticket re-enabled"),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": { "revoked": false },
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

    // Find the exact ticket signature before deleting from SQLite
    let ticket_sig = MetadataStore::find_blob_ticket_signature(&signature_or_id)
        .await
        .unwrap_or(None);

    // Invalidate in CacheEngine L1 RAM for both ID and cryptographic signature
    let mut sigs_to_invalidate = vec![signature_or_id.clone()];
    if let Some(ref s) = ticket_sig {
        if s != &signature_or_id {
            sigs_to_invalidate.push(s.clone());
        }
    }
    for s in &sigs_to_invalidate {
        axiom_cache::CacheEngine::delete(&format!("ticket:valid:{}", s)).await;
        axiom_cache::CacheEngine::set(
            &format!("ticket:revoked:{}", s),
            bytes::Bytes::from_static(b"1"),
            86_400,
            axiom_cache::Durability::MemoryOnly,
        )
        .await;
    }

    let found = MetadataStore::delete_blob_ticket(&signature_or_id)
        .await
        .map_err(|e| {
            AxiomError::new(
                "TICKET_DELETE_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found",
            StatusCode::NOT_FOUND,
        ));
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
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

/// Scoped handler for revoking a capability ticket within a specific namespace via /tickets/:namespace/:signature/revoke.
pub async fn revoke_ticket_scoped_handler(
    Path((namespace, signature_or_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, "*", "WRITE")?;
    }

    let ticket_sig = MetadataStore::find_blob_ticket_signature_scoped(&namespace, &signature_or_id)
        .await
        .unwrap_or(None);

    let found = MetadataStore::revoke_blob_ticket_scoped(&namespace, &signature_or_id)
        .await
        .map_err(|e| {
            AxiomError::new(
                "TICKET_REVOCATION_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found or already revoked in this namespace",
            StatusCode::NOT_FOUND,
        ));
    }

    let mut sigs_to_invalidate = vec![signature_or_id.clone()];
    if let Some(ref s) = ticket_sig {
        if s != &signature_or_id {
            sigs_to_invalidate.push(s.clone());
        }
    }
    for s in &sigs_to_invalidate {
        axiom_cache::CacheEngine::delete(&format!("ticket:valid:{}", s)).await;
        axiom_cache::CacheEngine::set(
            &format!("ticket:revoked:{}", s),
            bytes::Bytes::from_static(b"1"),
            86_400,
            axiom_cache::Durability::MemoryOnly,
        )
        .await;
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.ticket_revoked",
        &format!("{}/{}", namespace, signature_or_id),
        Some("Capability ticket revoked in namespace"),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": { "revoked": true, "namespace": namespace },
        "error": serde_json::Value::Null
    })))
}

/// Scoped handler for re-enabling a revoked capability ticket within a specific namespace via /tickets/:namespace/:signature/enable.
pub async fn enable_ticket_scoped_handler(
    Path((namespace, signature_or_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, "*", "WRITE")?;
    }

    let ticket_sig = MetadataStore::find_blob_ticket_signature_scoped(&namespace, &signature_or_id)
        .await
        .unwrap_or(None);

    let found = MetadataStore::enable_blob_ticket_scoped(&namespace, &signature_or_id)
        .await
        .map_err(|e| {
            AxiomError::new(
                "TICKET_ENABLE_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found or already active in this namespace",
            StatusCode::NOT_FOUND,
        ));
    }

    let mut sigs_to_clear = vec![signature_or_id.clone()];
    if let Some(ref s) = ticket_sig {
        if s != &signature_or_id {
            sigs_to_clear.push(s.clone());
        }
    }
    for s in &sigs_to_clear {
        axiom_cache::CacheEngine::delete(&format!("ticket:revoked:{}", s)).await;
        axiom_cache::CacheEngine::delete(&format!("ticket:valid:{}", s)).await;
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.ticket_enabled",
        &format!("{}/{}", namespace, signature_or_id),
        Some("Capability ticket re-enabled in namespace"),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": { "revoked": false, "namespace": namespace },
        "error": serde_json::Value::Null
    })))
}

/// Scoped handler for permanently deleting a capability ticket within a specific namespace via DELETE /tickets/:namespace/:signature.
pub async fn delete_ticket_scoped_handler(
    Path((namespace, signature_or_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.is_session && auth.role.as_deref() != Some("admin") {
        PolicyEngine::evaluate_blob(&auth, &namespace, "*", "WRITE")?;
    }

    let ticket_sig = MetadataStore::find_blob_ticket_signature_scoped(&namespace, &signature_or_id)
        .await
        .unwrap_or(None);

    let mut sigs_to_invalidate = vec![signature_or_id.clone()];
    if let Some(ref s) = ticket_sig {
        if s != &signature_or_id {
            sigs_to_invalidate.push(s.clone());
        }
    }
    for s in &sigs_to_invalidate {
        axiom_cache::CacheEngine::delete(&format!("ticket:valid:{}", s)).await;
        axiom_cache::CacheEngine::set(
            &format!("ticket:revoked:{}", s),
            bytes::Bytes::from_static(b"1"),
            86_400,
            axiom_cache::Durability::MemoryOnly,
        )
        .await;
    }

    let found = MetadataStore::delete_blob_ticket_scoped(&namespace, &signature_or_id)
        .await
        .map_err(|e| {
            AxiomError::new(
                "TICKET_DELETE_FAILED",
                &e,
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    if !found {
        return Err(AxiomError::new(
            "NOT_FOUND",
            "Capability ticket not found in this namespace",
            StatusCode::NOT_FOUND,
        ));
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let _ = MetadataStore::record_audit(
        actor,
        "blob.ticket_deleted",
        &format!("{}/{}", namespace, signature_or_id),
        Some("Capability ticket deleted from namespace"),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "data": { "deleted": true, "namespace": namespace },
        "error": serde_json::Value::Null
    })))
}

#[derive(Debug, Deserialize)]
pub struct InitUploadRequest {
    pub key: String,
    pub content_type: Option<String>,
    pub total_size: Option<u64>,
    pub checksum: Option<String>,
    pub ttl_seconds: Option<u64>,
}

/// Helper function to parse HTTP Content-Range header: `bytes START-END/TOTAL` or `bytes START-END/*`.
fn parse_content_range_header(
    header_val: &str,
) -> Result<(u64, Option<u64>, Option<u64>), AxiomError> {
    let s = header_val.trim();
    let s = s.strip_prefix("bytes ").unwrap_or(s);
    let parts: Vec<&str> = s.split('/').collect();
    if parts.is_empty() {
        return Err(AxiomError::new(
            "BAD_RANGE",
            "Invalid Content-Range format",
            StatusCode::BAD_REQUEST,
        ));
    }

    let total_size = if parts.len() > 1 && parts[1] != "*" {
        parts[1].parse::<u64>().ok()
    } else {
        None
    };

    let range_part = parts[0].trim();
    let range_nums: Vec<&str> = range_part.split('-').collect();
    if range_nums.len() == 2 {
        let start = range_nums[0].parse::<u64>().map_err(|_| {
            AxiomError::new(
                "BAD_RANGE",
                "Invalid start offset in Content-Range",
                StatusCode::BAD_REQUEST,
            )
        })?;
        let end = range_nums[1].parse::<u64>().map_err(|_| {
            AxiomError::new(
                "BAD_RANGE",
                "Invalid end offset in Content-Range",
                StatusCode::BAD_REQUEST,
            )
        })?;
        if start > end {
            return Err(AxiomError::new(
                "BAD_RANGE",
                "Content-Range start exceeds end",
                StatusCode::BAD_REQUEST,
            ));
        }
        Ok((start, Some(end), total_size))
    } else if range_nums.len() == 1 {
        let start = range_nums[0].parse::<u64>().map_err(|_| {
            AxiomError::new(
                "BAD_RANGE",
                "Invalid start offset in Content-Range",
                StatusCode::BAD_REQUEST,
            )
        })?;
        Ok((start, None, total_size))
    } else {
        Err(AxiomError::new(
            "BAD_RANGE",
            "Invalid Content-Range specification",
            StatusCode::BAD_REQUEST,
        ))
    }
}

/// Starts an asynchronous resumable upload session for large objects.
pub async fn init_upload_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    Json(payload): Json<InitUploadRequest>,
) -> Result<Response, AxiomError> {
    PolicyEngine::evaluate_blob(&auth, &namespace, &payload.key, "WRITE")?;

    let engine = get_blob_engine()?;

    // Fall back to headers if total_size or content_type were not specified in JSON body
    let content_type = payload.content_type.as_deref().or_else(|| {
        headers
            .get("X-Upload-Content-Type")
            .and_then(|h| h.to_str().ok())
    });

    let total_size = payload.total_size.or_else(|| {
        headers
            .get("X-Upload-Content-Length")
            .and_then(|h| h.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
    });

    let owner = if auth.is_session {
        "admin".to_string()
    } else {
        auth.api_key_name.clone()
    };

    let session = engine
        .init_resumable_upload(
            &namespace,
            &payload.key,
            content_type,
            total_size,
            payload.checksum.as_deref(),
            Some(&owner),
            payload.ttl_seconds,
        )
        .await
        .map_err(map_blob_error)?;

    let location = format!(
        "/api/v1/blobs/{}/uploads/{}",
        urlencoding::encode(&namespace),
        session.upload_id
    );

    let body_json = json!({
        "success": true,
        "data": session,
        "error": serde_json::Value::Null
    });

    Response::builder()
        .status(StatusCode::CREATED)
        .header(header::LOCATION, location)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&body_json).unwrap_or_default(),
        ))
        .map_err(|e| {
            AxiomError::new(
                "HTTP_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

/// Queries the server-confirmed upload offset and session status.
pub async fn get_upload_status_handler(
    Path((namespace, upload_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Response, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| {
            AxiomError::new(
                "UPLOAD_SESSION_NOT_FOUND",
                "Upload session not found",
                StatusCode::NOT_FOUND,
            )
        })?;

    if session.namespace != namespace {
        return Err(AxiomError::new(
            "INVALID_NAMESPACE",
            "Upload session belongs to different namespace",
            StatusCode::BAD_REQUEST,
        ));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    // Prevent cross-identity upload hijacking
    if !auth.is_session {
        if let Some(ref owner) = session.owner {
            if owner != &auth.api_key_name {
                return Err(AxiomError::new(
                    "AUTH_FORBIDDEN",
                    "Upload session was created by a different identity",
                    StatusCode::FORBIDDEN,
                ));
            }
        }
    }

    let offset = engine
        .get_upload_offset(&upload_id)
        .await
        .map_err(map_blob_error)?;

    let mut res_builder = Response::builder()
        .status(StatusCode::from_u16(308).unwrap_or(StatusCode::OK))
        .header(header::CONTENT_TYPE, "application/json")
        .header("Upload-Offset", offset.to_string())
        .header("X-Upload-Offset", offset.to_string());

    if offset > 0 {
        res_builder = res_builder.header("Range", format!("bytes=0-{}", offset - 1));
    }

    if let Some(total) = session.total_size {
        res_builder = res_builder.header("Upload-Length", total.to_string());
    }

    let body_json = json!({
        "success": true,
        "data": {
            "upload_id": upload_id,
            "namespace": namespace,
            "key": session.key,
            "offset": offset,
            "total_size": session.total_size,
            "completed": false,
            "expires_at": session.expires_at,
        },
        "error": serde_json::Value::Null
    });

    res_builder
        .body(Body::from(
            serde_json::to_vec(&body_json).unwrap_or_default(),
        ))
        .map_err(|e| {
            AxiomError::new(
                "HTTP_ERROR",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })
}

/// Receives an arbitrary chunk / byte range for an active resumable upload session.
/// Streams request body directly to disk with bounded memory usage, persists via fsync,
/// validates byte offsets, and finalizes automatically upon receiving the final byte.
pub async fn upload_chunk_handler(
    Path((namespace, upload_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| {
            AxiomError::new(
                "UPLOAD_SESSION_NOT_FOUND",
                "Upload session not found",
                StatusCode::NOT_FOUND,
            )
        })?;

    if session.namespace != namespace {
        return Err(AxiomError::new(
            "INVALID_NAMESPACE",
            "Upload session belongs to different namespace",
            StatusCode::BAD_REQUEST,
        ));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    if !auth.is_session {
        if let Some(ref owner) = session.owner {
            if owner != &auth.api_key_name {
                return Err(AxiomError::new(
                    "AUTH_FORBIDDEN",
                    "Upload session was created by a different identity",
                    StatusCode::FORBIDDEN,
                ));
            }
        }
    }

    let content_range = headers
        .get(header::CONTENT_RANGE)
        .and_then(|h| h.to_str().ok());
    let upload_offset_hdr = headers
        .get("Upload-Offset")
        .or_else(|| headers.get("X-Upload-Offset"))
        .and_then(|h| h.to_str().ok());

    // Status inquiry query via PUT (standard YouTube / Google Cloud Storage resumable upload protocol)
    if let Some(cr) = content_range {
        let cr_trim = cr.trim();
        if cr_trim.starts_with("bytes */") || cr_trim == "bytes */*" {
            return get_upload_status_handler(Path((namespace, upload_id)), Extension(auth)).await;
        }
    }

    let (start_offset, end_offset, total_size_hdr) = if let Some(cr) = content_range {
        parse_content_range_header(cr)?
    } else if let Some(uo) = upload_offset_hdr {
        let offset = uo.parse::<u64>().map_err(|_| {
            AxiomError::new(
                "BAD_HEADER",
                "Invalid Upload-Offset header",
                StatusCode::BAD_REQUEST,
            )
        })?;
        (offset, None, None)
    } else {
        let current = engine
            .get_upload_offset(&upload_id)
            .await
            .map_err(map_blob_error)?;
        (current, None, None)
    };

    let current_persisted = engine
        .get_upload_offset(&upload_id)
        .await
        .map_err(map_blob_error)?;

    // Handle offset gaps
    if start_offset > current_persisted {
        let mut res = Response::builder()
            .status(StatusCode::CONFLICT)
            .header(header::CONTENT_TYPE, "application/json")
            .header("Upload-Offset", current_persisted.to_string())
            .header("X-Upload-Offset", current_persisted.to_string());
        if current_persisted > 0 {
            res = res.header("Range", format!("bytes=0-{}", current_persisted - 1));
        }
        let body_json = json!({
            "success": false,
            "data": serde_json::Value::Null,
            "error": {
                "code": "UPLOAD_OFFSET_MISMATCH",
                "message": format!("Expected upload offset {}, but request started at {}", current_persisted, start_offset)
            }
        });
        return res
            .body(Body::from(
                serde_json::to_vec(&body_json).unwrap_or_default(),
            ))
            .map_err(|e| {
                AxiomError::new(
                    "HTTP_ERROR",
                    &e.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            });
    }

    // Handle retransmitted duplicate chunks (idempotent acknowledge)
    if let Some(end) = end_offset {
        if end < current_persisted {
            let mut res = Response::builder()
                .status(StatusCode::from_u16(308).unwrap_or(StatusCode::OK))
                .header(header::CONTENT_TYPE, "application/json")
                .header("Upload-Offset", current_persisted.to_string())
                .header("X-Upload-Offset", current_persisted.to_string());
            if current_persisted > 0 {
                res = res.header("Range", format!("bytes=0-{}", current_persisted - 1));
            }
            let body_json = json!({
                "success": true,
                "data": {
                    "upload_id": upload_id,
                    "namespace": namespace,
                    "key": session.key,
                    "offset": current_persisted,
                    "total_size": session.total_size.or(total_size_hdr),
                    "completed": false,
                },
                "error": serde_json::Value::Null
            });
            return res
                .body(Body::from(
                    serde_json::to_vec(&body_json).unwrap_or_default(),
                ))
                .map_err(|e| {
                    AxiomError::new(
                        "HTTP_ERROR",
                        &e.to_string(),
                        StatusCode::INTERNAL_SERVER_ERROR,
                    )
                });
        }
    }

    let max_bytes = end_offset.map(|end| (end - start_offset) + 1);

    let stream = body.into_data_stream().map_err(std::io::Error::other);
    let mut reader = StreamReader::new(stream);

    let written = engine
        .write_resumable_stream(&upload_id, start_offset, &mut reader, max_bytes)
        .await
        .map_err(map_blob_error)?;

    let new_offset = start_offset + written;

    // Check completion condition
    let is_complete = match (session.total_size, total_size_hdr) {
        (Some(t), _) => new_offset >= t,
        (None, Some(t)) => new_offset >= t,
        (None, None) => false,
    };

    if is_complete && new_offset > 0 {
        let meta = engine
            .finalize_resumable_upload(&upload_id)
            .await
            .map_err(map_blob_error)?;

        let actor = if auth.is_session {
            "admin"
        } else {
            &auth.api_key_name
        };
        let target = format!("{}/{}", namespace, session.key);
        let details = format!("hash={}, size={}, resumable=true", meta.hash, meta.size);
        let _ = MetadataStore::record_audit(
            actor,
            "blob.resumable_upload_complete",
            &target,
            Some(&details),
        )
        .await;

        let body_json = json!({
            "success": true,
            "data": meta,
            "error": serde_json::Value::Null
        });

        return Response::builder()
            .status(StatusCode::CREATED)
            .header(header::CONTENT_TYPE, "application/json")
            .header("Upload-Offset", meta.size.to_string())
            .header("ETag", format!("\"{}\"", meta.hash))
            .body(Body::from(
                serde_json::to_vec(&body_json).unwrap_or_default(),
            ))
            .map_err(|e| {
                AxiomError::new(
                    "HTTP_ERROR",
                    &e.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            });
    }

    let mut res = Response::builder()
        .status(StatusCode::from_u16(308).unwrap_or(StatusCode::OK))
        .header(header::CONTENT_TYPE, "application/json")
        .header("Upload-Offset", new_offset.to_string())
        .header("X-Upload-Offset", new_offset.to_string());

    if new_offset > 0 {
        res = res.header("Range", format!("bytes=0-{}", new_offset - 1));
    }

    if let Some(total) = session.total_size.or(total_size_hdr) {
        res = res.header("Upload-Length", total.to_string());
    }

    let body_json = json!({
        "success": true,
        "data": {
            "upload_id": upload_id,
            "namespace": namespace,
            "key": session.key,
            "offset": new_offset,
            "total_size": session.total_size.or(total_size_hdr),
            "completed": false
        },
        "error": serde_json::Value::Null
    });

    res.body(Body::from(
        serde_json::to_vec(&body_json).unwrap_or_default(),
    ))
    .map_err(|e| {
        AxiomError::new(
            "HTTP_ERROR",
            &e.to_string(),
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })
}

/// Uploads an individual chunk part into an active upload session (legacy multipart).
pub async fn put_part_handler(
    Path((namespace, upload_id, part)): Path<(String, String, u32)>,
    Extension(auth): Extension<AuthContext>,
    body: Bytes,
) -> Result<impl IntoResponse, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| {
            AxiomError::new(
                "UPLOAD_SESSION_NOT_FOUND",
                "Upload session not found",
                StatusCode::NOT_FOUND,
            )
        })?;

    if session.namespace != namespace {
        return Err(AxiomError::new(
            "INVALID_NAMESPACE",
            "Upload session belongs to different namespace",
            StatusCode::BAD_REQUEST,
        ));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    if !auth.is_session {
        if let Some(ref owner) = session.owner {
            if owner != &auth.api_key_name {
                return Err(AxiomError::new(
                    "AUTH_FORBIDDEN",
                    "Upload session was created by a different identity",
                    StatusCode::FORBIDDEN,
                ));
            }
        }
    }

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

/// Completes a resumable or chunked upload by assembling parts/staging data and committing metadata.
pub async fn complete_upload_handler(
    Path((namespace, upload_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| {
            AxiomError::new(
                "UPLOAD_SESSION_NOT_FOUND",
                "Upload session not found",
                StatusCode::NOT_FOUND,
            )
        })?;

    if session.namespace != namespace {
        return Err(AxiomError::new(
            "INVALID_NAMESPACE",
            "Upload session belongs to different namespace",
            StatusCode::BAD_REQUEST,
        ));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    if !auth.is_session {
        if let Some(ref owner) = session.owner {
            if owner != &auth.api_key_name {
                return Err(AxiomError::new(
                    "AUTH_FORBIDDEN",
                    "Upload session was created by a different identity",
                    StatusCode::FORBIDDEN,
                ));
            }
        }
    }

    let meta = engine
        .complete_chunked_upload(&upload_id)
        .await
        .map_err(map_blob_error)?;

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let target = format!("{}/{}", namespace, session.key);
    let details = format!("hash={}, size={}, completed=true", meta.hash, meta.size);
    let _ =
        MetadataStore::record_audit(actor, "blob.upload_complete", &target, Some(&details)).await;

    Ok(Json(json!({
        "success": true,
        "data": meta,
        "error": serde_json::Value::Null
    })))
}

/// Aborts an active chunked or resumable upload and purges staging data.
pub async fn abort_upload_handler(
    Path((namespace, upload_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    let engine = get_blob_engine()?;
    let session = engine
        .get_upload_session(&upload_id)
        .map_err(map_blob_error)?
        .ok_or_else(|| {
            AxiomError::new(
                "UPLOAD_SESSION_NOT_FOUND",
                "Upload session not found",
                StatusCode::NOT_FOUND,
            )
        })?;

    if session.namespace != namespace {
        return Err(AxiomError::new(
            "INVALID_NAMESPACE",
            "Upload session belongs to different namespace",
            StatusCode::BAD_REQUEST,
        ));
    }

    PolicyEngine::evaluate_blob(&auth, &namespace, &session.key, "WRITE")?;

    if !auth.is_session {
        if let Some(ref owner) = session.owner {
            if owner != &auth.api_key_name {
                return Err(AxiomError::new(
                    "AUTH_FORBIDDEN",
                    "Upload session was created by a different identity",
                    StatusCode::FORBIDDEN,
                ));
            }
        }
    }

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
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required for integrity scrubbing",
            StatusCode::FORBIDDEN,
        ));
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
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Admin session required for TTL sweep",
            StatusCode::FORBIDDEN,
        ));
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

/// Helper to attach namespace-specific or wildcard CORS headers for web embedding.
fn apply_cors_headers(resp: &mut Response, engine: &axiom_blob::BlobEngine, namespace: &str) {
    if let Ok(origins) = engine.get_namespace_cors(namespace) {
        if !origins.is_empty() {
            let origin_val = origins.join(", ");
            if let Ok(hv) = header::HeaderValue::from_str(&origin_val) {
                resp.headers_mut()
                    .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, hv);
            }
        } else {
            // Default: allow public assets to be fetched/embedded from any website
            resp.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                header::HeaderValue::from_static("*"),
            );
        }
    }
}

/// Unauthenticated public blob retrieval handler for static website media.
/// CONTRACT:
///  - Precondition: Namespace must have `is_public == true`. If not, returns 403 Forbidden.
///  - Supports: HTTP 304 Not Modified via `If-None-Match`.
///  - Supports: HTTP 206 Partial Content via `Range: bytes=start-end`.
///  - Emits: `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<hash>"`.
///  - Enforces: `inline` Content-Disposition for web images/media to allow browser display.
pub async fn get_public_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, AxiomError> {
    let engine = get_blob_engine()?;

    // 1. Verify that the namespace is configured as public
    if !engine
        .is_namespace_public(&namespace)
        .map_err(map_blob_error)?
    {
        return Err(AxiomError::new(
            "FORBIDDEN",
            &format!("Namespace '{}' is not public", namespace),
            StatusCode::FORBIDDEN,
        ));
    }

    // 2. Fetch metadata to evaluate conditional caching (If-None-Match & If-Modified-Since)
    let meta = engine.head(&namespace, &key).map_err(map_blob_error)?;
    let etag_val = format!("\"{}\"", meta.hash);
    let last_modified =
        chrono::DateTime::from_timestamp(meta.created_at, 0).map(|dt| dt.to_rfc2822());

    if let Some(inm) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|h| h.to_str().ok())
    {
        if inm.trim() == etag_val || inm.trim() == meta.hash {
            let mut resp_builder = Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::ETAG, &etag_val)
                .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable");
            if let Some(ref lm) = last_modified {
                resp_builder = resp_builder.header(header::LAST_MODIFIED, lm.as_str());
            }
            let mut resp = resp_builder.body(Body::empty()).map_err(|e| {
                tracing::error!("Response build error: {}", e);
                AxiomError::new(
                    "INTERNAL_ERROR",
                    "Failed to build response",
                    StatusCode::INTERNAL_SERVER_ERROR,
                )
            })?;
            apply_cors_headers(&mut resp, &engine, &namespace);
            return Ok(resp);
        }
    }

    if let Some(ims) = headers
        .get(header::IF_MODIFIED_SINCE)
        .and_then(|h| h.to_str().ok())
    {
        if let Ok(client_time) = chrono::DateTime::parse_from_rfc2822(ims) {
            if meta.created_at <= client_time.timestamp() {
                let mut resp_builder = Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header(header::ETAG, &etag_val)
                    .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable");
                if let Some(ref lm) = last_modified {
                    resp_builder = resp_builder.header(header::LAST_MODIFIED, lm.as_str());
                }
                let mut resp = resp_builder.body(Body::empty()).map_err(|e| {
                    tracing::error!("Response build error: {}", e);
                    AxiomError::new(
                        "INTERNAL_ERROR",
                        "Failed to build response",
                        StatusCode::INTERNAL_SERVER_ERROR,
                    )
                })?;
                apply_cors_headers(&mut resp, &engine, &namespace);
                return Ok(resp);
            }
        }
    }

    // Determine filename and disposition (inline for web media, attachment for executable/HTML/SVG)
    let filename = key.rsplit(['/', '\\']).next().unwrap_or("blob.bin");
    let safe_filename: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    let is_web_media = (meta.content_type.starts_with("image/")
        && !meta.content_type.contains("svg"))
        || meta.content_type.starts_with("video/")
        || meta.content_type.starts_with("audio/");

    let disposition = if is_web_media {
        format!("inline; filename=\"{}\"", safe_filename)
    } else {
        format!("attachment; filename=\"{}\"", safe_filename)
    };

    // Range handling & RFC 9110 §13.1.2 If-Range validator check
    const MAX_RANGE_BYTES: u64 = 256 * 1024 * 1024;
    let if_range_matches =
        if let Some(ir) = headers.get(header::IF_RANGE).and_then(|h| h.to_str().ok()) {
            let ir = ir.trim();
            ir == etag_val || ir == meta.hash || last_modified.as_deref() == Some(ir)
        } else {
            true
        };

    let range_hdr = headers.get(header::RANGE).and_then(|h| h.to_str().ok());
    let parsed_range = if range_hdr.is_some() && !if_range_matches {
        // RFC 9110: If If-Range validator does not match current representation, ignore Range and serve entire 200 OK
        None
    } else if let Some(r) = range_hdr {
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
                if let Ok(suffix) = end_str.parse::<u64>() {
                    let suffix = suffix.min(MAX_RANGE_BYTES);
                    let start = meta.size.saturating_sub(suffix);
                    Some((start, None))
                } else {
                    return Err(AxiomError::new(
                        "RANGE_NOT_SATISFIABLE",
                        "Invalid Range header",
                        StatusCode::RANGE_NOT_SATISFIABLE,
                    ));
                }
            } else if let Ok(start) = start_str.parse::<u64>() {
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
                let end = match (end_str.is_empty(), end) {
                    (false, None) => {
                        return Err(AxiomError::new(
                            "RANGE_NOT_SATISFIABLE",
                            "Invalid Range header",
                            StatusCode::RANGE_NOT_SATISFIABLE,
                        ))
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

    let response_builder = if let Some((start, end)) = parsed_range {
        let (meta, byte_range, data) = engine
            .get_range(&namespace, &key, start, end)
            .await
            .map_err(map_blob_error)?;

        let range_len = byte_range.length();
        let content_range = format!(
            "bytes {}-{}/{}",
            byte_range.start, byte_range.end, byte_range.total
        );

        let mut builder = Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, meta.content_type)
            .header(header::CONTENT_LENGTH, range_len.to_string())
            .header(header::CONTENT_RANGE, content_range)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ETAG, &etag_val)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_DISPOSITION, disposition.clone())
            .header(
                header::CONTENT_SECURITY_POLICY,
                if is_web_media {
                    "default-src 'none'; media-src 'self' * blob: data:; img-src 'self' * blob: data:; style-src 'unsafe-inline'; font-src 'self' data:;"
                } else {
                    "default-src 'none'; frame-ancestors 'none';"
                },
            );

        if let Some(ref lm) = last_modified {
            builder = builder.header(header::LAST_MODIFIED, lm.as_str());
        }

        let mut resp = match data {
            BlobData::Inline(bytes) => builder.body(Body::from(bytes)),
            BlobData::File(file, len) => {
                use tokio::io::AsyncReadExt;
                let stream = ReaderStream::with_capacity(file.take(len), STREAM_CHUNK_BUFFER_SIZE);
                builder.body(Body::from_stream(stream))
            }
        }
        .map_err(|e| {
            tracing::error!("Response build error: {}", e);
            AxiomError::new(
                "INTERNAL_ERROR",
                "Failed to build response",
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

        for (k, v) in &meta.metadata {
            if let (Ok(name), Ok(val)) = (
                header::HeaderName::from_bytes(
                    format!("x-axiom-meta-{}", k.to_ascii_lowercase()).as_bytes(),
                ),
                header::HeaderValue::from_str(v),
            ) {
                resp.headers_mut().insert(name, val);
            }
        }
        apply_cors_headers(&mut resp, &engine, &namespace);
        return Ok(resp);
    } else {
        let mut builder = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, meta.content_type.clone())
            .header(header::CONTENT_LENGTH, meta.size.to_string())
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ETAG, &etag_val)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::CONTENT_DISPOSITION, disposition)
            .header(
                header::CONTENT_SECURITY_POLICY,
                if is_web_media {
                    "default-src 'none'; media-src 'self' * blob: data:; img-src 'self' * blob: data:; style-src 'unsafe-inline'; font-src 'self' data:;"
                } else {
                    "default-src 'none'; frame-ancestors 'none';"
                },
            );

        if let Some(ref lm) = last_modified {
            builder = builder.header(header::LAST_MODIFIED, lm.as_str());
        }
        builder
    };

    let (_, data) = engine.get(&namespace, &key).await.map_err(map_blob_error)?;
    let mut resp = match data {
        BlobData::Inline(bytes) => response_builder.body(Body::from(bytes)),
        BlobData::File(file, len) => {
            use tokio::io::AsyncReadExt;
            let stream = ReaderStream::with_capacity(file.take(len), STREAM_CHUNK_BUFFER_SIZE);
            response_builder.body(Body::from_stream(stream))
        }
    }
    .map_err(|e| {
        tracing::error!("Response build error: {}", e);
        AxiomError::new(
            "INTERNAL_ERROR",
            "Failed to build response",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;

    for (k, v) in &meta.metadata {
        if let (Ok(name), Ok(val)) = (
            header::HeaderName::from_bytes(
                format!("x-axiom-meta-{}", k.to_ascii_lowercase()).as_bytes(),
            ),
            header::HeaderValue::from_str(v),
        ) {
            resp.headers_mut().insert(name, val);
        }
    }
    apply_cors_headers(&mut resp, &engine, &namespace);
    Ok(resp)
}

/// Head request for public unauthenticated blob metadata.
pub async fn head_public_blob_handler(
    Path((namespace, key)): Path<(String, String)>,
) -> Result<Response, AxiomError> {
    let engine = get_blob_engine()?;

    if !engine
        .is_namespace_public(&namespace)
        .map_err(map_blob_error)?
    {
        return Err(AxiomError::new(
            "FORBIDDEN",
            &format!("Namespace '{}' is not public", namespace),
            StatusCode::FORBIDDEN,
        ));
    }

    let meta = engine.head(&namespace, &key).map_err(map_blob_error)?;
    let filename = key.rsplit(['/', '\\']).next().unwrap_or("blob.bin");
    let safe_filename: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    let is_web_media = (meta.content_type.starts_with("image/")
        && !meta.content_type.contains("svg"))
        || meta.content_type.starts_with("video/")
        || meta.content_type.starts_with("audio/");

    let disposition = if is_web_media {
        format!("inline; filename=\"{}\"", safe_filename)
    } else {
        format!("attachment; filename=\"{}\"", safe_filename)
    };

    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, meta.content_type)
        .header(header::CONTENT_LENGTH, meta.size.to_string())
        .header(header::ETAG, format!("\"{}\"", meta.hash))
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::empty())
        .map_err(|e| {
            AxiomError::new(
                "RESPONSE_BUILD_FAILED",
                &e.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
            )
        })?;

    for (k, v) in &meta.metadata {
        if let (Ok(name), Ok(val)) = (
            header::HeaderName::from_bytes(
                format!("x-axiom-meta-{}", k.to_ascii_lowercase()).as_bytes(),
            ),
            header::HeaderValue::from_str(v),
        ) {
            resp.headers_mut().insert(name, val);
        }
    }
    apply_cors_headers(&mut resp, &engine, &namespace);
    Ok(resp)
}

#[derive(Debug, Deserialize)]
pub struct BatchDeleteBlobsPayload {
    #[serde(default)]
    pub keys: Vec<String>,
    pub prefix: Option<String>,
}

/// Batch multi-object deletion handler supporting explicit keys or recursive prefix deletion.
pub async fn batch_delete_blobs_handler(
    Path(namespace): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<BatchDeleteBlobsPayload>,
) -> Result<impl IntoResponse, AxiomError> {
    // S3 semantics: evaluate permissions per key. If user has wildcard '*' permission,
    // all keys can be deleted immediately. Otherwise, partition into permitted vs unauthorized keys.
    let (keys_to_delete, denied_errors) = if auth.is_session
        || PolicyEngine::evaluate_blob(&auth, &namespace, "*", "DELETE").is_ok()
    {
        (payload.keys, Vec::new())
    } else {
        let mut allowed = Vec::new();
        let mut denied = Vec::new();
        for key in payload.keys {
            if PolicyEngine::evaluate_blob(&auth, &namespace, &key, "DELETE").is_ok() {
                allowed.push(key);
            } else {
                denied.push((
                    key,
                    "AccessDenied: Insufficient permissions to delete key".to_string(),
                ));
            }
        }
        (allowed, denied)
    };

    let engine = get_blob_engine()?;
    let mut result = if !keys_to_delete.is_empty() {
        engine
            .delete_objects(&namespace, &keys_to_delete)
            .await
            .map_err(map_blob_error)?
    } else {
        axiom_blob::DeleteObjectsResult::default()
    };

    result.errors.extend(denied_errors);

    let mut prefix_deleted_count = 0;
    if let Some(ref pfx) = payload.prefix {
        if !pfx.is_empty() {
            let can_delete_prefix = auth.is_session
                || PolicyEngine::evaluate_blob(&auth, &namespace, "*", "DELETE").is_ok()
                || PolicyEngine::evaluate_blob(&auth, &namespace, pfx, "DELETE").is_ok();

            if can_delete_prefix {
                match engine.delete_prefix(&namespace, pfx).await {
                    Ok(cnt) => {
                        prefix_deleted_count = cnt;
                    }
                    Err(e) => {
                        result
                            .errors
                            .push((pfx.clone(), format!("Prefix deletion error: {}", e)));
                    }
                }
            } else {
                result.errors.push((
                    pfx.clone(),
                    "AccessDenied: Insufficient permissions to delete prefix".to_string(),
                ));
            }
        }
    }

    let actor = if auth.is_session {
        "admin"
    } else {
        &auth.api_key_name
    };
    let details = format!(
        "deleted={}, prefix_deleted={}, errors={}",
        result.deleted.len(),
        prefix_deleted_count,
        result.errors.len()
    );
    let _ =
        MetadataStore::record_audit(actor, "blob.batch_delete", &namespace, Some(&details)).await;

    Ok(Json(json!({
        "success": true,
        "data": {
            "deleted": result.deleted,
            "prefix_deleted": prefix_deleted_count,
            "errors": result.errors
        },
        "error": serde_json::Value::Null
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_copy_and_move_requests_deserialization() {
        let copy_json = r#"{"src_key": "img.png", "dest_key": "new.png"}"#;
        let copy_req: CopyBlobRequest = serde_json::from_str(copy_json).unwrap();
        assert!(copy_req.src_namespace.is_none());
        assert_eq!(copy_req.src_key, "img.png");
        assert_eq!(copy_req.dest_key, "new.png");

        let move_json = r#"{"src_namespace": "bucket1", "src_key": "a.txt", "dest_key": "b.txt", "is_prefix": true}"#;
        let move_req: MoveBlobRequest = serde_json::from_str(move_json).unwrap();
        assert_eq!(move_req.src_namespace.as_deref(), Some("bucket1"));
        assert_eq!(move_req.is_prefix, Some(true));

        let del_json = r#"{"prefix": "folder/"}"#;
        let del_req: DeletePrefixRequest = serde_json::from_str(del_json).unwrap();
        assert!(del_req.namespace.is_none());
        assert_eq!(del_req.prefix, "folder/");

        let batch_del_json = r#"{"keys": ["a.txt", "b.txt"], "prefix": "tmp/"}"#;
        let batch_del_req: BatchDeleteBlobsPayload = serde_json::from_str(batch_del_json).unwrap();
        assert_eq!(batch_del_req.keys.len(), 2);
        assert_eq!(batch_del_req.prefix.as_deref(), Some("tmp/"));

        let upload_link_json =
            r#"{"key": "docs/manual.pdf", "content_type": "application/pdf", "ttl_seconds": 3600}"#;
        let upload_link_req: CreateUploadLinkRequest =
            serde_json::from_str(upload_link_json).unwrap();
        assert_eq!(upload_link_req.key, "docs/manual.pdf");
        assert_eq!(
            upload_link_req.content_type.as_deref(),
            Some("application/pdf")
        );
        assert_eq!(upload_link_req.ttl_seconds, Some(3600));
    }

    #[test]
    fn test_map_blob_error_insufficient_storage() {
        let err = BlobError::InsufficientStorage("disk full".to_string());
        let axiom_err = map_blob_error(err);
        assert_eq!(axiom_err.status, StatusCode::INSUFFICIENT_STORAGE);
        assert_eq!(axiom_err.code, "INSUFFICIENT_STORAGE");
    }
}

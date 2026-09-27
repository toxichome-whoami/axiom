/*
 * Response envelope formatting middleware.
 * Owned by: crates/api (middleware)
 * Key deps: axum, serde_json
 * Invariants: Injects top-level 'success' boolean into JSON payloads if omitted by route handlers.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use axum::{
    body::Body,
    http::{header, Response, StatusCode},
    response::IntoResponse,
};
use serde_json::{json, Value};

/// Formats outgoing JSON responses to ensure top-level `success` indicator is always present.
/// CONTRACT:
///  - Precondition: Inbound `Response<Body>`.
///  - Preserves non-JSON streams and responses without alteration.
///  - Updates `content-length` header upon JSON envelope modification.
pub async fn envelope_middleware(res: Response<Body>) -> Response<Body> {
    let (mut parts, body) = res.into_parts();
    
    let is_json = parts.headers.get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.starts_with("application/json"))
        .unwrap_or(false);

    if !is_json {
        return Response::from_parts(parts, body);
    }

    let status = parts.status;

    // Limit buffer to 10MB to prevent memory exhaustion
    let bytes = match axum::body::to_bytes(body, 10_485_760).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read response body").into_response(),
    };

    if bytes.is_empty() {
        return Response::from_parts(parts, Body::from(bytes));
    }

    if let Ok(mut json_val) = serde_json::from_slice::<Value>(&bytes) {
        if let Some(obj) = json_val.as_object_mut() {
            if !obj.contains_key("success") {
                obj.insert("success".to_string(), json!(status.is_success()));
            }
            
            // Re-serialize with the new field
            if let Ok(new_bytes) = serde_json::to_vec(&json_val) {
                if let Ok(len_val) = header::HeaderValue::from_str(&new_bytes.len().to_string()) {
                    parts.headers.insert(header::CONTENT_LENGTH, len_val);
                }
                return Response::from_parts(parts, Body::from(new_bytes));
            }
        } else {
            // It's a JSON array or scalar. Wrap it in a data object!
            let new_json = json!({
                "success": status.is_success(),
                "data": json_val
            });
            if let Ok(new_bytes) = serde_json::to_vec(&new_json) {
                if let Ok(len_val) = header::HeaderValue::from_str(&new_bytes.len().to_string()) {
                    parts.headers.insert(header::CONTENT_LENGTH, len_val);
                }
                return Response::from_parts(parts, Body::from(new_bytes));
            }
        }
    }

    // Fallback if parsing fails or reserialization fails
    Response::from_parts(parts, Body::from(bytes))
}

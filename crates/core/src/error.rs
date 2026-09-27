/*
 * Centralized API error representation and HTTP response serialization.
 * Owned by: core
 * Key deps: axum, serde_json
 * Invariants: Error envelopes always contain success=false and a structured code/message pair.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub struct AxiomError {
    pub code: String,
    pub message: String,
    pub status: StatusCode,
}

impl AxiomError {
    /// Constructs a new AxiomError with an application error code, human message, and HTTP status.
    /// CONTRACT:
    ///  - Precondition: `code` is a stable screaming-snake-case identifier (e.g. "RATE_LIMIT_EXCEEDED").
    ///  - Precondition: `message` must never leak internal stack traces or database driver errors.
    ///  - Side effects: None.
    ///  - Idempotent: Yes.
    pub fn new(code: &str, message: &str, status: StatusCode) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            status,
        }
    }
}

impl IntoResponse for AxiomError {
    /// Serializes the error into standard JSON envelope.
    /// CONTRACT:
    ///  - Always sets HTTP status code to `self.status`.
    ///  - Includes `success: false` and `data: null` for consumer uniformity.
    fn into_response(self) -> Response {
        let body = Json(json!({
            "success": false,
            "data": serde_json::Value::Null,
            "error": {
                "code": self.code,
                "message": self.message
            }
        }));
        (self.status, body).into_response()
    }
}

impl std::fmt::Display for AxiomError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}]: {}", self.code, self.message)
    }
}

impl std::fmt::Debug for AxiomError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "AxiomError({}: {})", self.code, self.message)
    }
}

impl std::error::Error for AxiomError {}

// ─── Tests ─────────────────────────────────────────────────────────────────
// Tests for API error representation and HTTP response serialization.

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use axum::body::to_bytes;
    use serde_json::from_slice;

    #[test]
    fn test_axiom_error_new() {
        let err = AxiomError::new("TEST_CODE", "Test message", StatusCode::BAD_REQUEST);
        assert_eq!(err.code, "TEST_CODE");
        assert_eq!(err.message, "Test message");
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_axiom_error_display() {
        let err = AxiomError::new("TEST_CODE", "Test message", StatusCode::BAD_REQUEST);
        assert_eq!(format!("{}", err), "[TEST_CODE]: Test message");
    }

    #[test]
    fn test_axiom_error_debug() {
        let err = AxiomError::new("TEST_CODE", "Test message", StatusCode::BAD_REQUEST);
        assert_eq!(format!("{:?}", err), "AxiomError(TEST_CODE: Test message)");
    }

    #[tokio::test]
    async fn test_axiom_error_into_response() {
        let err = AxiomError::new("ERR_123", "Some error", StatusCode::NOT_FOUND);
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = from_slice(&body_bytes).unwrap();

        assert_eq!(json["success"], false);
        assert_eq!(json["data"], serde_json::Value::Null);
        assert_eq!(json["error"]["code"], "ERR_123");
        assert_eq!(json["error"]["message"], "Some error");
    }
}

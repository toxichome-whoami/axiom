/*
 * Centralized API error representation and HTTP response serialization.
 * Owned by: api/errors
 * Key deps: axum, serde_json
 * Invariants: Error envelopes always contain success=false and a structured code/message pair.
 * Last structural change: Phase 0 cleanup standardizing API error envelope (Debt #10).
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

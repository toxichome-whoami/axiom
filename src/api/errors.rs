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
    pub fn new(code: &str, message: &str, status: StatusCode) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            status,
        }
    }
}

impl IntoResponse for AxiomError {
    fn into_response(self) -> Response {
        let body = Json(json!({
            "success": false,
            "error": {
                "code": self.code,
                "message": self.message
            }
        }));
        (self.status, body).into_response()
    }
}

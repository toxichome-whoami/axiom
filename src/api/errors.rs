use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::Value;

use crate::utils::types::{ErrorDetails, RequestMeta, ResponseEnvelope};

#[allow(dead_code)]
pub struct AxiomError {
    pub code: &'static str,
    pub message: String,
    pub status_code: StatusCode,
    pub details: Option<Value>,
}

impl AxiomError {
    pub fn new(code: &'static str, message: impl Into<String>, status_code: StatusCode) -> Self {
        Self {
            code,
            message: message.into(),
            status_code,
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

impl IntoResponse for AxiomError {
    fn into_response(self) -> Response {
        let envelope = ResponseEnvelope {
            success: false,
            data: None,
            error: Some(ErrorDetails {
                code: self.code.to_string(),
                message: self.message,
                details: self.details,
            }),
            meta: RequestMeta {
                request_id: "".to_string(), // In a real middleware this gets injected
                timestamp: chrono::Utc::now().to_rfc3339(),
                duration_ms: 0.0,
                server: "axiom-rust".to_string(),
                version: "1.0.5".to_string(),
                federated: None,
                proxy_latency_ms: None,
            },
            links: None,
        };

        (self.status_code, Json(envelope)).into_response()
    }
}

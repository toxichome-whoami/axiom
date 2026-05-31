use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::utils::size_parser::parse_size;
use axum::{extract::Request, middleware::Next, response::Response};

pub async fn waf_middleware(req: Request, next: Next) -> Result<Response, AxiomError> {
    let _config = req
        .extensions()
        .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(|| ConfigManager::get());
    static BODY_LIMIT: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    let body_limit = *BODY_LIMIT.get_or_init(|| {
        let config_inner = ConfigManager::get();
        parse_size(&config_inner.server.body_limit).unwrap_or(10 * 1024 * 1024)
    });

    if let Some(cl) = req.headers().get("content-length") {
        if let Ok(cl_str) = cl.to_str() {
            if let Ok(size) = cl_str.parse::<u64>() {
                if size > body_limit {
                    return Err(AxiomError::new(
                        "WAF_BODY_TOO_LARGE",
                        "Request body too large.",
                        axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                    ));
                }
            }
        }
    }

    let uri = req.uri();
    let path = uri.path();
    let query = uri.query().unwrap_or("");

    if path.len() + query.len() > 2048 {
        return Err(AxiomError::new(
            "WAF_URI_TOO_LONG",
            "URI exceeds 2048 characters",
            axum::http::StatusCode::URI_TOO_LONG,
        ));
    }

    if path.contains("..") || path.contains("%") || query.contains("..") || query.contains("%") {
        // Basic check for traversal
        if path.contains("../") || path.contains("..\\") || path.contains("%2e%2e%2f") {
            return Err(AxiomError::new(
                "WAF_PATH_TRAVERSAL",
                "Path traversal attempt detected",
                axum::http::StatusCode::BAD_REQUEST,
            ));
        }
    }

    if path.contains("\0") || query.contains("\0") {
        return Err(AxiomError::new(
            "WAF_NULL_BYTE",
            "Null byte detected",
            axum::http::StatusCode::BAD_REQUEST,
        ));
    }

    if query.matches('&').count() > 50 {
        return Err(AxiomError::new(
            "WAF_TOO_MANY_PARAMS",
            "Too many query parameters",
            axum::http::StatusCode::BAD_REQUEST,
        ));
    }

    Ok(next.run(req).await)
}

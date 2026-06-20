use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::utils::size_parser::parse_size;
use axum::{extract::Request, middleware::Next, response::Response};

pub async fn waf_middleware(req: Request, next: Next) -> Result<Response, AxiomError> {
    let _config = req
        .extensions()
        .get::<std::sync::Arc<crate::config::schema::AxiomConfig>>()
        .cloned()
        .unwrap_or_else(ConfigManager::get);
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

    // Check for chunked encoding without content-length (bypass attempt)
    if let Some(te) = req.headers().get("transfer-encoding") {
        if let Ok(te_str) = te.to_str() {
            if te_str.to_lowercase().contains("chunked")
                && req.headers().get("content-length").is_none()
            {
                tracing::warn!(
                    "Chunked request without Content-Length received — DefaultBodyLimit will catch oversized payloads"
                );
            }
        }
    }

    let uri = req.uri();
    let mut path = uri.path().to_string();
    let mut query = uri.query().unwrap_or("").to_string();

    if path.len() + query.len() > 2048 {
        return Err(AxiomError::new(
            "WAF_URI_TOO_LONG",
            "URI exceeds 2048 characters",
            axum::http::StatusCode::URI_TOO_LONG,
        ));
    }

    // Decode URL up to 3 times to prevent double/triple encoding bypasses
    for _ in 0..3 {
        if let Ok(decoded) = urlencoding::decode(&path) {
            path = decoded.into_owned();
        }
        if let Ok(decoded) = urlencoding::decode(&query) {
            query = decoded.into_owned();
        }
    }

    if path.contains("..") || path.contains("%") || query.contains("..") || query.contains("%") {
        let combined = format!("{}?{}", path, query).to_lowercase();
        if combined.contains("../")
            || combined.contains("..\\")
            || combined.contains("%2e%2e%2f")
            || combined.contains("%2e%2e%5c")
        {
            return Err(AxiomError::new(
                "WAF_PATH_TRAVERSAL",
                "Path traversal attempt detected",
                axum::http::StatusCode::BAD_REQUEST,
            ));
        }
    }

    if path.contains('\0') || query.contains('\0') {
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

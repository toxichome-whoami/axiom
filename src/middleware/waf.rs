use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::utils::size_parser::parse_size;
use axum::{extract::Request, middleware::Next, response::Response};

pub async fn waf_middleware(req: Request, next: Next) -> Result<Response, AxiomError> {
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
    let raw_uri = uri.to_string();
    let path = uri.path();
    let query = uri.query().unwrap_or("");

    if raw_uri.len() > 2048 || path.len() + query.len() > 2048 {
        return Err(AxiomError::new(
            "WAF_URI_TOO_LONG",
            "URI exceeds 2048 characters",
            axum::http::StatusCode::URI_TOO_LONG,
        ));
    }

    if path.contains('\0') || query.contains('\0') || raw_uri.to_lowercase().contains("%00") {
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

    // Fast path: skip expensive WAF decode allocations for normal clean requests
    if path.contains('%')
        || path.contains('.')
        || path.contains(' ')
        || query.contains('%')
        || query.contains('.')
        || query.contains(' ')
        || raw_uri.contains("..")
    {
        let mut combined = format!("{}?{}", path, query).to_lowercase();
        // Decode up to 3 times to prevent multi-encoding bypasses
        for _ in 0..3 {
            let decoded = urlencoding::decode(&combined)
                .unwrap_or(std::borrow::Cow::Borrowed(&combined))
                .to_string();
            if decoded == combined {
                break;
            }
            combined = decoded;
        }

        if combined.contains('\0') || combined.contains("%00") {
            return Err(AxiomError::new(
                "WAF_NULL_BYTE",
                "Null byte detected",
                axum::http::StatusCode::BAD_REQUEST,
            ));
        }

        if combined.contains("..") || raw_uri.contains("..") {
            return Err(AxiomError::new(
                "WAF_PATH_TRAVERSAL",
                "Path traversal attempt detected",
                axum::http::StatusCode::BAD_REQUEST,
            ));
        }

        // SQL injection attempt in URL path parameters
        let path_lower = path.to_lowercase();
        if path_lower.contains("select ")
            || path_lower.contains("drop ")
            || path_lower.contains("union ")
            || path_lower.contains("delete ")
            || path_lower.contains("insert ")
            || combined.contains("select ")
            || combined.contains("drop ")
            || combined.contains("union ")
        {
            return Err(AxiomError::new(
                "WAF_SQL_INJECTION",
                "SQL injection attempt in URL detected",
                axum::http::StatusCode::BAD_REQUEST,
            ));
        }
    }

    Ok(next.run(req).await)
}

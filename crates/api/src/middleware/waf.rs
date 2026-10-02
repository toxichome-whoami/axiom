/*
 * Web Application Firewall (WAF) middleware for HTTP edge sanitization.
 * Owned by: crates/api (middleware)
 * Key deps: axiom_core, axum, urlencoding
 * Invariants: Blocks path traversal (deep 3x decoding), null bytes, oversized payloads, and SQL injection in URL parameters.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use axiom_core::AxiomError;
use axiom_core::ConfigManager;
use axiom_core::parse_size;
use axum::{extract::Request, middleware::Next, response::Response};

/// Intercepts incoming HTTP requests to block protocol-level attacks before route matching.
/// CONTRACT:
///  - Precondition: Inbound HTTP `Request`.
///  - Rejects: URI > 2048 chars, null bytes (%00), body > configured limit, SQL keywords in URL, traversal (`..` and `%252e%252e`).
///  - Returns `Ok(Response)` if request is clean; returns `Err(AxiomError)` with 400, 413, or 414 otherwise.
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
    let raw_uri = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or_else(|| uri.path());
    let path = uri.path();
    let query = uri.query().unwrap_or("");

    if raw_uri.len() > 2048 || path.len() + query.len() > 2048 {
        return Err(AxiomError::new(
            "WAF_URI_TOO_LONG",
            "URI exceeds 2048 characters",
            axum::http::StatusCode::URI_TOO_LONG,
        ));
    }

    if path.contains('\0') || query.contains('\0') || raw_uri.contains("%00") {
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, http::StatusCode, routing::get, Router};
    use tower::ServiceExt;

    fn build_waf_test_app() -> Router {
        Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(waf_middleware))
    }

    #[tokio::test]
    async fn test_waf_clean_uri_allowed() {
        let app = build_waf_test_app();
        let res = app
            .oneshot(Request::get("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_waf_null_byte_rejected() {
        let app = build_waf_test_app();
        let res = app
            .oneshot(Request::get("/test%00evil").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_waf_path_traversal_triple_encoded_rejected() {
        let app = build_waf_test_app();
        let res = app
            .oneshot(
                Request::get("/test%25252e%25252e%25252fetc/passwd")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_waf_sql_keyword_rejected() {
        let app = build_waf_test_app();
        let res = app
            .oneshot(
                Request::get("/test?query=select%20*")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_waf_uri_too_long() {
        let app = build_waf_test_app();
        let long_path = format!("/test?param={}", "a".repeat(2050));
        let res = app
            .oneshot(Request::get(&long_path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::URI_TOO_LONG);
    }

    #[tokio::test]
    async fn test_waf_too_many_params() {
        let app = build_waf_test_app();
        let flood = format!("/test?{}", "a=1&".repeat(55));
        let res = app
            .oneshot(Request::get(&flood).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_waf_body_too_large() {
        let app = build_waf_test_app();
        let res = app
            .oneshot(
                Request::post("/test")
                    .header("content-length", (20 * 1024 * 1024).to_string())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }
}

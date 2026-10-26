/*
 * Web Application Firewall (WAF) middleware for HTTP edge sanitization.
 * Owned by: crates/api (middleware)
 * Key deps: axiom_core, axum, urlencoding
 * Invariants: Blocks path traversal (deep 3x decoding), null bytes, oversized payloads, and SQL injection in URL parameters.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use axiom_core::{parse_size, AxiomError, ConfigManager};
use axum::{extract::Request, middleware::Next, response::Response};
use std::sync::Arc;

/// Resolve effective body limit per-request (no stale OnceLock cache so
/// hot-reload / tests see current config). Falls back to safe defaults.
fn resolve_body_limit(req: &Request, is_blob_route: bool) -> u64 {
    let default = if is_blob_route {
        5 * 1024 * 1024 * 1024u64
    } else {
        10 * 1024 * 1024u64
    };
    let configured = req
        .extensions()
        .get::<Arc<axiom_core::AxiomConfig>>()
        .map(|c| {
            if is_blob_route {
                parse_size(&c.blob.max_object).unwrap_or(default)
            } else {
                parse_size(&c.server.body_limit).unwrap_or(default)
            }
        })
        .unwrap_or_else(|| {
            let c = ConfigManager::get();
            if is_blob_route {
                parse_size(&c.blob.max_object).unwrap_or(default)
            } else {
                parse_size(&c.server.body_limit).unwrap_or(default)
            }
        });
    configured
}

/// Normalize URL text for keyword inspection: lowercase, convert
/// tab/newline/CR to space, strip C-style comments, collapse whitespace.
fn normalize_for_sqli(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // strip /* ... */ comments
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            out.push(' ');
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }
        let c = bytes[i] as char;
        if c == '\t' || c == '\n' || c == '\r' || c == '\x0c' {
            out.push(' ');
        } else {
            out.push(c);
        }
        i += 1;
    }
    // collapse consecutive whitespace to single space
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_space = false;
    for c in out.chars() {
        if c == ' ' {
            if !prev_space {
                collapsed.push(' ');
            }
            prev_space = true;
        } else {
            collapsed.push(c);
            prev_space = false;
        }
    }
    collapsed
}

fn contains_sqli(normalized: &str) -> bool {
    // Highly specific SQL injection patterns in URL path and raw parameters.
    // NOTE (SEC-2): Loose words like " and " or " or " without relational syntax
    // must not be blocked, as they cause false positives on natural search phrases ("bread and butter")
    // and legitimate string filter expressions. We check structural attack patterns instead.
    const KEYWORDS: &[&str] = &[
        "select ",
        "select*",
        "select(",
        "drop ",
        "union ",
        "union(",
        "unionselect",
        "delete ",
        "insert ",
        "update ",
        "-- ",
        "--\t",
        "--\n",
        "--\r",
        ";",
        "/*",
        "information_schema",
        "sleep(",
        "benchmark(",
        "outfile ",
        "load_file(",
        " or 1=1",
        " or '1'='1'",
        " and 1=1",
        " and '1'='1'",
        "' or '",
        "' and '",
        "\" or \"",
        "\" and \"",
    ];
    if KEYWORDS.iter().any(|k| normalized.contains(k)) {
        return true;
    }
    if normalized.ends_with("--") || normalized.contains("--;") {
        return true;
    }
    false
}

/// Intercepts incoming HTTP requests to block protocol-level attacks before route matching.
/// CONTRACT:
///  - Precondition: Inbound HTTP `Request`.
///  - Rejects: URI > 2048 chars, null bytes (%00), body > configured limit, SQL keywords in URL, traversal (`..` and `%252e%252e`).
///  - Returns `Ok(Response)` if request is clean; returns `Err(AxiomError)` with 400, 413, or 414 otherwise.
pub async fn waf_middleware(req: Request, next: Next) -> Result<Response, AxiomError> {
    let uri = req.uri();
    let raw_uri = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or_else(|| uri.path());
    let path = uri.path();
    let query = uri.query().unwrap_or("");

    // Enforce body limits based on endpoint classification:
    // Blob uploads respect blob.max_object (streaming friendly), while all other endpoints respect server.body_limit (10MB default).
    // NOTE: Content-Length alone is insufficient (chunked / lying header bypass, H-1).
    // Axum's DefaultBodyLimit (10 MB, app.rs) is the authoritative backstop for
    // non-blob routes; here we fail fast on declared length and flag chunked
    // bodies without a length so operators can observe the bypass vector.
    let is_blob_route = path.starts_with("/api/v1/blobs");
    let body_limit = resolve_body_limit(&req, is_blob_route);

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
    } else if let Some(te) = req.headers().get("transfer-encoding") {
        // No declarable length: non-blob routes rely on axum DefaultBodyLimit;
        // blob routes rely on blob.max_object streaming cap. Emit observability.
        if let Ok(te_str) = te.to_str() {
            if te_str.to_ascii_lowercase().contains("chunked") && !is_blob_route {
                tracing::debug!("WAF: chunked request without content-length on non-blob route; deferred to DefaultBodyLimit");
            }
        }
    }

    if raw_uri.len() > 2048 || path.len() + query.len() > 2048 {
        return Err(AxiomError::new(
            "WAF_URI_TOO_LONG",
            "URI exceeds 2048 characters",
            axum::http::StatusCode::URI_TOO_LONG,
        ));
    }

    if path.contains('\0')
        || query.contains('\0')
        || raw_uri.to_ascii_lowercase().contains("%00")
        || raw_uri.contains("%u0000")
        || raw_uri.contains("%U0000")
    {
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
        || path.contains('\t')
        || query.contains('%')
        || query.contains('.')
        || query.contains(' ')
        || query.contains('\t')
        || query.contains(';')
        || raw_uri.contains("..")
        || raw_uri.contains('\u{ff0e}')
    {
        let mut combined = format!("{}?{}", path, query).to_lowercase();
        // Decode up to 5 times to prevent multi-encoding bypasses (cap length to avoid DoS)
        for _ in 0..5 {
            if combined.len() > 8192 {
                break;
            }
            let decoded = urlencoding::decode(&combined)
                .unwrap_or(std::borrow::Cow::Borrowed(&combined))
                .to_string();
            if decoded == combined {
                break;
            }
            combined = decoded.to_lowercase();
        }

        if combined.contains('\0') || combined.contains("%00") || combined.contains("%u0000") {
            return Err(AxiomError::new(
                "WAF_NULL_BYTE",
                "Null byte detected",
                axum::http::StatusCode::BAD_REQUEST,
            ));
        }

        // Normalize Unicode homoglyphs / fullwidth characters attempting traversal evasion (SEC-5.1)
        let combined = combined
            .replace('\u{ff0e}', ".")
            .replace('\u{ff0f}', "/")
            .replace('\u{ff3c}', "\\");

        if combined.contains("..") || raw_uri.contains("..") || raw_uri.contains('\u{ff0e}') {
            return Err(AxiomError::new(
                "WAF_PATH_TRAVERSAL",
                "Path traversal attempt detected",
                axum::http::StatusCode::BAD_REQUEST,
            ));
        }

        // SQL injection attempt in URL path parameters (defense-in-depth; body SQL is AST firewall job)
        // Static assets and UI routes (/system, /favicon.ico) do not execute SQL queries
        let is_ui_path = path.starts_with("/system") || path == "/favicon.ico";
        if !is_ui_path {
            let normalized = normalize_for_sqli(&combined);
            if contains_sqli(&normalized)
                || contains_sqli(&normalize_for_sqli(&path.to_lowercase()))
            {
                return Err(AxiomError::new(
                    "WAF_SQL_INJECTION",
                    "SQL injection attempt in URL detected",
                    axum::http::StatusCode::BAD_REQUEST,
                ));
            }
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
            .route("/system/assets/*path", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(waf_middleware))
    }

    #[tokio::test]
    async fn test_waf_asset_double_hyphen_allowed() {
        let app = build_waf_test_app();
        let res = app
            .oneshot(
                Request::get("/system/assets/ConfirmDialog-B--_7dTm.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
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
    async fn test_waf_unicode_homoglyph_traversal_blocked() {
        let app = build_waf_test_app();
        let res = app
            .oneshot(Request::get("/test/\u{ff0e}\u{ff0e}/etc/passwd").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
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
    #[tokio::test]
    async fn test_waf_natural_search_and_or_not_rejected() {
        let app = build_waf_test_app();

        // Natural language query with "and" should be allowed
        let res = app
            .clone()
            .oneshot(
                Request::get("/test?search=bread%20and%20butter")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // Natural language query with "or" should be allowed
        let res2 = app
            .clone()
            .oneshot(
                Request::get("/test?filter=apples%20or%20oranges")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res2.status(), StatusCode::OK);

        // Actual SQL boolean injection with 1=1 should still be blocked
        let res_sqli = app
            .oneshot(
                Request::get("/test?id=1%20or%201=1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_sqli.status(), StatusCode::BAD_REQUEST);
    }
}

/*
 * Anti-CSRF and Cross-Site Origin Verification Middleware.
 * Owned by: crates/api (middleware)
 * Key deps: axum, axiom_core
 * Invariants: State-modifying requests authenticated via ambient session cookies
 *             must never originate from untrusted cross-site origins.
 */

use axiom_core::AxiomError;
use axum::{
    body::Body,
    extract::Request,
    http::{header, Method, StatusCode, Uri},
    middleware::Next,
    response::Response,
};

/// Validates that state-modifying requests authenticated via ambient browser cookies
/// (`axiom_session`) originate from the same site and not an unauthorized third-party origin.
/// CONTRACT:
///  - Precondition: Evaluated on incoming requests before protected handlers.
///  - Safe methods (GET, HEAD, OPTIONS) bypass CSRF enforcement.
///  - Explicit credential headers (`Authorization: Bearer`, `X-Axiom-Key`) bypass CSRF enforcement
///    as modern browsers cannot send these ambiently or cross-site without CORS approval.
///  - Requests with `Sec-Fetch-Site: cross-site` authenticated via ambient cookie are rejected (403).
///  - Requests with an untrusted `Origin` header are rejected (403).
pub async fn csrf_middleware(req: Request<Body>, next: Next) -> Result<Response, AxiomError> {
    let method = req.method();

    // 1. Safe HTTP methods cannot alter state - bypass check
    if method == Method::GET || method == Method::HEAD || method == Method::OPTIONS {
        return Ok(next.run(req).await);
    }

    // 2. Check if request relies on ambient browser session cookies
    let has_auth_header = req.headers().contains_key(header::AUTHORIZATION)
        || req.headers().contains_key("x-axiom-key")
        || req.headers().contains_key("x-api-key");

    let has_session_cookie = req
        .headers()
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .map(|cookie_str| cookie_str.contains("axiom_session="))
        .unwrap_or(false);

    // If request has explicit Authorization or API key headers, it is a direct client/CLI call.
    // If it has NO session cookie, ambient CSRF is not applicable.
    if has_auth_header || !has_session_cookie {
        return Ok(next.run(req).await);
    }

    // 3. W3C Sec-Fetch-Site Header Verification (Fetch Metadata Request Headers)
    // Modern browsers automatically attach this metadata; cross-site requests carry "cross-site".
    if let Some(sec_fetch_site) = req
        .headers()
        .get("sec-fetch-site")
        .and_then(|h| h.to_str().ok())
    {
        if sec_fetch_site.eq_ignore_ascii_case("cross-site") {
            tracing::warn!(
                "CSRF violation blocked: mutating request has Sec-Fetch-Site: cross-site"
            );
            return Err(AxiomError::new(
                "CSRF_CROSS_SITE_REJECTED",
                "Cross-site state-modifying requests authenticated via cookies are rejected",
                StatusCode::FORBIDDEN,
            ));
        }
    }

    // 4. Origin & Referer Header Verification
    // Browsers always send an Origin header for mutating POST, PUT, DELETE, PATCH requests.
    let config = axiom_core::ConfigManager::get();
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    if let Some(origin) = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|h| h.to_str().ok())
    {
        if !is_origin_allowed(origin, host, &config.server.cors_origins) {
            tracing::warn!(
                origin = origin,
                host = host,
                "CSRF violation blocked: Origin header does not match host or allowed origins"
            );
            return Err(AxiomError::new(
                "CSRF_ORIGIN_MISMATCH",
                "Origin header does not match server host or authorized origins",
                StatusCode::FORBIDDEN,
            ));
        }
    } else if let Some(referer) = req
        .headers()
        .get(header::REFERER)
        .and_then(|h| h.to_str().ok())
    {
        if let Ok(uri) = referer.parse::<Uri>() {
            let referer_host = uri.authority().map(|a| a.as_str()).unwrap_or("");
            let referer_origin =
                format!("{}://{}", uri.scheme_str().unwrap_or("http"), referer_host);
            if !referer_host.is_empty()
                && !is_origin_allowed(&referer_origin, host, &config.server.cors_origins)
            {
                tracing::warn!(
                    referer = referer,
                    host = host,
                    "CSRF violation blocked: Referer header origin does not match host or allowed origins"
                );
                return Err(AxiomError::new(
                    "CSRF_REFERER_MISMATCH",
                    "Referer origin does not match server host or authorized origins",
                    StatusCode::FORBIDDEN,
                ));
            }
        }
    }

    Ok(next.run(req).await)
}

/// Helper to check if an origin matches the host or configured CORS origins.
fn is_origin_allowed(origin: &str, host: &str, configured_cors: &[String]) -> bool {
    let clean_origin = origin.trim_end_matches('/');

    // 1. Direct host match (http://host or https://host)
    if let Some(origin_host) = clean_origin
        .strip_prefix("http://")
        .or_else(|| clean_origin.strip_prefix("https://"))
    {
        if !host.is_empty()
            && (origin_host == host || origin_host.starts_with(&format!("{}:", host)))
        {
            return true;
        }
        // Local loopback equivalence (localhost == 127.0.0.1)
        if (origin_host.starts_with("localhost") || origin_host.starts_with("127.0.0.1"))
            && (host.starts_with("localhost") || host.starts_with("127.0.0.1"))
        {
            return true;
        }
    }

    // 2. Allow if wildcard or explicitly present in configured origins
    if configured_cors
        .iter()
        .any(|o| o == "*" || o == clean_origin)
    {
        return true;
    }

    // 3. Default local development origins
    clean_origin == "http://localhost:5173"
        || clean_origin == "http://127.0.0.1:5173"
        || clean_origin == "http://localhost:3000"
        || clean_origin == "http://127.0.0.1:3000"
}

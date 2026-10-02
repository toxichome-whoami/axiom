/*
 * HTTP metrics instrumentation middleware recording request latency, counts, and status codes.
 * Owned by: middleware
 * Key deps: axum, std::time::Instant, crate::metrics::MetricsEngine
 * Invariants: Request paths normalized to low-cardinality static templates; zero heap allocations on hot path.
 * Last structural change: Debloated path normalization to return &'static str and removed hot-path String allocations.
 */

use axum::{extract::Request, middleware::Next, response::Response};

/// Normalizes an inbound HTTP request path into a bounded, low-cardinality static route template.
/// CONTRACT:
///  - Precondition: `path` string slice from request URI.
///  - Returns static path template string without heap allocation.
///  - Side effects: None.
///  - Idempotent: Yes (pure string inspection).
pub fn normalize_path(path: &str) -> &'static str {
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return "/";
    }

    // Data API: /api/v1/db/:alias/...
    if trimmed.starts_with("api/v1/db/") {
        if trimmed.ends_with("/query") {
            return "/api/v1/db/:alias/query";
        } else if trimmed.ends_with("/tables") {
            return "/api/v1/db/:alias/tables";
        } else if trimmed.ends_with("/rows") {
            return "/api/v1/db/:alias/:table/rows";
        } else if trimmed.ends_with("/schema") {
            return "/api/v1/db/:alias/:table/schema";
        } else if trimmed == "api/v1/db/databases" {
            return "/api/v1/db/databases";
        }
        return "/api/v1/db/:alias";
    }

    // Admin API parameterized routes
    if trimmed.starts_with("admin/v1/") {
        if trimmed.starts_with("admin/v1/keys") {
            return if trimmed == "admin/v1/keys" { "/admin/v1/keys" } else { "/admin/v1/keys/:name" };
        } else if trimmed.starts_with("admin/v1/roles") {
            return if trimmed == "admin/v1/roles" { "/admin/v1/roles" } else { "/admin/v1/roles/:name" };
        } else if trimmed.starts_with("admin/v1/databases") {
            return if trimmed == "admin/v1/databases" { "/admin/v1/databases" } else { "/admin/v1/databases/:alias" };
        } else if trimmed == "admin/v1/status" {
            return "/admin/v1/status";
        } else if trimmed == "admin/v1/audit" {
            return "/admin/v1/audit";
        }
        return "/admin/v1";
    }

    // Fixed utility routes
    if trimmed == "health" {
        return "/health";
    }
    if trimmed == "metrics" {
        return "/metrics";
    }
    if trimmed == "ready" {
        return "/ready";
    }
    if trimmed.starts_with("mcp/v1") {
        return "/mcp/v1";
    }
    if trimmed.starts_with("ui") {
        return "/ui";
    }

    "/other"
}

/// Intercepts requests to record duration, method, path, and HTTP status in MetricsEngine.
/// CONTRACT:
///  - Precondition: Mounted in Axum layer pipeline.
///  - Returns: Upstream Response unmodified.
///  - Side effects: Updates atomic metrics counters in MetricsEngine with zero heap allocations.
///  - Idempotent: No (increments counters).
pub async fn metrics_middleware(req: Request, next: Next) -> Response {
    let start = std::time::Instant::now();
    let method: &'static str = match *req.method() {
        axum::http::Method::GET => "GET",
        axum::http::Method::POST => "POST",
        axum::http::Method::PUT => "PUT",
        axum::http::Method::DELETE => "DELETE",
        axum::http::Method::PATCH => "PATCH",
        axum::http::Method::HEAD => "HEAD",
        axum::http::Method::OPTIONS => "OPTIONS",
        _ => "OTHER",
    };
    let normalized = normalize_path(req.uri().path());

    let response = next.run(req).await;

    let duration_secs = start.elapsed().as_secs_f64();
    let status = response.status().as_u16();

    crate::metrics::MetricsEngine::record_http_request(method, normalized, status, duration_secs);

    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path() {
        assert_eq!(normalize_path("/api/v1/db/pg_main/users/rows"), "/api/v1/db/:alias/:table/rows");
        assert_eq!(normalize_path("/api/v1/db/pg_main/query"), "/api/v1/db/:alias/query");
        assert_eq!(normalize_path("/admin/v1/keys/key_123"), "/admin/v1/keys/:name");
        assert_eq!(normalize_path("/health"), "/health");
        assert_eq!(normalize_path("/metrics"), "/metrics");
        assert_eq!(normalize_path("/"), "/");
    }
}

/*
 * HTTP metrics instrumentation middleware recording request latency, counts, and status codes.
 * Owned by: middleware
 * Key deps: axum, std::time::Instant, crate::metrics::MetricsEngine
 * Invariants: Request paths normalized to low-cardinality templates to prevent metric memory explosion.
 * Last structural change: Phase 6 initial implementation of HTTP Prometheus metrics middleware.
 */

use axum::{extract::Request, middleware::Next, response::Response};

/// Normalizes an inbound HTTP request path into a bounded, low-cardinality route template.
/// CONTRACT:
///  - Precondition: `path` string from request URI.
///  - Returns static or parameterized path template string.
///  - Side effects: None.
///  - Idempotent: Yes (pure string transformation).
pub fn normalize_path(path: &str) -> String {
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }

    let segments: Vec<&str> = trimmed.split('/').collect();

    // Data API: /api/v1/db/:alias/query
    if segments.len() == 5 && segments[0] == "api" && segments[1] == "v1" && segments[2] == "db" && segments[4] == "query" {
        return "/api/v1/db/:alias/query".to_string();
    }
    // Data API: /api/v1/db/:alias/tables
    if segments.len() == 5 && segments[0] == "api" && segments[1] == "v1" && segments[2] == "db" && segments[4] == "tables" {
        return "/api/v1/db/:alias/tables".to_string();
    }
    // Data API: /api/v1/db/:alias/:table/rows
    if segments.len() == 6 && segments[0] == "api" && segments[1] == "v1" && segments[2] == "db" && segments[5] == "rows" {
        return "/api/v1/db/:alias/:table/rows".to_string();
    }
    // Data API: /api/v1/db/:alias/:table/schema
    if segments.len() == 6 && segments[0] == "api" && segments[1] == "v1" && segments[2] == "db" && segments[5] == "schema" {
        return "/api/v1/db/:alias/:table/schema".to_string();
    }
    // Data API: /api/v1/db/databases
    if segments.len() == 4 && segments[0] == "api" && segments[1] == "v1" && segments[2] == "db" && segments[3] == "databases" {
        return "/api/v1/db/databases".to_string();
    }
    // Admin API parameterized routes
    if segments.len() == 4 && segments[0] == "admin" && segments[1] == "v1" {
        if segments[2] == "keys" {
            return "/admin/v1/keys/:name".to_string();
        } else if segments[2] == "roles" {
            return "/admin/v1/roles/:name".to_string();
        } else if segments[2] == "databases" {
            return "/admin/v1/databases/:alias".to_string();
        }
    }
    // Fixed routes: /health, /ready, /metrics, /mcp/v1, /admin/v1/*
    if segments.len() <= 3 {
        return format!("/{}", trimmed);
    }

    // Default bounded fallback
    format!("/{}/...", segments[0])
}

/// Intercepts requests to record duration, method, path, and HTTP status in MetricsEngine.
/// CONTRACT:
///  - Precondition: Mounted in Axum layer pipeline.
///  - Returns: Upstream Response unmodified.
///  - Side effects: Updates AtomicU64 metrics counters in MetricsEngine.
///  - Idempotent: No (increments counters).
pub async fn metrics_middleware(req: Request, next: Next) -> Response {
    let start = std::time::Instant::now();
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();

    let response = next.run(req).await;

    let duration_secs = start.elapsed().as_secs_f64();
    let status = response.status().as_u16();

    // Prevent high-cardinality explosions by normalizing path parameters
    let normalized = normalize_path(&path);
    crate::metrics::MetricsEngine::record_http_request(&method, &normalized, status, duration_secs);

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

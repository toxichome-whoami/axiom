/*
 * Prometheus metrics collection engine and text exposition generator.
 * Owned by: crates/api (metrics)
 * Key deps: std::sync::atomic::{AtomicU64, Ordering}, axiom_cache
 * Invariants:
 *  - Metric recording on the request/query hot path is 100% lock-free and allocation-free.
 *  - Does not leak internal database aliases, query syntax, or private paths to public metrics scrapers.
 * Last structural change: Debloated to lightweight atomics and eliminated sensitive inner data exposition.
 */

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};

// ─── Lightweight Atomic Counter Storage ─────────────────────────────────────
// Uses fixed-size atomic counters to guarantee zero heap allocations and sub-nanosecond
// hot-path performance without unbounded label cardinality or memory leaks.

static HTTP_REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static HTTP_ERRORS_TOTAL: AtomicU64 = AtomicU64::new(0);
static AUTH_FAILURES_TOTAL: AtomicU64 = AtomicU64::new(0);
static RATE_LIMIT_REJECTIONS_TOTAL: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
pub struct MetricsSnapshot {
    pub http_requests_total: u64,
    pub http_errors_total: u64,
    pub process_uptime_seconds: f64,
}

pub struct MetricsEngine;

impl MetricsEngine {
    /// Returns a structured metrics snapshot for JSON serialization.
    /// CONTRACT:
    ///  - Returns `MetricsSnapshot` containing clean, debloated counters.
    ///  - Idempotent: Yes.
    #[inline]
    pub fn snapshot() -> MetricsSnapshot {
        MetricsSnapshot {
            http_requests_total: HTTP_REQUESTS_TOTAL.load(Ordering::Relaxed),
            http_errors_total: HTTP_ERRORS_TOTAL.load(Ordering::Relaxed),
            process_uptime_seconds: crate::core::health::get_uptime(),
        }
    }
    /// Increments the aggregate HTTP request and error counters.
    /// CONTRACT:
    ///  - Precondition: `status` is the HTTP response code.
    ///  - Side effects: Updates lock-free atomic counters (zero heap allocations).
    ///  - Idempotent: No (increments counters).
    #[inline]
    pub fn record_http_request(_method: &str, _path: &str, status: u16, _duration_secs: f64) {
        HTTP_REQUESTS_TOTAL.fetch_add(1, Ordering::Relaxed);
        if status >= 400 {
            HTTP_ERRORS_TOTAL.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// No-op query recorder stub maintaining API contract without collecting internal DB query metrics.
    /// CONTRACT:
    ///  - Side effects: None.
    ///  - Idempotent: Yes.
    #[inline]
    pub fn record_db_query(_alias: &str, _operation: &str, _duration_secs: f64) {}

    /// Records a failed authentication attempt.
    /// CONTRACT:
    ///  - Side effects: Increments atomic failure counter.
    ///  - Idempotent: No (increments counter).
    #[inline]
    pub fn record_auth_failure(_reason: &str) {
        AUTH_FAILURES_TOTAL.fetch_add(1, Ordering::Relaxed);
    }

    /// Records a rate-limit rejection event.
    /// CONTRACT:
    ///  - Side effects: Increments atomic rejection counter.
    ///  - Idempotent: No (increments counter).
    #[inline]
    pub fn record_rate_limit_rejection() {
        RATE_LIMIT_REJECTIONS_TOTAL.fetch_add(1, Ordering::Relaxed);
    }

    /// Renders debloated, operational metrics into standard Prometheus exposition format (0.0.4).
    /// CONTRACT:
    ///  - Returns text/plain formatted string conforming to Prometheus scraping standards.
    ///  - Does not leak live cache internals, auth failure counters, database query counters, or internal secrets.
    ///  - Idempotent: Yes (pure observation).
    pub fn render_prometheus() -> String {
        let mut out = String::with_capacity(512);

        out.push_str("# HELP axiom_http_requests_total Total number of HTTP requests processed\n");
        out.push_str("# TYPE axiom_http_requests_total counter\n");
        out.push_str(&format!(
            "axiom_http_requests_total {}\n",
            HTTP_REQUESTS_TOTAL.load(Ordering::Relaxed)
        ));

        out.push_str("# HELP axiom_http_errors_total Total number of HTTP requests resulting in 4xx or 5xx\n");
        out.push_str("# TYPE axiom_http_errors_total counter\n");
        out.push_str(&format!(
            "axiom_http_errors_total {}\n",
            HTTP_ERRORS_TOTAL.load(Ordering::Relaxed)
        ));

        out.push_str("# HELP axiom_process_uptime_seconds Gateway uptime in seconds\n");
        out.push_str("# TYPE axiom_process_uptime_seconds gauge\n");
        out.push_str(&format!(
            "axiom_process_uptime_seconds {:.2}\n",
            crate::core::health::get_uptime()
        ));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_http_request_and_render_prometheus() {
        MetricsEngine::record_http_request("GET", "/health", 200, 0.015);
        let rendered = MetricsEngine::render_prometheus();
        assert!(rendered.contains("axiom_http_requests_total"));
        assert!(rendered.contains("axiom_process_uptime_seconds"));
    }


    #[test]
    fn test_snapshot_json() {
        MetricsEngine::record_http_request("POST", "/api/v1/query", 500, 0.02);
        let snap = MetricsEngine::snapshot();
        assert!(snap.http_requests_total > 0);
        assert!(snap.http_errors_total > 0);
        let json_str = serde_json::to_string(&snap).unwrap();
        assert!(json_str.contains("http_requests_total"));
        assert!(json_str.contains("http_errors_total"));
    }
}

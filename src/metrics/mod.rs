/*
 * Prometheus metrics collection engine and text exposition generator.
 * Owned by: metrics
 * Key deps: dashmap::DashMap, std::sync::atomic
 * Invariants: Metric recording on request hot path is lock-free and sub-microsecond.
 * Last structural change: Phase 6 initial implementation of Prometheus metrics engine.
 */

use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU64, Ordering};

// ─── Labeled Counter Storage ───────────────────────────────────────────────

type MetricMap = DashMap<String, AtomicU64>;

static HTTP_REQUESTS_TOTAL: Lazy<MetricMap> = Lazy::new(DashMap::new);
static HTTP_DURATION_SECS_SUM: Lazy<MetricMap> = Lazy::new(DashMap::new);
static DB_QUERIES_TOTAL: Lazy<MetricMap> = Lazy::new(DashMap::new);
static DB_DURATION_SECS_SUM: Lazy<MetricMap> = Lazy::new(DashMap::new);
static AUTH_FAILURES_TOTAL: Lazy<MetricMap> = Lazy::new(DashMap::new);
static RATE_LIMIT_REJECTIONS_TOTAL: AtomicU64 = AtomicU64::new(0);

pub struct MetricsEngine;

impl MetricsEngine {
    /// Increments the HTTP request counter and records request duration.
    /// CONTRACT:
    ///  - Precondition: `path` should be normalized to avoid high-cardinality label explosions.
    ///  - Side effects: Updates lock-free DashMap counters.
    ///  - Idempotent: No (increments counters).
    pub fn record_http_request(method: &str, path: &str, status: u16, duration_secs: f64) {
        let label_key = format!("method=\"{}\",path=\"{}\",status=\"{}\"", method, path, status);
        HTTP_REQUESTS_TOTAL
            .entry(label_key)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(1, Ordering::Relaxed);

        let dur_key = format!("method=\"{}\",path=\"{}\"", method, path);
        let millis = (duration_secs * 1000.0) as u64;
        HTTP_DURATION_SECS_SUM
            .entry(dur_key)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(millis, Ordering::Relaxed);
    }

    /// Increments the database query counter and records execution duration.
    /// CONTRACT:
    ///  - Precondition: `alias` is the database identifier, `operation` is SELECT/INSERT/etc.
    ///  - Side effects: Updates query execution counters.
    pub fn record_db_query(alias: &str, operation: &str, duration_secs: f64) {
        let label_key = format!("alias=\"{}\",operation=\"{}\"", alias, operation);
        DB_QUERIES_TOTAL
            .entry(label_key)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(1, Ordering::Relaxed);

        let dur_key = format!("alias=\"{}\"", alias);
        let millis = (duration_secs * 1000.0) as u64;
        DB_DURATION_SECS_SUM
            .entry(dur_key)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(millis, Ordering::Relaxed);
    }

    /// Records a failed authentication attempt with a failure reason.
    /// CONTRACT:
    ///  - Precondition: `reason` is an identifier such as "invalid_credentials" or "key_suspended".
    ///  - Side effects: Increments failure counter in DashMap.
    ///  - Idempotent: No (increments counter).
    pub fn record_auth_failure(reason: &str) {
        let label_key = format!("reason=\"{}\"", reason);
        AUTH_FAILURES_TOTAL
            .entry(label_key)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(1, Ordering::Relaxed);
    }

    /// Records a rate-limit rejection event.
    /// CONTRACT:
    ///  - Side effects: Increments atomic rejection counter.
    ///  - Idempotent: No (increments counter).
    pub fn record_rate_limit_rejection() {
        RATE_LIMIT_REJECTIONS_TOTAL.fetch_add(1, Ordering::Relaxed);
    }

    /// Renders all registered metrics into standard Prometheus exposition format (0.0.4).
    /// CONTRACT:
    ///  - Returns text/plain formatted string conforming to Prometheus scraping standards.
    ///  - Pulls cache metrics live from `CacheEngine::stats()`.
    ///  - Idempotent: Yes (pure observation).
    pub fn render_prometheus() -> String {
        let mut out = String::with_capacity(4096);

        out.push_str("# HELP axiom_http_requests_total Total number of HTTP requests processed\n");
        out.push_str("# TYPE axiom_http_requests_total counter\n");
        for entry in HTTP_REQUESTS_TOTAL.iter() {
            out.push_str(&format!(
                "axiom_http_requests_total{{{}}} {}\n",
                entry.key(),
                entry.value().load(Ordering::Relaxed)
            ));
        }

        out.push_str("# HELP axiom_http_request_duration_seconds_total Total duration of HTTP requests in seconds\n");
        out.push_str("# TYPE axiom_http_request_duration_seconds_total counter\n");
        for entry in HTTP_DURATION_SECS_SUM.iter() {
            let secs = entry.value().load(Ordering::Relaxed) as f64 / 1000.0;
            out.push_str(&format!(
                "axiom_http_request_duration_seconds_total{{{}}} {:.4}\n",
                entry.key(),
                secs
            ));
        }

        out.push_str("# HELP axiom_db_queries_total Total number of database queries executed\n");
        out.push_str("# TYPE axiom_db_queries_total counter\n");
        for entry in DB_QUERIES_TOTAL.iter() {
            out.push_str(&format!(
                "axiom_db_queries_total{{{}}} {}\n",
                entry.key(),
                entry.value().load(Ordering::Relaxed)
            ));
        }

        out.push_str("# HELP axiom_db_query_duration_seconds_total Total duration of database queries in seconds\n");
        out.push_str("# TYPE axiom_db_query_duration_seconds_total counter\n");
        for entry in DB_DURATION_SECS_SUM.iter() {
            let secs = entry.value().load(Ordering::Relaxed) as f64 / 1000.0;
            out.push_str(&format!(
                "axiom_db_query_duration_seconds_total{{{}}} {:.4}\n",
                entry.key(),
                secs
            ));
        }

        // Live Cache Metrics from CacheEngine
        let cache_stats = crate::cache::CacheEngine::stats();
        out.push_str("# HELP axiom_cache_hits_total Total number of cache hits\n");
        out.push_str("# TYPE axiom_cache_hits_total counter\n");
        out.push_str(&format!("axiom_cache_hits_total{{tier=\"l1\"}} {}\n", cache_stats.hits_l1));
        out.push_str(&format!("axiom_cache_hits_total{{tier=\"l2\"}} {}\n", cache_stats.hits_l2));

        out.push_str("# HELP axiom_cache_misses_total Total number of cache misses\n");
        out.push_str("# TYPE axiom_cache_misses_total counter\n");
        out.push_str(&format!("axiom_cache_misses_total {}\n", cache_stats.misses));

        out.push_str("# HELP axiom_cache_evictions_total Total number of LRU cache evictions\n");
        out.push_str("# TYPE axiom_cache_evictions_total counter\n");
        out.push_str(&format!("axiom_cache_evictions_total {}\n", cache_stats.evictions));

        out.push_str("# HELP axiom_cache_entries Active entries in L1 RAM cache\n");
        out.push_str("# TYPE axiom_cache_entries gauge\n");
        out.push_str(&format!("axiom_cache_entries {}\n", cache_stats.entries_count));

        out.push_str("# HELP axiom_auth_failures_total Total number of failed authentication attempts\n");
        out.push_str("# TYPE axiom_auth_failures_total counter\n");
        for entry in AUTH_FAILURES_TOTAL.iter() {
            out.push_str(&format!(
                "axiom_auth_failures_total{{{}}} {}\n",
                entry.key(),
                entry.value().load(Ordering::Relaxed)
            ));
        }

        out.push_str("# HELP axiom_rate_limit_rejections_total Total number of rate-limit rejections\n");
        out.push_str("# TYPE axiom_rate_limit_rejections_total counter\n");
        out.push_str(&format!(
            "axiom_rate_limit_rejections_total {}\n",
            RATE_LIMIT_REJECTIONS_TOTAL.load(Ordering::Relaxed)
        ));

        // Process runtime statistics
        let (cpu, mem_mb) = crate::api::core::health::get_system_stats();
        let uptime = crate::api::core::health::get_uptime();

        out.push_str("# HELP axiom_process_uptime_seconds Gateway uptime in seconds\n");
        out.push_str("# TYPE axiom_process_uptime_seconds gauge\n");
        out.push_str(&format!("axiom_process_uptime_seconds {:.2}\n", uptime));

        out.push_str("# HELP axiom_process_cpu_usage_percent CPU usage percentage\n");
        out.push_str("# TYPE axiom_process_cpu_usage_percent gauge\n");
        out.push_str(&format!("axiom_process_cpu_usage_percent {:.2}\n", cpu));

        out.push_str("# HELP axiom_process_memory_mb Resident set size memory in megabytes\n");
        out.push_str("# TYPE axiom_process_memory_mb gauge\n");
        out.push_str(&format!("axiom_process_memory_mb {}\n", mem_mb));

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
        assert!(rendered.contains("axiom_http_requests_total{method=\"GET\",path=\"/health\",status=\"200\"}"));
        assert!(rendered.contains("axiom_cache_hits_total"));
        assert!(rendered.contains("axiom_process_uptime_seconds"));
    }

    #[test]
    fn test_record_db_query_prometheus() {
        MetricsEngine::record_db_query("main_db", "SELECT", 0.005);
        let rendered = MetricsEngine::render_prometheus();
        assert!(rendered.contains("axiom_db_queries_total{alias=\"main_db\",operation=\"SELECT\"}"));
    }
}

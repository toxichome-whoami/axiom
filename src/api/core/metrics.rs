use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    routing::get,
    Router, Json,
};
use reqwest::header;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use once_cell::sync::Lazy;

// Global Atomic Counters
pub static RATE_LIMIT_HITS: AtomicU64 = AtomicU64::new(0);
pub static AUTH_FAILURES: AtomicU64 = AtomicU64::new(0);
pub static WEBHOOK_DELIVERED: AtomicU64 = AtomicU64::new(0);
pub static WEBHOOK_FAILED: AtomicU64 = AtomicU64::new(0);
pub static CACHE_HITS: AtomicU64 = AtomicU64::new(0);
pub static CACHE_MISSES: AtomicU64 = AtomicU64::new(0);
pub static DB_QUERIES_TOTAL: AtomicU64 = AtomicU64::new(0);
pub static DB_QUERY_ERRORS: AtomicU64 = AtomicU64::new(0);

static START_TIME: Lazy<std::time::Instant> = Lazy::new(std::time::Instant::now);

pub fn increment(metric: &str) {
    match metric {
        "rate_limit_hits" => RATE_LIMIT_HITS.fetch_add(1, Ordering::Relaxed),
        "auth_failures" => AUTH_FAILURES.fetch_add(1, Ordering::Relaxed),
        "webhook_delivered" => WEBHOOK_DELIVERED.fetch_add(1, Ordering::Relaxed),
        "webhook_failed" => WEBHOOK_FAILED.fetch_add(1, Ordering::Relaxed),
        "cache_hits" => CACHE_HITS.fetch_add(1, Ordering::Relaxed),
        "cache_misses" => CACHE_MISSES.fetch_add(1, Ordering::Relaxed),
        "db_queries_total" => DB_QUERIES_TOTAL.fetch_add(1, Ordering::Relaxed),
        "db_query_errors" => DB_QUERY_ERRORS.fetch_add(1, Ordering::Relaxed),
        _ => 0,
    };
}

pub fn get_router() -> Router {
    Router::new().route("/metrics", get(metrics_endpoint))
}

fn format_metric(name: &str, value: u64, help: &str, metric_type: &str) -> String {
    format!("# HELP {} {}\n# TYPE {} {}\n{} {}\n", name, help, name, metric_type, name, value)
}

fn format_gauge(name: &str, value: f64, help: &str, metric_type: &str) -> String {
    format!("# HELP {} {}\n# TYPE {} {}\n{} {:.2}\n", name, help, name, metric_type, name, value)
}

async fn metrics_endpoint(Query(params): Query<HashMap<String, String>>) -> Response {
    let format = params.get("format").map(|s| s.as_str()).unwrap_or("prometheus");
    let uptime = START_TIME.elapsed().as_secs_f64();

    // System stats stubbed out to avoid heavy C-bindings
    let mem_mb = 0.0;
    let cpu_pct = 0.0;
    let avg_duration = 0.0;
    let p99 = 0.0;

    let rlimit = RATE_LIMIT_HITS.load(Ordering::Relaxed);
    let auth = AUTH_FAILURES.load(Ordering::Relaxed);
    let wd = WEBHOOK_DELIVERED.load(Ordering::Relaxed);
    let wf = WEBHOOK_FAILED.load(Ordering::Relaxed);
    let ch = CACHE_HITS.load(Ordering::Relaxed);
    let cm = CACHE_MISSES.load(Ordering::Relaxed);
    let dbq = DB_QUERIES_TOTAL.load(Ordering::Relaxed);
    let dbe = DB_QUERY_ERRORS.load(Ordering::Relaxed);

    if format == "json" {
        return Json(json!({
            "status": "online",
            "uptime_seconds": uptime,
            "system": {
                "memory_mb": mem_mb,
                "cpu_percent": cpu_pct
            },
            "performance": {
                "avg_request_ms": avg_duration,
                "p99_request_ms": p99
            },
            "counters": {
                "rate_limit_hits": rlimit,
                "auth_failures": auth,
                "cache": {
                    "hits": ch,
                    "misses": cm
                },
                "database": {
                    "queries": dbq,
                    "errors": dbe
                },
                "webhooks": {
                    "delivered": wd,
                    "failed": wf
                }
            }
        })).into_response();
    }

    let mut output = String::from("# Axiom Metrics\n");
    output.push_str(&format_gauge("axiom_uptime_seconds", uptime, "Server uptime", "gauge"));
    output.push_str(&format_gauge("axiom_memory_mb", mem_mb, "Memory usage", "gauge"));
    output.push_str(&format_gauge("axiom_cpu_percent", cpu_pct, "CPU usage", "gauge"));
    output.push_str(&format_gauge("axiom_request_duration_avg_ms", avg_duration, "Avg latency", "gauge"));
    output.push_str(&format_gauge("axiom_request_duration_p99_ms", p99, "P99 latency", "gauge"));
    
    output.push_str(&format_metric("axiom_rate_limit_hits_total", rlimit, "", "counter"));
    output.push_str(&format_metric("axiom_auth_failures_total", auth, "", "counter"));
    output.push_str(&format_metric("axiom_webhook_delivered_total", wd, "", "counter"));
    output.push_str(&format_metric("axiom_webhook_failed_total", wf, "", "counter"));
    output.push_str(&format_metric("axiom_cache_hits_total", ch, "", "counter"));
    output.push_str(&format_metric("axiom_cache_misses_total", cm, "", "counter"));
    output.push_str(&format_metric("axiom_db_queries_total", dbq, "", "counter"));
    output.push_str(&format_metric("axiom_db_query_errors_total", dbe, "", "counter"));

    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        output
    ).into_response()
}

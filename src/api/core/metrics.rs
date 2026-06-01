use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use reqwest::header;
use serde_json::json;
use std::collections::HashMap;

pub fn get_router() -> Router {
    Router::new().route("/metrics", get(metrics_endpoint))
}



fn format_gauge(name: &str, value: f64, help: &str, metric_type: &str) -> String {
    format!(
        "# HELP {} {}\n# TYPE {} {}\n{} {:.2}\n",
        name, help, name, metric_type, name, value
    )
}

async fn metrics_endpoint(Query(params): Query<HashMap<String, String>>) -> Response {
    let format = params
        .get("format")
        .map(|s| s.as_str())
        .unwrap_or("prometheus");
    let uptime = crate::api::core::health::get_uptime();
    let (cpu_pct, mem_mb) = crate::api::core::health::get_system_stats();

    if format == "json" {
        return Json(json!({
            "status": "online",
            "uptime_seconds": uptime,
            "system": {
                "memory_mb": mem_mb,
                "cpu_percent": cpu_pct
            }
        }))
        .into_response();
    }

    let mut output = String::from("# Axiom Metrics\n");
    output.push_str(&format_gauge(
        "axiom_uptime_seconds",
        uptime,
        "Server uptime",
        "gauge",
    ));
    output.push_str(&format_gauge(
        "axiom_memory_mb",
        mem_mb as f64,
        "Memory usage",
        "gauge",
    ));
    output.push_str(&format_gauge(
        "axiom_cpu_percent",
        cpu_pct as f64,
        "CPU usage",
        "gauge",
    ));



    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        output,
    )
        .into_response()
}

/*
 * Axum application router assembly, CORS policy, security header layer, and middleware pipeline.
 * Owned by: server
 * Key deps: axum, tower_http, crate::middleware, crate::config, crate::api::admin, crate::api::mcp
 * Invariants: Middleware order is strictly WAF -> Rate Limit -> Auth -> Handlers; security headers attached to all responses.
 * Last structural change: Phase 4 mounting /mcp/v1 Model Context Protocol router.
 */

use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::middleware::{
    auth::auth_middleware, rate_limit::rate_limit_middleware, waf::waf_middleware,
};
use axum::http::header;
use axum::{http::StatusCode, middleware, response::IntoResponse, routing::get, Json, Router};
use serde_json::json;
use tower_http::{
    cors::{Any, CorsLayer},
    set_header::SetResponseHeaderLayer,
};

async fn fallback_handler() -> impl IntoResponse {
    AxiomError::new(
        "NOT_FOUND",
        "The requested resource was not found.",
        StatusCode::NOT_FOUND,
    )
}

async fn health_check() -> impl IntoResponse {
    Json(json!({"status": "ok", "version": env!("CARGO_PKG_VERSION")}))
}

async fn favicon() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "image/x-icon")],
        include_bytes!("../icon/favicon.ico"),
    )
}

async fn prometheus_metrics() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        crate::metrics::MetricsEngine::render_prometheus(),
    )
}

pub fn create_app() -> Router {
    let config = ConfigManager::get();

    let allowed_methods = [
        axum::http::Method::GET,
        axum::http::Method::POST,
        axum::http::Method::PATCH,
        axum::http::Method::DELETE,
        axum::http::Method::HEAD,
        axum::http::Method::OPTIONS,
    ];

    let allowed_headers = [
        header::CONTENT_TYPE,
        header::AUTHORIZATION,
        header::ACCEPT,
        header::ORIGIN,
        header::HeaderName::from_static("x-axiom-key"),
        header::HeaderName::from_static("x-api-key"),
        header::HeaderName::from_static("idempotency-key"),
        header::HeaderName::from_static("x-request-id"),
    ];

    let exposed_headers = [
        header::HeaderName::from_static("x-request-id"),
        header::HeaderName::from_static("x-idempotency-hit"),
        header::HeaderName::from_static("x-ratelimit-limit"),
        header::HeaderName::from_static("x-ratelimit-remaining"),
    ];

    let mut cors = CorsLayer::new()
        .allow_methods(allowed_methods)
        .allow_headers(allowed_headers)
        .expose_headers(exposed_headers);
        
    if config.server.cors_origins.iter().any(|o| o == "*") {
        cors = cors.allow_origin(Any);
    } else {
        let origins: Vec<axum::http::HeaderValue> = config.server.cors_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        cors = cors.allow_origin(tower_http::cors::AllowOrigin::list(origins));
    }
    // Core Routes
    let core_routes =
        crate::api::core::health::get_router();

    // API versioning wrapper
    let api_routes = Router::new()
        .route("/health", get(health_check))
        .nest("/db", crate::api::database::router::get_router())
        .layer(middleware::from_fn(auth_middleware))
        .layer(middleware::from_fn(rate_limit_middleware));

    // Admin API versioning wrapper (auth applied inside get_router for protected routes)
    let admin_routes = crate::api::admin::get_router()
        .layer(middleware::from_fn(rate_limit_middleware));

    // Model Context Protocol (MCP) versioning wrapper
    let mcp_routes = crate::api::mcp::router::get_router()
        .layer(middleware::from_fn(auth_middleware))
        .layer(middleware::from_fn(rate_limit_middleware));

    // Web UI router
    let ui_routes = crate::api::ui::get_router();

    Router::new()
        .nest("/api/v1", api_routes)
        .nest("/admin/v1", admin_routes)
        .nest("/mcp/v1", mcp_routes)
        .nest("/ui", ui_routes)
        .layer(axum::extract::Extension(config.clone()))
        .merge(core_routes)
        .route("/favicon.ico", get(favicon))
        .route("/metrics", get(prometheus_metrics))
        .fallback(fallback_handler)
        .layer(middleware::from_fn(crate::middleware::metrics::metrics_middleware))
        .layer(cors)
        .layer(tower_http::timeout::TimeoutLayer::new(
            std::time::Duration::from_secs(30),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            header::HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            header::HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            header::HeaderValue::from_static("max-age=63072000; includeSubDomains; preload"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static("default-src 'none'; frame-ancestors 'none';"),
        ))
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id())
        .layer(tower_http::request_id::SetRequestIdLayer::x_request_id(tower_http::request_id::MakeRequestUuid))
        .layer(axum::extract::DefaultBodyLimit::max(10 * 1024 * 1024))
        .layer(middleware::from_fn(waf_middleware))
}

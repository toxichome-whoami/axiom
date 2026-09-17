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
        .layer(middleware::from_fn(rate_limit_middleware))
        .layer(middleware::from_fn(waf_middleware))
        ;

    

    Router::new()
        .nest("/api/v1", api_routes)
        .layer(axum::extract::Extension(config.clone()))
        .merge(core_routes)
        .route("/favicon.ico", get(favicon))
        .fallback(fallback_handler)
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
        .layer(tower_http::request_id::SetRequestIdLayer::x_request_id(tower_http::request_id::MakeRequestUuid))
        
        .layer(axum::extract::DefaultBodyLimit::max(10 * 1024 * 1024))
}

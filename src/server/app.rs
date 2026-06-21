use crate::api::errors::AxiomError;
use crate::config::loader::ConfigManager;
use crate::middleware::{
    auth::auth_middleware, rate_limit::rate_limit_middleware, waf::waf_middleware,
};
use axum::http::header;
use axum::{http::StatusCode, middleware, response::IntoResponse, routing::get, Json, Router};
use serde_json::json;
use tower_http::{
    compression::CompressionLayer,
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

    let cors = if config.server.cors_origins.is_empty()
        || config.server.cors_origins.contains(&"*".to_string())
    {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins: Vec<_> = config
            .server
            .cors_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
    };
    // Core Routes
    let core_routes =
        crate::api::core::health::get_router().merge(crate::api::core::metrics::get_router());

    // API versioning wrapper
    let api_routes = Router::new()
        .route("/health", get(health_check))
        .nest("/db", crate::api::database::router::get_router())
        .nest("/mcp", crate::api::mcp::router::get_router())
        .nest("/fs", crate::api::storage::router::get_router())
        .nest("/graphql", crate::api::graphql::router::get_router())
        .route("/ws", get(crate::api::ws::router::ws_handler))
        .nest("/sse", crate::api::sse::router::get_router())
        .nest("/fed", crate::api::federation::router::get_router())
        .nest("/auth", crate::api::auth::router::get_router())
        .layer(middleware::from_fn(auth_middleware))
        .layer(middleware::from_fn(rate_limit_middleware))
        .layer(middleware::from_fn(waf_middleware))
        .layer(middleware::map_response(
            crate::middleware::response::envelope_middleware,
        ));

    Router::new()
        .nest("/api/v1", api_routes)
        .layer(axum::extract::DefaultBodyLimit::max(10 * 1024 * 1024))
        .layer(axum::extract::Extension(config.clone()))
        .merge(core_routes)
        .route("/favicon.ico", get(favicon))
        .fallback(fallback_handler)
        .layer(cors)
        .layer(
            CompressionLayer::new()
                .gzip(true)
                .quality(tower_http::CompressionLevel::Fastest),
        )
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
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static(
                "default-src 'none'; script-src 'none'; style-src 'none'; \
                 img-src 'none'; connect-src 'self'; frame-ancestors 'none'; \
                 base-uri 'none'; form-action 'none'",
            ),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_XSS_PROTECTION,
            header::HeaderValue::from_static("0"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            header::HeaderValue::from_static("no-referrer"),
        ))
        .layer(tower_http::trace::TraceLayer::new_for_http())
}

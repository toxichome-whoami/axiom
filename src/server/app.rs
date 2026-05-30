use axum::{
    routing::{get, post},
    Router,
    middleware,
    Json,
    response::IntoResponse,
    http::StatusCode
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
    set_header::SetResponseHeaderLayer,
    compression::CompressionLayer,
};
use axum::http::header;
use crate::middleware::{auth::auth_middleware, waf::waf_middleware, rate_limit::rate_limit_middleware};
use crate::config::loader::ConfigManager;
use crate::api::errors::AxiomError;
use serde_json::json;

async fn fallback_handler() -> impl IntoResponse {
    AxiomError::new("NOT_FOUND", "The requested resource was not found.", StatusCode::NOT_FOUND)
}

async fn health_check() -> impl IntoResponse {
    Json(json!({"status": "ok", "version": "1.0.5"}))
}

pub fn create_app() -> Router {
    let _config = ConfigManager::get();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api_routes = Router::new()
        .route("/health", get(health_check))
        // Mount feature modules here as they are ported
        // .nest("/db", db_router)
        // .nest("/fs", fs_router)
        .layer(middleware::from_fn(auth_middleware))
        .layer(middleware::from_fn(rate_limit_middleware))
        .layer(middleware::from_fn(waf_middleware));

    Router::new()
        .nest("/api/v1", api_routes)
        .fallback(fallback_handler)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            header::HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            header::HeaderValue::from_static("DENY"),
        ))
}

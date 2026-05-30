use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn get_router() -> Router {
    Router::new()
        .route("/status", get(get_webhook_status))
        .route("/circuit/:hook_name/reset", post(reset_circuit_breaker))
        .route("/dead-letter", get(list_dead_letter))
        .route("/dead-letter/replay", post(replay_dead_letter))
}

async fn get_webhook_status() -> Json<Value> {
    // TODO: Connect to actual circuit breaker and persistence once PyO3 is stripped
    Json(json!({
        "status": "ok",
        "message": "Webhook API running on native Rust"
    }))
}

async fn reset_circuit_breaker(Path(hook_name): Path<String>) -> Json<Value> {
    // TODO: Implement
    Json(json!({
        "status": "ok",
        "message": format!("Circuit breaker for {} reset", hook_name)
    }))
}

async fn list_dead_letter() -> Json<Value> {
    // TODO: Implement
    Json(json!({
        "dead_letters": []
    }))
}

async fn replay_dead_letter(Json(payload): Json<Value>) -> Json<Value> {
    // TODO: Implement
    Json(json!({
        "success": true,
        "replayed": 0
    }))
}

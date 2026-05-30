use axum::{
    extract::{Path, Query},
    response::{sse::{Event, Sse}, IntoResponse},
    routing::get,
    Router,
    http::StatusCode,
};
use tokio_stream::{wrappers::ReceiverStream, StreamExt};
use std::collections::HashMap;
use std::convert::Infallible;
use futures::stream::Stream;
use base64::{engine::general_purpose::STANDARD, Engine};

use crate::api::errors::AxiomError;
use crate::api::sse::connection_manager::{SSEClientScopes, SSE_MGR};
use crate::config::loader::ConfigManager;

pub fn get_router() -> Router {
    Router::new()
        .route("/health", get(sse_health))
        .route("/metrics", get(sse_metrics))
        .route("/db/:alias", get(sse_db))
        .route("/db/:alias/*table", get(sse_db_table))
        .route("/fs/:alias", get(sse_fs))
        .route("/fs/:alias/*path", get(sse_fs_path))
}

fn authenticate_sse(query: &HashMap<String, String>) -> Result<SSEClientScopes, AxiomError> {
    let token = query.get("token").or_else(|| query.get("key"));

    let token_str = match token {
        Some(t) => urlencoding::decode(t).unwrap_or(std::borrow::Cow::Borrowed("")).to_string(),
        None => return Err(AxiomError::new("AUTH_MISSING", "Missing ?key= query parameter", StatusCode::UNAUTHORIZED)),
    };

    let config = ConfigManager::get();

    if let Ok(decoded) = STANDARD.decode(&token_str) {
        if let Ok(creds) = String::from_utf8(decoded) {
            let parts: Vec<&str> = creds.splitn(2, ':').collect();
            if parts.len() == 2 {
                let key_name = parts[0];
                let secret = parts[1];

                if let Some(api_key_cfg) = config.api_key.get(key_name) {
                    if api_key_cfg.secret == secret {
                        return Ok(SSEClientScopes {
                            db_scope: api_key_cfg.db_scope.clone(),
                            fs_scope: api_key_cfg.fs_scope.clone(),
                            full_admin: api_key_cfg.full_admin,
                        });
                    }
                }
            }
        }
    }

    Err(AxiomError::new("AUTH_FAILED", "Invalid API Key", StatusCode::FORBIDDEN))
}

fn topic_in_scope(resource: &str, scope: &[String]) -> bool {
    scope.iter().any(|s| s == "*" || s == resource)
}

async fn create_sse_stream(client_id: String, rx: tokio::sync::mpsc::Receiver<Event>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let config = ConfigManager::get();
    let heartbeat = std::time::Duration::from_secs(config.sse.heartbeat_interval as u64);

    let stream = ReceiverStream::new(rx)
        .map(Ok)
        .throttle(std::time::Duration::from_millis(10)); // Prevent flooding

    // In a real implementation we would inject heartbeats into the stream via `tokio_stream::StreamExt::timeout`.
    // For simplicity of bridging axum's SSE, axum handles KeepAlive natively if we configure Sse::keep_alive().

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(heartbeat)
            .text("heartbeat")
    )
}

async fn sse_health(Query(query): Query<HashMap<String, String>>) -> Result<impl IntoResponse, AxiomError> {
    let auth = authenticate_sse(&query)?;
    if !auth.full_admin {
        return Err(AxiomError::new("FORBIDDEN", "Health stream requires full admin scope", StatusCode::FORBIDDEN));
    }

    let client_id = format!("health_{}", uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, "system:health").await;

    // Disconnect cleanup needs to be handled when the stream drops.
    // Axum doesn't natively expose an OnDisconnect hook for SSE yet without tower wrappers,
    // but the `mpsc::channel` will automatically drop the receiver when the client disconnects,
    // which eventually errors the sender, allowing us to GC it in the publish loop.
    // However, explicit cleanup is better handled via a spawned task.
    let cid_clone = client_id.clone();
    tokio::spawn(async move {
        // Wait for receiver to be dropped by Axum (client disconnect)
        // Unfortunately we can't easily wait on the receiver itself from the outside.
        // The background daemon GC will handle it when it fails to send.
    });

    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_metrics(Query(query): Query<HashMap<String, String>>) -> Result<impl IntoResponse, AxiomError> {
    let auth = authenticate_sse(&query)?;
    if !auth.full_admin {
        return Err(AxiomError::new("FORBIDDEN", "Metrics require full admin scope", StatusCode::FORBIDDEN));
    }

    let client_id = format!("metrics_{}", uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, "metrics").await;

    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_db(Path(alias): Path<String>, Query(query): Query<HashMap<String, String>>) -> Result<impl IntoResponse, AxiomError> {
    let auth = authenticate_sse(&query)?;
    if !topic_in_scope(&alias, &auth.db_scope) {
        return Err(AxiomError::new("FORBIDDEN", &format!("Database '{}' not in scope", alias), StatusCode::FORBIDDEN));
    }

    let client_id = format!("db_{}_{}", alias, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, &format!("db:{}:*", alias)).await;

    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_db_table(Path((alias, table)): Path<(String, String)>, Query(query): Query<HashMap<String, String>>) -> Result<impl IntoResponse, AxiomError> {
    let auth = authenticate_sse(&query)?;
    if !topic_in_scope(&alias, &auth.db_scope) {
        return Err(AxiomError::new("FORBIDDEN", &format!("Database '{}' not in scope", alias), StatusCode::FORBIDDEN));
    }

    let client_id = format!("db_{}_{}_{}", alias, table, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, &format!("db:{}:{}", alias, table)).await;

    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_fs(Path(alias): Path<String>, Query(query): Query<HashMap<String, String>>) -> Result<impl IntoResponse, AxiomError> {
    let auth = authenticate_sse(&query)?;
    if !topic_in_scope(&alias, &auth.fs_scope) {
        return Err(AxiomError::new("FORBIDDEN", &format!("Storage '{}' not in scope", alias), StatusCode::FORBIDDEN));
    }

    let client_id = format!("fs_{}_{}", alias, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, &format!("fs:{}:*", alias)).await;

    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_fs_path(Path((alias, path)): Path<(String, String)>, Query(query): Query<HashMap<String, String>>) -> Result<impl IntoResponse, AxiomError> {
    let auth = authenticate_sse(&query)?;
    if !topic_in_scope(&alias, &auth.fs_scope) {
        return Err(AxiomError::new("FORBIDDEN", &format!("Storage '{}' not in scope", alias), StatusCode::FORBIDDEN));
    }

    let client_id = format!("fs_{}_{}_{}", alias, path, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, &format!("fs:{}:{}", alias, path)).await;

    Ok(create_sse_stream(client_id, rx).await)
}

use axum::{
    extract::{Extension, Path},
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::get,
    Router,
};
use futures::stream::Stream;
use std::convert::Infallible;
use tokio_stream::{wrappers::ReceiverStream, StreamExt};

use crate::api::errors::AxiomError;
use crate::api::sse::connection_manager::SSE_MGR;
use crate::config::loader::ConfigManager;
use crate::utils::types::AuthContext;

pub fn get_router() -> Router {
    Router::new()
        .route("/health", get(sse_health))
        .route("/metrics", get(sse_metrics))
        .route("/db/:alias", get(sse_db))
        .route("/db/:alias/*table", get(sse_db_table))
        .route("/fs/:alias", get(sse_fs))
        .route("/fs/:alias/*path", get(sse_fs_path))
}

fn topic_in_scope(resource: &str, scope: &[String]) -> bool {
    scope.iter().any(|s| s == "*" || s == resource)
}

async fn create_sse_stream(
    _client_id: String,
    rx: tokio::sync::mpsc::Receiver<Event>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let config = ConfigManager::get();
    let heartbeat = std::time::Duration::from_secs(config.sse.heartbeat_interval as u64);

    let stream = ReceiverStream::new(rx)
        .map(Ok)
        .throttle(std::time::Duration::from_millis(10));

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(heartbeat)
            .text("heartbeat"),
    )
}

async fn sse_health(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Health stream requires full admin scope",
            StatusCode::FORBIDDEN,
        ));
    }
    let client_id = format!("health_{}", uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, "system:health").await;
    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_metrics(
    Extension(auth): Extension<AuthContext>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Metrics stream requires full admin scope",
            StatusCode::FORBIDDEN,
        ));
    }
    let client_id = format!("metrics_{}", uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR.subscribe(&client_id, "system:metrics").await;
    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_db(
    Extension(auth): Extension<AuthContext>,
    Path(alias): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    if !topic_in_scope(&alias, &auth.db_scope) {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Database scope forbidden",
            StatusCode::FORBIDDEN,
        ));
    }
    let client_id = format!("db_{}_{}", alias, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR
        .subscribe(&client_id, &format!("db:{}", alias))
        .await;
    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_db_table(
    Extension(auth): Extension<AuthContext>,
    Path((alias, table)): Path<(String, String)>,
) -> Result<impl IntoResponse, AxiomError> {
    if !topic_in_scope(&alias, &auth.db_scope) {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Database scope forbidden",
            StatusCode::FORBIDDEN,
        ));
    }
    let table = table.trim_start_matches('/');
    let client_id = format!("db_table_{}_{}_{}", alias, table, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR
        .subscribe(&client_id, &format!("db:{}:{}", alias, table))
        .await;
    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_fs(
    Extension(auth): Extension<AuthContext>,
    Path(alias): Path<String>,
) -> Result<impl IntoResponse, AxiomError> {
    if !topic_in_scope(&alias, &auth.fs_scope) {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Storage scope forbidden",
            StatusCode::FORBIDDEN,
        ));
    }
    let client_id = format!("fs_{}_{}", alias, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR
        .subscribe(&client_id, &format!("fs:{}", alias))
        .await;
    Ok(create_sse_stream(client_id, rx).await)
}

async fn sse_fs_path(
    Extension(auth): Extension<AuthContext>,
    Path((alias, path)): Path<(String, String)>,
) -> Result<impl IntoResponse, AxiomError> {
    if !topic_in_scope(&alias, &auth.fs_scope) {
        return Err(AxiomError::new(
            "FORBIDDEN",
            "Storage scope forbidden",
            StatusCode::FORBIDDEN,
        ));
    }
    let path = path.trim_start_matches('/');
    let client_id = format!("fs_path_{}_{}_{}", alias, path, uuid::Uuid::new_v4());
    let rx = SSE_MGR.connect(&client_id).await;
    SSE_MGR
        .subscribe(&client_id, &format!("fs:{}:{}", alias, path))
        .await;
    Ok(create_sse_stream(client_id, rx).await)
}

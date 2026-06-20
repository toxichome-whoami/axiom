use axum::{
    extract::{Extension, Query},
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
    routing::{get, post},
    Json, Router,
};
use dashmap::DashMap;
use futures::stream::Stream;
use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::HashMap;
use std::convert::Infallible;
use tokio::sync::broadcast;

use crate::api::errors::AxiomError;
use crate::api::mcp::server::MCPServer;
use crate::utils::types::AuthContext;

// Per-client response channels to prevent cross-client data leakage
static MCP_CLIENTS: Lazy<DashMap<String, broadcast::Sender<Value>>> = Lazy::new(DashMap::new);

pub fn get_router() -> Router {
    Router::new()
        .route("/sse", get(handle_sse_connection))
        .route("/messages", post(handle_mcp_message))
}

async fn handle_sse_connection(
    Extension(auth): Extension<AuthContext>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new(
            "MCP_AUTH_FAILED",
            "Admin access required for MCP",
            axum::http::StatusCode::FORBIDDEN,
        ));
    }

    let client_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = broadcast::channel(256);
    MCP_CLIENTS.insert(client_id.clone(), tx);

    // Create an endpoint URL with client_id so responses route to this client
    let endpoint_url = format!("/api/v1/mcp/messages?client_id={}", client_id);
    let endpoint_event = Event::default().event("endpoint").data(endpoint_url);

    let stream = async_stream::stream! {
        yield Ok(endpoint_event);

        while let Ok(msg) = rx.recv().await {
            yield Ok(Event::default().event("message").data(serde_json::to_string(&msg).unwrap()));
        }

        // Cleanup on disconnect
        MCP_CLIENTS.remove(&client_id);
    };

    Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::new()))
}

async fn handle_mcp_message(
    Extension(auth): Extension<AuthContext>,
    Query(params): Query<HashMap<String, String>>,
    Json(payload): Json<Value>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new(
            "MCP_AUTH_FAILED",
            "Admin access required for MCP",
            axum::http::StatusCode::FORBIDDEN,
        ));
    }

    if let Some(response) = MCPServer::handle_rpc_message(payload, &auth).await {
        // Route response to the specific client via client_id query param
        if let Some(client_id) = params.get("client_id") {
            if let Some(sender) = MCP_CLIENTS.get(client_id) {
                let _ = sender.send(response);
            }
        }
        // If no client_id, broadcast for backward compatibility
        // (but all new clients include client_id)
    }

    Ok(StatusCode::ACCEPTED)
}

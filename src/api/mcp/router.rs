use axum::{
    extract::{Extension, Json},
    response::{sse::{Event, Sse}, IntoResponse},
    routing::{get, post},
    Router,
};
use futures::stream::Stream;
use serde_json::Value;
use std::convert::Infallible;
use tokio::sync::broadcast;
use once_cell::sync::Lazy;

use crate::api::errors::AxiomError;
use crate::utils::types::AuthContext;
use crate::api::mcp::server::MCPServer;

// A simple global broadcast channel to push events to SSE clients
static MCP_EVENT_TX: Lazy<broadcast::Sender<Value>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(1024);
    tx
});

pub fn get_router() -> Router {
    Router::new()
        .route("/sse", get(handle_sse_connection))
        .route("/messages", post(handle_mcp_message))
}

async fn handle_sse_connection(
    Extension(auth): Extension<AuthContext>
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AxiomError> {
    if !auth.full_admin {
        // Stub basic access check
        return Err(AxiomError::new("MCP_AUTH_FAILED", "Admin access required for MCP", axum::http::StatusCode::FORBIDDEN));
    }

    let mut rx = MCP_EVENT_TX.subscribe();

    // Create an endpoint URL that the MCP client will use to POST messages
    let endpoint_event = Event::default().event("endpoint").data("/api/v1/mcp/messages");

    let stream = async_stream::stream! {
        yield Ok(endpoint_event);

        while let Ok(msg) = rx.recv().await {
            yield Ok(Event::default().event("message").data(serde_json::to_string(&msg).unwrap()));
        }
    };

    Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::new()))
}

async fn handle_mcp_message(
    Extension(auth): Extension<AuthContext>,
    Json(payload): Json<Value>,
) -> Result<impl IntoResponse, AxiomError> {
    if !auth.full_admin {
        return Err(AxiomError::new("MCP_AUTH_FAILED", "Admin access required for MCP", axum::http::StatusCode::FORBIDDEN));
    }

    if let Some(response) = MCPServer::handle_rpc_message(payload, &auth).await {
        // We broadcast the response out to the SSE stream.
        // In a true implementation, we'd route it to the specific client ID.
        let _ = MCP_EVENT_TX.send(response);
    }

    Ok(axum::http::StatusCode::ACCEPTED)
}

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::Response,
    routing::get,
    Router,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;

use crate::api::ws::connection_manager::{ClientScopes, CONN_MGR};
use crate::config::loader::ConfigManager;

use crate::utils::types::AuthContext;

pub fn get_router() -> Router {
    Router::new().route("/", get(ws_handler))
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    auth: Option<axum::extract::Extension<AuthContext>>,
) -> Response {
    let auth = auth.map(|axum::extract::Extension(a)| a);
    ws.on_upgrade(move |socket| handle_socket(socket, auth))
}

async fn handle_socket(socket: WebSocket, initial_auth: Option<AuthContext>) {
    let (mut sender, mut receiver) = socket.split();

    let config = ConfigManager::get();

    // 1. Authenticate if not already authenticated via headers
    let auth = if let Some(a) = initial_auth {
        a
    } else {
        let auth_timeout = config.websocket.auth_timeout;
        let auth_result = tokio::time::timeout(Duration::from_secs_f64(auth_timeout), async {
            while let Some(msg) = receiver.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                            if json["type"] == "auth" {
                                if let Some(token) = json["token"].as_str() {
                                    let auth_value = if token.starts_with("Bearer ") {
                                        token.to_string()
                                    } else {
                                        format!("Bearer {}", token)
                                    };

                                    if let Some(ctx) = crate::middleware::auth::validate_api_key(
                                        &auth_value,
                                        &config,
                                    ) {
                                        return Ok(ctx);
                                    }
                                }
                                return Err("INVALID_TOKEN");
                            }
                        }
                        return Err("EXPECTED_AUTH_MESSAGE");
                    }
                    _ => return Err("INVALID_MESSAGE_TYPE"),
                }
            }
            Err("CONNECTION_CLOSED")
        })
        .await;

        match auth_result {
            Ok(Ok(ctx)) => ctx,
            _ => {
                let code = match auth_result {
                    Ok(Err(e)) => e,
                    _ => "AUTH_TIMEOUT",
                };
                let error = json!({
                    "type": "error",
                    "code": code,
                    "message": "Authentication failed or timed out"
                })
                .to_string();
                let _ = sender.send(Message::Text(error)).await;
                return;
            }
        }
    };

    let client_id = format!("{}_{}", auth.api_key_name, uuid::Uuid::new_v4());
    let mut scopes = ClientScopes::default();
    scopes.db_scope = auth.db_scope.clone();
    scopes.fs_scope = auth.fs_scope.clone();

    // 2. Setup internal communication channel
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    CONN_MGR.register(&client_id, tx, scopes).await;

    // Send connection success
    let ack = json!({
        "type": "connected",
        "client_id": client_id
    })
    .to_string();
    let _ = sender.send(Message::Text(ack)).await;

    // 3. Heartbeat task
    let heartbeat_interval = config.websocket.heartbeat_interval as u64;
    let hb_client_id = client_id.clone();
    let hb_task = tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(heartbeat_interval)).await;
            let hb = json!({
                "type": "heartbeat",
                "server_time": chrono::Utc::now().to_rfc3339()
            })
            .to_string();
            CONN_MGR.send(&hb_client_id, hb).await;
        }
    });

    // 4. Multiplex internal messages to the WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // 5. Read messages from the WebSocket
    let rc_client_id = client_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = receiver.next().await {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(msg_type) = json["type"].as_str() {
                    match msg_type {
                        "subscribe" => {
                            if let Some(topic) = json["topic"].as_str() {
                                let ok = CONN_MGR.subscribe(&rc_client_id, topic).await;
                                let ack = json!({
                                    "type": "ack",
                                    "request_id": json["request_id"].as_str().unwrap_or(""),
                                    "status": if ok { "ok" } else { "denied" },
                                    "topic": topic
                                })
                                .to_string();
                                CONN_MGR.send(&rc_client_id, ack).await;
                            }
                        }
                        "unsubscribe" => {
                            if let Some(topic) = json["topic"].as_str() {
                                CONN_MGR.unsubscribe(&rc_client_id, topic).await;
                            }
                        }
                        "pong" => {} // Heartbeat ack
                        _ => {}
                    }
                }
            }
        }
    });

    // Wait for either the sender or receiver task to die
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };

    // 6. Cleanup
    hb_task.abort();
    CONN_MGR.disconnect(&client_id).await;
}

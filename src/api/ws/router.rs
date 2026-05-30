use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::Response,
    routing::get,
    Router,
};
use futures::{sink::SinkExt, stream::StreamExt};
use std::time::Duration;
use tokio::time::sleep;
use serde_json::json;

use crate::api::ws::connection_manager::{ClientScopes, CONN_MGR};
use crate::config::loader::ConfigManager;

pub fn get_router() -> Router {
    Router::new().route("/", get(ws_handler))
}

async fn ws_handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();

    // 1. Wait for Auth Message
    let config = ConfigManager::get();
    let auth_timeout = Duration::from_secs(config.websocket.auth_timeout as u64);

    let auth_result = tokio::time::timeout(auth_timeout, receiver.next()).await;

    let mut client_id = String::new();
    let mut scopes = ClientScopes::default();

    if let Ok(Some(Ok(Message::Text(text)))) = auth_result {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            if json["type"] == "auth" && json["token"].is_string() {
                let token = json["token"].as_str().unwrap_or("");
                
                // Decode Base64 token (format: base64(key_name:secret))
                use base64::{engine::general_purpose::STANDARD, Engine};
                if let Ok(decoded) = STANDARD.decode(token) {
                    if let Ok(creds) = String::from_utf8(decoded) {
                        let parts: Vec<&str> = creds.splitn(2, ':').collect();
                        if parts.len() == 2 {
                            let key_name = parts[0];
                            let secret = parts[1];

                            if let Some(api_key_cfg) = config.api_key.get(key_name) {
                                if api_key_cfg.secret == secret {
                                    client_id = format!("{}_{}", key_name, uuid::Uuid::new_v4());
                                    scopes.db_scope = api_key_cfg.db_scope.clone();
                                    scopes.fs_scope = api_key_cfg.fs_scope.clone();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if client_id.is_empty() {
        let _ = sender.close().await;
        return;
    }

    // 2. Setup internal communication channel
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    CONN_MGR.register(&client_id, tx, scopes).await;

    // Send connection success
    let ack = json!({
        "type": "connected",
        "client_id": client_id
    }).to_string();
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
            }).to_string();
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
                                }).to_string();
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

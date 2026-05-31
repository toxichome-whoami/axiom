use crate::config::loader::ConfigManager;
use axum::extract::ws::Message;
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc;
use tokio::sync::RwLock;

#[derive(Clone, Default)]
pub struct ClientScopes {
    pub db_scope: Vec<String>,
    pub fs_scope: Vec<String>,
}

pub struct ConnectionManager {
    connections: RwLock<HashMap<String, mpsc::UnboundedSender<Message>>>,
    subscriptions: RwLock<HashMap<String, HashSet<String>>>,
    topic_subscribers: RwLock<HashMap<String, HashSet<String>>>,
    client_scopes: RwLock<HashMap<String, ClientScopes>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            subscriptions: RwLock::new(HashMap::new()),
            topic_subscribers: RwLock::new(HashMap::new()),
            client_scopes: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(
        &self,
        client_id: &str,
        sender: mpsc::UnboundedSender<Message>,
        scopes: ClientScopes,
    ) {
        self.connections
            .write()
            .await
            .insert(client_id.to_string(), sender);
        self.subscriptions
            .write()
            .await
            .insert(client_id.to_string(), HashSet::new());
        self.client_scopes
            .write()
            .await
            .insert(client_id.to_string(), scopes);
        println!("WebSocket connected: {}", client_id);
    }

    pub async fn disconnect(&self, client_id: &str) {
        let subs = self
            .subscriptions
            .write()
            .await
            .remove(client_id)
            .unwrap_or_default();
        let mut topic_subs = self.topic_subscribers.write().await;
        for topic in subs {
            if let Some(clients) = topic_subs.get_mut(&topic) {
                clients.remove(client_id);
            }
        }
        self.connections.write().await.remove(client_id);
        self.client_scopes.write().await.remove(client_id);
        println!("WebSocket disconnected: {}", client_id);
    }

    pub async fn subscribe(&self, client_id: &str, topic: &str) -> bool {
        let config = ConfigManager::get();
        let max_subs = config.websocket.max_subscriptions_per_client as usize;

        let mut subs_map = self.subscriptions.write().await;
        let subs = subs_map.entry(client_id.to_string()).or_default();

        if !subs.contains(topic) && subs.len() >= max_subs {
            return false;
        }

        let scopes_map = self.client_scopes.read().await;
        let scopes = scopes_map.get(client_id).cloned().unwrap_or_default();

        if !self.topic_in_scope(topic, &scopes) {
            return false;
        }

        subs.insert(topic.to_string());
        drop(subs_map); // unlock before locking next

        self.topic_subscribers
            .write()
            .await
            .entry(topic.to_string())
            .or_default()
            .insert(client_id.to_string());

        true
    }

    pub async fn unsubscribe(&self, client_id: &str, topic: &str) {
        if let Some(subs) = self.subscriptions.write().await.get_mut(client_id) {
            subs.remove(topic);
        }
        if let Some(clients) = self.topic_subscribers.write().await.get_mut(topic) {
            clients.remove(client_id);
        }
    }

    pub async fn send(&self, client_id: &str, payload: String) {
        let connections = self.connections.read().await;
        if let Some(sender) = connections.get(client_id) {
            let _ = sender.send(Message::Text(payload));
        }
    }

    pub async fn broadcast(&self, topic: &str, payload: String) {
        let topic_subs = self.topic_subscribers.read().await;
        let connections = self.connections.read().await;

        if let Some(subscribers) = topic_subs.get(topic) {
            for cid in subscribers {
                if let Some(sender) = connections.get(cid) {
                    let _ = sender.send(Message::Text(payload.clone()));
                }
            }
        }
    }

    fn topic_in_scope(&self, topic: &str, scopes: &ClientScopes) -> bool {
        let parts: Vec<&str> = topic.splitn(3, ':').collect();
        if parts.is_empty() {
            return false;
        }

        let module = parts[0];
        if module == "db" {
            let alias = if parts.len() > 1 { parts[1] } else { "" };
            return scopes.db_scope.iter().any(|s| s == "*" || s == alias);
        }
        if module == "fs" {
            let alias = if parts.len() > 1 { parts[1] } else { "" };
            return scopes.fs_scope.iter().any(|s| s == "*" || s == alias);
        }
        true
    }

    pub async fn active_count(&self) -> usize {
        self.connections.read().await.len()
    }
}

pub static CONN_MGR: Lazy<ConnectionManager> = Lazy::new(ConnectionManager::new);

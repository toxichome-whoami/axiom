use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc;
use tokio::sync::RwLock;
use axum::response::sse::Event;
use once_cell::sync::Lazy;

use crate::config::loader::ConfigManager;

#[derive(Clone, Default)]
pub struct SSEClientScopes {
    pub db_scope: Vec<String>,
    pub fs_scope: Vec<String>,
    pub full_admin: bool,
}

pub struct SSEConnectionManager {
    connections: RwLock<HashMap<String, mpsc::Sender<Event>>>,
    subscriptions: RwLock<HashMap<String, HashSet<String>>>,
    topic_subscribers: RwLock<HashMap<String, HashSet<String>>>,
}

impl SSEConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            subscriptions: RwLock::new(HashMap::new()),
            topic_subscribers: RwLock::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, client_id: &str) -> mpsc::Receiver<Event> {
        let config = ConfigManager::get();
        let queue_size = config.sse.queue_size as usize;

        // Use bounded channel to apply backpressure if client is slow
        let (tx, rx) = mpsc::channel(queue_size);

        self.connections.write().await.insert(client_id.to_string(), tx);
        self.subscriptions.write().await.insert(client_id.to_string(), HashSet::new());
        println!("SSE connected: {}", client_id);

        rx
    }

    pub async fn disconnect(&self, client_id: &str) {
        let subs = self.subscriptions.write().await.remove(client_id).unwrap_or_default();
        let mut topic_subs = self.topic_subscribers.write().await;
        for topic in subs {
            if let Some(clients) = topic_subs.get_mut(&topic) {
                clients.remove(client_id);
            }
        }
        self.connections.write().await.remove(client_id);
        println!("SSE disconnected: {}", client_id);
    }

    pub async fn subscribe(&self, client_id: &str, topic: &str) {
        let mut subs_map = self.subscriptions.write().await;
        let subs = subs_map.entry(client_id.to_string()).or_default();
        subs.insert(topic.to_string());
        drop(subs_map);

        self.topic_subscribers.write().await
            .entry(topic.to_string())
            .or_default()
            .insert(client_id.to_string());
    }

    pub async fn publish(&self, topic: &str, event_type: &str, payload: String) {
        let topic_subs = self.topic_subscribers.read().await;
        let connections = self.connections.read().await;

        if let Some(subscribers) = topic_subs.get(topic) {
            let event = Event::default().event(event_type).data(payload);
            for cid in subscribers {
                if let Some(sender) = connections.get(cid) {
                    // Try to send, if full or closed, we ignore.
                    // Backpressure means we drop events for this slow client if their queue is full.
                    let _ = sender.try_send(event.clone());
                }
            }
        }
    }

    pub async fn active_count(&self) -> usize {
        self.connections.read().await.len()
    }

    pub async fn topic_count(&self) -> usize {
        self.topic_subscribers.read().await.len()
    }
}

pub static SSE_MGR: Lazy<SSEConnectionManager> = Lazy::new(SSEConnectionManager::new);

use serde_json::Value;
use std::sync::OnceLock;

static QUEUE: OnceLock<WebhookQueueList> = OnceLock::new();

pub struct WebhookQueueList;

impl WebhookQueueList {
    pub fn get_queue() -> Result<WebhookQueueList, Box<dyn std::error::Error>> {
        Ok(WebhookQueueList)
    }

    pub fn put_nowait(&self, item: Value) {
        // dummy implementation
    }
}

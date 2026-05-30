use reqwest::Client;
use std::time::Duration;

use crate::webhook::circuit_breaker::CircuitBreaker;
use crate::webhook::persistence::WebhookPersistence;

pub struct WebhookDispatcher {
    client: Client,
}

impl WebhookDispatcher {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let client = Client::builder().timeout(Duration::from_secs(30)).build()?;

        Ok(WebhookDispatcher { client })
    }

    pub fn dispatch_event(
        &self,
        _task: serde_json::Value,
        _persistence: Option<WebhookPersistence>,
        _breaker: CircuitBreaker,
    ) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }
}

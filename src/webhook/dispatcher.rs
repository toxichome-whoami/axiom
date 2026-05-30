use reqwest::Client;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;

use crate::webhook::circuit_breaker::CircuitBreaker;
use crate::webhook::persistence::{get_rt, WebhookPersistence};
use crate::webhook::signer::generate_signature;

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
        task: serde_json::Value,
        persistence: Option<WebhookPersistence>,
        breaker: CircuitBreaker,
    ) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }
}

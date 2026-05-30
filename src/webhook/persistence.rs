use serde_json::Value;
use std::sync::OnceLock;
use tokio::runtime::Runtime;

// Global Tokio runtime for background network I/O
static ASYNC_RT: OnceLock<Runtime> = OnceLock::new();
static PERSISTENCE: OnceLock<WebhookPersistence> = OnceLock::new();

pub fn get_rt() -> &'static Runtime {
    ASYNC_RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
    })
}

#[derive(Clone)]
pub struct WebhookPersistence {
    pub db_path: String,
    backend: String,
    redis_url: Option<String>,
    nats_url: Option<String>,
}

impl WebhookPersistence {
    pub fn new(db_path: String) -> Self {
        Self {
            db_path,
            backend: "sqlite".to_string(),
            redis_url: None,
            nats_url: None,
        }
    }

    pub fn init_db(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn enqueue(
        &self,
        _event_id: String,
        _hook_name: String,
        _url: String,
        _secret: String,
        _headers: Value,
        _payload: String,
    ) -> Result<Option<i64>, Box<dyn std::error::Error>> {
        Ok(Some(1))
    }

    pub fn mark_delivered(&self, _event_id: String) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn mark_failed(
        &self,
        _event_id: String,
        _attempt: i64,
        _error: String,
        _next_retry_at: f64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn move_to_dead_letter(
        &self,
        _queue_id: i64,
        _event_id: String,
        _hook_name: String,
        _url: String,
        _payload: String,
        _attempts: i64,
        _last_error: String,
    ) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn purge_expired_dlq(
        &self,
        _retention_hours: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn stats(&self) -> Result<Value, Box<dyn std::error::Error>> {
        Ok(serde_json::json!({}))
    }

    pub fn recover_processing_tasks(&self) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn fetch_all_pending(&self) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        Ok(vec![])
    }

    pub fn fetch_dead_letters(&self, _limit: i64) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        Ok(vec![])
    }

    pub fn pop_dead_letter(
        &self,
        _event_id: String,
    ) -> Result<Option<Value>, Box<dyn std::error::Error>> {
        Ok(None)
    }

    pub fn close(&self) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }
}

pub fn get_persistence() -> Result<Option<WebhookPersistence>, Box<dyn std::error::Error>> {
    if let Some(p) = PERSISTENCE.get() {
        Ok(Some(p.clone()))
    } else {
        Ok(None)
    }
}

pub fn init_persistence(db_path: String) -> Result<(), Box<dyn std::error::Error>> {
    let mut p = WebhookPersistence::new(db_path);
    p.init_db()?;
    let _ = PERSISTENCE.set(p);
    Ok(())
}

pub fn close_persistence() -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

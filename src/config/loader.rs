use crate::config::schema::AxiomConfig;
use once_cell::sync::Lazy;
use std::sync::{Arc, RwLock};

static CONFIG: Lazy<RwLock<Arc<AxiomConfig>>> =
    Lazy::new(|| RwLock::new(Arc::new(AxiomConfig::default())));

pub struct ConfigManager;

impl ConfigManager {
    pub fn load(path: &str) -> Result<(), Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path).unwrap_or_else(|_| "".to_string());
        if !content.is_empty() {
            let parsed: AxiomConfig = toml::from_str(&content)?;
            let mut writer = CONFIG.write().unwrap();
            *writer = Arc::new(parsed);
        }
        Ok(())
    }

    pub fn get() -> Arc<AxiomConfig> {
        let reader = CONFIG.read().unwrap();
        reader.clone()
    }
}

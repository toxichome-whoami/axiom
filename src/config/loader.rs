use crate::config::schema::AxiomConfig;
use std::sync::{Arc, OnceLock};

static CONFIG: OnceLock<Arc<AxiomConfig>> = OnceLock::new();

pub struct ConfigManager;

impl ConfigManager {
    pub fn load(path: &str) -> Result<(), Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path).unwrap_or_else(|e| {
            panic!("FATAL: Failed to read config file {}: {}", path, e);
        });

        let parsed = toml::from_str(&content).unwrap_or_else(|e| {
            panic!("FATAL: Failed to parse config file {}: {}", path, e);
        });

        let _ = CONFIG.set(Arc::new(parsed));
        Ok(())
    }

    pub fn get() -> Arc<AxiomConfig> {
        CONFIG
            .get()
            .cloned()
            .unwrap_or_else(|| Arc::new(AxiomConfig::default()))
    }
}

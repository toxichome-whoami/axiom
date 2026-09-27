use crate::config::schema::AxiomConfig;
use figment::{
    providers::{Env, Format, Toml},
    Figment,
};
use std::sync::{Arc, OnceLock};

static CONFIG: OnceLock<Arc<AxiomConfig>> = OnceLock::new();

pub struct ConfigManager;

impl ConfigManager {
    pub fn load(path: &str) -> Result<(), Box<dyn std::error::Error>> {
        // Automatically load from a local .env file if it exists
        dotenvy::dotenv().ok();

        let mut figment = Figment::new();
        if std::path::Path::new(path).exists() {
            figment = figment.merge(Toml::file(path));
        }

        // Merge environment variables on top
        let parsed: AxiomConfig = figment
            .merge(Env::raw().split("__"))
            .extract()
            .unwrap_or_else(|e| {
                panic!("FATAL: Failed to load configuration: {}", e);
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

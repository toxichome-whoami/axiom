/*
 * Synchronous configuration loader and OnceLock global accessor.
 * Owned by: crates/core (config)
 * Key deps: figment, dotenvy, arc
 * Invariants: Config is immutable once loaded at startup; requests read via lock-free Arc clone.
 * Last structural change: Workspace modularization (Phase 8 -> v4.0).
 */

use crate::config::schema::AxiomConfig;
use figment::{
    providers::{Env, Format, Toml},
    Figment,
};
use std::sync::{Arc, OnceLock};

static CONFIG: OnceLock<Arc<AxiomConfig>> = OnceLock::new();

pub struct ConfigManager;

impl ConfigManager {
    /// Loads server configuration from the specified TOML file and merges environment variables.
    /// CONTRACT:
    ///  - Precondition: `path` string slice pointing to a TOML file (falls back to defaults if not found).
    ///  - Invariant: Merges `.env` variables and `SERVER__` prefixed overrides into `AxiomConfig`.
    ///  - Side effects: Stores immutable `Arc<AxiomConfig>` into global `OnceLock`.
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

    /// Retrieves an Arc clone of the loaded global configuration, or default config if not initialized.
    /// CONTRACT:
    ///  - Returns `Arc<AxiomConfig>`. Zero mutex contention on request hot paths.
    pub fn get() -> Arc<AxiomConfig> {
        CONFIG
            .get()
            .cloned()
            .unwrap_or_else(|| Arc::new(AxiomConfig::default()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_manager_get_default() {
        let cfg = ConfigManager::get();
        assert_eq!(cfg.server.port, 4500);
        assert_eq!(cfg.server.host, "127.0.0.1");
    }

    #[test]
    fn test_config_manager_load_nonexistent_file_falls_back_to_defaults() {
        let result = ConfigManager::load("non_existent_config_file_for_test.toml");
        assert!(result.is_ok());
        let cfg = ConfigManager::get();
        assert!(!cfg.server.host.is_empty());
    }
}

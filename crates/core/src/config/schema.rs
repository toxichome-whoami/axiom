/*
 * Application configuration schema definitions and default values.
 * Owned by: config
 * Key deps: serde, crate::utils::types
 * Invariants: Config loaded once at startup; defaults must be secure and suitable for single-node deployments.
 * Last structural change: Phase 1 addition of MetadataConfig for SQLite/Turso store backing.
 */

use crate::types::*;
use std::collections::HashMap;

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct ServerConfig {
    pub host: String,
    pub port: i32,
    pub workers: i32,
    pub max_connections: i32,
    pub request_timeout: i32,
    pub body_limit: String,
    pub tls_cert: String,
    pub tls_key: String,
    pub allowed_ips: Vec<String>,
    pub trusted_proxies: Vec<String>,
    pub cors_origins: Vec<String>,
    pub shutdown_timeout: i32,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 4500,
            workers: 0,
            max_connections: 10000,
            request_timeout: 30,
            body_limit: "10 MB".to_string(),
            tls_cert: "".to_string(),
            tls_key: "".to_string(),
            allowed_ips: Vec::new(),
            trusted_proxies: vec!["127.0.0.1".to_string()],
            cors_origins: vec!["*".to_string()],
            shutdown_timeout: 30,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct FeaturesConfig {
    pub database: bool,
}

impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            database: true,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct LoggingConfig {
    pub enabled: bool,
    pub level: String,
    pub format: String,
    pub directory: String,
    pub file_prefix: String,
    pub max_file_size: String,
    pub max_files: i32,
    pub stdout: bool,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            level: "INFO".to_string(),
            format: "json".to_string(),
            directory: "./logs".to_string(),
            file_prefix: "axiom".to_string(),
            max_file_size: "50 MB".to_string(),
            max_files: 5,
            stdout: true,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct RateLimitConfig {
    pub enabled: bool,
    pub backend: String,
    pub turso_url: String,
    pub turso_token: String,
    pub window: i32,
    pub max_requests: i32,
    pub burst: i32,
    pub penalty_threshold: i32,
    pub penalty_cooldown: i32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            backend: "memory".to_string(),
            turso_url: "file:data/cache.db".to_string(),
            turso_token: "".to_string(),
            window: 60,
            max_requests: 100,
            burst: 20,
            penalty_threshold: 10,
            penalty_cooldown: 300,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct CacheConfig {
    pub enabled: bool,
    pub backend: String,
    pub turso_url: String,
    pub turso_token: String,
    pub max_memory: String,
    pub default_ttl: i32,
    pub query_cache: bool,
    pub idempotency_ttl: i32,
    pub response_cache_ttl: i32,
    pub query_results_ttl: i32,
    pub negative_cache_ttl: i32,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            backend: "memory".to_string(),
            turso_url: "file:data/cache.db".to_string(),
            turso_token: "".to_string(),
            max_memory: "100 MB".to_string(),
            default_ttl: 60,
            query_cache: true,
            idempotency_ttl: 86400,
            response_cache_ttl: 30,
            query_results_ttl: 5,
            negative_cache_ttl: 5,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct PerformanceConfig {
    pub query_cache_size: i32,
    pub transpiler_cache_size: i32,
    pub rate_limit_cache_size: i32,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            query_cache_size: 2048,
            transpiler_cache_size: 4096,
            rate_limit_cache_size: 256,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct DatabaseDefConfig {
    pub engine: DbEngineType,
    pub url: String,
    pub mode: ServerMode,
    pub pool_min: i32,
    pub pool_max: i32,
    pub connection_timeout: i32,
    pub idle_timeout: i32,
    pub max_lifetime: i32,
    pub query_whitelist: Option<Vec<String>>,
    pub query_blacklist: Option<Vec<String>>,
    pub dangerous_operations: bool,
}

// Assuming DbEngineType and ServerMode implement Default
impl Default for DatabaseDefConfig {
    fn default() -> Self {
        Self {
            engine: DbEngineType::default(),
            url: "".to_string(),
            mode: ServerMode::default(),
            pool_min: 5,
            pool_max: 50,
            connection_timeout: 30,
            idle_timeout: 600,
            max_lifetime: 3600,
            query_whitelist: None,
            query_blacklist: None,
            dangerous_operations: true,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct ApiKeyDefConfig {
    pub mode: ServerMode,
    pub secret: String,
    pub db_scope: Vec<String>,
    pub rate_limit_override: i32,
    /// Deprecated in v4.0: Preserved for backward-compatibility with v3.0 config.toml.
    /// CONTRACT: Automatically seeded as an admin role permission in axiom.db on first boot.
    /// Will be deprecated and superseded by fine-grained RBAC in Phase 2.
    
    pub expires_at: Option<i64>,
}

impl Default for ApiKeyDefConfig {
    fn default() -> Self {
        Self {
            mode: ServerMode::default(),
            secret: "".to_string(),
            db_scope: vec!["*".to_string()],
            rate_limit_override: 0,
            
            expires_at: None,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct CircuitBreakerConfig {
    pub enabled: bool,
    pub failure_threshold: i32,
    pub success_threshold: i32,
    pub timeout: i32,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            failure_threshold: 5,
            success_threshold: 3,
            timeout: 30,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct MetadataConfig {
    pub url: String,
    pub token: String,
    pub reload_interval: u64,
}

impl Default for MetadataConfig {
    fn default() -> Self {
        Self {
            url: "file:data/axiom.db".to_string(),
            token: "".to_string(),
            reload_interval: 30,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct BlobConfig {
    pub enabled: bool,
    pub path: String,
    pub inline_max: String,
    pub max_object: String,
    pub verify_reads: bool,
    pub ticket_secret: String,
}

impl Default for BlobConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            path: "data/blobs".to_string(),
            inline_max: "64kb".to_string(),
            max_object: "5gb".to_string(),
            verify_reads: false,
            ticket_secret: "axiom_default_ticket_secret_change_in_production".to_string(),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct AxiomConfig {
    pub server: ServerConfig,
    pub version: String,
    pub features: FeaturesConfig,
    pub logging: LoggingConfig,
    pub rate_limit: RateLimitConfig,
    pub cache: CacheConfig,
    pub performance: PerformanceConfig,
    pub database: HashMap<String, DatabaseDefConfig>,
    pub api_key: HashMap<String, ApiKeyDefConfig>,
    pub circuit_breaker: CircuitBreakerConfig,
    pub metadata: MetadataConfig,
    pub blob: BlobConfig,
}

impl Default for AxiomConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            version: "3.0.1".to_string(),
            features: FeaturesConfig::default(),
            logging: LoggingConfig::default(),
            rate_limit: RateLimitConfig::default(),
            cache: CacheConfig::default(),
            performance: PerformanceConfig::default(),
            database: HashMap::new(),
            api_key: HashMap::new(),
            circuit_breaker: CircuitBreakerConfig::default(),
            metadata: MetadataConfig::default(),
            blob: BlobConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_config_default() {
        let config = ServerConfig::default();
        assert_eq!(config.port, 4500);
        assert_eq!(config.host, "127.0.0.1");
        assert!(config.trusted_proxies.contains(&"127.0.0.1".to_string()));
    }

    #[test]
    fn test_logging_config_default() {
        let config = LoggingConfig::default();
        assert!(config.enabled);
        assert_eq!(config.level, "INFO");
    }

    #[test]
    fn test_rate_limit_config_default() {
        let config = RateLimitConfig::default();
        assert!(config.enabled);
        assert_eq!(config.window, 60);
    }

    #[test]
    fn test_cache_config_default() {
        let config = CacheConfig::default();
        assert!(config.enabled);
        assert_eq!(config.default_ttl, 60);
        assert_eq!(config.negative_cache_ttl, 5);
    }

    #[test]
    fn test_blob_config_default() {
        let config = BlobConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.path, "data/blobs");
        assert_eq!(config.inline_max, "64kb");
        assert_eq!(config.max_object, "5gb");
        assert!(!config.verify_reads);
    }

    #[test]
    fn test_axiom_config_default() {
        let config: AxiomConfig = toml::from_str("").unwrap_or_default();
        assert_eq!(config.server.port, 4500);
    }

    #[test]
    fn test_axiom_config_deserialize_override() {
        let toml_str = "[server]\nport = 9999";
        let config = toml::from_str::<AxiomConfig>(toml_str).unwrap();
        assert_eq!(config.server.port, 9999);
        assert_eq!(config.server.host, "127.0.0.1");
    }
}

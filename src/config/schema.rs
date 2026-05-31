use crate::utils::types::*;
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
            host: "0.0.0.0".to_string(),
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
    pub storage: bool,
    pub webhook: bool,
    pub federation: bool,
    pub metrics: bool,
    pub playground: bool,
    pub mcp: bool,
    pub graphql: bool,
    pub websocket: bool,
    pub sse: bool,
    pub auth: bool,
    pub telemetry: bool,
}

impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            database: true,
            storage: true,
            webhook: false,
            federation: false,
            metrics: false,
            playground: false,
            mcp: false,
            graphql: false,
            websocket: false,
            sse: true,
            auth: false,
            telemetry: false,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct GraphQLConfig {
    pub endpoint: String,
    pub query_cache_enabled: bool,
    pub query_cache_size: i32,
    pub max_query_depth: i32,
    pub introspection: bool,
}

impl Default for GraphQLConfig {
    fn default() -> Self {
        Self {
            endpoint: "/api/v1/graphql".to_string(),
            query_cache_enabled: true,
            query_cache_size: 512,
            max_query_depth: 15,
            introspection: false,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct WebSocketConfig {
    pub max_connections: i32,
    pub heartbeat_interval: i32,
    pub auth_timeout: f64,
    pub max_subscriptions_per_client: i32,
}

impl Default for WebSocketConfig {
    fn default() -> Self {
        Self {
            max_connections: 10000,
            heartbeat_interval: 30,
            auth_timeout: 5.0,
            max_subscriptions_per_client: 100,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct SSEConfig {
    pub max_connections: i32,
    pub queue_size: i32,
    pub heartbeat_interval: i32,
    pub health_interval: i32,
    pub metrics_interval: i32,
}

impl Default for SSEConfig {
    fn default() -> Self {
        Self {
            max_connections: 5000,
            queue_size: 100,
            heartbeat_interval: 15,
            health_interval: 10,
            metrics_interval: 5,
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
    pub redis_url: String,
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
            redis_url: "".to_string(),
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
    pub redis_url: String,
    pub max_memory: String,
    pub default_ttl: i32,
    pub query_cache: bool,
    pub fs_cache: bool,
    pub idempotency_ttl: i32,
    pub response_cache_ttl: i32,
    pub query_results_ttl: i32,
    pub upload_session_ttl: i32,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            backend: "memory".to_string(),
            redis_url: "".to_string(),
            max_memory: "100 MB".to_string(),
            default_ttl: 60,
            query_cache: true,
            fs_cache: true,
            idempotency_ttl: 86400,
            response_cache_ttl: 30,
            query_results_ttl: 5,
            upload_session_ttl: 3600,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct EDAConfig {
    pub enabled: bool,
    pub backend: String,
    pub redis_url: String,
    pub nats_url: String,
    pub max_stream_length: i32,
    pub dlq_retention_hours: i32,
    pub consumer_group: String,
    pub consumer_name: String,
}

impl Default for EDAConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            backend: "memory".to_string(),
            redis_url: "redis://127.0.0.1:6379/1".to_string(),
            nats_url: "nats://127.0.0.1:4222".to_string(),
            max_stream_length: 100000,
            dlq_retention_hours: 72,
            consumer_group: "axiom_workers".to_string(),
            consumer_name: "worker_1".to_string(),
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
pub struct MCPConfig {
    pub server_name: String,
    pub server_version: String,
    pub max_result_rows: i32,
    pub max_directory_entries: i32,
    pub max_file_read_bytes: i32,
}

impl Default for MCPConfig {
    fn default() -> Self {
        Self {
            server_name: "axiom".to_string(),
            server_version: "1.0.5".to_string(),
            max_result_rows: 50,
            max_directory_entries: 100,
            max_file_read_bytes: 1_048_576,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct WebhookGlobalConfig {
    pub enabled: bool,
    pub timeout: i32,
    pub max_retries: i32,
    pub retry_delay: i32,
    pub queue_size: i32,
    pub secret_header: String,
    pub max_concurrent_deliveries: i32,
    pub persistence_enabled: bool,
    pub persistence_path: String,
    pub dead_letter_enabled: bool,
    pub dead_letter_retention_hours: i32,
    pub circuit_breaker_enabled: bool,
    pub circuit_breaker_threshold: i32,
    pub circuit_breaker_recovery: i32,
    pub retry_jitter_enabled: bool,
}

impl Default for WebhookGlobalConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            timeout: 5,
            max_retries: 3,
            retry_delay: 2,
            queue_size: 10000,
            secret_header: "X-Axiom-Signature".to_string(),
            max_concurrent_deliveries: 8,
            persistence_enabled: true,
            persistence_path: "./data/webhooks/webhooks.db".to_string(),
            dead_letter_enabled: true,
            dead_letter_retention_hours: 72,
            circuit_breaker_enabled: true,
            circuit_breaker_threshold: 5,
            circuit_breaker_recovery: 30,
            retry_jitter_enabled: true,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct WebhookDefConfig {
    pub url: String,
    pub secret: String,
    pub rule: String,
    pub headers: HashMap<String, String>,
    pub enabled: bool,
    pub timeout: Option<i32>,
    pub max_retries: Option<i32>,
    pub delivery_format: String,
}

impl Default for WebhookDefConfig {
    fn default() -> Self {
        Self {
            url: "".to_string(),
            secret: "".to_string(),
            rule: "".to_string(),
            headers: HashMap::new(),
            enabled: true,
            timeout: None,
            max_retries: None,
            delivery_format: "json".to_string(),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct DatabaseDefConfig {
    pub engine: DbEngineType,
    pub url: String,
    pub mode: ServerMode,
    pub federated_alias: Option<String>,
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
            federated_alias: None,
            pool_min: 5,
            pool_max: 50,
            connection_timeout: 30,
            idle_timeout: 600,
            max_lifetime: 3600,
            query_whitelist: None,
            query_blacklist: Some(vec![
                "DROP".to_string(),
                "TRUNCATE".to_string(),
                "ALTER".to_string(),
            ]),
            dangerous_operations: false,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct StorageDefConfig {
    pub path: String,
    pub mode: ServerMode,
    pub limit: String,
    pub chunk_size: String,
    pub allowed_extensions: Vec<String>,
    pub blocked_extensions: Vec<String>,
    pub max_file_size: String,
    pub access: Vec<String>,
}

impl Default for StorageDefConfig {
    fn default() -> Self {
        Self {
            path: "".to_string(),
            mode: ServerMode::default(),
            limit: "5 GB".to_string(),
            chunk_size: "10 MB".to_string(),
            allowed_extensions: Vec::new(),
            blocked_extensions: vec![
                ".exe".to_string(),
                ".bat".to_string(),
                ".sh".to_string(),
                ".cmd".to_string(),
                ".ps1".to_string(),
            ],
            max_file_size: "500 MB".to_string(),
            access: vec!["*".to_string()],
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct ApiKeyDefConfig {
    pub mode: ServerMode,
    pub secret: String,
    pub db_scope: Vec<String>,
    pub fs_scope: Vec<String>,
    pub feature_scope: Vec<String>,
    pub rate_limit_override: i32,
    pub full_admin: bool,
}

impl Default for ApiKeyDefConfig {
    fn default() -> Self {
        Self {
            mode: ServerMode::default(),
            secret: "".to_string(),
            db_scope: vec!["*".to_string()],
            fs_scope: vec!["*".to_string()],
            feature_scope: vec!["*".to_string()],
            rate_limit_override: 0,
            full_admin: false,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct FederationIncomingKeyConfig {
    pub secret: String,
    pub mode: ServerMode,
    pub db_scope: Vec<String>,
    pub fs_scope: Vec<String>,
    pub feature_scope: Vec<String>,
    pub description: String,
}

impl Default for FederationIncomingKeyConfig {
    fn default() -> Self {
        Self {
            secret: "".to_string(),
            mode: ServerMode::default(),
            db_scope: vec!["*".to_string()],
            fs_scope: vec!["*".to_string()],
            feature_scope: vec!["*".to_string()],
            description: "".to_string(),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct FedServerConfig {
    pub url: String,
    pub secret: String,
    pub node_id: String,
    pub trust_mode: String,
    pub grpc_port: i32,
    pub grpc_enabled: bool,
}

impl Default for FedServerConfig {
    fn default() -> Self {
        Self {
            url: "".to_string(),
            secret: "".to_string(),
            node_id: "".to_string(),
            trust_mode: "verify".to_string(),
            grpc_port: 50051,
            grpc_enabled: true,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct FederationNodeState {
    pub status: String,
    pub latency_ms: f64,
    pub last_check: f64,
    pub consecutive_failures: i32,
    pub next_retry_at: f64,
    pub databases: HashMap<String, String>,
    pub storages: HashMap<String, String>,
}

impl Default for FederationNodeState {
    fn default() -> Self {
        Self {
            status: "unknown".to_string(),
            latency_ms: 0.0,
            last_check: 0.0,
            consecutive_failures: 0,
            next_retry_at: 0.0,
            databases: HashMap::new(),
            storages: HashMap::new(),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct FederationConfig {
    pub enabled: bool,
    pub sync_interval: i32,
    pub per_node_timeout: f64,
    pub backoff_max: f64,
    pub circuit_breaker_threshold: i32,
    pub grpc_port: i32,
    pub grpc_max_message_mb: i32,
    pub grpc_keepalive_seconds: i32,
    pub incoming: HashMap<String, FederationIncomingKeyConfig>,
    pub server: HashMap<String, FedServerConfig>,
    pub alias_map: HashMap<String, String>,
}

impl Default for FederationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            sync_interval: 30,
            per_node_timeout: 5.0,
            backoff_max: 300.0,
            circuit_breaker_threshold: 3,
            grpc_port: 50051,
            grpc_max_message_mb: 100,
            grpc_keepalive_seconds: 30,
            incoming: HashMap::new(),
            server: HashMap::new(),
            alias_map: HashMap::new(),
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
pub struct AuthEmailConfig {
    pub provider: String,
    pub from_address: String,
    pub from_name: String,
    pub smtp_host: String,
    pub smtp_port: i32,
    pub smtp_user: String,
    pub smtp_password: String,
    pub smtp_tls: bool,
}

impl Default for AuthEmailConfig {
    fn default() -> Self {
        Self {
            provider: "smtp".to_string(),
            from_address: "noreply@axiom.local".to_string(),
            from_name: "Axiom Auth".to_string(),
            smtp_host: "127.0.0.1".to_string(),
            smtp_port: 1025,
            smtp_user: "".to_string(),
            smtp_password: "".to_string(),
            smtp_tls: true,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct TelemetryConfig {
    pub otlp_endpoint: String,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            otlp_endpoint: "".to_string(),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct AuthProjectConfig {
    pub db_url: Option<String>,
    pub access_token_ttl: i32,
    pub refresh_token_ttl: i32,
    pub magic_link_ttl: i32,
    pub verification_ttl: i32,
    pub password_reset_ttl: i32,
    pub otp_ttl: i32,
    pub resend_cooldown: i32,
    pub resend_max_per_hour: i32,
    pub min_password_length: i32,
    pub require_uppercase: bool,
    pub require_number: bool,
    pub require_symbol: bool,
    pub pwned_check: bool,
    pub email_verification: bool,
    pub verification_method: String,
    pub totp_enabled: bool,
    pub totp_issuer: String,
    pub backup_codes_count: i32,
    pub anonymous_auth: bool,
    pub anonymous_upgrade_ttl: i32,
    pub jwt_custom_claims: Vec<String>,
    pub webauthn_enabled: bool,
    pub rp_id: String,
    pub rp_name: String,
    pub origin: String,
    pub new_device_alerts: bool,
    pub max_login_attempts: i32,
    pub lockout_duration: i32,
    pub max_signup_per_ip: i32,
    pub max_otp_attempts: i32,
    pub ip_allowlist: Vec<String>,
    pub callback_url: String,
    pub allowed_redirect_urls: Vec<String>,
    pub webhook_on_signup: bool,
    pub webhook_on_login: bool,
    pub webhook_on_logout: bool,
    pub webhook_on_password_reset: bool,
    pub webhook_on_email_change: bool,
    pub webhook_on_delete: bool,
    pub email: AuthEmailConfig,
}

impl Default for AuthProjectConfig {
    fn default() -> Self {
        Self {
            db_url: None,
            access_token_ttl: 900,
            refresh_token_ttl: 2592000,
            magic_link_ttl: 600,
            verification_ttl: 86400,
            password_reset_ttl: 3600,
            otp_ttl: 600,
            resend_cooldown: 60,
            resend_max_per_hour: 5,
            min_password_length: 8,
            require_uppercase: false,
            require_number: false,
            require_symbol: false,
            pwned_check: false,
            email_verification: true,
            verification_method: "token".to_string(),
            totp_enabled: true,
            totp_issuer: "Axiom".to_string(),
            backup_codes_count: 8,
            anonymous_auth: false,
            anonymous_upgrade_ttl: 604800,
            jwt_custom_claims: Vec::new(),
            webauthn_enabled: true,
            rp_id: "localhost".to_string(),
            rp_name: "Axiom".to_string(),
            origin: "http://localhost:3000".to_string(),
            new_device_alerts: true,
            max_login_attempts: 5,
            lockout_duration: 900,
            max_signup_per_ip: 10,
            max_otp_attempts: 3,
            ip_allowlist: Vec::new(),
            callback_url: "".to_string(),
            allowed_redirect_urls: Vec::new(),
            webhook_on_signup: false,
            webhook_on_login: false,
            webhook_on_logout: false,
            webhook_on_password_reset: false,
            webhook_on_email_change: false,
            webhook_on_delete: false,
            email: AuthEmailConfig::default(),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct AuthConfig {
    pub project: HashMap<String, AuthProjectConfig>,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            project: HashMap::new(),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(default)]
pub struct BackupsConfig {
    pub enabled: bool,
    pub interval_minutes: i32,
    pub s3_bucket: String,
    pub s3_region: String,
    pub s3_endpoint_url: Option<String>,
    pub s3_access_key: String,
    pub s3_secret_key: String,
}

impl Default for BackupsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 5,
            s3_bucket: "".to_string(),
            s3_region: "us-east-1".to_string(),
            s3_endpoint_url: None,
            s3_access_key: "".to_string(),
            s3_secret_key: "".to_string(),
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
    pub mcp: MCPConfig,
    pub graphql: GraphQLConfig,
    pub websocket: WebSocketConfig,
    pub sse: SSEConfig,
    pub eda: EDAConfig,
    pub webhooks: WebhookGlobalConfig,
    pub webhook: HashMap<String, WebhookDefConfig>,
    pub database: HashMap<String, DatabaseDefConfig>,
    pub storage: HashMap<String, StorageDefConfig>,
    pub api_key: HashMap<String, ApiKeyDefConfig>,
    pub federation: FederationConfig,
    pub circuit_breaker: CircuitBreakerConfig,
    pub auth: AuthConfig,
    pub backups: BackupsConfig,
    pub telemetry: TelemetryConfig,
}

impl Default for AxiomConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            version: "1.0.5".to_string(),
            features: FeaturesConfig::default(),
            logging: LoggingConfig::default(),
            rate_limit: RateLimitConfig::default(),
            cache: CacheConfig::default(),
            performance: PerformanceConfig::default(),
            mcp: MCPConfig::default(),
            graphql: GraphQLConfig::default(),
            websocket: WebSocketConfig::default(),
            sse: SSEConfig::default(),
            eda: EDAConfig::default(),
            webhooks: WebhookGlobalConfig::default(),
            webhook: HashMap::new(),
            database: HashMap::new(),
            storage: HashMap::new(),
            api_key: HashMap::new(),
            federation: FederationConfig::default(),
            circuit_breaker: CircuitBreakerConfig::default(),
            auth: AuthConfig::default(),
            backups: BackupsConfig::default(),
            telemetry: TelemetryConfig::default(),
        }
    }
}

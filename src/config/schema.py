import re
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from utils.types import DbEngineType, ServerMode

# ─────────────────────────────────────────────────────────────────────────────
# Operational Subsystems
# ─────────────────────────────────────────────────────────────────────────────


class ServerConfig(BaseModel):
    """Underlying Uvicorn ASGI execution bindings strictly tuning OS network usage."""

    host: str = "0.0.0.0"
    port: int = 4500
    workers: int = 0
    max_connections: int = 10000
    request_timeout: int = 30
    body_limit: str = "10 MB"
    tls_cert: str = ""
    tls_key: str = ""
    allowed_ips: List[str] = Field(default_factory=list)
    trusted_proxies: List[str] = Field(default_factory=lambda: ["127.0.0.1"])
    cors_origins: List[str] = Field(default_factory=lambda: ["*"])
    shutdown_timeout: int = 30


class FeaturesConfig(BaseModel):
    """Toggles massive modular subsystems saving RAM footprint natively dynamically."""

    database: bool = True
    storage: bool = True
    webhook: bool = True
    federation: bool = False
    metrics: bool = True
    playground: bool = False
    mcp: bool = False
    graphql: bool = False
    websocket: bool = False
    sse: bool = True
    auth: bool = False


class GraphQLConfig(BaseModel):
    """AST-to-SQL compiler configuration for high-performance schema resolving."""

    endpoint: str = "/api/v1/graphql"
    query_cache_enabled: bool = True
    query_cache_size: int = 512
    max_query_depth: int = 15
    introspection: bool = False


class WebSocketConfig(BaseModel):
    """Real-time bidirectional push gateway for DB/FS event streaming."""

    max_connections: int = 10000
    heartbeat_interval: int = 30  # Seconds between server ping messages
    auth_timeout: float = 5.0  # Seconds client has to send auth after connecting
    max_subscriptions_per_client: int = 100  # Prevent topic spam per connection


class SSEConfig(BaseModel):
    """Real-time unidirectional push gateway (Server-Sent Events)."""

    max_connections: int = 5000
    queue_size: int = 100
    heartbeat_interval: int = 15
    health_interval: int = 10
    metrics_interval: int = 5


class LoggingConfig(BaseModel):
    """Formats payload retention policies targeting physical disk operations."""

    enabled: bool = True
    level: Literal["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] = "INFO"
    format: Literal["json", "pretty"] = "json"
    directory: str = "./logs"
    file_prefix: str = "axiom"
    max_file_size: str = "50 MB"
    max_files: int = 5
    stdout: bool = True


class RateLimitConfig(BaseModel):
    """Hardened execution locks blocking DOS and network exhaustion patterns."""

    enabled: bool = True
    backend: Literal["memory", "redis", "sqlite"] = "memory"
    redis_url: str = ""
    window: int = 60
    max_requests: int = 100
    burst: int = 20
    penalty_threshold: int = 10  # Consecutive violations before IP ban
    penalty_cooldown: int = 300  # Seconds IP ban lasts


class CacheConfig(BaseModel):
    """Read caching bounds mitigating backend latency bottlenecks locally."""

    enabled: bool = True
    backend: Literal["memory", "redis", "sqlite"] = "memory"
    redis_url: str = ""
    max_memory: str = "100 MB"
    default_ttl: int = 60
    query_cache: bool = True
    fs_cache: bool = True
    idempotency_ttl: int = 86400  # Seconds before idempotency keys expire (24h)
    response_cache_ttl: int = 30  # Default max-age for cacheable GET responses
    query_results_ttl: int = 5  # Max-age for SQL row data results
    upload_session_ttl: int = 3600  # Seconds before chunked upload session expires (1h)


class EDAConfig(BaseModel):
    """Configuration for Event-Driven Architecture (EDA) backing unified streams and Webhook queues."""

    enabled: bool = True
    backend: Literal["memory", "redis"] = "memory"
    redis_url: str = "redis://127.0.0.1:6379/1"
    max_stream_length: int = 100000
    dlq_retention_hours: int = 72
    consumer_group: str = "axiom_workers"
    consumer_name: str = "worker_1"


class PerformanceConfig(BaseModel):
    """Tuning knobs for internal caches and hot-path algorithms."""

    query_cache_size: int = 2048  # LRU slots for parsed query AST cache
    transpiler_cache_size: int = 4096  # LRU slots for SQL dialect transpilation
    rate_limit_cache_size: int = 256  # LRU slots for rate-limit lookups


class MCPConfig(BaseModel):
    """Configuration for the Model Context Protocol (MCP) server."""

    server_name: str = "axiom"
    server_version: str = "1.0.5"  # Mirrors src/__init__.py __version__
    max_result_rows: int = 50
    max_directory_entries: int = 100
    max_file_read_bytes: int = 1_048_576


# ─────────────────────────────────────────────────────────────────────────────
# Dynamic Module Targets
# ─────────────────────────────────────────────────────────────────────────────


class WebhookGlobalConfig(BaseModel):
    enabled: bool = True
    timeout: int = 5
    max_retries: int = 3
    retry_delay: int = 2
    queue_size: int = 10000
    secret_header: str = "X-Axiom-Signature"
    max_concurrent_deliveries: int = 8
    persistence_enabled: bool = True
    persistence_path: str = "./data/webhooks/webhooks.db"
    dead_letter_enabled: bool = True
    dead_letter_retention_hours: int = 72
    circuit_breaker_enabled: bool = True
    circuit_breaker_threshold: int = 5
    circuit_breaker_recovery: int = 30
    retry_jitter_enabled: bool = True


class WebhookDefConfig(BaseModel):
    url: str
    secret: str
    rule: str
    headers: Dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    timeout: int = 0
    max_retries: int = 0
    delivery_format: Literal["json", "protobuf"] = "json"

    @field_validator("rule")
    def validate_rule(cls, rule_property):
        if not re.match(
            r"^(db|fs)\.(read|write|delete|any)@[^:]+:[^:]+$", rule_property
        ):
            raise ValueError("Rule must match format: module.operation@alias:target")
        return rule_property


class DatabaseDefConfig(BaseModel):
    engine: DbEngineType
    url: str
    mode: ServerMode = ServerMode.READWRITE
    federated_alias: Optional[str] = None
    pool_min: int = 5
    pool_max: int = 50
    connection_timeout: int = 30
    idle_timeout: int = 600
    max_lifetime: int = 3600
    query_whitelist: Optional[List[str]] = None
    query_blacklist: Optional[List[str]] = Field(
        default_factory=lambda: ["DROP", "TRUNCATE", "ALTER"]
    )
    dangerous_operations: bool = False


class StorageDefConfig(BaseModel):
    path: str
    mode: ServerMode = ServerMode.READWRITE
    limit: str = "5 GB"
    chunk_size: str = "10 MB"
    allowed_extensions: List[str] = Field(default_factory=list)
    blocked_extensions: List[str] = Field(
        default_factory=lambda: [".exe", ".bat", ".sh", ".cmd", ".ps1"]
    )
    max_file_size: str = "500 MB"
    access: List[str] = Field(default_factory=lambda: ["*"])


class ApiKeyDefConfig(BaseModel):
    mode: ServerMode = ServerMode.READWRITE
    secret: str
    db_scope: List[str] = Field(default_factory=lambda: ["*"])
    fs_scope: List[str] = Field(default_factory=lambda: ["*"])
    feature_scope: List[str] = Field(default_factory=lambda: ["*"])
    rate_limit_override: int = 0
    full_admin: bool = False

    @field_validator("secret")
    def validate_secret_length(cls, secret_val):
        if len(secret_val) < 32:
            raise ValueError("API key secret must be at least 32 characters long")
        return secret_val


# ─────────────────────────────────────────────────────────────────────────────
# Networking Subsystems
# ─────────────────────────────────────────────────────────────────────────────


class FederationIncomingKeyConfig(BaseModel):
    secret: str
    mode: ServerMode = ServerMode.READONLY
    db_scope: List[str] = Field(default_factory=lambda: ["*"])
    fs_scope: List[str] = Field(default_factory=lambda: ["*"])
    feature_scope: List[str] = Field(default_factory=lambda: ["*"])
    description: str = ""

    @field_validator("secret")
    def validate_secret_length(cls, secret_val):
        if len(secret_val) < 32:
            raise ValueError("Federation secret must be at least 32 characters long")
        return secret_val


class FedServerConfig(BaseModel):
    url: str
    secret: str
    node_id: str
    trust_mode: Literal["verify", "trust"] = "verify"
    grpc_port: int = 50051
    grpc_enabled: bool = True


class FederationNodeState(BaseModel):
    status: Literal["unknown", "up", "degraded", "down"] = "unknown"
    latency_ms: float = 0.0
    last_check: float = 0.0
    consecutive_failures: int = 0
    next_retry_at: float = 0.0
    databases: dict = Field(default_factory=dict)
    storages: dict = Field(default_factory=dict)


class FederationConfig(BaseModel):
    enabled: bool = False
    sync_interval: int = 30
    per_node_timeout: float = 5.0
    backoff_max: float = 300.0
    circuit_breaker_threshold: int = 3
    grpc_port: int = 50051
    grpc_max_message_mb: int = 100
    grpc_keepalive_seconds: int = 30
    incoming: Dict[str, FederationIncomingKeyConfig] = Field(default_factory=dict)
    server: Dict[str, FedServerConfig] = Field(default_factory=dict)
    alias_map: Dict[str, str] = Field(default_factory=dict)


class CircuitBreakerConfig(BaseModel):
    enabled: bool = True
    failure_threshold: int = 5
    success_threshold: int = 3
    timeout: int = 30


# ─────────────────────────────────────────────────────────────────────────────
# Auth Subsystem
# ─────────────────────────────────────────────────────────────────────────────


class AuthEmailConfig(BaseModel):
    provider: Literal["smtp"] = "smtp"
    from_address: str = "noreply@axiom.local"
    from_name: str = "Axiom Auth"
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = False


class AuthProjectConfig(BaseModel):
    # Lifetimes
    access_token_ttl: int = 900
    refresh_token_ttl: int = 2592000
    magic_link_ttl: int = 600
    verification_ttl: int = 86400
    password_reset_ttl: int = 3600
    otp_ttl: int = 600

    # Resend
    resend_cooldown: int = 60
    resend_max_per_hour: int = 5

    # Password Policy
    min_password_length: int = 8
    require_uppercase: bool = False
    require_number: bool = False
    require_symbol: bool = False
    pwned_check: bool = False

    # Verification
    email_verification: bool = True
    verification_method: Literal["token", "otp"] = "token"

    # TOTP
    totp_enabled: bool = True
    totp_issuer: str = "Axiom"
    backup_codes_count: int = 8

    # Anonymous
    anonymous_auth: bool = False
    anonymous_upgrade_ttl: int = 604800

    # JWT Injection
    jwt_custom_claims: List[str] = Field(default_factory=list)

    # Rate limiting
    max_login_attempts: int = 5
    lockout_duration: int = 900
    max_signup_per_ip: int = 10
    max_otp_attempts: int = 3
    ip_allowlist: List[str] = Field(default_factory=list)

    # URLs
    callback_url: str = ""
    allowed_redirect_urls: List[str] = Field(default_factory=list)

    # Webhooks
    webhook_on_signup: bool = False
    webhook_on_login: bool = False
    webhook_on_logout: bool = False
    webhook_on_password_reset: bool = False
    webhook_on_email_change: bool = False
    webhook_on_delete: bool = False

    email: AuthEmailConfig = Field(default_factory=AuthEmailConfig)


class AuthConfig(BaseModel):
    project: Dict[str, AuthProjectConfig] = Field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Master Node Payload
# ─────────────────────────────────────────────────────────────────────────────


class AxiomConfig(BaseModel):
    """The absolute Master Layout tracking all active operational parameters per-boot."""

    server: ServerConfig = Field(default_factory=ServerConfig)
    __version__: str = "1.0.5"
    features: FeaturesConfig = Field(default_factory=FeaturesConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    rate_limit: RateLimitConfig = Field(default_factory=RateLimitConfig)
    cache: CacheConfig = Field(default_factory=CacheConfig)
    performance: PerformanceConfig = Field(default_factory=PerformanceConfig)
    mcp: MCPConfig = Field(default_factory=MCPConfig)
    graphql: GraphQLConfig = Field(default_factory=GraphQLConfig)
    websocket: WebSocketConfig = Field(default_factory=WebSocketConfig)
    sse: SSEConfig = Field(default_factory=SSEConfig)
    eda: EDAConfig = Field(default_factory=EDAConfig)
    webhooks: WebhookGlobalConfig = Field(default_factory=WebhookGlobalConfig)
    webhook: Dict[str, WebhookDefConfig] = Field(default_factory=dict)
    database: Dict[str, DatabaseDefConfig] = Field(default_factory=dict)
    storage: Dict[str, StorageDefConfig] = Field(default_factory=dict)
    api_key: Dict[str, ApiKeyDefConfig] = Field(default_factory=dict)
    federation: FederationConfig = Field(default_factory=FederationConfig)
    circuit_breaker: CircuitBreakerConfig = Field(default_factory=CircuitBreakerConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)

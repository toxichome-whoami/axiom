<div align="center">
  <h1>Axiom Configuration Reference</h1>
  <p><em>Comprehensive reference for all config.toml parameters</em></p>
</div>

<hr/>

See `config.example.toml` for a ready-to-copy template.

---

## `[server]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `host` | string | `"0.0.0.0"` | Bind address |
| `port` | int | `4500` | Listen port |
| `workers` | int | `0` | uvicorn workers (0 = auto) |
| `max_connections` | int | `10000` | Max concurrent connections |
| `request_timeout` | int | `30` | Request timeout in seconds |
| `body_limit` | string | `"10 MB"` | Max request body size |
| `tls_cert` | string | `""` | Path to TLS cert (blank = HTTP) |
| `tls_key` | string | `""` | Path to TLS private key |
| `allowed_ips` | list | `[]` | IPs exempt from rate limiting |
| `trusted_proxies` | list | `["127.0.0.1"]` | Trusted reverse proxy IPs |
| `cors_origins` | list | `["*"]` | Allowed CORS origins |
| `shutdown_timeout` | int | `30` | Graceful shutdown timeout |

---

## `[features]`

Feature flags to enable/disable entire subsystems.

| Key | Default | Description |
|-----|---------|-------------|
| `database` | `true` | Enable `/api/v1/db/*` endpoints |
| `storage` | `true` | Enable `/api/v1/fs/*` endpoints |
| `webhook` | `true` | Enable webhook emission |
| `federation` | `false` | Enable `/api/v1/fed/*` and sync |
| `metrics` | `true` | Enable `/metrics` endpoint |
| `playground` | `false` | Enable Swagger UI at `/api/docs` |
| `mcp` | `false` | Enable MCP JSON-RPC server at `/api/v1/mcp` |
| `graphql` | `false` | Enable optional GraphQL gateway at `/api/v1/graphql` |
| `websocket` | `false` | Enable real-time WebSocket push gateway at `/api/v1/ws` |

---

## `[logging]`

| Key | Default | Description |
|-----|---------|-------------|
| `level` | `"INFO"` | `TRACE \| DEBUG \| INFO \| WARN \| ERROR` |
| `format` | `"json"` | `json \| pretty` |
| `directory` | `"./logs"` | Log file output directory |
| `file_prefix` | `"axiom"` | Log filename prefix |
| `max_file_size` | `"50 MB"` | Rotate when log exceeds this size |
| `max_files` | `5` | Max rotated log files to keep |
| `stdout` | `true` | Also log to stdout |

---

## `[rate_limit]`

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable rate limiting |
| `backend` | `"memory"` | `memory \| redis` |
| `redis_url` | `""` | Redis URL (required if backend=redis) |
| `window` | `60` | Window size in seconds |
| `max_requests` | `100` | Max requests per window per key |
| `burst` | `20` | Additional burst allowance |
| `penalty_cooldown` | `300` | IP ban duration after 10 violations |

---

## `[cache]`

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable caching |
| `backend` | `"memory"` | `memory \| redis` |
| `redis_url` | `""` | Redis URL |
| `max_memory` | `"100 MB"` | Memory cache size bound |
| `default_ttl` | `60` | Default TTL in seconds |
| `query_cache` | `true` | Cache DB query results |
| `fs_cache` | `true` | Cache file metadata |

---

## `[webhooks]`

Global webhook delivery settings.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable webhook delivery |
| `timeout` | `5` | HTTP delivery timeout |
| `max_retries` | `3` | Retry attempts on failure |
| `retry_delay` | `2` | Base delay (exponential: delay^attempt) |
| `queue_size` | `10000` | Max pending webhook events |
| `secret_header` | `"X-Axiom-Signature"` | HMAC header name |
| `max_concurrent_deliveries` | `8` | Number of background dispatch workers |
| `persistence_enabled` | `true` | Save events to SQLite before delivery |
| `persistence_path` | `"./data/webhooks.db"` | SQLite database path |
| `dead_letter_enabled` | `true` | Save permanently failed events |
| `dead_letter_retention_hours` | `72` | Hours to keep dead letter events |
| `circuit_breaker_enabled` | `true` | Enable circuit breakers per URL |
| `circuit_breaker_threshold` | `5` | Failures before opening circuit |
| `circuit_breaker_recovery` | `30` | Seconds to wait before probe request |
| `retry_jitter_enabled` | `true` | Add 50-150% jitter to retry delay |

---

## `[webhook.<name>]`

Per-webhook subscription definition.

| Key | Required | Description |
|-----|----------|-------------|
| `url` | yes | Delivery endpoint URL |
| `secret` | yes | HMAC-SHA256 signing secret (≥32 chars) |
| `rule` | yes | Subscription rule (see format below) |
| `headers` | no | Extra headers to send with each delivery |
| `enabled` | `true` | Enable or disable this rule |
| `timeout` | `0` | Per-hook delivery timeout (0 = global default) |
| `max_retries` | `0` | Per-hook max retries (0 = global default) |
| `delivery_format` | `"json"` | Payload format: `json \| protobuf` |

**Rule format:** `module.operation@alias:target`

- `module`: `db` or `fs`
- `operation`: `read`, `write`, `delete`, `any`, or `*`
- `alias`: database/storage alias or `*`
- `target`: table name, file path, or `*`

---

## `[database.<alias>]`

| Key | Default | Description |
|-----|---------|-------------|
| `engine` | required | `sqlite \| postgres \| mysql \| mariadb \| mssql` |
| `url` | required | Connection URL |
| `mode` | `"readwrite"` | `readwrite \| readonly \| writeonly` |
| `pool_min` | `2` | Minimum pool connections |
| `pool_max` | `20` | Maximum pool connections |
| `connection_timeout` | `5` | Connect timeout in seconds |
| `idle_timeout` | `300` | Idle connection timeout |
| `max_lifetime` | `1800` | Max connection lifetime |
| `query_whitelist` | `null` | Only allow these SQL operations |
| `query_blacklist` | `["DROP","TRUNCATE","ALTER"]` | Block these SQL operations |
| `dangerous_operations` | `false` | Allow DDL (DROP/ALTER/TRUNCATE) |

---

## `[storage.<alias>]`

| Key | Default | Description |
|-----|---------|-------------|
| `path` | required | Absolute or relative root directory |
| `mode` | `"readwrite"` | `readwrite \| readonly \| writeonly` |
| `limit` | `"5 GB"` | Maximum total storage size |
| `chunk_size` | `"10 MB"` | Default upload chunk size |
| `max_file_size` | `"500 MB"` | Max single file upload size |
| `allowed_extensions` | `[]` | Allowed extensions (empty = all) |
| `blocked_extensions` | `[".exe",".bat",...]` | Blocked extensions |

---

## `[api_key.<name>]`

> [!NOTE]
> This configures **Static API Keys**. You can also generate and manage **Dynamic API Keys** seamlessly via the `/api/admin/keys` endpoint. For security reasons, Dynamic keys cannot be assigned `full_admin` privileges; only static keys managed by developers in this configuration file may act as superadmins.

| Key | Required | Description |
|-----|----------|-------------|
| `secret` | yes | Secret string (≥32 chars) |
| `mode` | `"readwrite"` | `readwrite \| readonly \| writeonly` |
| `db_scope` | `["*"]` | Accessible database aliases |
| `fs_scope` | `["*"]` | Accessible storage aliases |
| `rate_limit_override` | `0` | Per-key rate limit (0 = global) |
| `full_admin` | `false` | Grants access to `/api/admin/*` endpoints |

---

## `[circuit_breaker]`

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable circuit breaker |
| `failure_threshold` | `5` | Failures before tripping OPEN |
| `success_threshold` | `3` | Successes in HALF_OPEN before CLOSED |
| `timeout` | `30` | Seconds before retry |

---

## `[federation]`

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Enable federation |
| `sync_interval` | `30` | Health sync interval in seconds |
| `per_node_timeout` | `5.0` | Node health check timeout |
| `backoff_max` | `300.0` | Max backoff for failed nodes |
| `circuit_breaker_threshold` | `3` | Failures before marking node down |
| `grpc_port` | `50051` | Default gRPC listen port |
| `grpc_max_message_mb` | `100` | Max gRPC message size in MB |
| `grpc_keepalive_seconds` | `30` | gRPC ping interval |

## `[federation.incoming.<node_id>]`

Per-node incoming authentication. Each block allows exactly one remote server to connect.

| Key | Required | Description |
|-----|----------|-------------|
| `secret` | yes | Federation secret (≥32 chars, unique per node) |
| `mode` | `"readonly"` | `readwrite \| readonly` |
| `db_scope` | `["*"]` | Accessible database aliases |
| `fs_scope` | `["*"]` | Accessible storage aliases |
| `description` | `""` | Human-readable label for this node |

## `[federation.server.<alias>]`

Outgoing connections to remote Axiom servers.

| Key | Required | Description |
|-----|----------|-------------|
| `url` | yes | Remote Axiom base URL |
| `secret` | yes | Federation secret (must match remote's incoming key) |
| `node_id` | yes | Your identity on the remote server |
| `trust_mode` | `"verify"` | `verify` (TLS) or `trust` (skip TLS check) |
| `grpc_port` | `50051` | Remote server's gRPC port |
| `grpc_enabled` | `true` | Use gRPC for this node with HTTP proxy fallback |

---

## `[mcp]`

Model Context Protocol server configuration. Enables AI assistants to interact with databases and storage.

| Key | Default | Description |
|-----|---------|-------------|
| `server_name` | `"axiom"` | Server identity sent to MCP clients |
| `server_version` | `"1.0.5"` | Version advertised in initialization |
| `max_result_rows` | `50` | Max rows returned per query |
| `max_directory_entries` | `100` | Max files listed per directory |
| `max_file_read_bytes` | `1048576` | Max file read size (bytes) |

---

## `[graphql]`

> [!NOTE]
> GraphQL is an **optional, secondary interface**. Axiom is natively a REST API gateway. This section only applies when `features.graphql = true`. When disabled, the endpoint does not exist and consumes zero resources.

| Key | Default | Description |
|-----|---------|-------------|
| `endpoint` | `"/api/v1/graphql"` | URL path the GraphQL POST endpoint is mounted at |
| `query_cache_enabled` | `true` | Cache compiled AST-to-SQL results to skip recompilation on repeat queries |
| `query_cache_size` | `512` | Max LRU slots for the compiled query cache |
| `max_query_depth` | `15` | Maximum GraphQL query nesting depth — prevents DoS via deeply nested queries |
| `introspection` | `false` | Allow schema introspection queries — disable in production for security |

---

## `[websocket]`

> [!NOTE]
> WebSocket is an **optional, secondary interface**. Axiom is natively a REST API gateway. This section only applies when `features.websocket = true`. When disabled, the endpoint does not exist and consumes zero resources.

Real-time bidirectional push gateway. Clients connect to `ws://host:port/api/v1/ws`, authenticate with the first JSON message, then subscribe to topics that map to DB tables and storage paths.

| Key | Default | Description |
|-----|---------|-------------|
| `max_connections` | `10000` | Maximum concurrent WebSocket connections |
| `heartbeat_interval` | `30` | Seconds between server ping messages |
| `auth_timeout` | `5.0` | Seconds a client has to send the auth message after connecting |
| `max_subscriptions_per_client` | `100` | Maximum topic subscriptions per connection |

---

## `[eda]`

Event-Driven Architecture (EDA) configuration. When enabled and backed by Redis, the system uses high-performance Redis Streams for unified event publishing, Consumer Groups for background task dispatching, and Dead-Letter Queues (DLQ) for webhook retry handling.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable EDA routing (if false, events fallback to local memory loops) |
| `backend` | `"memory"` | Backend to use: `memory \| redis` |
| `redis_url` | `"redis://127.0.0.1:6379/1"` | Redis connection URL |
| `max_stream_length` | `100000` | Max events retained in the stream via XADD MAXLEN |
| `dlq_retention_hours` | `72` | Hours to retain failed webhook deliveries in the DLQ stream |
| `consumer_group` | `"axiom_workers"` | Redis Consumer Group name |
| `consumer_name` | `"worker_1"` | Identifier for this specific node in the Consumer Group |

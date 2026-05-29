<div align="center">
  <h1>Axiom Configuration Reference</h1>
  <p><em>Comprehensive reference for all config.toml parameters</em></p>
</div>

<hr/>

See `config.example.toml` for a ready-to-copy template.

---

## Hot Reloading (Dynamic vs Startup Configs)

Axiom features a zero-downtime hot-reloading daemon that watches `config.toml` for changes. However, it is crucial to understand that **not all settings can be hot-reloaded**. 

1. **Startup Settings (Require Restart):** These settings dictate deep architectural constraints (like binding ports, compiling log pipelines, or mounting FastAPI routers). If you change these, the watcher detects it, but the application **requires a full restart** to apply them:
   - `[server]` (host, port, workers, tls)
   - `[features]` (enabling/disabling entire gateways like MCP, GraphQL, etc.)
   - `[logging]` (format, file sizes)

2. **Dynamic Settings (Hot Reloadable):** These settings govern runtime traffic rules and limits. Changing these applies **instantly without restarting**:
   - `[rate_limit]` thresholds and bans
   - `[circuit_breaker]` logic
   - `[webhooks]` destinations and retries
   - `[api_key]` permissions and scopes

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
| `sse` | `true` | Enable real-time SSE push gateway at `/api/v1/sse` |
| `auth` | `false` | Enable the Axiom Auth identity system at `/api/v1/auth/*` |
| `telemetry` | `false` | Enable OpenTelemetry instrumentation for distributed tracing |

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
| `feature_scope`| `["*"]` | Accessible feature endpoints (`mcp`, `ws`, `graphql`, `sse`, `webhooks`) |
| `rate_limit_override` | `0` | Per-key rate limit (0 = global) |
| `full_admin` | `false` | Grants access to `/api/admin/*` endpoints |

---

## `[features]` — `auth`

| Key | Default | Description |
|-----|---------|-------------|
| `auth` | `false` | Enable the Axiom Auth identity system at `/api/v1/auth/*` |

---

## `[auth.project.<name>]`

Configures one isolated auth project. The `<name>` must match an API key name defined in `[api_key.<name>]`. Each project gets its own isolated SQLite database, Ed25519 key, and email config.

**Database**

| Key | Default | Description |
|-----|---------|-------------|
| `db_url` | *(Optional)* | Database URL for horizontal scaling (e.g., `postgresql+asyncpg://user:pass@host/db`). If omitted, defaults to an isolated SQLite file at `data/auth/<api_key_name>/auth.db` |

**Token Lifetimes**

| Key | Default | Description |
|-----|---------|-------------|
| `access_token_ttl` | `900` | Seconds until Ed25519 JWT access token expires |
| `refresh_token_ttl` | `2592000` | Seconds until refresh token expires (30 days) |
| `magic_link_ttl` | `600` | Seconds until magic login link expires |
| `verification_ttl` | `86400` | Seconds until email verification token/link expires |
| `password_reset_ttl` | `3600` | Seconds until password reset link expires |
| `otp_ttl` | `600` | Seconds until a numeric OTP expires |

**Email Resend Throttling**

| Key | Default | Description |
|-----|---------|-------------|
| `resend_cooldown` | `60` | Minimum seconds between email resends per user |
| `resend_max_per_hour` | `5` | Max email sends per user per hour |

**Password Policy**

| Key | Default | Description |
|-----|---------|-------------|
| `min_password_length` | `8` | Minimum required password length |
| `require_uppercase` | `false` | Require at least one uppercase character |
| `require_number` | `false` | Require at least one numeric digit |
| `require_symbol` | `false` | Require at least one special character |
| `pwned_check` | `false` | Reject passwords found in HaveIBeenPwned breach database |

**Email Verification**

| Key | Default | Description |
|-----|---------|-------------|
| `email_verification` | `true` | Block login until email is verified |
| `verification_method` | `"token"` | `"token"` (link in email) or `"otp"` (numeric code) |

**TOTP / 2FA**

| Key | Default | Description |
|-----|---------|-------------|
| `totp_enabled` | `true` | Allow users to enroll in TOTP 2FA |
| `totp_issuer` | `"Axiom"` | Name shown in Authenticator apps (e.g. Google Authenticator) |
| `backup_codes_count` | `8` | Number of one-time backup codes generated on TOTP confirm |

**Anonymous Auth**

| Key | Default | Description |
|-----|---------|-------------|
| `anonymous_auth` | `false` | Allow unauthenticated anonymous sessions |
| `anonymous_upgrade_ttl` | `604800` | Seconds before an unupgraded anonymous account is purged (7 days) |

**JWT Custom Claims & RBAC**

| Key | Default | Description |
|-----|---------|-------------|
| `jwt_custom_claims` | `[]` | List of user metadata keys to inject into the JWT payload. Add `"role"` here to enable server-side RBAC |

**WebAuthn (Passkeys)**

| Key | Default | Description |
|-----|---------|-------------|
| `webauthn_enabled` | `true` | Enable passwordless logins via device biometrics (FaceID/TouchID) |
| `rp_id` | `"localhost"` | Relying Party ID — must match your domain (e.g. `example.com`) |
| `rp_name` | `"Axiom"` | Human-readable app name shown in the browser passkey dialog |
| `origin` | `"http://localhost:3000"` | Full origin URL where registration/authentication flows are initiated |

**Security Alerts**

| Key | Default | Description |
|-----|---------|-------------|
| `new_device_alerts` | `true` | Send a security email when a user logs in from a new IP address |

**Rate Limiting & Security**

| Key | Default | Description |
|-----|---------|-------------|
| `max_login_attempts` | `5` | Failed login attempts before account lockout |
| `lockout_duration` | `900` | Lockout duration in seconds (15 minutes) |
| `max_signup_per_ip` | `10` | Max signups allowed from a single IP |
| `max_otp_attempts` | `3` | Max incorrect OTP attempts before invalidation |
| `ip_allowlist` | `[]` | IPs that bypass auth rate limiting |

**Redirect URLs**

| Key | Default | Description |
|-----|---------|-------------|
| `callback_url` | `""` | Default redirect URL after magic link / email verification |
| `allowed_redirect_urls` | `[]` | Allowed redirect URLs (others are rejected) |

**Webhook Triggers**

| Key | Default | Description |
|-----|---------|-------------|
| `webhook_on_signup` | `false` | Emit webhook on new user signup |
| `webhook_on_login` | `false` | Emit webhook on successful login |
| `webhook_on_logout` | `false` | Emit webhook on logout |
| `webhook_on_password_reset` | `false` | Emit webhook on password reset |
| `webhook_on_email_change` | `false` | Emit webhook on email change |
| `webhook_on_delete` | `false` | Emit webhook on account deletion |

---

## `[auth.project.<name>.email]`

SMTP transport for sending verification, magic link, and password reset emails.

| Key | Default | Description |
|-----|---------|-------------|
| `provider` | `"smtp"` | Transport provider — currently only `"smtp"` is supported |
| `from_address` | `"noreply@axiom.local"` | Sender email address |
| `from_name` | `"Axiom Auth"` | Sender display name |
| `smtp_host` | `"127.0.0.1"` | SMTP server hostname |
| `smtp_port` | `1025` | SMTP server port |
| `smtp_user` | `""` | SMTP username (leave blank if no auth) |
| `smtp_password` | `""` | SMTP password |
| `smtp_tls` | `false` | Use STARTTLS / TLS for the SMTP connection |

**Example:**
```toml
[auth.project.default_project]
min_password_length = 8
email_verification = true
verification_method = "token"
totp_enabled = true
totp_issuer = "My App"
anonymous_auth = false
access_token_ttl = 3600
refresh_token_ttl = 604800
webhook_on_signup = true

[auth.project.default_project.email]
provider = "smtp"
host = "smtp.mailtrap.io"
port = 2525
username = "your_username"
password = "your_password"
from_email = "noreply@myapp.com"
from_name = "My App Auth"
```

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
| `feature_scope`| `["*"]` | Accessible feature endpoints |
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

### Authentication Flow

WebSocket connections **cannot** use the `Authorization` HTTP header directly because the browser's native `WebSocket` API does not allow custom headers during the initial handshake. Putting the token in the URL (e.g. `?token=...`) is **insecure** — URLs are logged in plaintext by every Nginx/CDN access log and stored in browser history.

Axiom solves this by requiring authentication as the **first JSON message** after the socket is established, fully shielded by WSS/TLS encryption:

```json
// Step 1: Client opens the socket
// ws://host:4500/api/v1/ws

// Step 2: Client MUST send this as the first message (within auth_timeout seconds)
{ "type": "auth", "token": "<base64(key_name:secret)>" }

// Step 3: Server replies on success
{ "type": "connected", "client_id": "admin_140234..." }

// Step 4: Client subscribes to topics
{ "type": "subscribe", "topic": "db.localdb.users" }
```

The same API key used for REST is reused here. The key must have `"ws"` in its `feature_scope` (or `full_admin = true`).

### DoS Protections

- **Auth Timeout:** If a client connects but does not send a valid auth message within `auth_timeout` seconds, the server forcefully closes the connection with code `4001`. This prevents idle connection exhaustion attacks.
- **Hard Cap:** Once `max_connections` is reached, new socket upgrade requests are immediately rejected with code `1013 (Server at maximum capacity)` — guaranteeing the server never runs out of memory or file descriptors under flood conditions.

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

---

## `[backups]`

Automated Point-in-Time Recovery (PITR) engine. When enabled, Axiom runs a background daemon that compresses the `data/` directory and streams it to an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) at regular intervals.

> [!NOTE]
> The `data/` directory contains all SQLite databases (auth, security, webhooks). Enabling this gives you full disaster recovery capability without any external orchestration tools.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Enable the backup daemon |
| `interval_minutes` | `5` | How often (in minutes) to compress and upload a snapshot |
| `s3_bucket` | `""` | Target S3 bucket name |
| `s3_region` | `"us-east-1"` | AWS region or equivalent for your S3-compatible provider |
| `s3_endpoint_url` | `null` | Override endpoint for non-AWS providers (e.g. `https://...r2.cloudflarestorage.com`) |
| `s3_access_key` | `""` | S3 Access Key ID |
| `s3_secret_key` | `""` | S3 Secret Access Key |

**Example (Cloudflare R2):**
```toml
[backups]
enabled = true
interval_minutes = 60
s3_bucket = "axiom-backups"
s3_region = "auto"
s3_endpoint_url = "https://<account_id>.r2.cloudflarestorage.com"
s3_access_key = "your_r2_access_key"
s3_secret_key = "your_r2_secret_key"
```

---

## `[telemetry]`

OpenTelemetry distributed tracing configuration. Requires `features.telemetry = true`.

> [!NOTE]
> When `features.telemetry = true`, Axiom **always** generates a unique 32-character `trace_id` for every request log line — even without a configured exporter. The exporter is optional and only needed to ship traces to an external visualization tool.

| Key | Default | Description |
|-----|---------|-------------|
| `otlp_endpoint` | `""` | OTLP collector URL. Leave blank to generate local trace IDs only. Overrideable with the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable |

**Example:**
```toml
[features]
telemetry = true

[telemetry]
otlp_endpoint = "http://localhost:4318"   # Standard Jaeger/OTLP port
```

**Trace ID in every log line:**
```json
{ "trace_id": "a759389c3b7340cd0645e0024f08bd24", "request_id": "req_019e...", "method": "GET", "path": "/api/v1/db/databases", "status": 200 }
```

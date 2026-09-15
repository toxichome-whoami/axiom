<div align="center">
  <h1>Axiom Configuration Reference</h1>
  <p><em>Comprehensive reference for all config.toml parameters</em></p>
</div>

<hr/>

See `config.example.toml` for a ready-to-copy template.

---

## Configuration Loading

Axiom loads `config.toml` **once at startup** into a `std::sync::OnceLock<Arc<AxiomConfig>>`. This provides lock-free, zero-contention reads from every concurrent worker thread — a key reason for the high throughput.

> [!IMPORTANT]
> **All settings require a server restart to take effect.** There is no hot-reloading. Because configuration is stored immutably in a `OnceLock`, it cannot be changed at runtime without restarting the process.

For zero-downtime config changes, use a reverse proxy (Nginx, Caddy) in front of Axiom and perform a rolling restart.

### Environment Variable Overrides

Every configuration property defined in `config.toml` can be directly overridden using environment variables. This is particularly useful for Docker deployments or dynamic secret injection.

**Important Rule:** When specifying nested configuration sections via environment variables, use **double underscores (`__`)** as the separator instead of single underscores. This allows keys that natively contain single underscores (like `local_uploads` or `max_file_size`) to parse correctly without getting split.

For example, to override `[server]` -> `port` (which is `server.port`):
`SERVER__PORT=4500`

To override `[api_key.admin]` -> `db_scope`:
`API_KEY__ADMIN__DB_SCOPE="[*]"`

To override `[database.remote_localdb]` -> `url`:
`DATABASE__REMOTE_LOCALDB__URL="postgres://..."`

Axiom includes a `toml2env.go` script in the `scripts/` folder which automatically transpiles your `config.toml` file into a ready-to-use `.env` file using these exact double-underscore rules.

---

## `[server]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `host` | string | `"127.0.0.1"` | Bind address |
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
| `backend` | `"memory"` | `memory \| turso` |
| `turso_url` | `""` | Turso URL (required if backend=turso) |
| `turso_token` | `""` | Turso API Token |
| `window` | `60` | Window size in seconds |
| `max_requests` | `100` | Max requests per window per key |
| `burst` | `20` | Additional burst allowance |
| `penalty_cooldown` | `300` | IP ban duration after 10 violations |

---

## `[cache]`

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable caching |
| `backend` | `"memory"` | `memory \| turso` |
| `turso_url` | `""` | Turso URL |
| `turso_token` | `""` | Turso API Token |
| `max_memory` | `"100 MB"` | Memory cache size bound |
| `default_ttl` | `60` | Default TTL in seconds |
| `query_cache` | `true` | Cache DB query results |

---

## `[database.<alias>]`

| Key | Default | Description |
|-----|---------|-------------|
| `engine` | required | `sqlite \| postgres \| mysql \| mariadb \| mssql` |
| `url` | required | Connection URL |
| `mode` | `"readwrite"` | `readwrite \| readonly \| writeonly` |
| `pool_min` | `2` | Minimum pool connections |
| `pool_max` | `80` | Maximum pool connections (tune to your DB server's `max_connections`) |
| `connection_timeout` | `5` | Connect timeout in seconds |
| `idle_timeout` | `300` | Idle connection timeout |
| `max_lifetime` | `1800` | Max connection lifetime |
| `query_whitelist` | `null` | Only allow these SQL operations |
| `query_blacklist` | `["DROP","TRUNCATE","ALTER"]` | Block these SQL operations |
| `dangerous_operations` | `false` | Allow DDL (DROP/ALTER/TRUNCATE) |

---

## `[api_key.<name>]`

| Key | Required | Description |
|-----|----------|-------------|
| `secret` | yes | Secret string (≥32 chars) |
| `mode` | `"readwrite"` | `readwrite \| readonly \| writeonly` |
| `db_scope` | `["*"]` | Accessible database aliases |
| `rate_limit_override` | `0` | Per-key rate limit (0 = global) |
| `full_admin` | `false` | Grants access to `/api/admin/*` endpoints |

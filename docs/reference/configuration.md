# Configuration Reference

Config is loaded once at startup from `config.toml`. A server restart is required for changes to take effect.

API keys and database connections are managed live via the Web UI or Admin API, stored in `data/axiom.db`, and hot-reloaded every `reload_interval` seconds without restart.

---

## Load Order

1. Defaults (code-defined)
2. `config.toml` (TOML file)
3. Environment variables (prefix `__` separator, e.g. `SERVER__PORT=4500`)
4. `.env` file (loaded automatically via dotenvy if present)

---

## `[server]`

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `host` | string | `"127.0.0.1"` | Bind address. Use `"0.0.0.0"` for all interfaces. |
| `port` | int | `4500` | HTTP port. No automatic HTTPS; use a reverse proxy. |
| `workers` | int | `0` | Tokio worker threads. 0 = number of logical CPUs. |
| `max_connections` | int | `10000` | Max concurrent TCP connections. |
| `request_timeout` | int | `30` | Per-request global timeout (seconds). |
| `body_limit` | string | `"10 MB"` | Max request body. Accepts `"10mb"`, `"1gb"`, etc. |
| `tls_cert` | string | `""` | Path to TLS certificate (PEM). Leave blank for plain HTTP. |
| `tls_key` | string | `""` | Path to TLS private key (PEM). |
| `allowed_ips` | string[] | `[]` | IPs exempt from rate limiting. Supports trailing `*` wildcard. |
| `trusted_proxies` | string[] | `["127.0.0.1"]` | IPs trusted to set `X-Forwarded-For`. Using `"*"` is insecure — logs a warning. |
| `cors_origins` | string[] | `["*"]` | Allowed CORS origins. Replace `"*"` with explicit origins for production. |
| `shutdown_timeout` | int | `30` | Seconds to wait for active requests during graceful shutdown. |

---

## `[metadata]`

Axiom stores live state (API keys, roles, database connections) in a libsql database.

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `url` | string | `"file:data/axiom.db"` | Local SQLite file or remote Turso URL (`libsql://...`). |
| `token` | string | `""` | Turso auth token. Empty for local SQLite. |
| `reload_interval` | int | `30` | Seconds between automatic metadata snapshot refreshes. Force a refresh with `axiom reload` or `POST /admin/v1/reload`. |

`data/axiom.db` is created automatically on first boot if it does not exist. Include it in backups. For multi-node deployments, point all nodes to the same remote Turso URL.

---

## `[rate_limit]`

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `enabled` | bool | `true` | Disable entirely for internal deployments. |
| `backend` | string | `"memory"` | `"memory"` (DashMap) or `"turso"` (persistent SQLite). |
| `turso_url` | string | `"file:data/cache.db"` | Used when `backend = "turso"`. |
| `turso_token` | string | `""` | |
| `window` | int | `60` | Time window in seconds. |
| `max_requests` | int | `100` | Max requests per IP per window. |
| `burst` | int | `20` | Allowed burst above `max_requests`. |
| `penalty_threshold` | int | `10` | Violations before IP is temporarily banned. |
| `penalty_cooldown` | int | `300` | Ban duration in seconds. |

Rate limits also apply per API key using `rate_limit_override` from the key record. Key-level limits are enforced even when the source IP rotates.

---

## `[cache]`

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `enabled` | bool | `true` | |
| `backend` | string | `"memory"` | `"memory"`, `"turso"`, or `"hybrid"` (L1 RAM + L2 SQLite). |
| `turso_url` | string | `"file:data/cache.db"` | Used when `backend = "turso"` or `"hybrid"`. |
| `turso_token` | string | `""` | |
| `max_memory` | string | `"100 MB"` | Approximate L1 memory budget. |
| `default_ttl` | int | `60` | Default cache TTL (seconds). |
| `query_cache` | bool | `true` | Cache parsed SQL ASTs. |
| `query_results_ttl` | int | `5` | SQL row result cache TTL (seconds). |
| `idempotency_ttl` | int | `86400` | Idempotency key retention (seconds). Default = 24 h. |
| `response_cache_ttl` | int | `30` | Response cache TTL for cacheable requests (seconds). |

---

## `[circuit_breaker]`

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `enabled` | bool | `true` | |
| `failure_threshold` | int | `5` | Consecutive failures before circuit opens (OPEN state — all requests rejected). |
| `success_threshold` | int | `3` | Successes in HALF-OPEN state required to close the circuit. |
| `timeout` | int | `30` | Seconds to wait in OPEN state before attempting HALF-OPEN. |

Circuit state is tracked per database alias in memory. Resets on server restart.

---

## `[logging]`

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `enabled` | bool | `true` | Set `false` to suppress all logging output. |
| `level` | string | `"INFO"` | `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`. Override with `RUST_LOG` env var without restarting. |
| `format` | string | `"json"` | `"json"` for structured production logs, `"pretty"` for human-readable development output. |
| `directory` | string | `"./logs"` | Log file output directory. Created automatically. |
| `file_prefix` | string | `"axiom"` | Log file prefix. Files rotate to `axiom.2026-10-01.log`, etc. |
| `max_file_size` | string | `"50 MB"` | Max size per log file before rotation. |
| `max_files` | int | `5` | Number of rotated files to retain. Older files are deleted. |
| `stdout` | bool | `true` | Mirror log output to stdout in addition to file. |

---

## `[performance]`

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `query_cache_size` | int | `2048` | Max entries in the in-memory AST cache. |
| `transpiler_cache_size` | int | `4096` | Internal transpiler slot budget (reserved, not actively used). |
| `rate_limit_cache_size` | int | `256` | Rate limit metadata lookup slots (reserved). |

---

## `[features]`

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `database` | bool | `true` | Enable the SQL database gateway (`/api/v1/db`). |

---

## Backward Compatibility — Legacy Blocks

If `[api_key.name]` or `[database.alias]` blocks exist in `config.toml`, Axiom reads them on first boot and seeds them into `axiom.db`. After that, the file-based blocks are ignored — manage keys and databases via the Web UI or Admin API instead.

```toml
# Legacy (v3 style) — seeded on first boot then ignored
[api_key.mykey]
secret = "plaintext-secret"
full_admin = true
db_scope = ["*"]

[database.main_db]
url = "postgres://user:pass@localhost:5432/mydb"
pool_min = 5
pool_max = 50
```

`full_admin = true` on a legacy key is preserved as an admin role. `db_scope` becomes a `permissions` entry scoping that key to the listed databases.

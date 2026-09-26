<div align="center">

# Axiom Configuration Reference

*Complete reference for every `config.toml` parameter*

</div>


> [!TIP]
> Copy `config.example.toml` as a ready-to-use starting template.
> ```bash
> cp config.example.toml config.toml
> ```


## How Configuration Works

Axiom loads `config.toml` **once at startup** into an immutable `OnceLock<Arc<AxiomConfig>>`. Every worker thread reads configuration with **zero lock acquisition overhead**  no mutexes, no contention.

> [!IMPORTANT]
> **All changes require a server restart.** There is no hot-reloading.
> For zero-downtime config changes, use a reverse proxy (Nginx, Caddy) and perform a rolling restart.


### Environment Variable Overrides

Every key in `config.toml` can be overridden via environment variable. Use **double underscores (`__`)** as the section separator.

| `config.toml` path | Environment variable |
|---|---|
| `server.port` | `SERVER__PORT=4500` |
| `api_key.admin.db_scope` | `API_KEY__ADMIN__DB_SCOPE="[*]"` |
| `database.mydb.url` | `DATABASE__MYDB__URL="postgres://..."` |

> **Why double underscores?** Single underscores are valid characters inside key names (e.g. `max_file_size`), so double underscores are used as the unambiguous section separator.


## `[server]`

Controls how Axiom binds and handles incoming connections.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `host` | string | `"127.0.0.1"` | Bind address (`0.0.0.0` for public) |
| `port` | int | `4500` | HTTP listen port |
| `workers` | int | `0` | Worker threads (0 = auto, CPUs × 2 + 1) |
| `max_connections` | int | `10000` | Max concurrent TCP connections |
| `request_timeout` | int | `30` | Request timeout in seconds |
| `body_limit` | string | `"10 MB"` | Max request body size |
| `tls_cert` | string | `""` | Path to TLS certificate (blank = HTTP only) |
| `tls_key` | string | `""` | Path to TLS private key |
| `allowed_ips` | list | `[]` | IPs exempt from rate limiting |
| `trusted_proxies` | list | `["127.0.0.1"]` | Trusted reverse proxy IPs for `X-Forwarded-For` |
| `cors_origins` | list | `["*"]` | Allowed CORS origins |
| `shutdown_timeout` | int | `30` | Graceful shutdown wait time in seconds |

> [!NOTE]
> The `workers` setting is now fully honoured to configure the multi-thread Tokio runtime (previously single-threaded).

**Example:**
```toml
[server]
host             = "0.0.0.0"
port             = 4500
max_connections  = 10000
allowed_ips      = ["127.0.0.1"]
cors_origins     = ["https://toxichome.cc"]
```


## `[features]`

Enable or disable entire API subsystems.

| Key | Default | Description |
|-----|---------|-------------|
| `database` | `true` | Enable `/api/v1/db/*` database endpoints |


## `[logging]`

Controls structured log output and rotation.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable file logging |
| `level` | `"INFO"` | `TRACE \| DEBUG \| INFO \| WARN \| ERROR` |
| `format` | `"json"` | `json \| pretty` |
| `directory` | `"./logs"` | Log file output directory |
| `file_prefix` | `"axiom"` | Log filename prefix |
| `max_file_size` | `"50 MB"` | Rotate when a log file exceeds this size |
| `max_files` | `5` | Max rotated log files to keep on disk |
| `stdout` | `true` | Also print logs to stdout |

> [!TIP]
> Use `format = "pretty"` in development, `format = "json"` in production for log aggregators like Loki or Datadog.


## `[rate_limit]`

Protects the API from abuse with per-IP and per-key fixed-window rate limiting backed by lock-free `AtomicU32` counters.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable rate limiting |
| `backend` | `"memory"` | `memory \| turso` |
| `turso_url` | `""` | Turso DB URL (required if `backend = "turso"`) |
| `turso_token` | `""` | Turso auth token |
| `window` | `60` | Window size in seconds |
| `max_requests` | `100` | Max requests per window per key |
| `burst` | `20` | Additional burst allowance on top of `max_requests` |
| `penalty_threshold` | `10` | Violations before temporary IP ban |
| `penalty_cooldown` | `300` | IP ban duration in seconds |

**Example  local Turso file cache:**
```toml
[rate_limit]
enabled   = true
backend   = "turso"
turso_url = "file:data/cache.db"
```


## `[cache]`

Query result caching to avoid redundant database round-trips.

> [!NOTE]
> The `idempotency_ttl` is fully active on the `/query` endpoint, caching responses for safe retries without hitting the database again.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable caching |
| `backend` | `"memory"` | `memory \| turso \| hybrid (L1 RAM + L2 persistent)` |
| `turso_url` | `""` | Turso DB URL (required if `backend = "turso"` or `"hybrid"`) |
| `turso_token` | `""` | Turso auth token |
| `max_memory` | `"100 MB"` | In-memory cache size bound |
| `default_ttl` | `60` | Default cache TTL in seconds |
| `query_cache` | `true` | Cache `SELECT` query results |
| `idempotency_ttl` | `86400` | Idempotency key TTL (24 hours) |
| `response_cache_ttl` | `30` | Cacheable GET response max-age |
| `query_results_ttl` | `5` | SQL row data cache TTL in seconds |


## `[circuit_breaker]`

Automatically opens the circuit when a database is unhealthy, preventing request pile-ups. Tracks failures per DB alias, and is now fully implemented and active in the execution pipeline.

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable circuit breaker |
| `failure_threshold` | `5` | Consecutive failures before `OPEN` state |
| `success_threshold` | `3` | Consecutive successes before `CLOSED` again |
| `timeout` | `30` | Seconds before attempting `HALF_OPEN` retry |

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    CLOSED --> OPEN : failures  threshold
    OPEN --> HALF_OPEN : timeout elapsed
    HALF_OPEN --> CLOSED : successes  threshold
    HALF_OPEN --> OPEN : any failure
```


## `[database.<alias>]`

Define one block per database. The `<alias>` is the name used in API routes (e.g. `/api/v1/db/mydb/query`).

| Key | Default | Description |
|-----|---------|-------------|
| `engine` | **required** | `postgres \| mysql \| mariadb` |
| `url` | **required** | Full connection URL |
| `mode` | `"readwrite"` | `readwrite \| readonly \| writeonly` |
| `pool_min` | `5` | Minimum pool connections |
| `pool_max` | `50` | Maximum pool connections |
| `connection_timeout` | `30` | Connect timeout in seconds |
| `idle_timeout` | `600` | Idle connection timeout in seconds |
| `max_lifetime` | `3600` | Max connection lifetime in seconds |
| `query_whitelist` | `null` | If set, only these SQL verbs are allowed |
| `query_blacklist` | `["DROP","TRUNCATE","ALTER"]` | Blocked SQL verbs (AST-validated) |
| `dangerous_operations` | `false` | Allow DDL (`DROP`, `ALTER`, `TRUNCATE`) |

> [!CAUTION]
> Setting `dangerous_operations = true` allows destructive queries through the API. Only use this on fully trusted internal services.

**Example:**
```toml
[database.main_db]
engine               = "postgres"
url                  = "postgres://user:password@localhost:5432/mydb"
mode                 = "readwrite"
pool_min             = 5
pool_max             = 50
query_blacklist      = ["DROP", "TRUNCATE"]
dangerous_operations = false
```


## `[api_key.<name>]`

Define one block per API key. The `<name>` is just a human-readable label.

| Key | Default | Description |
|-----|---------|-------------|
| `secret` | **required** | Secret string (minimum 32 characters recommended) |
| `mode` | `"readwrite"` | `readwrite \| readonly \| writeonly` |
| `db_scope` | `["*"]` | List of database aliases this key can access (`"*"` = all) |
| `rate_limit_override` | `0` | Per-key rate limit override (0 = use global) |
| `full_admin` | `false` | Grants access to admin-level operations |

> [!WARNING]
> Never use short or guessable secrets. Generate a strong key with:
> ```bash
> openssl rand -hex 32
> ```

**Example:**
```toml
[api_key.admin]
secret              = "your-long-random-secret-here"
mode                = "readwrite"
db_scope            = ["*"]
full_admin          = true

[api_key.readonly_service]
secret              = "another-long-random-secret"
mode                = "readonly"
db_scope            = ["main_db"]
full_admin          = false
```


<div align="center">

*Axiom  a [Toxichome](https://toxichome.cc) open-source project*

</div>

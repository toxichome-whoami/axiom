# Axiom

Single-binary Rust API gateway that exposes SQL databases over a unified REST API. Download, configure, run.

**Version:** 4.0.0 — Active development, API surface stable at `/api/v1`

---

## Requirements

- Rust 1.88+
- A `config.toml` (copy from `config.example.toml`)
- At least one reachable SQL database

Build dependencies only. No runtime dependencies beyond the binary and config file.

---

## Quick Start

```bash
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom
cp config.example.toml config.toml
```

Edit `config.toml` — add your database URL and API key under `[metadata]`, or add legacy blocks directly:

```toml
# Backward-compat: seeded into axiom.db on first boot
[api_key.mykey]
secret = "my-secret"

[database.main_db]
url = "postgres://user:pass@localhost:5432/mydb"
```

Build and run:

```bash
cargo build --release
./target/release/axiom server run    # Linux/macOS
.\target\release\axiom.exe server run  # Windows
```

Verify:

```bash
curl http://localhost:4500/ready
# {"ready":true}
```

First boot creates `data/axiom.db` automatically. The Web UI is available at `http://localhost:4500/system/`.

---

## Authentication

All data API requests require `X-Axiom-Key: base64(name:secret)`.

```bash
# Encode credentials
echo -n "mykey:my-secret" | base64
# bXlrZXk6bXktc2VjcmV0

curl -H "X-Axiom-Key: bXlrZXk6bXktc2VjcmV0" \
     http://localhost:4500/api/v1/db/databases
```

Admin API (`/admin/v1`) requires a key with `full_admin: true` or admin role.
Session tokens for the Web UI are obtained via `POST /admin/v1/auth/login`.

---

## Data API

All endpoints are under `/api/v1/db/:alias`.

### Raw SQL

```bash
curl -X POST http://localhost:4500/api/v1/db/main_db/query \
  -H "X-Axiom-Key: <encoded>" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT id, name FROM users WHERE active = ?", "params": [true]}'
```

`params` can be a JSON array (`[val1, val2]`) or an object (`{"1": val1}`). `timeout` (seconds, 1–300, default 30) is optional.

Add `Idempotency-Key: <uuid>` to safely retry mutations — responses are cached for 24 h.

### CRUD Rows

```bash
# Fetch (paginated)
curl "http://localhost:4500/api/v1/db/main_db/users/rows?limit=50&sort=id&order=desc&cursor=100" \
  -H "X-Axiom-Key: <encoded>"

# Insert
curl -X POST http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: <encoded>" -H "Content-Type: application/json" \
  -d '{"row": {"name": "Alice", "active": true}}'

# Update (filter required)
curl -X PATCH http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: <encoded>" -H "Content-Type: application/json" \
  -d '{"filter": {"id": {"$eq": 5}}, "update": {"active": false}}'

# Delete (filter required)
curl -X DELETE http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: <encoded>" -H "Content-Type: application/json" \
  -d '{"filter": {"id": {"$eq": 5}}}'
```

Filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$and`, `$or`, `$not`.

### Schema

```bash
GET /api/v1/db/:alias/tables
GET /api/v1/db/:alias/:table/schema
GET /api/v1/db/databases
```

### Response Envelope

```json
{
  "success": true,
  "data": { "rows": [...], "columns": [...] },
  "error": null
}
```

Errors: `{ "success": false, "data": null, "error": { "code": "AUTH_FORBIDDEN", "message": "..." } }`

---

## Admin API

All endpoints under `/admin/v1`. Requires admin auth.

| Method | Path | Action |
|--------|------|--------|
| `POST` | `/auth/login` | Get session token |
| `GET` | `/status` | Server info and uptime |
| `POST` | `/reload` | Hot-reload metadata snapshot |
| `GET/POST` | `/keys` | List / create API keys |
| `DELETE` | `/keys/:name` | Delete key |
| `POST` | `/keys/:name/rotate` | Rotate secret |
| `GET/POST` | `/roles` | List / create RBAC roles |
| `PATCH/DELETE` | `/roles/:name` | Update / delete role |
| `GET/POST` | `/databases` | List / add databases |
| `DELETE` | `/databases/:alias` | Remove database |
| `POST` | `/databases/test-url` | Test a raw URL before registering |
| `GET` | `/audit` | Structured query audit log |
| `GET/POST` | `/cache/stats`, `/cache/flush` | Cache inspection |
| `GET` | `/health` | Full infra health (uptime, DB status) |

Setup wizard (first boot only): `GET/POST /admin/v1/setup/begin` → `/setup/account` → `/setup/database` → `/setup/complete`.

---

## MCP (Model Context Protocol)

`POST /mcp/v1` — JSON-RPC 2.0. Requires API key auth.

Methods: `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`.

Tools: `axiom_list_services`, `axiom_list_tables`, `axiom_describe_table`, `axiom_query`, `axiom_insert`, `axiom_update`, `axiom_delete`, `axiom_raw_sql`. All subject to RBAC.

---

## Configuration

Config is loaded once at startup from `config.toml`. Restart required for changes. API keys and databases are managed live via Web UI / Admin API and stored in `data/axiom.db`.

### `[server]`

| Key | Default | Notes |
|-----|---------|-------|
| `host` | `"127.0.0.1"` | Bind address |
| `port` | `4500` | HTTP port |
| `workers` | `0` | Tokio threads (0 = CPU count) |
| `max_connections` | `10000` | Max concurrent TCP connections |
| `body_limit` | `"10 MB"` | Max request body |
| `trusted_proxies` | `["127.0.0.1"]` | IPs allowed to set X-Forwarded-For |
| `cors_origins` | `["*"]` | Allowed CORS origins |
| `allowed_ips` | `[]` | IPs exempt from rate limiting |
| `shutdown_timeout` | `30` | Graceful shutdown wait (seconds) |

### `[metadata]`

| Key | Default | Notes |
|-----|---------|-------|
| `url` | `"file:data/axiom.db"` | Local SQLite or remote Turso URL |
| `token` | `""` | Turso auth token |
| `reload_interval` | `30` | Seconds between hot-snapshot refreshes |

### `[rate_limit]`

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | |
| `window` | `60` | Seconds |
| `max_requests` | `100` | Per IP per window |
| `burst` | `20` | Allowed burst |
| `penalty_threshold` | `10` | Violations before IP ban |
| `penalty_cooldown` | `300` | Ban duration (seconds) |

### `[cache]`

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | |
| `backend` | `"memory"` | `memory`, `turso`, or `hybrid` |
| `query_results_ttl` | `5` | SQL result cache TTL (seconds) |
| `idempotency_ttl` | `86400` | Idempotency key retention (seconds) |

### `[circuit_breaker]`

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | |
| `failure_threshold` | `5` | Failures before OPEN |

### `[logging]`

| Key | Default | Notes |
|-----|---------|-------|
| `level` | `"INFO"` | `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `format` | `"json"` | `json` (prod) or `pretty` (dev) |
| `directory` | `"./logs"` | Log file directory |
| `stdout` | `true` | Mirror to stdout |

Override log level without restarting: `RUST_LOG=axiom=debug ./axiom server run`

---

## Supported Databases

| Engine | URL Scheme |
|--------|-----------|
| PostgreSQL | `postgres://` `postgresql://` |
| MySQL / MariaDB | `mysql://` `mariadb://` |
| SQL Server | `mssql://` `sqlserver://` |
| SQLite / Turso | `sqlite://` `libsql://` |
| ClickHouse | `clickhouse://` `clickhouse+https://` |

SQL Server URLs are internally translated to JDBC format (`jdbc:sqlserver://...`) required by the tiberius driver. Pass standard `mssql://host:1433;database=MyDb` — the engine handles the translation.

---

## CLI

```
Usage: axiom [OPTIONS] [COMMAND]

Commands:
  server    Start the gateway daemon
  user      Manage human admin accounts (direct DB access)
  key       Manage API keys (via Admin API)
  role      Manage RBAC roles (via Admin API)
  db        Manage database connections (via Admin API)
  cache     Inspect cache (via Admin API)
  audit     Query audit logs
  reload    Hot-reload metadata
  health    Check server health
  metrics   Dump Prometheus metrics
  benchmark Run HTTP pipeline benchmark
  doctor    Diagnose environment
  config    Init, convert, and validate config.toml

Options:
  -u, --url <URL>  Server base URL [default: http://127.0.0.1:4500]
  -k, --key <KEY>  Admin API key
      --json       JSON output
      --jsonl      JSONL output
```

```bash
axiom config init                        # create config.toml
axiom config to-env -i config.toml       # export to .env
axiom key create -n app -r readonly      # create API key
axiom db add -a mydb -u postgres://...   # register database
axiom db test-url postgres://...         # probe before registering
axiom benchmark -r 1000 -c 20           # HTTP pipeline benchmark
axiom user add ops_admin                 # create admin user (prompts for password)
```

---

## Security

Request pipeline order (WAF fires first, despite Axum's reverse layer application):

```
WAF → Rate Limiter + Ban List → Auth (BLAKE3 constant-time) → RBAC (ArcSwap snapshot) → AST Firewall → Circuit Breaker → DB Engine
```

**WAF** blocks: URI > 2048 chars, null bytes (`%00`), path traversal (3× URL-decoded), SQL keywords in URL path/query, > 50 query parameters, Content-Length > `body_limit`.

**Auth** uses BLAKE3-hashed secrets compared via XOR accumulator (no early exit). Key format: `base64(name:secret)`.

**RBAC** evaluates `roles` + `permissions` from the `ArcSwap<Metadata>` snapshot. Zero database calls on the hot path. Permission revocations take effect immediately — the result cache lookup runs *after* `PolicyEngine::evaluate`.

**AST Firewall** parses every SQL statement with sqlparser before execution. Blocked: DDL without `dangerous_operations: true`, multiple-statement injections, DENY-classified statements.

**Brute force**: 5 failed auth attempts from the same IP triggers an automatic ban.

Security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none';`, `X-Request-ID` (UUID per request).

---

## Project Structure

```
axiom/
  crates/
    core/       # AxiomError, ConfigManager, AuthContext, QueryResult, size_parser
    metadata/   # libsql metadata store (axiom.db), ArcSwap snapshot, audit log
    policy/     # PolicyEngine::evaluate — single RBAC checkpoint
    cache/      # Unified L1 (DashMap) + L2 (SQLite AOF) cache engine
    db/         # DatabasePoolManager, 5 SQL engine implementations
    api/        # Axum routes, all middleware, Web UI embedding, MCP handler
    cli/        # axiom CLI binary (clap)
    server/     # Entry point: Tokio runtime, socket tuning, server_runner
  ui/           # Web UI source (Vite + TypeScript + Tailwind)
  tests/        # Integration and security test suite (37 tests)
  benches/      # Criterion benchmark suite
  v4-planning/  # Architecture blueprints and ADRs
  config.example.toml
  Cargo.toml    # Workspace root
```

---

## Development

```bash
cargo build            # debug build
cargo run              # run with debug binary
cargo build --release  # optimized build (LTO, codegen-units=1, stripped)
cargo test --workspace # run all 153 tests
cargo clippy           # lint
```

Release profile: `opt-level=3`, `lto=true`, `codegen-units=1`, `panic=abort`, `strip=true`. Global allocator: `mimalloc` (secure feature — heap zeroed on free).

---

## Troubleshooting

**Binary refuses to start — "FATAL: Failed to load configuration"**
Config parse error. Run `axiom config show` to validate syntax. Check for missing quotes around string values or malformed TOML.

**`AUTH_INVALID` on every request**
Credentials must be base64-encoded as `name:secret` (not just the secret). Verify: `echo -n "keyname:secret" | base64`.

**`DB_NOT_FOUND` even though database is in config.toml**
On v4.0 first boot, legacy `[database.*]` blocks are seeded into `axiom.db` then ignored. Use `axiom db list` to confirm the database was imported. If not, run `axiom reload`.

**SQL Server connection fails**
URLs are translated internally from `mssql://host:1433;database=X` to JDBC format. Do not prefix with `jdbc:` yourself. Verify port 1433 is reachable: `axiom db test-url mssql://host:1433;database=X`.

**Rate limit triggered on localhost**
Add your IP to `allowed_ips` in `[server]`. Default exemption is empty.

**WAF blocks legitimate requests**
URI length limit is 2048 characters. Queries with long filter strings should be sent in the POST body, not as query parameters. SQL keywords in URL paths are blocked by design.

---

## Contributing

```bash
cargo test --workspace   # all tests must pass
cargo clippy             # no new warnings
```

Commit style: `type(scope): message` — e.g. `fix(cache): prevent cache bypass on permission revocation`. No emojis. No `--allow-dirty` merges. Run tests before opening a PR.

---

## License

MIT — Copyright 2026 Toxichome (toxichome.cc)

<div align="center">

# AXIOM

**A single-binary Rust gateway that exposes SQL databases over one unified REST API.**

Download the binary. Write one config file. Run. No daemons, no sidecars, no runtime dependencies.

<br/>

![Version](https://img.shields.io/badge/version-4.0.0-111827)
![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e?logo=rust&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-111827)
![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827)

<br/>

[Quick Start](#quick-start) &middot; [Authentication](#authentication) &middot; [Data API](#data-api) &middot; [Admin API](#admin-api) &middot; [Configuration](#configuration) &middot; [CLI](#cli) &middot; [Security](#security) &middot; [Troubleshooting](#troubleshooting)

</div>

---

## Why Axiom

| | |
|---|---|
| **Single binary** | One statically-linked executable with an embedded Web UI and a local SQLite metadata store. Build dependencies only — nothing else to install, ever. |
| **Any SQL engine** | PostgreSQL, MySQL/MariaDB, SQL Server, SQLite/Turso, ClickHouse — one API surface, one auth model, one response envelope. |
| **Defense in depth** | WAF, rate limiting, BLAKE3 auth, RBAC, and an AST-level SQL firewall sit in front of every single request. |
| **Idempotent by design** | Retry any mutation safely with `Idempotency-Key`. Responses are cached for 24 h — no more double-writes on flaky networks. |
| **Hot-reloadable metadata** | Keys, roles, and database connections change at runtime through the Admin API or Web UI. No restarts, no downtime. |
| **MCP-native** | A first-class Model Context Protocol endpoint lets LLM agents query your databases under the same RBAC policy as everyone else. |

## Quick Start

**Requirements:** Rust 1.88+ &middot; one reachable SQL database

```bash
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom
cp config.example.toml config.toml
```

Add your database URL and API key under `[metadata]`, or seed them from legacy blocks directly:

```toml
# Backward-compat: seeded into axiom.db on first boot, then managed live
[api_key.mykey]
secret = "my-secret"

[database.main_db]
url = "postgres://user:pass@localhost:5432/mydb"
```

Build and run:

```bash
cargo build --release
./target/release/axiom server run    # Linux/macOS
.\target\release\axiom.exe server run # Windows
```

Verify:

```bash
curl http://localhost:4500/ready
# {"ready":true}
```

First boot creates `data/axiom.db` automatically and walks you through the setup wizard. The Web UI lives at `http://localhost:4500/system/`.

## Authentication

Every data API request carries an API key in the `X-Axiom-Key` header, base64-encoded as `name:secret`:

```bash
KEY=$(echo -n "mykey:my-secret" | base64)   # bXlrZXk6bXktc2VjcmV0

curl -H "X-Axiom-Key: $KEY" http://localhost:4500/api/v1/db/databases
```

The Admin API (`/admin/v1`) and Web UI authenticate with session tokens from `POST /admin/v1/auth/login`. Five failed attempts from one IP trigger an automatic ban.

## Data API

All endpoints live under `/api/v1/db/:alias`. The API surface is stable at `/api/v1`.

### Raw SQL

Parameterized queries, optional timeout (1–300 s, default 30), array or positional-object params:

```bash
curl -X POST http://localhost:4500/api/v1/db/main_db/query \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT id, name FROM users WHERE active = ?", "params": [true]}'
```

Add `Idempotency-Key: <uuid>` to safely retry mutations — responses are cached for 24 h.

### CRUD rows

Cursor-paginated reads; filter operators `$eq $ne $gt $gte $lt $lte $in $nin $like $and $or $not`:

```bash
# Fetch (paginated)
curl "http://localhost:4500/api/v1/db/main_db/users/rows?limit=50&sort=id&order=desc&cursor=100" \
  -H "X-Axiom-Key: $KEY"

# Insert
curl -X POST http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"row": {"name": "Alice", "active": true}}'

# Update — a filter is mandatory
curl -X PATCH http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"filter": {"id": {"$eq": 5}}, "update": {"active": false}}'

# Delete — a filter is mandatory
curl -X DELETE http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"filter": {"id": {"$eq": 5}}}'
```

### Schema introspection

```bash
GET /api/v1/db/databases
GET /api/v1/db/:alias/tables
GET /api/v1/db/:alias/:table/schema
```

### Response envelope

Identical shape on every endpoint:

```json
{ "success": true, "data": { "rows": [], "columns": [] }, "error": null }
```

Errors carry a stable machine-readable code:

```json
{ "success": false, "data": null, "error": { "code": "AUTH_FORBIDDEN", "message": "..." } }
```

## Admin API

All endpoints under `/admin/v1`, behind an active admin session. Everything here hot-reloads into the running server.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/login` | Obtain a session token |
| `GET` | `/status` | Server info and uptime |
| `POST` | `/reload` | Hot-reload metadata snapshot |
| `GET` / `POST` | `/keys` | List / create API keys |
| `DELETE` | `/keys/:name` | Delete a key |
| `POST` | `/keys/:name/rotate` | Rotate a secret |
| `GET` / `POST` | `/roles` | List / create RBAC roles |
| `PATCH` / `DELETE` | `/roles/:name` | Update / delete a role |
| `GET` / `POST` | `/databases` | List / register databases |
| `DELETE` | `/databases/:alias` | Remove a database |
| `POST` | `/databases/test-url` | Probe a raw URL before registering |
| `GET` | `/audit` | Structured query audit log |
| `GET` / `POST` | `/cache/stats` · `/cache/flush` | Cache inspection and invalidation |
| `GET` | `/health` | Full infrastructure health (uptime, DB status) |

Setup wizard (first boot only): `GET/POST /admin/v1/setup/begin` → `/setup/account` → `/setup/database` → `/setup/complete`.

## MCP

`POST /mcp/v1` speaks JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`) and reuses the same API-key auth and RBAC as the REST API — agents get exactly the permissions you grant them, nothing more.

Tools: `axiom_list_services`, `axiom_list_tables`, `axiom_describe_table`, `axiom_query`, `axiom_insert`, `axiom_update`, `axiom_delete`, `axiom_raw_sql`.

## Configuration

Config loads once at startup from `config.toml`. API keys and databases are managed live via the Web UI / Admin API and stored in `data/axiom.db`.

<details>
<summary><b>[server]</b></summary>

| Key | Default | Notes |
|-----|---------|-------|
| `host` | `"127.0.0.1"` | Bind address |
| `port` | `4500` | HTTP port |
| `workers` | `0` | Tokio threads (0 = CPU count) |
| `max_connections` | `10000` | Max concurrent TCP connections |
| `body_limit` | `"10 MB"` | Max request body |
| `trusted_proxies` | `["127.0.0.1"]` | IPs allowed to set `X-Forwarded-For` |
| `cors_origins` | `["*"]` | Allowed CORS origins |
| `allowed_ips` | `[]` | IPs exempt from rate limiting |
| `shutdown_timeout` | `30` | Graceful shutdown wait (seconds) |

</details>
<details>
<summary><b>[metadata]</b></summary>

| Key | Default | Notes |
|-----|---------|-------|
| `url` | `"file:data/axiom.db"` | Local SQLite or remote Turso URL |
| `token` | `""` | Turso auth token |
| `reload_interval` | `30` | Seconds between hot-snapshot refreshes |

</details>
<details>
<summary><b>[rate_limit]</b></summary>

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | |
| `window` | `60` | Seconds |
| `max_requests` | `100` | Per IP per window |
| `burst` | `20` | Allowed burst |
| `penalty_threshold` | `10` | Violations before IP ban |
| `penalty_cooldown` | `300` | Ban duration (seconds) |

</details>
<details>
<summary><b>[cache]</b></summary>

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | |
| `backend` | `"memory"` | `memory`, `turso`, or `hybrid` |
| `query_results_ttl` | `5` | SQL result cache TTL (seconds) |
| `idempotency_ttl` | `86400` | Idempotency key retention (seconds) |

</details>
<details>
<summary><b>[circuit_breaker]</b></summary>

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | |
| `failure_threshold` | `5` | Failures before OPEN |

</details>
<details>
<summary><b>[logging]</b></summary>

| Key | Default | Notes |
|-----|---------|-------|
| `level` | `"INFO"` | `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `format` | `"json"` | `json` (prod) or `pretty` (dev) |
| `directory` | `"./logs"` | Log file directory |
| `stdout` | `true` | Mirror to stdout |

Override log level without restarting: `RUST_LOG=axiom=debug ./axiom server run`

</details>

## Supported Databases

| Engine | URL schemes |
|--------|-------------|
| PostgreSQL | `postgres://` · `postgresql://` |
| MySQL / MariaDB | `mysql://` · `mariadb://` |
| SQL Server | `mssql://` · `sqlserver://` |
| SQLite / Turso | `sqlite://` · `libsql://` |
| ClickHouse | `clickhouse://` · `clickhouse+https://` |

SQL Server URLs are translated internally to the JDBC format the `tiberius` driver requires. Pass `mssql://host:1433;database=MyDb` — never prefix `jdbc:` yourself.

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
axiom benchmark -r 1000 -c 20            # HTTP pipeline benchmark
axiom user add ops_admin                 # create admin user (prompts for password)
```

## Security

Every request passes through the same fixed pipeline — the WAF fires first, and authorization is re-evaluated against the live metadata snapshot *before* any cache lookup, so revoked permissions take effect immediately:

```
┌─────────────────────────────────────────────────────────────────────┐
│  WAF                                                                │
│   └─> Rate Limiter + Ban List                                       │
│        └─> Auth (BLAKE3, constant-time compare)                     │
│             └─> RBAC (ArcSwap snapshot, zero DB calls on hot path)  │
│                  └─> AST Firewall (sqlparser)                       │
│                       └─> Circuit Breaker                           │
│                            └─> Database Engine                      │
└─────────────────────────────────────────────────────────────────────┘
```

- **WAF** — blocks URIs over 2048 chars, null bytes (`%00`), path traversal (3× URL-decoded), SQL keywords in URL path/query, more than 50 query parameters, and bodies over `body_limit`.
- **Auth** — secrets are BLAKE3-hashed and compared via an XOR accumulator with no early exit. Five failed attempts from one IP → automatic ban.
- **RBAC** — `roles` + `permissions` are evaluated from an `ArcSwap<Metadata>` snapshot: zero database calls on the hot path, instant revocation.
- **AST Firewall** — every statement is parsed by `sqlparser` before execution. DDL is blocked unless `dangerous_operations: true`; multi-statement injections and DENY-classified statements never reach a database.
- **Headers** — every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, a locked-down `Content-Security-Policy`, and a per-request `X-Request-ID` UUID.

## Architecture

```
axiom/
├── crates/
│   ├── core/       # AxiomError, ConfigManager, AuthContext, QueryResult, size_parser
│   ├── metadata/   # libsql metadata store (axiom.db), ArcSwap snapshot, audit log
│   ├── policy/     # PolicyEngine::evaluate — the single RBAC checkpoint
│   ├── cache/      # Unified L1 (DashMap) + L2 (SQLite AOF) cache engine
│   ├── db/         # DatabasePoolManager, five SQL engine implementations
│   ├── api/        # Axum routes, all middleware, Web UI embedding, MCP handler
│   ├── cli/        # axiom CLI binary (clap)
│   └── server/     # Entry point: Tokio runtime, socket tuning, server_runner
├── ui/             # Web UI source (Vite + TypeScript + Tailwind)
├── tests/          # Integration and security test suite (37 tests)
├── benches/        # Criterion benchmark suite
├── config.example.toml
└── Cargo.toml      # Workspace root
```

## Development

```bash
cargo build              # debug build
cargo run                # run the debug binary
cargo build --release    # optimized: LTO, codegen-units=1, stripped
cargo test --workspace   # all 153 tests
cargo clippy             # lint
```

Release profile: `opt-level=3`, `lto=true`, `codegen-units=1`, `panic=abort`, `strip=true`. Global allocator: `mimalloc` (secure feature — heap zeroed on free).

## Troubleshooting

| Symptom / Error | Cause & Solution |
| :--- | :--- |
| **`FATAL: Failed to load configuration`** | **Cause:** Malformed TOML syntax.<br/>**Fix:** Run `axiom config show` to validate syntax. Look for missing quotes around strings. |
| **`AUTH_INVALID` on every request** | **Cause:** Sending plaintext secrets instead of the required format.<br/>**Fix:** Credentials must be base64-encoded as `name:secret`. Verify with: `echo -n "keyname:secret" \| base64`. |
| **`DB_NOT_FOUND` (despite config entry)** | **Cause:** Legacy `[database.*]` blocks are only seeded into `axiom.db` on first boot.<br/>**Fix:** Confirm import with `axiom db list`. If missing, force a reload with `axiom reload`. |
| **SQL Server connection fails** | **Cause:** Manually adding the `jdbc:` prefix.<br/>**Fix:** Pass `mssql://host:1433;database=X` directly. Verify reachability with `axiom db test-url`. |
| **Rate limit triggered on localhost** | **Cause:** Localhost is not exempt from rate limits by default.<br/>**Fix:** Add `"127.0.0.1"` to the `allowed_ips` array under `[server]` in your config. |
| **WAF blocks legitimate requests** | **Cause:** Tripping the 2048 char URI limit or URL SQL injection rules.<br/>**Fix:** Send long JSON filter strings in the HTTP `POST` body instead of as query params. |

## Contributing

```bash
cargo test --workspace   # all tests must pass
cargo clippy             # no new warnings
```

Conventional commits: `type(scope): message` — e.g. `fix(cache): prevent cache bypass on permission revocation`. No emojis, no `--allow-dirty` merges. Run tests before opening a PR.

## License

MIT — Copyright 2026 [Toxichome](https://toxichome.cc)


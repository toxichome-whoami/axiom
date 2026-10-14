<div align="center">

# AXIOM

**One binary. Any SQL engine. One secure REST API.**

PostgreSQL · MySQL · SQL Server · SQLite/Turso · ClickHouse — behind a WAF, BLAKE3 auth, RBAC, and an AST-level SQL firewall.

Download the binary · write one config file · run. No daemons, no sidecars, no runtime dependencies.

<br/>

![Version](https://img.shields.io/badge/version-4.0.0-111827)
![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e?logo=rust&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-111827)
![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827)

<br/>

[Quick start](#quick-start-5-minutes) &middot; [Authentication](#authentication) &middot; [Data API](#data-api) &middot; [Blobs](#blob-storage) &middot; [MCP](#mcp-for-ai-agents) &middot; [Configuration](#configuration) &middot; [Security](#security) &middot; [Docs](./docs/index.md)

</div>

---

> **New to Axiom?** Read this page top-to-bottom once — each layer reveals more detail (progressive disclosure).
> **In a hurry?** [Quick start](#quick-start-5-minutes) → [Authentication](#authentication) → [Raw SQL](#raw-sql) — 3 steps, under 5 minutes.
> **LLM agent?** Start at [`docs/llms.txt`](./docs/llms.txt) (or [`docs/index.md`](./docs/index.md)) for the machine-readable map.

## Contents

- [Why Axiom](#why-axiom)
- [Quick start](#quick-start-5-minutes)
- [How it works](#how-it-works)
- [Authentication](#authentication)
- [Data API](#data-api)
- [Blob storage](#blob-storage)
- [Admin API](#admin-api)
- [MCP for AI agents](#mcp-for-ai-agents)
- [Configuration](#configuration)
- [Supported databases](#supported-databases)
- [CLI](#cli)
- [Security](#security)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Why Axiom

| | |
|---|---|
| **Single binary** | One statically-linked executable with embedded Web UI + local SQLite metadata store. Build-time deps only — nothing to install at runtime. |
| **Any SQL engine** | PostgreSQL, MySQL/MariaDB, SQL Server, SQLite/Turso, ClickHouse — one API surface, one auth model, one response envelope. |
| **Defense in depth** | WAF → rate limiting → BLAKE3 auth → RBAC snapshot → AST SQL firewall → circuit breaker, on **every** request. See [Security](#security). |
| **Native blob storage** | Content-addressed object store with BLAKE3 dedup, chunked multipart uploads, range reads (256 MB cap), and time-bounded capability tickets (60 s – 24 h). |
| **Idempotent by design** | Retry mutations safely with `Idempotency-Key`. Responses cached 24 h — no double-writes on flaky networks. |
| **Hot-reloadable metadata** | Keys, roles, DB connections change at runtime via Admin API / Web UI. No restarts. |
| **MCP-native** | 15 Model Context Protocol tools under the same RBAC as REST — agents get exactly what you grant. |

---

## Quick start (5 minutes)

**Requirements:** Rust 1.88+ · one reachable SQL database.

<details open>
<summary><b>1 · Clone & configure</b></summary>

```bash
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom
cp config.example.toml config.toml
```

```toml
# Backward-compat: seeded into axiom.db on first boot, then managed live
[api_key.mykey]
secret = "my-secret"

[database.main_db]
url = "postgres://user:pass@localhost:5432/mydb"
```

</details>

<details open>
<summary><b>2 · Build & run</b></summary>

```bash
cargo build --release
./target/release/axiom server run    # Linux/macOS
.\target\release\axiom.exe server run # Windows
```

</details>

<details open>
<summary><b>3 · Verify</b></summary>

```bash
curl http://localhost:4500/ready
# {"ready":true}
```

First boot creates `data/axiom.db` and walks you through the setup wizard.
Web UI: `http://localhost:4500/system/`. Full guide: [`docs/index.md`](./docs/index.md).

</details>

> **Production warning:** bind `127.0.0.1` behind a TLS reverse proxy, pin `cors_origins` to your domains (default is same-origin only), and set a strong `blob.ticket_secret`. See [Deployment](./docs/operations/deployment.md).

---

## How it works

```mermaid
flowchart LR
    Client --> WAF
    WAF --> RateLimit["Rate limiter + ban list"]
    RateLimit --> Auth["Auth (BLAKE3)"]
    Auth --> RBAC["RBAC snapshot"]
    RBAC --> AST["AST firewall (sqlparser)"]
    AST --> CB["Circuit breaker"]
    CB --> DB[("Postgres / MySQL / MSSQL / SQLite / ClickHouse")]
    CB --> Blobs[("Blob store (LSM + BLAKE3)")]
```

Every request carries `X-Request-ID`, `X-RateLimit-*` headers, and returns the same [envelope](#response-envelope). Auth is re-evaluated against the live metadata snapshot **before** any cache lookup — revocations take effect immediately. Deep dive: [`docs/architecture/request-pipeline.md`](./docs/architecture/request-pipeline.md).

---

## Authentication

Authenticate data-plane requests with an API key, base64-encoded as `name:secret`:

```bash
KEY=$(echo -n "mykey:my-secret" | base64)   # bXlrZXk6bXktc2VjcmV0

curl -H "X-Axiom-Key: $KEY" http://localhost:4500/api/v1/db/databases
```

| Header | Format | Notes |
|---|---|---|
| `X-Axiom-Key` | `base64(name:secret)` | Primary. Also accepted as `X-Api-Key`. |
| `Authorization: Bearer` | `base64(name:secret)` **or** 32-char session token | API keys and admin sessions share the header; sessions are 32-char tokens from `POST /admin/v1/auth/login`. |
| Blob ticket | `?ticket_sig=&ticket_exp=` | Time-bounded `READ`/`WRITE` capability, 60 s – 24 h. `DELETE` is never ticket-scoped. |

> The Admin API (`/admin/v1`) and Web UI use session tokens. **Five failed attempts from one IP → automatic ban.**

---

## Data API

All endpoints live under `/api/v1/db/:alias`. Stable surface: `/api/v1`. Full reference: [`docs/reference/api.md`](./docs/reference/api.md).

### Raw SQL

Parameterized queries, optional timeout (1–300 s, default 30). Array or positional-object params. **Single statement per request** — stacked statements (`; …`) return `400 MULTI_STATEMENT_DENIED`.

```bash
curl -X POST http://localhost:4500/api/v1/db/main_db/query \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT id, name FROM users WHERE active = ?", "params": [true]}'
```

Add `Idempotency-Key: <uuid>` to retry mutations safely — responses cached 24 h.

### CRUD rows

Cursor-paginated reads. Filter operators: `$eq $ne $gt $gte $lt $lte $in $nin $like $and $or $not`. `filter` is **mandatory** for update/delete (no full-table wipes).

```bash
# Fetch (paginated)
curl "http://localhost:4500/api/v1/db/main_db/users/rows?limit=50&sort=id&order=desc&cursor=100" \
  -H "X-Axiom-Key: $KEY"

# Insert (single or batch)
curl -X POST http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"row": {"name": "Alice", "active": true}}'

# Update — filter mandatory
curl -X PATCH http://localhost:4500/api/v1/db/main_db/users/rows \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"filter": {"id": {"$eq": 5}}, "update": {"active": false}}'

# Delete — filter mandatory
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

Adding a column validates `data_type` against a strict allowlist and rejects `; -- /*` in defaults/checks. Details: [`docs/reference/api.md`](./docs/reference/api.md).

### Response envelope

Identical shape on every endpoint (plus `X-Request-ID`, `X-RateLimit-*` headers):

```json
{ "success": true, "data": { "rows": [], "columns": [] }, "error": null }
```

```json
{ "success": false, "data": null, "error": { "code": "AUTH_FORBIDDEN", "message": "..." } }
```

Common codes: `WAF_*` · `RATE_LIMIT_EXCEEDED` · `BANNED` · `AUTH_*` · `MULTI_STATEMENT_DENIED` · `DB_*`. Full table: [`docs/operations/troubleshooting.md`](./docs/operations/troubleshooting.md).

---

## Blob storage

Content-addressed object store under `/api/v1/blobs/:namespace`. Guide: [`docs/reference/blob-storage.md`](./docs/reference/blob-storage.md).

```bash
# Upload
curl -X PUT "http://localhost:4500/api/v1/blobs/media/avatars/user_1.png" \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: image/png" \
  --data-binary "@avatar.png"

# Download (Range capped at 256 MB per request; malformed ranges → 416)
curl "http://localhost:4500/api/v1/blobs/media/avatars/user_1.png" \
  -H "X-Axiom-Key: $KEY" -o downloaded.png

# List with prefix + pagination
curl "http://localhost:4500/api/v1/blobs/media?prefix=avatars/&limit=50" \
  -H "X-Axiom-Key: $KEY"

# Capability ticket (READ or WRITE, 60–86400 s; recipient needs no API key)
curl -X POST "http://localhost:4500/api/v1/blobs/media/ticket" \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"key": "avatars/user_1.png", "operation": "READ", "ttl_seconds": 3600}'

# Chunked uploads for large files
POST   /api/v1/blobs/:namespace/uploads                 # initialize
PUT    /api/v1/blobs/:namespace/uploads/:id/parts/:num  # upload part
POST   /api/v1/blobs/:namespace/uploads/:id/complete    # complete
DELETE /api/v1/blobs/:namespace/uploads/:id             # abort
```

---

## Admin API

All endpoints under `/admin/v1`, behind an active admin session. Everything hot-reloads.

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
| `GET` / `POST` | `/blobs/namespaces` | List / manage blob namespaces |
| `GET` / `POST` | `/blobs/stats` · `/blobs/scrub` | Blob telemetry & integrity scrub |
| `POST` | `/blobs/copy` · `/blobs/move` | Server-side copy or move |
| `POST` | `/blobs/delete-prefix` | Bulk delete under a prefix |

Setup wizard (first boot only): `GET/POST /admin/v1/setup/begin` → `/setup/account` → `/setup/database` → `/setup/complete`.

---

## MCP for AI agents

`POST /mcp/v1` speaks JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`) with the **same API-key auth and RBAC as REST** — agents get exactly the permissions you grant, nothing more.

**15 built-in tools** (with or without `axiom_` prefix):

| Group | Tools |
|---|---|
| Database (8) | `axiom_list_services` · `axiom_list_tables` · `axiom_describe_table` · `axiom_query` · `axiom_insert` · `axiom_update` · `axiom_delete` · `axiom_raw_sql` |
| Blobs (7) | `axiom_list_blob_namespaces` · `axiom_list_blobs` · `axiom_get_blob_metadata` · `axiom_read_blob` · `axiom_write_blob` · `axiom_delete_blob` · `axiom_create_download_ticket` |

Full tool I/O + RBAC mapping: [`docs/reference/mcp.md`](./docs/reference/mcp.md).

---

## Configuration

Config loads once at startup from `config.toml` (restart to apply). Keys/databases live in `data/axiom.db` and hot-reload. Full reference: [`docs/reference/configuration.md`](./docs/reference/configuration.md).

<details>
<summary><b>[server] — safe defaults</b></summary>

| Key | Default | Notes |
|-----|---------|-------|
| `host` | `"127.0.0.1"` | Bind address (use a reverse proxy for public traffic) |
| `port` | `4500` | HTTP port |
| `workers` | `0` | Tokio threads (0 = CPU count) |
| `max_connections` | `10000` | Max concurrent TCP connections |
| `body_limit` | `"10 MB"` | Max non-blob request body |
| `trusted_proxies` | `["127.0.0.1"]` | Only these peers may set `X-Forwarded-For` (`"*"` logs a warning) |
| `cors_origins` | `[]` | Same-origin only by default — pin your domains in prod |
| `allowed_ips` | `[]` | Exact IPs exempt from rate limiting (`host:port` entries are rejected) |
| `shutdown_timeout` | `30` | Graceful shutdown wait (s) |

</details>

<details>
<summary><b>[metadata] · [rate_limit] · [cache] · [circuit_breaker] · [logging] · [blob]</b></summary>

| Section | Key defaults |
|---|---|
| `[metadata]` | `url = "file:data/axiom.db"`, `reload_interval = 30` |
| `[rate_limit]` | `enabled`, `window = 60`, `max_requests = 100`, `burst = 20`, `penalty_threshold = 10`, `penalty_cooldown = 300` |
| `[cache]` | `backend = "memory"`, `query_results_ttl = 5`, `idempotency_ttl = 86400` |
| `[circuit_breaker]` | `enabled`, `failure_threshold = 5` |
| `[logging]` | `level = "INFO"`, `format = "json"`, `directory = "./logs"` — override via `RUST_LOG=axiom=debug` |
| `[blob]` | `enabled`, `path = "data/blobs"`, `inline_max = "64kb"`, `max_object = "5gb"`, `verify_reads = false`, `ticket_secret = ""` (empty → ephemeral per-boot secret + warning; set a strong value in prod) |

</details>

---

## Supported databases

| Engine | URL schemes |
|--------|-------------|
| PostgreSQL | `postgres://` · `postgresql://` |
| MySQL / MariaDB | `mysql://` · `mariadb://` |
| SQL Server | `mssql://` · `sqlserver://` |
| SQLite / Turso | `sqlite://` · `libsql://` |
| ClickHouse | `clickhouse://` · `clickhouse+https://` |

> SQL Server URLs are translated internally to the JDBC format `tiberius` requires. Pass `mssql://host:1433;database=MyDb` — never prefix `jdbc:` yourself.

---

## CLI

```
Usage: axiom [OPTIONS] [COMMAND]

Commands:
  server    Start the gateway daemon
  login     Log in to an admin account and save session token
  logout    Log out and clear saved session token
  setup     Run the first-time setup wizard (interactive or step-by-step)
  user      Manage human admin accounts (direct DB access)
  key       Manage API keys (via Admin API)
  role      Manage RBAC roles (via Admin API)
  db        Manage databases, execute SQL, inspect schemas, and query/mutate data
  blob      Manage blob storage namespaces, objects, transfers, and tickets
  cache     Inspect and flush cache (via Admin API)
  audit     Query audit logs
  reload    Hot-reload metadata
  health    Check server health
  metrics   Dump Prometheus metrics
  benchmark Run HTTP pipeline benchmark
  doctor    Diagnose environment
  config    Init, convert, and validate config.toml
```

```bash
axiom login -u admin                           # authenticate & store session token
axiom setup                                    # interactive first-time setup wizard
axiom config init                              # create config.toml
axiom config to-env -i config.toml             # export to .env
axiom key create -n app -r readonly            # create API key
axiom db add -a mydb -u postgres://...         # register database
axiom db query mydb "SELECT * FROM users"      # execute SQL query
axiom db rows mydb users --limit 20            # query and filter rows
axiom blob ns create media --quota 10gb        # create blob namespace
axiom blob put media avatar.png -f ./pic.png   # upload blob object
axiom blob get media avatar.png -o ./out.png   # download blob object
axiom blob ticket media avatar.png             # presigned capability ticket
axiom benchmark -r 1000 -c 20                  # HTTP pipeline benchmark
axiom user add ops_admin                       # create admin user (prompts for password)
```

---

## Security

Every request passes the same fixed pipeline — WAF first, auth re-evaluated against the live snapshot **before** cache, so revocations bite immediately:

```mermaid
flowchart TD
    WAF["WAF"] --> RL["Rate limiter + ban list"]
    RL --> Auth["Auth (BLAKE3, constant-time)"]
    Auth --> RBAC["RBAC (ArcSwap snapshot)"]
    RBAC --> AST["AST firewall (sqlparser)"]
    AST --> CB["Circuit breaker"]
    CB --> Engines["DB engines / blob store"]
```

- **WAF** — 2048-char URI cap · null bytes (`%00`, case-insensitive, `5×` decode) · `..` traversal · expanded SQL-keyword set in URL (defense-in-depth; real SQL is AST-checked) · 50-param cap · `Content-Length` fail-fast (chunked bodies fall through to the 10 MB axum cap on non-blob routes).
- **Auth** — BLAKE3-hashed secrets, XOR-accumulator compare, 5 failures → ban. Blob tickets are BLAKE3-MAC capabilities (`READ`/`WRITE` only, 60 s–24 h, `DELETE` never ticket-scoped).
- **RBAC** — `PolicyEngine::evaluate` / `evaluate_blob` from an `ArcSwap` snapshot: zero hot-path DB calls, instant revocation.
- **AST firewall** — `sqlparser` per dialect. DDL blocked unless `dangerous_operations: true`; **single statement per request**; `DENY` never reaches a DB. Postgres `?|`/`?&` and `$$…$$` preserved.
- **Headers** — `nosniff` · `DENY` · HSTS · strict CSP · `Referrer-Policy: no-referrer` · `Permissions-Policy` · `X-Request-ID`.
- **Errors** — generic messages to clients in release builds (full detail in server logs only).

Hardening checklist: [`docs/reference/security.md`](./docs/reference/security.md) · [`docs/operations/deployment.md`](./docs/operations/deployment.md).

---

## Architecture

```
axiom/
├── crates/
│   ├── core/       # AxiomError, ConfigManager, AuthContext, QueryResult, size_parser
│   ├── metadata/   # libsql metadata store (axiom.db), ArcSwap snapshot, audit log
│   ├── policy/     # PolicyEngine::evaluate — the single RBAC checkpoint
│   ├── cache/      # Unified L1 (DashMap) + L2 (SQLite AOF) cache engine
│   ├── db/         # DatabasePoolManager, five SQL engine implementations
│   ├── blob/       # Content-addressed blob engine (LSM index, chunked uploads)
│   ├── api/        # Axum routes, middleware, Web UI embedding, MCP handler
│   ├── cli/        # axiom CLI (clap)
│   └── server/     # Entry point: Tokio runtime, socket tuning, server_runner
├── ui/             # Web UI (Vite + TypeScript + Tailwind)
├── docs/           # indices, references, architecture, operations
├── tests/          # Integration + security suite
├── benches/        # Criterion benchmarks
├── config.example.toml
└── Cargo.toml      # Workspace root
```

Request lifecycle with sequence diagram: [`docs/architecture/request-pipeline.md`](./docs/architecture/request-pipeline.md).

---

## Development

```bash
cargo build              # debug build
cargo run                # run the debug binary
cargo build --release    # optimized: LTO, codegen-units=1, stripped
cargo test --workspace   # full suite across all crates
cargo clippy             # lint (keep clean)
```

Release profile: `opt-level=3`, `lto=true`, `codegen-units=1`, `panic=abort`, `strip=true`. Allocator: `mimalloc` (secure — heap zeroed on free).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `FATAL: Failed to load configuration` | `axiom config show` — check TOML quotes. |
| `AUTH_INVALID` everywhere | Send `base64(name:secret)`, not plaintext: `echo -n "key:secret" \| base64`. |
| `DB_NOT_FOUND` despite config | Legacy blocks seed only on first boot — `axiom db list`, then `axiom reload`. |
| MSSQL connect fails | Use `mssql://host:1433;database=X` (no `jdbc:` prefix); `axiom db test-url`. |
| Rate-limited on localhost | Add `"127.0.0.1"` to `[server] allowed_ips`. |
| WAF blocks legit requests | Move long filters into POST bodies; check 2048-char URI cap. |
| `MULTI_STATEMENT_DENIED` | Split `;`-joined SQL into separate requests. |
| `416` on blob Range | Single range ≤ 256 MB, `bytes=start-end`, no commas. |

Full error-code table: [`docs/operations/troubleshooting.md`](./docs/operations/troubleshooting.md).

---

## Contributing

```bash
cargo test --workspace   # all tests must pass
cargo clippy             # no new warnings
```

Conventional commits: `type(scope): message` — e.g. `fix(cache): prevent cache bypass on permission revocation`. No emojis, no `--allow-dirty` merges. Run tests before opening a PR.

## License

MIT — Copyright 2026 [Toxichome](https://toxichome.cc)

---

<div align="center">

**Continue:** [Docs hub](./docs/index.md) · [API](./docs/reference/api.md) · [MCP](./docs/reference/mcp.md) · [Blobs](./docs/reference/blob-storage.md) · [Security](./docs/reference/security.md) · [Deployment](./docs/operations/deployment.md)

</div>

<div align="center">

# AXIOM

**Ship a secure data API in minutes, not sprints.**

One binary that turns any SQL database into a production-ready REST API — with auth, rate limiting, and guardrails built in.

![Version](https://img.shields.io/badge/version-4.0.0-111827)
![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e?logo=rust&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-111827)
![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827)

</div>

<div align="center">

![Axiom Gateway dashboard — pool health, cache metrics, and database overview](./docs/images/dashboard.png)

</div>

## Why Axiom

Backend teams spend weeks building database access layers that are secure by default. Axiom delivers the complete layer in a single executable:

- **Deploy in seconds** — download one binary, configure connection strings, and run. No separate runtimes, sidecars, or orchestrators.
- **Unified database interface** — PostgreSQL, MySQL, SQL Server, SQLite/Turso, and ClickHouse exposed through one authentication model and JSON response format.
- **Deterministic security** — WAF, per-IP and per-key rate limiting, constant-time credential hashing, RBAC, and an AST-based SQL injection firewall on every request.
- **AI-native integration** — native Model Context Protocol (MCP) endpoint allows LLM agents (Claude Code, Cursor, LangChain) to query data under the same policy controls as web applications.
- **Content-addressed storage** — integrated BLAKE3 blob store with two-tier persistence, range queries, and pre-signed capability tickets.

---

## Everything Included

| Capability | Detail |
|---|---|
| Data API | Parameterized SQL, filterable rows, cursor pagination, schema introspection |
| File storage | Content-addressed blobs, presigned URLs, byte-range streaming, multipart uploads |
| Access control | BLAKE3 hashed API keys, custom roles, per-table and per-namespace permissions |
| Reliability | Idempotency keys, multi-tier cache, circuit breakers, hot-reloadable metadata |
| Observability | Structured JSON logging, audit trail, Prometheus metrics, per-request UUIDs |
| Interfaces | Admin CLI, embedded Web UI (`/system`), Model Context Protocol (`/mcp/v1`) |

---

## Quick Start

### 1. Download or Build

```bash
# Clone and build optimized release binary
git clone https://github.com/toxichome/axiom.git
cd axiom
cargo build --release

# Binary is placed in target/release/axiom
./target/release/axiom --help
```

### 2. Configure

Axiom runs out of the box with compiled defaults. Create `config.toml` only if you need to customize server, cache, or storage bindings:

```toml
[server]
host = "0.0.0.0"
port = 4500
workers = 4

[metadata]
url = "file:data/axiom.db"

[blob]
enabled = true
path = "data/blobs"
ticket_secret = "replace-with-a-random-secret-for-signing-tickets"
```

> **Note:** Databases, API keys, and roles are dynamic resources stored in `data/axiom.db`. They are managed exclusively through the embedded Web UI or the Axiom CLI, not static configuration files.

### 3. Run and Access Dashboard

```bash
# Start server
./target/release/axiom server run
```

Axiom starts on `http://localhost:4500`:
- **Web UI & Setup Wizard**: Navigate to `http://localhost:4500/system` to complete first-time admin setup and register databases.
- **CLI Management**:
  ```bash
  # Add database connection
  ./target/release/axiom db add --alias primary --url "postgres://postgres:postgres@localhost:5432/app_db"

  # Create API key
  ./target/release/axiom key create --name admin --role admin
  ```
- **Health probe**: `GET http://localhost:4500/health`
- **MCP endpoint**: `POST http://localhost:4500/mcp/v1`

---

## Usage Examples

All requests require authentication via the `X-Axiom-Key` header, formatted as `base64(name:secret)`.

```bash
KEY=$(echo -n "admin:secret-token" | base64)
```

### 1. Parameterized SQL Queries

Execute arbitrary SQL statements safely. Queries run through an AST firewall that enforces single-statement execution and validates syntax before sending to the driver.

```bash
curl -X POST "http://localhost:4500/api/v1/db/primary/query" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT id, name, email, balance FROM users WHERE balance >= $1 AND status = $2 ORDER BY balance DESC LIMIT 10",
    "params": [500.00, "active"]
  }'
```

Response envelope:

```json
{
  "success": true,
  "data": {
    "rows": [
      { "id": 104, "name": "Alice Smith", "email": "alice@example.com", "balance": 1420.50 },
      { "id": 88, "name": "Bob Vance", "email": "bob@example.com", "balance": 850.00 }
    ],
    "rows_affected": 0,
    "columns": ["id", "name", "email", "balance"]
  },
  "error": null,
  "meta": {
    "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a",
    "duration_ms": 1.42,
    "cached": false
  }
}
```

### 2. Auto-Generated REST CRUD

Axiom exposes database tables directly with query operators, sorting, and keyset cursor pagination without writing SQL.

#### Fetch Filtered Rows

Filter syntax supports `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, and `is_null`.

```bash
curl "http://localhost:4500/api/v1/db/primary/orders/rows?filter=%7B%22status%22:%7B%22eq%22:%22paid%22%7D,%22total%22:%7B%22gte%22:100%7D%7D&sort=created_at&order=desc&limit=25" \
  -H "X-Axiom-Key: $KEY"
```

#### Safe Mutation with Idempotency Key

Retry safely across network failures using the `Idempotency-Key` header:

```bash
curl -X POST "http://localhost:4500/api/v1/db/primary/orders/rows" \
  -H "X-Axiom-Key: $KEY" \
  -H "Idempotency-Key: ord_checkout_991823" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      { "customer_id": 42, "item": "Compute Cluster", "amount": 2400.00 }
    ]
  }'
```

#### Scoped Updates and Deletions

Mutations require an explicit filter object. Unbounded mass-updates are rejected at the gateway layer:

```bash
curl -X PATCH "http://localhost:4500/api/v1/db/primary/users/rows" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": { "tier": "gold" },
    "filter": { "loyalty_points": { "gte": 10000 } }
  }'
```

---

### 3. Content-Addressed Blob Storage

Axiom includes a built-in content-addressed object store backed by BLAKE3 hashes and a two-tier storage engine (Fjall LSM for metadata and objects `<64 KB`, direct disk shards for large payloads).

#### Store an Object

```bash
curl -X PUT "http://localhost:4500/api/v1/blobs/assets/documents/specs.pdf" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/pdf" \
  --data-binary "@specs.pdf"
```

Response:

```json
{
  "success": true,
  "data": {
    "key": "documents/specs.pdf",
    "hash": "b268f7b53e8006b006859d57a2b0d01d4a0475b7a13c9e99335f2ae3e26b8404",
    "size": 1420582,
    "content_type": "application/pdf"
  },
  "error": null
}
```

#### Stream Byte Ranges (HTTP 206)

Clients can request arbitrary single slices up to 256 MB for video playback or parallel chunk downloading:

```bash
curl -i "http://localhost:4500/api/v1/blobs/assets/documents/specs.pdf" \
  -H "X-Axiom-Key: $KEY" \
  -H "Range: bytes=0-1048575"
```

Headers returned:
```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1048575/1420582
Content-Length: 1048576
Content-Type: application/pdf
ETag: "b268f7b53e8006b006859d57a2b0d01d4a0475b7a13c9e99335f2ae3e26b8404"
```

---

### 4. Revocable Capability Tickets

Generate cryptographically signed URLs for client-side uploads and downloads without exposing master API keys.

#### Issue a Ticket

```bash
curl -X POST "http://localhost:4500/api/v1/blobs/assets/ticket" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "documents/specs.pdf",
    "operation": "READ",
    "ttl_seconds": 3600
  }'
```

Response returns a signed capability token:

```json
{
  "success": true,
  "data": {
    "ticket": "v1.assets.documents_specs_pdf.READ.1760492800.7f1a3b8c...",
    "url": "http://localhost:4500/api/v1/blobs/assets/documents/specs.pdf?ticket=v1.assets..."
  },
  "error": null
}
```

The consumer uses the raw URL without authentication headers:

```bash
curl -O "http://localhost:4500/api/v1/blobs/assets/documents/specs.pdf?ticket=v1.assets..."
```

---

### 5. Model Context Protocol (MCP) for AI Agents

Axiom implements the JSON-RPC 2.0 Model Context Protocol at `POST /mcp/v1`. External AI coding assistants and automation pipelines can inspect schemas and query databases with standard tooling.

#### Add to Claude Code or Cursor Configuration

```json
{
  "mcpServers": {
    "axiom": {
      "url": "http://localhost:4500/mcp/v1",
      "headers": {
        "X-Axiom-Key": "YWRtaW46c2VjcmV0LXRva2Vu"
      }
    }
  }
}
```

#### Protocol Invocation

```bash
curl -X POST "http://localhost:4500/mcp/v1" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "db_query",
      "arguments": {
        "database": "primary",
        "sql": "SELECT COUNT(*) AS total_users FROM users WHERE status = $1",
        "params": ["active"]
      }
    }
  }'
```

Every MCP call enforces the exact same RBAC rules, audit logging, and circuit breakers as normal REST API traffic.

---

### 6. Administration CLI

The `axiom` command-line utility manages keys, databases, cache state, and performance tests:

```bash
# Verify database connection
axiom db test primary

# Generate a new scoped API key
axiom key create --name "service-worker" --role "worker-role"

# Run database migration check
axiom db schema primary users

# Benchmark local latency and throughput
axiom benchmark --target "http://localhost:4500" --concurrency 50 --requests 10000
```

---

## Architecture & Request Pipeline

Every incoming request passes through a deterministic security and routing pipeline before touching the database drivers:

```mermaid
flowchart TD
    A["Inbound HTTP Request"] --> B["WAF Middleware\nMax URI 2048 bytes · 3x URL decode · 10 MB payload limit"]
    B --> C["Rate Limiter\nPer-IP counter · Per-key counter · Ban list"]
    C --> D["Auth Middleware\nConstant-time key check · ArcSwap metadata snapshot"]
    D --> E["Policy Engine\nRBAC validation (database · table · operation)"]
    E --> F["Route Matcher\nData API · Blob API · MCP · Admin"]
    F --> G["Execution Pipeline\nAST firewall · Query blacklist · Circuit breaker · Cache check"]
    G --> H["Connection Pool Manager\nLazy initialization · Per-alias mutex · Deadlock prevention"]
    H --> I["Database / Storage Engine\nPostgreSQL · MySQL · MSSQL · SQLite · ClickHouse · Fjall LSM"]
    I --> J["Response Pipeline\nUUID tracking · Security headers · NaN-safe JSON serialization"]
```

---

## Supported Databases

| Engine | Driver | Dialects | Max Connections | Keyset Pagination | AST Firewall |
|---|---|---|---|---|---|
| PostgreSQL | `sqlx` (native) | PostgreSQL 12–16 | Per-pool configurable | Supported | Supported |
| MySQL | `sqlx` (native) | MySQL 8+, MariaDB 10+ | Per-pool configurable | Supported | Supported |
| SQL Server | `tiberius` (pure Rust) | MSSQL 2017–2022 | Per-pool configurable | Supported | Supported |
| SQLite / Turso | `libsql` | SQLite 3, Turso | Per-pool configurable | Supported | Supported |
| ClickHouse | HTTP Interface | ClickHouse SQL | Connection pooling | Supported | Supported |

---

## Performance Targets

Engineering metrics measured on standard commodity servers (AMD Ryzen 5 3600, Linux, release build):

| Metric | Target | Verification Method |
|---|---|---|
| Cache GET (L1 hot path) | < 1 µs p50 | `benches/bench_cache.go` (1,000,000 iterations) |
| Auth resolution (warm snapshot) | < 5 µs | `benches/bench_auth.go` |
| End-to-end pipeline (cache hit) | < 500 µs p50 | `benches/bench_http.go` |
| End-to-end local DB query | < 2 ms p50 | `benches/bench_db.go` (PostgreSQL localhost) |
| Stripped binary size | < 15 MB | `cargo build --release && strip target/release/axiom` |
| Cold boot to TCP listener | < 200 ms | Process execution timing |
| Idle memory footprint (minimal) | < 10 MB RSS | `ps -o rss` after 60 seconds idle |
| Idle memory footprint (standard) | < 30 MB RSS | `ps -o rss` with connection pools warm |

---

## Documentation

| Document | Description |
|---|---|
| [API Reference](./docs/api.md) | SQL queries, table CRUD, blob storage, capability tickets, and MCP tools |
| [Configuration & Deployment](./docs/configuration.md) | Configuration settings, security model, reverse proxy setups, and backups |

---

## License

MIT — Copyright 2026 [Toxichome](https://toxichome.cc)

<div align="center">

# Axiom

### High-performance REST API, Content-Addressed Blob Storage, and MCP Server for SQL Databases.
One Rust binary. Zero external daemons. Under 10 MB idle RAM.

[![Version](https://img.shields.io/badge/version-0.1.11%2B-111827.svg?style=flat-square)](https://github.com/toxichome/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827.svg?style=flat-square)](https://github.com/toxichome/axiom/releases)
[![Binary Size](https://img.shields.io/badge/binary-%3C15MB-111827.svg?style=flat-square)](https://github.com/toxichome/axiom)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-111827.svg?style=flat-square)](https://modelcontextprotocol.io)
</div>

---

<p align="center">
  <img src="docs/images/dashboard.png" alt="Axiom Gateway Admin Web UI and Observability Dashboard" width="900">
  <br>
  <em>Embedded Admin Web UI: real-time pool telemetry, L1 cache hit ratio, database introspection, and API key management.</em>
</p>

## What is Axiom?

Axiom is a single-binary database gateway and object store written in Rust. It connects to your existing SQL databases and local storage volumes, introspects schemas, and instantly exposes:

1. **A production-ready CRUD REST API** with keyset cursor pagination, structured query operators, bounded-memory NDJSON/JSON streaming, and an AST-based SQL injection firewall.
2. **A content-addressed blob storage engine** backed by BLAKE3 deduplication, a two-tier LSM storage architecture (Fjall + direct disk shards), resumable chunked multipart uploads, byte-range streaming, and pre-signed capability tickets.
3. **A Model Context Protocol (MCP) server** at `/mcp/v1` that gives AI agents (Claude Code, Cursor, Windsurf, VS Code Copilot) governed, audited, read/write access to your databases and blobs.
4. **A zero-database P2P Cluster Mesh** enabling secure node-to-node pairing, cryptographic HMAC-SHA256 mutual request verification, live latency telemetry, and instant cluster-wide propagation of security bans.
5. **An embedded administrative Web UI** at `/system` with a first-boot setup wizard, connection test diagnostics, role builders with Row-Level Security (RLS) filters, API key management, cluster mesh visualization, live audit logs, and Prometheus metrics.

All configuration and dynamic metadata (databases, users, roles, permissions, API keys) live in an embedded `axiom.db` file powered by LibSQL. The hot data path reads immutable snapshots via `ArcSwap`, adding zero database locks to incoming requests.

## How It Works

```mermaid
flowchart TD
    subgraph Clients["Clients and AI Agents"]
        C1["Web & Mobile Apps (X-Axiom-Key Header)"]
        C2["Edge & Direct Clients (Pre-signed Capability Tickets)"]
        C3["AI Agents: Claude, Cursor, Windsurf (MCP at /mcp/v1)"]
        C4["Operators & Admins (Web UI at /system & CLI)"]
        C5["Clustered Axiom Peer Nodes (HMAC-SHA256 Mutual Auth)"]
    end

    subgraph Axiom["Axiom Gateway (Single Binary, <10 MB RAM)"]
        WAF["WAF: 2048-byte Guard, 3x URL Decode, Null-byte Filter"]
        RL["Dual Rate Limiter: Per-IP & Per-Key Counters, Auto-Ban"]
        AUTH["Auth & RBAC: BLAKE3 Constant-Time, ArcSwap Zero-Lock Snapshot, RLS Filter Pushdown"]

        subgraph Core["Execution Engines"]
            SQL["SQL AST Engine (Single-Statement Guard, Keyset Pagination, Streaming NDJSON/JSON, Circuit Breaker)"]
            BLOB["Native Blob Engine (BLAKE3 Dedup, Two-Tier LSM Storage, Resumable Uploads, Range Streaming)"]
            CLUSTER["Cluster Mesh (P2P Handshake, Gossip, Live Latency, Instant Ban Broadcast)"]
            MCP["MCP Server (Governed Tool-Based Database & Blob Access)"]
            ADMIN["Admin Engine (Embedded Web UI, CLI, LibSQL Metadata Store)"]
        end

        WAF --> RL --> AUTH
        AUTH --> SQL
        AUTH --> BLOB
        AUTH --> CLUSTER
        AUTH --> MCP
        AUTH --> ADMIN
    end

    subgraph Upstream["Databases, Storage & Peer Nodes"]
        DB1["PostgreSQL (12 - 17)"]
        DB2["MySQL / MariaDB (8.0+ / 10.4+)"]
        DB3["Microsoft SQL Server (2017 - 2022)"]
        DB4["SQLite / LibSQL (Local & Turso Remote)"]
        DB5["ClickHouse (Analytical HTTP Engine)"]
        DISK["Local NVMe / Disk Shards (Object Blobs)"]
        PEERS["Remote Clustered Axiom Nodes (/internal/v1/cluster/*)"]
    end

    C1 --> WAF
    C2 --> WAF
    C3 --> WAF
    C4 --> WAF
    C5 --> WAF

    SQL --> DB1
    SQL --> DB2
    SQL --> DB3
    SQL --> DB4
    SQL --> DB5
    BLOB --> DISK
    CLUSTER --> PEERS
```

**Connect** any SQL database and local storage volume &rarr; Axiom **introspects** the schema and mounts the engines &rarr; Exposes **REST CRUD endpoints**, **content-addressed blob storage**, **MCP tools for AI agents**, and an **embedded Admin Web UI** &mdash; secured with constant-time authentication, dual-tier rate limiting, and zero-lock RBAC.



## 60-Second Quickstart

### 1. Installation

#### Pre-built Binary
Download the single binary for Linux, macOS, or Windows from [GitHub Releases](https://github.com/toxichome/axiom/releases):
```bash
# Example for Linux x86_64
curl -sSL https://github.com/toxichome/axiom/releases/latest/download/axiom-linux-amd64 -o axiom
chmod +x axiom
./axiom --version
```

#### From Source (Cargo)
```bash
git clone https://github.com/toxichome/axiom.git
cd axiom
cargo build --release
# Executable is placed in ./target/release/axiom
```

#### Docker
```bash
docker run -d \
  -p 4500:4500 \
  -v axiom-data:/app/data \
  --name axiom \
  toxichome/axiom:latest
```



### 2. Start Axiom

Run the server daemon with compiled-in defaults:

```bash
axiom server run
```

Axiom starts immediately on `http://localhost:4500` with an empty state and under 10 MB RAM footprint.



### 3. Setup Flow: Two Paths

#### Path A: Interactive Web UI Setup Wizard
1. Open **`http://localhost:4500/system`** in your browser.
2. **Step 1: Create Admin Account** — Set username and secure password (hashed via Argon2id).
3. **Step 2: Connect Database** — Select engine (PostgreSQL, MySQL, SQL Server, SQLite, ClickHouse), provide connection URL, and click **Test Connection**.
4. **Step 3: Issue API Key** — Assign a role with table and operation scopes; the wizard displays a ready-to-use `curl` command.
5. Setup permanently locks. All future management is protected behind authenticated admin sessions.

#### Path B: Headless 100% CLI Flow
Manage your entire infrastructure directly through the terminal:

```bash
# 1. Create the primary administrative human user
axiom user add admin --password "s3cur3_pass!"

# 2. Register an upstream database connection (tests connectivity prior to saving)
axiom db add --alias main_db --conn "postgres://postgres:postgres@localhost:5432/app_db"

# 3. Create a restricted RBAC role (e.g. read and insert on the 'orders' table)
axiom role create --name service_role \
  --permissions '[{"database":"main_db","table_name":"orders","operations":["SELECT","INSERT"]}]'

# 4. Generate an API machine key bound to that role
axiom key create --name app_service --role service_role

# Output:
# API Key 'app_service' created.
# Base64 Token: YXBwX3NlcnZpY2U6YmVuY2hfc2VjcmV0X3Rva2VuXzEyMzQ1

# 5. Query your database through the REST API
export KEY="YXBwX3NlcnZpY2U6YmVuY2hfc2VjcmV0X3Rva2VuXzEyMzQ1"

curl -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/db/main_db/orders/rows?limit=10&sort=created_at&order=desc"

# 6. Store an object in the native content-addressed blob engine
curl -X PUT "http://localhost:4500/api/v1/blobs/assets/documents/report.pdf" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/pdf" \
  --data-binary "@report.pdf"
```



## MCP Server for AI Agents

Axiom exposes a first-class [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server directly at `POST /mcp/v1` over standard HTTP and JSON-RPC 2.0. AI coding assistants and autonomous agents can inspect schemas, execute parameterized queries, and read/write binary objects while adhering to the exact same RBAC rules, audit logs, and rate limits as standard API consumers.

### Claude Code

```bash
claude mcp add --transport http axiom http://localhost:4500/mcp/v1 \
  --header "X-Axiom-Key: YOUR_BASE64_KEY"
```

### Cursor

Add to `~/.cursor/mcp.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "axiom": {
      "url": "http://localhost:4500/mcp/v1",
      "headers": {
        "X-Axiom-Key": "YOUR_BASE64_KEY"
      }
    }
  }
}
```

### VS Code (Copilot Agent Mode)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "axiom": {
      "type": "http",
      "url": "http://localhost:4500/mcp/v1",
      "headers": {
        "X-Axiom-Key": "YOUR_BASE64_KEY"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "axiom": {
      "serverUrl": "http://localhost:4500/mcp/v1",
      "headers": {
        "X-Axiom-Key": "YOUR_BASE64_KEY"
      }
    }
  }
}
```

### Available MCP Tools

Axiom provides 15 native MCP tools spanning database querying, mutation guardrails, and content-addressed blob management. Every tool call validates the caller's role via `PolicyEngine` before execution.

#### Database Tools

| Tool Name | Parameters | Description | RBAC Enforced |
|---|---|---|---|
| `axiom_list_services` | _none_ | Lists all configured database connections authorized for the caller. | Yes |
| `axiom_list_tables` | `database`, `cursor`, `limit` | Lists tables with pagination support, filtered by caller permissions. | Yes |
| `axiom_describe_table` | `database`, `table` | Returns column definitions, datatypes, nullability, primary and foreign keys. | Yes |
| `axiom_query` | `database`, `table`, `filter`, `sort`, `order`, `limit`, `cursor` | Dialect-agnostic SELECT query with JSON filter operators (`$eq`, `$gt`, `$in`, etc.). | Yes |
| `axiom_insert` | `database`, `table`, `rows` / `row` | Inserts one or more rows into a table using parameterized drivers. | Yes |
| `axiom_update` | `database`, `table`, `filter`, `data` | Updates rows matching required filter. Rejects unconstrained full-table updates. | Yes |
| `axiom_delete` | `database`, `table`, `filter` | Deletes rows matching required filter. Rejects unconstrained full-table wipes. | Yes |
| `axiom_raw_sql` | `database`, `sql`, `params` | Executes raw SQL query via AST firewall. Validates syntax, prevents stacked queries. | Yes |

#### Blob Storage Tools

| Tool Name | Parameters | Description | RBAC Enforced |
|---|---|---|---|
| `axiom_list_blob_namespaces` | _none_ | Enumerates all blob namespaces authorized for caller access. | Yes |
| `axiom_list_blobs` | `namespace`, `prefix`, `cursor`, `limit` | Lists objects with key prefix filtering and pagination. | Yes |
| `axiom_get_blob_metadata` | `namespace`, `key` | Inspects size, MIME type, BLAKE3 hash, and storage tier without body download. | Yes |
| `axiom_read_blob` | `namespace`, `key`, `encoding`, `max_bytes` | Reads content into agent context. Context-window safety guardrail defaults to 5 MB. | Yes |
| `axiom_write_blob` | `namespace`, `key`, `content`, `encoding`, `content_type`, `ttl_seconds` | Stores or updates blob objects with optional TTL using UTF-8 or Base64 payloads. | Yes |
| `axiom_delete_blob` | `namespace`, `key` | Deletes stored object and decrements content refcounts. | Yes |
| `axiom_create_download_ticket` | `namespace`, `key`, `operation`, `ttl_seconds` | Generates a time-bounded pre-signed capability ticket URL for external downloads. | Yes |

#### MCP Context Resources

In addition to callable tools, Axiom implements the MCP Resources specification (`resources/list` and `resources/read`), allowing agents to inspect system state as context documents:

| Resource URI | Description |
|---|---|
| `axiom://services` | Live catalog of active database connections and operational health. |
| `axiom://schema/{database}` | Complete schema definitions and table metadata for a database. |
| `axiom://blobs` | Catalog of active object storage namespaces and storage telemetry. |
| `axiom://blobs/{namespace}` | Directory tree and listing of stored objects within a namespace. |
| `axiom://blobs/{namespace}/{key}` | Direct payload streaming of an object into context. |



## Database Gateway & SQL Engine

Axiom connects to SQL databases to expose REST APIs with dialect-aware AST validation, connection pooling, and in-memory caching.

```mermaid
flowchart LR
    A["SQL / CRUD Request"] --> B["AST Query Firewall<br/>(sqlparser-rs)"]
    B --> C{"Query Type?"}
    C -->|SELECT| D{"L1 Cache Hit?"}
    D -->|Yes: < 1 µs| E["Return Cached Envelope"]
    D -->|No: Miss| F["Acquire Pool Connection"]
    C -->|INSERT / UPDATE / DELETE| F
    F --> G["Execute Parameterized SQL<br/>(PG / MySQL / MSSQL / SQLite / ClickHouse)"]
    G --> H["L1 Invalidation & Idempotency Write"]
    H --> I["Uniform Response Envelope"]
```

### Key Architectural Invariants
- **Dialect-Aware AST Firewall**: Incoming queries are parsed into Abstract Syntax Trees using `sqlparser-rs` according to target engine dialect. Axiom strictly blocks stacked queries (semicolon injection), unauthorized DDL, and hostile expressions before touching upstream pools.
- **Unified Parameterized Execution**: Literal values are extracted and bound as native positional parameters (`$1`, `?`, `@P1`), guaranteeing absolute protection against SQL injection.
- **In-Memory L1 Query Cache**: Repeated `SELECT` queries hit an in-memory DashMap LRU cache. Write mutations invalidate corresponding table cache entries.
- **Idempotency Replay Protection**: Supply `Idempotency-Key` headers on mutations to cache responses for 24 hours in L2 storage, preventing double-inserts during network retries.

### Core Database Operations

#### 1. Execute Parameterized SQL
```bash
curl -X POST "http://localhost:4500/api/v1/db/main_pg/query" \
  -H "X-Axiom-Key: $KEY" \
  -H "Idempotency-Key: 7f83b165-7eae-4f49-9cf9-e93237590827" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT id, email, created_at FROM users WHERE status = $1 ORDER BY id DESC LIMIT 20",
    "params": ["active"],
    "timeout": 15
  }'
```
```json
{
  "success": true,
  "data": {
    "rows": [
      { "id": 102, "email": "carol@example.com", "created_at": "2026-10-14T18:22:00Z" },
      { "id": 101, "email": "alice@example.com", "created_at": "2026-10-14T17:15:30Z" }
    ],
    "rows_affected": 0,
    "columns": ["id", "email", "created_at"]
  },
  "error": null,
  "meta": { "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a", "duration_ms": 1.15, "cached": false }
}
```

#### 2. Query Table Rows with Keyset Pagination
```bash
curl -G "http://localhost:4500/api/v1/db/main_pg/users/rows" \
  -H "X-Axiom-Key: $KEY" \
  --data-urlencode 'filter={"status":{"eq":"active"},"score":{"gte":80}}' \
  --data-urlencode 'sort=id' \
  --data-urlencode 'order=desc' \
  --data-urlencode 'limit=25'
```

#### 3. Insert Rows with Replay Protection
```bash
curl -X POST "http://localhost:4500/api/v1/db/main_pg/users/rows" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      { "email": "dev1@example.com", "status": "active" },
      { "email": "dev2@example.com", "status": "pending" }
    ]
  }'
```
```json
{
  "success": true,
  "data": {
    "rows_affected": 2,
    "inserted_ids": [103, 104]
  }
}
```

#### 4. Scoped Row Updates (Mandatory Filter)
```bash
curl -X PATCH "http://localhost:4500/api/v1/db/main_pg/users/rows" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": { "status": "suspended" },
    "filter": { "failed_attempts": { "gte": 5 } }
  }'
```

#### 5. Scoped Row Deletions (Mandatory Filter)
```bash
curl -X DELETE "http://localhost:4500/api/v1/db/main_pg/users/rows" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "status": { "eq": "expired" } }
  }'
```

#### 6. Inspect Table Schema & Foreign Keys
```bash
curl -s -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/db/main_pg/users/schema"
```
```json
{
  "success": true,
  "data": {
    "table": "users",
    "columns": [
      { "name": "id", "data_type": "BIGINT", "nullable": false, "primary_key": true },
      { "name": "email", "data_type": "VARCHAR(255)", "nullable": false, "primary_key": false }
    ],
    "foreign_keys": [
      { "column": "org_id", "foreign_table": "organizations", "foreign_column": "id" }
    ]
  }
}
```

#### 7. Stream Massive Result Sets (NDJSON & Chunked Array)
For high-volume export pipelines, Axiom provides a zero-allocation streaming engine. Stream 100,000+ rows directly to clients without memory buffering:

```bash
# Stream as Newline-Delimited JSON (NDJSON) via Accept header
curl -G "http://localhost:4500/api/v1/db/main_pg/events/rows" \
  -H "X-Axiom-Key: $KEY" \
  -H "Accept: application/x-ndjson" \
  --data-urlencode 'limit=50000'

# Stream arbitrary SQL query with chunked response
curl -X POST "http://localhost:4500/api/v1/db/main_pg/query" \
  -H "X-Axiom-Key: $KEY" \
  -H "Accept: application/x-ndjson" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT id, payload, created_at FROM audit_log ORDER BY id ASC",
    "stream": true
  }'
```

Output arrives line-by-line as raw JSON objects:
```json
{"id":1,"payload":"login_success","created_at":"2026-10-14T10:00:00Z"}
{"id":2,"payload":"query_executed","created_at":"2026-10-14T10:00:02Z"}
```

#### 8. Row-Level Security (RLS) Predicate Pushdown
Axiom enforces fine-grained Row-Level Security directly at the policy evaluation layer. Define an `rls_filter` on any table permission; the AST engine automatically injects the constraint predicates into the query WHERE clause:

```json
{
  "database": "main_pg",
  "table_name": "orders",
  "operations": ["SELECT", "UPDATE"],
  "rls_filter": {
    "tenant_id": { "eq": "tenant_42" },
    "deleted_at": { "is_null": true }
  }
}
```
Queries issued by keys assigned to this role are guaranteed to only inspect and manipulate records matching the `rls_filter` predicates, completely preventing cross-tenant data leakage.

## Content-Addressed Blob Storage

Axiom includes a native object storage engine designed for sub-millisecond retrieval, automatic deduplication, and cryptographic integrity.

```mermaid
flowchart LR
    A["Inbound Upload"] --> B["Compute BLAKE3 Hash"]
    B --> C{"Hash Exists in Shards?"}
    C -->|Yes: Duplicate| D["Increment Refcount<br/>Zero Extra Disk Used"]
    C -->|No: New Data| E{"Payload Size?"}
    E -->|<= 64 KB| F["Embedded Fjall LSM Tree<br/>Microsecond Retrieval"]
    E -->|> 64 KB| G["Disk Storage Shards<br/>Streaming Zero-Copy I/O"]
```

### Key Architectural Invariants
- **Content-Addressed Deduplication**: Objects are indexed by their raw BLAKE3 cryptographic digest. Storing identical content under different keys consumes zero additional storage.
- **Two-Tier Engine**: Payloads under 64 KB are written directly into an embedded Fjall LSM tree for microsecond retrieval. Payloads over 64 KB stream to sharded filesystem chunks.
- **Byte-Range Streaming**: Full support for HTTP 206 Partial Content (`Range: bytes=0-1048575`). Stream audio/video or download large files in parallel without holding payloads in RAM.
- **Public Read Access & Static CDN Caching**: Enable unauthenticated public reads per namespace (`/api/v1/blobs/public/:namespace/*key`) for website images, media, and assets with HTTP 304 caching (`ETag`) and configurable CORS allowed origins. Writes and deletions remain strictly authenticated.
- **Batch Multi-Object Deletions**: Atomically remove up to 1,000 object keys per request (`POST /api/v1/blobs/:namespace/delete-objects`).
- **Chunked Multipart Uploads**: Upload multi-gigabyte archives in discrete chunks with atomic assembly and BLAKE3 verification.

### Basic Blob Operations

#### 1. Upload Object
```bash
curl -X PUT "http://localhost:4500/api/v1/blobs/media/avatars/user_101.png" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: image/png" \
  --data-binary "@avatar.png"
```
```json
{
  "success": true,
  "data": {
    "key": "avatars/user_101.png",
    "hash": "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
    "size": 48201,
    "content_type": "image/png"
  }
}
```

#### 2. Stream Object & Byte-Range Seeking
```bash
# Full download
curl -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/blobs/media/videos/demo.mp4" -o demo.mp4

# Resumable partial chunk download (first 1 MB slice)
curl -i -H "X-Axiom-Key: $KEY" \
  -H "Range: bytes=0-1048575" \
  "http://localhost:4500/api/v1/blobs/media/videos/demo.mp4" -o part.bin
```

#### 3. Direct Public CDN Media (No Auth & 304 Caching)
```bash
# Direct fetch from any browser or CDN (no auth header needed)
curl -i "http://localhost:4500/api/v1/blobs/public/media/avatars/user_101.png"

# Conditional request with ETag (returns HTTP 304 Not Modified)
curl -i "http://localhost:4500/api/v1/blobs/public/media/avatars/user_101.png" \
  -H 'If-None-Match: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4"'
```

#### 4. Inspect Object Metadata
```bash
curl -I -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/blobs/media/avatars/user_101.png"
```
Returns headers (`Content-Type`, `Content-Length`, `ETag`, `X-Axiom-Hash`) without downloading the body payload.

#### 5. List Objects by Prefix
```bash
curl -s -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/blobs/media?prefix=avatars/&limit=50"
```

#### 6. Delete Single Object
```bash
curl -X DELETE -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/blobs/media/avatars/user_101.png"
```

#### 7. Batch Delete Objects
```bash
curl -X POST "http://localhost:4500/api/v1/blobs/media/delete-objects" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "keys": [
      "avatars/user_101.png",
      "avatars/user_102.png"
    ]
  }'
```



### Large File Multipart Upload Workflow

For multi-gigabyte files (up to 5 GB), Axiom provides a 4-step multipart session workflow:

```bash
# Step 1: Initialize multipart session
UPLOAD_ID=$(curl -s -X POST "http://localhost:4500/api/v1/blobs/backups/uploads" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "db_dump.tar.gz", "content_type": "application/gzip"}' | jq -r '.data.upload_id')

# Step 2: Upload discrete parts
curl -X PUT "http://localhost:4500/api/v1/blobs/backups/uploads/$UPLOAD_ID/parts/1" \
  -H "X-Axiom-Key: $KEY" --data-binary "@chunk_1.part"
curl -X PUT "http://localhost:4500/api/v1/blobs/backups/uploads/$UPLOAD_ID/parts/2" \
  -H "X-Axiom-Key: $KEY" --data-binary "@chunk_2.part"

# Step 3: Complete and atomically assemble upload
curl -X POST "http://localhost:4500/api/v1/blobs/backups/uploads/$UPLOAD_ID/complete" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"parts": [1, 2]}'

# (Optional) Abort upload and clean up temporary storage
# curl -X DELETE -H "X-Axiom-Key: $KEY" "http://localhost:4500/api/v1/blobs/backups/uploads/$UPLOAD_ID"
```

### Resumable Chunked Upload Protocol
In addition to discrete multipart parts, Axiom supports single-endpoint resumable streaming uploads with range validation:

```bash
# Upload byte range slice to an active session
curl -X PATCH "http://localhost:4500/api/v1/blobs/backups/uploads/$UPLOAD_ID" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Range: bytes 0-1048575/5242880" \
  --data-binary "@slice_0.bin"

# Probe session status and verified byte ranges
curl -s -H "X-Axiom-Key: $KEY" "http://localhost:4500/api/v1/blobs/backups/uploads/$UPLOAD_ID"
```



### Pre-Signed Capability Tickets

Issue cryptographically signed capability tokens that permit clients or browsers to perform direct uploads or downloads without distributing API keys:

```bash
# 1. Issue a capability ticket valid for 1 hour
curl -X POST "http://localhost:4500/api/v1/blobs/assets/ticket" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "documents/report.pdf",
    "operation": "READ",
    "ttl_seconds": 3600
  }'

# Response:
# {
#   "success": true,
#   "data": {
#     "ticket": "v1.assets.documents_report_pdf.READ.1760492800.7f1a3b...",
#     "url": "http://localhost:4500/api/v1/blobs/assets/documents/report.pdf?ticket=v1.assets..."
#   }
# }

# 2. Download directly via signed URL (zero auth headers required)
curl -O "http://localhost:4500/api/v1/blobs/assets/documents/report.pdf?ticket=v1.assets..."
```



## Cluster Mesh & Node Federation

Axiom includes a built-in, zero-database peer-to-peer Cluster Mesh. Clustered nodes communicate directly over HTTP/HTTPS with mutual HMAC-SHA256 cryptographic signatures, eliminating Redis, ZooKeeper, or Raft cluster overhead.

```mermaid
flowchart LR
    A["Node A (us-east)<br/>Moniker: primary-01"] <-->|HMAC-SHA256 Handshake<br/>& Heartbeat Ping| B["Node B (eu-central)<br/>Moniker: backup-01"]
    A -.->|Instant Ban Broadcast<br/>(/internal/v1/cluster/event)| B
    B -.->|Cluster Mesh Sync| A
```

### Key Architectural Invariants
- **Zero External Coordination**: State is shared over authenticated peer gossip. No cluster databases or orchestrators required.
- **Mutual HMAC-SHA256 Authentication**: Every inter-node packet (`/internal/v1/cluster/*`) is signed using the cluster's shared secret with millisecond replay protection.
- **Instant Cluster-Wide Security Ban Propagation**: When Node A detects credential stuffing or an abusive IP, it dispatches an internal gossip event. All paired mesh nodes immediately ban the source IP in memory without polling.
- **Live Latency & Health Telemetry**: Live round-trip latency (RTT) is tracked per peer and exposed via Web UI and CLI.

### Quickstart Pairing Walkthrough

#### Path A: Web UI Pairing
1. On **Node A**, navigate to **Cluster Mesh** in the Admin Web UI (`/system`). Copy the local Node ID and Shared Secret.
2. On **Node B**, click **Pair Remote Node**, enter Node A's URL (`http://node-a:4500`) and Shared Secret, and click **Connect**.
3. Both nodes mutually verify credentials and form an active mesh link.

#### Path B: CLI Pairing
```bash
# 1. View local node status and cluster secret
axiom cluster status

# 2. Connect to a remote peer node
axiom cluster connect http://10.0.0.2:4500 <REMOTE_CLUSTER_SECRET> --moniker "us-west-1"

# 3. Probe connection latency and health
axiom cluster ping <PEER_NODE_ID>

# 4. View active cluster mesh topology
axiom cluster peers
```

---

## CLI Reference

The single binary functions both as the server daemon and the full administrative toolchain:

```text
axiom [OPTIONS] [COMMAND]

GLOBAL OPTIONS:
  -u, --url <URL>              Target Axiom server base URL (default: http://127.0.0.1:4500)
  -k, --key <KEY>              Master API key (base64) or bearer session token
      --json                   Format command output as structured JSON
      --jsonl                  Format command output as JSON Lines (JSONL stream)

SERVER DAEMON:
  server run [-c, --config <P>] Start the Axiom gateway daemon with custom config
  doctor                       Comprehensive environmental diagnostics & DB reachability check
  benchmark                    Run high-concurrency pipeline load & throughput benchmark

ADMIN USER MANAGEMENT:
  user add <USER>              Create administrative user (interactive password prompt)
  user list                    Enumerate administrative users
  user delete <USER>           Remove an administrative user
  login <USER>                 Authenticate admin credentials and issue a session token
  logout                       Invalidate active administrative session

DATABASE MANAGEMENT & DATA OPERATIONS:
  db add                       Register an upstream database connection (--alias, --conn, --engine)
  db list                      List registered database connections and status
  db test <ALIAS>              Probe database connection and measure ping latency
  db test-url <URL>            Test connectivity to raw URL before saving
  db remove <ALIAS>            Deregister database connection
  db query <ALIAS> <SQL>       Run parameterized SQL query via terminal (--params, --timeout)
  db tables <ALIAS>            List tables in an upstream database (--cursor, --limit)
  db schema <ALIAS> <TABLE>    Describe table columns, indices, and foreign keys
  db rows <ALIAS> <TABLE>      Fetch rows with limit, offset, sorting, and filter
  db insert <ALIAS> <TABLE>    Insert row object or array (--data '{"col":"val"}')
  db update <ALIAS> <TABLE>    Update rows matching filter (<FILTER> <UPDATE>)
  db delete-rows <ALIAS> <TB>  Delete rows matching mandatory filter (<FILTER>)
  db add-column <ALIAS> <TB>   Safely append a column to a table (<COL> <TYPE>)

BLOB STORAGE & TICKETS:
  blob put <NS> <KEY> <FILE>   Upload local file (or stdin '-') into namespace (--ttl, -t MIME)
  blob get <NS> <KEY>          Download object from blob namespace (--output, --ticket)
  blob head <NS> <KEY>         Inspect object metadata (headers, size, BLAKE3 hash, TTL)
  blob delete <NS> <KEY>       Delete object from blob namespace
  blob list <NS>               List objects stored in namespace (--prefix, --cursor, --limit)
  blob copy <SRC> <DST>        Copy object or directory prefix (--prefix, --dest-namespace)
  blob move <SRC> <DST>        Move or rename object or directory prefix (--prefix)
  blob delete-prefix <NS> <P>  Bulk delete all objects matching prefix
  blob verify <NS> <KEY>       Cryptographically verify blob integrity on disk
  blob stats                   Display blob storage utilization and deduplication ratio
  blob scrub                   Storage-wide cryptographic integrity audit of all blobs
  blob sweep                   Manually trigger expired object cleanup (TTL sweep)
  blob ticket <NS> <KEY>       Generate pre-signed capability download ticket URL
  blob tickets                 List active/revoked capability tickets (--namespace, --key, --all)
  blob revoke-ticket <SIG>     Revoke a capability ticket by signature or ID
  blob ns list                 List storage namespaces and quota limits
  blob ns create <NS>          Create storage namespace (--max-bytes)
  blob ns update <NS>          Update namespace quota or rename (--max-bytes, --new-name)
  blob ns delete <NS>          Delete namespace and all contained objects

API KEYS & ACCESS TOKENS:
  key create                   Generate scoped API machine key (--name, --role, --secret)
  key list                     List active API keys, attached roles, and expiration
  key rotate <NAME>            Atomically roll cryptographic secret for an API key
  key delete <NAME>            Revoke and delete API key

RBAC ROLES & PERMISSIONS:
  role create                  Create an RBAC role with permissions JSON (--permissions)
  role list                    List roles and permission matrices
  role update <NAME>           Update permission matrix or description for a role
  role delete <NAME>           Remove an RBAC role

CACHE OPERATIONS:
  cache stats                  Inspect L1 RAM and L2 disk cache utilization
  cache flush                  Flush all transient cache entries

CLUSTER MESH & NODE FEDERATION:
  cluster status               Show local cluster node ID, moniker, and mesh overview
  cluster peers                List all paired cluster peer nodes and latency status
  cluster connect <URL> <SEC>  Pair and connect to a remote node (--moniker)
  cluster remove <NODE_ID>     Disconnect and unregister a cluster peer
  cluster update <NODE_ID>     Update peer configuration (--url, --secret, --moniker)
  cluster ping <NODE_ID>       Probe peer latency with an on-demand heartbeat ping
  cluster moniker <NAME>       Update local node cluster display moniker

CONFIGURATION TOOLING:
  config init                  Initialize a new default config.toml file (--path, --to-env)
  config to-env                Convert config.toml into an environment variable .env file
  config show                  Validate and display active configuration values

SYSTEM & TELEMETRY:
  health                       Check gateway status and reachability
  ready                        Execute upstream readiness probe
  metrics                      Dump Prometheus exposition metrics
  audit                        Query immutable control plane audit history (--limit, --offset)
  reload                       Force instant synchronization of metadata snapshots
```

All commands support `--json` and `--jsonl` flags for clean script and CI/CD piping.



## Complete API Route Map

### Core & System Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/health` | Liveness health check (`{"status":"ok"}`) | Public |
| `GET` | `/ready` | Upstream database connectivity readiness probe | Public |
| `GET` | `/metrics` | Prometheus metrics exposition (`?format=json` or Prometheus 0.0.4) | Admin Session |
| `POST` | `/mcp/v1` | Model Context Protocol JSON-RPC 2.0 endpoint for AI agents | API Key / Session |
| `GET` | `/system/*` | Embedded administrative Web UI SPA | Public / Session |

### Database Data API (`/api/v1/db`)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/v1/db/databases` | Enumerate all connected databases authorized for the caller's role | API Key |
| `POST` | `/api/v1/db/:alias/query` | Execute parameterized SQL with AST firewall & `Idempotency-Key` support | API Key |
| `GET` | `/api/v1/db/:alias/tables` | Keyset cursor-paginated table listing | API Key |
| `GET` | `/api/v1/db/:alias/:table/schema` | Inspect column definitions, datatypes, nullability, and foreign keys | API Key |
| `GET` | `/api/v1/db/:alias/:table/rows` | Keyset-paginated row queries with JSON filters and sort ordering | API Key |
| `POST` | `/api/v1/db/:alias/:table/rows` | Insert one or more rows with `Idempotency-Key` replay protection | API Key |
| `PATCH` | `/api/v1/db/:alias/:table/rows` | Update rows matching mandatory filter object (unbounded rejected) | API Key |
| `DELETE` | `/api/v1/db/:alias/:table/rows` | Delete rows matching mandatory filter object (unbounded rejected) | API Key |
| `POST` | `/api/v1/db/:alias/:table/columns` | Dynamic DDL: Add a column to an existing table schema | API Key |

### Blob Storage Data API (`/api/v1/blobs`)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/v1/blobs/public/:namespace/*key` | Unauthenticated public object stream with 304 ETag caching | Public |
| `HEAD` | `/api/v1/blobs/public/:namespace/*key` | Unauthenticated public object metadata and headers | Public |
| `GET` | `/api/v1/blobs/:namespace` | List stored objects with optional `prefix`, `cursor`, and `limit` | API Key |
| `PUT` | `/api/v1/blobs/:namespace/*key` | Upload an object with BLAKE3 content-addressed deduplication | API Key / Ticket |
| `GET` | `/api/v1/blobs/:namespace/*key` | Stream an object (supports `Range: bytes=X-Y` and `?ticket=...`) | API Key / Ticket |
| `HEAD` | `/api/v1/blobs/:namespace/*key` | Retrieve object metadata, size, MIME type, ETag, and BLAKE3 hash | API Key / Ticket |
| `DELETE` | `/api/v1/blobs/:namespace/*key` | Delete an object from the namespace and decrement content refcount | API Key |
| `POST` | `/api/v1/blobs/:namespace/ticket` | Generate a pre-signed capability ticket URL for direct access | API Key |
| `POST` | `/api/v1/blobs/:namespace/delete-objects` | Batch delete up to 1,000 objects in a single atomic request | API Key |
| `POST` | `/api/v1/blobs/:namespace/uploads` | Initialize a multipart chunked upload session | API Key |
| `PUT` | `/api/v1/blobs/:namespace/uploads/:id/parts/:part` | Upload a discrete chunk part for an active upload session | API Key |
| `POST` | `/api/v1/blobs/:namespace/uploads/:id/complete` | Atomically verify and assemble uploaded chunk parts | API Key |
| `DELETE` | `/api/v1/blobs/:namespace/uploads/:id` | Abort a multipart upload session and clean up temporary parts | API Key |
| `PATCH` | `/api/v1/blobs/:namespace/uploads/:id` | Resumable chunk upload with byte range validation | API Key |
| `GET` | `/api/v1/blobs/:namespace/uploads/:id` | Probe resumable session status and uploaded byte slices | API Key |

## Filter Syntax

Filter expressions for `GET /api/v1/db/:alias/:table/rows`, `PATCH`, and `DELETE` endpoints are passed as JSON objects. All field identifiers are strictly sanitized against SQL injection, and literal values are parameterized with positional bindings.

### Basic & Operator Filtering

```json
{
  "status": { "eq": "active" },
  "balance": { "gte": 500.00 },
  "age": { "between": [18, 65] },
  "country": { "in": ["US", "CA", "GB"] },
  "email": { "ilike": "%@corp.com" },
  "deleted_at": { "is_null": true }
}
```

```bash
# Pass as URL-encoded query parameter via curl:
curl -G "http://localhost:4500/api/v1/db/main_pg/users/rows" \
  -H "X-Axiom-Key: $KEY" \
  --data-urlencode 'filter={"status":{"eq":"active"},"age":{"between":[21,65]}}' \
  --data-urlencode 'sort=id' \
  --data-urlencode 'order=desc' \
  --data-urlencode 'limit=25'
```

### Complete Operators Reference

Operators accept either bare names (`eq`) or MongoDB-style dollar prefixes (`$eq`):

| Operator | SQL Equivalent | Example JSON Filter | Description |
|---|---|---|---|
| `eq` / `$eq` | `= ?` | `{"tier": {"eq": "enterprise"}}` | Exact equality |
| `ne` / `neq` / `$ne` | `!= ?` | `{"status": {"neq": "banned"}}` | Inequality |
| `gt` / `$gt` | `> ?` | `{"score": {"gt": 85}}` | Strictly greater than |
| `gte` / `$gte` | `>= ?` | `{"age": {"gte": 21}}` | Greater than or equal |
| `lt` / `$lt` | `< ?` | `{"latency_ms": {"lt": 50.0}}` | Strictly less than |
| `lte` / `$lte` | `<= ?` | `{"stock": {"lte": 10}}` | Less than or equal |
| `like` / `$like` | `LIKE ?` | `{"company": {"like": "%Tech%"}}` | Case-sensitive pattern match |
| `ilike` / `$ilike` | `LOWER(col) LIKE LOWER(?)` | `{"email": {"ilike": "%@acme.com"}}` | Case-insensitive pattern match |
| `in` / `$in` | `IN (?, ?, ...)` | `{"role": {"in": ["admin", "editor"]}}` | Match any value in list |
| `nin` / `$nin` | `NOT IN (?, ?, ...)` | `{"category": {"nin": ["archived", "draft"]}}` | Exclude all values in list |
| `between` / `$between` | `BETWEEN ? AND ?` | `{"created_at": {"between": ["2026-01-01", "2026-12-31"]}}` | Range inclusion (2 elements) |
| `is_null` / `null` | `IS NULL` / `IS NOT NULL` | `{"verified_at": {"is_null": false}}` | Nullability constraint (`true` / `false`) |
| `is_not_null` | `IS NOT NULL` | `{"completed_at": {"is_not_null": true}}` | Non-null constraint |

### Compound Logical Grouping (`$or` / `$and`)

Filters support nested boolean branching via `$or` and `$and` arrays:

```json
{
  "$or": [
    { "role": { "eq": "admin" } },
    {
      "$and": [
        { "tier": { "eq": "enterprise" } },
        { "balance": { "gte": 10000.00 } }
      ]
    }
  ]
}
```



## Axiom vs Faucet vs PostgREST vs Hasura vs Supabase

| Dimension | Axiom | Faucet | PostgREST | Hasura | Supabase |
|---|---|---|---|---|---|
| **Core Architecture** | Pure Rust (native) | Go | Haskell | Haskell / Go (v3) | Multi-container stack |
| **Idle Memory (RSS)** | **< 10 MB** | ~ 35 MB | ~ 30 MB | > 150 MB | > 1.2 GB |
| **Supported Databases** | PostgreSQL, MySQL, MariaDB, SQL Server, LibSQL/Turso, ClickHouse | PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, Snowflake, SQLite | PostgreSQL only | PostgreSQL + Enterprise connectors | PostgreSQL only |
| **Native Blob Storage** | **Built-in** (BLAKE3 dedup + 2-tier Fjall LSM) | None | None | None | S3 / MinIO container |
| **Capability Tickets** | **Built-in** (Stateless HMAC-BLAKE3) | None | None | None | S3 Presigned URLs |
| **AI Agent MCP Server** | **Built-in** (`/mcp/v1` HTTP) | Built-in (`/mcp`) | None | None | None |
| **AST SQL Firewall** | **Built-in** (sqlparser AST validation) | Basic regex checks | Schema reflection | GraphQL compiler | RLS policies in DB |
| **Admin Web UI** | **Embedded** (Vite + TS + Tailwind) | Embedded (Preact) | None | Web Console | Supabase Studio |
| **Deployment Model** | **Single static binary** | Single binary | Single binary | Multi-service | 12+ Docker containers |
| **License** | **MIT** | MIT | MIT | Apache 2.0 / BSL | Apache 2.0 |



## Performance Targets

Every performance metric is governed by automated micro-benchmarks (`benches/benches/pipeline.rs` and Go suites):

| Pipeline Stage | Target Latency | Verification Benchmark |
|---|---|---|
| L1 RAM Cache GET | `< 1 µs` p50 | `benches/benches/pipeline.rs` (`l1_get_hot_hit`) |
| Capability Ticket Generation | `< 2 µs` | `benches/benches/pipeline.rs` (`ticket_generation`) |
| ArcSwap Auth Validation | `< 5 µs` | `benches/benches/pipeline.rs` (`auth_snapshot_valid_hit`) |
| BLAKE3 64 KB Chunk Hash | `< 15 µs` | `benches/benches/pipeline.rs` (`blake3_chunk_hash_64kb`) |
| Full Pipeline Cache Hit | `< 500 µs` p50 | Hoisted Axum mock round-trip |
| End-to-End Local DB Query | `< 2 ms` p50 | PostgreSQL local loopback |
| Cold Boot to TCP Accept | `< 200 ms` | Startup process timing |
| Stripped Binary Size | `< 15 MB` | Release profile with LTO and strip enabled |



## Documentation

Comprehensive guides and technical specifications are available in the `docs/` directory:

| Document | Description |
|---|---|
| **[API Reference](./docs/api.md)** | Complete endpoint reference across Core, Database, Blobs Data, Admin Control Plane, Internal P2P Cluster Mesh, and MCP |
| **[Configuration Guide](./docs/configuration.md)** | Detailed `config.toml` specification covering all 8 configuration sections, defaults, and environment variable overrides |

## Frequently Asked Questions

#### How does Axiom authenticate requests?
Clients supply the `X-Axiom-Key` header containing a base64-encoded `name:secret` pair. Axiom derives the secret's BLAKE3 digest and verifies it in constant time against an immutable `ArcSwap` snapshot in memory. Hot data requests never touch disk or metadata tables during authentication.

#### Can I use Axiom without a configuration file?
Yes. Axiom compiles with sensible defaults. If no `config.toml` is present, it binds to `0.0.0.0:4500` and creates `data/axiom.db` for metadata. Upstream databases, roles, and keys are added dynamically through the CLI or Web UI.

#### How does the AST query firewall protect against SQL injection?
Rather than relying on brittle regular expressions, Axiom parses incoming SQL statements using `sqlparser-rs` according to the target database dialect. It rejects multi-statement payloads (stacked queries), unauthorized mutations, destructive DDL statements, and comments designed to bypass sanitization.

#### Is blob storage required to use the database gateway?
The blob engine runs natively inside the single binary with zero external services required. If you do not issue blob requests, the subsystem remains completely idle, incurring zero background CPU overhead.



## License

Axiom is open-source software licensed under the **[MIT License](./LICENSE)**.  
Maintained by [Toxichome](https://toxichome.cc).

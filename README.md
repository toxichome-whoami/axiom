<div align="center">

# Axiom

### High-performance REST API, Content-Addressed Blob Storage, and MCP Server for SQL Databases.
**One Rust binary. Zero external daemons. Under 10 MB idle RAM.**

[![Version](https://img.shields.io/badge/version-4.0.0-111827.svg?style=flat-square)](https://github.com/toxichome/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827.svg?style=flat-square)](https://github.com/toxichome/axiom/releases)
[![Binary Size](https://img.shields.io/badge/binary-%3C15MB-111827.svg?style=flat-square)](https://github.com/toxichome/axiom)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-111827.svg?style=flat-square)](https://modelcontextprotocol.io)

[Website](https://toxichome.cc) &middot;
[Documentation](./docs/AXIOM_MASTER_PLAN.md) &middot;
[API Reference](./docs/reference/api.md) &middot;
[Quickstart](#60-second-quickstart) &middot;
[MCP for AI Agents](#mcp-server-for-ai-agents) &middot;
[Blob Storage](#content-addressed-blob-storage) &middot;
[Comparison](#axiom-vs-faucet-vs-postgrest-vs-hasura-vs-supabase) &middot;
[CLI Reference](#cli-reference)

</div>

---

## What is Axiom?

Axiom is an ultra-fast, single-binary database gateway and object store written in pure Rust. It connects to your existing SQL databases and local storage volumes, introspects schemas, and instantly exposes:

1. **A production-ready CRUD REST API** with keyset cursor pagination, structured query operators, and an AST-based SQL injection firewall.
2. **A content-addressed blob storage engine** backed by BLAKE3 deduplication, a two-tier LSM storage architecture (Fjall + direct disk shards), byte-range streaming, and pre-signed capability tickets.
3. **A Model Context Protocol (MCP) server** at `/mcp/v1` that gives AI agents (Claude Code, Cursor, Windsurf, VS Code Copilot) governed, audited, read/write access to your databases and blobs.
4. **An embedded administrative Web UI** at `/system` with a first-boot setup wizard, connection test diagnostics, role builders, API key management, live audit logs, and Prometheus metrics.

All configuration and dynamic metadata (databases, users, roles, permissions, API keys) live in an embedded `axiom.db` file powered by LibSQL. The hot data path reads immutable snapshots via `ArcSwap`, adding zero database locks to incoming requests.

---

## How It Works

```
+-----------------------------------------------------------------------------------------+
|                                     INCOMING TRAFFIC                                    |
|         Web Applications          Mobile / Edge Clients              AI Agents          |
|        [ X-Axiom-Key Header ]     [ Pre-signed Tickets ]      [ Claude / Cursor MCP ]   |
+-----------------------------------------------------------------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
|                                   AXIOM DATA PLANE                                      |
|                                                                                         |
|  [ Web Application Firewall ]                                                           |
|    - 2048-byte URI length guard   - 3x recursive URL decode   - Null-byte filter        |
|                                                                                         |
|  [ Rate Limiting & Defense ]                                                            |
|    - Per-IP fixed-window counter  - Per-key rate limiter      - Brute-force ban list    |
|                                                                                         |
|  [ Authentication & RBAC ]                                                              |
|    - BLAKE3 constant-time hash    - ArcSwap snapshot cache    - Zero-lock hot path      |
|                                                                                         |
|  [ Execution Engines ]                                                                  |
|    +--------------------------------------+  +---------------------------------------+  |
|    | SQL AST Engine (sqlparser)           |  | Native Blob Engine                    |  |
|    | - Single-statement enforcement       |  | - BLAKE3 content-addressed dedup      |  |
|    | - Mutation & destructive DDL guard   |  | - Two-tier storage (Fjall LSM + Disk) |  |
|    | - Keyset pagination & filter builder |  | - Pre-signed capability tickets       |  |
|    | - Per-alias connection pooling       |  | - HTTP 206 byte-range streaming       |  |
|    +--------------------------------------+  +---------------------------------------+  |
+-----------------------------------------------------------------------------------------+
         |                       |                       |                      |
         v                       v                       v                      v
+-----------------+     +-----------------+     +------------------+     +----------------+
|   PostgreSQL    |     |  MySQL/MariaDB  |     |   MS SQL Server  |     | SQLite / Turso |
|  12, 13, 14-17  |     |  8.0+ / 10.4+   |     |   2017 - 2022    |     |   & ClickHouse |
+-----------------+     +-----------------+     +------------------+     +----------------+
```

---

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

---

### 2. Start Axiom

Run the server daemon with compiled-in defaults:

```bash
axiom server run
```

Axiom starts immediately on `http://localhost:4500` with an empty state and under 10 MB RAM footprint.

---

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

---

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

| Tool | Category | Description | RBAC Enforced |
|---|---|---|---|
| `db_list_databases` | Database | Enumerate all connected database aliases available to caller | Yes |
| `db_list_tables` | Database | List table names and estimated row counts within a database | Yes |
| `db_describe_table` | Database | Inspect column datatypes, primary keys, and foreign key relations | Yes |
| `db_query` | Database | Execute parameterized SQL statements via AST firewall | Yes |
| `blob_put` | Storage | Store binary or text content with BLAKE3 content addressing | Yes |
| `blob_get` | Storage | Retrieve stored object payload and metadata | Yes |
| `blob_list` | Storage | Enumerate stored objects within an authorized namespace | Yes |
| `blob_issue_ticket` | Storage | Generate pre-signed capability tickets for secure client downloads | Yes |

---

## Content-Addressed Blob Storage

Axiom includes an integrated object storage subsystem designed for sub-millisecond retrieval and cryptographic data integrity.

### Architecture
- **Content-Addressed Deduplication**: Objects are indexed by their raw BLAKE3 cryptographic digest. Storing identical content under different keys consumes zero additional storage.
- **Two-Tier Engine**: Payloads under 64 KB are written directly into an embedded Fjall LSM tree for microsecond retrieval. Payloads over 64 KB stream to sharded filesystem chunks.
- **Byte-Range Streaming**: Full support for HTTP 206 Partial Content (`Range: bytes=0-1048575`). Stream video or download large files in parallel without holding payloads in RAM.
- **Chunked Multipart Uploads**: Upload multi-gigabyte archives in discrete chunks with atomic assembly and sha256/blake3 verification.

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

---

## CLI Reference

The single binary functions both as the server daemon and the full administrative toolchain:

```text
axiom [OPTIONS] [COMMAND]

COMMANDS:
  server run                   Start the Axiom gateway daemon (default action)
  user add <USER>              Create administrative user (interactive password prompt)
  user list                    Enumerate administrative users
  user delete <USER>           Remove an administrative user
  db add                       Register an upstream database connection
  db list                      List registered database connections
  db test <ALIAS>              Probe database connection and measure ping latency
  db test-url <URL>            Test connectivity to raw URL before saving
  db remove <ALIAS>            Deregister database connection
  db query <ALIAS> <SQL>       Run parameterized SQL query via terminal
  db tables <ALIAS>            List tables in an upstream database
  db schema <ALIAS> <TABLE>    Describe table columns, indices, and foreign keys
  db rows <ALIAS> <TABLE>      Fetch rows with limit, offset, and sorting
  blob put <NS> <KEY>          Upload file into blob namespace
  blob get <NS> <KEY>          Download object from blob namespace
  blob delete <NS> <KEY>       Delete object from blob namespace
  blob list <NS>               List objects stored in namespace
  blob stats                   Display blob engine storage metrics and deduplication ratio
  blob ticket <NS> <KEY>       Generate capability ticket for key
  key create                   Generate scoped API machine key
  key list                     List active API keys and attached roles
  key rotate <NAME>            Atomically roll secret for an API key
  key delete <NAME>            Revoke and delete API key
  role create                  Create an RBAC role with permissions JSON
  role list                    List roles and permission matrices
  role update <NAME>           Update permission matrix for a role
  role delete <NAME>           Remove an RBAC role
  cache stats                  Inspect L1 RAM and L2 disk cache utilization
  cache flush                  Flush all transient caches
  health                       Check gateway status and reachability
  ready                        Execute readiness probe
  metrics                      Dump Prometheus exposition metrics
  audit                        Query immutable control plane audit history
  reload                       Force instant synchronization of metadata snapshots
  doctor                       Comprehensive environmental diagnostics
  benchmark                    Run high-concurrency local load benchmark
```

All commands support `--json` and `--jsonl` flags for clean script and CI/CD piping.

---

## API Route Map

### Data API
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/db/:alias/query` | Execute parameterized SQL via AST firewall |
| `GET` | `/api/v1/db/:alias/tables` | Keyset-paginated list of tables |
| `GET` | `/api/v1/db/:alias/:table/rows` | Keyset-paginated row queries with structured filters |
| `POST` | `/api/v1/db/:alias/:table/rows` | Insert rows with optional `Idempotency-Key` |
| `PATCH` | `/api/v1/db/:alias/:table/rows` | Update rows matching mandatory filter object |
| `DELETE` | `/api/v1/db/:alias/:table/rows` | Delete rows matching mandatory filter object |
| `GET` | `/api/v1/db/:alias/:table/schema` | Inspect column metadata and foreign relations |
| `GET` | `/api/v1/db/databases` | Enumerate authorized database connections |

### Blob Storage API
| Method | Endpoint | Description |
|---|---|---|
| `PUT` | `/api/v1/blobs/:namespace/*key` | Upload object (supports capability ticket) |
| `GET` | `/api/v1/blobs/:namespace/*key` | Stream object (supports `Range: bytes=X-Y` & tickets) |
| `HEAD` | `/api/v1/blobs/:namespace/*key` | Retrieve object metadata, size, and BLAKE3 hash |
| `DELETE` | `/api/v1/blobs/:namespace/*key` | Delete object from namespace |
| `POST` | `/api/v1/blobs/:namespace/ticket` | Generate pre-signed capability ticket |
| `GET` | `/api/v1/blobs/:namespace/list` | List objects matching key prefix |
| `GET` | `/api/v1/blobs/stats` | View storage utilization and dedup savings |

### System & Control Plane
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Public liveness probe (`{"status":"ok"}`) |
| `GET` | `/ready` | Upstream database readiness probe |
| `GET` | `/metrics` | Prometheus metrics scrape target (admin session) |
| `POST` | `/mcp/v1` | JSON-RPC 2.0 Model Context Protocol endpoint |
| `GET` | `/system/*` | Embedded Web UI single-page application |

---

## Filter Syntax

Filter expressions for `GET /api/v1/db/:alias/:table/rows` are passed as URL-encoded JSON objects:

```json
{
  "status": { "eq": "active" },
  "balance": { "gte": 500.00 },
  "country": { "in": ["US", "CA", "GB"] },
  "email": { "like": "%@corp.com" },
  "deleted_at": { "is_null": true }
}
```

| Operator | SQL Equivalent | Example Payload |
|---|---|---|
| `eq` | `= ?` | `{"tier": {"eq": "gold"}}` |
| `neq` | `!= ?` | `{"status": {"neq": "banned"}}` |
| `gt` | `> ?` | `{"age": {"gt": 21}}` |
| `gte` | `>= ?` | `{"rating": {"gte": 4.5}}` |
| `lt` | `< ?` | `{"stock": {"lt": 10}}` |
| `lte` | `<= ?` | `{"price": {"lte": 99.99}}` |
| `like` | `LIKE ?` | `{"name": {"like": "John%"}}` |
| `in` | `IN (?, ?, ...)` | `{"role": {"in": ["admin", "editor"]}}` |
| `is_null` | `IS NULL` / `IS NOT NULL` | `{"verified_at": {"is_null": false}}` |

---

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

---

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

---

## Frequently Asked Questions

#### How does Axiom authenticate requests?
Clients supply the `X-Axiom-Key` header containing a base64-encoded `name:secret` pair. Axiom derives the secret's BLAKE3 digest and verifies it in constant time against an immutable `ArcSwap` snapshot in memory. Hot data requests never touch disk or metadata tables during authentication.

#### Can I use Axiom without a configuration file?
Yes. Axiom compiles with sensible defaults. If no `config.toml` is present, it binds to `0.0.0.0:4500` and creates `data/axiom.db` for metadata. Upstream databases, roles, and keys are added dynamically through the CLI or Web UI.

#### How does the AST query firewall protect against SQL injection?
Rather than relying on brittle regular expressions, Axiom parses incoming SQL statements using `sqlparser-rs` according to the target database dialect. It rejects multi-statement payloads (stacked queries), unauthorized mutations, destructive DDL statements, and comments designed to bypass sanitization.

#### Is blob storage required to use the database gateway?
The blob engine runs natively inside the single binary with zero external services required. If you do not issue blob requests, the subsystem remains completely idle, incurring zero background CPU overhead.

---

## License

Axiom is open-source software licensed under the **[MIT License](./LICENSE)**.  
Maintained by [Toxichome](https://toxichome.cc).

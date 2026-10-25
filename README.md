<div align="center">

# Axiom

### High-Performance Database Access Gateway & Object Engine, Written in Rust
**Put a secure REST API & MCP layer between your applications and SQL databases.**  
Single Static Binary · Zero-Lock RBAC · Embedded Blob Store · Sub-10MB RAM Footprint

[![Version](https://img.shields.io/badge/version-0.1.17-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Zig](https://img.shields.io/badge/zig-0.13%2B-f7a41d.svg?style=flat-square&logo=zig&logoColor=white)](https://ziglang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Binary Size](https://img.shields.io/badge/binary-%3C15MB-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-111827.svg?style=flat-square)](https://modelcontextprotocol.io)

<br/>

<p align="center">
  <img src="docs/images/dashboard.png" alt="Axiom Gateway Admin Web UI" width="860">
  <br>
  <em>Embedded Admin Web UI at <code>/system</code>: real-time pool telemetry, L1 cache hit ratios, schema inspection, and role builders.</em>
</p>

</div>

---

## Highlights

* **Universal Database REST API**: Instantly expose auto-introspected CRUD endpoints, keyset pagination, and AST-guarded parameterized SQL queries across **7 major database engines**.
* **Zero Database Drivers in Apps**: Query your databases from any language (Python, Node.js, Go, PHP, Rust, cURL) using standard HTTP without bundling heavy native C drivers.
* **Content-Addressed Blob Storage**: Native BLAKE3-deduplicated object storage backed by a two-tier LSM engine (Fjall + direct disk shards) with pre-signed capability tickets.
* **Built-in Model Context Protocol (MCP)**: Governed tool and resource access (`/mcp/v1`) for AI coding agents like Claude Code, Cursor, Windsurf, and Copilot.
* **Zero-Lock Hot Path**: Authentication and RBAC evaluated in **sub-microsecond** time via `ArcSwap` memory snapshots, eliminating database lock contention.
* **Single Portable Binary**: Everything runs in one sub-15MB executable (<10MB idle RAM) with an embedded Web UI, self-bootstrapping Zig build pipeline, and P2P cluster mesh.

---

## Supported Databases

Axiom automatically inspects schemas and adapts dialects across upstream databases:

| Engine | Supported Versions | Connection String Example |
|---|---|---|
| **PostgreSQL** | 12 – 17 | `postgres://user:password@localhost:5432/app_db` |
| **MySQL / MariaDB** | 8.0+ / 10.4+ | `mysql://user:password@localhost:3306/app_db` |
| **Microsoft SQL Server** | 2017 – 2022 | `mssql://sa:password@localhost:1433/app_db` |
| **SQLite / LibSQL** | Local & Turso Cloud | `sqlite://data/app.db` or `libsql://db.turso.io?authToken=...` |
| **ClickHouse** | 22+ (Analytical HTTP) | `clickhouse://user:password@localhost:8123/default` |
| **Snowflake** | Cloud Data Warehouse | `snowflake://user:pass@org-account.snowflakecomputing.com?warehouse=WH&database=DB` |
| **Oracle Database** | 19c, 21c, 23ai | `oracle://user:pass@localhost:1521/XEPDB1` or `ords+https://ords-host/ords/schema` |

---

## Quick Start

### 1. Install Axiom

**Linux & macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/toxichome-whoami/axiom/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/toxichome-whoami/axiom/main/install.ps1 | iex
```

**Docker:**
```bash
docker run -d -p 4500:4500 -v axiom-data:/app/data --name axiom ghcr.io/toxichome-whoami/axiom:0.1.17
```

### 2. Launch the Gateway

```bash
axiom server run
```

Axiom starts immediately on `http://localhost:4500` with zero configuration required.

### 3. Connect a Database

Open **`http://localhost:4500/system`** in your browser for the first-run setup wizard, or configure via CLI:

```bash
# 1. Create root admin
axiom user add admin --password "s3cur3_pass!"

# 2. Register upstream database
axiom db add --alias main_db --conn "postgres://postgres:postgres@localhost:5432/app_db"

# 3. Create role and issue scoped API key
axiom role create --name app_role --permissions '[{"database":"main_db","table_name":"*","operations":["SELECT","INSERT","UPDATE"]}]'
axiom key create --name web_client --role app_role
```

### 4. Query Over HTTP

```bash
export KEY="<base64_key_from_step_3>"

# Fetch paginated rows with filter
curl -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/db/main_db/users/rows?limit=10&sort=id&order=desc"

# Execute parameterized SQL query
curl -X POST "http://localhost:4500/api/v1/db/main_db/query" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT id, email FROM users WHERE status = $1", "params": ["active"]}'
```

---

## AI Agent Integration (MCP)

Axiom runs a native [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server at `/mcp/v1`, exposing 15 governed database and blob tools to AI coding assistants:

### Claude Code
```bash
claude mcp add --transport http axiom http://localhost:4500/mcp/v1 --header "X-Axiom-Key: YOUR_KEY"
```

### Cursor & Windsurf
Add to `mcp.json`:
```json
{
  "mcpServers": {
    "axiom": {
      "url": "http://localhost:4500/mcp/v1",
      "headers": { "X-Axiom-Key": "YOUR_KEY" }
    }
  }
}
```

---

## Performance Highlights

All figures are empirical micro-benchmarks measured via Criterion.rs ([Full Benchmark Report](docs/benchmarks.md)):

| Operation | Measured Latency (p50) | Invariant Target | Notes |
|---|---|---|---|
| **Atomic Metadata Snapshot Read** | **12.6 ns** | `< 50 ns` | Zero-lock `ArcSwap` hot-path pointer dereference |
| **RBAC Policy Wildcard Match** | **38.9 ns** | `< 100 ns` | Immediate allow via `*` database & table rule |
| **Hot AST Dialect Cache Hit** | **65.7 ns** | `< 200 ns` | Pre-parsed AST metadata cache hit |
| **Rate Limiter Check (Contended)** | **77.7 ns** | `< 200 ns` | Dual IP + API key sliding window check |
| **L1 Query Cache Hot Hit** | **106.6 ns** | `< 1 µs` | In-memory RAM cache hit (zero disk / DB I/O) |
| **Constant-Time Key Auth Hit** | **529.5 ns** | `< 5 µs` | Base64 decode + BLAKE3 hash verification |
| **Capability Ticket Verification** | **586.1 ns** | `< 2 µs` | Stateless HMAC-BLAKE3 capability token |
| **Full HTTP Request Pipeline** | **13.4 µs** (0.013 ms) | `< 50 µs` | Full Axum router, WAF, and middleware dispatch |

---

## Architecture at a Glance

```mermaid
flowchart LR
    subgraph Clients["Clients & Agents"]
        A1["Web & Mobile Apps"]
        A2["AI Agents (Claude, Cursor)"]
        A3["Admin UI & CLI"]
    end

    subgraph Axiom["Axiom Gateway (Single Binary, <10MB RAM)"]
        WAF["WAF & Rate Limiter"]
        AUTH["Zero-Lock RBAC (ArcSwap)"]
        SQL["SQL AST Engine & L1 Cache"]
        BLOB["BLAKE3 Blob Engine (Fjall LSM)"]
        MCP["MCP Server (/mcp/v1)"]

        WAF --> AUTH
        AUTH --> SQL
        AUTH --> BLOB
        AUTH --> MCP
    end

    subgraph Storage["Upstream Targets"]
        DB["Postgres · MySQL · MSSQL · SQLite · ClickHouse · Snowflake · Oracle"]
        DISK["Local NVMe / Disk Shards"]
    end

    Clients --> WAF
    SQL --> DB
    BLOB --> DISK
```

---

## Architectural Comparison

| Dimension | Axiom Gateway | FaucetDB | PostgREST | Hasura v2/v3 | Supabase |
|---|---|---|---|---|---|
| **Language & Runtime** | **Native Rust (single binary)** | Go | Haskell | Haskell / Go | Multi-container Docker |
| **Idle Memory (RSS)** | **~21 MB** (all engines active) | ~35 MB | ~30 MB | > 150 MB | > 1.2 GB |
| **L1 Cache Retrieval** | **106.6 ns** (In-Memory LRU) | ~2.5 µs | N/A (External cache) | In-memory query plan | External Redis |
| **Auth Verification** | **529.5 ns** (ArcSwap + BLAKE3) | ~4.2 µs | JWT DB role switch | Webhook / JWT | GoTrue container |
| **SQL Safety Defense** | **Dialect AST Parsing** (65.7 ns) | Regex matching | Schema reflection | GraphQL compiler | Database RLS |
| **Blob / Object Storage** | **Built-in** (BLAKE3 dedup + LSM) | None | None | None | MinIO / S3 daemon |
| **Pre-Signed Tickets** | **Built-in** (586 ns verification) | None | None | None | S3 presigned URLs |
| **AI Agent Support** | **Built-in MCP Server** (`/mcp/v1`) | Built-in (`/mcp`) | None | None | None |
| **Embedded Admin UI** | **Built-in** (Vite + TS + Tailwind) | Embedded (Preact) | None | Web Console | Supabase Studio |
| **Supported SQL Engines** | **7 Engines** | 6 Engines | Postgres only | Postgres + plugins | Postgres only |

---

## Documentation

Deep dive into the complete documentation suite:

| Document | Description |
|---|---|
| **[API Reference](docs/api.md)** | Full REST endpoint specifications, query filters, capability tickets, and MCP reference |
| **[Configuration Guide](docs/configuration.md)** | Complete `config.toml` options, module reference, `.env` overrides, and production checklist |
| **[Build & Toolchain Guide](docs/building.md)** | Zero-bloat self-bootstrapping build pipeline with Zig (no MSVC / MinGW required) |
| **[Benchmark Report](docs/benchmarks.md)** | Empirical Criterion.rs micro-benchmarks across all hot paths and subsystems |

---

## License

Axiom is open-source software licensed under the **[MIT License](./LICENSE)**.  
Maintained by [Toxichome](https://toxichome.cc).

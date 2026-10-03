# Axiom

A zero-allocation, single-binary API gateway that sits between applications and SQL databases, providing secure HTTP access, granular RBAC, and caching.

**Status:** v4.0.0. Active development.

## Requirements
- Rust 1.70+
- Cargo

## Quick Start

```bash
# 1. Build the single binary
cargo build --release

# 2. Initialize the configuration
./target/release/axiom config init

# 3. Start the server
./target/release/axiom server
```

By default, the server runs on `127.0.0.1:4500` and generates an initial `config.toml` file in the current directory.

## Configuration

Axiom is configured via `config.toml`. A minimal example:

```toml
[server]
host = "0.0.0.0"
port = 4500
workers = 4 # Number of tokio worker threads. 0 = auto.

[metadata]
url = "file:data/axiom.db"

[cache]
enabled = true
backend = "memory"
query_results_ttl = 60

[database.primary]
url = "postgres://user:pass@localhost:5432/mydb"
pool_max = 50

[api_key.admin_key]
secret = "super_secret_string"
full_admin = true
```

### Supported Databases

| Engine | URL Format | Notes |
|---|---|---|
| PostgreSQL | `postgres://...` | Supports `statement_cache_capacity` |
| MySQL | `mysql://...` | |
| SQL Server | `mssql://...` | Date/time types output as ISO 8601 strings |
| SQLite | `sqlite://...` | Local files or `:memory:` |
| LibSQL / Turso | `libsql://...` or `https://...` | Tuned with `PRAGMA journal_mode = WAL` |
| ClickHouse | `clickhouse://...` | Uses HTTP interface internally |

## Usage

Queries are executed via HTTP POST to `/api/v1/db/:alias/query`. The query body must contain a parameterized `sql` string and `params` array to prevent SQL injection.

**Basic Query (Common case)**
```bash
curl -X POST http://127.0.0.1:4500/api/v1/db/primary/query \
  -H "X-Axiom-Key: admin_key:super_secret_string" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT id, email FROM users WHERE status = ?",
    "params": ["active"]
  }'
```

**Idempotent Mutation (Advanced case)**
Use the `Idempotency-Key` header for safe retries on mutations.
```bash
curl -X POST http://127.0.0.1:4500/api/v1/db/primary/query \
  -H "X-Axiom-Key: admin_key:super_secret_string" \
  -H "Idempotency-Key: req-593a2-1" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "UPDATE accounts SET balance = balance - ? WHERE id = ?",
    "params": [100.50, 42]
  }'
```

## How It Works

Axiom intercepts incoming HTTP requests, validates API keys against an `ArcSwap` metadata snapshot (zero-lock hot path), parses the SQL using an AST cache to ensure no destructive operations bypass the Role-Based Access Control (RBAC), and routes the parameterized query to the requested upstream database pool.

```text
Request -> WAF -> Auth -> RBAC/AST Parser -> Result Cache -> DB Engine -> Response
```

## Project Structure

- `benches/` - Criterion performance benchmarks
- `crates/api/` - HTTP router, middlewares, AST parser, and cache logic
- `crates/cache/` - Unified L1/L2 cache engine
- `crates/cli/` - CLI interface
- `crates/core/` - Shared types, config, error handling
- `crates/db/` - Upstream database engine implementations
- `crates/metadata/` - Internal SQLite store for RBAC, keys, and audit logs
- `crates/policy/` - RBAC policy evaluation engine
- `crates/server/` - Tokio runtime setup and TCP socket tuning
- `tests/` - Integration tests

## API Surface & CLI

The CLI (`axiom.exe`) manages the gateway and internal metadata.

```text
server     Start the Axiom gateway daemon
user       Administrative user management
key        API machine key management
role       RBAC role and permission management
db         Upstream database connection management
cache      Cache engine inspection and management
audit      Query administrative audit logs
reload     Force dynamic reload of metadata snapshots
health     Check server health and status
metrics    Dump Prometheus exposition metrics
benchmark  Run built-in HTTP pipeline benchmark
doctor     Diagnose system environment
config     Configuration initialization and conversion
```

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `AUTH_INVALID_KEY` | Key missing or suspended due to brute force protection | Use correct key, or wait for the ban window to expire |
| `DB_CONNECTION_FAILED` | Upstream database is unreachable | Check DB URL in config, ensure firewall allows connection |
| `CIRCUIT_BREAKER_OPEN` | DB failed too many times, circuit tripped | Wait for circuit reset or fix upstream DB |
| `AUTH_SCOPE_DENIED` | API key lacks permission for the requested DB or table | Update `db_scope` or Role permissions via the CLI |
| `SERIALIZATION_FAILED` | DB returned an unrepresentable value | Ensure query doesn't select raw binary blobs |

## Contributing
- **Format:** `cargo fmt`
- **Lint:** `cargo clippy --workspace -- -D warnings`
- **Test:** `cargo test --workspace`
- **Benchmark:** `cargo bench`

## License
MIT

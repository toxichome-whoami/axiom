# Axiom

Axiom is a single-binary API gateway that sits between web applications and SQL databases to provide unified REST endpoints with AST-validated role-based access control.

## Status

Active development (v4.0.0). Production-ready for single-node deployments.

## Requirements

- Rust stable (1.75+)
- Cargo

## Quick start

```bash
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom
cp config.example.toml config.toml

# Edit config.toml to add your database and API key
cargo build --release
./target/release/axiom
```

To verify the server is running:

```bash
curl -X GET http://localhost:4500/health
```

## Configuration

Axiom loads configuration from `config.toml` at startup.

| Section | Key | Default | Effect |
|---|---|---|---|
| `[server]` | `host` | `127.0.0.1` | Network interface to bind. |
| `[server]` | `port` | `4500` | HTTP port. |
| `[server]` | `body_limit` | `"10 MB"` | Hard limit for HTTP request bodies. |
| `[logging]` | `level` | `"INFO"` | Log output level (DEBUG, INFO, WARN, ERROR). |
| `[cache]` | `backend` | `"memory"` | Result cache backend (`memory` or `turso`). |
| `[rate_limit]` | `max_requests` | `100` | Max requests per IP within the window. |
| `[database.alias]` | `url` | - | Upstream database URL (Postgres, MySQL, LibSQL, MSSQL, ClickHouse). |
| `[api_key.name]` | `secret` | - | Plaintext secret used for `X-Axiom-Key` auth. |

## Usage

Authenticate all requests using the `X-Axiom-Key` header with the format `key_name:secret`.

### Execute a read query

```bash
curl -X POST http://localhost:4500/api/v1/db/primary/query \
  -H "X-Axiom-Key: admin_key:super_secret_string" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT id, email FROM users WHERE status = ?",
    "params": ["active"]
  }'
```

### Idempotent mutation with timeout

```bash
curl -X POST http://localhost:4500/api/v1/db/primary/query \
  -H "X-Axiom-Key: admin_key:super_secret_string" \
  -H "Idempotency-Key: req-593a2-1" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "UPDATE accounts SET balance = balance - ? WHERE id = ?",
    "params": [100.50, 42],
    "timeout": 15
  }'
```

## How it works

Axiom intercepts HTTP requests, extracts the API key, and validates it against a zero-lock metadata snapshot. Queries are parsed into an Abstract Syntax Tree (AST). The AST is checked against the caller's Role-Based Access Control (RBAC) permissions to ensure they are allowed to perform the requested operations on the target tables. If approved, the parameterized query is routed to the configured upstream database pool and executed.

## Project structure

```text
crates/
  api/       # HTTP router, middleware, and request handlers
  cache/     # DashMap and SQLite/AOF cache engine
  cli/       # Command-line interface definitions
  core/      # Error types, configuration structs, and schemas
  db/        # Abstract database traits and engine implementations
  metadata/  # Internal SQLite store for RBAC, keys, and audit logs
  policy/    # RBAC evaluation and AST validation engine
  server/    # Tokio runtime and TCP listener setup
tests/       # Integration and security test suite
benches/     # Criterion performance benchmarks
ui/          # Embedded Vite+React admin interface
```

## API surface

Axiom exposes the following primary REST endpoints under `/api/v1/db/`:

- `GET /databases`
- `GET /:db_alias/tables`
- `GET /:db_alias/:table/schema`
- `POST /:db_alias/query` (Raw parameterized SQL execution)
- `GET /:db_alias/:table/rows` (Cursor-paginated reads)
- `POST /:db_alias/:table/rows` (Insert rows)
- `PATCH /:db_alias/:table/rows` (Update rows)
- `DELETE /:db_alias/:table/rows` (Delete rows)

## Troubleshooting

- **`DB_CONNECTION_FAILED`**: The upstream database is unreachable. Check your `config.toml` database URL and firewall rules.
- **`AUTH_SCOPE_DENIED`**: The API key lacks permission to access the requested database or table. Verify the role permissions or `db_scope` in your configuration.
- **`QUERY_TIMEOUT`**: The database query took longer than the request's specified timeout or the server's global request timeout.
- **`SQL_PARSE_ERROR`**: The SQL query failed AST parsing. Axiom requires valid SQL to enforce table-level permissions. Ensure your dialect syntax is correct.
- **`RATE_LIMIT_EXCEEDED`**: The IP or API key has made too many requests. Wait for the penalty cooldown window to expire.

## Contributing

Format, lint, and test before submitting patches:

```bash
cargo fmt
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

## License

MIT

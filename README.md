<div align="center">
  <h1>Axiom</h1>
  <p><em>An open-source, unified API gateway for databases and file storage with federated multi-server support, webhook event streaming, and with great security.</em></p>
</div>

<hr/>

## Philosophy

- **Ultra-lightweight**: Fast and efficient.
- **Universal Agnostic Target**: One language to speak to MySQL, SQLite, Postgres, and the FileSystem.
- **Secure By Default**: Strict WAF, rate limits, and path traversal blockades.

> [!NOTE]
> **Axiom is natively a REST API gateway.** The high-performance GraphQL layer is provided as an optional, secondary interface for clients who prefer GraphQL, but under the hood, the system is fundamentally optimized for REST-first operations.

## Features

- **Identity & Auth**: Fully isolated authentication engine powered by Ed25519 JWTs, Argon2id, Passkeys (WebAuthn), and dynamically scales from SQLite (Edge) to PostgreSQL (Cloud).
- **Map-Reduce Data Mesh**: Query multiple remote federated databases simultaneously and join their JSON results entirely in-memory.
- **Storage Circuit Breakers**: Automatically disconnects bandwidth-heavy streaming downloads when the server is overloaded.
- **Model Context Protocol (MCP)**: Seamlessly expose databases to AI tools via the standardized MCP JSON-RPC Server interface.
- Dynamic connection pooling to any SQL dialect using `sqlx` for type-safe, compile-time verified queries.
- Virtual file system proxy with built in zip-streaming and image resizing.
- Real-time webhook emissions based on regex-like operation subscriptions.
- Async HTTP streaming reverse-proxies for Federated edge nodes.
- High performance multi-tier rate limiting with DDoS protection and lock-free `AtomicU32` counters.
- Zero-contention configuration via `OnceLock<Arc<Config>>` — all worker threads read config with no locks.
- High-Performance GraphQL Layer for zero-serialization AST-to-SQL transpilation queries.

## Documentation

For comprehensive guides, API references, architecture overviews, and deployment instructions, please read the documentation in the [docs/](./docs/) directory of this repository.

## Quick Start

<details open>
<summary><b>View Quick Start Commands</b></summary>

<br>

1. `cargo build --release`
2. Run via: `./target/release/axiom` (or `axiom.exe` on Windows)
3. Check the auto-generated `config.toml` for your new Admin API Key.

**Or via Docker:**
```bash
docker compose up -d
```

> **Ports:** REST/HTTP on `:4500` · gRPC on `:4501`

</details>

## Example CURL

<details>
<summary><b>View API Examples</b></summary>

```bash
# Query Database
curl -X POST "http://localhost:4500/api/v1/db/main_db/query" \
     -H "Authorization: Bearer <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"sql": "SELECT id, name FROM users WHERE active = :status", "params": {"status": true}}'

# Storage Upload Setup
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "Authorization: Bearer <API_KEY>" \
     -d '{"action": "initiate", "filename": "test.png", "total_size": 10240, "path": "/foo/test.png", "checksum_sha256": "..."}'
```

</details>

## Examples and Demos

Axiom provides a comprehensive set of **Golang Demos** demonstrating how to interact with all platform modules natively via REST, Server-Sent Events, WebSockets, and Webhooks.

The examples are located in the `demos/` directory. 

### Usage Example
<details>
<summary><b>View Demo Execution</b></summary>

To run the unified Golang demo suite, simply use the Go CLI from within the `demos/` folder:

```bash
cd demos/
go run . [demo_name]
```

Available demos include:
- `auth`: Full authentication flow (login, token management, profile upgrades)
- `db_fetch` / `db_insert` / `db_drop`: Type-safe database queries
- `sse` / `websocket`: Real-time streaming and pub/sub
- `graphql` / `mcp`: Advanced interfaces

</details>

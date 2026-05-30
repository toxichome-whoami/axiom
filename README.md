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
- High performance multi-tier rate limiting with DDoS protection.
- Cache-Aside SQLite persistent state layer for sub-millisecond API Key and Ban validations.
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

## Universal SDK

Axiom includes a Universal Client SDK for interacting with all platform modules seamlessly. 

The SDKs are located in the `auth_sdks/` directory and are available in:
- **JavaScript** (`auth_sdks/js/`)
- **Rust** (`auth_sdks/rust/`)

### Usage Example
<details>
<summary><b>View API Examples</b></summary>

```javascript
import { Axiom } from "./sdks/javascript/index.js";

const axiom = new Axiom({ baseUrl: "http://localhost:4500", apiKey: "your_api_key" });

// Log in via Auth Module
await axiom.auth.login("admin@axiom.com", "password123");

// Interact with other Modules
await axiom.db.query("SELECT * FROM users");
await axiom.mcp.invoke("search", { query: "hello" });
```
</details>

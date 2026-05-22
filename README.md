<div align="center">
  <h1>Axiom</h1>
  <p><em>An open-source, industrial-grade, unified API gateway for databases and file storage with federated multi-server support, webhook event streaming, and military-grade security.</em></p>
</div>

<hr/>

## Philosophy

- **Ultra-lightweight**: Fast and efficient.
- **Universal Agnostic Target**: One language to speak to MySQL, SQLite, Postgres, and the FileSystem.
- **Secure By Default**: Strict WAF, rate limits, and path traversal blockades.

## Features

- **Map-Reduce Data Mesh**: Query multiple remote federated databases simultaneously and join their JSON results entirely in-memory.
- **Storage Circuit Breakers**: Automatically disconnects bandwidth-heavy streaming downloads when the server is overloaded.
- **Model Context Protocol (MCP)**: Seamlessly expose databases to AI tools via the standardized MCP JSON-RPC Server interface.
- Dynamic connection pooling to any SQL dialect using <code>sqlglot</code> for secure AST caching and verification.
- Virtual file system proxy with built in zip-streaming and image resizing.
- Real-time webhook emissions based on regex-like operation subscriptions.
- Async HTTP streaming reverse-proxies for Federated edge nodes.
- High performance multi-tier rate limiting with DDoS protection.
- Cache-Aside SQLite persistent state layer for sub-millisecond API Key and Ban validations.

## Documentation

For comprehensive guides, API references, architecture overviews, and deployment instructions, please read the documentation in the [docs/](./docs/) directory of this repository.

## Quick Start

<details open>
<summary><b>View Quick Start Commands</b></summary>

<br>

1. <code>pip install -r requirements.txt</code>
2. Run via: <code>python src/main.py</code>
3. Check the auto-generated <code>config.toml</code> for your new Admin API Key.

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

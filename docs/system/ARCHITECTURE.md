<div align="center">
  <h1>Axiom Architecture</h1>
  <p><em>High-performance, fully async gateway built on Axum, reqwest, and SQLx</em></p>
</div>

<hr/>

## Security Subsystem (Cache-Aside)

Axiom uses an embedded SQLite database (`data/security.db`) coupled with a lock-free `DashMap<String, AtomicU32>` rate-limit cache and a `DashMap` IP/key ban store. The global configuration is loaded once at startup into a `std::sync::OnceLock<Arc<AxiomConfig>>` — providing zero-contention, allocation-free reads from every concurrent worker thread with no lock acquisition overhead.

## The Pipeline

> **Performance Note:** All middleware operates at the raw Tower service protocol level for maximum efficiency, eliminating boxing overhead on every request.

Every incoming request flows through the following middleware sequence:

1. **SecurityHeadersMiddleware**: Injects HSTS, CSP, X-Content-Type-Options, Cache-Control, and X-Frame-Options headers. Header sets (API, docs, base) are **pre-computed as immutable tuples at import time** — zero allocation cost per response. Includes relaxed CSP for documentation endpoints (`/docs`, `/redoc`).

2. **RequestIDMiddleware**: Tags every request with a UUIDv7 timestamp-sorted ID for distributed tracing.

3. **WAFMiddleware**: Pre-filters oversized payloads, null-byte injections, and standard path traversal patterns before the router processes the request.

4. **LogMiddleware**: Attaches the request context to `tracing` for structured, parseable JSON logs.

5. **RateLimitMiddleware**: Enforces IP + API Key fixed-window rate limiting using a **lock-free `DashMap<String, AtomicU32>`** backend. Concurrent workers atomically increment counters without acquiring write locks. Config is pre-loaded once via `OnceLock` — lookups are eliminated from the hot path. The in-memory rate limit counter uses an **O(1) flat counter+expiry pattern** per IP, guaranteeing constant RAM usage regardless of request volume.

## Handlers

The pipeline converges at the Router, which dispatches to:

- **Database (`/api/v1/db`)**: Requests flow through the `QueryExecutionPipeline` and WAF. The DB layer employs an extreme **Zero-Copy JSON Streaming Cache**. Cache hits skip both SQL compilation and JSON memory allocation, streaming pre-rendered `bytes::Bytes` directly from the `DashMap` into the TCP socket. The parser only runs on cache misses or mutations.

- **Storage (`/api/v1/fs`)**: Directory listings use **Zero-Allocation Byte Caching**, mapping raw JSON strings straight into HTTP responses. Large file uploads via the `ChunkedUploadManager` use direct socket-to-disk 1MB streams leveraging native sparse-file offset allocation with on-the-fly threaded cryptographic hashing.

> **Global Memory Allocator:** Axiom replaces the default system allocator with **mimalloc** (developed by Microsoft Research). This significantly reduces memory fragmentation and increases concurrency throughput under heavy async `tokio` load.

- **GraphQL (`/api/v1/graphql`)** *(optional)*: An `ASTCompiler` walks the incoming parse tree and extracts SQL intent. The extracted SQL is dispatched directly into the same `QueryExecutionPipeline` used by the REST database endpoints, ensuring all WAF, blacklist, scope, and rate-limit rules apply identically. GraphQL is the secondary interface; REST is primary.

- **WebSocket (`/api/v1/ws`)** *(optional)*: Native Axum WebSocket endpoint. The `ConnectionManager` maintains an in-process `{client_id → Sender}` registry. The `EventBus` pushes to **Redis Streams** for cross-node event syncing in distributed deployments, and broadcasts to local subscribers via fire-and-forget channels.

- **SSE (`/api/v1/sse`)** *(optional)*: Server-Sent Events endpoint for one-way push notifications. Uses bounded ring-buffer backpressure (100 events/client) to prevent memory exhaustion from slow clients. Supports topic-based subscriptions mirroring the REST URL structure.

- **Auth (`/api/v1/auth`)**: Fully self-contained authentication engine built on `Ed25519` JWTs and `Argon2id` password hashing. Each API key gets its own isolated database (auto-generated at `data/auth/<api_key_name>/auth.db` for SQLite, or overridden by `db_url` for PostgreSQL horizontal scaling) containing users, refresh tokens, TOTP secrets, WebAuthn credentials, audit logs, and custom email templates. Enabled via `features.auth = true`. On startup, the lifespan initializes the Ed25519 key pair on a background thread. A background daemon (`cleanup_expired_anonymous_users`) continuously purges expired anonymous sessions. Auth flows emit events into the webhook engine. Advanced security features include brute-force protection (`BruteForceProtector`), new device IP alerts, RBAC via JWT custom claims, OAuth 2.0 social login (Google, GitHub), magic links, and FIDO2/WebAuthn passkey support.

- **Webhooks (`/api/v1/webhook`)**: Dual-backend persistence layer (SQLite or **Redis Streams**) with robust Dead-Letter Queues (DLQ) using `XPENDING` and `XCLAIM`. Background workers deliver webhooks asynchronously, protected by a dedicated circuit breaker to prevent cascading failures.

- **MCP (`/api/v1/mcp`)** *(optional)*: Model Context Protocol endpoint exposing database and storage tools to AI models (Claude, Gemini, etc.) via SSE transport. Requests are strictly governed by the API key's native permissions (`mode`, `db_scope`, `fs_scope`, rate limits). Enabled via `features.mcp = true`.

## Federation

Remote Axiom instances can be configured in `config.toml`. Through `/api/fed/*`, structurally identical requests mapped to `alias` are routed via `reqwest` streaming clients, bridging queries between geographically isolated servers. **Federation prefers gRPC (port `:4501`) for all inter-node traffic**, falling back to HTTP streaming proxy if gRPC is unavailable.

### HTTP Connection Pool Lifecycle

Federation proxy clients (`reqwest::Client`) are **attached to the global configuration / app state**. This ensures:
- Connection pools are cleanly initialized on first use and shared across all requests.
- Horizontal scaling is safe: each process/thread owns its isolated connection pool.

## Client SDKs

Axiom provides strictly typed, zero-configuration Client SDKs out of the box in the `sdk/` directory:

- **`axiom-js`**: TypeScript/JavaScript client built entirely on the native `fetch` API for maximum browser compatibility and zero bloat.
- **`axiom-py`**: Asynchronous Python client utilizing `httpx` to provide robust, concurrent networking for data science or backend worker environments.

Both SDKs handle authentication headers, configuration state, and JSON serialization automatically, providing an intuitive, identical API surface regardless of language environment.

## Automated Backup Engine (PITR)

The `BackupEngine` (`src/server/backup_engine.rs`) runs as a background Tokio task. When `backups.enabled = true`, it periodically:

1. Compresses the entire `data/` directory into a timestamped `.tar.gz` archive.
2. Streams the archive to any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) via the `aws-sdk-s3` crate.
3. Deletes the local archive after successful upload.

All I/O is dispatched to `tokio::task::spawn_blocking` to avoid blocking the async Tokio threadpool. The backup interval, bucket, region, and credentials are all configurable in `[backups]` in `config.toml`.

## Container Architecture (Docker)

The `Dockerfile` uses a **two-stage build** to produce the smallest, most secure possible image:

| Stage | Base Image | Purpose |
|---|---|---|
| **Builder** | `rust:1.78-slim-bookworm` | Compiles the full release binary with all optimizations |
| **Runtime** | `debian:bookworm-slim` | Runs the binary only — no compiler, no source code, no toolchain |

The final image contains:
- The `axiom` binary (~10–20 MB stripped)
- `libsqlite3` and `ca-certificates` runtime libs
- A non-root `axiom` user for security hardening

**Exposed ports:**
- `:4500` — HTTP/REST API (Axum)
- `:4501` — gRPC (Tonic + Protocol Buffers)

## Performance Characteristics

Axiom is designed for extreme concurrency and low latency:

- **Lock-free data structures**: `DashMap` and `AtomicU32` eliminate lock contention on the hot path.
- **Zero-copy streaming**: Pre-rendered JSON cache hits bypass serialization entirely.
- **Allocation-free config reads**: `OnceLock<Arc<T>>` provides wait-free configuration access.
- **Native async I/O**: Built on `tokio` for efficient multiplexing of thousands of concurrent connections.
- **Memory-efficient caching**: O(1) rate limit counters and bounded ring buffers prevent unbounded memory growth.
- **Optimized allocator**: `mimalloc` reduces fragmentation and improves multi-threaded performance.

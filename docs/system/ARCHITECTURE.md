<div align="center">
  <h1>Axiom Architecture</h1>
  <p><em>Aggressive, fully async gateway utilizing Axum, reqwest, and SQLx</em></p>
</div>

<hr/>

## Security Subsystem (Cache-Aside)
Axiom uses an embedded SQLite database (`data/security.db`) coupled with a lock-free `DashMap<String, AtomicU32>` rate-limit cache and a `DashMap` IP/key ban store. The global configuration is loaded once at startup into a `std::sync::OnceLock<Arc<AxiomConfig>>` — providing zero-contention, allocation-free reads from every concurrent worker thread with no lock acquisition overhead.

## The Pipeline

> **Performance Note:** All middleware operates at the raw Tower service protocol level for maximum performance. Eliminating any boxing overhead on every request.

Every incoming request flows through the following middleware sequence:
1. **SecurityHeadersMiddleware**: Injects HSTS, CSP, X-Content-Type, Cache-Control, and X-Frame-Options headers. Header sets (API, docs, base) are **pre-computed as immutable tuples at import time** — zero allocation cost per response. Includes relaxed CSP for documentation endpoints (`/docs`, `/redoc`).
2. **RequestIDMiddleware**: Tags every request with a UUIDv7 timestamp-sorted ID.
3. **WAFMiddleware**: Pre-filters oversized payloads, null-byte injections, and standard Path Traversal patterns before the router even sees the data.
4. **LogMiddleware**: Attaches the request context to `tracing` for structured, parseable JSON logs.
5. **RateLimitMiddleware**: An IP + API Key fixed-window cache enforcing max tokens. The cache backend uses a **lock-free `DashMap<String, AtomicU32>`** so concurrent workers atomically increment counters without acquiring a write lock. The config is pre-loaded once via `OnceLock` — config lookups are fully eliminated from the hot path. The in-memory rate limit counter uses an **O(1) flat counter+expiry pattern** per IP, guaranteeing constant RAM usage regardless of request volume.

## Handlers
The pipeline converges at the Router which redirects to:
- **Database (`/api/v1/db`)**: Requests are intercepted by the `QueryExecutionPipeline` and WAF. The DB layer employs an extreme **Zero-Copy JSON Streaming Cache**. A cache hit skips both SQL compilation and JSON memory allocation, streaming pre-rendered `bytes::Bytes` directly from the `DashMap` into the TCP socket. The parser strictly runs on cache misses or mutations.
- **Storage (`/api/v1/fs`)**: Directory listing uses **Zero-Allocation Byte Caching**, mapping raw JSON strings straight into HTTP responses. All large file uploads via the `ChunkedUploadManager` use direct socket-to-disk 1MB streams leveraging native sparse-file offset allocation with on-the-fly threaded cryptographic hashing.

> **Global Memory Allocator:** Axiom replaces the default system allocator with **mimalloc** (developed by Microsoft). This vastly reduces memory fragmentation and significantly increases concurrency throughput under heavy async `tokio` load.
- **GraphQL (`/api/v1/graphql`)** *(optional)*: An `ASTCompiler` walks the incoming parse tree and extracts SQL intent. The extracted SQL is dispatched directly into the same `QueryExecutionPipeline` used by the REST database endpoints, meaning all WAF, blacklist, scope, and rate-limit rules apply identically. This is the secondary interface; the REST API is the primary.
- **WebSocket (`/api/v1/ws`)** *(optional)*: A native Axum WebSocket endpoint. The `ConnectionManager` maintains an in-process `{client_id → Sender}` registry. The `EventBus` pushes natively to **Redis Streams** (EDA) allowing cross-node event syncing, and broadcasts to local subscribers via fire-and-forget side channel.
- **Auth (`/api/v1/auth`)**: A fully self-contained, isolated authentication engine built on `Ed25519` JWTs and `Argon2id`. Every API key gets its own isolated database (automatically generated at `data/auth/<api_key_name>/auth.db` for SQLite, or overridden by `db_url` for PostgreSQL horizontal scaling) containing its users, refresh tokens, TOTP secrets, WebAuthn credentials, audit logs, and custom email HTML templates. Enabled via `features.auth = true`. On startup, the lifespan initializes the Ed25519 key pair on a background thread. A background daemon (`cleanup_expired_anonymous_users`) continuously purges expired anonymous sessions. Auth flows emit events into the webhook engine. Advanced security features include brute-force protection (`BruteForceProtector`), new device IP alerts, RBAC via JWT custom claims, and FIDO2/WebAuthn passkey support.
- **Webhooks (`/api/v1/webhook`)**: Uses a dual-backend persistence layer (SQLite or **Redis Streams**) with robust Dead-Letter Queues (DLQ) using `XPENDING` and `XCLAIM`. Background workers deliver webhooks asynchronously, protected by a dedicated Circuit Breaker.

## Federation
Remote Axiom instances can be configured in `config.toml`. Through `/api/fed/*`, identical structural requests mapped to `alias` are routed via `reqwest` streaming clients, bridging queries between geographically isolated servers. **Federation prefers gRPC (port `:4501`) for all inter-node traffic**, falling back to HTTP streaming proxy if gRPC is unavailable.

### HTTP Connection Pool Lifecycle
Federation proxy clients (`reqwest::Client`) are **attached to the global configuration / app state**. This ensures:
- Connection pools are cleanly initialized on first use and shared across all requests.
- Horizontal scaling is safe: each process/thread owns its isolated connection pool.

## Distributed Tracing (OpenTelemetry)

Axiom integrates **OpenTelemetry** via `tracing-opentelemetry` — every route is automatically wrapped in a trace span. The `Tracing` subsystem extracts the active `trace_id` from the span context and injects it into every JSON log line. Traces are exported via OTLP/HTTP to `localhost:4318` (compatible with Jaeger, Datadog, Honeycomb). This allows full **flame graph debugging** of distributed request chains without any manual instrumentation.

## Automated Backup Engine (PITR)

The `BackupEngine` (`src/server/backup_engine.rs`) runs as a background Tokio task. When `backups.enabled = true`, it periodically:
1. Compresses the entire `data/` directory into a timestamped `.tar.gz` archive.
2. Streams the archive to any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) via the `aws-sdk-s3` crate.
3. Deletes the local archive after a successful upload.

All I/O is dispatched to avoid blocking the async Tokio threadpool. The backup interval, bucket, region, and credentials are all configurable in `[backups]` in `config.toml`.

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

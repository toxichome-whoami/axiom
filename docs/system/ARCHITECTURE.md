<div align="center">
  <h1>Axiom Architecture</h1>
  <p><em>Aggressive, fully async gateway utilizing FastAPI, httpx, and SQLGlot</em></p>
</div>

<hr/>

## Security Subsystem (Cache-Aside)
Axiom uses an embedded SQLite database (`data/security.db`) coupled with a native Python `dict` caching layer. This provides zero-latency (sub-nanosecond) authentication and ban evaluations without sacrificing disk-based persistence for dynamic API keys or circuit breaker thresholds.

## The Pipeline

> **Performance Note:** All middleware operates at the raw ASGI protocol level for maximum performance. No middleware uses Starlette's `BaseHTTPMiddleware`, eliminating threadpool overhead on every request.

Every incoming request flows through the following middleware sequence:
1. **SecurityHeadersMiddleware**: Injects HSTS, CSP, X-Content-Type, Cache-Control, and X-Frame-Options headers. Header sets (API, docs, base) are **pre-computed as immutable tuples at import time** — zero allocation cost per response. Includes relaxed CSP for documentation endpoints (`/docs`, `/redoc`).
2. **RequestIDMiddleware**: Tags every request with a UUIDv7 timestamp-sorted ID.
3. **WAFMiddleware**: Pre-filters oversized payloads, null-byte injections, and standard Path Traversal patterns before the router even sees the data.
4. **LogMiddleware**: Attaches the request context to `structlog` for structured, parseable JSON logs.
5. **RateLimitMiddleware**: An IP + API Key fixed-window cache enforcing max tokens. The cache backend class and all rate-limit config values (window, burst, penalty) are **resolved once at startup** and stored on the middleware instance — eliminating config lookups from the hot path. The in-memory rate limit counter uses an **O(1) flat counter+expiry pattern** per IP, guaranteeing constant RAM usage regardless of request volume.

## Handlers
The pipeline converges at the Router which redirects to:
- **Database (`/api/db`)**: Requests are intercepted by the `QueryExecutionPipeline` and `QueryValidator` classes. The `QueryValidator` employs a deterministic LRU cache to drastically reduce `sqlglot` AST parsing overhead. It walks the AST tree, validates user permissions against statement types, and transpiles syntax dynamically.
- **Storage (`/api/fs`)**: Executes zero-copy `aiofiles` streamed proxies and implements active `CircuitBreaker` integrations to block bandwidth saturation. All large file uploads via the `ChunkedUploadManager` use direct socket-to-disk 1MB streams (`write_chunk_stream`) leveraging native sparse-file offset allocation with on-the-fly threaded cryptographic hashing, rendering the gateway fully immune to Out-of-Memory (OOM) crashes during massive concurrent uploads.
- **GraphQL (`/api/v1/graphql`)** *(optional)*: An `ASTCompiler` walks the incoming `graphql-core` parse tree and extracts SQL intent — no Python resolver objects are instantiated. The extracted SQL is dispatched directly into the same `QueryExecutionPipeline` used by the REST database endpoints, meaning all WAF, blacklist, scope, and rate-limit rules apply identically. This is the secondary interface; the REST API is the primary.
- **WebSocket (`/api/v1/ws`)** *(optional)*: A Starlette-native WebSocket endpoint using zero additional dependencies. The `ConnectionManager` maintains an in-process `{client_id → WebSocket}` registry. The `EventBus` pushes natively to **Redis Streams** (EDA) allowing cross-node event syncing, and broadcasts to local subscribers via fire-and-forget side channel from `emit_event()`.
- **Auth (`/api/v1/auth`)**: A fully self-contained, isolated authentication engine built on `Ed25519` JWTs and `Argon2id`. Every API key gets its own configurable database (`db_url` in config — SQLite by default, PostgreSQL for horizontal scaling) containing its users, refresh tokens, TOTP secrets, WebAuthn credentials, audit logs, and custom email HTML templates. Enabled via `features.auth = true`. On startup, the lifespan initializes the Ed25519 key pair on a background thread. A background daemon (`cleanup_expired_anonymous_users`) continuously purges expired anonymous sessions. Auth flows emit events into the webhook engine. Advanced security features include brute-force protection (`BruteForceProtector`), new device IP alerts, RBAC via JWT custom claims, and FIDO2/WebAuthn passkey support.
- **Webhooks (`/api/v1/webhook`)**: Uses a dual-backend persistence layer (SQLite or **Redis Streams**) with robust Dead-Letter Queues (DLQ) using `XPENDING` and `XCLAIM`. Background workers deliver webhooks asynchronously, protected by a dedicated Circuit Breaker.

## Federation
Remote Axiom instances can be configured in `config.toml`. Through `/api/fed/*`, identical structural requests mapped to `alias` are routed via `StreamingResponse` HTTPX clients, bridging queries between geographically isolated servers seamlessly.

### HTTP Connection Pool Lifecycle
Federation proxy clients (`httpx.AsyncClient`) are **attached to `app.state.http_clients`** rather than a module-level global. This ensures:
- Connection pools are cleanly initialized on first use and shared across all requests.
- On server shutdown, the `lifespan` context manager iterates over all clients in `app.state.http_clients` and calls `aclose()` — preventing socket leaks on restart.
- Horizontal scaling is safe: each process owns its own isolated pool in its own ASGI app state.

## Distributed Tracing (OpenTelemetry)

Axiom integrates **OpenTelemetry** via `FastAPIInstrumentor` — every route is automatically wrapped in a trace span. The `LoggingMiddleware` extracts the active `trace_id` from the span context and injects it into every `structlog` JSON log line. Traces are exported via OTLP/HTTP to `localhost:4318` (compatible with Jaeger, Datadog, Honeycomb). This allows full **flame graph debugging** of distributed request chains without any manual instrumentation.

## Automated Backup Engine (PITR)

The `BackupEngine` (`src/server/backup_engine.py`) runs as a background daemon launched in the FastAPI lifespan. When `backups.enabled = true`, it periodically:
1. Compresses the entire `data/` directory into a timestamped `.tar.gz` archive using Python's `tarfile`.
2. Streams the archive to any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) via `boto3`.
3. Deletes the local archive after a successful upload.

All I/O is dispatched to a thread pool via `asyncio.to_thread` to keep the event loop non-blocking. The backup interval, bucket, region, and credentials are all configurable in `[backups]` in `config.toml`.

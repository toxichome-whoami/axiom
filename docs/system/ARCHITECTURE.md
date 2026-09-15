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

> **Global Memory Allocator:** Axiom replaces the default system allocator with **mimalloc** (developed by Microsoft). This vastly reduces memory fragmentation and significantly increases concurrency throughput under heavy async `tokio` load.

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

# Axiom Performance & Benchmark Report

This document provides empirical, reproducible performance benchmarks for the Axiom Database Access Gateway and Blob Engine. All metrics were captured using Criterion.rs micro-benchmarks located in `benches/benches/pipeline.rs`.

---

## 1. Test Environment

| Attribute | Specification |
|---|---|
| **CPU** | AMD Ryzen 7 5700X (8 Cores, 16 Logical Processors @ 3.4 GHz base / 4.6 GHz boost) |
| **Memory** | 32 GB DDR4 @ 3200 MT/s |
| **Operating System** | Microsoft Windows 11 Pro (x86_64) |
| **Rust Compiler** | `rustc 1.99.0 (b940084d7 2026-09-28)` |
| **Target Toolchain** | `x86_64-pc-windows-gnu` |
| **Allocator** | mimalloc (secure, thread-local freelist) |
| **Benchmark Framework** | [Criterion.rs 0.5](https://bheisler.github.io/criterion.rs/book/) (100 samples, 3.0s warmup per test) |

---

## 2. Reproducibility

To reproduce these benchmarks on your hardware:

```bash
# Compile benchmark binary without execution
cargo test -p axiom-benches --bench pipeline --no-run

# Run all benchmark suites
cargo bench -p axiom-benches --bench pipeline

# Or run individual sub-groups:
cargo test -p axiom-benches --bench pipeline -- --bench core
cargo test -p axiom-benches --bench pipeline -- --bench policy
cargo test -p axiom-benches --bench pipeline -- --bench cache
cargo test -p axiom-benches --bench pipeline -- --bench middleware
cargo test -p axiom-benches --bench pipeline -- --bench database
cargo test -p axiom-benches --bench pipeline -- --bench metadata
cargo test -p axiom-benches --bench pipeline -- --bench http_pipeline
cargo test -p axiom-benches --bench pipeline -- --bench blob
```

---

## 3. Benchmark Results Summary

### Group A: Core & Foundation

| Benchmark Function | Target | Measured Time (p50) | 95% Confidence Interval | Sample Iterations |
|---|---|---|---|---|
| `core/error_creation` | `< 100 ns` | **62.4 ns** | `[62.31 ns ... 62.54 ns]` | 80M iterations |
| `core/format_size` | `< 1 µs` | **467.8 ns** | `[445.26 ns ... 491.06 ns]` | 12M iterations |
| `core/parse_size_hostile` | `< 1 µs` | **578.3 ns** | `[545.59 ns ... 616.02 ns]` | 5.3M iterations |
| `core/config_manager_get` | `< 1 µs` | **688.6 ns** | `[681.44 ns ... 699.69 ns]` | 7.4M iterations |
| `core/parse_size_hot` | `< 2 µs` | **1.38 µs** | `[1.32 µs ... 1.45 µs]` | 5.9M iterations |

### Group B: RBAC Policy Engine

The Policy Engine evaluates incoming requests against caller permissions. Axiom stores roles in memory snapshots to ensure authorization never performs I/O on the hot path.

| Benchmark Function | Target | Measured Time (p50) | 95% Confidence Interval | Notes |
|---|---|---|---|---|
| `policy/wildcard_union_match` | `< 100 ns` | **38.9 ns** | `[38.88 ns ... 39.05 ns]` | Instant allow via `*` database & `*` table check |
| `policy/allow_single_exact_match` | `< 100 ns` | **56.0 ns** | `[54.66 ns ... 57.60 ns]` | Direct database, table, and operation match |
| `policy/deny_scan_10k_rules_fast_rejection` | `< 50 µs` | **12.1 µs** | `[12.07 µs ... 12.24 µs]` | Linear scan of 10,000 rules with pointer/len reject |
| `policy/deny_scan_10k_rules_worst_case` | `< 500 µs` | **282.1 µs** | `[281.22 µs ... 283.84 µs]` | Complete string scan across 10,000 identical rules |

### Group C: Cache & Rate Limiting Engine

Axiom uses a unified in-memory L1 cache (`DashMap` + LRU) and atomic token counters.

| Benchmark Function | Target | Measured Time (p50) | 95% Confidence Interval | Notes |
|---|---|---|---|---|
| `cache/l1_get_miss` | `< 100 ns` | **69.6 ns** | `[69.23 ns ... 69.95 ns]` | Immediate non-allocating cache miss return |
| `cache/check_rate_limit_contended` | `< 200 ns` | **88.5 ns** | `[88.39 ns ... 88.59 ns]` | Dual IP + Key window check & penalty calculation |
| `cache/l1_get_hot_hit` | `< 1 µs` | **123.9 ns** | `[123.60 ns ... 124.32 ns]` | L1 hot query cache hit (zero disk / DB access) |
| `cache/sweep_expired` | `< 1 µs` | **261.3 ns** | `[260.70 ns ... 262.06 ns]` | Min-heap TTL expiration cycle |
| `cache/l1_set_memory_only` | `< 1 µs` | **404.8 ns** | `[404.67 ns ... 404.94 ns]` | Memory-only entry insert and LRU queue update |

### Group D: Authentication & Middleware

Axiom validates the `X-Axiom-Key` header via constant-time BLAKE3 comparison against an immutable `ArcSwap` snapshot.

| Benchmark Function | Target | Measured Time (p50) | 95% Confidence Interval | Notes |
|---|---|---|---|---|
| `middleware/auth_snapshot_wrong_secret` | `< 1 µs` | **222.9 ns** | `[210.38 ns ... 235.90 ns]` | Constant-time mismatch rejection |
| `middleware/auth_snapshot_valid_hit` | `< 5 µs` | **555.8 ns** | `[555.08 ns ... 556.56 ns]` | Base64 decode, hash verification, role snapshot load |

### Group E: Database Dialects & AST Query Engine

SQL statements are validated and parsed into Abstract Syntax Trees using `sqlparser-rs` to eliminate SQL injection without regular expressions.

| Benchmark Function | Target | Measured Time (p50) | 95% Confidence Interval | Notes |
|---|---|---|---|---|
| `database/ast_cache_lookup_hot` | `< 200 ns` | **75.5 ns** | `[75.25 ns ... 75.92 ns]` | Pre-parsed AST metadata cache hit |
| `database/filter_build_simple` | `< 1 µs` | **638.9 ns** | `[617.69 ns ... 664.81 ns]` | Multi-field JSON filter to SQL parameterized clause |
| `database/filter_build_multi_clause` | `< 2 µs` | **936.6 ns** | `[931.75 ns ... 943.57 ns]` | 5-operator mixed filter (`$eq`, `$ne`, `$gt`, `$lte`, `$like`) |
| `database/ast_uncached_parse` | `< 20 µs` | **10.6 µs** | `[10.53 µs ... 10.74 µs]` | Cold SQL parse with dialect AST verification |
| `database/filter_build_in_500` | `< 50 µs` | **20.7 µs** | `[20.25 µs ... 21.27 µs]` | 500-element `$in` array placeholder generation |

### Group F: Zero-Lock Metadata Snapshots

Control plane updates publish immutable `ArcSwap` snapshots, ensuring the data plane performs zero lock synchronization.

| Benchmark Function | Target | Measured Time (p50) | 95% Confidence Interval | Notes |
|---|---|---|---|---|
| `metadata/snapshot_read_atomic` | `< 50 ns` | **12.6 ns** | `[12.61 ns ... 12.68 ns]` | Atomic pointer dereference in hot request path |
| `metadata/snapshot_publish_update` | `< 50 µs` | **25.2 µs** | `[25.16 ns ... 25.30 µs]` | Full snapshot atomic replacement across 100 roles |

### Group G: Axum HTTP Pipeline Latency

These benchmarks measure complete HTTP request/response latency through Axum router and middleware with hoisted runtime state.

| Endpoint / Scenario | Target Latency | Measured Latency (p50) | 95% Confidence Interval |
|---|---|---|---|
| `http_pipeline/get_ready_endpoint` | `< 50 µs` | **14.6 µs** (0.014 ms) | `[14.59 µs ... 14.70 µs]` |
| `http_pipeline/get_metrics_endpoint` | `< 50 µs` | **18.4 µs** (0.018 ms) | `[18.29 µs ... 18.48 µs]` |
| `http_pipeline/unauthorized_admin_rejection` | `< 50 µs` | **22.6 µs** (0.022 ms) | `[22.16 µs ... 23.21 µs]` |
| `http_pipeline/get_health_endpoint` | `< 50 µs` | **23.2 µs** (0.023 ms) | `[22.14 µs ... 24.39 µs]` |
| `http_pipeline/unauthorized_blob_rejection` | `< 50 µs` | **25.4 µs** (0.025 ms) | `[25.35 µs ... 25.48 µs]` |

### Group H: Content-Addressed Blob Storage & Capability Tickets

| Benchmark Function | Target | Measured Time (p50) | 95% Confidence Interval | Notes |
|---|---|---|---|---|
| `blob/key_and_namespace_validation` | `< 100 ns` | **44.0 ns** | `[43.76 ns ... 44.32 ns]` | Strict character and path safety checks |
| `blob/ticket_verification_valid` | `< 2 µs` | **586.1 ns** | `[583.36 ns ... 589.76 ns]` | HMAC-BLAKE3 capability ticket verification |
| `blob/ticket_generation` | `< 2 µs` | **745.0 ns** | `[714.46 ns ... 777.82 ns]` | Pre-signed capability ticket generation |
| `blob/blake3_chunk_hash_64kb` | `< 15 µs` | **10.88 µs** | `[10.82 µs ... 10.94 µs]` | Cryptographic content hashing of 64 KB chunk |

---

## 4. Architectural Comparison: Axiom vs Alternatives

| Metric / Feature | Axiom Gateway | FaucetDB | PostgREST | Hasura v2/v3 | Supabase |
|---|---|---|---|---|---|
| **Language & Runtime** | Native Rust (single binary) | Go | Haskell | Haskell / Go | Multi-container Docker |
| **Idle Memory (RSS)** | **< 10 MB** (Production) | ~ 35 MB | ~ 30 MB | > 150 MB | > 1.2 GB |
| **L1 Cache Retrieval** | **123.9 ns** (In-Memory LRU) | ~ 2.5 µs | N/A (External cache) | In-memory query plan | Redis container |
| **Auth Verification** | **555.8 ns** (ArcSwap + BLAKE3) | ~ 4.2 µs | JWT DB role switch | Webhook / JWT | GoTrue container |
| **SQL Injection Defense** | **Dialect AST Parsing** (75.5 ns hot / 10.6 µs cold) | Regex pattern matching | Schema reflection | GraphQL compiler | Database RLS policies |
| **Blob / Object Storage** | **Built-in** (BLAKE3 dedup + LSM) | None | None | None | MinIO / S3 daemon |
| **Pre-signed Tickets** | **Built-in** (586 ns verification) | None | None | None | S3 presigned URLs |
| **AI Agent Support** | **Built-in MCP Server** (`/mcp/v1`) | Built-in (`/mcp`) | None | None | None |
| **Embedded Admin UI** | **Built-in** (Vite + TS + Tailwind) | Embedded (Preact) | None | Web Console | Supabase Studio |
| **Supported SQL Engines** | **7 Engines**: PG, MySQL, MSSQL, LibSQL, ClickHouse, Snowflake, Oracle | 6 Engines: PG, MySQL, MSSQL, Oracle, Snowflake, SQLite | PG only | PG + Enterprise plugins | PG only |

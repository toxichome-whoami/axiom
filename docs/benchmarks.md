<div align="center">

# Axiom Benchmark & Performance Reference

### Empirical Micro-Benchmarks and Architectural Comparison

**Sub-Microsecond Hot Paths · Zero-Lock Snapshots · Constant-Time Auth**

[![Version](https://img.shields.io/badge/version-0.1.16%2B-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Criterion](https://img.shields.io/badge/criterion.rs-0.5-111827.svg?style=flat-square)](https://bheisler.github.io/criterion.rs/book/)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](../LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)

</div>

## Contents

1. [Test Environment](#1-test-environment)
2. [Reproducibility](#2-reproducibility)
3. [Performance Highlights](#3-performance-highlights)
4. [Detailed Micro-Benchmark Metrics](#4-detailed-micro-benchmark-metrics)
5. [Axum HTTP Pipeline Latency](#5-axum-http-pipeline-latency)
6. [Architectural Comparison](#6-architectural-comparison)

## 1. Test Environment

All micro-benchmarks are empirical and run using [Criterion.rs 0.5](https://bheisler.github.io/criterion.rs/book/) (100 samples, 3.0s warmup per scenario) in `benches/benches/pipeline.rs`.

| Component         | Specification                                                          |
| ----------------- | ---------------------------------------------------------------------- |
| **CPU**           | AMD Ryzen 7 5700X (8 Cores, 16 Threads @ 3.4 GHz base / 4.6 GHz boost) |
| **RAM**           | 32 GB DDR4 @ 3600 MT/s (Dual-Channel Slot A2/B2, XMP 2.0)              |
| **OS**            | Windows 11 Pro (x86_64)                                                |
| **Rust Compiler** | `rustc 1.99.0` (`x86_64-pc-windows-gnu`)                               |
| **Allocator**     | `mimalloc` (thread-local hardened freelist)                            |

## 2. Reproducibility

Run the full benchmark suite or targeted sub-groups:

```bash
# Run complete Criterion benchmark suite
cargo bench -p axiom-benches --bench pipeline

# Run specific subsystem benchmarks
cargo test -p axiom-benches --bench pipeline -- --bench core
cargo test -p axiom-benches --bench pipeline -- --bench policy
cargo test -p axiom-benches --bench pipeline -- --bench cache
cargo test -p axiom-benches --bench pipeline -- --bench middleware
cargo test -p axiom-benches --bench pipeline -- --bench database
cargo test -p axiom-benches --bench pipeline -- --bench metadata
cargo test -p axiom-benches --bench pipeline -- --bench http_pipeline
cargo test -p axiom-benches --bench pipeline -- --bench blob
```

## 3. Performance Highlights

Key hot-path latencies at a glance (p50):

| Critical Hot-Path Operation        | Measured Latency (p50) | Invariant Target | Description                                           |
| ---------------------------------- | ---------------------- | ---------------- | ----------------------------------------------------- |
| **Atomic Metadata Snapshot Read**  | **12.6 ns**            | `< 50 ns`        | Lock-free `ArcSwap` hot-path pointer dereference      |
| **RBAC Policy Wildcard Match**     | **38.9 ns**            | `< 100 ns`       | Immediate allow via `*` database / table rule         |
| **Blob Path & Key Validation**     | **44.0 ns**            | `< 100 ns`       | Strict UTF-8 and path traversal validation            |
| **L1 Cache Miss**                  | **53.8 ns**            | `< 100 ns`       | Zero-allocation miss return                           |
| **Hot AST Dialect Cache Hit**      | **65.7 ns**            | `< 200 ns`       | Pre-parsed AST metadata cache hit                     |
| **Rate Limiter Check (Contended)** | **77.7 ns**            | `< 200 ns`       | Dual IP + API key window check and penalty evaluation |
| **L1 Cache Hot Hit**               | **106.6 ns**           | `< 1 µs`         | In-memory RAM cache hit (zero disk / DB I/O)          |
| **API Key Authentication Hit**     | **529.5 ns**           | `< 5 µs`         | Base64 decode, BLAKE3 hash check, role resolution     |
| **Capability Ticket Verification** | **586.1 ns**           | `< 2 µs`         | Cryptographic HMAC-BLAKE3 verification                |
| **Full HTTP Request Pipeline**     | **13.4 µs** (0.013 ms) | `< 50 µs`        | Ready probe through Axum router and middleware        |

## 4. Detailed Micro-Benchmark Metrics

### 4.1 Core & Zero-Lock Metadata

Control plane updates publish immutable `ArcSwap` snapshots, ensuring the data plane performs zero lock synchronization.

| Benchmark                          | Target     | Measured (p50) | 95% Confidence Interval     | Notes                                          |
| ---------------------------------- | ---------- | -------------- | --------------------------- | ---------------------------------------------- |
| `metadata/snapshot_read_atomic`    | `< 50 ns`  | **12.6 ns**    | `[12.61 ns ... 12.68 ns]`   | Atomic pointer dereference in hot request path |
| `core/error_creation`              | `< 100 ns` | **62.4 ns**    | `[62.31 ns ... 62.54 ns]`   | Error payload construction                     |
| `core/format_size`                 | `< 1 µs`   | **467.8 ns**   | `[445.26 ns ... 491.06 ns]` | Human-readable byte formatting                 |
| `core/parse_size_hostile`          | `< 1 µs`   | **578.3 ns**   | `[545.59 ns ... 616.02 ns]` | Hostile size payload rejection                 |
| `core/config_manager_get`          | `< 1 µs`   | **688.6 ns**   | `[681.44 ns ... 699.69 ns]` | Global lock-free `Arc` config clone            |
| `core/parse_size_hot`              | `< 2 µs`   | **1.38 µs**    | `[1.32 µs ... 1.45 µs]`     | Parsing size strings (`"5gb"`, `"64kb"`)       |
| `metadata/snapshot_publish_update` | `< 50 µs`  | **25.2 µs**    | `[25.16 µs ... 25.30 µs]`   | Full snapshot replacement across 100 roles     |

### 4.2 RBAC Policy Engine

Roles and access grants are evaluated strictly from memory snapshots without database I/O.

| Benchmark                          | Target     | Measured (p50) | 95% Confidence Interval     | Notes                                                       |
| ---------------------------------- | ---------- | -------------- | --------------------------- | ----------------------------------------------------------- |
| `policy/wildcard_union_match`      | `< 100 ns` | **38.9 ns**    | `[38.88 ns ... 39.05 ns]`   | Instant allow via `*` database & `*` table check            |
| `policy/allow_single_exact_match`  | `< 100 ns` | **56.0 ns**    | `[54.66 ns ... 57.60 ns]`   | Direct database, table, and operation match                 |
| `policy/deny_scan_10k_rules_fast`  | `< 50 µs`  | **10.3 µs**    | `[10.25 µs ... 10.39 µs]`   | Linear scan of 10,000 rules with fast pointer/length reject |
| `policy/deny_scan_10k_rules_worst` | `< 500 µs` | **341.1 µs**   | `[327.36 µs ... 356.68 µs]` | Full string comparison across 10,000 identical rules        |

### 4.3 Cache & Rate Limiting

Unified in-memory L1 cache (`DashMap` + LRU) and atomic token counters.

| Benchmark                          | Target     | Measured (p50) | 95% Confidence Interval     | Notes                                            |
| ---------------------------------- | ---------- | -------------- | --------------------------- | ------------------------------------------------ |
| `cache/l1_get_miss`                | `< 100 ns` | **53.8 ns**    | `[53.05 ns ... 54.66 ns]`   | Immediate non-allocating cache miss return       |
| `cache/check_rate_limit_contended` | `< 200 ns` | **77.7 ns**    | `[77.14 ns ... 78.72 ns]`   | Dual IP + Key window check & penalty calculation |
| `cache/l1_get_hot_hit`             | `< 1 µs`   | **106.6 ns**   | `[105.39 ns ... 108.10 ns]` | Hot query cache hit (zero disk / DB access)      |
| `cache/sweep_expired`              | `< 1 µs`   | **250.4 ns**   | `[248.79 ns ... 252.40 ns]` | Min-heap TTL expiration cycle                    |
| `cache/l1_set_memory_only`         | `< 1 µs`   | **418.5 ns**   | `[410.26 ns ... 428.78 ns]` | Memory-only entry insert and LRU queue update    |

### 4.4 Authentication & AST Query Engine

SQL statements are validated and parsed into Abstract Syntax Trees using `sqlparser-rs` to eliminate SQL injection without regular expressions.

| Benchmark                               | Target     | Measured (p50) | 95% Confidence Interval     | Notes                                                          |
| --------------------------------------- | ---------- | -------------- | --------------------------- | -------------------------------------------------------------- |
| `database/ast_cache_lookup_hot`         | `< 200 ns` | **65.7 ns**    | `[64.99 ns ... 66.62 ns]`   | Pre-parsed AST metadata cache hit                              |
| `middleware/auth_snapshot_wrong_secret` | `< 1 µs`   | **204.1 ns**   | `[194.37 ns ... 214.44 ns]` | Constant-time mismatch rejection                               |
| `middleware/auth_snapshot_valid_hit`    | `< 5 µs`   | **529.5 ns**   | `[528.99 ns ... 530.22 ns]` | Base64 decode, hash verification, role snapshot load           |
| `database/filter_build_simple`          | `< 1 µs`   | **638.9 ns**   | `[617.69 ns ... 664.81 ns]` | Multi-field JSON filter to SQL parameterized clause            |
| `database/filter_build_multi_clause`    | `< 2 µs`   | **936.6 ns**   | `[931.75 ns ... 943.57 ns]` | 5-operator mixed filter (`$eq`, `$ne`, `$gt`, `$lte`, `$like`) |
| `database/ast_uncached_parse`           | `< 20 µs`  | **9.10 µs**    | `[9.02 µs ... 9.20 µs]`     | Cold SQL parse with dialect AST verification                   |
| `database/filter_build_in_500`          | `< 50 µs`  | **20.7 µs**    | `[20.25 µs ... 21.27 µs]`   | 500-element `$in` array placeholder generation                 |

### 4.5 Content-Addressed Blob Storage

| Benchmark                           | Target     | Measured (p50) | 95% Confidence Interval     | Notes                                        |
| ----------------------------------- | ---------- | -------------- | --------------------------- | -------------------------------------------- |
| `blob/key_and_namespace_validation` | `< 100 ns` | **44.0 ns**    | `[43.76 ns ... 44.32 ns]`   | Character and path traversal safety checks   |
| `blob/ticket_verification_valid`    | `< 2 µs`   | **586.1 ns**   | `[583.36 ns ... 589.76 ns]` | HMAC-BLAKE3 capability ticket verification   |
| `blob/ticket_generation`            | `< 2 µs`   | **745.0 ns**   | `[714.46 ns ... 777.82 ns]` | Pre-signed capability ticket generation      |
| `blob/blake3_chunk_hash_64kb`       | `< 15 µs`  | **10.88 µs**   | `[10.82 µs ... 10.94 µs]`   | Cryptographic content hashing of 64 KB chunk |

## 5. Axum HTTP Pipeline Latency

End-to-end request/response latency through the Axum router, WAF, authentication, and hoisted runtime state:

| Endpoint / Scenario                          | Target Latency | Measured Latency (p50) | 95% Confidence Interval   |
| -------------------------------------------- | -------------- | ---------------------- | ------------------------- |
| `http_pipeline/get_ready_endpoint`           | `< 50 µs`      | **13.4 µs** (0.013 ms) | `[13.32 µs ... 13.43 µs]` |
| `http_pipeline/get_metrics_endpoint`         | `< 50 µs`      | **16.2 µs** (0.016 ms) | `[16.17 µs ... 16.24 µs]` |
| `http_pipeline/get_health_endpoint`          | `< 50 µs`      | **18.0 µs** (0.018 ms) | `[17.78 µs ... 18.31 µs]` |
| `http_pipeline/unauthorized_admin_rejection` | `< 50 µs`      | **19.7 µs** (0.020 ms) | `[19.46 µs ... 20.01 µs]` |
| `http_pipeline/unauthorized_blob_rejection`  | `< 50 µs`      | **22.5 µs** (0.023 ms) | `[21.87 µs ... 23.38 µs]` |

## 6. Architectural Comparison

| Dimension                 | Axiom Gateway                                                           | FaucetDB          | PostgREST            | Hasura v2/v3         | Supabase               |
| ------------------------- | ----------------------------------------------------------------------- | ----------------- | -------------------- | -------------------- | ---------------------- |
| **Language & Runtime**    | **Native Rust (single binary)**                                         | Go                | Haskell              | Haskell / Go         | Multi-container Docker |
| **Idle Memory (RSS)**     | **~21 MB** (all engines active)                                         | ~35 MB            | ~30 MB               | > 150 MB             | > 1.2 GB               |
| **L1 Cache Retrieval**    | **106.6 ns** (In-Memory LRU)                                            | ~2.5 µs           | N/A (External cache) | In-memory query plan | External Redis         |
| **Auth Verification**     | **529.5 ns** (ArcSwap + BLAKE3)                                         | ~4.2 µs           | JWT DB role switch   | Webhook / JWT        | GoTrue container       |
| **SQL Safety Defense**    | **Dialect AST Parsing** (65.7 ns)                                       | Regex matching    | Schema reflection    | GraphQL compiler     | Database RLS           |
| **Blob / Object Storage** | **Built-in** (BLAKE3 dedup + LSM)                                       | None              | None                 | None                 | MinIO / S3 daemon      |
| **Pre-Signed Tickets**    | **Built-in** (586 ns verification)                                      | None              | None                 | None                 | S3 presigned URLs      |
| **AI Agent Support**      | **Built-in MCP Server** (`/mcp/v1`)                                     | Built-in (`/mcp`) | None                 | None                 | None                   |
| **Embedded Admin UI**     | **Built-in** (Vite + TS + Tailwind)                                     | Embedded (Preact) | None                 | Web Console          | Supabase Studio        |
| **Supported SQL Engines** | **7 Engines** (PG, MySQL, MSSQL, LibSQL, ClickHouse, Snowflake, Oracle) | 6 Engines         | Postgres only        | Postgres + plugins   | Postgres only          |

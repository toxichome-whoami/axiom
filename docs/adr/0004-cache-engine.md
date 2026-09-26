# ADR 0004: Cache Engine Architecture

Status: Accepted
Date: 2026-09-27

## Problem
v3.0 has three disconnected cache stores:
- Rate-limit counters: DashMap in middleware/cache.rs
- Query result cache: DashMap static in handlers.rs
- Turso persistent cache: TursoCache in middleware/cache.rs

No shared eviction policy, no observability, no LRU — the query cache evicts an arbitrary key when full.

## Options Considered
- A: Use Redis as external cache.
- B: Keep ad-hoc DashMap caches but fix eviction.
- C: Build a unified CacheEngine with L1 (DashMap) + L2 (optional AOF SQLite).

## Decision
Option C. A single `CacheEngine` struct in `src/cache/` handles all cache operations.

## Why
- Redis adds an external process dependency, breaking the single-binary deployment model.
- A unified engine enables shared observability (hit rate, eviction rate, memory used).
- L2 AOF gives persistence without Redis complexity.
- L1 DashMap provides sub-microsecond access on the hot path.

## Performance Requirement
Before any documentation claims about cache speed, run bench_cache.go and compare against equivalent Redis (memory-only, allkeys-lru). Document hardware, OS, dataset, workload, and methodology.

## Consequences
- Phase 5 implements this engine.
- Existing DashMap caches in middleware/cache.rs are replaced.
- Rate limit, query cache, and idempotency all route through the new engine.

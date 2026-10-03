# Request Pipeline Architecture

---

## v4.0 Pipeline

Every inbound HTTP request passes through the following stack. Axum applies middleware in reverse registration order — `waf_middleware` is registered last in `create_app()` and therefore executes first.

```
TCP Accept (socket2 TCP_NODELAY + SO_REUSEADDR)
  │
  ▼
DefaultBodyLimit (10 MB hard cap — kernel-level, before waf_middleware body check)
  │
  ▼
SetRequestIdLayer (X-Request-ID UUID v4 injected)
  │
  ▼
WAF (waf.rs)
  Checks: URI length, null bytes, query flood, body size, path traversal (3× decode), SQL keywords in URL
  │
  ▼
Rate Limiter + Ban List (rate_limit.rs)
  IP resolution: TCP peer → X-Forwarded-For only if peer ∈ trusted_proxies
  Buckets: per-IP (DashMap atomic) + per-key (separate bucket)
  Auto-ban: BanList::ban_ip() after 5 auth failures or penalty_threshold rate violations
  │
  ▼
Auth Middleware (auth.rs)
  Header: X-Axiom-Key, X-Api-Key, Authorization Bearer
  Lookup: ArcSwap<MetadataSnapshot> → zero DB calls
  Verify: BLAKE3(secret) vs stored hash via 32-byte XOR accumulator (constant-time)
  Fallback: config.toml [api_key.*] entries
  Injects: AuthContext extension into request
  │
  ▼
Axum Route Handler
  │
  ├─ PolicyEngine::evaluate(auth, database, table, operation)
  │    Denies by default. Checks admin session → RBAC permissions → legacy db_scope/mode.
  │
  ├─ QueryExecutionPipeline::run_query (database/query endpoints)
  │    1. Circuit breaker check (CIRCUIT_FAILURES DashMap per alias)
  │    2. Engine acquire from DatabasePoolManager
  │    3. Mutation heuristic regex (MUTATION_RE)
  │    4. Cache key compute (SHA-256 over alias+sql+params)
  │    5. AST cache lookup → if hit: PolicyEngine::evaluate, skip parse
  │       AST cache miss → sqlparser parse, PolicyEngine::evaluate, cache AST
  │    6. Blacklist check (query_blacklist from db config)
  │    7. Result cache lookup (DashMap) — AFTER RBAC
  │    8. DB engine execute (parameterized)
  │    9. Circuit breaker reset on success / increment on failure
  │    10. Result cache store
  │
  └─ Response
       JSON envelope + security headers
```

---

## Security Headers (every response)

Applied via `SetResponseHeaderLayer` (overriding or if-not-present):

| Header | Value |
|--------|-------|
| `X-Request-ID` | UUID v4, unique per request |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none';` (if-not-present — Web UI handler overrides) |

---

## Crate Dependency Graph

```
axiom (server binary)
  ├── axiom-api
  │     ├── axiom-core      (AxiomError, ConfigManager, AuthContext, size_parser)
  │     ├── axiom-metadata  (MetadataStore, ArcSwap snapshot, audit log)
  │     ├── axiom-policy    (PolicyEngine::evaluate)
  │     ├── axiom-cache     (CacheEngine L1+L2)
  │     └── axiom-db        (DatabasePoolManager, 5 engines)
  └── axiom-cli
        └── axiom-core
```

No circular dependencies. `axiom-db` does not depend on `axiom-api` or `axiom-cache`.

---

## Database Engine Routing

URL prefix → engine selection in `DatabasePoolManager::get_engine`:

| URL Prefix | Engine | Driver |
|-----------|--------|--------|
| `postgres://`, `postgresql://` | `PostgresDatabaseEngine` | sqlx |
| `mysql://`, `mariadb://` | `MysqlDatabaseEngine` | sqlx |
| `mssql://`, `sqlserver://` | `MssqlDatabaseEngine` | tiberius (URL translated to `jdbc:sqlserver://` internally) |
| `sqlite://`, `libsql://` | `LibsqlDatabaseEngine` | libsql |
| `clickhouse://`, `clickhouse+https://` | `ClickHouseDatabaseEngine` | reqwest HTTP |

All engines implement the `DatabaseEngine` trait: `connect`, `disconnect`, `health_check`, `list_tables`, `count_tables`, `describe_table`, `get_foreign_keys`, `execute`, `dialect`.

---

## Metadata Snapshot Refresh

```
Background daemon (lifespan.rs)
  Every reload_interval seconds:
    MetadataStore::load_snapshot() → reads axiom.db
    ArcSwap::store(Arc::new(snapshot))

Hot path (auth.rs, rate_limit.rs, router.rs):
  ArcSwap::load() → Arc clone (no locks, no DB calls)
```

Force refresh: `POST /admin/v1/reload` or `axiom reload` CLI.

---

## Cache Architecture

Three use-cases share a single `CacheEngine`:

| Use-case | Key prefix | TTL source |
|----------|-----------|------------|
| SQL result cache | `q:` | `cache.query_results_ttl` |
| Idempotency responses | `idemp:` | `cache.idempotency_ttl` |
| Rate limit counters | `rl:ip:`, `rl:key:` | `rate_limit.window` |

L1: `DashMap<String, (Bytes, Instant)>` with background TTL sweep using a `BinaryHeap`.
L2: Optional SQLite AOF via libsql (when `cache.backend = "hybrid"` or `"turso"`).

AST cache is separate: `once_cell::Lazy<DashMap<String, CachedAstInfo>>` bounded at `performance.query_cache_size` entries with arbitrary eviction on overflow.

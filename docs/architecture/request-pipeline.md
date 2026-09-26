# Request Pipeline Architecture

## v3.0.1 Pipeline

Every inbound HTTP request passes through the following stack in order (Axum applies middleware in reverse — WAF fires first):

```mermaid
flowchart TD
    A["TCP Accept"] --> B["Axum Router"]
    B --> C["WAF Middleware\nsrc/middleware/waf.rs\nURI length check, null-byte, path traversal (3x decode), body size"]
    C --> D["Rate Limit Middleware\nsrc/middleware/rate_limit.rs\nIP extraction, fixed-window counter, penalty/ban logic"]
    D --> E["Auth Middleware\nsrc/middleware/auth.rs\nX-Axiom-Key extraction, base64 decode, XOR constant-time compare"]
    E --> F["Route Handler\nsrc/api/database/handlers.rs"]
    F --> G["QueryExecutionPipeline\nCircuit breaker, blacklist, cache, AST validation, timeout"]
    G --> H["DatabasePoolManager\nLazy init, INIT_LOCK, ENGINES DashMap"]
    H --> I["DB Engine\nsqlx / tiberius / libsql / reqwest"]
    I --> J["Response\nJSON + security headers + X-Request-ID"]
```

## Security Headers (every response)

| Header | Value |
|--------|-------|
| `X-Request-ID` | UUID v4 per request |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none';` |

## Known Issues (v3.0.1)

See [AXIOM_MASTER_PLAN.md](../AXIOM_MASTER_PLAN.md) Section 3 for the full list of architectural debt being addressed in v4.0.

## Target Architecture (v4.0)

See [AXIOM_MASTER_PLAN.md](../AXIOM_MASTER_PLAN.md) Section 5.

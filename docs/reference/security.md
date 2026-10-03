# Security Reference

---

## Request Pipeline

Every inbound HTTP request passes through this stack in order. Axum applies middleware in reverse registration order — WAF is registered last and fires first.

```
TCP Accept
  → WAF (waf.rs)
  → Rate Limiter + Ban List (rate_limit.rs)
  → Auth Middleware (auth.rs)
  → Route Handler
      → PolicyEngine::evaluate (RBAC)
      → AST Firewall (sqlparser)
      → Circuit Breaker
      → DB Engine (parameterized execution)
```

---

## Authentication

**Header:** `X-Axiom-Key: base64(name:secret)` (also accepted: `X-Api-Key`, `Authorization: Bearer <same>`)

**Verification steps:**
1. Base64-decode the header value
2. Split on first `:` → `name` and `secret`
3. Check `name` against `BanList` (auto-banned IPs are pre-blocked by rate limiter, but key names can also be banned)
4. Look up the key record in the `ArcSwap<MetadataSnapshot>` — zero database calls on the hot path
5. Compute `BLAKE3(secret)` and compare to the stored hash via a 32-byte XOR accumulator (no early exit — constant-length comparison regardless of where bytes differ)
6. Fall back to `config.toml [api_key.*]` entries for backward compatibility

Session tokens (Web UI) are 32-character random strings validated via `MetadataStore::validate_session`.

---

## RBAC

`PolicyEngine::evaluate(auth, database, table, operation)` is the single authorization checkpoint.

**Priority order:**
1. `full_admin = true` → bypass all checks
2. `auth.permissions` non-empty → evaluate granular RBAC rules
3. Fallback → evaluate legacy `db_scope` and `mode` (readonly / writeonly / readwrite)

Granular RBAC rule: a permission grants `operations` (any of `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `*`) on a `(database, table)` pair. Both fields support `"*"` as wildcard.

Permissions are loaded from `ArcSwap<MetadataSnapshot>` — no database calls per request. Snapshot refreshes every `reload_interval` seconds. **Permission revocations take effect on the next snapshot refresh** (max 30 seconds delay by default), but **cache hits do not bypass RBAC** — the result cache lookup runs after `PolicyEngine::evaluate`.

---

## AST Firewall

Every SQL query is parsed by `sqlparser` before execution. Parser is chosen by dialect based on the DB engine's `dialect()` return value.

Blocked by default:
- DDL statements (`CREATE`, `DROP`, `ALTER`, `TRUNCATE`) unless `dangerous_operations: true` in the database config
- `GRANT`, `REVOKE`, `SET`, `REPLACE` classified as mutations and blocked on read-only keys
- Multiple statements in a single `sql` field (multi-statement injection detection)
- Queries matching `query_blacklist` patterns in the database config

The AST cache stores parsed AST metadata keyed on `(alias, sql, params_hash)`. Cache key computation uses SHA-256 over the normalized SQL. The AST result is cached but RBAC evaluation runs on every request — cache hits do not shortcut policy.

---

## WAF

`waf_middleware` is the outermost layer. Checks run before route matching.

| Check | Limit | Error |
|-------|-------|-------|
| URI length | 2048 chars | 414 `WAF_URI_TOO_LONG` |
| Null byte in URI | `%00` or `\0` | 400 `WAF_NULL_BYTE` |
| Query parameter count | > 50 `&` separators | 400 `WAF_TOO_MANY_PARAMS` |
| Content-Length | > `server.body_limit` | 413 `WAF_BODY_TOO_LARGE` |
| Path traversal | `..` after up to 3× URL decode | 400 `WAF_PATH_TRAVERSAL` |
| SQL keywords in URL | `select `, `drop `, `union `, `delete `, `insert ` | 400 `WAF_SQL_INJECTION` |

Path traversal detection decodes the URL up to three times to defeat double and triple encoding (`%252e%252e`, `%25252e%25252e`).

Fast path: clean requests that contain none of `%`, `.`, or `..` skip the decode loop entirely.

---

## Rate Limiting and Brute Force

Rate limits are evaluated per-IP and per-API-key independently. Both must pass.

**IP resolution:** TCP peer address is the authoritative source. `X-Forwarded-For` is only trusted if the TCP peer is in `server.trusted_proxies`. Using `trusted_proxies = ["*"]` logs a security warning and allows IP spoofing.

**Auto-ban:** After `rate_limit.penalty_threshold` violations, the IP is added to `BanList` for `penalty_cooldown` seconds. Subsequent requests return `403 BANNED` immediately, before auth processing.

**Distributed brute force (S2):** Rate limits apply to the API key name as well as source IP. An attacker rotating IPs still hits the per-key throttle.

**Auth brute force:** 5 consecutive authentication failures from the same IP trigger an automatic ban independent of the rate limit window.

---

## Security Headers

Applied to every response via `SetResponseHeaderLayer`:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none';` (overridable by inner handlers) |
| `X-Request-ID` | UUID v4 per request |

HSTS is sent even over plain HTTP. A reverse proxy handling HTTPS termination will pass it through correctly.

---

## Secrets at Rest

- API key secrets are stored as `BLAKE3(secret)` — raw secrets are never persisted
- Admin user passwords are stored as `Argon2id` hashes
- No secrets appear in log output (DB errors are sanitized before client responses)
- `config.toml` legacy `secret` fields are one-way hashed into `axiom.db` on first boot

---

## SQL Injection Prevention

- Parameterized queries throughout: all DB engines bind parameters using driver-native binding (never string interpolation)
- Table and column names from API requests are passed through `sanitize_ident()` — only alphanumeric, `_`, and `.` characters are permitted; everything else is rejected
- Cursor values are parameterized (`WHERE col > ?`), not interpolated
- Filter builder generates parameterized WHERE clauses — operator allow-listing prevents unknown operators from reaching SQL

---

## Deployment Hardening

- Bind to `127.0.0.1` (default) and place behind a reverse proxy (Caddy, Nginx, Cloudflare) for HTTPS termination
- Do not expose port `4500` directly on a public interface without HTTPS
- Set `cors_origins` to explicit origins in production (`cors_origins = ["https://app.example.com"]`)
- Set `trusted_proxies` to your proxy's IP, not `"*"`
- `axiom.db` and `config.toml` contain credentials — restrict file permissions (`chmod 600`)
- The `.htaccess` file in the repo blocks Apache from serving `.toml`, `.db`, `.log`, and binary files if the Rust process is not running

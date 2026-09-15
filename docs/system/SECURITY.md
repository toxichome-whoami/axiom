<div align="center">
  <h1>Axiom Security Model</h1>
  <p><em>Security-First philosophy engineered to withstand industrial-grade API attack vectors</em></p>
</div>

<hr/>

## 1. Zero-Trust Internal Architecture

- **Scope-Based Access**: Every API key is restricted by `mode` (readonly, writeonly, readwrite), and `db_scope` (permitted database aliases).
- **Mode Intersection**: Permissions are calculated by taking the intersection of the API key's mode and the database's configured mode.

## 3. Dynamic Secret Storage (Cache-Aside Pattern)

- **Persistent Security State**: Security states, including legacy dynamic keys and manual bans, are stored in a persistent SQLite database (`data/security.db`).
- **Hashed Secrets**: Any dynamic API Key secrets are never stored in plaintext inside the database. They are hashed using SHA-256 before storage. Even if the database file is exfiltrated, the raw secrets cannot be recovered.
- **Ultra-Low Latency Caching**: To prevent database disk-I/O from creating a bottleneck during DDoS attacks, the SQLite database state is synchronized into a nanosecond-latency RAM cache. Authentication and ban checks occur strictly in memory.


## 4. Attack Protections

<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #2d2d2d; color: white;">
    <th style="padding: 10px; text-align: left;">Threat</th>
    <th style="padding: 10px; text-align: left;">Protection Mechanism</th>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>SQL Injection</b></td>
    <td style="padding: 10px;">Mandatory use of parameterized queries natively mapped to the database driver (e.g. <code>sqlx::query().bind()</code>). String interpolation is strictly prohibited in the data layer, making SQL injection impossible.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Path Traversal</b></td>
    <td style="padding: 10px;">Comprehensive <code>../</code> and null-byte filtering in the <code>WAFMiddleware</code>. All file paths are canonicalized and jailed within the storage volume root.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Brute Force</b></td>
    <td style="padding: 10px;">Multi-tier fixed-window rate limiting (Global, Per-Key, Per-IP) with a penalty cooldown that bans repeated violators. The in-memory backend uses an <b>O(1) flat counter+expiry pattern per IP</b> — RAM usage is constant regardless of attack volume.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Timing Attacks</b></td>
    <td style="padding: 10px;">All secret comparisons use <code>ring::constant_time::verify_slices_are_equal</code> or equivalent constant-time operations.</td>
  </tr>
    <td style="padding: 10px;"><b>MIME Sniffing</b></td>
    <td style="padding: 10px;">All responses include <code>X-Content-Type-Options: nosniff</code>.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>XSS</b></td>
    <td style="padding: 10px;">Strict <code>application/json</code> content-type enforcement and WAF-based input sanitization.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Clickjacking</b></td>
    <td style="padding: 10px;"><code>X-Frame-Options: DENY</code> is added to all responses by the unified <code>SecurityHeadersMiddleware</code>.</td>
  </tr>
</table>

## 6. Web Application Firewall (WAF)

Axiom includes an embedded WAF layer (`src/middleware/waf.rs`) that executes before any business logic.

- **Request Size Limiting**: Rejects requests that exceed `server.body_limit`.
- **Content-Type Enforcement**: Rejects unexpected content types (e.g., enforces JSON for API calls).
- **Input Sanitization**: Automatically removes null bytes and suspicious Unicode character sequences.
- **Pattern Matching**: Blocks requests containing common exploit strings in URLs and headers.

## 7. Idempotency

Mutating requests (`POST`, `PUT`, `DELETE`) can be made idempotent by providing a `X-Idempotency-Key` header.
- The gateway caches the result of the first successful execution for 24 hours.
- Subsequent requests with the same key receive the cached response without re-executing the operation.
- This prevents duplicate database records and file operations in the event of network retry loops.

## 9. Security Recommendations for Production

- **TLS/SSL**: Always set `tls_cert` and `tls_key` in `config.toml` or terminate TLS at a trusted reverse proxy (e.g., Nginx, Cloudflare).
- **Restricted Scoping**: Never use `["*"]` for `db_scope` on keys exposed to end-user applications.
- **Redaction**: Avoid enabling `features.playground` in public production environments.
- **Log Rotation**: Ensure `logging.directory` is on a partition with sufficient space to prevent service denial due to disk exhaustion.
- **Rate Limit Penalties**: While permanent bans are stored in SQLite, temporary IP penalties issued automatically by the rate limiter use the cache backend. Use a Redis backend for rate limiting if you require penalty persistence across load-balanced workers or container restarts. The in-memory backend stores exactly 2 keys per tracked IP (`count` + `expiry`) — safe to use under high-concurrency DDoS without memory growth.

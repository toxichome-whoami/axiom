<div align="center">
  <h1>Axiom Security Model</h1>
  <p><em>Security-First philosophy engineered to withstand industrial-grade API attack vectors</em></p>
</div>

<hr/>

## 1. Zero-Trust Internal Architecture

- **Scope-Based Access**: Every API key is restricted by `mode` (readonly, writeonly, readwrite), `db_scope` (permitted database aliases), `fs_scope` (permitted storage aliases), and `feature_scope` (permitted feature endpoints like MCP, WS, GraphQL).
- **Mode Intersection**: Permissions are calculated by taking the intersection of the API key's mode and the resource's (database or storage) configured mode.
- **Service-Level Isolation**: No cross-service data leakage. Database engines cannot interact with the storage system directly and vice versa.

## 2. Three Isolated Authentication Paths

Axiom enforces strict separation between authentication domains. A credential from one domain **cannot** be used in another.

<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #2d2d2d; color: white;">
    <th style="padding: 10px; text-align: left;">Auth Path</th>
    <th style="padding: 10px; text-align: left;">Header</th>
    <th style="padding: 10px; text-align: left;">Config Location</th>
    <th style="padding: 10px; text-align: left;">Transport</th>
    <th style="padding: 10px; text-align: left;">Can be Admin?</th>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>API Keys</b></td>
    <td style="padding: 10px;"><code>Authorization: Bearer base64(name:secret)</code></td>
    <td style="padding: 10px;"><code>[api_key.*]</code></td>
    <td style="padding: 10px;">Base64</td>
    <td style="padding: 10px;">Yes (<code>full_admin</code>)</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Federation</b></td>
    <td style="padding: 10px;"><code>X-Federation-Secret</code> + <code>X-Federation-Node</code></td>
    <td style="padding: 10px;"><code>[federation.incoming.*]</code></td>
    <td style="padding: 10px;">Base64</td>
    <td style="padding: 10px;">Never</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>Webhooks</b></td>
    <td style="padding: 10px;"><code>X-Axiom-Webhook-Token: base64(secret)</code></td>
    <td style="padding: 10px;"><code>[webhook.*]</code></td>
    <td style="padding: 10px;">Base64</td>
    <td style="padding: 10px;">N/A</td>
  </tr>
</table>

- **API Keys** authenticate human users and external applications.
- **Federation Secrets** authenticate server-to-server mesh connections. Each node has independent scope.
- **Webhook Tokens** authorize webhook event emission. Verified via constant-time comparison.

All three paths use Base64 encoding for transport, but the raw secrets are stored as plain text in `config.toml`.

## 3. Dynamic Secret Storage (Cache-Aside Pattern)

- **Persistent Security State**: Security states, including legacy dynamic keys and manual bans, are stored in a persistent SQLite database (`data/security.db`).
- **Hashed Secrets**: Any dynamic API Key secrets are never stored in plaintext inside the database. They are hashed using SHA-256 before storage. Even if the database file is exfiltrated, the raw secrets cannot be recovered.
- **Ultra-Low Latency Caching**: To prevent database disk-I/O from creating a bottleneck during DDoS attacks, the SQLite database state is synchronized into a nanosecond-latency RAM cache. Authentication and ban checks occur strictly in memory.
- **User Credential Storage**: The End-User Authentication Engine (`/api/auth`) uses isolated databases per API key. Passwords are mathematically shielded via **Argon2id** (memory-hard, resistant to GPU cracking). Access tokens are completely stateless JWTs signed using **Ed25519** (EdDSA), immune to key-confusion and timing attacks often found in RSA/ECDSA implementations.

## 4. Attack Protections

<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #2d2d2d; color: white;">
    <th style="padding: 10px; text-align: left;">Threat</th>
    <th style="padding: 10px; text-align: left;">Protection Mechanism</th>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>SQL Injection</b></td>
    <td style="padding: 10px;">Mandatory use of <code>sqlglot</code> for AST-based parsing and validation. Parameterized queries are enforced; string interpolation is mathematically impossible in the data layer.</td>
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
    <td style="padding: 10px;">All secret comparisons use <code>hmac.compare_digest</code> (constant-time).</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>SSRF</b></td>
    <td style="padding: 10px;">The Federation proxy employs a strict Bogon/Localhost IP validator to ensure outbound network connections cannot be manipulated into routing to internal AWS metadata IPs or local resources.</td>
  </tr>
  <tr>
    <td style="padding: 10px;"><b>DoS</b></td>
    <td style="padding: 10px;">Protected via <code>CircuitBreaker</code> states linked to large Storage stream outputs. All chunked file uploads bypass RAM by writing directly to disk via streaming sockets.</td>
  </tr>
  <tr>
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

> **Note:** The `info` and `exists` storage actions are available to read-only API keys. All other mutating storage and database actions enforce `readwrite` or `writeonly` mode.

## 5. Web Application Firewall (WAF)

Axiom includes an embedded WAF layer (`src/server/middleware/waf.py`) that executes before any business logic.

- **Request Size Limiting**: Rejects requests that exceed `server.body_limit`.
- **Content-Type Enforcement**: Rejects unexpected content types (e.g., enforces JSON for API calls).
- **Input Sanitization**: Automatically removes null bytes and suspicious Unicode character sequences.
- **Pattern Matching**: Blocks requests containing common exploit strings in URLs and headers.

## 6. Idempotency

Mutating requests (`POST`, `PUT`, `DELETE`) can be made idempotent by providing a `X-Idempotency-Key` header.
- The gateway caches the result of the first successful execution for 24 hours.
- Subsequent requests with the same key receive the cached response without re-executing the operation.
- This prevents duplicate database records and file operations in the event of network retry loops.

## 7. Security Recommendations for Production

- **TLS/SSL**: Always set `tls_cert` and `tls_key` in `config.toml` or terminate TLS at a trusted reverse proxy (e.g., Nginx, Cloudflare).
- **Restricted Scoping**: Never use `["*"]` for `db_scope` or `fs_scope` on keys exposed to end-user applications. Use `feature_scope` to lock down access to unneeded subsystems like GraphQL or WebSockets.
- **Federation Scoping**: Give federated nodes the minimum permissions needed. Use `readonly` mode and restrict `db_scope` where possible.
- **Unique Secrets**: Never reuse the same secret across different federation nodes or webhooks.
- **Redaction**: Avoid enabling `features.playground` in public production environments.
- **Log Rotation**: Ensure `logging.directory` is on a partition with sufficient space to prevent service denial due to disk exhaustion.
- **Rate Limit Penalties**: While permanent bans are stored in SQLite, temporary IP penalties issued automatically by the rate limiter use the cache backend. Use a Redis backend for rate limiting if you require penalty persistence across load-balanced workers or container restarts. The in-memory backend stores exactly 2 keys per tracked IP (`count` + `expiry`) — safe to use under high-concurrency DDoS without memory growth.

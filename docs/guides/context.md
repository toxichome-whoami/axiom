# Axiom API — AI Context

Axiom is a self-hosted, high-performance Rust backend gateway. Exposes REST APIs for databases, file storage, auth, real-time channels, GraphQL, and MCP. All responses: `{"success": true|false, "data": ..., "error": {"code": "...", "message": "..."}}`.

---

## Client SDKs

To simplify interacting with the Axiom Gateway from your applications, officially supported Client SDKs are available in the `sdk/` directory.

- **TypeScript/JavaScript**: `sdk/axiom-js` (Zero-dependency, uses native `fetch`)
- **Python**: `sdk/axiom-py` (Async support via `httpx`)

Both SDKs expose unified interfaces for the `auth`, `db`, `fs`, and `realtime` modules, automatically handling header injection (`X-Axiom-Key` and `X-User-Access-Token`) and token state.

---

## Auth

Every request needs `X-Axiom-Key` header. Value = `base64(key_name:secret)`.

```
X-Axiom-Key: YWRtaW46c2VjcmV0
                ↑ base64("admin:secret")
```

After user login, protected user routes use `X-User-Access-Token: <jwt>` instead.  
SSE (browser `EventSource`) cannot send custom headers — use `?token=base64(name:secret)` query param for SSE only.

---

## Base URL

```
https://your-host.com   (or http://localhost:4500 locally)
```

---

## Core Endpoints

| What | Path | Auth |
|------|------|------|
| Server info + feature flags | `GET /` | None |
| Readiness probe | `GET /ready` | None |
| Deep health + DB status | `GET /health` | X-Axiom-Key |
| Prometheus metrics | `GET /metrics` | X-Axiom-Key |
| OpenAPI JSON spec | `GET /api-docs/openapi.json` | None |

---

## Database API  `/api/v1/db`

> **Alias** = name from `config.toml` `[database.<alias>]`.

| What | Method + Path |
|------|--------------|
| List all DBs | `GET /api/v1/db/databases` |
| List tables (paginated) | `GET /api/v1/db/{alias}/tables?limit=50&cursor=` |
| Fetch rows (paginated) | `GET /api/v1/db/{alias}/{table}/rows` |
| Insert rows | `POST /api/v1/db/{alias}/{table}/rows` |
| Update rows | `PATCH /api/v1/db/{alias}/{table}/rows` |
| Delete rows | `DELETE /api/v1/db/{alias}/{table}/rows` |
| Raw SQL | `POST /api/v1/db/{alias}/query` |

**Fetch rows params:** `limit`, `cursor`, `sort`, `order=asc|desc`, `filter={"col":val}`, `fields=col1,col2`, `search`, `search_fields`, `count=1`

**Raw SQL body:** `{"sql": "SELECT * FROM t WHERE id = :id", "params": {"id": 1}}`

**Insert body:** `{"rows": [{"col": "val"}]}`

**Update body:** `{"filter": {"id": 1}, "update": {"col": "newval"}}`

**Delete body:** `{"filter": {"id": 1}}`

Pagination is **keyset/cursor-based** — use `next_cursor` from response as `cursor=` on the next call.

---

## Storage API  `/api/v1/fs`

> **Alias** = name from `config.toml` `[storage.<alias>]`.

| What | Method + Path |
|------|--------------|
| List storages | `GET /api/v1/fs/storages` |
| List folder | `GET /api/v1/fs/{alias}/list?path=/&limit=100&continuation_token=&recursive=true` |
| Download / stream file | `GET /api/v1/fs/{alias}/download?path=/file.txt` |
| Direct upload (small) | `POST /api/v1/fs/{alias}/upload` (multipart: `action=direct`, `path=`, `file=@`) |
| Chunked upload step 1 | `POST /api/v1/fs/{alias}/upload` JSON `{"action":"initiate","filename":"","path":"","total_size":0,"checksum_sha256":""}` |
| Chunked upload step 2 | `POST /api/v1/fs/{alias}/upload` multipart `action=chunk, upload_id=, chunk_index=, chunk_hash=, file=@` |
| Chunked upload step 3 | `POST /api/v1/fs/{alias}/upload` JSON `{"action":"finalize","upload_id":"upl_xxx"}` |
| File actions | `POST /api/v1/fs/{alias}/action` |

**File actions** — send `{"action": "<name>", ...}`:

| Action | Fields |
|--------|--------|
| `rename` / `move` | `source`, `target` |
| `copy` | `source`, `target` |
| `delete` | `source` |
| `mkdir` | `source` |
| `info` | `source` |
| `exists` | `source` |
| `bulk_delete` | `sources: [...]` |
| `bulk_move` | `operations: [{source, target}, ...]` |

**Image transforms on download:** `?width=400&height=300&fit=contain|cover|fill&format=webp|avif|jpeg|png&quality=82&inline=true`

Video/audio supports `Range` headers (HTTP 206). Folders download as ZIP.

---

## Auth API  `/api/v1/auth/{project_id}`

> `project_id` = your API key name (e.g., `admin`). Requires `features.auth = true`. Each key is an isolated auth project.

**Flow:** Signup → Login → get `access_token` + `refresh_token` → use `X-User-Access-Token: <access_token>` on user routes.

### Identity

| What | Method + Path | Auth header |
|------|--------------|-------------|
| JWKS public key | `GET /api/v1/auth/{pid}/.well-known/jwks.json` | None |
| Signup | `POST /api/v1/auth/{pid}/signup` | X-Axiom-Key |
| Login | `POST /api/v1/auth/{pid}/login` | X-Axiom-Key |
| Logout | `POST /api/v1/auth/{pid}/logout` | Both |
| Refresh token | `POST /api/v1/auth/{pid}/refresh` | X-Axiom-Key |
| Anonymous session | `POST /api/v1/auth/{pid}/anonymous` | X-Axiom-Key |
| Upgrade anonymous | `POST /api/v1/auth/{pid}/anonymous/upgrade` | Both |

### OAuth 2.0

| What | Method + Path |
|------|--------------|
| OAuth Login Redirect | `GET /api/v1/auth/{pid}/oauth/{provider}/login` (providers: `google`, `github`) |
| OAuth Callback Handler | `GET /api/v1/auth/{pid}/oauth/{provider}/callback?code=...` |

### Email Verification

| What | Method + Path |
|------|--------------|
| Request verification email | `POST /api/v1/auth/{pid}/verify/email` |
| Verify via token link | `GET /api/v1/auth/{pid}/verify?token=` |
| Verify via OTP code | `POST /api/v1/auth/{pid}/verify/otp` body: `{"code":"482910"}` |
| Send OTP manually | `POST /api/v1/auth/{pid}/otp/send` |
| Resend verification | `POST /api/v1/auth/{pid}/resend` body: `{"email":"..."}` |

### Magic Link (Passwordless)

| What | Method + Path |
|------|--------------|
| Send magic link | `POST /api/v1/auth/{pid}/magic-link` body: `{"email":"..."}` |
| Verify magic link | `POST /api/v1/auth/{pid}/magic-link/verify` body: `{"token":"ml_xxx"}` |

### Password

| What | Method + Path |
|------|--------------|
| Forgot password | `POST /api/v1/auth/{pid}/password/forgot` body: `{"email":"..."}` |
| Reset password | `POST /api/v1/auth/{pid}/password/reset` body: `{"token":"rst_xxx","new_password":"..."}` |
| Change password | `POST /api/v1/auth/{pid}/user/password` body: `{"current_password":"...","new_password":"..."}` |

### TOTP / 2FA

| What | Method + Path |
|------|--------------|
| Enroll (get QR) | `POST /api/v1/auth/{pid}/totp/enroll` |
| Confirm enrollment | `POST /api/v1/auth/{pid}/totp/confirm` body: `{"code":"123456"}` |
| Verify TOTP on login | `POST /api/v1/auth/{pid}/totp/verify` body: `{"session_token":"...","code":"123456"}` |
| Disable TOTP | `POST /api/v1/auth/{pid}/totp/disable` body: `{"password":"..."}` |
| Use backup code | `POST /api/v1/auth/{pid}/totp/backup/verify` body: `{"session_token":"...","backup_code":"ABCD-EFGH"}` |
| Regenerate backup codes | `GET /api/v1/auth/{pid}/totp/backup/regenerate` |

### WebAuthn (Passkeys)

| What | Method + Path |
|------|--------------|
| Register options | `POST /api/v1/auth/{pid}/webauthn/register/options` |
| Register verify | `POST /api/v1/auth/{pid}/webauthn/register/verify` |
| Login options | `POST /api/v1/auth/{pid}/webauthn/login/options` |
| Login verify | `POST /api/v1/auth/{pid}/webauthn/login/verify` |

### User Profile

| What | Method + Path |
|------|--------------|
| Get profile | `GET /api/v1/auth/{pid}/user` |
| Update profile | `PATCH /api/v1/auth/{pid}/user` body: `{"metadata":{"display_name":"Alice"}}` |
| Delete account | `DELETE /api/v1/auth/{pid}/user` body: `{"password":"..."}` |
| Change email | `POST /api/v1/auth/{pid}/user/email` body: `{"new_email":"...","password":"..."}` |
| Confirm email change | `POST /api/v1/auth/{pid}/user/email/confirm` body: `{"token":"ec_xxx"}` |
| List sessions | `GET /api/v1/auth/{pid}/user/sessions` |
| Revoke session | `DELETE /api/v1/auth/{pid}/user/sessions/{session_id}` |

### Admin *(requires `full_admin = true`)*

| What | Method + Path |
|------|--------------|
| List users | `GET /api/v1/auth/{pid}/admin/users?limit=50&cursor=` |
| Get user | `GET /api/v1/auth/{pid}/admin/users/{uid}` |
| Update user | `PATCH /api/v1/auth/{pid}/admin/users/{uid}` body: `{"disabled":true}` |
| Delete user | `DELETE /api/v1/auth/{pid}/admin/users/{uid}` |
| Revoke all sessions | `POST /api/v1/auth/{pid}/admin/users/{uid}/sessions/revoke` |
| List email templates | `GET /api/v1/auth/{pid}/admin/templates` |
| Create/replace template | `PUT /api/v1/auth/{pid}/admin/templates/{type}` types: `email_verify`, `password_reset`, `magic_link`, `email_change` |
| Delete template | `DELETE /api/v1/auth/{pid}/admin/templates/{type}` |
| Bulk import users | `POST /api/v1/auth/{pid}/admin/users/import` body: `{"users":[{"email":"...","password_hash":"..."}]}` |
| Import job status | `GET /api/v1/auth/{pid}/admin/users/import/{job_id}` |
| Export all users | `GET /api/v1/auth/{pid}/admin/users/export` |
| Audit log | `GET /api/v1/auth/{pid}/admin/audit?limit=100&cursor=` |

### Auth Error Codes

`AUTH_USER_EXISTS` · `AUTH_USER_NOT_FOUND` · `AUTH_INVALID_CREDENTIALS` · `AUTH_EMAIL_NOT_VERIFIED` · `AUTH_TOKEN_EXPIRED` · `AUTH_TOKEN_INVALID` · `AUTH_TOKEN_STOLEN` · `AUTH_ACCOUNT_DISABLED` · `AUTH_RATE_LIMITED` · `AUTH_WEAK_PASSWORD` · `AUTH_MAGIC_LINK_EXPIRED` · `AUTH_PROJECT_NOT_CONFIGURED` · `AUTH_OTP_INVALID`

---

## SSE API  `/api/v1/sse`  *(requires `features.sse = true`)*

One-way server push. Connect directly to the stream URL — no subscribe message needed.

> Browser `EventSource` cannot send headers. Use `?token=base64(name:secret)` query param.

| Stream | Path |
|--------|------|
| Table mutations | `GET /api/v1/sse/db/{alias}/{table}` |
| All DB mutations | `GET /api/v1/sse/db/{alias}` |
| File changes at path | `GET /api/v1/sse/fs/{alias}/{path}` |
| All storage changes | `GET /api/v1/sse/fs/{alias}` |
| Live server metrics | `GET /api/v1/sse/metrics` |
| Health stream (no auth) | `GET /api/v1/sse/health` |

---

## WebSocket API  `ws://host/api/v1/ws`  *(requires `features.websocket = true`)*

Bidirectional push. Backend clients send `X-Axiom-Key` header during handshake. Browser clients send auth as first JSON message (5s timeout).

```json
// Step 1 auth
{"type": "auth", "token": "base64(name:secret)"}

// Step 2 subscribe
{"type": "subscribe", "topic": "db:{alias}:{table}", "request_id": "r1"}

// Unsubscribe
{"type": "unsubscribe", "topic": "db:{alias}:{table}"}
```

**Topics:** `db:{alias}:{table}` · `db:{alias}:*` · `fs:{alias}:{path}` · `fs:{alias}:*` · `metrics` · `system:health`

**Close codes:** `4001` = auth timeout · `4003` = invalid token

---

## GraphQL API  `POST /api/v1/graphql`  *(requires `features.graphql = true`)*

Same auth header as REST. Runs through identical security pipeline (AST validation, scoping, rate limiting).

```graphql
# Raw SQL
{ execute(dbAlias: "main_db", sql: "SELECT * FROM users", params: {}) }

# Table query with cursor pagination
{ users(dbAlias: "main_db", limit: 10, sort: "id", order: "asc", cursor: "1") { id name email } }

# Filtering
{ users(dbAlias: "main_db", filter: { status: "active", age: { $gte: 18 } }) { id name } }

# List available DBs
{ databases }

# Mutations
mutation { insert_users(dbAlias: "main_db", row: { name: "Alice" }) }
mutation { update_users(dbAlias: "main_db", filter: { id: 1 }, update: { status: "inactive" }) }
mutation { delete_users(dbAlias: "main_db", filter: { id: 2 }) }
```

Nested relations auto-resolve via FK inspection (no N+1). Max query depth = 15 (configurable).

---

## MCP API  `/api/v1/mcp`  *(requires `features.mcp = true`)*

Exposes Axiom to AI models (Claude, Gemini, etc.) via Model Context Protocol.

| Endpoint | Use |
|----------|-----|
| `GET /api/v1/mcp/sse` | SSE transport — AI connects here |
| `POST /api/v1/mcp/messages` | JSON-RPC message endpoint |

**Available tools:** `list_databases` · `list_tables(database)` · `describe_table(database, table)` · `query_database(database, sql)` · `list_storages` · `list_files(storage, path)` · `read_file(storage, path)`

**Resources:** `axiom://db/{alias}/schema` · `axiom://fs/{alias}/info`

---

## Federation API  `/api/v1/fed`  *(requires `features.federation = true`)*

| What | Path |
|------|------|
| List federated nodes | `GET /api/v1/fed/servers` |

---

## Filter Syntax (DB row queries and GraphQL)

```json
{"col": "val"}                              // exact match
{"col": {"$eq": val}}                       // equal
{"col": {"$ne": val}}                       // not equal
{"col": {"$gt": val}}                       // greater than
{"col": {"$gte": val}}                      // greater or equal
{"col": {"$lt": val}}                       // less than
{"col": {"$lte": val}}                      // less or equal
{"col": {"$in": ["a","b"]}}                 // in list
{"col": {"$nin": ["x"]}}                    // not in list
{"col": {"$like": "%text%"}}                // SQL LIKE
{"col": {"$ilike": "%text%"}}               // case-insensitive LIKE
{"col": {"$null": true}}                    // IS NULL / IS NOT NULL
{"col": {"$between": [18, 65]}}             // BETWEEN
{"$or": [{"status":"active"},{"role":"admin"}]}   // logical OR
{"$and": [{"age":{"$gte":18}},{"verified":true}]} // logical AND
```

---

## Key Rules for AI Code Generation

1. **Always base64-encode** `key_name:secret` for `X-Axiom-Key`. Never send plaintext.
2. **Pagination is cursor-based.** Use `next_cursor` from response, not page/offset numbers.
3. **All write endpoints** need `Content-Type: application/json`.
4. **Uploads** use multipart for direct, JSON for chunked initiate/finalize.
5. **User routes** (profile, sessions, TOTP) need `X-User-Access-Token`, not `X-Axiom-Key`.
6. **Admin routes** require `X-Axiom-Key` from a key with `full_admin = true` in config.
7. **SSE in browsers** cannot use custom headers — pass `?token=base64(name:secret)` in URL.
8. **WebSocket in browsers** cannot use custom headers — send auth as first JSON message within 5s.
9. **DB alias and storage alias** come from the user's `config.toml` — always ask the user.
10. **`feature_scope` values:** `mcp` · `ws` · `graphql` · `sse` · `webhooks` · `*` (all).
11. **All responses** include `"success": true|false`. On error, read `error.code` + `error.message`.
12. **Optional features** (GraphQL, WebSocket, SSE, MCP, Federation) — endpoints only exist if enabled in config.

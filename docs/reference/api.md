# API Reference

Base URL: `http://localhost:4500`

All data API endpoints require `X-Axiom-Key: base64(name:secret)`.

---

## Authentication Header

```
X-Axiom-Key: <base64(name:secret)>
```

Alternative headers accepted: `X-Api-Key`, `Authorization: Bearer <base64(name:secret)>`.

Session tokens (Web UI login via `/admin/v1/auth/login`) are 32-character strings passed as `Authorization: Bearer <token>`.

---

## Response Envelope

All endpoints return the same envelope:

```json
{
  "success": true | false,
  "data": { ... } | null,
  "error": null | { "code": "ERROR_CODE", "message": "Human readable" }
}
```

Response headers on every response:
- `X-Request-ID` — UUID v4 per request
- `X-Idempotency-Hit: true` — present when an idempotency cache hit is returned
- `X-RateLimit-Limit` / `X-RateLimit-Remaining`

---

## Data API — `/api/v1/db`

### List Databases

```
GET /api/v1/db/databases
```

Returns all databases the caller has permission to access.

### Raw SQL Query

```
POST /api/v1/db/:alias/query
```

**Body:**
```json
{
  "sql": "SELECT id, name FROM users WHERE active = ?",
  "params": [true],
  "timeout": 30
}
```

- `params`: JSON array (`[val1, val2]`) or object with numeric string keys (`{"1": val1}`).
- `timeout`: 1–300 seconds, default 30.
- Add `Idempotency-Key: <any-string>` header to cache the response for 24 hours. Safe retries return the same response body.

**Response `data`:**
```json
{
  "rows": [{"id": 1, "name": "Alice"}],
  "columns": ["id", "name"],
  "rows_affected": 0,
  "next_cursor": null
}
```

### List Tables

```
GET /api/v1/db/:alias/tables?limit=100&cursor=<name>
```

Cursor-paginated. `next_cursor` in response is the last table name; pass it as `cursor` for the next page.

### Fetch Rows

```
GET /api/v1/db/:alias/:table/rows
```

Query parameters:

| Param | Default | Notes |
|-------|---------|-------|
| `limit` | `50` | 1–500 |
| `sort` | `id` | Column to sort on |
| `order` | `asc` | `asc` or `desc` |
| `cursor` | — | Keyset pagination cursor value |
| `filter` | — | URL-encoded JSON filter object |

Filter JSON format: `{"column": {"$eq": value}}`. Operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$like`, `$and`, `$or`, `$not`.

### Insert Rows

```
POST /api/v1/db/:alias/:table/rows
```

**Body:**
```json
{ "row": {"name": "Alice", "active": true} }
```
or batch:
```json
{ "rows": [{"name": "Alice"}, {"name": "Bob"}] }
```

### Update Rows

```
PATCH /api/v1/db/:alias/:table/rows
```

`filter` is required and must not be empty (prevents full-table wipes).

**Body:**
```json
{
  "filter": {"id": {"$eq": 5}},
  "update": {"active": false}
}
```

### Delete Rows

```
DELETE /api/v1/db/:alias/:table/rows
```

`filter` is required.

**Body:**
```json
{ "filter": {"id": {"$eq": 5}} }
```

### Table Schema

```
GET /api/v1/db/:alias/:table/schema
```

Returns column definitions (name, type, nullable, primary key) and foreign key relationships.

---

## Core Endpoints

```
GET /           {"name":"Axiom","status":"online"}
GET /ready      {"ready":true}
GET /health     Requires auth. Full infra details for full_admin keys only.
GET /metrics    Requires full_admin. Prometheus exposition text or JSON (?format=json).
GET /favicon.ico
```

---

## Admin API — `/admin/v1`

All protected endpoints require a full_admin API key or active session token.

### Setup (first boot only)

```
GET  /admin/v1/setup/begin
POST /admin/v1/setup/account    {"username":"admin","password":"..."}
POST /admin/v1/setup/database   {"alias":"main","url":"postgres://..."}
POST /admin/v1/setup/complete
```

After `setup/complete`, all `/setup` routes return 404.

### Auth

```
POST /admin/v1/auth/login    {"username":"...","password":"..."}
POST /admin/v1/auth/logout
```

### Keys

```
GET    /admin/v1/keys
POST   /admin/v1/keys           {"name":"...","role":"...","secret":"...","rate_limit":0,"expires_at":null}
POST   /admin/v1/keys/:name/rotate
DELETE /admin/v1/keys/:name
```

### Roles

```
GET    /admin/v1/roles
POST   /admin/v1/roles          {"name":"...","description":"...","permissions":[...]}
PATCH  /admin/v1/roles/:name    {"description":"...","permissions":[...]}
DELETE /admin/v1/roles/:name
```

Permission object: `{"database":"*","table_name":"*","operations":["SELECT","INSERT","UPDATE","DELETE"]}`

### Databases

```
GET    /admin/v1/databases
POST   /admin/v1/databases              {"alias":"...","url":"...","engine":"...","pool_min":5,"pool_max":50}
GET    /admin/v1/databases/:alias/test
DELETE /admin/v1/databases/:alias
POST   /admin/v1/databases/test-url    {"url":"postgres://..."}
```

### Operations

```
POST /admin/v1/reload
GET  /admin/v1/status
GET  /admin/v1/audit?limit=50&offset=0
GET  /admin/v1/cache/stats
POST /admin/v1/cache/flush
GET  /admin/v1/health
GET  /admin/v1/metrics
GET  /admin/v1/users
```

---

## MCP — `/mcp/v1`

```
POST /mcp/v1
```

JSON-RPC 2.0. Requires API key auth.

Supported methods:

| Method | Description |
|--------|-------------|
| `initialize` | Handshake, returns protocol version `2024-11-05` |
| `tools/list` | Lists available tools |
| `tools/call` | Execute a named tool |
| `resources/list` | List databases as resources |
| `resources/read` | Read tables from a database resource |

Available tools (also accessible without `axiom_` prefix):
`axiom_list_services`, `axiom_list_tables`, `axiom_describe_table`, `axiom_query`, `axiom_insert`, `axiom_update`, `axiom_delete`, `axiom_raw_sql`.

---

## Error Codes

| Code | HTTP | Cause |
|------|------|-------|
| `AUTH_INVALID` | 401 | Missing, malformed, or expired API key |
| `AUTH_FORBIDDEN` | 403 | Key exists but lacks permission |
| `AUTH_SCOPE_DENIED` | 403 | Key lacks access to the requested database |
| `RATE_LIMIT_EXCEEDED` | 429 | IP or key throttle hit |
| `BANNED` | 403 | IP auto-banned after repeated failures |
| `DB_NOT_FOUND` | 404 | Alias not registered |
| `QUERY_TIMEOUT` | 504 | Query exceeded timeout |
| `CIRCUIT_OPEN` | 503 | DB circuit breaker tripped |
| `WAF_URI_TOO_LONG` | 414 | URI > 2048 chars |
| `WAF_BODY_TOO_LARGE` | 413 | Body > `body_limit` |
| `WAF_PATH_TRAVERSAL` | 400 | `..` detected after URL decode |
| `WAF_SQL_INJECTION` | 400 | SQL keyword in URL path/query |
| `AST_PARSE_FAILED` | 400 | SQL failed AST validation |
| `BAD_REQUEST` | 400 | Malformed request body |
| `NOT_FOUND` | 404 | Route does not exist |

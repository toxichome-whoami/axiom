<div align="center">

# Axiom API Reference

**Unified reference for SQL, table CRUD, blob storage, capability tickets, and MCP.**

</div>

---

Base URL: `http://localhost:4500`

---

## Authentication

All API endpoints (except public `/health` and capability ticket URLs) require authentication via `X-Axiom-Key`:

```http
X-Axiom-Key: <base64(name:secret)>
```

Alternative headers accepted:
- `X-Api-Key: <base64(name:secret)>`
- `Authorization: Bearer <base64(name:secret)>`

Session tokens obtained via Web UI login (`/admin/v1/auth/login`) are passed as:
```http
Authorization: Bearer <32-character-session-token>
```

---

## Response Envelope

All endpoints return a uniform JSON envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": {
    "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a",
    "duration_ms": 1.42,
    "cached": false
  }
}
```

Error envelope:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded or IP temporarily blocked."
  },
  "meta": {
    "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a"
  }
}
```

Standard response headers included on every response:
- `X-Request-ID`: UUID v4 unique to each request
- `X-RateLimit-Limit`: Maximum requests allowed in current window
- `X-RateLimit-Remaining`: Remaining request quota
- `X-Idempotency-Hit: true`: Injected when serving an idempotency cache hit

---

## Data API (`/api/v1/db`)

### List Databases

```http
GET /api/v1/db/databases
```

Returns all database aliases configured on the server that the caller's key has permission to access.

### Raw Parameterized SQL

```http
POST /api/v1/db/:alias/query
Content-Type: application/json
```

**Request Body:**
```json
{
  "query": "SELECT id, name, email FROM users WHERE status = $1 ORDER BY id DESC LIMIT 20",
  "params": ["active"],
  "timeout": 30
}
```

- `params`: JSON array of positional values (`["active", 100]`) or named object (`{"1": "active"}`).
- `timeout`: Per-query timeout in seconds (1–300, default 30).
- **Single-statement constraint**: Semicolon-separated multi-queries return `400 MULTI_STATEMENT_DENIED`.
- **Idempotency**: Add `Idempotency-Key: <unique-string>` to cache mutation responses for 24 hours.

**Response Data:**
```json
{
  "rows": [
    { "id": 1, "name": "Alice Smith", "email": "alice@example.com" }
  ],
  "rows_affected": 0,
  "columns": ["id", "name", "email"]
}
```

---

### List Tables

```http
GET /api/v1/db/:alias/tables?cursor=0&limit=50
```

Returns table metadata and total table count for the given alias.

---

### Fetch Rows (Table CRUD)

```http
GET /api/v1/db/:alias/:table/rows?filter=<url-encoded-json>&sort=created_at&order=desc&limit=25&cursor=0
```

#### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `filter` | JSON | `{}` | Key-operator map of column constraints |
| `sort` | string | primary key | Column to sort by |
| `order` | string | `asc` | Sort direction (`asc` or `desc`) |
| `limit` | integer | 100 | Rows to return (max 10000) |
| `cursor` | integer | 0 | Keyset cursor offset |

#### Filter Operators

| Operator | SQL Equivalent | Example JSON Filter |
|---|---|---|
| `eq` | `=` | `{"status": {"eq": "active"}}` |
| `neq` | `!=` | `{"status": {"neq": "deleted"}}` |
| `gt` | `>` | `{"score": {"gt": 80}}` |
| `gte` | `>=` | `{"age": {"gte": 18}}` |
| `lt` | `<` | `{"price": {"lt": 50.00}}` |
| `lte` | `<=` | `{"stock": {"lte": 5}}` |
| `like` | `LIKE` | `{"email": {"like": "%@gmail.com"}}` |
| `in` | `IN (...)` | `{"role": {"in": ["admin", "editor"]}}` |
| `is_null` | `IS NULL` | `{"archived_at": {"is_null": true}}` |

---

### Insert Rows

```http
POST /api/v1/db/:alias/:table/rows
Content-Type: application/json
```

**Request Body:**
```json
{
  "rows": [
    { "name": "Bob Vance", "email": "bob@example.com", "role": "editor" },
    { "name": "Charlie Day", "email": "charlie@example.com", "role": "member" }
  ]
}
```

---

### Update Rows

Unbounded updates without a filter are blocked at the gateway layer.

```http
PATCH /api/v1/db/:alias/:table/rows
Content-Type: application/json
```

**Request Body:**
```json
{
  "data": { "status": "suspended" },
  "filter": { "failed_logins": { "gte": 5 } }
}
```

---

### Delete Rows

Unbounded deletions without a filter are blocked at the gateway layer.

```http
DELETE /api/v1/db/:alias/:table/rows
Content-Type: application/json
```

**Request Body:**
```json
{
  "filter": { "status": { "eq": "expired" } }
}
```

---

### Schema Introspection & DDL

```http
GET /api/v1/db/:alias/:table/schema
```

Returns column names, SQL data types, nullability, defaults, primary keys, and foreign keys.

To append a column safely (allowlist-checked):

```http
POST /api/v1/db/:alias/:table/columns
Content-Type: application/json
```

```json
{
  "name": "phone_number",
  "data_type": "VARCHAR(32)",
  "nullable": true,
  "default_value": null
}
```

---

## Blob Storage API (`/api/v1/blobs`)

Axiom provides a content-addressed storage engine backed by BLAKE3 hashes and a two-tier storage layer (Fjall LSM for metadata and small files `<64 KB`, direct disk shards for larger files).

### Store an Object

```http
PUT /api/v1/blobs/:namespace/:path...
Content-Type: <mime-type>
```

```bash
curl -X PUT "http://localhost:4500/api/v1/blobs/media/avatars/user_1.png" \
  -H "X-Axiom-Key: $KEY" \
  -H "Content-Type: image/png" \
  --data-binary "@avatar.png"
```

**Response Data:**
```json
{
  "key": "avatars/user_1.png",
  "hash": "b268f7b53e8006b006859d57a2b0d01d4a0475b7a13c9e99335f2ae3e26b8404",
  "size": 48201,
  "content_type": "image/png"
}
```

---

### Retrieve an Object (Full & Range Requests)

```http
GET /api/v1/blobs/:namespace/:path...
```

To fetch a byte range (e.g. for audio/video streaming or resumable downloads, single slice up to 256 MB):

```bash
curl -H "Range: bytes=0-1048575" \
  -H "X-Axiom-Key: $KEY" \
  "http://localhost:4500/api/v1/blobs/media/videos/demo.mp4" -o part.bin
```

Returns `HTTP 206 Partial Content` with `Content-Range: bytes 0-1048575/14205820`.

---

### List Blobs by Prefix

```http
GET /api/v1/blobs/:namespace?prefix=avatars/&limit=50
```

---

### Delete an Object

```http
DELETE /api/v1/blobs/:namespace/:path...
```

Note: Capability tickets cannot delete blobs. Deletions always require a full API key.

---

## Capability Tickets (Pre-Signed URLs)

Mint cryptographically signed capability tokens that allow clients to download or upload specific blobs without exposing master API credentials.

### Mint a Ticket

```http
POST /api/v1/blobs/:namespace/ticket
Content-Type: application/json
```

**Request Body:**
```json
{
  "key": "avatars/user_1.png",
  "operation": "READ",
  "ttl_seconds": 3600
}
```

- `operation`: Either `READ` or `WRITE`.
- `ttl_seconds`: Lifetime between 60 and 86,400 seconds (24 hours).

**Response Data:**
```json
{
  "ticket": "v1.media.avatars_user_1_png.READ.1760492800.7f1a3b8c...",
  "url": "http://localhost:4500/api/v1/blobs/media/avatars/user_1.png?ticket=v1.media..."
}
```

The recipient can access the file directly:
```bash
curl "http://localhost:4500/api/v1/blobs/media/avatars/user_1.png?ticket=v1.media..."
```

---

## Model Context Protocol (MCP)

Axiom implements the JSON-RPC 2.0 Model Context Protocol endpoint at `POST /mcp/v1` for LLM coding agents.

### Tools Available (15 Tools)

#### Database Tools
1. `axiom_list_services` — List accessible database aliases
2. `axiom_list_tables` — List tables in an alias
3. `axiom_describe_table` — Inspect columns, types, and foreign keys
4. `axiom_query` — Paginated row select using the filter builder
5. `axiom_insert` — Insert row into a table
6. `axiom_update` — Scoped update with mandatory filter
7. `axiom_delete` — Scoped delete with mandatory filter
8. `axiom_raw_sql` — Single-statement SQL execution

#### Blob Tools
9. `axiom_list_blob_namespaces` — List accessible namespaces
10. `axiom_list_blobs` — List objects by prefix
11. `axiom_get_blob_metadata` — Inspect object size, BLAKE3 hash, and MIME type
12. `axiom_read_blob` — Read file content (5 MB cap over JSON-RPC)
13. `axiom_write_blob` — Write file content
14. `axiom_delete_blob` — Delete object
15. `axiom_create_download_ticket` — Mint signed pre-signed download URL

Every MCP call enforces the caller's RBAC role, audit log, and circuit breakers.

---

## Error Codes Reference

| Error Code | HTTP Status | Cause | Resolution |
|---|---|---|---|
| `WAF_URI_TOO_LONG` | 414 | Request URI exceeds 2048 characters | Use POST request body for large filters |
| `WAF_NULL_BYTE` | 400 | Null byte (`%00`) detected in request | Remove invalid character encoding |
| `WAF_PATH_TRAVERSAL` | 400 | Path traversal sequence (`..`) detected | Normalize file keys and URL paths |
| `WAF_BODY_TOO_LARGE` | 413 | Request payload exceeds `body_limit` | Reduce upload size or raise `body_limit` |
| `RATE_LIMIT_EXCEEDED` | 429 | Exceeded requests per minute quota | Back off request rate; inspect `X-RateLimit-*` headers |
| `BANNED` | 403 | IP or key banned due to repeated auth failures | Wait for penalty cooldown or unban via Admin CLI |
| `AUTH_INVALID` | 401 | Missing or malformed `X-Axiom-Key` header | Provide valid `base64(name:secret)` string |
| `AUTH_FORBIDDEN` | 403 | Insufficient RBAC role permissions | Assign required database or table permission to role |
| `MULTI_STATEMENT_DENIED` | 400 | Multiple SQL statements joined by semicolon | Send only one SQL statement per request |
| `RANGE_NOT_SATISFIABLE` | 416 | Invalid or multi-part byte range request | Request a single range up to 256 MB (`bytes=0-1048575`) |
| `DB_NOT_FOUND` | 404 | Database alias not configured | Verify alias in `config.toml` or add via CLI (`axiom db add`) |
| `SQL_PARSE_ERROR` | 400 | SQL syntax rejected by AST parser | Verify query matches target dialect and parameter syntax |

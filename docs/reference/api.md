<div align="center">

# API reference

**One envelope, three surfaces: SQL · rows · blobs.** Task-first: each section shows the call, then the options.

</div>

---

> **Breaking rules (enforced):** single SQL statement per request (`400 MULTI_STATEMENT_DENIED`) · `filter` mandatory on update/delete · `add_column` allowlisted · release error messages are generic (detail in server logs via `X-Request-ID`).

## Contents

- [Auth & envelope](#authentication-header)
- [Data API](#data-api--apiv1db)
- [Blob API](./blob-storage.md)
- [Errors & troubleshooting](../operations/troubleshooting.md)

---

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
- **Single statement only** — `;`-joined SQL returns `400 MULTI_STATEMENT_DENIED`.
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

## Blob Storage API — `/api/v1/blobs`

Native high-performance content-addressed object store under `/api/v1/blobs/:namespace`. All endpoints require `X-Axiom-Key` or a valid download ticket token.

### Put / Upload Blob

```
PUT /api/v1/blobs/:namespace/*key
```

Stores or replaces a blob under `:namespace` with the object path `*key`.

**Request Headers:**
- `Content-Type`: MIME type (default `application/octet-stream`)
- `X-Axiom-TTL`: Optional TTL in seconds for automatic expiration
- `If-Match`: Optional ETag / BLAKE3 hash for atomic CAS (Compare-And-Swap) updates

**Request Body:** Raw binary payload. Payloads `<= 64 KB` (configurable via `inline_max`) are stored inline within the LSM index for near-instant access; larger payloads stream directly to disk.

**Response:**
```json
{
  "success": true,
  "data": {
    "namespace": "media",
    "key": "avatars/alice.png",
    "size": 42100,
    "hash": "0123456789abcdef...",
    "content_type": "image/png",
    "etag": "\"0123456789abcdef...\""
  },
  "error": null
}
```

### Get / Download Blob

```
GET /api/v1/blobs/:namespace/*key
```

Retrieves the blob content.

**Request Headers:**
- `Range`: Standard HTTP byte ranges, e.g. `bytes=0-1023` or `bytes=1000-` (returns `206 Partial Content`)
- `If-None-Match`: Returns `304 Not Modified` if hash matches

**Query Parameters:**
- `ticket`: Optional pre-signed capability token. When a valid ticket is supplied in the query string, download is authorized without requiring any `X-Axiom-Key` header.

**Response Headers:**
- `Content-Type`: Saved MIME type
- `Content-Length`: Size or range slice length
- `ETag`: `"<blake3-hex>"`
- `Accept-Ranges`: `bytes`
- `Content-Range`: `bytes 0-1023/42100` (on range requests)

### Head / Inspect Blob

```
HEAD /api/v1/blobs/:namespace/*key
```

Returns metadata headers without streaming the body. Useful for checking existence, size, and caching state.

### Delete Blob

```
DELETE /api/v1/blobs/:namespace/*key
```

Removes the object metadata from the LSM index and queues the backing payload file for cleanup.

### List Blobs

```
GET /api/v1/blobs/:namespace?prefix=<prefix>&limit=50&cursor=<token>
```

Lists stored objects in a namespace with keyset pagination.

**Query Parameters:**
- `prefix`: Filter keys beginning with prefix (e.g. `docs/` or `logs/2026/`)
- `limit`: Number of items (default 50, max 500)
- `cursor`: Next page pagination cursor

**Response `data`:**
```json
{
  "items": [
    {
      "key": "docs/architecture.pdf",
      "size": 1048576,
      "content_type": "application/pdf",
      "hash": "...",
      "created_at": 1728000000
    }
  ],
  "next_cursor": "docs/architecture.pdf"
}
```

### Create Download Ticket

```
POST /api/v1/blobs/:namespace/ticket
```

Generates a time-bounded HMAC capability download ticket. The generated ticket URL allows browser downloads, external clients, or temporary users to fetch the object without possessing an API key.

**Body:**
```json
{
  "key": "reports/q3_summary.pdf",
  "operation": "READ",
  "ttl_seconds": 3600
}
```

**Response `data`:**
```json
{
  "ticket": "eyJhbGciOi...",
  "url": "http://localhost:4500/api/v1/blobs/media/reports/q3_summary.pdf?ticket=eyJhbGciOi...",
  "expires_at": 1728003600
}
```

### Chunked / Multipart Uploads

For large files, streaming transfers, or unreliable connections:

1. **Initiate Upload:**
   ```
   POST /api/v1/blobs/:namespace/uploads
   ```
   Body: `{"key": "videos/raw.mp4", "content_type": "video/mp4"}`  
   Response: `{"upload_id": "<uuid>"}`

2. **Upload Part:**
   ```
   PUT /api/v1/blobs/:namespace/uploads/:upload_id/parts/:part_number
   ```
   Body: Binary chunk payload (`part_number` is 1-indexed).

3. **Complete Upload:**
   ```
   POST /api/v1/blobs/:namespace/uploads/:upload_id/complete
   ```
   Stitches chunks together, computes BLAKE3 checksum, indexes object, and finalizes storage.

4. **Abort Upload:**
   ```
   DELETE /api/v1/blobs/:namespace/uploads/:upload_id
   ```
   Cancels transfer and purges temporary uploaded chunks.

---

## Core Endpoints

```
GET /           {"name":"Axiom","status":"online"}
GET /ready      {"ready":true}
GET /health     Requires auth. Full infra details for admin sessions only.
GET /metrics    Requires admin session. Prometheus exposition text or JSON (?format=json).
GET /favicon.ico
```

---

## Admin API — `/admin/v1`

All protected endpoints require an active admin session token.

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

### Blob Storage Admin

```
GET    /admin/v1/blobs/stats                          # Storage telemetry (blob count, bytes, inline/disk)
POST   /admin/v1/blobs/scrub                          # Background integrity scrub (verifies BLAKE3 hashes)
POST   /admin/v1/blobs/sweep                          # Force immediate cleanup of TTL-expired objects
GET    /admin/v1/blobs/namespaces                     # List all registered namespaces
POST   /admin/v1/blobs/namespaces                     # Create namespace {"name":"...","quota_bytes":...}
PATCH  /admin/v1/blobs/namespaces/:namespace          # Update namespace quota or limits
DELETE /admin/v1/blobs/namespaces/:namespace          # Delete namespace
POST   /admin/v1/blobs/copy                           # Copy {"src_ns":"...","src_key":"...","dest_ns":"...","dest_key":"..."}
POST   /admin/v1/blobs/move                           # Move {"src_ns":"...","src_key":"...","dest_ns":"...","dest_key":"..."}
POST   /admin/v1/blobs/delete-prefix                  # Bulk delete {"namespace":"...","prefix":"..."}
POST   /admin/v1/blobs/verify/:namespace/*key         # Verify checksum of a single stored blob
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

JSON-RPC 2.0 endpoint for LLM agents. Reuses the identical API-key authentication (`X-Axiom-Key`) and granular RBAC policies as the REST API.

Supported JSON-RPC methods:

| Method | Description |
|--------|-------------|
| `initialize` | Handshake, returns protocol version `2024-11-05` and server capabilities |
| `notifications/initialized` | Client confirmation notification |
| `ping` | Health ping, returns `{}` |
| `tools/list` | Returns the catalog of 15 available tools filtered by caller's RBAC scope |
| `tools/call` | Executes a named tool with provided parameters |
| `resources/list` | Lists databases and namespaces as inspectable resources |
| `resources/read` | Reads schemas or metadata from a resource URI |

### Available MCP Tools (15)

All tools are accessible with or without the `axiom_` prefix:

#### Database Tools (8)
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `axiom_list_services` | Lists all database services accessible to the caller | — |
| `axiom_list_tables` | Lists tables in a database with pagination support | `database` (req), `cursor`, `limit` |
| `axiom_describe_table` | Returns table schema: columns, types, nullability, PKs, FKs | `database` (req), `table` (req) |
| `axiom_query` | Structured SELECT query with JSON filters and sorting | `database`, `table`, `filter`, `sort`, `order`, `limit`, `cursor` |
| `axiom_insert` | Parameterized single or batch row insertion | `database`, `table`, `row` or `rows` |
| `axiom_update` | Updates rows matching required filter (guardrail: empty filter rejected) | `database`, `table`, `filter` (req), `data` (req) |
| `axiom_delete` | Deletes rows matching required filter (guardrail: empty filter rejected) | `database`, `table`, `filter` (req) |
| `axiom_raw_sql` | Executes raw SQL (AST firewall inspected, parameter bound) | `database`, `sql` (req), `params` |

#### Blob Storage Tools (7)
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `axiom_list_blob_namespaces` | Lists blob storage namespaces authorized under RBAC | — |
| `axiom_list_blobs` | Lists objects in a namespace with prefix filtering and pagination | `namespace` (req), `prefix`, `cursor`, `limit` |
| `axiom_get_blob_metadata` | Retrieves blob metadata (size, MIME, BLAKE3 hash, tier) without payload | `namespace` (req), `key` (req) |
| `axiom_read_blob` | Reads blob contents into agent context (guardrail: max 5MB cap) | `namespace` (req), `key` (req), `encoding` (`utf8`/`base64`), `max_bytes` |
| `axiom_write_blob` | Stores or overwrites a blob with text or base64 payload | `namespace`, `key`, `content`, `encoding`, `content_type`, `ttl_seconds` |
| `axiom_delete_blob` | Deletes an object key from a namespace | `namespace` (req), `key` (req) |
| `axiom_create_download_ticket` | Generates a time-bounded pre-signed capability download ticket URL | `namespace` (req), `key` (req), `operation` (`READ`/`WRITE`), `ttl_seconds` |

---

## Error Codes

| Code | HTTP | Cause |
|------|------|-------|
| `AUTH_INVALID` | 401 | Missing, malformed, or expired API key |
| `AUTH_FORBIDDEN` | 403 | Key exists but lacks permission |
| `AUTH_SCOPE_DENIED` | 403 | Key lacks access to the requested database or namespace |
| `RATE_LIMIT_EXCEEDED` | 429 | IP or key throttle hit |
| `BANNED` | 403 | IP or key auto-banned after repeated failures |
| `DB_NOT_FOUND` | 404 | Database alias not registered |
| `QUERY_TIMEOUT` | 504 | Query exceeded execution timeout |
| `CIRCUIT_OPEN` | 503 | Database circuit breaker tripped (backend unresponsive) |
| `WAF_URI_TOO_LONG` | 414 | URI > 2048 chars |
| `WAF_BODY_TOO_LARGE` | 413 | Body exceeds `server.body_limit` |
| `WAF_PATH_TRAVERSAL` | 400 | `..` detected after URL decode (up to 3x) |
| `WAF_SQL_INJECTION` | 400 | SQL keyword detected in URL path or query string |
| `AST_PARSE_FAILED` | 400 | SQL failed AST validation or parser inspection |
| `BAD_REQUEST` | 400 | Malformed request body or missing mandatory fields |
| `NOT_FOUND` | 404 | Route does not exist |
| `BLOB_NOT_FOUND` | 404 | Requested object key does not exist in namespace |
| `BLOB_INVALID_KEY` | 400 | Key contains invalid characters, control codes, or illegal prefix nesting |
| `BLOB_QUOTA_EXCEEDED` | 413 | Namespace storage quota exceeded |
| `BLOB_TICKET_EXPIRED` | 403 | Pre-signed download capability ticket is expired or invalid |
| `BLOB_CORRUPTED` | 500 | Checksum mismatch detected during blob integrity verification |
| `INVALID_RANGE` | 416 | Requested HTTP byte range is unsatisfiable |

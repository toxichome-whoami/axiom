<div align="center">

# Axiom API Reference

### REST Data API, Blob Storage, Admin Control Plane, Cluster Mesh, and MCP Specification

[![Version](https://img.shields.io/badge/version-0.1.16%2B-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](../LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%C2%B7%20macos%20%C2%B7%20windows-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-111827.svg?style=flat-square)](https://modelcontextprotocol.io)

</div>

---

## Architecture & Request Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / Agent / Peer
    participant WAF as WAF Guard
    participant RL as Dual Rate Limiter
    participant Auth as Auth & Policy (ArcSwap)
    participant Core as Engine Dispatcher
    participant DB as Upstream Storage / Database

    Client->>WAF: HTTP Request (Headers + Body)
    Note over WAF: URI limit (2048), null-byte, 3-pass URL decode
    WAF->>RL: Validated Request
    Note over RL: Check rl:ip and rl:key sliding-window counters
    RL->>Auth: Quota Approved
    Note over Auth: Verify BLAKE3 key, Session, or HMAC-SHA256 signature
    Auth->>Core: Injected AuthContext & Role (with RLS Filter)
    alt Cache Hit (GET / SELECT)
        Core-->>Client: Cached Response Envelope (< 1 µs)
    else Cache Miss / Mutation / Proxy
        Core->>DB: Parameterized Query / Chunk Write / State Mutation
        DB-->>Core: Query Result / Chunk Written
        Core-->>Client: Response (JSON Envelope, NDJSON Stream, or Binary)
    end
```

---

## Conventions & Envelopes

### Base URL
```text
http://127.0.0.1:4500
```

### Authentication Headers
| Scheme | Header Syntax | Scope | Description |
|---|---|---|---|
| Master API Key | `X-Axiom-Key: <base64(name:secret)>` | Data API (`/api/v1/*`), MCP (`/mcp/v1`) | Machine-to-machine authentication |
| Compatibility Key | `X-Api-Key: <base64(name:secret)>` | Data API (`/api/v1/*`), MCP (`/mcp/v1`) | Legacy gateway compatibility |
| Bearer API Key | `Authorization: Bearer <base64(name:secret)>` | Data API (`/api/v1/*`), MCP (`/mcp/v1`) | Standard OAuth2-style header |
| Admin Session | `Authorization: Bearer <32-char-session-token>` | Admin API (`/admin/v1/*`), Web UI | Token from `POST /admin/v1/auth/login` |
| Inter-Node Signature | `X-Axiom-Signature: <hex(HMAC-SHA256)>` | Cluster Mesh (`/internal/v1/cluster/*`) | Peer-to-peer inter-node signing |
| Capability Ticket | `?ticket=v1.<ns>.<key>.<op>.<exp>.<sig>` | Blob Data API (`/api/v1/blobs/*`) | URL query param for delegated access |

### Response Envelopes

#### Success Envelope (`application/json`)
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a",
    "duration_ms": 1.42,
    "cached": false
  },
  "error": null
}
```

#### Error Envelope (`application/json`)
```json
{
  "success": false,
  "data": null,
  "meta": {
    "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a"
  },
  "error": {
    "code": "AUTH_FORBIDDEN",
    "message": "Role 'analyst' lacks INSERT permission on 'main_pg.audit_events'"
  }
}
```

#### Streaming Responses (`application/x-ndjson`)
When `Accept: application/x-ndjson` or `stream: true` is requested on query or rows endpoints, rows are emitted continuously as newline-delimited JSON objects without buffer overhead:
```json
{"id":101,"email":"alice@example.com","status":"active"}
{"id":102,"email":"bob@example.com","status":"active"}
```

---

## 1. Core & System Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Public | Root welcome & liveness probe |
| `GET` | `/ready` | Public | Upstream database readiness probe |
| `GET` | `/health` | API Key / Session | System telemetry: server uptime, process memory, pool statuses |
| `GET` | `/api/v1/health` | Public | Liveness probe mounted under `/api/v1` prefix |
| `GET` | `/metrics` | API Key / Session | Prometheus metrics exposition (`?format=json` for JSON) |
| `GET` | `/system` | Public / Session | Embedded Admin Web UI single-page application |
| `GET` | `/favicon.ico` | Public | Gateway browser favicon |

### `GET /`
**Response (`200 OK`)**:
```json
{
  "name": "Axiom",
  "status": "online"
}
```

### `GET /ready`
**Success Response (`200 OK`)**:
```json
{
  "ready": true
}
```
**Failure Response (`503 Service Unavailable`)**:
```json
{
  "ready": false,
  "error": "One or more database connection pools are unready"
}
```

### `GET /health`
Requires API Key or Session token to prevent infrastructure reconnaissance.

**Response (`200 OK`)**:
```json
{
  "status": "healthy",
  "uptime_seconds": 84120
}
```
*(When accessed with an Admin Session, comprehensive system and pool telemetry is returned)*:
```json
{
  "status": "healthy",
  "uptime_seconds": 84120,
  "system": {
    "cpu_percent": 2.4,
    "memory_used_mb": 68
  },
  "databases": {
    "main_pg": "up",
    "warehouse_ch": "up"
  }
}
```

### `GET /api/v1/health`
**Response (`200 OK`)**:
```json
{
  "status": "ok"
}
```

### `GET /metrics`
**Default Response (`200 OK`, `text/plain; version=0.0.4`)**:
```text
# HELP axiom_http_requests_total Total number of HTTP requests processed
# TYPE axiom_http_requests_total counter
axiom_http_requests_total{method="GET",path="/api/v1/db/main_pg/users/rows",status="200"} 14820
axiom_http_requests_total{method="POST",path="/api/v1/db/main_pg/query",status="200"} 5312
# HELP axiom_http_request_duration_seconds Histogram of HTTP request latencies
# TYPE axiom_http_request_duration_seconds histogram
axiom_http_request_duration_seconds_bucket{le="0.005"} 18402
axiom_http_request_duration_seconds_count 20132
```

**JSON Telemetry (`GET /metrics?format=json`) (`200 OK`)**:
```json
{
  "uptime_seconds": 84120,
  "requests_total": 20132,
  "active_connections": 14,
  "cache_hit_rate": 0.942,
  "memory_resident_mb": 68
}
```

---

## 2. Database Data API (`/api/v1/db`)

All `/api/v1/db/*` routes require an authenticated API Key (`X-Axiom-Key: base64(name:secret)`).

### Endpoints Summary
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/db/databases` | List database connections accessible by the caller's role |
| `POST` | `/api/v1/db/:alias/query` | Execute parameterized SQL statement via dialect AST firewall |
| `GET` | `/api/v1/db/:alias/tables` | List accessible tables with pagination (`cursor`, `limit`) |
| `GET` | `/api/v1/db/:alias/:table/schema` | Inspect table columns, datatypes, nullability, and foreign keys |
| `GET` | `/api/v1/db/:alias/:table/rows` | Query table rows with keyset pagination, JSON filters, and sorting |
| `POST` | `/api/v1/db/:alias/:table/rows` | Insert one or more rows with `Idempotency-Key` replay protection |
| `PATCH` | `/api/v1/db/:alias/:table/rows` | Update rows matching mandatory filter object |
| `DELETE` | `/api/v1/db/:alias/:table/rows` | Delete rows matching mandatory filter object |
| `GET` | `/api/v1/db/:alias/:table/columns` | Inspect table columns, datatypes, and foreign keys |
| `POST` | `/api/v1/db/:alias/:table/columns` | Dynamic DDL: Add a column to an existing table schema |
| `PATCH` | `/api/v1/db/:alias/:table/columns` | Dynamic DDL: Rename or alter column data type |
| `DELETE` | `/api/v1/db/:alias/:table/columns` | Dynamic DDL: Drop a column (via `?name=` or JSON payload) |
| `DELETE` | `/api/v1/db/:alias/:table/columns/:column_name` | Dynamic DDL: Drop a column via path parameter |

---

### List Accessible Databases (`GET /api/v1/db/databases`)
**Request**:
```http
GET /api/v1/db/databases
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "name": "main_pg",
      "engine": "postgres",
      "mode": "readwrite",
      "status": "connected",
      "tables_count": "24"
    },
    {
      "name": "warehouse_ch",
      "engine": "clickhouse",
      "mode": "readonly",
      "status": "connected",
      "tables_count": "112"
    }
  ],
  "error": null
}
```

---

### Querying Data (`POST /api/v1/db/:alias/query`)
**Request**:
```http
POST /api/v1/db/main_pg/query
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "query": "SELECT id, email, role, status FROM users WHERE status = $1 ORDER BY id DESC LIMIT 2",
  "params": ["active"],
  "timeout": 10,
  "stream": false
}
```
* **Parameters**:
  * `query` (string, required): Dialect SQL query with positional placeholders (`$1`, `?`, `@P1`).
  * `params` (array, optional): Parameter bindings matching placeholders.
  * `timeout` (integer, optional): Execution timeout in seconds (1–300, default: 30).
  * `stream` (boolean, optional): Stream results line-by-line as `application/x-ndjson`.

**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "columns": ["id", "email", "role", "status"],
    "rows": [
      {
        "id": 102,
        "email": "sarah.connor@cyberdyne.io",
        "role": "admin",
        "status": "active"
      },
      {
        "id": 101,
        "email": "john.doe@example.com",
        "role": "user",
        "status": "active"
      }
    ],
    "affected_rows": 2,
    "duration_ms": 1.15
  },
  "error": null
}
```

---

### List Tables (`GET /api/v1/db/:alias/tables`)
**Request**:
```http
GET /api/v1/db/main_pg/tables?limit=50
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "database": "main_pg",
    "tables": [
      "audit_logs",
      "customers",
      "order_items",
      "orders",
      "products",
      "users"
    ]
  },
  "error": null
}
```

---

### Inspect Table Schema (`GET /api/v1/db/:alias/:table/schema`)
**Request**:
```http
GET /api/v1/db/main_pg/users/schema
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "database": "main_pg",
    "table": "users",
    "columns": [
      {
        "name": "id",
        "data_type": "BIGINT",
        "nullable": false,
        "primary_key": true,
        "default_value": "nextval('users_id_seq'::regclass)"
      },
      {
        "name": "email",
        "data_type": "VARCHAR(255)",
        "nullable": false,
        "primary_key": false,
        "default_value": null
      },
      {
        "name": "status",
        "data_type": "VARCHAR(32)",
        "nullable": false,
        "primary_key": false,
        "default_value": "'active'"
      },
      {
        "name": "created_at",
        "data_type": "TIMESTAMPTZ",
        "nullable": false,
        "primary_key": false,
        "default_value": "CURRENT_TIMESTAMP"
      }
    ],
    "foreign_keys": []
  },
  "error": null
}
```

---

### Keyset Row Queries (`GET /api/v1/db/:alias/:table/rows`)
**Request**:
```http
GET /api/v1/db/main_pg/users/rows?limit=2&sort=id&order=asc&filter={"status":{"eq":"active"}}
X-Axiom-Key: <TOKEN>
```
* **Query Parameters**:
  * `filter` (string, optional): URL-encoded JSON filter object.
  * `sort` (string, optional): Column name to sort by (defaults to primary key).
  * `order` (string, optional): Sort direction (`asc` or `desc`, default: `asc`).
  * `limit` (integer, optional): Maximum rows to return (1–10,000, default: 100).
  * `cursor` (integer, optional): Offset cursor for pagination.
  * `stream` (boolean, optional): Return continuous NDJSON stream instead of JSON array.

**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": 1,
        "email": "alice@corp.internal",
        "status": "active"
      },
      {
        "id": 2,
        "email": "bob@corp.internal",
        "status": "active"
      }
    ],
    "pagination": {
      "limit": 2,
      "has_more": true,
      "next_cursor": 2
    }
  },
  "error": null
}
```

---

### Filter Operators Reference
Filters are specified as JSON objects mapping column names to constraint operators:

| Operator | SQL Equivalent | Example JSON Filter |
|---|---|---|
| `eq` | `=` | `{"status": {"eq": "active"}}` |
| `neq` | `!=` | `{"status": {"neq": "banned"}}` |
| `gt` | `>` | `{"score": {"gt": 80}}` |
| `gte` | `>=` | `{"age": {"gte": 21}}` |
| `lt` | `<` | `{"latency_ms": {"lt": 50.0}}` |
| `lte` | `<=` | `{"retry_count": {"lte": 3}}` |
| `like` | `LIKE` | `{"email": {"like": "%@company.com"}}` |
| `ilike` | `ILIKE` / `LOWER(col) LIKE LOWER(?)` | `{"name": {"ilike": "%alice%"}}` |
| `in` | `IN (...)` | `{"role": {"in": ["admin", "editor"]}}` |
| `is_null` | `IS NULL` / `IS NOT NULL` | `{"deleted_at": {"is_null": true}}` |

Logical compound expressions support branching with `$or` and `$and`:
```json
{
  "$or": [
    { "role": { "eq": "admin" } },
    { "$and": [{ "tier": { "eq": "enterprise" } }, { "balance": { "gte": 1000 } }] }
  ]
}
```

---

### Row-Level Security (RLS)
Roles can define an `rls_filter` on any table permission. The AST engine automatically rewrites queries to inject the constraint predicates into the SQL `WHERE` clause:
```json
{
  "database": "main_pg",
  "table_name": "orders",
  "operations": ["SELECT", "UPDATE"],
  "rls_filter": {
    "tenant_id": { "eq": "tenant_42" },
    "is_deleted": { "eq": false }
  }
}
```

---

### Insert Rows (`POST /api/v1/db/:alias/:table/rows`)
**Request**:
```http
POST /api/v1/db/main_pg/users/rows
X-Axiom-Key: <TOKEN>
Idempotency-Key: 7b84cf2a-9e12-4f88-8120-c23a7e93012a
Content-Type: application/json
```
```json
{
  "rows": [
    {
      "email": "carol@corp.internal",
      "status": "active"
    }
  ]
}
```
**Response (`201 Created`)**:
```json
{
  "success": true,
  "affected_rows": 1,
  "data": {
    "affected_rows": 1
  },
  "error": null
}
```

---

### Update Rows (`PATCH /api/v1/db/:alias/:table/rows`)
*Requires explicit filter object to prevent unbounded accidental full-table overwrites.*

**Request**:
```http
PATCH /api/v1/db/main_pg/users/rows
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "filter": {
    "id": { "eq": 42 }
  },
  "data": {
    "status": "suspended"
  }
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "affected_rows": 1,
  "data": {
    "affected_rows": 1
  },
  "error": null
}
```

---

### Delete Rows (`DELETE /api/v1/db/:alias/:table/rows`)
*Requires explicit filter object to prevent unbounded accidental full-table purges.*

**Request**:
```http
DELETE /api/v1/db/main_pg/users/rows
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "filter": {
    "status": { "eq": "expired" }
  }
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "affected_rows": 12,
  "data": {
    "affected_rows": 12
  },
  "error": null
}
```

---

### Dynamic DDL: Add Column (`POST /api/v1/db/:alias/:table/columns`)
**Request**:
```http
POST /api/v1/db/main_pg/users/columns
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "name": "mfa_enabled",
  "data_type": "BOOLEAN",
  "nullable": false,
  "default_value": "false"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "database": "main_pg",
    "table": "users",
    "column": "mfa_enabled"
  },
  "error": null
}
```

---

### Dynamic DDL: Modify / Rename Column (`PATCH /api/v1/db/:alias/:table/columns`)
**Request**:
```http
PATCH /api/v1/db/main_pg/users/columns
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "name": "mfa_enabled",
  "new_name": "is_mfa_active"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "database": "main_pg",
    "table": "users",
    "column": "mfa_enabled",
    "new_name": "is_mfa_active",
    "data_type": null
  },
  "error": null
}
```

---

### Dynamic DDL: Drop Column (`DELETE /api/v1/db/:alias/:table/columns` or `DELETE /api/v1/db/:alias/:table/columns/:column_name`)
**Request**:
```http
DELETE /api/v1/db/main_pg/users/columns/is_mfa_active
X-Axiom-Key: <TOKEN>
```
*Alternatively, query parameter or body:*
```http
DELETE /api/v1/db/main_pg/users/columns?name=is_mfa_active
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "database": "main_pg",
    "table": "users",
    "column": "is_mfa_active"
  },
  "error": null
}
```

---

## 3. Blob Storage Data API (`/api/v1/blobs`)

Content-addressed object storage with automatic BLAKE3 deduplication, byte-range streaming, and capability tickets.

### First-Class URL Endpoints Summary
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/blobs/namespaces` | API Key / Session | List storage namespaces accessible by caller's role |
| `GET` | `/api/v1/blobs/namespaces/:namespace` | API Key / Session | Get namespace configuration and quota limits |
| `GET` | `/api/v1/blobs/namespaces/:namespace/usage` | API Key / Session | Inspect space left, used bytes, quota headroom, and object count |
| `GET`, `HEAD` | `/api/v1/blobs/public/:namespace/*key` | Public | Unauthenticated direct media CDN fetch with 304 ETag caching |
| `GET` | `/api/v1/blobs/objects/:namespace` | API Key | List stored objects with `prefix`, `cursor`, `limit` |
| `PUT` | `/api/v1/blobs/objects/:namespace/*key` | API Key / Ticket | Upload object / create directory marker |
| `GET`, `HEAD` | `/api/v1/blobs/objects/:namespace/*key` | API Key / Ticket | Stream object (supports `Range: bytes=X-Y` and capability tickets) |
| `DELETE` | `/api/v1/blobs/objects/:namespace/*key` | API Key | Delete single object and decrement CAS refcount |
| `POST` | `/api/v1/blobs/objects/copy` | API Key | Zero-copy server-side CAS clone (`src_namespace`, `src_key`, `dest_key`) |
| `POST` | `/api/v1/blobs/objects/move` | API Key | Atomic rename / relocate (`src_namespace`, `src_key`, `dest_key`) |
| `POST` | `/api/v1/blobs/objects/:namespace/batch-delete` | API Key | Unified batch delete by explicit key list or directory prefix |
| `POST` | `/api/v1/blobs/objects/:namespace/verify/*key` | API Key / Session | Verify cryptographic BLAKE3 integrity of on-disk shard |
| `POST` | `/api/v1/blobs/uploads/:namespace` | API Key | Initialize multipart / resumable upload session |
| `POST` | `/api/v1/blobs/uploads/:namespace/sign` | API Key | Generate pre-signed direct upload capability URL |
| `PUT`, `PATCH`| `/api/v1/blobs/uploads/:namespace/:upload_id` | API Key | Resumable chunk upload with `Content-Range` header |
| `GET` | `/api/v1/blobs/uploads/:namespace/:upload_id` | API Key | Probe resumable session status and uploaded byte slices |
| `DELETE` | `/api/v1/blobs/uploads/:namespace/:upload_id` | API Key | Abort multipart/resumable upload session |
| `POST` | `/api/v1/blobs/uploads/:namespace/:upload_id/complete` | API Key | Complete and atomically assemble upload |
| `GET` | `/api/v1/blobs/tickets` | API Key / Session | List capability tickets (filter by `namespace` query) |
| `GET` | `/api/v1/blobs/namespaces/:namespace/tickets` | API Key | List capability tickets scoped to a namespace |
| `POST` | `/api/v1/blobs/namespaces/:namespace/tickets` | API Key | Mint a pre-signed capability ticket URL |
| `POST` | `/api/v1/blobs/tickets/:signature/revoke` | API Key / Session | Immediately revoke capability ticket in RAM & DB |
| `POST` | `/api/v1/blobs/tickets/:signature/enable` | API Key / Session | Restore revoked capability ticket |
| `DELETE` | `/api/v1/blobs/tickets/:signature` | API Key / Session | Permanently delete capability ticket |

> [!NOTE]
> All legacy endpoints (`/api/v1/blobs/:namespace/*key`, `/admin/v1/blobs/copy`, `/admin/v1/blobs/move`, etc.) remain fully supported as backward-compatible aliases.

---

### List Storage Namespaces (`GET /api/v1/blobs/namespaces`)
Returns storage namespaces authorized for the caller's role. Admin sessions receive all namespaces; scoped API keys receive authorized namespaces.

**Request**:
```http
GET /api/v1/blobs/namespaces
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "name": "media",
      "public": true,
      "max_size_mb": 5000,
      "default_ttl_seconds": null
    },
    {
      "name": "invoices",
      "public": false,
      "max_size_mb": 10000,
      "default_ttl_seconds": 2592000
    }
  ],
  "error": null
}
```

---

### Storage Space Left & Quota Headroom (`GET /api/v1/blobs/namespaces/:namespace/usage`)
Returns exact byte consumption, allocated quota ceiling, remaining headroom, and object count.

**Request**:
```http
GET /api/v1/blobs/namespaces/media/usage
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "namespace": "media",
    "created_at": 1729800000,
    "is_public": true,
    "max_bytes": 10737418240,
    "used_bytes": 2147483648,
    "remaining_bytes": 8589934592,
    "percent_used": 20.0,
    "total_objects": 142,
    "is_quota_exceeded": false
  },
  "error": null
}
```

---

### Pre-Signed Direct Upload Link (`POST /api/v1/blobs/uploads/:namespace/sign`)
Generates a pre-signed capability URL for direct client upload without distributing root credentials.

**Request**:
```http
POST /api/v1/blobs/uploads/media/sign
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "key": "photos/avatar.jpg",
  "content_type": "image/jpeg",
  "ttl_seconds": 3600
}
```
**Response (`201 Created`)**:
```json
{
  "success": true,
  "data": {
    "url": "/api/v1/blobs/objects/media/photos/avatar.jpg?ticket_sig=...&ticket_exp=...",
    "method": "PUT",
    "headers": {
      "Content-Type": "image/jpeg"
    },
    "expires_at": 1792950000,
    "signature": "..."
  },
  "error": null
}
```

---

### Moving, Copying, and Prefix Deletion
> [!NOTE]
> Moving, copying, and recursive directory prefix deletions are administrative operations guarded by session authentication and audit logging. Refer to [Blob Storage Administration (`/admin/v1/blobs`)](#blob-storage-administration-adminv1blobs) below (`POST /admin/v1/blobs/move`, `POST /admin/v1/blobs/copy`, and `POST /admin/v1/blobs/delete-prefix`).

---

### Delete Folder / Key Prefix (`POST /api/v1/blobs/:namespace/delete-prefix`)
Recursively deletes all objects matching a path prefix (e.g. deleting an entire directory).

**Request**:
```http
POST /api/v1/blobs/media/delete-prefix
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "prefix": "temp/cache/"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted_objects": 42
  },
  "error": null
}
```

---

### Folder Creation / Directory Markers (`PUT /api/v1/blobs/:namespace/*key`)
In object storage, directories are represented by keys ending in `/`. To create an empty folder marker:

**Request**:
```http
PUT /api/v1/blobs/media/uploads/documents/
X-Axiom-Key: <TOKEN>
Content-Type: application/x-directory
Content-Length: 0
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "key": "uploads/documents/",
    "namespace": "media",
    "size": 0,
    "content_type": "application/x-directory"
  },
  "error": null
}
```

---

### Upload Object (`PUT /api/v1/blobs/:namespace/*key`)
**Request**:
```http
PUT /api/v1/blobs/media/avatars/user_101.png?ttl=604800
X-Axiom-Key: <TOKEN>
Content-Type: image/png

<binary body>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "namespace": "media",
    "key": "avatars/user_101.png",
    "size": 42100,
    "content_type": "image/png",
    "etag": "a7b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091",
    "deduplicated": false,
    "created_at": 1761400000,
    "expires_at": 1762004800
  },
  "error": null
}
```

---

### Stream & Range Requests (`GET /api/v1/blobs/:namespace/*key`)
**Request**:
```http
GET /api/v1/blobs/media/videos/demo.mp4
X-Axiom-Key: <TOKEN>
Range: bytes=0-1048575
```
**Response (`206 Partial Content`)**:
```http
HTTP/1.1 206 Partial Content
Content-Type: video/mp4
Content-Length: 1048576
Content-Range: bytes 0-1048575/5242880
Accept-Ranges: bytes
ETag: "9f82c...b1"
Cache-Control: public, max-age=86400

<1 MB binary slice>
```

---

### List Stored Objects (`GET /api/v1/blobs/:namespace`)
**Request**:
```http
GET /api/v1/blobs/media?prefix=avatars/&limit=50
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "key": "avatars/user_101.png",
        "size": 42100,
        "content_type": "image/png",
        "etag": "a7b3c4d5e6f7...091",
        "created_at": 1761400000
      },
      {
        "key": "avatars/user_102.png",
        "size": 38920,
        "content_type": "image/png",
        "etag": "b8c4d5e6f7a8...102",
        "created_at": 1761401200
      }
    ],
    "truncated": false,
    "next_cursor": null
  },
  "error": null
}
```

---

### Delete Single Object (`DELETE /api/v1/blobs/:namespace/*key`)
**Request**:
```http
DELETE /api/v1/blobs/media/avatars/user_101.png
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "namespace": "media",
    "key": "avatars/user_101.png"
  },
  "error": null
}
```

---

### Batch Delete Objects (`POST /api/v1/blobs/:namespace/delete-objects`)
**Request**:
```http
POST /api/v1/blobs/media/delete-objects
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "keys": [
    "avatars/old_01.png",
    "avatars/old_02.png"
  ]
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted_objects": 2
  },
  "error": null
}
```

---

### Mint Pre-Signed Capability Tickets (`POST /api/v1/blobs/:namespace/ticket`)
**Request**:
```http
POST /api/v1/blobs/media/ticket
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "key": "reports/q3_earnings.pdf",
  "operation": "READ",
  "ttl_seconds": 3600
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "ticket": "v1.media.reports_q3_earnings_pdf.READ.1761403600.f7a8b9c0d1e2...",
    "ticket_url": "http://127.0.0.1:4500/api/v1/blobs/media/reports/q3_earnings.pdf?ticket=v1.media.reports_q3_earnings_pdf.READ.1761403600.f7a8b9c0d1e2...",
    "signature": "f7a8b9c0d1e2...",
    "operation": "READ",
    "expires_at": 1761403600
  },
  "error": null
}
```

---

### Resumable Chunked Upload Protocol

#### 1. Initialize Resumable Session (`POST /api/v1/blobs/:namespace/uploads`)
**Request**:
```http
POST /api/v1/blobs/media/uploads
X-Axiom-Key: <TOKEN>
Content-Type: application/json
```
```json
{
  "key": "backups/database_dump.tar.gz",
  "content_type": "application/gzip",
  "total_bytes": 5242880
}
```
**Response (`201 Created`)**:
```json
{
  "success": true,
  "data": {
    "upload_id": "up_7f10a82b9c3e4d5f",
    "namespace": "media",
    "key": "backups/database_dump.tar.gz"
  },
  "error": null
}
```

#### 2. Upload Chunk Slice with Content-Range (`PATCH /api/v1/blobs/:namespace/uploads/:upload_id`)
**Request**:
```http
PATCH /api/v1/blobs/media/uploads/up_7f10a82b9c3e4d5f
X-Axiom-Key: <TOKEN>
Content-Range: bytes 0-1048575/5242880
Content-Type: application/octet-stream

<1 MB chunk binary>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "upload_id": "up_7f10a82b9c3e4d5f",
    "namespace": "media",
    "key": "backups/database_dump.tar.gz",
    "current_bytes": 1048576,
    "total_bytes": 5242880
  },
  "error": null
}
```

#### 3. Probe Session Progress (`GET /api/v1/blobs/:namespace/uploads/:upload_id`)
**Request**:
```http
GET /api/v1/blobs/media/uploads/up_7f10a82b9c3e4d5f
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "upload_id": "up_7f10a82b9c3e4d5f",
    "namespace": "media",
    "key": "backups/database_dump.tar.gz",
    "uploaded_slices": [
      [0, 1048575]
    ],
    "status": "in_progress"
  },
  "error": null
}
```

#### 4. Complete and Assemble Upload (`POST /api/v1/blobs/:namespace/uploads/:upload_id/complete`)
**Request**:
```http
POST /api/v1/blobs/media/uploads/up_7f10a82b9c3e4d5f/complete
X-Axiom-Key: <TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "namespace": "media",
    "key": "backups/database_dump.tar.gz",
    "size": 5242880,
    "content_type": "application/gzip",
    "etag": "d41d8cd98f00b204e9800998ecf8427e",
    "deduplicated": false,
    "created_at": 1761400200
  },
  "error": null
}
```

#### 5. Abort Upload Session (`DELETE /api/v1/blobs/:namespace/uploads/:upload_id`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "aborted": true
  },
  "error": null
}
```

---

## 4. Admin Control Plane API (`/admin/v1`)

All `/admin/v1/*` routes (except setup initialization and login) require an administrative session token:
`Authorization: Bearer <32-char-session-token>`.

### Setup & Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET`, `POST` | `/admin/v1/setup/begin` | Public | Check if setup wizard is required |
| `POST` | `/admin/v1/setup/account` | Setup | Create primary administrative user |
| `POST` | `/admin/v1/setup/database/test` | Setup | Test database URL during setup |
| `POST` | `/admin/v1/setup/database` | Setup | Add initial database connection |
| `POST` | `/admin/v1/setup/complete` | Setup | Complete setup and permanently lock `/setup/*` |
| `POST` | `/admin/v1/auth/login` | Public | Authenticate credentials; returns bearer session token |
| `POST` | `/admin/v1/auth/logout` | Session | Invalidate active session token |
| `GET` | `/admin/v1/users` | Session | Enumerate administrator accounts (read-only; modifications via CLI) |

---

### Setup Begin (`GET /admin/v1/setup/begin`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "setup_required": false
  },
  "error": null
}
```

### Setup Account (`POST /admin/v1/setup/account`)
**Request**:
```http
POST /admin/v1/setup/account
Content-Type: application/json
```
```json
{
  "username": "admin",
  "email": "admin@company.com",
  "password": "CorrectHorseBatteryStaple123!"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "username": "admin",
    "token": "a1b2c3d4e5f6789012345678abcdef01",
    "session_token": "a1b2c3d4e5f6789012345678abcdef01"
  },
  "error": null
}
```

### Setup Test Database (`POST /admin/v1/setup/database/test`)
**Request**:
```http
POST /admin/v1/setup/database/test
Content-Type: application/json
```
```json
{
  "engine": "postgres",
  "url": "postgres://user:secret@127.0.0.1:5432/mydb"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "status": "connected",
    "dialect": "postgres",
    "resolved_url": "postgres://user:****@127.0.0.1:5432/mydb"
  },
  "error": null
}
```

### Setup Register Database (`POST /admin/v1/setup/database`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "Database 'main_pg' registered and verified",
    "dialect": "postgres"
  },
  "error": null
}
```

### Setup Complete (`POST /admin/v1/setup/complete`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "Setup completed successfully"
  },
  "error": null
}
```

---

### Admin Login (`POST /admin/v1/auth/login`)
**Request**:
```http
POST /admin/v1/auth/login
Content-Type: application/json
```
```json
{
  "username": "admin",
  "password": "CorrectHorseBatteryStaple123!"
}
```
**Response (`200 OK`)**:
```http
HTTP/1.1 200 OK
Set-Cookie: axiom_session=a1b2c3d4e5f6789012345678abcdef01; Path=/; HttpOnly; SameSite=Lax
Set-Cookie: axiom_trusted_device=dev_7a8b9c...; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000
Content-Type: application/json
```
```json
{
  "success": true,
  "data": {
    "token": "a1b2c3d4e5f6789012345678abcdef01",
    "session_token": "a1b2c3d4e5f6789012345678abcdef01",
    "username": "admin"
  },
  "error": null
}
```

---

### Admin Logout (`POST /admin/v1/auth/logout`)
**Request**:
```http
POST /admin/v1/auth/logout
Authorization: Bearer <SESSION_TOKEN>
```
**Response (`200 OK`)**:
```http
HTTP/1.1 200 OK
Set-Cookie: axiom_session=; Path=/; Max-Age=0
Content-Type: application/json
```
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  },
  "error": null
}
```

---

### Enumerate Users (`GET /admin/v1/users`)
**Request**:
```http
GET /admin/v1/users
Authorization: Bearer <SESSION_TOKEN>
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "username": "admin",
      "email": "admin@company.com",
      "created_at": 1761400000
    }
  ],
  "error": null
}
```

> [!NOTE]
> **Host-Only Admin User Lifecycle Management**
> For maximum cluster security, after initial setup (`POST /admin/v1/setup/account`), user mutation endpoints (`POST`, `PATCH`, `DELETE`) are intentionally disabled over HTTP. Administrative user accounts can only be added, updated, or removed directly on the host server via the Axiom CLI:
> - **Add user**: `axiom user add <username> [--email <email>] [-p <password>]`
> - **Update user**: `axiom user update <username> [--email <email>] [-p <password>]`
> - **Remove user**: `axiom user remove <username>`

---

### System Telemetry & Operations

#### System Status (`GET /admin/v1/status`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "version": "0.1.16",
    "status": "healthy",
    "uptime_seconds": 84120,
    "active_keys": 3,
    "active_databases": 2,
    "active_roles": 4,
    "cache_entries": 1420
  },
  "error": null
}
```

#### Synchronize Metadata Snapshot (`POST /admin/v1/reload`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "Metadata snapshot successfully synchronized",
    "active_keys": 3,
    "active_databases": 2,
    "active_roles": 4
  },
  "error": null
}
```

#### Admin Health Overview (`GET /admin/v1/health`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime_seconds": 84120,
    "system": {
      "cpu_percent": 1.8,
      "memory_used_mb": 68
    },
    "databases": {
      "main_pg": "up",
      "warehouse_ch": "up"
    }
  },
  "error": null
}
```

#### Control Plane Audit Log (`GET /admin/v1/audit`)
Retrieves immutable chronological audit records for control-plane events (key rotation, role modifications, database connections, schema updates, cache flushes, and administrative logins).

**Query Parameters**:
- `limit` *(integer, optional, default: 50, range: 1..500)*: Maximum number of audit records to return.
- `offset` *(integer, optional, default: 0)*: Number of records to skip for standard offset pagination.
- `cursor` or `before_id` *(integer, optional)*: Fetch records with `id < cursor` for efficient keyset cursor-based backward pagination without performance degradation on large audit logs.

**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "id": 104,
      "timestamp": 1761402200,
      "actor": "admin",
      "action": "CREATE_API_KEY",
      "target": "billing_service",
      "details": "Created key 'billing_service' with role 'service_role'"
    },
    {
      "id": 103,
      "timestamp": 1761401800,
      "actor": "admin",
      "action": "database.add",
      "target": "warehouse_ch",
      "details": "Registered database alias 'warehouse_ch'"
    }
  ],
  "pagination": {
    "limit": 2,
    "offset": 0,
    "has_more": true,
    "next_offset": 2,
    "next_cursor": 103
  },
  "error": null
}
```

---

### API Key Management

#### Enumerate Keys (`GET /admin/v1/keys`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "keys": [
      {
        "id": "key_01",
        "name": "backend_app",
        "role": "admin",
        "rate_limit": 1000,
        "created_at": 1761400000,
        "expires_at": null
      }
    ]
  },
  "error": null
}
```

#### Create Key (`POST /admin/v1/keys`)
**Request**:
```http
POST /admin/v1/keys
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "name": "mobile_client",
  "role": "readonly",
  "rate_limit": 500
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "name": "mobile_client",
    "role": "readonly",
    "token": "bW9iaWxlX2NsaWVudDpkNGVjMmExZjYyODllMjgxNDU2NzE4OTlhYmNkZWYwMQ==",
    "secret": "d4ec2a1f6289e28145671899abcdef01",
    "message": "Save this token now. It will not be shown again."
  },
  "error": null
}
```

#### Rotate Key (`POST /admin/v1/keys/:name/rotate`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "name": "mobile_client",
    "token": "bW9iaWxlX2NsaWVudDo5YTgyY2QxNGY2MjhkMzgxNDU2NzE4OTlhYmNkZWYwMg==",
    "secret": "9a82cd14f628d38145671899abcdef02",
    "message": "Key secret successfully rolled"
  },
  "error": null
}
```

#### Update Key (`PATCH /admin/v1/keys/:name`)
**Request**:
```http
PATCH /admin/v1/keys/mobile_client
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "role": "analytics_viewer",
  "rate_limit": 500,
  "expires_at": 1792900000
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "name": "mobile_client",
    "status": "updated"
  },
  "error": null
}
```

#### Delete Key (`DELETE /admin/v1/keys/:name`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "API key 'mobile_client' deleted successfully"
  },
  "error": null
}
```

---

### RBAC Role Management

#### Enumerate Roles (`GET /admin/v1/roles`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "roles": [
      {
        "name": "readonly",
        "description": "Read-only access across all tables",
        "permissions": [
          {
            "database": "*",
            "table_name": "*",
            "operations": ["SELECT"],
            "rls_filter": null
          }
        ]
      }
    ]
  },
  "error": null
}
```

#### Create Role (`POST /admin/v1/roles`)
**Request**:
```http
POST /admin/v1/roles
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "name": "order_manager",
  "description": "Manage orders and view products",
  "permissions": [
    {
      "database": "main_pg",
      "table_name": "orders",
      "operations": ["SELECT", "INSERT", "UPDATE"],
      "rls_filter": null
    },
    {
      "database": "main_pg",
      "table_name": "products",
      "operations": ["SELECT"],
      "rls_filter": null
    }
  ]
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "name": "order_manager",
    "message": "Role 'order_manager' created successfully"
  },
  "error": null
}
```

#### Update Role (`PATCH /admin/v1/roles/:name`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "Role 'order_manager' updated successfully"
  },
  "error": null
}
```

#### Delete Role (`DELETE /admin/v1/roles/:name`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "Role 'order_manager' deleted successfully"
  },
  "error": null
}
```

---

### Database Connection Management

#### Enumerate Databases (`GET /admin/v1/databases`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "databases": [
      {
        "alias": "main_pg",
        "dialect": "postgres",
        "engine": "postgres",
        "url": "postgres://user:****@127.0.0.1:5432/mydb",
        "status": "connected"
      }
    ]
  },
  "error": null
}
```

#### Register Database (`POST /admin/v1/databases`)
**Request**:
```http
POST /admin/v1/databases
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "alias": "analytics_mysql",
  "engine": "mysql",
  "url": "mysql://root:secret@127.0.0.1:3306/dw"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "alias": "analytics_mysql",
    "dialect": "mysql",
    "engine": "mysql",
    "message": "Database 'analytics_mysql' registered successfully"
  },
  "error": null
}
```

#### Test Raw Database URL (`POST /admin/v1/databases/test-url`)
**Request**:
```http
POST /admin/v1/databases/test-url
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "engine": "postgres",
  "url": "postgres://user:secret@127.0.0.1:5432/testdb"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "status": "connected",
    "latency_ms": 1.45
  },
  "error": null
}
```

#### Test Database Alias Connectivity (`GET /admin/v1/databases/:alias/test`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "alias": "main_pg",
    "status": "connected",
    "dialect": "postgres",
    "latency_ms": 0.85
  },
  "error": null
}
```

#### Update Database (`PATCH /admin/v1/databases/:alias`)
**Request**:
```http
PATCH /admin/v1/databases/analytics_mysql
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "new_alias": "warehouse_mysql",
  "pool_min": 2,
  "pool_max": 20
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "alias": "warehouse_mysql",
    "status": "updated"
  },
  "error": null
}
```

#### Delete Database (`DELETE /admin/v1/databases/:alias`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "Database 'analytics_mysql' deleted successfully"
  },
  "error": null
}
```

---

### Cache Management

#### Inspect Cache Telemetry (`GET /admin/v1/cache/stats`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "l1_ram": {
      "entries": 1420,
      "bytes_used": 12582912,
      "hits": 38410,
      "misses": 2340,
      "hit_ratio": 0.9426
    },
    "l2_storage": {
      "enabled": true,
      "entries": 9840,
      "bytes_used": 89128960
    }
  },
  "error": null
}
```

#### Flush Cache (`POST /admin/v1/cache/flush`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "message": "All cache entries flushed successfully"
  },
  "error": null
}
```

---

### Cluster Mesh Control Plane

#### Cluster Node Status (`GET /admin/v1/cluster/status`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "node_id": "node_7f1a3b8c9d0e",
    "moniker": "us-east-gateway-01",
    "cluster_secret_configured": true,
    "peer_count": 2,
    "cluster_events_received": 184
  },
  "error": null
}
```

#### List Cluster Peers (`GET /admin/v1/cluster/peers`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "node_id": "node_8a2b3c4d5e6f",
      "moniker": "eu-central-gateway-01",
      "url": "https://eu-gw.internal:4500",
      "status": "online",
      "last_ping_ms": 32,
      "last_seen_at": 1761403200
    }
  ],
  "error": null
}
```

#### Connect & Pair Peer (`POST /admin/v1/cluster/peers`)
**Request**:
```http
POST /admin/v1/cluster/peers
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "moniker": "eu-central-gateway-01",
  "url": "https://eu-gw.internal:4500",
  "secret": "ClusterSharedSecretKey"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "node_id": "node_8a2b3c4d5e6f",
    "moniker": "eu-central-gateway-01",
    "status": "connected"
  },
  "error": null
}
```

#### Ping Peer Heartbeat (`POST /admin/v1/cluster/peers/:node_id/ping`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "node_id": "node_8a2b3c4d5e6f",
    "status": "online",
    "latency_ms": 31.4
  },
  "error": null
}
```

#### Update Peer Node (`PATCH /admin/v1/cluster/peers/:node_id`)
**Request**:
```http
PATCH /admin/v1/cluster/peers/node_8a2b3c4d5e6f
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "moniker": "eu-central-backup-01"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "node_id": "node_8a2b3c4d5e6f",
    "status": "updated"
  },
  "error": null
}
```

#### Remove Peer Node (`DELETE /admin/v1/cluster/peers/:node_id`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted": "node_8a2b3c4d5e6f"
  },
  "error": null
}
```

#### Update Local Cluster Moniker (`PATCH /admin/v1/cluster/moniker`)
**Request**:
```http
PATCH /admin/v1/cluster/moniker
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "moniker": "us-east-core-01"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "moniker": "us-east-core-01"
  },
  "error": null
}
```

---

### Blob Storage Administration (`/admin/v1/blobs`)

#### Storage-Wide Telemetry (`GET /admin/v1/blobs/stats`)
Retrieves aggregated storage metrics across all namespaces, including logical volume, physical disk volume, and deduplication savings.

**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "total_objects": 28420,
    "unique_blobs": 12150,
    "total_logical_bytes": 142857142857,
    "total_physical_bytes": 42857142857,
    "dedup_saved_bytes": 100000000000,
    "inline_objects": 24100,
    "file_objects": 4320
  },
  "error": null
}
```

#### Storage Integrity Scrub (`POST /admin/v1/blobs/scrub`)
Triggers an asynchronous background verification of all stored objects, checking cryptographic BLAKE3 content-hashes against recorded index metadata.

**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "verified_blobs": 28420,
    "corrupted_blobs": 0
  },
  "error": null
}
```

#### Expired Object TTL Cleanup (`POST /admin/v1/blobs/sweep`)
Sweeps the storage engine partition and eagerly reclaims disk space occupied by objects whose `expires_at` TTL timestamp has elapsed.

**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "swept_objects": 14
  },
  "error": null
}
```

#### List Storage Namespaces (`GET /admin/v1/blobs/namespaces`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "name": "media",
      "max_bytes": 107374182400,
      "current_bytes": 42857142857,
      "public_read": true
    },
    {
      "name": "backups",
      "max_bytes": 536870912000,
      "current_bytes": 104857600000,
      "public_read": false
    }
  ],
  "error": null
}
```

#### Create Storage Namespace (`POST /admin/v1/blobs/namespaces`)
**Request**:
```http
POST /admin/v1/blobs/namespaces
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "name": "invoices",
  "max_bytes": 10737418240,
  "public_read": false
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "name": "invoices",
    "max_bytes": 10737418240,
    "public_read": false
  },
  "error": null
}
```

---

### Copy Object / Prefix (`POST /admin/v1/blobs/copy`)
**Request**:
```http
POST /admin/v1/blobs/copy
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "src_namespace": "invoices",
  "src_key": "2026/inv_001.pdf",
  "dest_namespace": "invoices",
  "dest_key": "archive/2026/inv_001.pdf",
  "is_prefix": false
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "key": "archive/2026/inv_001.pdf",
    "namespace": "invoices",
    "size": 1048576,
    "content_type": "application/pdf"
  },
  "error": null
}
```

---

### Move / Rename Object (`POST /admin/v1/blobs/move`)
**Request**:
```http
POST /admin/v1/blobs/move
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "src_namespace": "invoices",
  "src_key": "draft_inv.pdf",
  "dest_key": "final_inv_001.pdf"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "key": "final_inv_001.pdf",
    "namespace": "invoices",
    "size": 1048576,
    "content_type": "application/pdf"
  },
  "error": null
}
```

---

### Delete Prefix Tree (`POST /admin/v1/blobs/delete-prefix`)
Recursively deletes an entire directory tree or key prefix within a namespace.
**Request**:
```http
POST /admin/v1/blobs/delete-prefix
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "namespace": "invoices",
  "prefix": "2024/temporary/"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted_objects": 42
  },
  "error": null
}
```

---

### Update Storage Namespace (`PATCH /admin/v1/blobs/namespaces/:namespace`)
**Request**:
```http
PATCH /admin/v1/blobs/namespaces/invoices
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "max_bytes": 21474836480,
  "public_read": false
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "namespace": "invoices",
    "status": "updated"
  },
  "error": null
}
```

---

### Delete Storage Namespace (`DELETE /admin/v1/blobs/namespaces/:namespace`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted": "invoices"
  },
  "error": null
}
```

---

### Admin Delete Prefix (`POST /admin/v1/blobs/delete-prefix`)
**Request**:
```http
POST /admin/v1/blobs/delete-prefix
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```
```json
{
  "namespace": "invoices",
  "prefix": "temp/"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted_objects": 18
  },
  "error": null
}
```

---

### Verify Object Hash Integrity (`POST /admin/v1/blobs/verify/:namespace/*key`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "valid": true
  },
  "error": null
}
```

---

### Enumerate Capability Tickets (`GET /admin/v1/blobs/tickets`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": [
    {
      "signature": "sig_abc123def456",
      "namespace": "invoices",
      "key": "2026/inv_001.pdf",
      "operation": "READ",
      "expires_at": 1792800000
    }
  ],
  "error": null
}
```

---

### Revoke Capability Ticket (`POST /admin/v1/blobs/tickets/:signature/revoke`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "signature": "sig_abc123def456",
    "status": "revoked"
  },
  "error": null
}
```

---

### Delete Capability Ticket (`DELETE /admin/v1/blobs/tickets/:signature`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "deleted": "sig_abc123def456"
  },
  "error": null
}
```

---

## 5. Cluster Mesh Internal P2P Protocol (`/internal/v1/cluster`)

Internal inter-node coordination endpoints protected by mutual HMAC-SHA256 authentication.

### Mandatory Inter-Node Headers
* `X-Axiom-Node-ID`: The sender node's unique cluster ID.
* `X-Axiom-Timestamp`: Unix millisecond timestamp (rejected if clock drift exceeds ±30s).
* `X-Axiom-Signature`: Hex-encoded `HMAC-SHA256(cluster_secret, timestamp + body)`.

---

### P2P Handshake (`POST /internal/v1/cluster/handshake`)
**Request**:
```http
POST /internal/v1/cluster/handshake
X-Axiom-Node-ID: node_7f1a3b8c9d0e
X-Axiom-Timestamp: 1761400000000
X-Axiom-Signature: <HMAC_HEX>
Content-Type: application/json
```
```json
{
  "node_id": "node_7f1a3b8c9d0e",
  "moniker": "us-east-gateway-01",
  "url": "https://us-east.internal:4500"
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "node_id": "node_8a2b3c4d5e6f",
  "moniker": "eu-central-gateway-01",
  "url": "https://eu-central.internal:4500",
  "cluster_version": "0.1.16"
}
```

---

### Heartbeat Latency Probe (`GET /internal/v1/cluster/ping`)
**Response (`200 OK`)**:
```json
{
  "pong": true,
  "timestamp": 1761400000120
}
```

---

### Gossip Event Broadcast (`POST /internal/v1/cluster/event`)
**Request**:
```http
POST /internal/v1/cluster/event
X-Axiom-Node-ID: node_7f1a3b8c9d0e
X-Axiom-Timestamp: 1761400000000
X-Axiom-Signature: <HMAC_HEX>
Content-Type: application/json
```
```json
{
  "event_type": "security_ban",
  "source_node": "node_7f1a3b8c9d0e",
  "payload": {
    "ip": "198.51.100.42",
    "reason": "rate_limit_penalty_threshold_exceeded",
    "duration_seconds": 300
  }
}
```
**Response (`200 OK`)**:
```json
{
  "success": true,
  "accepted": true
}
```

---

### State Sync (`GET /internal/v1/cluster/sync`)
**Response (`200 OK`)**:
```json
{
  "success": true,
  "nodes": [
    {
      "node_id": "node_7f1a3b8c9d0e",
      "moniker": "us-east-gateway-01",
      "url": "https://us-east.internal:4500",
      "status": "online"
    },
    {
      "node_id": "node_8a2b3c4d5e6f",
      "moniker": "eu-central-gateway-01",
      "url": "https://eu-central.internal:4500",
      "status": "online"
    }
  ],
  "synced_at": 1761400000
}
```

---

## 6. Model Context Protocol (MCP) (`POST /mcp/v1`)

JSON-RPC 2.0 Model Context Protocol endpoint for AI coding assistants (Claude Code, Cursor, Copilot, Windsurf). Requires API key or session token.

### 1. Protocol Handshake (`initialize`)
**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "claude-code",
      "version": "1.0.0"
    }
  }
}
```
**Response (`200 OK`)**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {
        "listChanged": false
      },
      "resources": {
        "subscribe": false,
        "listChanged": false
      }
    },
    "serverInfo": {
      "name": "axiom",
      "version": "0.1.16"
    }
  }
}
```

---

### 2. Discover Tools (`tools/list`)
**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```
**Response (`200 OK`)**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "axiom_list_services",
        "description": "List all configured and active database aliases accessible by caller",
        "inputSchema": {
          "type": "object",
          "properties": {}
        }
      },
      {
        "name": "axiom_describe_table",
        "description": "Return columns, datatypes, and foreign keys for a table",
        "inputSchema": {
          "type": "object",
          "properties": {
            "service": { "type": "string" },
            "table": { "type": "string" }
          },
          "required": ["service", "table"]
        }
      },
      {
        "name": "axiom_query",
        "description": "Query table rows with structured filter constraints",
        "inputSchema": {
          "type": "object",
          "properties": {
            "service": { "type": "string" },
            "table": { "type": "string" },
            "filter": { "type": "object" },
            "limit": { "type": "integer" }
          },
          "required": ["service", "table"]
        }
      },
      {
        "name": "axiom_raw_sql",
        "description": "Execute single parameterized SQL query through AST validation firewall",
        "inputSchema": {
          "type": "object",
          "properties": {
            "service": { "type": "string" },
            "query": { "type": "string" },
            "params": { "type": "array" }
          },
          "required": ["service", "query"]
        }
      }
    ]
  }
}
```

---

### 3. Tool Execution (`tools/call`)
**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "axiom_query",
    "arguments": {
      "service": "main_pg",
      "table": "users",
      "filter": {
        "status": { "eq": "active" }
      },
      "limit": 1
    }
  }
}
```
**Response (`200 OK`)**:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"rows\":[{\"id\":1,\"email\":\"alice@corp.internal\",\"status\":\"active\"}],\"count\":1}"
      }
    ],
    "isError": false
  }
}
```

---

### 4. Context Resources (`resources/list` & `resources/read`)
**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/read",
  "params": {
    "uri": "axiom://schema/main_pg"
  }
}
```
**Response (`200 OK`)**:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "contents": [
      {
        "uri": "axiom://schema/main_pg",
        "mimeType": "application/json",
        "text": "{\"database\":\"main_pg\",\"tables\":[\"customers\",\"orders\",\"products\",\"users\"]}"
      }
    ]
  }
}
```

---

## 7. Error Codes & HTTP Status Mapping

All errors conform to the standardized error envelope format:
```json
{
  "success": false,
  "data": null,
  "meta": {
    "request_id": "9b12a84c-3e21-4f10-91a0-c1e48f09d12a"
  },
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<HUMAN_READABLE_DIAGNOSTIC>"
  }
}
```

### Reference Table

| Error Code | HTTP Status | Root Cause | Example Error Message |
|---|---|---|---|
| `WAF_URI_TOO_LONG` | 414 | Request URI exceeds 2,048 bytes | `"Request URI exceeds maximum allowable length of 2048 characters"` |
| `WAF_NULL_BYTE` | 400 | Null byte (`%00`) in path or query | `"Null byte detected in request path or query parameters"` |
| `WAF_PATH_TRAVERSAL` | 400 | Relative `..` traversal detected | `"Path traversal detected after multi-pass decode"` |
| `WAF_BODY_TOO_LARGE` | 413 | Payload exceeds `body_limit` | `"Request body exceeds maximum allowable limit of 10485760 bytes"` |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate quota ceiling reached | `"Too many requests. Quota exceeded for this client window."` |
| `BANNED` | 403 | IP or key banned for violations | `"Access denied. This client IP has been banned due to repeated security anomalies."` |
| `AUTH_INVALID` | 401 | Missing or bad credentials | `"Missing or invalid API key or administrative session."` |
| `AUTH_FORBIDDEN` | 403 | RBAC role lacks permission | `"Role 'analyst' lacks INSERT permission on 'main_pg.users'"` |
| `RLS_VIOLATION` | 403 | Operation violates RLS predicate | `"Operation restricted by row-level security policy on target table"` |
| `STORAGE_QUOTA_EXCEEDED` | 413 | Storage namespace quota full | `"Target blob namespace 'media' has exceeded its 100 GB capacity ceiling"` |
| `MULTI_STATEMENT_DENIED` | 400 | Query contains stacked statements | `"Stacked queries with semicolons are blocked by AST firewall"` |
| `RANGE_NOT_SATISFIABLE` | 416 | Byte range offset exceeds file | `"Requested range cannot be satisfied: start offset beyond file boundary"` |
| `DB_NOT_FOUND` | 404 | Database alias not configured | `"Database alias 'analytics_pg' not found"` |
| `SQL_PARSE_ERROR` | 400 | SQL AST parsing error | `"Syntax error at or near 'FORM': Expected FROM clause"` |
| `CLUSTER_PEER_UNREACHABLE` | 502 | Peer node offline | `"Connection failed: cluster peer node 'node_8a' timed out after 3000ms"` |
| `CLUSTER_AUTH_FAILED` | 401 | HMAC-SHA256 signature mismatch | `"Inter-node cluster HMAC signature verification failed or timestamp drift exceeded"` |
| `CLUSTER_HANDSHAKE_ERROR` | 400 | Handshake rejected | `"Peer node handshake failed: cluster shared secret mismatch"` |

---

Maintained by [Toxichome](https://toxichome.cc). Licensed under the [MIT License](../LICENSE).

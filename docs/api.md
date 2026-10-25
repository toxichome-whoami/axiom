<div align="center">

# Axiom API Reference

### Unified REST Data API, Blob Storage, Admin Control Plane, and MCP Specification

[![Version](https://img.shields.io/badge/version-0.1.16%2B-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](../LICENSE)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-111827.svg?style=flat-square)](https://modelcontextprotocol.io)

</div>

---

## 1. Quick Start & Authentication

* **Base URL**: `http://127.0.0.1:4500`

### Authentication Schemes
| Scope | Header Syntax | Description |
|---|---|---|
| **Data Plane (`/api/v1/*`)** | `X-Axiom-Key: <base64(name:secret)>` | Machine-to-machine scoped API key |
| **Control Plane (`/admin/v1/*`)** | `Authorization: Bearer <session-token>` | 32-char token from `POST /admin/v1/auth/login` |
| **Cluster Mesh (`/internal/v1/*`)** | `X-Axiom-Signature: <hex(HMAC-SHA256)>` | Inter-node P2P peer authentication |
| **Capability Ticket (Blob)** | `?ticket=v1.<ns>.<key>.<op>.<exp>.<sig>` | Pre-signed delegated URL parameter |

### Standard Response Envelopes
All API responses return a unified JSON envelope:

```json
// Success Response (HTTP 200 / 201)
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

// Error Response (HTTP 4xx / 5xx)
{
  "success": false,
  "data": null,
  "meta": {
    "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a",
    "duration_ms": 0.85
  },
  "error": {
    "code": "BAD_REQUEST",
    "message": "Detailed description of error condition"
  }
}
```

---

## 2. API Architecture Trees

### Data Plane (`/api/v1`)
High-throughput application data access, parameterized SQL queries, row CRUD, keyset pagination, and byte-range blob streaming.

```text
/api/v1
│
├── health                                         GET     Data plane health check probe
│
├── db/                                            [Database Data Plane & Query Engine]
│   ├── databases                                  GET     Discover accessible databases for caller's role (engine, status, tables)
│   │
│   └── :db_name/
│       ├── tables                                 GET     List tables in database (filtered by role permissions, supports limit/cursor)
│       ├── query                                  POST    Execute parameterized SQL statement (AST safety firewall + Idempotency-Key)
│       │
│       └── :table_name/
│           ├── rows/
│           │   ├── /                              GET     Query table records (keyset pagination, JSON filters, sorting)
│           │   ├── /                              POST    Insert records (single or batch with Idempotency-Key replay protection)
│           │   ├── /                              PATCH   Update records (requires mandatory filter predicate)
│           │   └── /                              DELETE  Delete records (requires mandatory filter predicate)
│           │
│           └── columns/
│               ├── /                              GET     Inspect table columns & schema (types, nullability, PKs, FKs)
│               ├── /                              POST    Dynamic DDL: Add new column to table (name, data_type, nullable, default)
│               └── :column_name/
│                   ├── /                          PATCH   Dynamic DDL: Modify column type or rename column (:column_name)
│                   └── /                          DELETE  Dynamic DDL: Drop column via canonical RESTful path parameter
│
└── blobs/                                         [Native Blob Storage & Object Engine]
    ├── public/:namespace/*key                     GET     Unauthenticated edge CDN streaming (ETags, conditional 304, Range headers)
    ├── public/:namespace/*key                     HEAD    Probe object metadata, Content-Length, and ETag without streaming body
    │
    ├── namespaces/                                [Namespace & Quota Telemetry (Read-Only Discovery)]
    │   ├── /                                      GET     List storage namespaces authorized for caller's role
    │   └── :namespace/
    │       ├── /                                  GET     Inspect namespace configuration details and public read status
    │       └── usage                              GET     Live quota inspection (used bytes, remaining headroom, object count)
    │
    ├── objects/                                   [Content-Addressed Storage (CAS) Object Operations]
    │   ├── copy                                   POST    Cross-namespace zero-copy CAS clone (src_namespace, dest_namespace)
    │   ├── move                                   POST    Cross-namespace atomic relocate (src_namespace, dest_namespace)
    │   │
    │   └── :namespace/
    │       ├── /                                  GET     List objects in namespace (prefix filter, cursor pagination, limit)
    │       ├── copy                               POST    Namespace-scoped zero-copy CAS clone (src_key, dest_key)
    │       ├── move                               POST    Namespace-scoped atomic relocate (src_key, dest_key)
    │       ├── batch-delete                       POST    Unified batch delete by explicit key list or directory prefix
    │       ├── verify/*key                        POST    Verify cryptographic BLAKE3 integrity of on-disk blob shard
    │       └── *key/
    │           ├── /                              PUT     Upload object / create directory marker (automatic BLAKE3 deduplication)
    │           ├── /                              GET     Stream object binary (supports Range: bytes=X-Y, ETags, capability tickets)
    │           ├── /                              HEAD    Probe object headers (size, content-type, ETag, last-modified)
    │           └── /                              DELETE  Delete object and decrement CAS reference count
    │
    ├── uploads/                                   [Resumable & Multipart Upload Protocol]
    │   └── :namespace/
    │       ├── /                                  POST    Initialize resumable session (key, content_type, total_bytes)
    │       ├── sign                               POST    Generate pre-signed direct upload capability URL
    │       └── :upload_id/
    │           ├── /                              GET     Probe upload progress and inspect received byte ranges
    │           ├── /                              PUT     Upload chunk slice with Content-Range (bytes 0-1048575/5242880)
    │           ├── /                              PATCH   Append chunk slice with Content-Range
    │           ├── /                              DELETE  Abort upload session and clean up staged chunk artifacts
    │           ├── parts/:part                    PUT     Upload numbered part slice (S3-compatible multipart pattern)
    │           └── complete                       POST    Finalize and atomically assemble multipart session into CAS store
    │
    └── tickets/                                   [Namespace-Scoped Capability Ticket Plane]
        └── :namespace/
            ├── /                                  GET     List capability tickets in namespace (cursor keyset pagination)
            ├── /                                  POST    Mint pre-signed capability ticket URL (key, operation, ttl_seconds)
            └── :signature/
                ├── revoke                         POST    Revoke capability ticket immediately in RAM and SQLite store
                ├── enable                         POST    Restore previously revoked capability ticket
                └── /                              DELETE  Permanently purge capability ticket record
```

---

### Control Plane (`/admin/v1`)
Infrastructure management, connection pool topology, security secrets, inter-node gossip mesh, and storage quotas.

```text
/admin/v1
│
├── auth/                                          [Session & Authentication Lifecycle]
│   ├── login                                      POST    Authenticate administrator credentials & issue session token
│   └── logout                                     POST    Revoke active session token & clear session cookie
│
├── setup/                                         [First-Run Installation & Provisioning Wizard]
│   ├── begin                                      GET     Check installation wizard status and initialized state
│   ├── begin                                      POST    Initialize first-run setup state
│   ├── account                                    POST    Provision initial root administrator credentials
│   ├── database                                   POST    Provision initial primary database connection
│   ├── database/test                              POST    Test primary database connectivity during setup wizard
│   └── complete                                   POST    Seal setup wizard and transition instance to production mode
│
├── status                                         GET     System telemetry (version, uptime, memory, CPU, engine status)
├── health                                         GET     Administrative health check probe
├── metrics                                        GET     Prometheus & JSON metrics snapshot (QPS, error rates, latencies)
├── audit                                          GET     Query tamper-evident audit log ledger (filtered by user/action/date)
├── reload                                         POST    Hot-reload metadata configuration snapshot from disk
├── users                                          GET     List administrator accounts (mutations restricted to local CLI)
│
├── keys/                                          [API Key Lifecycle & Secret Provisioning]
│   ├── /                                          GET     List all active API keys (associated roles, rate limits, expiry)
│   ├── /                                          POST    Mint new API key (name, role, rate_limit, optional TTL)
│   └── :name/
│       ├── /                                      PATCH   Update API key role, rate limit, or expiration timestamp
│       ├── /                                      DELETE  Immediately revoke and delete API key
│       └── rotate                                 POST    Atomic zero-downtime key secret rotation (issues new secret)
│
├── roles/                                         [Fine-Grained RBAC Policy Matrix]
│   ├── /                                          GET     List all RBAC roles and permission matrices
│   ├── /                                          POST    Create custom RBAC role with database/table/storage grants
│   └── :name/
│       ├── /                                      PATCH   Update role permissions and resource policy rules
│       └── /                                      DELETE  Delete custom role (protected system roles immutable)
│
├── databases/                                     [Database Connection Pools & Topology]
│   ├── /                                          GET     List all registered database connection pools (credentials masked)
│   ├── /                                          POST    Register new database connection pool (alias, URL, pool size)
│   ├── test-url                                   POST    Test connection & latency for uncommitted DSN / connection string
│   └── :alias/
│       ├── /                                      PATCH   Update connection pool parameters (pool size, mode, URL, timeout)
│       ├── /                                      DELETE  Unregister database pool and remove metadata record
│       └── test                                   GET     Probe live health & latency of an existing database alias
│
├── cache/                                         [Distributed L1 / L2 Query Cache Control]
│   ├── stats                                      GET     Inspect cache metrics (hit ratios, cached ASTs, memory footprint)
│   └── flush                                      POST    Invalidate and evict all query, schema, and policy caches
│
├── cluster/                                       [Inter-Node P2P Mesh Governance]
│   ├── status                                     GET     Cluster health, local Node ID, moniker, and active peer count
│   ├── moniker                                    PATCH   Update local node's human-friendly display moniker
│   └── peers/
│       ├── /                                      GET     List all connected mesh peers, addresses, and sync states
│       ├── /                                      POST    Initiate mutual handshake and register remote peer node
│       └── :node_id/
│           ├── /                                  PATCH   Update peer address, port, or connection configuration
│           ├── /                                  DELETE  Disconnect and unregister peer node from mesh
│           └── ping                               POST    Measure roundtrip P2P latency to target peer node
│
└── blobs/                                         [Storage Control Plane & Governance]
    ├── stats                                      GET     Cluster-wide storage stats (CAS objects, disk used, deduplication ratio)
    ├── scrub                                      POST    Trigger cluster-wide cryptographic BLAKE3 bit-rot verification
    ├── sweep                                      POST    Trigger immediate garbage collection sweep of expired TTL blobs
    │
    ├── namespaces/                                [Storage Namespace Provisioning & Quotas]
    │   ├── /                                      GET     List all storage namespaces, byte quotas, and access policies
    │   ├── /                                      POST    Provision new storage namespace (quota bytes, public read toggle)
    │   └── :namespace/
    │       ├── /                                  GET     Inspect namespace quota allocation and configuration details
    │       ├── /                                  PATCH   Update namespace byte quota or public read access policy
    │       └── /                                  DELETE  Delete storage namespace and unregister its object index
    │
    └── tickets/                                   [Cluster-Wide Security Audit & Emergency Control]
        ├── /                                      GET     Audit all capability tickets cluster-wide (cursor pagination)
        └── :signature/
            ├── revoke                             POST    Cluster-wide emergency revocation of capability ticket
            ├── enable                             POST    Cluster-wide restoration of revoked capability ticket
            └── /                                  DELETE  Permanently purge capability ticket record from cluster
```

---

## 3. Database Data API (`/api/v1/db`)

### Parameterized SQL Query
```http
POST /api/v1/db/main_pg/query
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{
  "sql": "SELECT id, email, status FROM users WHERE status = $1 LIMIT 10",
  "params": ["active"]
}
```
*Response*:
```json
{
  "success": true,
  "data": {
    "columns": ["id", "email", "status"],
    "rows": [
      [1, "alice@example.com", "active"],
      [2, "bob@example.com", "active"]
    ],
    "affected_rows": 2
  }
}
```

---

### Row Queries & Keyset Pagination
```http
GET /api/v1/db/main_pg/users/rows?limit=2&sort=id&order=asc&filter={"status":{"eq":"active"}}
X-Axiom-Key: <TOKEN>
```
*Response*:
```json
{
  "success": true,
  "data": {
    "rows": [
      { "id": 1, "email": "alice@example.com", "status": "active" },
      { "id": 2, "email": "bob@example.com", "status": "active" }
    ],
    "columns": ["id", "email", "status"],
    "next_cursor": "eyJpZCI6Mn0=",
    "has_more": true
  }
}
```

---

### Filter Operators Reference
Passed via the URL parameter `filter={...}` on `GET|PATCH|DELETE /rows`:

| Operator | Syntax Example | Meaning |
|---|---|---|
| `eq` | `{"status": {"eq": "active"}}` | Equals (`=`) |
| `neq` | `{"status": {"neq": "banned"}}` | Not equals (`!=`) |
| `gt` / `gte` | `{"age": {"gte": 18}}` | Greater than / or equal (`>` / `>=`) |
| `lt` / `lte` | `{"price": {"lte": 99.99}}` | Less than / or equal (`<` / `<=`) |
| `like` | `{"email": {"like": "%@gmail.com"}}` | Case-sensitive pattern match (`LIKE`) |
| `ilike` | `{"name": {"ilike": "%smith%"}}` | Case-insensitive pattern match (`ILIKE`) |
| `in` | `{"role": {"in": ["admin", "editor"]}}` | Match any item in array (`IN (...)`) |
| `nin` | `{"status": {"nin": ["archived", "deleted"]}}` | Match none in array (`NOT IN (...)`) |
| `is_null` | `{"deleted_at": {"is_null": true}}` | Nullity check (`IS NULL` / `IS NOT NULL`) |
| `and` | `{"and": [{"age": {"gte": 18}}, {"verified": {"eq": true}}]}` | Logical conjunction (`AND`) |
| `or` | `{"or": [{"tier": {"eq": "pro"}}, {"credits": {"gt": 0}}]}` | Logical disjunction (`OR`) |

---

### Row Mutations (Insert, Update, Delete)

* **Insert Rows**:
  ```http
  POST /api/v1/db/main_pg/users/rows
  X-Axiom-Key: <TOKEN>
  Idempotency-Key: req_12345
  Content-Type: application/json

  {
    "data": [
      { "email": "charlie@example.com", "status": "active" }
    ]
  }
  ```

* **Update Rows** (*filter is mandatory to prevent accidental full-table overwrites*):
  ```http
  PATCH /api/v1/db/main_pg/users/rows
  X-Axiom-Key: <TOKEN>
  Content-Type: application/json

  {
    "filter": { "id": { "eq": 42 } },
    "data": { "status": "suspended" }
  }
  ```

* **Delete Rows** (*filter is mandatory*):
  ```http
  DELETE /api/v1/db/main_pg/users/rows
  X-Axiom-Key: <TOKEN>
  Content-Type: application/json

  {
    "filter": { "status": { "eq": "expired" } }
  }
  ```

---

### Column Inspection & Dynamic DDL

* **Inspect Table Columns & Schema**:
  ```http
  GET /api/v1/db/main_pg/users/columns
  X-Axiom-Key: <TOKEN>
  ```
  *Response*:
  ```json
  {
    "success": true,
    "data": {
      "database": "main_pg",
      "table": "users",
      "columns": [
        { "name": "id", "data_type": "BIGINT", "nullable": false, "primary_key": true },
        { "name": "email", "data_type": "VARCHAR(255)", "nullable": false }
      ],
      "foreign_keys": []
    }
  }
  ```

* **Add Column**:
  ```http
  POST /api/v1/db/main_pg/users/columns
  X-Axiom-Key: <TOKEN>
  Content-Type: application/json

  {
    "name": "is_mfa_active",
    "data_type": "BOOLEAN",
    "nullable": false,
    "default_value": "false"
  }
  ```

* **Modify / Rename Column**:
  ```http
  PATCH /api/v1/db/main_pg/users/columns/is_mfa_active
  X-Axiom-Key: <TOKEN>
  Content-Type: application/json

  {
    "new_name": "mfa_enabled"
  }
  ```

* **Drop Column**:
  ```http
  DELETE /api/v1/db/main_pg/users/columns/mfa_enabled
  X-Axiom-Key: <TOKEN>
  ```

---

## 4. Blob Storage Data API (`/api/v1/blobs`)

### Direct Upload & Download
* **Upload Object** (Automatic BLAKE3 deduplication):
  ```http
  PUT /api/v1/blobs/objects/media/reports/q3.pdf
  X-Axiom-Key: <TOKEN>
  Content-Type: application/pdf

  <binary file bytes>
  ```

* **Download / Stream Object** (Supports byte ranges):
  ```http
  GET /api/v1/blobs/objects/media/reports/q3.pdf
  X-Axiom-Key: <TOKEN>
  Range: bytes=0-1048575
  ```

* **Delete Object**:
  ```http
  DELETE /api/v1/blobs/objects/media/reports/q3.pdf
  X-Axiom-Key: <TOKEN>
  ```

* **Batch Delete Objects**:
  ```http
  POST /api/v1/blobs/objects/media/batch-delete
  X-Axiom-Key: <TOKEN>
  Content-Type: application/json

  {
    "keys": ["old_file1.txt", "old_file2.txt"],
    "prefix": "temp/cache/"
  }
  ```

---

### Resumable Chunked Uploads
1. **Initialize Session**:
   ```http
   POST /api/v1/blobs/uploads/media
   X-Axiom-Key: <TOKEN>
   Content-Type: application/json

   { "key": "backups/dump.tar.gz", "total_bytes": 52428800 }
   ```
   *Response provides `"upload_id": "up_abc123"`*.

2. **Upload Chunk**:
   ```http
   PUT /api/v1/blobs/uploads/media/up_abc123
   X-Axiom-Key: <TOKEN>
   Content-Range: bytes 0-10485759/52428800

   <10 MB slice>
   ```

3. **Complete Upload**:
   ```http
   POST /api/v1/blobs/uploads/media/up_abc123/complete
   X-Axiom-Key: <TOKEN>
   ```

---

### Capability Tickets (Time-Limited Pre-Signed URLs)
Delegates read/write access to clients without sharing master API keys:

* **Mint Ticket**:
  ```http
  POST /api/v1/blobs/tickets/media
  X-Axiom-Key: <TOKEN>
  Content-Type: application/json

  {
    "key": "reports/q3.pdf",
    "operation": "READ",
    "ttl_seconds": 3600
  }
  ```
  *Response*:
  ```json
  {
    "success": true,
    "data": {
      "ticket_url": "http://127.0.0.1:4500/api/v1/blobs/objects/media/reports/q3.pdf?ticket=v1.media...",
      "signature": "sig_abc123def456",
      "expires_at": 1792800000
    }
  }
  ```

* **List Tickets** (Keyset cursor pagination):
  ```http
  GET /api/v1/blobs/tickets/media?limit=25&cursor=1761400000_42
  X-Axiom-Key: <TOKEN>
  ```

* **Revoke Ticket**:
  ```http
  POST /api/v1/blobs/tickets/media/sig_abc123def456/revoke
  X-Axiom-Key: <TOKEN>
  ```

---

## 5. Model Context Protocol (MCP) (`POST /mcp/v1`)

Axiom exposes full database and storage capabilities to AI coding agents via standard JSON-RPC 2.0:

```http
POST /mcp/v1
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "db_query",
    "arguments": {
      "database": "main_pg",
      "sql": "SELECT COUNT(*) FROM users;"
    }
  }
}
```

*Built-in AI Tools*: `db_list`, `db_schema`, `db_query`, `db_rows_read`, `db_rows_insert`, `db_rows_update`, `db_rows_delete`, `db_column_add`, `db_column_modify`, `db_column_drop`, `blob_list`, `blob_read`, `blob_write`, `blob_delete`, `blob_ticket_mint`.

---

## 6. Error Reference & Codes

| HTTP Status | Error Code | Common Trigger |
|---|---|---|
| `400 Bad Request` | `BAD_REQUEST` / `INVALID_PAYLOAD` | Missing required fields or malformed JSON |
| `400 Bad Request` | `AST_VALIDATION_ERROR` | SQL rejected by AST parser or disallowed keyword |
| `401 Unauthorized` | `UNAUTHORIZED` | Missing, malformed, or expired `X-Axiom-Key` |
| `403 Forbidden` | `FORBIDDEN` | Caller role lacks required privilege on database/table |
| `404 Not Found` | `NOT_FOUND` / `DB_NOT_FOUND` | Database alias, table, or blob key does not exist |
| `429 Too Many Requests` | `RATE_LIMITED` | IP or API key exceeded sliding-window rate limit |
| `500 Internal Error` | `INTERNAL_SERVER_ERROR` | Upstream database error or unexpected server failure |

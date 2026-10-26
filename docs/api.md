<div align="center">

# Axiom API Reference

### Unified REST Data API, Blob Storage, Admin Control Plane, and MCP Specification

[![Version](https://img.shields.io/badge/version-0.1.18%2B-111827.svg?style=flat-square)](https://github.com/toxichome-whoami/axiom/releases)
[![Rust](https://img.shields.io/badge/rust-1.88%2B-b7410e.svg?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827.svg?style=flat-square)](../LICENSE)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-111827.svg?style=flat-square)](https://modelcontextprotocol.io)

</div>

## Contents

1. [Quick Start](#1-quick-start)
2. [Authentication](#2-authentication)
3. [Conventions](#3-conventions)
4. [Endpoint Index](#4-endpoint-index)
5. [Database Data API](#5-database-data-api-apiv1db)
6. [Blob Storage API](#6-blob-storage-api-apiv1blobs)
7. [Model Context Protocol (MCP)](#7-model-context-protocol-mcp)
8. [Errors](#8-errors)

## 1. Quick Start

**Base URL:** `http://127.0.0.1:4500`

Three steps to your first query:

```bash
# 1. Build your API key header value: base64(name:secret)
export AXIOM_KEY=$(echo -n 'my-key:my-secret' | base64)

# 2. Check the data plane is up
curl http://127.0.0.1:4500/api/v1/health -H "X-Axiom-Key: $AXIOM_KEY"

# 3. Discover which databases your role can access
curl http://127.0.0.1:4500/api/v1/db/databases -H "X-Axiom-Key: $AXIOM_KEY"
```

> Examples below use `<TOKEN>` as a placeholder for the value of `$AXIOM_KEY`.

## 2. Authentication

Axiom has four planes, each with its own credential.

| Plane                 | Path prefix      | Credential                               | Notes                                               |
| --------------------- | ---------------- | ---------------------------------------- | --------------------------------------------------- |
| **Data**              | `/api/v1/*`      | `X-Axiom-Key: <base64(name:secret)>`     | Machine-to-machine, scoped API key                  |
| **Control**           | `/admin/v1/*`    | `Authorization: Bearer <session-token>`  | 32-character token from `POST /admin/v1/auth/login` |
| **Cluster mesh**      | `/internal/v1/*` | `X-Axiom-Signature: <hex(HMAC-SHA256)>`  | Node-to-node only; not for application use          |
| **Capability ticket** | blob URLs        | `?ticket=v1.<ns>.<key>.<op>.<exp>.<sig>` | Pre-signed, time-limited, delegated access          |

## 3. Conventions

### Response envelope

Every response uses the same JSON envelope.

**Success** (`200` / `201`)

```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "8fa921be-4972-4d2c-8cb4-3010b91e9f1a",
    "duration_ms": 1.42,
    "cached": false
  },
  "error": null
}
```

**Error** (`4xx` / `5xx`)

```json
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

Include `meta.request_id` when reporting issues.

### Pagination

List endpoints use **keyset (cursor) pagination**: pass `limit` and `cursor`; responses include `next_cursor` and `has_more`. Treat cursors as opaque strings.

### Idempotency

`POST /db/:db/query` and `POST /db/:db/:table/rows` accept an `Idempotency-Key` header. Retrying with the same key replays the original result instead of re-executing, so it is safe to retry on network failure.

### Safety guards

- `PATCH` and `DELETE` on `/rows` **require a filter**, which prevents accidental full-table writes.
- SQL sent to `/query` passes through an AST safety firewall; rejected statements return `AST_VALIDATION_ERROR`.
- Always use `$1, $2, ...` placeholders with `params`; never interpolate values into `sql`.

## 4. Endpoint Index

### Data plane: `/api/v1`

| Method                           | Path                                        | Description                                                         |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| GET                              | `/health`                                   | Data plane health probe                                             |
| **Database**                     |                                             |                                                                     |
| GET                              | `/db/databases`                             | Databases accessible to the caller's role (engine, status, tables)  |
| GET                              | `/db/:db/tables`                            | List tables (role-filtered; `limit` / `cursor`)                     |
| POST                             | `/db/:db/query`                             | Execute parameterized SQL (AST firewall, `Idempotency-Key`)         |
| GET                              | `/db/:db/:table/rows`                       | Query rows (keyset pagination, JSON filters, sorting)               |
| POST                             | `/db/:db/:table/rows`                       | Insert one or many rows (`Idempotency-Key` supported)               |
| PATCH                            | `/db/:db/:table/rows`                       | Update rows (filter required)                                       |
| DELETE                           | `/db/:db/:table/rows`                       | Delete rows (filter required)                                       |
| GET                              | `/db/:db/:table/columns`                    | Inspect schema (types, nullability, PKs, FKs)                       |
| POST                             | `/db/:db/:table/columns`                    | Add a column (DDL)                                                  |
| PATCH                            | `/db/:db/:table/columns/:column`            | Modify type or rename a column (DDL)                                |
| DELETE                           | `/db/:db/:table/columns/:column`            | Drop a column (DDL)                                                 |
| **Blob: public**                 |                                             |                                                                     |
| GET                              | `/blobs/public/:ns/*key`                    | Unauthenticated streaming (ETag, conditional `304`, `Range`)        |
| HEAD                             | `/blobs/public/:ns/*key`                    | Metadata only: `Content-Length`, `ETag`                             |
| **Blob: namespaces** (read-only) |                                             |                                                                     |
| GET                              | `/blobs/namespaces`                         | Namespaces authorized for the caller's role                         |
| GET                              | `/blobs/namespaces/:ns`                     | Namespace configuration and public-read status                      |
| GET                              | `/blobs/namespaces/:ns/usage`               | Live quota: used bytes, headroom, object count                      |
| **Blob: objects**                |                                             |                                                                     |
| POST                             | `/blobs/objects/copy`                       | Cross-namespace zero-copy clone (`src_namespace`, `dest_namespace`) |
| POST                             | `/blobs/objects/move`                       | Cross-namespace atomic relocate                                     |
| GET                              | `/blobs/objects/:ns`                        | List objects (`prefix`, `cursor`, `limit`)                          |
| POST                             | `/blobs/objects/:ns/copy`                   | In-namespace zero-copy clone (`src_key`, `dest_key`)                |
| POST                             | `/blobs/objects/:ns/move`                   | In-namespace atomic relocate (`src_key`, `dest_key`)                |
| POST                             | `/blobs/objects/:ns/batch-delete`           | Delete by explicit key list or directory prefix                     |
| POST                             | `/blobs/objects/:ns/verify/*key`            | Verify BLAKE3 integrity of the on-disk blob                         |
| PUT                              | `/blobs/objects/:ns/*key`                   | Upload object or create directory marker (auto-dedup)               |
| GET                              | `/blobs/objects/:ns/*key`                   | Stream object (`Range`, ETag, tickets)                              |
| HEAD                             | `/blobs/objects/:ns/*key`                   | Size, content-type, ETag, last-modified                             |
| DELETE                           | `/blobs/objects/:ns/*key`                   | Delete object; decrements CAS reference count                       |
| **Blob: uploads**                |                                             |                                                                     |
| POST                             | `/blobs/uploads/:ns`                        | Start resumable session (`key`, `content_type`, `total_bytes`)      |
| POST                             | `/blobs/uploads/:ns/sign`                   | Generate a pre-signed direct-upload URL                             |
| GET                              | `/blobs/uploads/:ns/:upload_id`             | Upload progress and received byte ranges                            |
| PUT / PATCH                      | `/blobs/uploads/:ns/:upload_id`             | Send a chunk with `Content-Range`                                   |
| PUT                              | `/blobs/uploads/:ns/:upload_id/parts/:part` | Upload a numbered part (S3-style multipart)                         |
| POST                             | `/blobs/uploads/:ns/:upload_id/complete`    | Finalize and assemble into the CAS store                            |
| DELETE                           | `/blobs/uploads/:ns/:upload_id`             | Abort and clean up staged chunks                                    |
| **Blob: tickets**                |                                             |                                                                     |
| GET                              | `/blobs/tickets/:ns`                        | List tickets (cursor pagination)                                    |
| POST                             | `/blobs/tickets/:ns`                        | Mint a ticket (`key`, `operation`, `ttl_seconds`)                   |
| POST                             | `/blobs/tickets/:ns/:signature/revoke`      | Revoke immediately (RAM and SQLite)                                 |
| POST                             | `/blobs/tickets/:ns/:signature/enable`      | Restore a revoked ticket                                            |
| DELETE                           | `/blobs/tickets/:ns/:signature`             | Permanently purge the ticket record                                 |

### Control plane: `/admin/v1`

| Area          | Method               | Path                               | Description                                                         |
| ------------- | -------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| **Auth**      | POST                 | `/auth/login`                      | Authenticate and issue a session token                              |
|               | POST                 | `/auth/logout`                     | Revoke the session token and clear the cookie                       |
| **Setup**     | GET / POST           | `/setup/begin`                     | Check / initialize the first-run wizard                             |
|               | POST                 | `/setup/account`                   | Create the initial root administrator                               |
|               | POST                 | `/setup/database`                  | Provision the initial primary database                              |
|               | POST                 | `/setup/database/test`             | Test connectivity during setup                                      |
|               | POST                 | `/setup/complete`                  | Seal setup and switch to production mode                            |
| **System**    | GET                  | `/status`                          | Version, uptime, memory, CPU, engine status                         |
|               | GET                  | `/health`                          | Administrative health probe                                         |
|               | GET                  | `/metrics`                         | Prometheus and JSON metrics (QPS, errors, latency)                  |
|               | GET                  | `/audit`                           | Tamper-evident audit log (filter by user / action / date)           |
|               | POST                 | `/reload`                          | Hot-reload metadata configuration from disk                         |
|               | GET                  | `/users`                           | List administrators (mutations are local-CLI only)                  |
| **API keys**  | GET / POST           | `/keys`                            | List keys / mint a key (`name`, `role`, `rate_limit`, optional TTL) |
|               | PATCH / DELETE       | `/keys/:name`                      | Update role, rate limit, or expiry / revoke immediately             |
|               | POST                 | `/keys/:name/rotate`               | Zero-downtime secret rotation (issues a new secret)                 |
| **Roles**     | GET / POST           | `/roles`                           | List RBAC roles / create a custom role                              |
|               | PATCH / DELETE       | `/roles/:name`                     | Update permissions / delete (system roles are immutable)            |
| **Databases** | GET / POST           | `/databases`                       | List pools (credentials masked) / register a pool                   |
|               | POST                 | `/databases/test-url`              | Test an uncommitted connection string                               |
|               | PATCH / DELETE       | `/databases/:alias`                | Update pool parameters / unregister                                 |
|               | GET                  | `/databases/:alias/test`           | Probe health and latency of an existing alias                       |
| **Cache**     | GET                  | `/cache/stats`                     | Hit ratios, cached ASTs, memory footprint                           |
|               | POST                 | `/cache/flush`                     | Evict all query, schema, and policy caches                          |
| **Cluster**   | GET                  | `/cluster/status`                  | Node ID, moniker, active peer count                                 |
|               | PATCH                | `/cluster/moniker`                 | Rename the local node                                               |
|               | GET / POST           | `/cluster/peers`                   | List peers / handshake and register a peer                          |
|               | PATCH / DELETE       | `/cluster/peers/:node_id`          | Update peer address / disconnect                                    |
|               | POST                 | `/cluster/peers/:node_id/ping`     | Measure round-trip latency                                          |
| **Storage**   | GET                  | `/blobs/stats`                     | CAS objects, disk used, deduplication ratio                         |
|               | POST                 | `/blobs/scrub`                     | Cluster-wide BLAKE3 bit-rot verification                            |
|               | POST                 | `/blobs/sweep`                     | Garbage-collect expired TTL blobs now                               |
|               | GET / POST           | `/blobs/namespaces`                | List / provision namespaces (quota bytes, public-read toggle)       |
|               | GET / PATCH / DELETE | `/blobs/namespaces/:ns`            | Inspect / update quota or policy / delete                           |
|               | GET                  | `/blobs/tickets`                   | Audit all tickets cluster-wide                                      |
|               | POST                 | `/blobs/tickets/:signature/revoke` | Emergency cluster-wide revoke                                       |
|               | POST                 | `/blobs/tickets/:signature/enable` | Cluster-wide restore                                                |
|               | DELETE               | `/blobs/tickets/:signature`        | Purge the ticket record from the cluster                            |

## 5. Database Data API (`/api/v1/db`)

### Parameterized SQL

```http
POST /api/v1/db/main_pg/query
X-Axiom-Key: <TOKEN>
Idempotency-Key: req_9001
Content-Type: application/json

{
  "sql": "SELECT id, email, status FROM users WHERE status = $1 LIMIT 10",
  "params": ["active"]
}
```

Response: `columns` plus `rows` as positional arrays.

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

### Reading rows

```http
GET /api/v1/db/main_pg/users/rows?limit=2&sort=id&order=asc&filter={"status":{"eq":"active"}}
X-Axiom-Key: <TOKEN>
```

> The `filter` value is JSON and must be **URL-encoded** in real requests.
> With curl, use `--get --data-urlencode 'filter={"status":{"eq":"active"}}'`.

Response: `rows` as objects, plus pagination fields. Pass `next_cursor` back as `cursor` for the next page.

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

### Filter operators

| Operator     | Example                                                       | SQL equivalent             |
| ------------ | ------------------------------------------------------------- | -------------------------- |
| `eq`         | `{"status": {"eq": "active"}}`                                | `=`                        |
| `neq`        | `{"status": {"neq": "banned"}}`                               | `!=`                       |
| `gt` / `gte` | `{"age": {"gte": 18}}`                                        | `>` / `>=`                 |
| `lt` / `lte` | `{"price": {"lte": 99.99}}`                                   | `<` / `<=`                 |
| `like`       | `{"email": {"like": "%@gmail.com"}}`                          | `LIKE` (case-sensitive)    |
| `ilike`      | `{"name": {"ilike": "%smith%"}}`                              | `ILIKE` (case-insensitive) |
| `in`         | `{"role": {"in": ["admin", "editor"]}}`                       | `IN (...)`                 |
| `nin`        | `{"status": {"nin": ["archived", "deleted"]}}`                | `NOT IN (...)`             |
| `is_null`    | `{"deleted_at": {"is_null": true}}`                           | `IS NULL` / `IS NOT NULL`  |
| `and`        | `{"and": [{"age": {"gte": 18}}, {"verified": {"eq": true}}]}` | `AND`                      |
| `or`         | `{"or": [{"tier": {"eq": "pro"}}, {"credits": {"gt": 0}}]}`   | `OR`                       |

Operators nest: `and` / `or` accept arrays of any other filter expressions.

### Writing rows

**Insert** (single or batch; safe to retry with `Idempotency-Key`)

```http
POST /api/v1/db/main_pg/users/rows
X-Axiom-Key: <TOKEN>
Idempotency-Key: req_12345
Content-Type: application/json

{ "data": [ { "email": "charlie@example.com", "status": "active" } ] }
```

**Update** (filter required)

```http
PATCH /api/v1/db/main_pg/users/rows
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{ "filter": { "id": { "eq": 42 } }, "data": { "status": "suspended" } }
```

**Delete** (filter required)

```http
DELETE /api/v1/db/main_pg/users/rows
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{ "filter": { "status": { "eq": "expired" } } }
```

### Schema inspection and DDL

**Inspect columns**

```http
GET /api/v1/db/main_pg/users/columns
X-Axiom-Key: <TOKEN>
```

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
        "primary_key": true
      },
      { "name": "email", "data_type": "VARCHAR(255)", "nullable": false }
    ],
    "foreign_keys": []
  }
}
```

**Add column**

```http
POST /api/v1/db/main_pg/users/columns
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{ "name": "is_mfa_active", "data_type": "BOOLEAN", "nullable": false, "default_value": "false" }
```

**Modify / rename column**

```http
PATCH /api/v1/db/main_pg/users/columns/is_mfa_active
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{ "new_name": "mfa_enabled" }
```

_(Accepts `new_name`, `data_type`, or both)_

**Drop column**

```http
DELETE /api/v1/db/main_pg/users/columns/mfa_enabled
X-Axiom-Key: <TOKEN>
```

> DDL is destructive and immediate. Restrict these routes to trusted roles via RBAC.

## 6. Blob Storage API (`/api/v1/blobs`)

Storage is **content-addressed (CAS)**: identical bytes are stored once (BLAKE3 hash), copies are zero-copy, and deleting an object only decrements a reference count.

### Direct upload, download, delete

```http
PUT /api/v1/blobs/objects/media/reports/q3.pdf
X-Axiom-Key: <TOKEN>
Content-Type: application/pdf

<binary file bytes>
```

```http
GET /api/v1/blobs/objects/media/reports/q3.pdf
X-Axiom-Key: <TOKEN>
Range: bytes=0-1048575
```

```http
DELETE /api/v1/blobs/objects/media/reports/q3.pdf
X-Axiom-Key: <TOKEN>
```

**Batch delete** by explicit keys, by prefix, or both:

```http
POST /api/v1/blobs/objects/media/batch-delete
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{ "keys": ["old_file1.txt", "old_file2.txt"], "prefix": "temp/cache/" }
```

### Resumable chunked uploads

Use for large files or unreliable networks.

| Step           | Request                                                                                             | Notes                                                        |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. Initialize  | `POST /api/v1/blobs/uploads/media` with `{ "key": "backups/dump.tar.gz", "total_bytes": 52428800 }` | Response contains `upload_id`, e.g. `up_abc123`              |
| 2. Send chunks | `PUT /api/v1/blobs/uploads/media/up_abc123` with `Content-Range: bytes 0-10485759/52428800`         | Repeat per slice; `GET` the session to see what was received |
| 3. Complete    | `POST /api/v1/blobs/uploads/media/up_abc123/complete`                                               | Atomically assembles the object                              |

To cancel, `DELETE /api/v1/blobs/uploads/media/up_abc123`. For S3-style clients, send numbered parts to `.../up_abc123/parts/:part` instead of using `Content-Range`.

### Capability tickets (pre-signed URLs)

Tickets delegate read or write access to a single key without sharing an API key.

**Mint**

```http
POST /api/v1/blobs/tickets/media
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{ "key": "reports/q3.pdf", "operation": "READ", "ttl_seconds": 3600 }
```

```json
{
  "success": true,
  "data": {
    "url": "/api/v1/blobs/objects/media/reports/q3.pdf?ticket_sig=sig_abc123def456&ticket_exp=1792800000",
    "signature": "sig_abc123def456",
    "operation": "READ",
    "expires_at": 1792800000
  }
}
```

`expires_at` is a Unix timestamp (seconds).

**List** (keyset pagination): `GET /api/v1/blobs/tickets/media?limit=25&cursor=1761400000_42`

**Revoke**: `POST /api/v1/blobs/tickets/media/sig_abc123def456/revoke`

Lifecycle: **active → revoked** (`/revoke`) → **active** again (`/enable`), or permanently removed (`DELETE`). Administrators can do the same cluster-wide under `/admin/v1/blobs/tickets`.

## 7. Model Context Protocol (MCP)

Axiom exposes database and storage capabilities to AI agents over JSON-RPC 2.0 at `POST /mcp/v1`, authenticated with `X-Axiom-Key`. Protocol version: `2024-11-05`.

```http
POST /mcp/v1
X-Axiom-Key: <TOKEN>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "axiom_raw_sql",
    "arguments": { "database": "main_pg", "sql": "SELECT COUNT(*) FROM users;" }
  }
}
```

**Built-in tools**

| Category          | Tools                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database & Tables | `axiom_list_services`, `axiom_list_tables`, `axiom_describe_table`                                                                                                      |
| Query & Mutations | `axiom_query`, `axiom_raw_sql`, `axiom_insert`, `axiom_update`, `axiom_delete`                                                                                          |
| Blob Storage      | `axiom_list_blob_namespaces`, `axiom_list_blobs`, `axiom_get_blob_metadata`, `axiom_read_blob`, `axiom_write_blob`, `axiom_delete_blob`, `axiom_create_download_ticket` |

MCP calls run under the key's role, so RBAC applies exactly as for REST. Give agents a dedicated, least-privilege key.

## 8. Errors

| HTTP  | Code                             | Typical cause                                                   |
| ----- | -------------------------------- | --------------------------------------------------------------- |
| `400` | `BAD_REQUEST`, `INVALID_PAYLOAD` | Missing required fields or malformed JSON                       |
| `400` | `AST_VALIDATION_ERROR`           | SQL rejected by the AST parser or contains a disallowed keyword |
| `401` | `UNAUTHORIZED`                   | `X-Axiom-Key` missing, malformed, or expired                    |
| `403` | `FORBIDDEN`                      | Role lacks the required privilege on the database or table      |
| `404` | `NOT_FOUND`, `DB_NOT_FOUND`      | Database alias, table, or blob key does not exist               |
| `429` | `RATE_LIMITED`                   | IP or API key exceeded its sliding-window rate limit            |
| `500` | `INTERNAL_SERVER_ERROR`          | Upstream database error or unexpected server failure            |

**Handling tips**

- `429`: back off and retry; the limit is per IP and per key.
- `5xx` on writes: retry with the same `Idempotency-Key`.
- Always log `meta.request_id`.

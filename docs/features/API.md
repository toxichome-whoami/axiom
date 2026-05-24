<div align="center">
  <h1>Axiom API Reference</h1>
  <p><em>Complete guide to REST and SSE endpoints for Databases, Storage, Webhooks, MCP, and GraphQL</em></p>
  <p><strong>Axiom is natively a REST API gateway.</strong> GraphQL is an optional secondary interface — disabled by default — for clients that prefer it.</p>
</div>

<hr/>

## Authentication

All endpoints (except `/health` and `/ready`) require Bearer token authentication.

**Format:**
```
Authorization: Bearer base64(<key_name>:<secret>)
```

**cURL Example:**
```bash
# To generate the token in bash:
# TOKEN=$(echo -n "admin:your_secret_here" | base64)

curl -X GET "http://localhost:4500/api/v1/db/databases" \
     -H "Authorization: Bearer $TOKEN"
```

---

## Core Endpoints

### 1. Server Info & Feature Flags
```bash
curl -X GET "http://localhost:4500/" \
     -H "Authorization: Bearer <TOKEN>"
```

### 2. Kubernetes Readiness Probe
Does not require authentication.
```bash
curl -X GET "http://localhost:4500/ready"
```

### 3. Deep Health Check
```bash
curl -X GET "http://localhost:4500/health" \
     -H "Authorization: Bearer <TOKEN>"
```

### 4. Metrics (Prometheus)
```bash
curl -X GET "http://localhost:4500/metrics" \
     -H "Authorization: Bearer <TOKEN>"
```

### 5. OpenAPI JSON Spec
```bash
curl -X GET "http://localhost:4500/api/v1/api/spec" \
     -H "Authorization: Bearer <TOKEN>"
```

---

## Database API <code>/api/v1/db</code>

### 1. List Databases
```bash
curl -X GET "http://localhost:4500/api/v1/db/databases" \
     -H "Authorization: Bearer <TOKEN>"
```
Returns all databases the key has access to with connection status and table count. Health checks are cached for 5 seconds.

### 2. List Tables (Paginated)
```bash
curl -X GET "http://localhost:4500/api/v1/db/main_db/tables?limit=50&offset=0" \
     -H "Authorization: Bearer <TOKEN>"
```
**Parameters:**
- `limit` — Max tables per page (default 50, max 500)
- `offset` — Pagination offset (default 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "database": "main_db",
    "tables": [
      {
        "name": "users",
        "columns": [
          {"name": "id", "type": "integer", "nullable": false, "primary_key": true}
        ]
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 50,
      "offset": 0,
      "has_more": true
    }
  }
}
```

### 3. Execute Raw SQL
> [!CAUTION]
> Raw SQL is validated by AST parser. Dangerous operations blocked per config.

```bash
curl -X POST "http://localhost:4500/api/v1/db/main_db/query" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "sql": "SELECT * FROM users WHERE id = :id",
           "params": {"id": 42}
         }'
```

### 4. Fetch Rows (Paginated)
```bash
# Basic cursor pagination (ultra-fast for massive tables)
curl -G "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "Authorization: Bearer <TOKEN>" \
     --data-urlencode "limit=50" \
     --data-urlencode "sort=id" \
     --data-urlencode "order=desc" \
     --data-urlencode 'filter={"active":true,"age":{"$gte":18}}' \
     --data-urlencode "fields=id,name,email"

# Next page using cursor
curl -G "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "Authorization: Bearer <TOKEN>" \
     --data-urlencode "limit=50" \
     --data-urlencode "sort=id" \
     --data-urlencode "cursor=eyJ2IjogNDV9"
```

**Parameters:**
- `page` — Legacy offset page number (default 1)
- `cursor` — Keyset cursor for ultra-fast pagination (bypasses `page` offset)
- `limit` — Rows per page (default 50)
- `sort` — Column to sort by (validated against real table columns)
- `order` — `asc` or `desc` (default `asc`)
- `filter` — JSON filter object
- `fields` — Comma-separated columns to return (validated against real table columns)
- `search` — Full-text search term
- `search_fields` — Columns to search across
- `count` — Set to `1` to include exact `total` in pagination (runs `SELECT COUNT(*)`)
  — Omit for faster responses (infers `has_more` from row count)

**Response (without count):**
```json
{
  "success": true,
  "data": {
    "rows": [{"id": 1, "name": "Alice"}],
    "pagination": {
      "limit": 50,
      "has_more": true,
      "is_cursor": true,
      "next_cursor": "eyJ2IjogNDV9"
    }
  }
}
```

**Response (with `?count=1`):**
```json
{
  "success": true,
  "data": {
    "rows": [{"id": 1, "name": "Alice"}],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 50,
      "has_more": true
    }
  }
}
```

### 5. Insert Rows
```bash
curl -X POST "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "rows": [{"name": "Alice", "active": true}]
         }'
```

### 6. Update Rows
```bash
curl -X PATCH "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "filter": {"id": 42},
           "update": {"active": false}
         }'
```

### 7. Delete Rows
```bash
curl -X DELETE "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "filter": {"id": 42}
         }'
```

---

## Storage API <code>/api/v1/fs</code>

### 1. List Storages
```bash
curl -X GET "http://localhost:4500/api/v1/fs/storages" \
     -H "Authorization: Bearer <TOKEN>"
```
**Response:**
```json
{
  "success": true,
  "data": {
    "storages": [
      {
        "name": "uploads",
        "mode": "readwrite",
        "status": "available",
        "limit": "10 GB",
        "chunk_size": "10 MB",
        "max_file_size": "500 MB",
        "federated": false,
        "usage": {
          "used_bytes": [104857600, "100.00 MB"],
          "available_bytes": [10632560640, "9.90 GB"],
          "file_count": 42
        }
      }
    ]
  }
}
```

### 2. List Folder
```bash
# Flat listing (default)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/list?path=/subfolder&limit=50" \
     -H "Authorization: Bearer <TOKEN>"

# Recursive listing (all subdirectories)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/list?path=/&recursive=true&limit=100" \
     -H "Authorization: Bearer <TOKEN>"

# Pagination next page
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/list?path=/&limit=100&continuation_token=ZmlsZV8xMDAubXA0" \
     -H "Authorization: Bearer <TOKEN>"
```

**Parameters:**
- `path` - Directory path (default `/`)
- `limit` - Max items per page (default 100, max 1000)
- `continuation_token` - Token returned from a previous response to fetch the next page
- `recursive` - Set to `true` to include all subdirectory contents (depth-first)

**Response:**
```json
{
  "success": true,
  "data": {
    "storage": "local_fs",
    "path": "/subfolder",
    "items": [
      {
        "name": "image.png",
        "type": "file",
        "size": [1048576, "1.0 MB"],
        "mime_type": "image/png",
        "modified": "2024-03-10T12:00:00"
      }
    ],
    "pagination": {
      "limit": 50,
      "is_truncated": true,
      "next_continuation_token": "aW1hZ2VfNTEucG5n"
    }
  }
}
```

### 3. Download File or Folder
```bash
# Inline view of a file
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/image.png&inline=true" \
     -H "Authorization: Bearer <TOKEN>" -O

# Download with image resizing
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/image.png&width=300&height=200" \
     -H "Authorization: Bearer <TOKEN>" -o thumb.png

# Download folder as ZIP archive automatically
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/reports_folder" \
     -H "Authorization: Bearer <TOKEN>" -o reports.zip
```

### 4. Direct Upload (Small Files)
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "Authorization: Bearer <TOKEN>" \
     -F "action=direct" \
     -F "path=/uploads/file.txt" \
     -F "file=@/path/to/local/file.txt"
```

### 5. Chunked Upload (Large Files)
```bash
# Step 1: Initiate
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action":"initiate", "filename":"video.mp4", "path":"/uploads/video.mp4", "total_size":104857600, "checksum_sha256":"abc123..."}'
# Note the `upload_id` returned

# Step 2: Upload Chunks
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "Authorization: Bearer <TOKEN>" \
     -F "action=chunk" \
     -F "upload_id=upl_xxx" \
     -F "chunk_index=0" \
     -F "chunk_hash=sha256_of_chunk" \
     -F "file=@chunk0.bin"

# Step 3: Finalize
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action":"finalize", "upload_id":"upl_xxx"}'
```

### 6. File Actions

All file actions are sent as `POST` requests to `/{alias}/action` with a JSON body containing the `action` field.

> [!NOTE]
> The `info` and `exists` actions are available to **read-only** API keys. All other actions require `readwrite` or `writeonly` mode.

#### Rename / Move / Copy
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "action": "rename",
           "source": "/old.txt",
           "target": "/new.txt"
         }'
```

| Action | Description |
|--------|-------------|
| `rename` | Rename a file or directory |
| `move` | Move a file or directory (alias for rename) |
| `copy` | Copy a file or directory to a new location |

#### Delete
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "delete", "source": "/unwanted.txt"}'
```

#### Create Directory
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "mkdir", "source": "/new_folder"}'
```

#### File Info
Returns detailed metadata: name, type, size, human-readable size, MIME type, timestamps, and item count for directories.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "info", "source": "/reports/Q1.pdf"}'
```
**Response:**
```json
{
  "success": true,
  "data": {
    "action": "info",
    "source": "/reports/Q1.pdf",
    "info": {
      "name": "Q1.pdf",
      "type": "file",
      "size": [2457600, "2.34 MB"],
      "mime_type": "application/pdf",
      "modified": "2026-03-15T10:30:00",
      "created": "2026-03-01T08:00:00"
    }
  }
}
```

#### Check Existence
Lightweight boolean check — does not transfer file data.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "exists", "source": "/config/app.yml"}'
```
**Response:**
```json
{
  "success": true,
  "data": {
    "action": "exists",
    "source": "/config/app.yml",
    "exists": true
  }
}
```

#### Bulk Delete
Delete multiple files/directories in a single request. Each item reports its own success/failure status.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "action": "bulk_delete",
           "sources": ["/tmp/old1.log", "/tmp/old2.log", "/tmp/cache"]
         }'
```
**Response:**
```json
{
  "success": true,
  "data": {
    "action": "bulk_delete",
    "results": [
      {"source": "/tmp/old1.log", "status": "success"},
      {"source": "/tmp/old2.log", "status": "success"},
      {"source": "/tmp/cache", "status": "success"}
    ]
  }
}
```

#### Bulk Move
Move multiple files/directories in a single request. Provide an `operations` array of `{source, target}` pairs.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "action": "bulk_move",
           "operations": [
             {"source": "/inbox/file1.txt", "target": "/archive/file1.txt"},
             {"source": "/inbox/file2.txt", "target": "/archive/file2.txt"}
           ]
         }'
```
**Response:**
```json
{
  "success": true,
  "data": {
    "action": "bulk_move",
    "results": [
      {"source": "/inbox/file1.txt", "target": "/archive/file1.txt", "status": "success"},
      {"source": "/inbox/file2.txt", "target": "/archive/file2.txt", "status": "success"}
    ]
  }
}
```



---

## Federation API <code>/api/v1/fed</code>

### 1. List Federated Servers
```bash
curl -X GET "http://localhost:4500/api/v1/fed/servers" \
     -H "Authorization: Bearer <TOKEN>"
```

---

## GraphQL API <code>/api/v1/graphql</code>

> [!NOTE]
> GraphQL is an **optional, secondary interface**. Axiom is fundamentally a REST API gateway. Enable it with `features.graphql = true` in `config.toml`. When disabled, the endpoint does not exist and consumes zero resources.

Unlike standard GraphQL servers (Strawberry, Graphene, Ariadne), Axiom's GraphQL layer bypasses Python object graph resolution entirely. Incoming query strings are parsed into an AST by `graphql-core`, walked by the `ASTCompiler`, and dispatched directly into the native `QueryExecutionPipeline` — the exact same security-hardened pipeline used by the REST database endpoints. This means all WAF checks, SQL blacklist rules, API key scoping, and rate limiting apply identically.

**Authentication** is identical to the REST API:
```
Authorization: Bearer base64(<key_name>:<secret>)
```

### Execute a SQL Query

Use the `execute` root field to run a validated SQL statement against any permitted database alias.

```bash
curl -X POST "http://localhost:4500/api/v1/graphql" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "query": "{ execute(dbAlias: \"main_db\", sql: \"SELECT id, name FROM users WHERE active = 1\", params: {}) }"
         }'
```

**Response:**
```json
{
  "data": {
    "execute": {
      "columns": ["id", "name"],
      "rows": [
        {"id": 1, "name": "Alice"},
        {"id": 2, "name": "Bob"}
      ],
      "affectedRows": 0
    }
  },
  "extensions": {
    "duration_ms": 0.48
  }
}
```

### Native Table Queries

You can query tables directly using standard GraphQL syntax without writing raw SQL. The AST compiler automatically transposes this into an ultra-fast `SELECT` statement:

```bash
curl -X POST "http://localhost:4500/api/v1/graphql" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "query": "{ users(dbAlias: \"main_db\", limit: 10, offset: 0) { id name email } }"
         }'
```

**Response:**
```json
{
  "data": {
    "users": [
      {"id": 1, "name": "Alice", "email": "alice@example.com"}
    ]
  },
  "extensions": {
    "duration_ms": 0.21
  }
}
```

### Complex Filtering

You can apply complex filters to table queries using the `filter` argument. This seamlessly maps to the gateway's AST `WHERE` clause generator:

```graphql
{
  users(dbAlias: "main_db", filter: { status: "active", age: { $gte: 18 } }) {
    id
    name
  }
}
```

### Auto-Detected Nested Relational Joins

Axiom's GraphQL engine is truly industrial-grade. It entirely avoids the "N+1" query problem by automatically inspecting your database's physical **Foreign Key constraints** and using the DataLoader pattern to resolve deeply nested graphs in exactly 1+1 queries.

```graphql
{
  users(dbAlias: "main_db") {
    id
    name
    posts {
      title
      comments {
        text
      }
    }
  }
}
```
*Note: No Python models or schemas are required. The engine queries `PRAGMA foreign_key_list` (or equivalent) natively on-the-fly to securely traverse the relations!*

### Native Mutations

Axiom natively supports standard GraphQL mutations, mapped securely through the core `QueryExecutionPipeline` (triggering all WAF rules and webhooks automatically).

- `insert_<table_name>`
- `update_<table_name>`
- `delete_<table_name>` (Strictly requires a `filter` argument to prevent accidental table wipes).

```graphql
mutation {
  insert_users(dbAlias: "main_db", row: { name: "Alice", status: "active" })
  
  update_users(dbAlias: "main_db", filter: { id: 1 }, update: { status: "inactive" })
  
  delete_users(dbAlias: "main_db", filter: { id: 2 })
}
```

### List Available Databases

Use the `databases` root field to return all database aliases the API key has access to.

```bash
curl -X POST "http://localhost:4500/api/v1/graphql" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"query": "{ databases }"}'
```

### Combining Fields

Multiple root fields in a single query are executed and returned together:

```graphql
{
  execute(dbAlias: "main_db", sql: "SELECT COUNT(*) AS total FROM orders", params: {})
  databases
}
```

### Error Handling

Errors are returned in the standard GraphQL error envelope. The HTTP status code is always `200` for query-level errors and `400`/`500` for gateway-level errors.

```json
{
  "errors": [
    {
      "message": "Access denied",
      "details": "Database alias 'secret_db' is not in scope for this key"
    }
  ]
}
```

| Error Message | Cause | Fix |
|---------------|-------|-----|
| `Access denied` | API key lacks scope for the database | Check `db_scope` in `config.toml` |
| `execute() requires dbAlias and sql arguments` | Missing required GraphQL arguments | Provide both `dbAlias` and `sql` |
| `Unsupported root field: <name>` | Unknown field name in query | Only `execute` and `databases` are currently supported |
| `Query depth exceeds limit` | Query nesting too deep | Reduce nesting or increase `max_query_depth` in config |

---

## WebSocket API <code>ws://host:port/api/v1/ws</code>

> [!NOTE]
> WebSocket is an **optional, secondary interface** for clients that need real-time push. Enable it with `features.websocket = true` in `config.toml`. When disabled, the endpoint does not exist and consumes zero resources.

Use WebSocket when you need **live event streaming** — DB mutations, file changes, or server metrics — without polling. For one-off queries, REST is the right choice.

### Connection and Authentication

WebSocket upgrades happen over the same port as the REST API. Unlike HTTP, auth is done via the **first JSON message** (5-second timeout):

```javascript
const ws = new WebSocket("ws://localhost:4500/api/v1/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "auth",
    token: btoa("admin:your_secret_here")  // base64(key_name:secret)
  }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  console.log(msg);
  // { "type": "connected", "client_id": "admin_140234567" }
};
```

### Subscribing to Topics

Topics mirror the REST URL structure. A client may only subscribe to topics within their API key's `db_scope` / `fs_scope`.

```javascript
// Subscribe to all mutations on the "users" table in "portfolio"
ws.send(JSON.stringify({ type: "subscribe", topic: "db:portfolio:users", request_id: "r1" }));
// → { "type": "ack", "request_id": "r1", "status": "ok", "topic": "db:portfolio:users" }

// Subscribe to all file changes in the "uploads" storage
ws.send(JSON.stringify({ type: "subscribe", topic: "fs:uploads:*" }));

// Subscribe to live server metrics
ws.send(JSON.stringify({ type: "subscribe", topic: "metrics" }));

// Unsubscribe
ws.send(JSON.stringify({ type: "unsubscribe", topic: "db:portfolio:users" }));
```

### Topic Reference

| Topic | Description |
|-------|-------------|
| `db:{alias}:{table}` | Mutations on a specific table |
| `db:{alias}:*` | All table mutations in a database |
| `fs:{alias}:{path}` | File changes at a specific path |
| `fs:{alias}:*` | All file changes in a storage volume |
| `metrics` | Periodic server metrics (memory, CPU, query counts) |
| `system:health` | Server health state changes |

### Incoming Event Shape

```json
{
  "type": "event",
  "topic": "db:portfolio:users",
  "data": {
    "action": "INSERT",
    "module": "db",
    "resource": "portfolio",
    "target": "users",
    "details": { "affected_rows": 1 }
  }
}
```

### Heartbeat

The server sends a ping every 30 seconds (configurable). Clients should handle it gracefully — no reply required, but optionally respond with `{ "type": "pong" }`.

```json
{ "type": "heartbeat", "server_time": "2026-05-22T17:00:00Z" }
```

### Close Codes

| Code | Reason |
|------|--------|
| `4001` | Auth timeout or malformed auth message |
| `4003` | Invalid token or authentication failed |

## SSE API <code>/api/v1/sse</code>

> [!NOTE]
> Server-Sent Events (SSE) is an **optional, one-way push interface**. Enable it with `features.sse = true` in `config.toml`. When disabled, the endpoints do not exist and consume zero resources.

Use SSE when you need **live event streaming** without the bidirectional overhead of WebSockets. SSE is strictly one-way (Server → Client), making it incredibly efficient for live dashboards, logs, and real-time database feeds.

### Connection and Authentication

SSE endpoints are standard HTTP GET requests. Because browsers' native `EventSource` cannot send custom headers, authentication is done via a base64 encoded `?token=` query parameter.

```javascript
// Token is base64(key_name:secret)
const token = btoa("admin:your_secret_here");

// Connect to a specific topic
const es = new EventSource(`http://localhost:4500/api/v1/sse/db/portfolio/users?token=${token}`);

es.addEventListener("mutation", (event) => {
  const data = JSON.parse(event.data);
  console.log("Live event:", data);
});

// The server sends periodic heartbeats to keep the connection alive
es.onmessage = (event) => {
  if (event.data === "heartbeat") {
    console.log("Heartbeat received");
  }
};
```

### Available Streams

Unlike WebSocket, you do not "subscribe" after connecting. You connect directly to the stream you want:

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/sse/db/{alias}/{table}` | Stream mutations on a specific table |
| `GET /api/v1/sse/db/{alias}` | Stream all table mutations in a database |
| `GET /api/v1/sse/fs/{alias}/{path}` | Stream file changes at a specific path |
| `GET /api/v1/sse/fs/{alias}` | Stream all file changes in a storage volume |
| `GET /api/v1/sse/metrics` | Admin-only stream for live server metrics |
| `GET /api/v1/sse/health` | Public stream for system health (no auth required) |

### Incoming Event Shape

```json
{
  "action": "INSERT",
  "module": "db",
  "resource": "portfolio",
  "target": "users",
  "details": { "affected_rows": 1 }
}
```

## MCP API <code>/api/v1/mcp</code>

> <span style="font-size: 1.2em;"></span> **NOTE:**
> MCP (Model Context Protocol) must be enabled via `features.mcp = true` in `config.toml`. When disabled, these endpoints do not exist and consume zero resources. See [`docs/features/MCP.md`](MCP.md) for the full guide.

The MCP API exposes Axiom's database and storage tools to AI models (like Claude, Gemini) securely through standard Server-Sent Events (SSE).

### Connection Endpoints
1. **SSE Transport**: `GET /api/v1/mcp/sse`
2. **RPC Messages**: `POST /api/v1/mcp/messages`

Both endpoints require `Authorization: Bearer <TOKEN>` using standard Axiom API keys. AI requests are strictly governed by the key's native permissions (`mode`, `db_scope`, `fs_scope`, and rate limits).

### Available Tools (Functions)
Once connected, the AI model gains access to the following bounded tools:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_databases` | _(none)_ | Returns configured and permitted database aliases |
| `list_tables` | `database: str` | Extracts introspection schema |
| `describe_table` | `database: str, table: str` | Dumps full column definitions |
| `query_database` | `database: str, sql: str` | Executes AST-validated SQL through the gateway |
| `list_storages` | _(none)_ | Returns allowed file system aliases |
| `list_files` | `storage: str, path: str` | Lists directory contents |
| `read_file` | `storage: str, path: str` | Reads safely capped text documents |

### Available Resources (Context)
- `axiom://db/{alias}/schema`: Full database schema (tables, columns, types, PKs)
- `axiom://fs/{alias}/info`: Storage volume configuration and limits

---

## Filter Syntax

Filters accept a JSON object of field-to-operator mappings:

<table style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #2d2d2d; color: white;">
    <th style="padding: 10px; text-align: left;">Operator</th>
    <th style="padding: 10px; text-align: left;">Description</th>
    <th style="padding: 10px; text-align: left;">Example</th>
  </tr>
  <tr><td style="padding: 10px;"><code>$eq</code></td><td style="padding: 10px;">Equal</td><td style="padding: 10px;"><code>{"age": {"$eq": 25}}</code> or <code>{"age": 25}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$ne</code></td><td style="padding: 10px;">Not equal</td><td style="padding: 10px;"><code>{"status": {"$ne": "banned"}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$gt</code></td><td style="padding: 10px;">Greater than</td><td style="padding: 10px;"><code>{"score": {"$gt": 50}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$gte</code></td><td style="padding: 10px;">Greater or equal</td><td style="padding: 10px;"><code>{"age": {"$gte": 18}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$lt</code></td><td style="padding: 10px;">Less than</td><td style="padding: 10px;"><code>{"price": {"$lt": 100}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$lte</code></td><td style="padding: 10px;">Less or equal</td><td style="padding: 10px;"><code>{"rank": {"$lte": 10}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$in</code></td><td style="padding: 10px;">In list</td><td style="padding: 10px;"><code>{"role": {"$in": ["admin","mod"]}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$nin</code></td><td style="padding: 10px;">Not in list</td><td style="padding: 10px;"><code>{"role": {"$nin": ["banned"]}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$like</code></td><td style="padding: 10px;">SQL LIKE</td><td style="padding: 10px;"><code>{"email": {"$like": "%@gmail.com"}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$null</code></td><td style="padding: 10px;">IS NULL / NOT NULL</td><td style="padding: 10px;"><code>{"deleted_at": {"$null": true}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$between</code></td><td style="padding: 10px;">BETWEEN</td><td style="padding: 10px;"><code>{"age": {"$between": [18, 65]}}</code></td></tr>
</table>

<div align="center">

# Axiom API Reference

*Complete reference for all REST endpoints*

</div>


## Authentication

All protected endpoints require the `X-Axiom-Key` header containing a **Base64-encoded `key_name:secret`**.

```bash
# Generate your token
TOKEN=$(echo -n "admin:your_secret_here" | base64)

# Use it in requests
curl -H "X-Axiom-Key: $TOKEN" http://localhost:4500/api/v1/db/databases
```

> [!IMPORTANT]
> All write requests (`POST`, `PATCH`, `DELETE`) also require `Content-Type: application/json`.


## Request and Response Headers

- `X-Request-ID` — UUID returned on every response for debugging and tracing.
- `Idempotency-Key` — Optional request header for safe retries on `/query`. Cached responses are returned on retry.

## Response Envelope

Every response follows this structure:

**Success**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error**
```json
{
  "success": false,
  "error": {
    "code": "DB_NOT_FOUND",
    "message": "Database not found"
  }
}
```


## Core Endpoints

### `GET /` - Server Info

No authentication required.

```bash
curl http://localhost:4500/
```

**Response:**
```json
{
  "name": "Axiom",
  "status": "online",
  "version": "2.1.0"
}
```


### `GET /ready` - Readiness Probe

No authentication required. Returns `200 OK` when the server is ready to accept traffic. Used for Kubernetes liveness/readiness probes.

```bash
curl http://localhost:4500/ready
```


### `GET /health` - Deep Health Check

Returns connection status for all configured databases. Infrastructure details are only visible if a `full_admin` key is used.

```bash
curl http://localhost:4500/health \
  -H "X-Axiom-Key: <TOKEN>"
```


## Database API — `/api/v1/db`

> `{alias}` is the database name defined in `config.toml` under `[database.<alias>]`.


### `GET /api/v1/db/databases` - List Databases

Returns all databases the API key has access to, with live connection status and a bounded table count.

```bash
curl http://localhost:4500/api/v1/db/databases \
  -H "X-Axiom-Key: <TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "databases": [
    {
      "name": "main_db",
      "engine": "postgres",
      "mode": "readwrite",
      "status": "connected",
      "tables_count": "99+"
    }
  ]
}
```


### `GET /api/v1/db/{alias}/tables` - List Tables

Returns all tables in the database. Supports cursor-based pagination.

```bash
# First page
curl "http://localhost:4500/api/v1/db/main_db/tables?limit=50" \
  -H "X-Axiom-Key: <TOKEN>"

# Next page
curl "http://localhost:4500/api/v1/db/main_db/tables?limit=50&cursor=users" \
  -H "X-Axiom-Key: <TOKEN>"
```

| Parameter | Default | Description |
|---|---|---|
| `limit` | `50` | Tables per page (max `500`) |
| `cursor` |  | Keyset cursor from previous `next_cursor`. Omit for first page. |



### `POST /api/v1/db/{alias}/query` - Raw SQL

> [!CAUTION]
> All SQL is validated by the AST parser before execution. Operations in `query_blacklist` and DDL (when `dangerous_operations = false`) will be rejected.

```bash
curl -X POST "http://localhost:4500/api/v1/db/main_db/query" \
  -H "X-Axiom-Key: <TOKEN>" \
  -H "Idempotency-Key: idempotency-uuid" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT id, name FROM users WHERE active = :active AND age > :min_age",
    "params": { "active": true, "min_age": 18 },
    "timeout": 5000
  }'
```

*Note: The `timeout` field in the JSON body allows specifying a per-query timeout in milliseconds.*

**Response:**
```json
{
  "success": true,
  "data": {
    "rows": [
      { "id": 1, "name": "Alice" }
    ],
    "affected_rows": 0,
    "row_count": 1
  }
}
```


### `GET /api/v1/db/{alias}/{table}/rows` - Fetch Rows

Fetches rows from a table with filtering, sorting, field selection, and cursor pagination.

```bash
# Basic fetch with filter and sorting
curl -G "http://localhost:4500/api/v1/db/main_db/users/rows" \
  -H "X-Axiom-Key: <TOKEN>" \
  --data-urlencode "limit=50" \
  --data-urlencode "sort=id" \
  --data-urlencode "order=desc" \
  --data-urlencode 'filter={"active":true,"age":{"$gte":18}}' \
  --data-urlencode "fields=id,name,email"

# Next page using cursor
curl -G "http://localhost:4500/api/v1/db/main_db/users/rows" \
  -H "X-Axiom-Key: <TOKEN>" \
  --data-urlencode "limit=50" \
  --data-urlencode "sort=id" \
  --data-urlencode "cursor=eyJpZCI6IDQ1fQ=="
```

| Parameter | Description |
|---|---|
| `limit` | Rows per page (default `50`) |
| `cursor` | Keyset cursor from `next_cursor`. Omit for first page. |
| `sort` | Column to sort by |
| `order` | `asc` or `desc` (default `asc`) |
| `filter` | URL-encoded JSON filter object |
| `fields` | Comma-separated columns to return |
| `search` | Full-text search term |
| `search_fields` | Columns to search across |
| `count` | Set to `1` to include exact `total` count (slower  runs `SELECT COUNT(*)`) |

**Response:**
```json
{
  "success": true,
  "data": {
    "rows": [ { "id": 1, "name": "Alice", "email": "alice@example.com" } ]
  },
  "pagination": {
    "limit": 50,
    "has_more": true,
    "next_cursor": "eyJpZCI6IDQ1fQ=="
  }
}
```


### `POST /api/v1/db/{alias}/{table}/rows` - Insert Rows

```bash
curl -X POST "http://localhost:4500/api/v1/db/main_db/users/rows" \
  -H "X-Axiom-Key: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      { "name": "Alice", "active": true },
      { "name": "Bob",   "active": false }
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "affected_rows": 2
}
```



### `PATCH /api/v1/db/{alias}/{table}/rows` - Update Rows

```bash
curl -X PATCH "http://localhost:4500/api/v1/db/main_db/users/rows" \
  -H "X-Axiom-Key: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "id": 42 },
    "update": { "active": false, "name": "Bob Updated" }
  }'
```

**Response:**
```json
{
  "success": true,
  "affected_rows": 1
}
```


### `DELETE /api/v1/db/{alias}/{table}/rows` - Delete Rows

```bash
curl -X DELETE "http://localhost:4500/api/v1/db/main_db/users/rows" \
  -H "X-Axiom-Key: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "id": 42 }
  }'
```

**Response:**
```json
{
  "success": true,
  "affected_rows": 1
}
```



### `GET /api/v1/db/{alias}/{table}/schema` - Describe Table Schema

Returns the full column schema and foreign key relationships for a table.

```bash
curl "http://localhost:4500/api/v1/db/main_db/users/schema" \
  -H "X-Axiom-Key: <TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "database": "main_db",
    "table": "users",
    "columns": [
      { "name": "id",    "type": "integer", "nullable": false, "primary_key": true },
      { "name": "email", "type": "text",    "nullable": false, "primary_key": false },
      { "name": "org_id","type": "integer", "nullable": true,  "primary_key": false }
    ],
    "foreign_keys": [
      { "column": "org_id", "referenced_table": "organisations", "referenced_column": "id" }
    ]
  }
}
```

> [!NOTE]
> ClickHouse does not enforce traditional foreign key constraints — `foreign_keys` will always be an empty array for ClickHouse databases.


## Supported Database Engines

| Engine | URL Prefix | Notes |
|---|---|---|
| PostgreSQL | `postgres://` / `postgresql://` | Includes Neon, Supabase, CockroachDB, Timescale |
| MySQL | `mysql://` | Includes PlanetScale, TiDB |
| MariaDB | `mariadb://` | |
| Microsoft SQL Server | `mssql://` / `sqlserver://` | Includes Azure SQL |
| SQLite (local) | `sqlite://` | Backed by the Turso `libsql` engine |
| Turso (remote edge) | `libsql://` / `libsql+wss://` | |
| ClickHouse | `clickhouse://` / `clickhouse+https://` | Analytics and big-data workloads |


## Filter Syntax

Filters are JSON objects passed as a URL-encoded string to the `filter=` parameter.

| Operator | Description | Example |
|---|---|---|
| *(shorthand)* | Equality | `{"age": 25}` |
| `$eq` | Equal | `{"age": {"$eq": 25}}` |
| `$ne` | Not equal | `{"status": {"$ne": "banned"}}` |
| `$gt` | Greater than | `{"score": {"$gt": 50}}` |
| `$gte` | Greater or equal | `{"age": {"$gte": 18}}` |
| `$lt` | Less than | `{"price": {"$lt": 100}}` |
| `$lte` | Less or equal | `{"rank": {"$lte": 10}}` |
| `$in` | In list | `{"role": {"$in": ["admin","mod"]}}` |
| `$nin` | Not in list | `{"role": {"$nin": ["banned"]}}` |
| `$like` | SQL LIKE | `{"email": {"$like": "%@gmail.com"}}` |
| `$ilike` | Case-insensitive LIKE | `{"name": {"$ilike": "%alice%"}}` |
| `$null` | IS NULL / NOT NULL | `{"deleted_at": {"$null": true}}` |
| `$between` | BETWEEN | `{"age": {"$between": [18, 65]}}` |
| `$or` | Logical OR | `{"$or": [{"status": "active"}, {"role": "admin"}]}` |
| `$and` | Logical AND | `{"$and": [{"verified": true}, {"age": {"$gte": 18}}]}` |

**Nested example** — verified users who are active OR admins:

```json
{
  "$and": [
    { "email_verified": true },
    {
      "$or": [
        { "status": "active" },
        { "role": "admin" }
      ]
    }
  ]
}
```


<div align="center">

*Axiom — a [Toxichome](https://toxichome.cc) open-source project*

</div>

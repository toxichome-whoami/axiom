<div align="center">

# Axiom - Developer Context Guide

*Quick reference for building integrations and generating code against the Axiom API*

</div>


## What is Axiom?

Axiom is a self-hosted, high-performance Rust database API gateway. It exposes a unified REST API for SQL databases (PostgreSQL, MySQL, MariaDB) with built-in authentication, rate limiting, WAF, and query caching.

**All JSON responses follow this envelope:**

```json
{
  "success": true,
  "data": { ... }
}
```

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

## Authentication

Every protected endpoint requires the `X-Axiom-Key` header.

The value is a **Base64-encoded `key_name:secret`** string from your `config.toml`.

```bash
# Generate the token
echo -n "admin:your_secret_here" | base64
# YWRtaW46eW91cl9zZWNyZXRfaGVyZQ==
```

```http
X-Axiom-Key: YWRtaW46eW91cl9zZWNyZXRfaGVyZQ==
```

**Accepted headers (in priority order):**

| Header | Format |
|---|---|
| `X-Axiom-Key` | `base64(key_name:secret)`  **preferred** |
| `X-Api-Key` | `base64(key_name:secret)` |
| `Authorization` | `Bearer base64(key_name:secret)` |

> [!NOTE]
> All secret comparisons use constant-time operations  timing attacks cannot reveal partial key matches.


## Base URL

```
http://localhost:4500          # local development
https://api.yourdomain.com     # production (behind reverse proxy)
```


## Core Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/` | `GET` |  None | Server info and version |
| `/ready` | `GET` |  None | Kubernetes readiness probe |
| `/health` | `GET` |  Required | Deep health check + DB status |


## Database API — `/api/v1/db`

> The `{alias}` segment is the database name from `config.toml` under `[database.<alias>]`.

### Route Map

| Operation | Method | Path |
|---|---|---|
| List databases | `GET` | `/api/v1/db/databases` |
| List tables | `GET` | `/api/v1/db/{alias}/tables` |
| Fetch rows | `GET` | `/api/v1/db/{alias}/{table}/rows` |
| Insert rows | `POST` | `/api/v1/db/{alias}/{table}/rows` |
| Update rows | `PATCH` | `/api/v1/db/{alias}/{table}/rows` |
| Delete rows | `DELETE` | `/api/v1/db/{alias}/{table}/rows` |
| Raw SQL | `POST` | `/api/v1/db/{alias}/query` |


### Fetch Rows - Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `limit` | int | Rows per page (default `50`, max `500`) |
| `cursor` | string | Keyset cursor from previous `next_cursor` response |
| `sort` | string | Column to sort by |
| `order` | string | `asc` or `desc` (default `asc`) |
| `filter` | JSON string | Filter object  see Filter Syntax below |
| `fields` | string | Comma-separated columns to return |
| `search` | string | Full-text search term |
| `search_fields` | string | Columns to search across |
| `count` | `1` | Include exact `total` count (runs `SELECT COUNT(*)`) |


### Request Body Reference

**Raw SQL**
```json
{
  "sql": "SELECT * FROM users WHERE id = :id",
  "params": { "id": 1 }
}
```

**Insert rows**
```json
{
  "rows": [
    { "name": "Alice", "active": true },
    { "name": "Bob",   "active": false }
  ]
}
```

**Update rows**
```json
{
  "filter": { "id": 42 },
  "update": { "active": false }
}
```

**Delete rows**
```json
{
  "filter": { "id": 42 }
}
```


### Pagination

Axiom uses **keyset / cursor-based pagination**  not page numbers or offsets.

```json
{
  "success": true,
  "data": { "rows": [ ... ] },
  "pagination": {
    "limit": 50,
    "has_more": true,
    "next_cursor": "eyJpZCI6IDQ1fQ=="
  }
}
```

Pass `next_cursor` value as the `cursor=` query parameter on the next request. Omit `cursor` for the first page.


### Filter Syntax

Filters are JSON objects passed as `filter=<url-encoded-json>`.

| Operator | Example |
|---|---|
| Equality (shorthand) | `{"age": 25}` |
| `$eq` | `{"age": {"$eq": 25}}` |
| `$ne` | `{"status": {"$ne": "banned"}}` |
| `$gt` / `$gte` | `{"score": {"$gt": 50}}` |
| `$lt` / `$lte` | `{"rank": {"$lte": 10}}` |
| `$in` | `{"role": {"$in": ["admin", "mod"]}}` |
| `$nin` | `{"role": {"$nin": ["banned"]}}` |
| `$like` | `{"email": {"$like": "%@gmail.com"}}` |
| `$ilike` | `{"name": {"$ilike": "%alice%"}}` |
| `$null` | `{"deleted_at": {"$null": true}}` |
| `$between` | `{"age": {"$between": [18, 65]}}` |
| `$or` | `{"$or": [{"status": "active"}, {"role": "admin"}]}` |
| `$and` | `{"$and": [{"verified": true}, {"age": {"$gte": 18}}]}` |


## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `UNAUTHORIZED` | `401` | Missing or invalid `X-Axiom-Key` |
| `RATE_LIMIT_EXCEEDED` | `429` | Too many requests |
| `RATE_LIMIT_BLOCKED` | `403` | IP or key is banned |
| `AUTH_SCOPE_DENIED` | `403` | Key doesn't have access to this database |
| `DB_NOT_FOUND` | `404` | Unknown database alias |
| `DB_QUERY_FAILED` | `500` | Database returned an error |
| `BAD_REQUEST` | `400` | Invalid request body or parameters |


## Rules for AI Code Generation

1. **Always Base64-encode** `key_name:secret`  never send the raw secret
2. **Use `X-Axiom-Key`** as the primary auth header
3. **All write requests** (`POST`, `PATCH`, `DELETE`) need `Content-Type: application/json`
4. **Pagination is cursor-based**  use `next_cursor` from the response, never page numbers
5. **The `{alias}` param** always comes from the user's `config.toml`  always ask the user for it
6. **Check `"success": false`** before reading `data`  always handle `error.code` and `error.message`
7. **Raw SQL via `/query`** only works if the key has `readwrite` mode and the SQL verb isn't blacklisted


<div align="center">

*Axiom  a [Toxichome](https://toxichome.cc) open-source project*

</div>

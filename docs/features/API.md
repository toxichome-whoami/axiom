<div align="center">
  <h1>Axiom API Reference</h1>
  <p><em>Complete guide to REST endpoints for Databases</em></p>
  <p><strong>Axiom is natively a high-performance REST API gateway.</strong></p>
</div>

<hr/>

# To generate the token in bash:
# TOKEN=$(echo -n "admin:your_secret_here" | base64)

curl -X GET "http://localhost:4500/api/v1/db/databases" \
     -H "X-Axiom-Key: $TOKEN"
```

---

## Core Endpoints

### 1. Server Info & Feature Flags
```bash
curl -X GET "http://localhost:4500/"
```

### 2. Kubernetes Readiness Probe
Does not require authentication.
```bash
curl -X GET "http://localhost:4500/ready"
```

### 3. Deep Health Check
```bash
curl -X GET "http://localhost:4500/health" \
     -H "X-Axiom-Key: <TOKEN>"
```



---

## Database API <code>/api/v1/db</code>

### 1. List Databases
```bash
curl -X GET "http://localhost:4500/api/v1/db/databases" \
     -H "X-Axiom-Key: <TOKEN>"
```
Returns all databases the key has access to with connection status and table count. Health checks are cached for 5 seconds.

### 2. List Tables (Paginated)
```bash
# Initial request
curl -X GET "http://localhost:4500/api/v1/db/main_db/tables?limit=50" \
     -H "X-Axiom-Key: <TOKEN>"

# Subsequent pages
curl -X GET "http://localhost:4500/api/v1/db/main_db/tables?limit=50&cursor=users_table" \
     -H "X-Axiom-Key: <TOKEN>"
```
**Parameters:**
- `limit` — Max tables per page (default 50, max 500)
- `cursor` — Keyset cursor string returned from the previous page's `next_cursor` field. Omit for the first page.

### 3. Execute Raw SQL
> [!CAUTION]
> Raw SQL is validated by AST parser. Dangerous operations blocked per config.

```bash
curl -X POST "http://localhost:4500/api/v1/db/main_db/query" \
     -H "X-Axiom-Key: <TOKEN>" \
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
     --data-urlencode "cursor=eyJ2IjogNDV9"
```

**Parameters:**
- `cursor` — Keyset cursor string returned from the previous page's `next_cursor` field. Omit for the first page.
- `limit` — Rows per page (default 50)
- `sort` — Column to sort by (validated against real table columns)
- `order` — `asc` or `desc` (default `asc`)
- `filter` — JSON filter object
- `fields` — Comma-separated columns to return (validated against real table columns)
- `search` — Full-text search term
- `search_fields` — Columns to search across
- `count` — Set to `1` to include exact `total` in pagination (runs `SELECT COUNT(*)`)
  — Omit for faster responses (infers `has_more` from row count)

### 5. Insert Rows
```bash
curl -X POST "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "rows": [{"name": "Alice", "active": true}]
         }'
```

### 6. Update Rows
```bash
curl -X PATCH "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "filter": {"id": 42},
           "update": {"active": false}
         }'
```

### 7. Delete Rows
```bash
curl -X DELETE "http://localhost:4500/api/v1/db/main_db/users/rows" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "filter": {"id": 42}
         }'
```



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
  <tr><td style="padding: 10px;"><code>$ilike</code></td><td style="padding: 10px;">Case-insensitive LIKE</td><td style="padding: 10px;"><code>{"name": {"$ilike": "%alice%"}}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$or</code></td><td style="padding: 10px;">Logical OR (list of sub-filters)</td><td style="padding: 10px;"><code>{"$or": [{"status": "active"}, {"role": "admin"}]}</code></td></tr>
  <tr><td style="padding: 10px;"><code>$and</code></td><td style="padding: 10px;">Logical AND (list of sub-filters)</td><td style="padding: 10px;"><code>{"$and": [{"age": {"$gte": 18}}, {"verified": true}]}</code></td></tr>
</table>

**Logical nesting example** — users who are active OR are admins, AND have a verified email:
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

# Axiom — Full Audit & Test Guide

This document is written for an AI model or developer performing a structured audit of the Axiom backend gateway. It covers security testing, functional correctness, edge cases, known gaps, and suggested test scripts. All information is based on the actual source code, not just the public documentation.

---

## Project Overview

**Language:** Rust  
**Runtime:** Tokio (`current_thread` flavor — single OS thread, async cooperative)  
**Config:** `config.toml` loaded once at startup into `OnceLock<Arc<AxiomConfig>>`  
**Default port:** `4500` (HTTP/REST), `4501` (gRPC)  
**Auth:** `X-Axiom-Key: base64(key_name:secret)` on all endpoints except `/` and `/ready`

**Source modules:**
```
src/
├── api/
│   ├── auth/         Ed25519 JWT auth system
│   ├── core/         health, metrics, server info
│   ├── database/     SQL gateway
│   ├── federation/   multi-node federation
│   ├── graphql/      optional GraphQL layer
│   ├── mcp/          Model Context Protocol
│   ├── sse/          Server-Sent Events
│   ├── storage/      file system gateway
│   └── ws/           WebSocket gateway
├── middleware/
│   ├── auth.rs       X-Axiom-Key validation + base64 decode
│   ├── rate_limit.rs per-IP rate limiting + penalty bans
│   ├── waf.rs        body size, URI length, path traversal, null byte, param flood
│   └── cache.rs      in-memory response + query cache
├── security/
│   └── ban_list.rs   IP + key ban registry
├── config/
│   ├── loader.rs     figment TOML + env merge with __ separator
│   └── schema.rs     typed config structs
└── db/
    └── pool.rs       multi-engine connection pool (postgres/mysql/sqlite/mssql)
```

---

## Part 1 — Security Audit

### 1.1 Authentication Layer (`src/middleware/auth.rs`)

**What it does:**
1. Reads `X-Axiom-Key` or `X-Api-Key` header
2. Wraps value as `Bearer <value>`
3. Base64-decodes and splits on first `:` → `(key_name, key_secret)`
4. Looks up `key_name` in `config.api_key` or `config.federation.incoming`
5. Compares `key_secret` to stored `secret` (plain string comparison)

**Tests to run:**

```bash
# Should return 401
curl http://localhost:4500/api/v1/db/databases

# Should return 401 — empty key
curl http://localhost:4500/api/v1/db/databases -H "X-Axiom-Key: "

# Should return 401 — invalid base64
curl http://localhost:4500/api/v1/db/databases -H "X-Axiom-Key: notbase64!!!"

# Should return 401 — valid base64 but wrong secret
curl http://localhost:4500/api/v1/db/databases -H "X-Axiom-Key: $(echo -n 'admin:wrongsecret' | base64)"

# Should return 401 — colon only, no name
curl http://localhost:4500/api/v1/db/databases -H "X-Axiom-Key: $(echo -n ':secret' | base64)"

# Should return 401 — name only, no colon
curl http://localhost:4500/api/v1/db/databases -H "X-Axiom-Key: $(echo -n 'admin' | base64)"

# Should return 401 — empty secret (config.toml has guard: !key_cfg.secret.is_empty())
curl http://localhost:4500/api/v1/db/databases -H "X-Axiom-Key: $(echo -n 'admin:' | base64)"

# Should return 200 — correct token
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)
curl http://localhost:4500/api/v1/db/databases -H "X-Axiom-Key: $TOKEN"
```

**Audit questions:**
- [ ] Is the secret comparison constant-time? (plain `==` in Rust is NOT constant-time — timing attacks possible)
- [ ] What happens with a 10MB `X-Axiom-Key` header? Does the WAF catch it before auth runs?
- [ ] Can an attacker enumerate valid key names via timing differences?

---

### 1.2 WAF Middleware (`src/middleware/waf.rs`)

**What it checks:**
- Body size vs `server.body_limit` (default 10MB) — checks `Content-Length` header only
- URI + query total length > 2048 → 414
- Path traversal: `../`, `..\`, `%2e%2e%2f`, `%2e%2e%5c`
- Null byte in path or query
- More than 50 `&` characters in query string

**Tests to run:**

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# Path traversal — should 400
curl "http://localhost:4500/api/v1/db/../../../etc/passwd" -H "X-Axiom-Key: $TOKEN"

# URL-encoded traversal — should 400
curl "http://localhost:4500/api/v1/db/%2e%2e%2f%2e%2e%2fetc/passwd" -H "X-Axiom-Key: $TOKEN"

# Double URL encoding — MAY NOT be caught (%252e%252e%252f decodes to %2e%2e%2f on second pass)
curl "http://localhost:4500/api/v1/%252e%252e/etc/passwd" -H "X-Axiom-Key: $TOKEN"

# Null byte injection — should 400
curl $'http://localhost:4500/api/v1/db/localdb\x00/tables' -H "X-Axiom-Key: $TOKEN"

# Query param flood — should 400
PARAMS=$(python3 -c "print('&'.join(['a=b']*55))")
curl "http://localhost:4500/api/v1/db/databases?$PARAMS" -H "X-Axiom-Key: $TOKEN"

# URI too long — should 414
LONGPATH=$(python3 -c "print('a'*2100)")
curl "http://localhost:4500/api/v1/$LONGPATH" -H "X-Axiom-Key: $TOKEN"
```

**Known gap to test:**
- [ ] The WAF checks `Content-Length` but does NOT read and validate the actual body size. A chunked transfer (`Transfer-Encoding: chunked`) with no `Content-Length` header could bypass the body size limit. Test this.

```bash
# Chunked body bypass attempt
python3 -c "
import socket, time
s = socket.socket()
s.connect(('localhost', 4500))
body = 'A' * (15 * 1024 * 1024)  # 15MB, above default 10MB limit
req = f'POST /api/v1/db/localdb/query HTTP/1.1\r\nHost: localhost\r\nX-Axiom-Key: TOKEN\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n{hex(len(body))[2:]}\r\n{body}\r\n0\r\n\r\n'
s.send(req.encode())
print(s.recv(4096).decode())
"
```

---

### 1.3 SQL Injection & AST Validation (`src/api/database/`)

Axiom uses `sqlparser` for AST validation. Dangerous operations are blocked via `query_blacklist` and `dangerous_operations` flag.

**Tests to run:**

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# Basic injection attempt — should be rejected by AST
curl -X POST http://localhost:4500/api/v1/db/localdb/query \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users; DROP TABLE users;--", "params": {}}'

# UNION injection
curl -X POST http://localhost:4500/api/v1/db/localdb/query \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT 1 UNION SELECT secret FROM api_keys", "params": {}}'

# Sleep/timing attack
curl -X POST http://localhost:4500/api/v1/db/localdb/query \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT pg_sleep(5)", "params": {}}'

# Stacked queries
curl -X POST http://localhost:4500/api/v1/db/localdb/query \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT 1; SELECT 2", "params": {}}'

# Param binding bypass — should use :param not raw interpolation
curl -X POST http://localhost:4500/api/v1/db/localdb/query \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users WHERE name = :name", "params": {"name": "admin'\''--"}}'

# DROP via dangerous_operations=false (default blocks it)
curl -X POST http://localhost:4500/api/v1/db/localdb/query \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "DROP TABLE users", "params": {}}'
```

---

### 1.4 Path Traversal in Storage (`src/api/storage/`)

**Tests to run:**

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# Direct traversal in path param — should be blocked by WAF or storage handler
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=/../../../etc/passwd" \
  -H "X-Axiom-Key: $TOKEN"

# Encoded traversal
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=%2F..%2F..%2Fetc%2Fpasswd" \
  -H "X-Axiom-Key: $TOKEN"

# Null byte in filename
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=/file.txt%00.jpg" \
  -H "X-Axiom-Key: $TOKEN"

# Symlink escape — create a symlink in the storage dir first, then try to access it
# (requires server-side setup)

# Absolute path injection
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=/etc/passwd" \
  -H "X-Axiom-Key: $TOKEN"

# Windows UNC path (if running on Windows)
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=\\\\attacker.com\\share" \
  -H "X-Axiom-Key: $TOKEN"
```

---

### 1.5 Rate Limiting & Ban System

**What's in place:**
- Per-IP rate limit: `max_requests` per `window` seconds
- Burst allowance
- Penalty ban after `penalty_threshold` violations
- IP ban list (`BanList::is_ip_banned`)
- Key ban list (`BanList::is_key_banned`)
- Wildcard IP allowlist (new feature: `103.137.7.*`)

**Tests to run:**

```bash
# Flood test — should trigger rate limit before 100 requests
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)
for i in $(seq 1 150); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    "http://localhost:4500/api/v1/db/databases" \
    -H "X-Axiom-Key: $TOKEN"
done

# Verify allowed IP bypasses rate limit — should never get 429
# (test from an IP in allowed_ips range)

# Verify banned IP gets 403 immediately
```

**Audit questions:**
- [ ] Is the rate limiter per-IP or per-key? If per-IP only, a key can be shared across IPs without limit enforcement per key.
- [ ] Does the `allowed_ips` wildcard bypass rate limiting AND ban checks, or only rate limiting?

---

### 1.6 Auth System Security (`src/api/auth/`)

**Tests to run:**

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)
BASE="http://localhost:4500/api/v1/auth/admin"

# Signup
curl -X POST "$BASE/signup" -H "X-Axiom-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Password123!"}'

# Login
curl -X POST "$BASE/login" -H "X-Axiom-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Password123!"}'

# Brute force protection — attempt 6 failed logins, 6th should lock
for i in $(seq 1 7); do
  curl -X POST "$BASE/login" -H "X-Axiom-Key: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrongpass"}' | python3 -m json.tool
done

# JWT tampering — modify the payload of a valid token
# Take a valid access_token, base64-decode the payload, change role, re-encode, sign with wrong key
# Should return 401

# Refresh token reuse — use the same refresh_token twice
# First use: should succeed and return new tokens
# Second use: should return AUTH_TOKEN_STOLEN and revoke all sessions

# Expired token — wait for access_token TTL to pass, then use it
# Should return AUTH_TOKEN_EXPIRED

# Access user endpoint without X-User-Access-Token — should 401
curl -X GET "$BASE/user" -H "X-Axiom-Key: $TOKEN"

# Access admin endpoint without full_admin key — should 403
# (use a non-admin key for this test)

# Mass signup from same IP — test max_signup_per_ip limit
for i in $(seq 1 15); do
  curl -X POST "$BASE/signup" -H "X-Axiom-Key: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"user$i@example.com\",\"password\":\"Password123!\"}" \
    | python3 -m json.tool
done
```

---

## Part 2 — Functional Correctness

### 2.1 Database API

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# List databases — verify both connected DBs appear
curl "http://localhost:4500/api/v1/db/databases" -H "X-Axiom-Key: $TOKEN"

# List tables with cursor pagination — verify next_cursor is returned
curl "http://localhost:4500/api/v1/db/localdb/tables?limit=2" -H "X-Axiom-Key: $TOKEN"

# Fetch rows with all params
curl "http://localhost:4500/api/v1/db/localdb/users/rows?limit=5&sort=id&order=desc&fields=id,name&count=1" \
  -H "X-Axiom-Key: $TOKEN"

# Fetch rows with filter operators
curl -G "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $TOKEN" \
  --data-urlencode 'filter={"age":{"$gte":18},"status":"active"}'

# Fetch rows with $or filter
curl -G "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $TOKEN" \
  --data-urlencode 'filter={"$or":[{"role":"admin"},{"role":"mod"}]}'

# Insert
curl -X POST "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"rows":[{"name":"Test User","email":"t@t.com","active":true}]}'

# Update
curl -X PATCH "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"filter":{"email":"t@t.com"},"update":{"active":false}}'

# Delete
curl -X DELETE "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"filter":{"email":"t@t.com"}}'

# Edge: access DB not in db_scope — should 403
# (requires a key with limited db_scope)

# Edge: access nonexistent DB alias — should 404 or 400
curl "http://localhost:4500/api/v1/db/nonexistent_db/tables" -H "X-Axiom-Key: $TOKEN"

# Edge: empty filter on delete — what happens?
curl -X DELETE "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"filter":{}}'
```

---

### 2.2 Storage API

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# List
curl "http://localhost:4500/api/v1/fs/storages" -H "X-Axiom-Key: $TOKEN"
curl "http://localhost:4500/api/v1/fs/local_uploads/list?path=/" -H "X-Axiom-Key: $TOKEN"
curl "http://localhost:4500/api/v1/fs/local_uploads/list?path=/&recursive=true&limit=100" \
  -H "X-Axiom-Key: $TOKEN"

# Direct upload
curl -X POST "http://localhost:4500/api/v1/fs/local_uploads/upload" \
  -H "X-Axiom-Key: $TOKEN" \
  -F "action=direct" \
  -F "path=/test/hello.txt" \
  -F "file=@/tmp/hello.txt"

# Download
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=/test/hello.txt" \
  -H "X-Axiom-Key: $TOKEN" -o /tmp/downloaded.txt

# Image resize
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=/test/photo.jpg&width=100&height=100&fit=cover" \
  -H "X-Axiom-Key: $TOKEN" -o /tmp/thumb.jpg

# File info
curl -X POST "http://localhost:4500/api/v1/fs/local_uploads/action" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"info","source":"/test/hello.txt"}'

# Exists check
curl -X POST "http://localhost:4500/api/v1/fs/local_uploads/action" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"exists","source":"/test/hello.txt"}'

# Rename
curl -X POST "http://localhost:4500/api/v1/fs/local_uploads/action" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"rename","source":"/test/hello.txt","target":"/test/renamed.txt"}'

# Bulk delete
curl -X POST "http://localhost:4500/api/v1/fs/local_uploads/action" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"bulk_delete","sources":["/test/renamed.txt"]}'

# Edge: upload blocked extension
curl -X POST "http://localhost:4500/api/v1/fs/local_uploads/upload" \
  -H "X-Axiom-Key: $TOKEN" \
  -F "action=direct" -F "path=/test/evil.exe" -F "file=@/tmp/test.exe"

# Edge: download nonexistent file — should 404
curl "http://localhost:4500/api/v1/fs/local_uploads/download?path=/does_not_exist.txt" \
  -H "X-Axiom-Key: $TOKEN"

# Edge: readonly key tries to upload — should 403
```

---

### 2.3 GraphQL API

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# Basic execute
curl -X POST "http://localhost:4500/api/v1/graphql" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ execute(dbAlias: \"localdb\", sql: \"SELECT 1 as test\", params: {}) }"}'

# List databases
curl -X POST "http://localhost:4500/api/v1/graphql" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ databases }"}'

# Table query with cursor
curl -X POST "http://localhost:4500/api/v1/graphql" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ users(dbAlias: \"localdb\", limit: 5, sort: \"id\", order: \"asc\") { id name } }"}'

# Mutation insert
curl -X POST "http://localhost:4500/api/v1/graphql" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation { insert_users(dbAlias: \"localdb\", row: { name: \"GQL User\" }) }"}'

# Deeply nested query — should be blocked at max_query_depth (default 15)
# Build a query with 20 levels of nesting and verify rejection

# Access DB not in scope — should return GraphQL error
curl -X POST "http://localhost:4500/api/v1/graphql" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ execute(dbAlias: \"secret_db\", sql: \"SELECT 1\") }"}'
```

---

### 2.4 SSE & WebSocket

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# SSE — DB stream (should emit events when rows change)
curl -N "http://localhost:4500/api/v1/sse/db/localdb/users?token=$TOKEN"

# SSE — health (no auth required)
curl -N "http://localhost:4500/api/v1/sse/health"

# SSE — metrics
curl -N "http://localhost:4500/api/v1/sse/metrics?token=$TOKEN"
```

```javascript
// WebSocket browser test — paste in browser console
const token = btoa("admin:YOUR_SECRET");
const ws = new WebSocket("ws://localhost:4500/api/v1/ws");
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "auth", token }));
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  console.log(msg);
  if (msg.type === "connected") {
    ws.send(JSON.stringify({ type: "subscribe", topic: "db:localdb:users", request_id: "r1" }));
  }
};
// Then trigger a DB mutation and verify the event fires
```

**Edge cases:**
- [ ] Connect WebSocket, do not send auth message — should close with 4001 after 5 seconds
- [ ] Connect WebSocket, send malformed JSON as first message — should close with 4001
- [ ] Subscribe to a DB alias not in key's `db_scope` — should return `denied` ack

---

## Part 3 — Scope & Permission Tests

These tests require creating two API keys in `config.toml`:

```toml
[api_key.readonly_key]
secret = "readonly_secret_here_32_chars_min"
mode = "readonly"
db_scope = ["localdb"]
fs_scope = []
feature_scope = ["*"]
full_admin = false

[api_key.limited_key]
secret = "limited_secret_here_32_chars_min"
mode = "readwrite"
db_scope = ["localdb"]
fs_scope = ["local_uploads"]
feature_scope = ["sse"]
full_admin = false
```

```bash
RO_TOKEN=$(echo -n "readonly_key:readonly_secret_here_32_chars_min" | base64)
LIM_TOKEN=$(echo -n "limited_key:limited_secret_here_32_chars_min" | base64)

# Readonly key tries to insert — should 403
curl -X POST "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $RO_TOKEN" -H "Content-Type: application/json" \
  -d '{"rows":[{"name":"Hack"}]}'

# Limited key accesses DB not in its scope — should 403
curl "http://localhost:4500/api/v1/db/localdb_2/tables" -H "X-Axiom-Key: $LIM_TOKEN"

# Limited key accesses GraphQL (not in feature_scope) — should 403
curl -X POST "http://localhost:4500/api/v1/graphql" \
  -H "X-Axiom-Key: $LIM_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ databases }"}'

# Limited key accesses MCP (not in feature_scope) — should 403
curl "http://localhost:4500/api/v1/mcp/sse" -H "X-Axiom-Key: $LIM_TOKEN"

# Non-admin key accesses admin auth endpoint — should 403
curl "http://localhost:4500/api/v1/auth/admin/admin/users" -H "X-Axiom-Key: $RO_TOKEN"
```

---

## Part 4 — Edge Cases & Stress

### 4.1 Malformed Input

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# Malformed JSON body
curl -X POST "http://localhost:4500/api/v1/db/localdb/query" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d 'not json at all'

# Missing required fields
curl -X POST "http://localhost:4500/api/v1/db/localdb/query" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{}'

# SQL with only whitespace
curl -X POST "http://localhost:4500/api/v1/db/localdb/query" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql":"   ","params":{}}'

# Extremely long SQL string
python3 -c "
import json
payload = json.dumps({'sql': 'SELECT ' + 'a,'*10000 + '1', 'params': {}})
print(payload)
" | curl -X POST "http://localhost:4500/api/v1/db/localdb/query" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" -d @-

# Insert with 1000 rows at once
python3 -c "
import json
rows = [{'name': f'User {i}', 'email': f'u{i}@test.com'} for i in range(1000)]
print(json.dumps({'rows': rows}))
" | curl -X POST "http://localhost:4500/api/v1/db/localdb/users/rows" \
  -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" -d @-
```

### 4.2 Concurrency

```bash
TOKEN=$(echo -n "admin:YOUR_SECRET" | base64)

# Fire 100 simultaneous requests
for i in $(seq 1 100); do
  curl -s "http://localhost:4500/api/v1/db/databases" -H "X-Axiom-Key: $TOKEN" &
done
wait

# Simultaneous writes to same row — verify no data corruption
for i in $(seq 1 50); do
  curl -s -X PATCH "http://localhost:4500/api/v1/db/localdb/users/rows" \
    -H "X-Axiom-Key: $TOKEN" -H "Content-Type: application/json" \
    -d '{"filter":{"id":1},"update":{"counter":'"$i"'}}' &
done
wait
```

---

## Part 5 — Known Gaps (Features Not Yet Implemented)

These are confirmed missing from the codebase. Do NOT expect them to work.

| Feature | Status | Impact |
|---------|--------|--------|
| OAuth providers (Google, GitHub, Discord) | Not implemented | High — most developers expect social login |
| Presigned upload URLs | Not implemented | Medium — large file uploads go through Axiom |
| Database schema migrations | Not implemented | Medium — no `ALTER TABLE` history |
| TypeScript / Python / Go SDKs | Not implemented | High — adoption barrier |
| Per-endpoint rate limiting | Not implemented | Medium — `/login` and `/query` share same rate limit |
| Gateway-level audit log | Not implemented | Medium — no record of which key ran which SQL |
| Admin UI / dashboard | Not implemented | Low for now |
| Constant-time secret comparison | Not implemented | Low (local deployments), High (internet-facing) |

---

## Part 6 — Configuration Edge Cases

### 6.1 Environment Variable Overrides

All `config.toml` values can be overridden via env vars using `__` as the separator:

```bash
# These should all override config.toml at startup
SERVER__PORT=4501 ./axiom
DATABASE__LOCALDB__URL="postgres://..." ./axiom
API_KEY__ADMIN__DB_SCOPE='["localdb","localdb_2"]' ./axiom
FEATURES__GRAPHQL=false ./axiom
```

**Test:** Start server with a conflicting env var — verify env var wins over `config.toml`.

### 6.2 Duplicate Array Values

The `toml2env.go` script deduplicates array values. Verify that:

```toml
db_scope = ["localdb", "localdb", "localdb_2"]
```

Results in `DB_SCOPE=["localdb","localdb_2"]` in `.env`.

### 6.3 Wildcard Allowed IPs

```toml
allowed_ips = ["103.137.7.*", "127.0.0.1"]
```

Test that `103.137.7.50` is exempt from rate limits but `103.137.8.1` is not.

---

## Part 7 — Suggested Audit Priorities

Run these in order. Stop and report findings at each level before proceeding.

1. **Auth bypass** — Can you access any endpoint without a valid key?
2. **Scope escape** — Can a `readonly` key write data? Can a limited `db_scope` key access other DBs?
3. **SQL injection** — Does the AST validator catch all cases including encoded/nested attacks?
4. **Path traversal** — Can you read files outside the configured storage root?
5. **Body size bypass** — Can chunked encoding bypass the 10MB WAF limit?
6. **Rate limit bypass** — Can you exceed the rate limit from an IP not in `allowed_ips`?
7. **Auth token manipulation** — Can a tampered JWT be accepted?
8. **Refresh token reuse** — Does the second use of a refresh token correctly revoke all sessions?
9. **Admin endpoint access** — Can a non-`full_admin` key access `/admin/` routes?
10. **Concurrent write safety** — Do parallel writes produce consistent data without corruption?

---

## Useful Commands

```bash
# Generate a valid token for any key
TOKEN=$(echo -n "key_name:secret_value" | base64)

# Pretty-print JSON responses
curl ... | python3 -m json.tool

# Watch server logs in real time (if running locally)
tail -f axiom.log

# Check if server is alive
curl http://localhost:4500/ready
```

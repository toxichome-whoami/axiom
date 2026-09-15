# Axiom API — AI Context

Axiom is a self-hosted, high-performance Rust database API gateway. Exposes REST APIs for databases. All responses: `{"success": true|false, "data": ..., "error": {"code": "...", "message": "..."}}`.

---

## Auth

Every request needs `X-Axiom-Key` header. Value = `base64(key_name:secret)`.

```
X-Axiom-Key: YWRtaW46c2VjcmV0
                ↑ base64("admin:secret")
```

---

## Base URL

```
https://your-host.com   (or http://localhost:4500 locally)
```

---

## Core Endpoints

| What | Path | Auth |
|------|------|------|
| Server info + feature flags | `GET /` | None |
| Readiness probe | `GET /ready` | None |
| Deep health + DB status | `GET /health` | X-Axiom-Key |

---

## Database API  `/api/v1/db`

> **Alias** = name from `config.toml` `[database.<alias>]`.

| What | Method + Path |
|------|--------------|
| List all DBs | `GET /api/v1/db/databases` |
| List tables (paginated) | `GET /api/v1/db/{alias}/tables?limit=50&cursor=` |
| Fetch rows (paginated) | `GET /api/v1/db/{alias}/{table}/rows` |
| Insert rows | `POST /api/v1/db/{alias}/{table}/rows` |
| Update rows | `PATCH /api/v1/db/{alias}/{table}/rows` |
| Delete rows | `DELETE /api/v1/db/{alias}/{table}/rows` |
| Raw SQL | `POST /api/v1/db/{alias}/query` |

**Fetch rows params:** `limit`, `cursor`, `sort`, `order=asc|desc`, `filter={"col":val}`, `fields=col1,col2`, `search`, `search_fields`, `count=1`

**Raw SQL body:** `{"sql": "SELECT * FROM t WHERE id = :id", "params": {"id": 1}}`

**Insert body:** `{"rows": [{"col": "val"}]}`

**Update body:** `{"filter": {"id": 1}, "update": {"col": "newval"}}`

**Delete body:** `{"filter": {"id": 1}}`

Pagination is **keyset/cursor-based** — use `next_cursor` from response as `cursor=` on the next call.

---

## Key Rules for AI Code Generation

1. **Always base64-encode** `key_name:secret` for `X-Axiom-Key`. Never send plaintext.
2. **Pagination is cursor-based.** Use `next_cursor` from response, not page/offset numbers.
3. **All write endpoints** need `Content-Type: application/json`.
4. **Admin routes** require `X-Axiom-Key` from a key with `full_admin = true` in config.
5. **DB alias** comes from the user's `config.toml` — always ask the user.
6. **All responses** include `"success": true|false`. On error, read `error.code` + `error.message`.

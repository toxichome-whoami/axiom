<div align="center">

# Troubleshooting

**Match your error code → apply the fix.** Release builds return generic messages on purpose — pair each row with the server log (`X-Request-ID`).

</div>

---

## Error codes

| Code | HTTP | Meaning | Fix |
|---|---|---|---|
| `WAF_URI_TOO_LONG` | 414 | URI > 2048 chars | Move long filters into POST bodies |
| `WAF_NULL_BYTE` | 400 | `%00` / null | Remove null bytes / bad encoding |
| `WAF_TOO_MANY_PARAMS` | 400 | > 50 query params | Batch into POST body |
| `WAF_BODY_TOO_LARGE` | 413 | Over `body_limit` | Shrink payload or raise limit; blobs use `max_object` |
| `WAF_PATH_TRAVERSAL` | 400 | `..` after decode | Use clean keys/paths |
| `WAF_SQL_INJECTION` | 400 | SQL keyword in URL | Send SQL in POST body as parameterized `sql`+`params` |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Back off; check `X-RateLimit-*`; add `allowed_ips` for scrapers |
| `BANNED` | 403 | IP/key banned | Wait `penalty_cooldown` or `DELETE` the ban; check brute-force source |
| `AUTH_INVALID` / `UNAUTHORIZED` | 401 | Bad key format/secret | Send `base64(name:secret)` in `X-Axiom-Key` |
| `AUTH_FORBIDDEN` | 403 | RBAC denial (incl. ticket `DELETE`) | Grant the role op, or use a non-ticket credential for deletes |
| `BAD_TICKET_OP` | 400 | Ticket op ∉ {READ, WRITE} | Use `READ`/`WRITE` |
| `MULTI_STATEMENT_DENIED` | 400 | `;`-joined SQL | One statement per request |
| `BAD_COLUMN_DEF` | 400 | `add_column` allowlist rejection | Use a base type (`VARCHAR(255)`), literal default, valid FK action |
| `RANGE_NOT_SATISFIABLE` | 416 | Bad/multi/too-large Range | Single `bytes=S-E` ≤ 256 MB, no commas |
| `DB_NOT_FOUND` | 404 | Unknown alias (legacy blocks seed once) | `axiom db list` → `axiom reload` |
| `SQL_PARSE_ERROR` | 400 | Dialect couldn't parse | Check dialect + placeholders (`?` vs `$1`) |
| `ADD_COLUMN_FAILED` | 500 | Engine rejected DDL (generic in prod) | Check server log with `X-Request-ID` |
| `NOT_FOUND` | 404 | Unknown route | Check `/api/v1` vs `/admin/v1` vs `/mcp/v1` prefixes |

## Quick recipes

```bash
# Am I up? (no auth)
curl -i http://127.0.0.1:4500/ready

# Authenticated? (should NOT be AUTH_INVALID)
curl -i -H "X-Axiom-Key: $KEY" http://127.0.0.1:4500/api/v1/db/databases

# CORS preflight from your app origin (must list your origin, not *)
curl -i -X OPTIONS http://127.0.0.1:4500/api/v1/db/databases \
  -H "Origin: https://app.example.com" -H "Access-Control-Request-Method: GET"

# Ticket TTL clamp check (999999999 → 86400)
curl -X POST http://127.0.0.1:4500/api/v1/blobs/media/ticket \
  -H "X-Axiom-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"key":"a.png","operation":"READ","ttl_seconds":999999999}'

# Config sanity
axiom config show
axiom doctor
```

Still stuck? [Deployment](./deployment.md) → [Security](../reference/security.md) → open an issue with `X-Request-ID` + redacted config.

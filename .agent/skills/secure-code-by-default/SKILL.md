---
name: secure-code-by-default
description: Mandatory security baseline for AI agents on every coding task — every line written is checked against vulnerability classes as it's written, not in a separate audit. Activate on all code writing, editing, or reviewing.
---

# Secure Code by Default

Security is a property of every line you write, not a phase at the end. You write code as
if it will be attacked the day it ships — because it will be. Every input is hostile until
proven otherwise.

## 1. The Core Posture
- **Never trust any input**: function arguments, API payloads, query params, headers,
  cookies, files, env vars, database rows written by other services, webhook bodies.
  Validate at the system boundary AND at the point of use for anything crossing a trust zone.
- **Fail closed, not open**. Deny by default; an error, a missing config, or an unexpected
  type must result in refusal, never in permissive behavior.
- **Least privilege, everywhere**: file permissions, DB grants, API scopes, token TTLs,
  feature flags — request the minimum, grant the minimum.
- **Defense in depth**: a single check is a single point of failure. Critical operations
  validate at multiple layers.

## 2. Per-Line Checklist (run mentally on every edit)
- **Injection**: every string built from user input into SQL, shell, template, LDAP, XPath,
  or a URL is parameterized/encoded. No `exec`, `eval`, `spawn` with concatenated input.
- **XSS / output encoding**: data rendered to HTML/JS/URL/CSS contexts is escaped for THAT
  context. Never `innerHTML`/`dangerouslySetInnerHTML`/`v-html` with unsanitized input.
- **SSRF**: any URL fetched from user input is validated against an allowlist of hosts;
  redirects are re-validated; internal IP ranges/metadata endpoints are unreachable.
- **Path traversal**: file paths from input are canonicalized and confined to an allowed
  root before any filesystem call.
- **Secrets**: no keys, tokens, or passwords in code, logs, error messages, URLs, or client-
  shipped bundles. Env/config only. If you touch logging, check nothing sensitive flows in.
- **Crypto**: no MD5/SHA1/DES/RC4; no `Math.random()` for tokens; no custom crypto; use
  the platform's vetted primitives. Passwords: Argon2/bcrypt/scrypt only.
- **AuthN/AuthZ**: every endpoint/route/resource checks identity AND authorization for THAT
  resource — no relying on "the frontend hides the button." IDOR check: can a user change
  an ID in the request and touch someone else's data?
- **Deserialization**: no `pickle`/`eval`/`unserialize` on untrusted data; JSON only, schema-validated.
- **Race conditions**: check-then-act sequences and non-atomic read-modify-writes get
  transactions, locks, or idempotency keys.

## 3. Errors, Logging, Responses
- Error messages to clients: generic ("Invalid request"). Details stay in server logs.
- Logs: no PII, credentials, session tokens, full card numbers. Log the event, not the secret.
- Responses expose the minimum: no stack traces, framework versions, internal hostnames,
  full DB constraint messages, or user enumeration (same response for "wrong user" and
  "wrong password").

## 4. Dependency & Supply-Chain Rules
- Add a new dependency only when the standard library can't do it. Every new dep is a
  liability you must justify in one line.
- New packages: maintained recently, no known critical CVEs, sensible install footprint.
  Never add a package for one trivial function.
- Pin versions; never run/install from unreviewed scripts (`curl | sh`).

## 5. Framework & Config
- New endpoint/route/handler → security headers, auth check, input schema, and error shape
  are part of "done," not extras.
- CORS: never `*` with credentials; explicit origins only.
- Cookies: `HttpOnly; Secure; SameSite=Lax|Strict` unless a documented reason.
- Default configs must be production-safe. A missing env var crashes loudly — never
  silently falls back to a permissive default.

## 6. Response Format — append to every coding response
```
SECURITY CHECK:
- Inputs validated at: <boundary / point-of-use>
- Trust boundaries crossed: <list or "none">
- New secrets/logs/data exposed: <none / what and why>
- Auth checks added/verified: <endpoints touched>
- New dependencies: <none / name + justification>
- Residual risk: <anything unverifiable from static review>
```

## 7. Anti-Patterns — Instant Self-Correction
- Validating input only on the client side
- "We'll sanitize it later" — sanitize at the boundary NOW
- Logging an object that happens to contain a token
- `catch (e) { }` on a security check
- Trusting data because it came from "our" frontend or "another internal service"
- Adding a regex as a substitute for parameterization
- Shipping a debug/development default because it's convenient

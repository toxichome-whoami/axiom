<div align="center">
  <h1>Axiom API Reference</h1>
  <p><em>Complete guide to REST and SSE endpoints for Databases, Storage, Webhooks, MCP, and GraphQL</em></p>
  <p><strong>Axiom is natively a REST API gateway.</strong> GraphQL is an optional secondary interface — disabled by default — for clients that prefer it.</p>
</div>

<hr/>

> [!TIP]

## Authentication

All endpoints (except `/` and `/ready`) require Bearer token authentication.

**Format:**
```
X-Axiom-Key: base64(<key_name>:<secret>)
```

**cURL Example:**
```bash
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

### 4. Metrics (Prometheus)
```bash
curl -X GET "http://localhost:4500/metrics" \
     -H "X-Axiom-Key: <TOKEN>"
```

### 5. OpenAPI JSON Spec
```bash
curl -X GET "http://localhost:4500/api-docs/openapi.json"
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

---

## Storage API <code>/api/v1/fs</code>

### 1. List Storages
```bash
curl -X GET "http://localhost:4500/api/v1/fs/storages" \
     -H "X-Axiom-Key: <TOKEN>"
```
### 2. List Folder
```bash
# Flat listing (default)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/list?path=/subfolder&limit=50" \
     -H "X-Axiom-Key: <TOKEN>"

# Recursive listing (all subdirectories)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/list?path=/&recursive=true&limit=100" \
     -H "X-Axiom-Key: <TOKEN>"

# Pagination next page
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/list?path=/&limit=100&continuation_token=ZmlsZV8xMDAubXA0" \
     -H "X-Axiom-Key: <TOKEN>"
```

**Parameters:**
- `path` - Directory path (default `/`)
- `limit` - Max items per page (default 100, max 1000)
- `continuation_token` - Token returned from a previous response to fetch the next page
- `recursive` - Set to `true` to include all subdirectory contents (depth-first)

### 3. Download / Stream File or Folder

```bash
# Inline view (browser renders it directly)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/image.png&inline=true" \
     -H "X-Axiom-Key: <TOKEN>"

# Resize image — aspect-ratio preserved (contain mode)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/photo.jpg&width=400" \
     -H "X-Axiom-Key: <TOKEN>" -o thumb.jpg

# Exact crop thumbnail (cover mode — crops center)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/photo.jpg&width=300&height=300&fit=cover" \
     -H "X-Axiom-Key: <TOKEN>" -o avatar.jpg

# Convert to WebP with quality control
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/photo.jpg&format=webp&quality=75" \
     -H "X-Axiom-Key: <TOKEN>" -o photo.webp

# Auto-negotiate best format (WebP/AVIF) based on browser Accept header
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/photo.jpg&width=800" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Accept: image/avif,image/webp,image/jpeg"

# Stream video with Range support (browser media players use this automatically)
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/video.mp4" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Range: bytes=0-1048575" -o chunk.mp4

# HEAD pre-flight (Safari/iOS use this before starting Range video streaming)
curl -I "http://localhost:4500/api/v1/fs/local_fs/download?path=/video.mp4" \
     -H "X-Axiom-Key: <TOKEN>"

# Download folder as ZIP archive
curl -X GET "http://localhost:4500/api/v1/fs/local_fs/download?path=/reports_folder" \
     -H "X-Axiom-Key: <TOKEN>" -o reports.zip
```

**Image Transform Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `width` | int | — | Target width in pixels |
| `height` | int | — | Target height in pixels |
| `fit` | string | `contain` | `contain` (aspect-ratio preserve) \| `cover` (crop to fill) \| `fill` (stretch) |
| `format` | string | auto | Force output format: `jpeg`, `webp`, `avif`, `png` |
| `quality` | int (1–100) | `82` | Compression quality for JPEG/WebP/AVIF |
| `inline` | bool | `false` | Set `Content-Disposition: inline` (renders in browser) |

> [!TIP]
> If you send `Accept: image/avif,image/webp` in your request headers and don't force a `?format=`, Axiom automatically picks the **best format your client supports** (AVIF → WebP → original). This is exactly how modern CDNs like Cloudflare Images work.

> [!NOTE]
> **Video Streaming**: All video and audio files are served with full `HTTP Range` support (`206 Partial Content`). Browser `<video>` and `<audio>` tags work out-of-the-box. Safari/iOS pre-flight `HEAD` requests are also fully supported.


### 4. Direct Upload (Small Files)
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "X-Axiom-Key: <TOKEN>" \
     -F "action=direct" \
     -F "path=/uploads/file.txt" \
     -F "file=@/path/to/local/file.txt"
```

### 5. Chunked Upload (Large Files)
```bash
# Step 1: Initiate
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action":"initiate", "filename":"video.mp4", "path":"/uploads/video.mp4", "total_size":104857600, "checksum_sha256":"abc123..."}'
# Note the `upload_id` returned

# Step 2: Upload Chunks
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "X-Axiom-Key: <TOKEN>" \
     -F "action=chunk" \
     -F "upload_id=upl_xxx" \
     -F "chunk_index=0" \
     -F "chunk_hash=sha256_of_chunk" \
     -F "file=@chunk0.bin"

# Step 3: Finalize
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/upload" \
     -H "X-Axiom-Key: <TOKEN>" \
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
     -H "X-Axiom-Key: <TOKEN>" \
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
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "delete", "source": "/unwanted.txt"}'
```

#### Create Directory
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "mkdir", "source": "/new_folder"}'
```

#### File Info
Returns detailed metadata: name, type, size, human-readable size, MIME type, timestamps, and item count for directories.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "info", "source": "/reports/Q1.pdf"}'
```
#### Check Existence
Lightweight boolean check — does not transfer file data.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"action": "exists", "source": "/config/app.yml"}'
```
#### Bulk Delete
Delete multiple files/directories in a single request. Each item reports its own success/failure status.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "action": "bulk_delete",
           "sources": ["/tmp/old1.log", "/tmp/old2.log", "/tmp/cache"]
         }'
```
#### Bulk Move
Move multiple files/directories in a single request. Provide an `operations` array of `{source, target}` pairs.
```bash
curl -X POST "http://localhost:4500/api/v1/fs/local_fs/action" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "action": "bulk_move",
           "operations": [
             {"source": "/inbox/file1.txt", "target": "/archive/file1.txt"},
             {"source": "/inbox/file2.txt", "target": "/archive/file2.txt"}
           ]
         }'
```
---

## Auth API <code>/api/v1/auth/{project_id}</code>

> [!NOTE]
> Enable with `features.auth = true` in `config.toml`. Each API key acts as an **isolated auth project** — users, sessions, tokens, and templates for one key cannot be accessed from another.

**Auth headers**: User-facing auth endpoints are accessed with your API key (`X-Axiom-Key: base64(name:secret)`). After login, protected user endpoints use the returned Ed25519 JWT.

The `{project_id}` is your API key name (as defined in `config.toml` under `[api_key.<name>]`).

---

### JWKS

#### GET `/.well-known/jwks.json`
Returns the Ed25519 public key as a JSON Web Key Set for external JWT verification.
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/.well-known/jwks.json"
```

---

### Signup & Login

#### POST `/signup`
Create a new user with email and password.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/signup" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com", "password": "SecurePassword123"}'
```
#### POST `/login`
Authenticate with email and password.

```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/login" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com", "password":"StrongPassword123!"}'
```

### 5. WebAuthn (Passkeys)

Axiom supports passwordless biometrics via the W3C WebAuthn standard.

#### Register a Passkey
1. Generate options: `POST /api/v1/auth/{project_id}/webauthn/register/options` (Requires JWT)
2. Verify & Save: `POST /api/v1/auth/{project_id}/webauthn/register/verify` (Requires JWT)

#### Login via Passkey
1. Generate options: `POST /api/v1/auth/{project_id}/webauthn/login/options`
2. Verify & Login: `POST /api/v1/auth/{project_id}/webauthn/login/verify` (Returns Access & Refresh tokens)

### 6. Refresh Token
If TOTP is enrolled, the response includes `"totp_required": true` and a one-time `session_token` to be exchanged via `/totp/verify`.

#### POST `/refresh`
Exchange a valid refresh token for a new access token.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/refresh" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"refresh_token": "rt_abc123"}'
```

#### POST `/logout`
Revoke the current session's refresh token.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/logout" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"refresh_token": "rt_abc123"}'
```

---

### Sessions

#### GET `/user/sessions`
List all active sessions for the authenticated user.
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/user/sessions" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>"
```

#### DELETE `/user/sessions/{session_id}`
Revoke a specific session by ID.
```bash
curl -X DELETE "http://localhost:4500/api/v1/auth/my_project/user/sessions/sess_abc123" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>"
```

---

### Anonymous Auth

#### POST `/anonymous`
Create a temporary anonymous session (requires `anonymous_auth = true` in config).
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/anonymous" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>"
```

#### POST `/anonymous/upgrade`
Convert an anonymous account to a permanent account with email and password.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/anonymous/upgrade" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com", "password": "SecurePassword123"}'
```

---

### Email Verification

#### POST `/verify/email`
Request a new verification email to be sent.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/verify/email" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>"
```

#### GET `/verify?token=<TOKEN>`
Verify an email address via a token link (used when `verification_method = "token"`).
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/verify?token=abc123"
```

#### POST `/verify/otp`
Verify an email address using a numeric OTP (used when `verification_method = "otp"`).
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/verify/otp" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"code": "482910"}'
```

#### POST `/otp/send`
Manually trigger a new OTP to be sent to the user's email.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/otp/send" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>"
```

#### POST `/resend`
Re-send the verification email (subject to `resend_cooldown`).
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/resend" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com"}'
```

---

### Magic Link (Passwordless)

#### POST `/magic-link`
Send a magic login link to the user's email.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/magic-link" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com"}'
```

#### POST `/magic-link/verify`
Exchange a magic link token for a full session (access + refresh tokens).
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/magic-link/verify" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"token": "ml_abc123"}'
```

---

### Password Management

#### POST `/password/forgot`
Trigger a password reset email.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/password/forgot" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com"}'
```

#### POST `/password/reset`
Reset password using a token from the reset email.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/password/reset" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"token": "rst_abc123", "new_password": "NewSecurePass456"}'
```

---

### TOTP / 2FA

#### POST `/totp/enroll`
Begin TOTP enrollment. Returns a TOTP secret, QR code SVG, and provisioning URI.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/totp/enroll" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>"
```
#### POST `/totp/confirm`
Confirm TOTP enrollment by providing the first valid code from the Authenticator app. Returns one-time backup codes.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/totp/confirm" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"code": "123456"}'
```

#### POST `/totp/verify`
Provide a TOTP code to complete a login that had `"totp_required": true`.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/totp/verify" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"session_token": "sess_tmp_abc", "code": "123456"}'
```

#### POST `/totp/disable`
Disable TOTP for the authenticated user (requires current password confirmation).
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/totp/disable" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"password": "CurrentPassword123"}'
```

#### POST `/totp/backup/verify`
Use one of the one-time backup codes to authenticate when the Authenticator app is unavailable.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/totp/backup/verify" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"session_token": "sess_tmp_abc", "backup_code": "ABCD-EFGH"}'
```

#### GET `/totp/backup/regenerate`
Regenerate a fresh set of backup codes (invalidates all previous ones).
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/totp/backup/regenerate" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>"
```

---

### User Profile

#### GET `/user`
Get the currently authenticated user's profile.
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/user" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>"
```
#### PATCH `/user`
Update profile metadata (display name, custom fields, etc.).
```bash
curl -X PATCH "http://localhost:4500/api/v1/auth/my_project/user" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"metadata": {"display_name": "Alice"}}'
```

#### DELETE `/user`
Permanently delete the authenticated user's account (requires password confirmation).
```bash
curl -X DELETE "http://localhost:4500/api/v1/auth/my_project/user" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"password": "CurrentPassword123"}'
```

#### POST `/user/email`
Request an email address change. Sends a confirmation link to the new address.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/user/email" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"new_email": "newemail@example.com", "password": "CurrentPassword123"}'
```

#### POST `/user/email/confirm`
Confirm the new email address using the token from the change email link.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/user/email/confirm" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"token": "ec_abc123"}'
```

#### POST `/user/password`
Change the authenticated user's password.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/user/password" \
     -H "X-Axiom-Key: <API_KEY_TOKEN>" \
     -H "X-User-Access-Token: <USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"current_password": "OldPass123", "new_password": "NewPass456"}'
```

---

### Admin Endpoints <code>/api/v1/auth/{project_id}/admin</code>

> [!IMPORTANT]
> All admin endpoints require an API key with `full_admin = true` in `config.toml`.

#### GET `/admin/users`
List all users in the project (cursor paginated).
```bash
# Initial request
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/users?limit=50" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"

# Subsequent pages (use next_cursor from response)
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/users?limit=50&cursor=2026-06-01T12:00:00Z" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### GET `/admin/users/{uid}`
Get a specific user by UID.
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/users/user_uid" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### PATCH `/admin/users/{uid}`
Update a user's properties (disable/enable account, update metadata, set role, etc.).
```bash
curl -X PATCH "http://localhost:4500/api/v1/auth/my_project/admin/users/user_uid" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"disabled": true}'
```

#### DELETE `/admin/users/{uid}`
Permanently delete a user by UID.
```bash
curl -X DELETE "http://localhost:4500/api/v1/auth/my_project/admin/users/user_uid" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### POST `/admin/users/{uid}/sessions/revoke`
Revoke all active sessions for a specific user (force sign-out everywhere).
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/admin/users/user_uid/sessions/revoke" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### GET `/admin/templates`
List all custom email HTML templates stored for this project.
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/templates" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### PUT `/admin/templates/{type_name}`
Create or replace a custom HTML email template. Valid `type_name` values: `email_verify`, `password_reset`, `magic_link`, `email_change`.
```bash
curl -X PUT "http://localhost:4500/api/v1/auth/my_project/admin/templates/magic_link" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"subject": "Your magic link", "html_body": "<p>Click <a href=\"{{.Link}}\">here</a> to login.</p>"}'
```

#### DELETE `/admin/templates/{type_name}`
Delete a custom email template (reverts to built-in default).
```bash
curl -X DELETE "http://localhost:4500/api/v1/auth/my_project/admin/templates/magic_link" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### POST `/admin/users/import`
Bulk import users from a JSON payload. Returns a `job_id` for async status polling.
```bash
curl -X POST "http://localhost:4500/api/v1/auth/my_project/admin/users/import" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"users": [{"email": "user@example.com", "password_hash": "argon2id_hash"}]}'
```

#### GET `/admin/users/import/{job_id}`
Poll the status of a bulk import job.
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/users/import/job_abc123" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### GET `/admin/users/export`
Export all users as JSON.
```bash
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/users/export" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

#### GET `/admin/audit`
Retrieve the audit log for this project (cursor paginated).
```bash
# Initial request
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/audit?limit=100" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"

# Subsequent pages (use next_cursor from response)
curl -X GET "http://localhost:4500/api/v1/auth/my_project/admin/audit?limit=100&cursor=123" \
     -H "X-Axiom-Key: <ADMIN_TOKEN>"
```

---

### Auth Error Codes

| Code | Meaning |
|------|---------|
| `AUTH_USER_EXISTS` | Email already registered |
| `AUTH_USER_NOT_FOUND` | No user found with that email/UID |
| `AUTH_INVALID_CREDENTIALS` | Wrong email or password |
| `AUTH_EMAIL_NOT_VERIFIED` | Login blocked pending email verification |
| `AUTH_TOKEN_EXPIRED` | JWT or magic link / reset token has expired |
| `AUTH_TOKEN_INVALID` | Token is malformed or has been tampered with |
| `AUTH_TOKEN_STOLEN` | Refresh token reuse detected (token rotation violation) |
| `AUTH_ACCOUNT_DISABLED` | Account has been disabled by an admin |
| `AUTH_RATE_LIMITED` | Too many failed attempts — account locked |
| `AUTH_WEAK_PASSWORD` | Password does not meet the project's policy |
| `AUTH_MAGIC_LINK_EXPIRED` | Magic link has expired or already been used |
| `AUTH_PROJECT_NOT_CONFIGURED` | No auth config found for this project key |
| `AUTH_OTP_INVALID` | OTP code is incorrect or expired |

---

## Federation API <code>/api/v1/fed</code>

#### GET `/fed/servers`
```bash
curl -X GET "http://localhost:4500/api/v1/fed/servers" \
     -H "X-Axiom-Key: <TOKEN>"
```

---

## GraphQL API <code>/api/v1/graphql</code>

> [!NOTE]
> GraphQL is an **optional, secondary interface**. Axiom is fundamentally a REST API gateway. Enable it with `features.graphql = true` in `config.toml`. When disabled, the endpoint does not exist and consumes zero resources.

Unlike standard GraphQL servers (Strawberry, Graphene, Ariadne), Axiom's GraphQL layer bypasses Python object graph resolution entirely. Incoming query strings are parsed into an AST by `graphql-core`, walked by the `ASTCompiler`, and dispatched directly into the native `QueryExecutionPipeline` — the exact same security-hardened pipeline used by the REST database endpoints. This means all WAF checks, SQL blacklist rules, API key scoping, and rate limiting apply identically.

**Authentication** is identical to the REST API:
```
X-Axiom-Key: base64(<key_name>:<secret>)
```

### Execute a SQL Query

Use the `execute` root field to run a validated SQL statement against any permitted database alias.

```bash
curl -X POST "http://localhost:4500/api/v1/graphql" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "query": "{ execute(dbAlias: \"main_db\", sql: \"SELECT id, name FROM users WHERE active = 1\", params: {}) }"
         }'
```

### Native Table Queries

You can query tables directly using standard GraphQL syntax without writing raw SQL. The AST compiler automatically transposes this into an ultra-fast `SELECT` statement:

```bash
curl -X POST "http://localhost:4500/api/v1/graphql" \
     -H "X-Axiom-Key: <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
           "query": "{ users(dbAlias: \"main_db\", limit: 10, sort: \"id\", order: \"asc\", cursor: \"1\") { id name email } }"
         }'
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

### Security: Max Query Depth Limiting

To prevent Denial of Service (DoS) attacks via maliciously crafted infinite GraphQL graphs, the AST compiler enforces a strict **Max Query Depth Limit** (default: `15`). Any query that nests deeper than this threshold is instantly rejected before any database connections are made. You can adjust this in the `config/schema.py` (`graphql.max_query_depth`).


### List Available Databases

Use the `databases` root field to return all database aliases the API key has access to.

```bash
curl -X POST "http://localhost:4500/api/v1/graphql" \
     -H "X-Axiom-Key: <TOKEN>" \
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

WebSocket upgrades happen over the same port as the REST API. Axiom supports **Hybrid Authentication**:

1.  **HTTP Headers (Recommended for Backend/Mobile)**: Send `X-Axiom-Key: base64(<name>:<secret>)` during the initial handshake.
2.  **JSON Payload (Required for Browsers)**: Because browser `WebSocket` APIs cannot send custom HTTP headers, you can open the socket without headers and then send a JSON authentication payload as your first message (5-second timeout).

**Axiom strictly prohibits passing authentication tokens via URL parameters (`?token=...`)** to prevent token leakage in server logs. The token is fully shielded by WSS/TLS encryption when sent as a payload.

```javascript
// Token is base64(key_name:secret)
const token = btoa("admin:your_secret_here");

// Step 1: Open the socket (no headers needed for browsers)
const ws = new WebSocket(`ws://localhost:4500/api/v1/ws`);

ws.onopen = () => {
  // Step 2: Send the auth payload within 5 seconds
  ws.send(JSON.stringify({
    type: "auth",
    token: token
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

### Security & Connection Limits

Axiom enforces strict hardware limits to prevent DDoS attacks and memory exhaustion via malicious WebSockets. These limits are configurable in `config/schema.py`:

- **Max Connections (`max_connections`)**: Default `10000`. If the server is full, new connections are instantly rejected with HTTP `1013` (Try Again Later).
- **Max Subscriptions (`max_subscriptions_per_client`)**: Default `100`. Clients exceeding this limit will receive a `{"status": "denied"}` acknowledgment.
- **Auth Timeout (`auth_timeout`)**: Unauthenticated sockets are violently closed after 5 seconds to prevent hanging connection attacks.

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

### Security, Limits & Backpressure

Axiom enforces strict hardware limits to prevent Server-Sent Events from causing memory exhaustion (OOM) or DDoS vulnerabilities. These limits are configurable in `config/schema.py`:

- **Max Connections (`max_connections`)**: Default `5000`. If the server is at absolute capacity, new SSE streams are instantly rejected with HTTP `503` (Server at maximum capacity).
- **Ring-Buffer Backpressure (`queue_size`)**: Default `100`. To prevent a slow client's internet connection from causing an infinite memory leak on the server, Axiom bounds the internal memory queue for each client. If a client falls behind by more than 100 events, the server will silently drop their oldest unread event to make room for the new one.

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

Both endpoints require `X-Axiom-Key: <TOKEN>` using standard Axiom API keys. AI requests are strictly governed by the key's native permissions (`mode`, `db_scope`, `fs_scope`, and rate limits).

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

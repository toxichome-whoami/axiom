# Authentication Subsystem

Axiom includes an ultra-secure, ultra-lightweight embedded authentication engine. Designed to be *"faster than Firebase Auth, lighter than Supabase Auth — you own every byte."*

---

## Core Philosophy

1. **Total Isolation**: Every API key acts as its own autonomous "project." All users, sessions, tokens, and audit logs are stored in an isolated database (by default, automatically generated at `data/auth/<api_key_name>/auth.db`). For horizontal scaling, you can override this with a PostgreSQL `db_url`.
2. **State-of-the-art Crypto**:
   - JWTs are signed using **Ed25519** (EdDSA) — incredibly fast verification and tiny token sizes.
   - Passwords are hashed using **Argon2id** — memory-hard, resistant to GPU/ASIC cracking.
3. **No External Dependencies**: Axiom handles TOTP, QR code generation, magic links, email delivery (SMTP), WebAuthn, and session revocation entirely in-memory and on-disk without external services.

---

## Authentication Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Password** | `POST /signup`, `POST /login` | Traditional email/password with policy enforcement |
| **Magic Links** | `POST /magic-link` | Passwordless login via secure, single-use tokens in email |
| **OTP Login** | `POST /otp/send`, `POST /otp/verify` | Numeric code-based verification |
| **Anonymous** | `POST /anon` | Temporary sessions upgradeable to full accounts |
| **TOTP / 2FA** | `POST /totp/enroll`, `POST /totp/verify` | Authenticator app support with backup codes |
| **Passkeys (WebAuthn)** | `POST /webauthn/register`, `POST /webauthn/login` | Biometric, passwordless login (FaceID/TouchID) |

---

## Sessions & Tokens

- **Ed25519 JWTs**: Access tokens are stateless and verify offline instantly. Claims include `sub`, `email`, `email_verified`, `is_anonymous`, `totp_verified`, and any custom claims.
- **Refresh Token Rotation**: Every refresh issues a brand-new token and **immediately revokes the old one**. If a stolen token is used, the entire token family is revoked — token theft is instantly detected.
- **Device & IP Tracking**: Sessions record the originating IP and User Agent. New IP logins trigger a security alert email if `new_device_alerts = true`.

---

## Security Features

### Brute Force Protection
The `BruteForceProtector` is an isolated, in-memory fixed-window TTL counter.

- Protects: `/login`, `/otp/send`, `/password/forgot`
- Config: `max_login_attempts` (default `5`), `lockout_duration` (default `900s`)
- After N failed attempts from an IP, the IP is mathematically locked out for the cooldown period.

### New Device Alerts
When `new_device_alerts = true`, every successful login checks if the IP has ever been seen for that user. If not, a `new_device_login` security email is dispatched in real-time — before the token is even returned.

### Role-Based Access Control (RBAC)
Add `"role"` to `jwt_custom_claims` in `config.toml`. The system reads the user's `role` field from their metadata and embeds it directly into the signed JWT — allowing **sub-millisecond, database-free** permission checks via the `RequireRole` FastAPI dependency.

```toml
[auth.project.myapp]
jwt_custom_claims = ["role", "tenant_id"]
```

Then in your Axum router:
```rust
use crate::middleware::RequireRole;

let app = Router::new()
    .route("/admin", get(admin_panel))
    .route_layer(middleware::from_fn(RequireRole::new(vec!["admin", "superadmin"])));
```

### Passkeys (WebAuthn)
Axiom natively supports **FIDO2/WebAuthn**. Users can register device biometrics (FaceID, TouchID, hardware keys) and authenticate without a password. Challenges are generated and verified entirely server-side — phishing and credential stuffing are mathematically impossible.

Configure with:
```toml
[auth.project.myapp]
webauthn_enabled = true
rp_id = "example.com"        # Must match your domain
rp_name = "My App"
origin = "https://example.com"
```

---

## Email & Templates

- Axiom natively connects to any SMTP server via `[auth.project.<name>.email]`.
- **Custom Templates**: Inject your own HTML into `auth.db` for flows like `password_reset`, `email_verify`, `magic_link`, `new_device_login`.
- Safe placeholder injection: `{{.Link}}`, `{{.UserEmail}}`, `{{.Code}}`, `{{.IpAddress}}`, `{{.Time}}`.

---

## Database Scaling

By default, each auth project uses a strictly isolated, automatically generated SQLite database (`data/auth/<project_id>/auth.db`). You do not need to configure a `db_url` for this.

For **horizontal scaling across multiple servers**, you can override the default SQLite behavior by explicitly providing a PostgreSQL `db_url` in your configuration:

```toml
[auth.project.myapp]
# Use sqlx for native async PostgreSQL connections
db_url = "postgres://user:password@db-host:5432/myapp_auth"
```

This uses `sqlx` under the hood — the premier async database driver for Rust.

---

## Webhook Integration

Auth flows are natively hooked into the EDA/Webhook system. Configure webhooks for:

| Event | Config Key |
|-------|-----------|
| New signup | `webhook_on_signup = true` |
| Successful login | `webhook_on_login = true` |
| Logout | `webhook_on_logout = true` |
| Password reset | `webhook_on_password_reset = true` |
| Email change | `webhook_on_email_change = true` |
| Account deletion | `webhook_on_delete = true` |

---

## Configuration Reference

See [`CONFIGURATION.md → [auth.project.<name>]`](../system/CONFIGURATION.md) for the full schema breakdown including all token TTLs, password policies, resend throttling, and SMTP settings.

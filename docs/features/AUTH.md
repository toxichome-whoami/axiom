# Authentication Subsystem

Axiom includes an ultra-secure, ultra-lightweight embedded authentication engine. It is designed to be "faster than Firebase Auth, lighter than Supabase Auth, and perfectly isolated."

## Core Philosophy
1. **Total Isolation**: Every API key acts as its own autonomous "project." All users, sessions, templates, and audit logs for an API key are stored in an isolated SQLite database at `data/auth/<api_key_hash>/auth.db`.
2. **State-of-the-art Crypto**: 
   - JWTs are signed using **Ed25519** (EdDSA) for incredibly fast verification and small token sizes.
   - Passwords are automatically hashed using **Argon2id**.
3. **No External Dependencies**: Axiom handles TOTP, QR code generation, magic links, email delivery (via SMTP), and session revocation entirely in-memory and on-disk without needing external Redis or managed services.

## Features

### Authentication Methods
- **Password**: Traditional email/password with strict verification.
- **Magic Links**: Passwordless login via secure, single-use tokens sent over email.
- **Anonymous**: Temporary anonymous sessions that can be later upgraded to permanent accounts.
- **Multi-Factor (TOTP)**: Standard Authenticator app support (Google Authenticator, Authy). Includes backup codes and enforces 2FA on sessions if enrolled.

### Sessions & Tokens
- **Ed25519 JWTs**: Access tokens are stateless and verify offline rapidly. They include audience claims matching your API key project.
- **Refresh Tokens**: Opaque tokens stored in the database for rolling sessions and immediate revocation.
- **Device & IP Tracking**: Sessions track the originating IP and User Agent, allowing users and admins to revoke compromised devices.

### Email & Customization
- Axiom natively connects to any SMTP server.
- **Custom Templates**: You can inject your own HTML templates directly into the project's `auth.db` for flows like `password_reset`, `email_verify`, and `magic_link`.
- Templates support safe placeholder injection (e.g., `{{.Link}}`, `{{.UserEmail}}`).

### Rate Limiting & Protection
- Local, high-performance rate limiter caching invalid login attempts.
- Configurable lockouts after sequential failures.
- Captures and records failed login IP addresses into the audit logs.

### Webhook Integration
Auth flows are natively hooked into the EDA/Webhook system. You can configure webhooks to automatically dispatch payloads when events occur:
- `signup`
- `login`
- `logout`
- `password_reset`
- `email_change`
- `delete`

## Configuration
Auth behavior is defined under the `auth.project.<api_key>` section in your `axiom.json` file. You can customize:
- Token TTLs (Access, Refresh, Magic Link)
- Password Policies (Length, Uppercase, Numbers)
- Resend Cooldowns
- SMTP Transport Settings

See the [Configuration Guide](../system/CONFIGURATION.md) for a full schema breakdown.

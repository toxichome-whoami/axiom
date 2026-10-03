# Getting Started

---

## Prerequisites

- Rust 1.88+ (`rustup update stable`)
- A reachable SQL database (or use SQLite for local testing)
- No other runtime dependencies

---

## 1. Build

```bash
git clone https://github.com/toxichome-whoami/axiom.git
cd axiom
cargo build --release
```

The binary is at `target/release/axiom` (Linux/macOS) or `target\release\axiom.exe` (Windows).

The build script compiles the Web UI if `npm` is available and `ui/` sources have changed. If `npm` is not installed, the build falls back to the existing `ui/dist` bundle.

---

## 2. Configure

```bash
cp config.example.toml config.toml
```

Minimum required change — add a database connection:

```toml
# config.toml — minimum for a working server
[database.main_db]
url = "postgres://user:pass@localhost:5432/mydb"

[api_key.mykey]
secret = "pick-a-strong-secret"
full_admin = true
```

These legacy blocks are seeded into `axiom.db` on first boot. After that, manage keys and databases via the Web UI or Admin API.

For SQLite (no external DB needed):

```toml
[database.local]
url = "sqlite://data/local.db"

[api_key.testkey]
secret = "test-secret"
full_admin = true
```

---

## 3. Run

```bash
./target/release/axiom server run
```

Default bind: `http://127.0.0.1:4500`. Change in `[server] host` and `port`.

On first start, `data/axiom.db` is created and seeded from any `[database.*]` and `[api_key.*]` blocks in `config.toml`.

---

## 4. Verify

```bash
curl http://localhost:4500/ready
# {"ready":true}

# Encode credentials: base64(keyname:secret)
KEY=$(echo -n "mykey:pick-a-strong-secret" | base64)

curl http://localhost:4500/api/v1/db/databases \
  -H "X-Axiom-Key: $KEY"
```

---

## 5. Web UI (optional)

Open `http://localhost:4500/system/` in a browser. On first boot the setup wizard runs at `/system/#/setup`. Create an admin user and connect a database through the UI.

---

## Production Build Flags

The release profile already sets optimal flags (`opt-level=3`, `lto=true`, `codegen-units=1`, `panic=abort`, `strip=true`). No additional flags needed.

```bash
cargo build --release
ls -lh target/release/axiom
```

---

## Reverse Proxy

Axiom listens on plain HTTP. Put it behind a reverse proxy for HTTPS:

**Caddy:**
```caddyfile
api.example.com {
    reverse_proxy 127.0.0.1:4500
}
```

**Nginx:**
```nginx
server {
    listen 443 ssl;
    server_name api.example.com;
    location / {
        proxy_pass http://127.0.0.1:4500;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Set `server.trusted_proxies = ["127.0.0.1"]` (already the default) so `X-Forwarded-For` is trusted from the proxy.

---

## Systemd (Linux)

```ini
[Unit]
Description=Axiom API Gateway
After=network.target

[Service]
Type=simple
User=axiom
WorkingDirectory=/opt/axiom
ExecStart=/opt/axiom/axiom server run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable axiom
sudo systemctl start axiom
```

---

## Multi-node

Point all nodes at the same remote metadata store:

```toml
[metadata]
url   = "libsql://your-db.turso.io"
token = "your-turso-token"
```

All nodes share the same keys, roles, and database config. The rate-limit backend should also be set to `"turso"` with a shared URL so IP counters are global.

---

## Diagnostics

```bash
axiom doctor          # environment and DB reachability checks
axiom health          # server health from running instance
axiom db test main_db # test a specific registered database
```

Structured JSON logs go to `./logs/axiom.*.log` and stdout. Set `RUST_LOG=debug` to increase verbosity without restarting.

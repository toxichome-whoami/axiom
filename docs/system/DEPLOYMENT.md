<div align="center">
  <h1>Axiom Deployment Guide</h1>
  <p><em>Instructions for standing up Axiom locally and in production</em></p>
</div>

<hr/>

## Requirements

- Rust 1.75+ (Cargo)
- MSYS2 UCRT64 toolchain (if compiling on Windows)
- Optional: Redis (for distributed rate limiting and caching)
- Optional: Docker + Docker Compose

---

## Quick Start (Local)

<details open>
<summary><b>View Shell Commands</b></summary>

```bash
# 1. Clone the repo
git clone https://github.com/yourorg/axiom
cd axiom

# 2. Configure
cp config.example.toml config.toml
# Edit config.toml — update secrets, database URLs, storage paths
# Then generate the .env file for Docker:
cd scripts && go run toml2env.go && cd ..

# 3. Build & Run
cargo build --release
./target/release/axiom
# Server starts at http://127.0.0.1:4500
# Admin API key will be printed to stdout on first run
```

</details>

---

## Docker (Recommended)

<details open>
<summary><b>Docker Build & Run</b></summary>

```bash
# Build the image (multi-stage: compiles Rust, then copies binary into slim runtime)
docker build -t axiom:latest .

# Run with a local config
docker run -d \
  -p 4500:4500 \
  -e RUST_LOG=info \
  --env-file .env \
  -v $(pwd)/logs:/app/logs \
  axiom:latest
```

> [!NOTE]
> The Dockerfile uses a **multi-stage build**: Stage 1 compiles the full release binary using `rust:1.78-slim`. Stage 2 copies only the binary into a minimal `debian:bookworm-slim` image with no Rust toolchain, no source code, and no build tools. The resulting image is tiny and has a minimal attack surface.

</details>

### Docker Compose (with Redis)

```bash
cp config.example.toml config.toml
# Set cache.backend = "redis" and cache.redis_url = "redis://redis:6379/0" in config.toml

# Development (single instance + Redis)
docker compose up -d

# Production (3 replicas + Redis + NGINX load balancer)
docker compose -f docker-compose.prod.yml up -d
```

> [!TIP]
> In production compose, the `RUST_LOG` environment variable controls log verbosity. Set it to `warn` or `error` to reduce log noise. The Tokio runtime automatically uses all available CPU cores — no worker count config needed.

---

## Production Checklist

- [ ] Replace all `CHANGE_ME` secrets in `config.toml` with cryptographically random values (>= 64 chars)
- [ ] Set `server.cors_origins` to your actual frontend domain(s)
- [ ] Enable TLS by setting `tls_cert` and `tls_key` (or terminate TLS at your reverse proxy)
- [ ] Set `features.playground = false` to disable Swagger UI
- [ ] Configure `rate_limit.max_requests` appropriate for your expected traffic
- [ ] Set `cache.backend = "redis"` and `rate_limit.backend = "redis"` for multi-replica deployments
- [ ] Set `RUST_LOG=warn` in production to reduce log volume
- [ ] Review `database.<alias>.dangerous_operations = false` (default) to prevent DDL

---

## Nginx Reverse Proxy

<details>
<summary><b>View Nginx Config</b></summary>

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /etc/ssl/certs/api.crt;
    ssl_certificate_key /etc/ssl/private/api.key;

    # Increase buffer for large file uploads
    client_max_body_size 500m;

    # HTTP / REST API
    location / {
        proxy_pass http://127.0.0.1:4500;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # For SSE and streaming downloads
        proxy_buffering off;
        proxy_cache off;
    }
}

# Pull latest
git pull origin main

# Build
cargo build --release

# Restart
sudo systemctl restart axiom
```

> **Note:** Check the CHANGELOG for breaking config changes before upgrading.

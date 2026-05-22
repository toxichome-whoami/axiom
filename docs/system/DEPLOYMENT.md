<div align="center">
  <h1>Axiom Deployment Guide</h1>
  <p><em>Instructions for standing up Axiom locally and in production</em></p>
</div>

<hr/>

## Requirements

- Python 3.11+
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

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure
cp config.example.toml config.toml
# Edit config.toml — update secrets, database URLs, storage paths

# 4. Run
python src/main.py
# Server starts at http://0.0.0.0:4500
# Admin API key will be printed to stdout on first run
```

</details>

---

## Docker (Recommended)

<details open>
<summary><b>Docker Build & Run</b></summary>

```bash
# Build the image
docker build -t axiom:latest .

# Run with a local config
docker run -d \
  -p 4500:4500 \
  -v $(pwd)/config.toml:/config.toml \
  -v $(pwd)/storage:/storage \
  -v $(pwd)/logs:/logs \
  -v $(pwd)/data:/data \
  axiom:latest
```

</details>

### Docker Compose (with Redis)

```bash
cp config.example.toml config.toml
# Set cache.backend = "redis" and cache.redis_url = "redis://redis:6379/0" in config.toml

docker compose up -d
```

---

## Production Checklist

- [ ] Replace all `CHANGE_ME` secrets in `config.toml` with cryptographically random values (>= 64 chars)
- [ ] Set `server.cors_origins` to your actual frontend domain(s)
- [ ] Enable TLS by setting `tls_cert` and `tls_key` (or terminate TLS at your reverse proxy)
- [ ] Set `features.playground = false` to disable Swagger UI
- [ ] Configure `rate_limit.max_requests` appropriate for your expected traffic
- [ ] Set `cache.backend = "redis"` and `rate_limit.backend = "redis"` for multi-worker deployments
- [ ] Ensure the `/data` directory is mounted to a persistent volume, as it stores dynamic API keys and security state in SQLite
- [ ] Configure `logging.level = "WARN"` or `"ERROR"` for production
- [ ] Set `storage.<alias>.blocked_extensions` to block potentially dangerous uploads
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

    location / {
        proxy_pass http://127.0.0.1:4500;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # For streaming downloads
        proxy_buffering off;
        proxy_cache off;
    }
}
```

</details>

---

## Systemd Service

<details>
<summary><b>View Systemd Unit File</b></summary>

```ini
[Unit]
Description=Axiom API Gateway
After=network.target

[Service]
Type=simple
User=axiom
WorkingDirectory=/opt/axiom
ExecStart=/opt/axiom/.venv/bin/python src/main.py --config /etc/axiom/config.toml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable axiom
sudo systemctl start axiom
```

</details>

---

## Monitoring

Axiom exposes OpenMetrics at `/metrics` (requires `features.metrics = true`).

**Prometheus scrape config:**
```yaml
scrape_configs:
  - job_name: axiom
    static_configs:
      - targets: ["localhost:4500"]
    metrics_path: /metrics
    bearer_token: "<base64(admin:secret)>"
```

**Key metrics to alert on:**
- <code>axiom_memory_mb</code> > 450 MB (approaching limit)
- <code>axiom_db_query_errors_total</code> increasing rate
- <code>axiom_rate_limit_hits_total</code> spike (potential attack)
- <code>axiom_webhook_failed_total</code> increasing (delivery issues)

---

## Upgrading

```bash
# Pull latest
git pull origin main

# Update deps
pip install -r requirements.txt

# Restart
sudo systemctl restart axiom
```

> **Note:** Check the CHANGELOG for breaking config changes before upgrading.

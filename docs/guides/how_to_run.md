# Axiom — Build & Run

---

## 1. Build Linux Binary (Windows)

### One-time setup

```powershell
# Install Zig from ziglang.org/download, extract to C:\zig, add to PATH
cargo install cargo-zigbuild
rustup target add x86_64-unknown-linux-gnu
```

### Build

```powershell
# Linux (for cPanel server)
.\build.ps1 -Linux -Release

# Windows (for local testing)
.\build.ps1 -Release
```

Output:
- Linux: `target\x86_64-unknown-linux-gnu\release\axiom`
- Windows: `target\release\axiom.exe`

---

## 2. Server Setup (cPanel)

### Upload

Upload to your server folder (e.g. `/home/youruser/axiom/`):

| File | Purpose |
|------|---------|
| `axiom` | compiled Linux binary |
| `.htaccess` | Apache proxy config (place in public_html) |
| `axiom.sh` | manager script |
| `config.toml` | server config |

### Start

```bash
cd /home/youruser/axiom
chmod +x axiom axiom.sh
./axiom.sh start
```

### Check

```bash
./axiom.sh status
```

---

## 3. Commands

```bash
./axiom.sh start       # Start the server
./axiom.sh stop        # Stop gracefully
./axiom.sh status      # Show PID, port, version, uptime
./axiom.sh logs        # Tail live log
```

---

## 4. Auto-Restart (cPanel Cron)

1. cPanel -> Cron Jobs -> Add New Cron Job
2. Every minute: `* * * * *`
3. Command:

```bash
pgrep -x axiom || (cd /home/youruser/axiom && ./axiom.sh start)
```

---

## 5. Ports

- HTTP: `:4500`
- gRPC: `:4501`
- Apache proxies from 80/443 via `.htaccess`

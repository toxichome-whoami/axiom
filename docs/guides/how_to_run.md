# Axiom — Build, Deploy & Update
*(Shared cPanel Hosting — No Root, No SSH Required)*

---

## 1. Local Development (Windows)

```powershell
# Quick check
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH; cargo check

# Dev build
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH; cargo build
.\target\debug\axiom.exe

# Stop local server
Get-Process axiom -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 2. Compile Linux Binary (One-Time Setup)

```powershell
# Step 1: Install Zig (cross-linker) from ziglang.org/download
# Step 2:
cargo install cargo-zigbuild

# Step 3:
rustup target add x86_64-unknown-linux-gnu
```

### Build for production
```powershell
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH
cargo zigbuild --target x86_64-unknown-linux-gnu.2.17 --release
```

**Output:** `target\x86_64-unknown-linux-gnu\release\axiom`

---

## 3. First-Time Server Setup (cPanel)

### 3a. Upload via File Manager

Upload these to a folder (e.g. `/home/youruser/axiom/`):

| File | Location |
|------|----------|
| `axiom` | compiled Linux binary |
| `.htaccess` | root or subfolder where Apache should proxy |
| `axiom.sh` | alongside the binary |
| `config.toml` | alongside the binary |

### 3b. Install .htaccess

Place the `.htaccess` file in the **public_html** folder (or the folder Apache serves from). This proxies all traffic to your Axiom server running on port 4500.

### 3c. Start the server

Open cPanel **Terminal** and run:

```bash
cd /home/youruser/axiom
chmod +x axiom axiom.sh
./axiom.sh start
```

Check it's running:

```bash
./axiom.sh status
```

---

## 4. Updating to a New Version (No Downtime)

The update uses **port swapping** — old and new run simultaneously for a moment, then `.htaccess` switches over. Users see zero interruption.

### Step 1: Build the Linux binary

```powershell
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH
cargo zigbuild --target x86_64-unknown-linux-gnu.2.17 --release
```

### Step 2: Rename the binary with a version tag

```powershell
copy target\x86_64-unknown-linux-gnu\release\axiom axiom-v<version>
```

### Step 3: Upload via cPanel File Manager

Upload `axiom-v<version>` to `/home/youruser/axiom/` (alongside the existing `axiom` binary).

### Step 4: Run the update (cPanel Terminal)

```bash
cd /home/youruser/axiom
./axiom.sh update v<version>
```

The script does this automatically:

```
1. Starts new binary on standby port (4501)
2. Waits for health check to pass
3. Backs up current binary → axiom.bak.{timestamp}
4. Updates .htaccess to proxy to standby port
5. Stops old binary on active port (4500)
6. Confirms new binary is healthy
```

**That's it.** Your site never goes down — Apache keeps proxying during the swap.

---

## 5. All Commands

```bash
./axiom.sh start              # Start the server
./axiom.sh stop               # Stop gracefully (drains connections)
./axiom.sh status             # Show PID, port, version, uptime
./axiom.sh update v<version>   # Deploy new version (zero-downtime)
./axiom.sh rollback           # Revert to previous backup
./axiom.sh logs               # Tail live log file
```

---

## 6. How Zero-Downtime Works

```
Normal:  Apache → :4500 (current version)
Update:  Apache → :4500 (current) + :4501 (new version starting)
         Apache → :4501 (new version) ← .htaccess swapped
         Apache → :4501 (new version) + old stopped
Next:    Apache → :4501 (swap back to :4500 on next update)
```

The `.htaccess` proxy is updated atomically (Apache re-reads it on next request), so there's no window where traffic gets dropped. The old process keeps running until the new one passes health checks.

---

## 7. Rollback

```bash
./axiom.sh rollback
```

Restores the most recent backup (`axiom.bak.{timestamp}`) and restarts it. The `.htaccess` proxy stays on whatever port it was already pointing to.

---

## 8. Auto-Restart if Axiom Crashes (cPanel Cron)

1. **cPanel → Cron Jobs → Add New Cron Job**
2. **Every Minute:** `* * * * *`
3. **Command:**

```bash
pgrep -x axiom || (cd /home/youruser/axiom && ./axiom.sh start)
```

---

## 9. Quick Reference

| Task | Command |
|------|---------|
| Check status, version, available updates & backups | `./axiom.sh status` |
| View live logs | `./axiom.sh logs` |
| Stop server | `./axiom.sh stop` |
| Deploy new version | `./axiom.sh update v<version>` |
| Rollback | `./axiom.sh rollback` |

**Ports:** HTTP on `:4500`, gRPC on `:4501`. Apache proxies from 80/443 via `.htaccess`.

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

### Build for production (creates versioned binary automatically)

```powershell
# Native Windows release
.\build.ps1 -Release

# Cross-compile for Linux (cPanel)
.\build.ps1 -Linux -Release
```

**Output:** `target\x86_64-unknown-linux-gnu\release\axiom-v<version>` (versioned — won't overwrite on upload)

---

## 3. First-Time Server Setup (cPanel)

### 3a. Upload via File Manager

Upload these to a folder (e.g. `/home/youruser/axiom/`):

| File | Location |
|------|----------|
| `axiom-v<version>` | compiled Linux binary (versioned — won't overwrite) |
| `.htaccess` | root or subfolder where Apache should proxy |
| `axiom.sh` | alongside the binary |
| `config.toml` | alongside the binary |

### 3b. Install .htaccess

Place the `.htaccess` file in the **public_html** folder (or the folder Apache serves from). This proxies all traffic to your Axiom server running on port 4500.

### 3c. Start the server (first time)

Open cPanel **Terminal** and run:

```bash
cd /home/youruser/axiom
chmod +x axiom-v<version> axiom.sh
./axiom.sh start
```

If only one versioned binary exists, it auto-promotes without asking:

```
  Promoted: axiom-v<version> -> axiom
  Starting axiom on port 4500...
  Running (PID: 12345, Port: 4500)
```

If multiple exist, use arrow keys to pick, Enter to confirm:

```
  No axiom binary found - select one to promote:

  > axiom-v1.0.7-beta  (26M)     <-- highlighted with arrows
    axiom-v1.0.6       (24M)

  Use arrow keys to select, Enter to confirm, Ctrl+C to cancel
```

After this, `./axiom` exists, so future `./axiom.sh start` calls skip the prompt entirely.

Check it's running:

```bash
./axiom.sh status
```

---

## 4. Updating to a New Version (No Downtime)

The update uses **port swapping** — old and new run simultaneously for a moment, then `.htaccess` switches over. Users see zero interruption.

### Step 1: Build the Linux binary

```powershell
.\build.ps1 -Linux -Release
```

Output is `target\x86_64-unknown-linux-gnu\release\axiom-v<version>` — versioned, no rename needed.

### Step 2: Upload via cPanel File Manager

Upload the versioned binary from `target\x86_64-unknown-linux-gnu\release\` to your `/home/youruser/axiom/` folder. Won't overwrite existing files — each version has a unique name.

### Step 3: Run the update (cPanel Terminal)

```bash
cd /home/youruser/axiom
./axiom.sh update
```

Use arrow keys to pick the version, Enter to deploy, Ctrl+C to cancel:

```
  Select version to deploy:

  > axiom-v1.0.7-beta  (26M)     <-- highlighted, arrows move it
    axiom-v1.0.6       (24M)

  Use arrow keys to select, Enter to confirm, Ctrl+C to cancel
```

The script does this automatically:

```
1. Starts new binary on standby port (4501)
2. Waits for health check to pass
3. Backs up current binary → backups/axiom-pre-{version}-{timestamp}
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
./axiom.sh status             # Show PID, port, version, available updates & backups
./axiom.sh update             # Arrow keys to pick version, Enter to deploy
./axiom.sh rollback           # Arrow keys to pick backup, Enter to restore
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

Use arrow keys to pick the backup, Enter to restore, Ctrl+C to cancel:

```
  Select backup to restore:

  > axiom-pre-v1.0.7-beta-20260620_120000  (12.1 MB)   <-- highlighted
    axiom-pre-v1.0.6-20260619_150000       (12.0 MB)

  Use arrow keys to select, Enter to confirm, Ctrl+C to cancel
```

Restores the selected backup from the `backups/` folder and restarts. The `.htaccess` proxy stays on whatever port it was already pointing to.

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
| Deploy new version | `./axiom.sh update` (picks interactively) |
| Rollback | `./axiom.sh rollback` |

**Ports:** HTTP on `:4500`, gRPC on `:4501`. Apache proxies from 80/443 via `.htaccess`.

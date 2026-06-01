# Axiom — Build & Deploy Reference
*(Shared cPanel Hosting — No Root Required)*

---

## 1. Local Development (Windows / PowerShell)

### Quick Check
*(Validates code, no binary produced)*
```powershell
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH; cargo check
```

### Dev Build
*(Fast, unoptimized, for testing)*
```powershell
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH; cargo build
.\target\debug\axiom.exe
```

### Production Build for Windows
```powershell
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH; cargo build --release
.\target\release\axiom.exe
```

### Stop Server (Windows)
```powershell
Get-Process axiom -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 2. Build Linux Binary on Windows (One-Time Setup)

**Step 1 — Install Zig** (Cross-linker, no Docker needed)
- Download: [ziglang.org/download](https://ziglang.org/download/)
- Extract to `C:\zig` and add `C:\zig` to your Windows PATH.

**Step 2 — Install cargo-zigbuild**
```powershell
cargo install cargo-zigbuild
```

**Step 3 — Add Linux target to Rust**
```powershell
rustup target add x86_64-unknown-linux-gnu
```

---

## 3. Build & Deploy to cPanel (Run this every update)

### Step 1: Build static Linux binary on your PC
```powershell
$env:PATH = "D:\msys64_install\ucrt64\bin;" + $env:PATH; cargo zigbuild --target x86_64-unknown-linux-gnu.2.17 --release
```

**Binary output:** `target\x86_64-unknown-linux-gnu\release\axiom`
- ✔️ Fully static — no shared libs needed on the server
- ✔️ Works on CentOS 7, AlmaLinux, Ubuntu (any legacy cPanel host via glibc 2.17)
- ✔️ No install, no root, just upload and run

### Step 2: Upload to cPanel

**Via cPanel File Manager:**
1. Login to cPanel → File Manager
2. Go to your folder e.g., `/home/yourusername/axiom/`
3. Upload the file: `target\x86_64-unknown-linux-gnu\release\axiom`
4. Upload `config.toml` if it changed too.

**Via SCP (if SSH enabled on your host):**
```bash
scp target\x86_64-unknown-linux-gnu\release\axiom user@yourserver.com:/home/user/axiom/axiom
```

### Step 3: SSH into your cPanel terminal and restart

```bash
# First time only — make it executable
chmod +x ~/axiom/axiom

# Stop old version (use whichever works on your host)
kill $(pgrep axiom)
# OR if pgrep is not available:
ps aux | grep axiom          # find the PID from output
kill <PID>

# Start new version — stays alive after terminal close
cd ~/axiom
nohup ./axiom > axiom.log 2>&1 &
echo "Running. PID: $!"
```

---

## 4. Useful Terminal Commands (No root needed)

**Is Axiom running?**
```bash
ps aux | grep axiom | grep -v grep
```

**View live logs**
```bash
tail -f ~/axiom/axiom.log
```

**View last 50 log lines**
```bash
tail -n 50 ~/axiom/axiom.log
```

**Stop Axiom**
```bash
kill $(pgrep axiom)
```

---

## 5. Auto-Restart if Axiom Crashes (cPanel Cron Job)

*No root needed — uses cPanel's built-in cron system.*

1. Go to: **cPanel → Cron Jobs → Add New Cron Job**
2. **Frequency:** Every Minute (`* * * * *`)
3. **Command:** *(replace `yourusername` with your actual cPanel username)*

```bash
pgrep -x axiom || (cd /home/yourusername/axiom && nohup ./axiom >> axiom.log 2>&1 &)
```
*This checks every minute if Axiom is alive. If it crashed, it restarts it automatically.*

---

## 6. Ports

- **HTTP / REST API:** `:4500`
- **gRPC (Tonic):** `:4501`

> [!NOTE]
> Shared cPanel hosts usually block custom ports. Ask your host to open port `4500`, or set up an Apache proxy in your `.htaccess` to forward requests from port `80` to `4500`.

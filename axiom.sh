#!/usr/bin/env bash
set -euo pipefail

# ═════════════════════════════════════════════════════════════════════════════
# Axiom Manager — start, stop, update, rollback
# Usage:  ./axiom.sh <command> [version]
#
# Commands:
#   start                  Start the current binary
#   stop                   Stop the running instance
#   status                 Show running version and port
#   update  <version>      Deploy a new version (zero-downtime via port swap)
#   rollback               Revert to the previous backup
#   logs                   Tail the log file
#
# Zero-downtime update flow:
#   1. Upload new binary to the same folder (e.g. axiom-v<version>)
#   2. Run:  ./axiom.sh update v<version>
#   3. Script starts new instance on standby port, swaps .htaccess, kills old
# ═════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }
info() { echo -e "${CYAN}  →${NC} $*"; }

# ── Config ──────────────────────────────────────────────────────────────────
NAME="axiom"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${DIR}/${NAME}.log"
PID_FILE="${DIR}/${NAME}.pid"
PORT_FILE="${DIR}/${NAME}.port"
HTACCESS="${DIR}/.htaccess"

# Two ports for zero-downtime swapping
PORT_A=4500
PORT_B=4501

# ── Help ─────────────────────────────────────────────────────────────────────
if [ $# -lt 1 ]; then
    echo "Usage: $0 <command> [version]"
    echo ""
    echo "Commands:"
    echo "  start                  Start the current binary"
    echo "  stop                   Stop the running instance"
    echo "  status                 Show running version, port, health"
    echo "  update  <version>      Deploy a new version (zero-downtime)"
    echo "  rollback               Revert to the previous backup"
    echo "  logs                   Tail the log file"
    exit 0
fi

CMD="$1"
VERSION="${2:-}"

# ── Detect functions ─────────────────────────────────────────────────────────

get_active_port() {
    if [ -f "$PORT_FILE" ]; then
        cat "$PORT_FILE"
    else
        echo "$PORT_A"
    fi
}

get_standby_port() {
    local active
    active=$(get_active_port)
    if [ "$active" = "$PORT_A" ]; then echo "$PORT_B"; else echo "$PORT_A"; fi
}

get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    fi
}

is_running() {
    local pid
    pid=$(get_pid)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

health_check() {
    local port="${1:-$(get_active_port)}"
    curl -sf "http://127.0.0.1:${port}/api/v1/health" > /dev/null 2>&1
}

wait_for_health() {
    local port="$1"
    local label="$2"
    for i in $(seq 1 15); do
        if health_check "$port"; then
            ok "${label} health check passed (attempt $i)"
            return 0
        fi
        sleep 1
    done
    fail "${label} health check failed after 15 seconds"
}

# ── Commands ─────────────────────────────────────────────────────────────────

case "$CMD" in

# ── start ────────────────────────────────────────────────────────────────────
start)
    if is_running; then
        warn "Already running (PID: $(get_pid))"
        exit 0
    fi

    if [ ! -f "${DIR}/${NAME}" ]; then
        fail "Binary not found: ${DIR}/${NAME}"
    fi

    chmod +x "${DIR}/${NAME}"
    local port
    port=$(get_active_port)

    info "Starting ${NAME} on port ${port}..."
    cd "$DIR"
    nohup "./${NAME}" >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"
    echo "$port" > "$PORT_FILE"

    wait_for_health "$port" "Start"
    ok "Running (PID: $pid, Port: $port)"
    ;;

# ── stop ─────────────────────────────────────────────────────────────────────
stop)
    local pid
    pid=$(get_pid)
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        warn "Not running"
        exit 0
    fi

    info "Stopping (PID: $pid)..."
    kill "$pid" 2>/dev/null || true

    local waited=0
    while kill -0 "$pid" 2>/dev/null; do
        sleep 1
        waited=$((waited + 1))
        if [ $waited -ge 35 ]; then
            warn "Force stopping..."
            kill -9 "$pid" 2>/dev/null || true
            break
        fi
    done

    rm -f "$PID_FILE"
    ok "Stopped (${waited}s)"
    ;;

# ── status ───────────────────────────────────────────────────────────────────
status)
    local pid port
    pid=$(get_pid)
    port=$(get_active_port)

    if is_running; then
        echo -e "${GREEN}●${NC} ${NAME} is running"
        echo "   PID:      $pid"
        echo "   Port:     $port"

        # Try to get version from health endpoint
        local health
        health=$(curl -sf "http://127.0.0.1:${port}/api/v1/health" 2>/dev/null || true)
        if [ -n "$health" ]; then
            local ver
            ver=$(echo "$health" | grep -o '"version":"[^"]*"' | head -1 | sed 's/"version":"//;s/"//')
            [ -n "$ver" ] && echo "   Version:  $ver"
        fi

        echo "   Process:  $(ps -p "$pid" -o etimes= 2>/dev/null || echo "?")s uptime"
    else
        echo -e "${RED}✘${NC} ${NAME} is not running"
    fi

    # List available versioned binaries and backups
    echo ""
    local bins
    bins=$(ls -1 "${DIR}/${NAME}-v"* 2>/dev/null || true)
    if [ -n "$bins" ]; then
        echo "   Available to deploy:"
        echo "$bins" | while read -r f; do
            echo "     $(basename "$f") ($(ls -lh "$f" | awk '{print $5}'))"
        done
        echo "     → ./${NAME}.sh update v<version>"
    fi

    local baks
    baks=$(ls -1 "${DIR}/${NAME}.bak."* 2>/dev/null || true)
    if [ -n "$baks" ]; then
        echo ""
        echo "   Available backups:"
        echo "$baks" | while read -r f; do
            echo "     $(basename "$f") ($(ls -lh "$f" | awk '{print $5}'))"
        done
        echo "     → ./${NAME}.sh rollback"
    fi

    if [ -z "$bins" ] && [ -z "$baks" ]; then
        echo "   No versioned binaries or backups found"
    fi
    ;;

# ── update ───────────────────────────────────────────────────────────────────
update)
    if [ -z "$VERSION" ]; then
        fail "Usage: $0 update <version>"
        echo "  Example: $0 update v<version>"
        echo "  The binary must exist at: ${DIR}/${NAME}-${VERSION}"
    fi

    NEW_BINARY="${DIR}/${NAME}-${VERSION}"
    if [ ! -f "$NEW_BINARY" ]; then
        fail "Binary not found: $NEW_BINARY"
        echo "  Upload it to the server first via cPanel File Manager."
    fi

    local active_port standby_port
    active_port=$(get_active_port)
    standby_port=$(get_standby_port)

    echo "════════════════════════════════════════════════════"
    echo "  Updating ${NAME} to version ${VERSION}"
    echo "  Active port:  ${active_port}"
    echo "  Standby port: ${standby_port}"
    echo "════════════════════════════════════════════════════"

    # 1. Start new binary on standby port (config override via SERVER__PORT env var)
    info "Starting new version on port ${standby_port}..."
    cd "$DIR"
    SERVER__PORT="$standby_port" nohup "$NEW_BINARY" >> "$LOG_FILE" 2>&1 &
    local new_pid=$!
    info "New PID: $new_pid"

    # 2. Wait for health check on standby port
    wait_for_health "$standby_port" "New version (v${VERSION})"

    # 3. Backup current binary
    local date_stamp
    date_stamp=$(date '+%Y%m%d_%H%M%S')
    if [ -f "${DIR}/${NAME}" ]; then
        cp "${DIR}/${NAME}" "${DIR}/${NAME}.bak.${date_stamp}"
        ok "Backed up current binary → ${NAME}.bak.${date_stamp}"
    fi

    # 4. Update port tracking
    echo "$standby_port" > "$PORT_FILE"

    # 5. Update .htaccess to proxy to new port
    if [ -f "$HTACCESS" ]; then
        info "Switching .htaccess proxy to port ${standby_port}..."
        sed -i "s|http://127.0.0.1:${active_port}/|http://127.0.0.1:${standby_port}/|g" "$HTACCESS"
        ok ".htaccess updated"
    else
        warn ".htaccess not found — skipping proxy update"
    fi

    # 6. Save old PID then update PID file
    if [ -f "$PID_FILE" ]; then
        cp "$PID_FILE" "${PID_FILE}.old"
    fi
    echo "$new_pid" > "$PID_FILE"

    # 7. Promote the versioned binary
    cp "$NEW_BINARY" "${DIR}/${NAME}"
    chmod +x "${DIR}/${NAME}"

    # 8. Stop old instance
    # Read the old PID from file before we overwrote it
    local old_pid
    if [ -f "${PID_FILE}.old" ]; then
        old_pid=$(cat "${PID_FILE}.old")
        rm -f "${PID_FILE}.old"
    else
        # Fallback: find process listening on the old port
        old_pid=$(ss -tlnp 2>/dev/null | grep ":${active_port} " | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | head -1 || true)
        # Or try fuser
        if [ -z "$old_pid" ]; then
            old_pid=$(fuser "${active_port}/tcp" 2>/dev/null || true)
        fi
        # Or pgrep by name
        if [ -z "$old_pid" ]; then
            old_pid=$(pgrep -x "$NAME" 2>/dev/null || true)
        fi
    fi

    if [ -n "$old_pid" ] && [ "$old_pid" != "$new_pid" ]; then
        info "Stopping old instance on port ${active_port} (PID: $old_pid)..."
        kill "$old_pid" 2>/dev/null || true
        local waited=0
        while kill -0 "$old_pid" 2>/dev/null; do
            sleep 1
            waited=$((waited + 1))
            [ $waited -ge 35 ] && { kill -9 "$old_pid" 2>/dev/null || true; break; }
        done
        ok "Old instance stopped (${waited}s)"
    fi

    # 9. Verify new binary is still healthy on the now-active port
    sleep 1
    wait_for_health "$standby_port" "Final verification"

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Update complete — ${VERSION} is live${NC}"
    echo -e "${GREEN}  Port: ${standby_port}  PID: ${new_pid}${NC}"
    echo -e "${GREEN}  Next update will use port ${active_port}${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
    echo ""
    echo "To rollback:  ./axiom.sh rollback"
    ;;

# ── rollback ────────────────────────────────────────────────────────────────
rollback)
    local backup
    backup=$(ls -t "${DIR}/${NAME}.bak."* 2>/dev/null | head -1 || true)
    if [ -z "$backup" ]; then
        echo "No backups found in ${DIR}"
        echo "  Backups are created automatically during 'update'."
        fail "Nothing to rollback"
    fi

    info "Rolling back to: $(basename "$backup") ($(ls -lh "$backup" | awk '{print $5}'))"

    # Stop current
    "$0" stop

    # Swap
    cp "$backup" "${DIR}/${NAME}"
    chmod +x "${DIR}/${NAME}"

    # Start
    "$0" start
    ;;

# ── logs ─────────────────────────────────────────────────────────────────────
logs)
    if [ ! -f "$LOG_FILE" ]; then
        fail "No log file found at $LOG_FILE"
    fi
    tail -f "$LOG_FILE"
    ;;

*)
    fail "Unknown command: $CMD"
    echo "Usage: $0 <start|stop|status|update|rollback|logs>"
    ;;
esac

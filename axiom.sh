#!/usr/bin/env bash
set -euo pipefail

# ═════════════════════════════════════════════════════════════════════════════
# Axiom Manager — start, stop, update, rollback
# Usage:  ./axiom.sh <command>
#
# Commands:
#   start       Start the current binary
#   stop        Stop the running instance
#   status      Show running version, port, available updates & backups
#   update      Interactive: pick a versioned binary to deploy (zero-downtime)
#   rollback    Interactive: pick a backup to restore
#   logs        Tail the log file
# ═════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }
info() { echo -e "${CYAN}  →${NC} $*"; }

NAME="axiom"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${DIR}/${NAME}.log"
PID_FILE="${DIR}/${NAME}.pid"
PORT_FILE="${DIR}/${NAME}.port"
HTACCESS="${DIR}/.htaccess"
BACKUP_DIR="${DIR}/backups"
PORT_A=4500
PORT_B=4501

mkdir -p "$BACKUP_DIR"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start       Start the current binary"
    echo "  stop        Stop the running instance"
    echo "  status      Show running version, port, available updates & backups"
    echo "  update      Pick a versioned binary to deploy (zero-downtime)"
    echo "  rollback    Pick a backup to restore"
    echo "  logs        Tail the log file"
    exit 0
fi

CMD="$1"

# ── Helpers ──────────────────────────────────────────────────────────────────

get_active_port() {
    if [ -f "$PORT_FILE" ]; then cat "$PORT_FILE"; else echo "$PORT_A"; fi
}

get_standby_port() {
    local a; a=$(get_active_port)
    [ "$a" = "$PORT_A" ] && echo "$PORT_B" || echo "$PORT_A"
}

get_pid() {
    [ -f "$PID_FILE" ] && cat "$PID_FILE" || true
}

is_running() {
    local p; p=$(get_pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

health_check() {
    curl -sf "http://127.0.0.1:${1:-$(get_active_port)}/" > /dev/null 2>&1
}

wait_for_health() {
    for i in $(seq 1 15); do
        health_check "$1" && { ok "$2 health check passed (attempt $i)"; return 0; }
        sleep 1
    done
    fail "$2 health check failed after 15 seconds"
}

backup_binary() {
    local label="${1:-manual}"
    local ts; ts=$(date '+%Y%m%d_%H%M%S')
    if [ -f "${DIR}/${NAME}" ]; then
        local dest="${BACKUP_DIR}/${NAME}-${label}-${ts}"
        cp "${DIR}/${NAME}" "$dest"
        chmod +x "$dest"
        ok "Backed up → backups/$(basename "$dest") ($(ls -lh "$dest" | awk '{print $5}'))"
    fi
}

# ── Interactive picker (arrow keys + Enter + Ctrl+C) ────────────────────────

pick_one() {
    local title="$1"; shift
    local items=("$@")
    [ ${#items[@]} -eq 0 ] && return 1

    local selected=0
    local byte

    # Save terminal state, switch to raw mode (no echo, no line buffering)
    local saved_stty
    saved_stty=$(stty -g 2>/dev/null || true)
    stty raw -echo 2>/dev/null || true

    cleanup() {
        stty "$saved_stty" 2>/dev/null || true
        printf "\033[?25h" 2>/dev/null || true  # show cursor
        echo "" 2>/dev/null || true
    }

    draw() {
        local lines=$(( ${#items[@]} + 4 ))
        printf "\033[${lines}A\033[J"
        echo ""
        echo "  ${title}"
        echo ""
        local i=0
        for item in "${items[@]}"; do
            local name; name=$(basename "$item")
            local size; size=$(ls -lh "$item" | awk '{print $5}')
            if [ "$i" -eq "$selected" ]; then
                printf "  \033[7m %s  (%s) \033[27m\n" "$name" "$size"
            else
                printf "  %s  (%s)\n" "$name" "$size"
            fi
            i=$((i + 1))
        done
        echo ""
        printf "  Use arrow keys to select, Enter to confirm, Ctrl+C to cancel\n"
    }

    printf "\033[?25l"  # hide cursor
    draw

    while true; do
        # Read exactly 1 raw byte (terminal is in raw mode, no echo)
        byte=$(dd bs=1 count=1 2>/dev/null)

        case "$byte" in
            "$(printf '\033')")
                # Escape byte — read the rest of the arrow key sequence
                byte=$(dd bs=1 count=1 2>/dev/null)
                if [ "$byte" = "[" ]; then
                    byte=$(dd bs=1 count=1 2>/dev/null)
                    case "$byte" in
                        A)  # Up
                            selected=$((selected - 1))
                            [ "$selected" -lt 0 ] && selected=$(( ${#items[@]} - 1 ))
                            draw
                            ;;
                        B)  # Down
                            selected=$((selected + 1))
                            [ "$selected" -ge "${#items[@]}" ] && selected=0
                            draw
                            ;;
                    esac
                fi
                ;;
            "$(printf '\n')"|"$(printf '\r')")
                # Enter key
                break
                ;;
            "$(printf '\003')")
                # Ctrl+C — restore terminal and exit
                cleanup
                exit 1
                ;;
        esac
    done

    cleanup
    SELECTED="${items[$selected]}"
    return 0
}

# ── Commands ─────────────────────────────────────────────────────────────────

case "$CMD" in

# ── start ────────────────────────────────────────────────────────────────────
start)
    if is_running; then
        warn "Already running (PID: $(get_pid))"
        exit 0
    fi

    # If ./axiom doesn't exist, promote a versioned binary
    if [ ! -f "${DIR}/${NAME}" ]; then
        candidates=( "${DIR}/${NAME}-v"* )
        if [ ! -f "${candidates[0]}" ]; then
            fail "No binary found — upload a versioned binary like ${NAME}-v<version> first"
        fi

        if [ "${#candidates[@]}" -eq 1 ]; then
            # Only one — use it automatically
            cp "${candidates[0]}" "${DIR}/${NAME}"
            chmod +x "${DIR}/${NAME}"
            ok "Promoted: $(basename "${candidates[0]}") → ${NAME}"
        else
            # Multiple — let user pick
            warn "No ${NAME} binary found — select one to promote:"
            pick_one "Available binaries:" "${candidates[@]}" || exit 1
            cp "$SELECTED" "${DIR}/${NAME}"
            chmod +x "${DIR}/${NAME}"
            ok "Promoted: $(basename "$SELECTED") → ${NAME}"
        fi
    fi

    chmod +x "${DIR}/${NAME}"
    port=$(get_active_port)
    info "Starting ${NAME} on port ${port}..."
    cd "$DIR"
    nohup "./${NAME}" >> "$LOG_FILE" 2>&1 &
    pid=$!
    echo "$pid" > "$PID_FILE"
    echo "$port" > "$PORT_FILE"
    wait_for_health "$port" "Start"
    ok "Running (PID: $pid, Port: $port)"
    ;;

# ── stop ─────────────────────────────────────────────────────────────────────
stop)
    pid=$(get_pid)
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        warn "Not running"; exit 0
    fi
    info "Stopping (PID: $pid)..."
    kill "$pid" 2>/dev/null || true
    waited=0
    while kill -0 "$pid" 2>/dev/null; do
        sleep 1; waited=$((waited + 1))
        [ $waited -ge 35 ] && { kill -9 "$pid" 2>/dev/null || true; break; }
    done
    rm -f "$PID_FILE"
    ok "Stopped (${waited}s)"
    ;;

# ── status ───────────────────────────────────────────────────────────────────
status)
    if is_running; then
        pid=$(get_pid); port=$(get_active_port)
        echo -e "${GREEN}●${NC} ${NAME} is running"
        echo "   PID:      $pid"
        echo "   Port:     $port"
        health=$(curl -sf "http://127.0.0.1:${port}/" 2>/dev/null || true)
        if [ -n "$health" ]; then
            ver=$(echo "$health" | grep -o '"version":"[^"]*"' | head -1 | sed 's/"version":"//;s/"//')
            [ -n "$ver" ] && echo "   Version:  $ver"
        fi
        echo "   Uptime:   $(ps -p "$pid" -o etimes= 2>/dev/null || echo "?")s"
    else
        echo -e "${RED}✘${NC} ${NAME} is not running"
    fi

    echo ""
    bins=( "${DIR}/${NAME}-v"* )
    if [ -f "${bins[0]}" ]; then
        echo "   Available to deploy:"
        for f in "${bins[@]}"; do
            echo "     $(basename "$f") ($(ls -lh "$f" | awk '{print $5}'))"
        done
        echo "     → ./${NAME}.sh update"
    fi

    baks=( "${BACKUP_DIR}/${NAME}-"* )
    if [ -f "${baks[0]}" ]; then
        echo ""
        echo "   Available backups:"
        for f in "${baks[@]}"; do
            echo "     $(basename "$f") ($(ls -lh "$f" | awk '{print $5}'))"
        done
        echo "     → ./${NAME}.sh rollback"
    fi

    if { [ ! -f "${bins[0]}" ] || [ -z "${bins[0]}" ]; } && { [ ! -f "${baks[0]}" ] || [ -z "${baks[0]}" ]; } 2>/dev/null; then
        echo "   No versioned binaries or backups found"
    fi
    ;;

# ── update ───────────────────────────────────────────────────────────────────
update)
    # Gather available versioned binaries
    candidates=( "${DIR}/${NAME}-v"* )
    if [ ! -f "${candidates[0]}" ]; then
        fail "No versioned binaries found (e.g. ${NAME}-v<version>)"
        echo "  Upload one via cPanel File Manager, then re-run."
    fi

    pick_one "Select version to deploy:" "${candidates[@]}" || exit 1
    NEW_BINARY="$SELECTED"
    VERSION=$(basename "$NEW_BINARY" | sed "s/^${NAME}-//")

    active_port=$(get_active_port)
    standby_port=$(get_standby_port)

    echo "════════════════════════════════════════════════════"
    echo "  Updating to: ${VERSION}"
    echo "  Active port:  ${active_port}"
    echo "  Standby port: ${standby_port}"
    echo "════════════════════════════════════════════════════"

    # Start new version on standby port
    info "Starting ${VERSION} on port ${standby_port}..."
    cd "$DIR"
    SERVER__PORT="$standby_port" nohup "$NEW_BINARY" >> "$LOG_FILE" 2>&1 &
    new_pid=$!

    wait_for_health "$standby_port" "v${VERSION}"

    # Backup current binary
    backup_binary "pre-${VERSION}"

    # Switch port and .htaccess
    echo "$standby_port" > "$PORT_FILE"
    if [ -f "$HTACCESS" ]; then
        info "Switching .htaccess to port ${standby_port}..."
        sed -i "s|http://127.0.0.1:${active_port}/|http://127.0.0.1:${standby_port}/|g" "$HTACCESS"
        ok ".htaccess updated"
    fi

    # Promote binary
    cp "$NEW_BINARY" "${DIR}/${NAME}"
    chmod +x "${DIR}/${NAME}"
    echo "$new_pid" > "$PID_FILE"

    # Stop old instance
    old_pid=$(ss -tlnp 2>/dev/null | grep ":${active_port} " | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | head -1 || true)
    [ -z "$old_pid" ] && old_pid=$(fuser "${active_port}/tcp" 2>/dev/null || true)
    [ -z "$old_pid" ] && old_pid=$(pgrep -x "$NAME" 2>/dev/null || true)

    if [ -n "$old_pid" ] && [ "$old_pid" != "$new_pid" ]; then
        info "Stopping old instance on port ${active_port} (PID: $old_pid)..."
        kill "$old_pid" 2>/dev/null || true
        waited=0
        while kill -0 "$old_pid" 2>/dev/null; do
            sleep 1; waited=$((waited + 1))
            [ $waited -ge 35 ] && { kill -9 "$old_pid" 2>/dev/null || true; break; }
        done
        ok "Old instance stopped (${waited}s)"
    fi

    sleep 1
    wait_for_health "$standby_port" "Final verification"

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ${VERSION} is live on port ${standby_port} (PID: ${new_pid})${NC}"
    echo -e "${GREEN}  Next update will use port ${active_port}${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
    ;;

# ── rollback ─────────────────────────────────────────────────────────────────
rollback)
    candidates=( "${BACKUP_DIR}/${NAME}-"* )
    if [ ! -f "${candidates[0]}" ]; then
        fail "No backups found in backups/"
        echo "  Backups are created automatically during 'update'."
    fi

    pick_one "Select backup to restore:" "${candidates[@]}" || exit 1
    RESTORE="$SELECTED"
    info "Restoring: $(basename "$RESTORE") ($(ls -lh "$RESTORE" | awk '{print $5}'))"

    "$0" stop
    cp "$RESTORE" "${DIR}/${NAME}"
    chmod +x "${DIR}/${NAME}"
    "$0" start
    ;;

# ── logs ─────────────────────────────────────────────────────────────────────
logs)
    [ -f "$LOG_FILE" ] || fail "No log file found"
    tail -f "$LOG_FILE"
    ;;

*)
    fail "Unknown command: $CMD"
    echo "Usage: $0 <start|stop|status|update|rollback|logs>"
    ;;
esac

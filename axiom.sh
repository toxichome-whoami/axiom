#!/usr/bin/env bash
set -euo pipefail

# ═════════════════════════════════════════════════════════════════════════════
# Axiom Manager — start, stop, status, logs
# Usage:  ./axiom.sh <command>
#
# Commands:
#   start       Start the server
#   stop        Stop the running instance
#   status      Show PID, port, version
#   logs        Tail the log file
# ═════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ${NC} $*"; }
warn() { echo -e "${YELLOW}  ${NC} $*"; }
fail() { echo -e "${RED}  ${NC} $*"; exit 1; }
info() { echo -e "  $*"; }

NAME="axiom"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${DIR}/${NAME}.log"
PID_FILE="${DIR}/${NAME}.pid"
PORT_FILE="${DIR}/${NAME}.port"
PORT=4500

if [ $# -lt 1 ]; then
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start       Start the server"
    echo "  stop        Stop the running instance"
    echo "  status      Show PID, port, version"
    echo "  logs        Tail the log file"
    exit 0
fi

CMD="$1"

get_pid() { [ -f "$PID_FILE" ] && cat "$PID_FILE" || true; }
is_running() { local p; p=$(get_pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }
get_port() { [ -f "$PORT_FILE" ] && cat "$PORT_FILE" || echo "$PORT"; }

health_check() {
    curl -sf "http://127.0.0.1:${1:-$(get_port)}/" > /dev/null 2>&1
}

wait_for_health() {
    for i in $(seq 1 15); do
        health_check "$1" && { ok "$2 health check passed (attempt $i)"; return 0; }
        sleep 1
    done
    fail "$2 health check failed after 15 seconds"
}

case "$CMD" in

start)
    if is_running; then
        warn "Already running (PID: $(get_pid))"
        exit 0
    fi

    if [ ! -f "${DIR}/${NAME}" ]; then
        fail "Binary not found: ${DIR}/${NAME}"
    fi

    chmod +x "${DIR}/${NAME}"
    port=$(get_port)
    info "Starting ${NAME} on port ${port}..."
    cd "$DIR"
    nohup "./${NAME}" >> "$LOG_FILE" 2>&1 &
    pid=$!
    echo "$pid" > "$PID_FILE"
    echo "$port" > "$PORT_FILE"
    wait_for_health "$port" "Start"
    ok "Running (PID: $pid, Port: $port)"
    ;;

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

status)
    if is_running; then
        pid=$(get_pid); port=$(get_port)
        echo " ${NAME} is running"
        echo "   PID:      $pid"
        echo "   Port:     $port"
        health=$(curl -sf "http://127.0.0.1:${port}/" 2>/dev/null || true)
        if [ -n "$health" ]; then
            ver=$(echo "$health" | grep -o '"version":"[^"]*"' | head -1 | sed 's/"version":"//;s/"//')
            [ -n "$ver" ] && echo "   Version:  $ver"
        fi
        echo "   Uptime:   $(ps -p "$pid" -o etimes= 2>/dev/null || echo "?")s"
    else
        echo " ${NAME} is not running"
    fi
    ;;

logs)
    [ -f "$LOG_FILE" ] || fail "No log file found"
    tail -f "$LOG_FILE"
    ;;

*)
    fail "Unknown command: $CMD"
    echo "Usage: $0 <start|stop|status|logs>"
    ;;
esac

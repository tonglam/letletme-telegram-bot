#!/usr/bin/env bash
set -euo pipefail

APP_NAME=${APP_NAME:-letletme-telegram-bot}
APP_HOME=${APP_HOME:-/home/workspace/letletme-telegram-bot}
RELEASES_DIR=${RELEASES_DIR:-"$APP_HOME/releases"}
CURRENT_LINK=${CURRENT_LINK:-"$APP_HOME/current"}
DIST_DIR=${DIST_DIR:-"$CURRENT_LINK/dist"}
LOG_DIR=${LOG_DIR:-"$APP_HOME/logs"}
RUN_DIR=${RUN_DIR:-"$APP_HOME/run"}
PID_FILE=${PID_FILE:-"$RUN_DIR/$APP_NAME.pid"}
CONSOLE_LOG=${CONSOLE_LOG:-"$LOG_DIR/console.log"}
ENV_FILE=${ENV_FILE:-"$APP_HOME/.env"}
BUN_CMD=${BUN_CMD:-bun}
ENTRYPOINT=${ENTRYPOINT:-"$DIST_DIR/index.js"}
HEALTH_URL=${HEALTH_URL:-}
HEALTH_TIMEOUT_SECONDS=${HEALTH_TIMEOUT_SECONDS:-2}

ensure_dirs() {
  mkdir -p "$RELEASES_DIR" "$LOG_DIR" "$RUN_DIR"
  chmod 700 "$LOG_DIR" "$RUN_DIR"
  touch "$CONSOLE_LOG"
  chmod 600 "$CONSOLE_LOG"
}

load_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
  if [[ -z "$HEALTH_URL" ]]; then
    HEALTH_URL="http://127.0.0.1:${PORT:-3000}/healthz"
  fi
}

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE")
    if [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

current_pid() {
  if [[ -f "$PID_FILE" ]]; then
    cat "$PID_FILE"
  fi
}

resolve_entrypoint() {
  if [[ ! -f "$ENTRYPOINT" ]]; then
    echo "No entrypoint found at $ENTRYPOINT. Build or upload the artifact first." >&2
    return 1
  fi
  echo "$ENTRYPOINT"
}

check_health() {
  curl --fail --silent --show-error --max-time "$HEALTH_TIMEOUT_SECONDS" "$HEALTH_URL" >/dev/null
}

print_status() {
  if is_running; then
    echo "$APP_NAME is running with PID $(current_pid)"
  else
    echo "$APP_NAME is not running"
  fi
}

#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

if ! is_running; then
  echo "$APP_NAME is not running. Nothing to stop."
  rm -f "$PID_FILE"
  exit 0
fi

PID=$(current_pid)
echo "Stopping $APP_NAME (PID $PID)"
kill "$PID" || true
for _ in {1..35}; do
  if ! ps -p "$PID" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ps -p "$PID" >/dev/null 2>&1; then
  echo "Process did not exit in time; sending SIGKILL."
  kill -9 "$PID" || true
fi

rm -f "$PID_FILE"
echo "$APP_NAME stopped."

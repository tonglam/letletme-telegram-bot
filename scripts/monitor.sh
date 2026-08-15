#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

load_env_file
print_status

if is_running; then
  if check_health; then
    echo "$APP_NAME health: ok"
  else
    echo "$APP_NAME health: failed" >&2
  fi
fi

if [[ ${1:-} == "-f" ]]; then
  echo "Streaming logs from $CONSOLE_LOG (Ctrl+C to exit)"
  tail -f "$CONSOLE_LOG"
  exit 0
fi

if [[ -f "$CONSOLE_LOG" ]]; then
  echo "--- Last 40 lines of console log ($CONSOLE_LOG) ---"
  tail -n 40 "$CONSOLE_LOG"
else
  echo "Console log not found at $CONSOLE_LOG"
fi

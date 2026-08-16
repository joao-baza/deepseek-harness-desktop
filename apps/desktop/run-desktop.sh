#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/deepseek-harness-desktop"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/launcher.log" 2>&1

echo "[$(date --iso-8601=seconds)] launching DeepSeek Harness desktop"

for node_bin in "$HOME"/.nvm/versions/node/*/bin; do
  if [ -d "$node_bin" ]; then
    export PATH="$node_bin:$PATH"
  fi
done
export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found in PATH=$PATH"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "DeepSeek Harness" "Could not launch: pnpm was not found. See $LOG_DIR/launcher.log"
  fi
  exit 127
fi

cd "$(dirname "$0")/../.."
exec pnpm dsh:desktop

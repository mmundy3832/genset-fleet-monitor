#!/usr/bin/env bash
# One-line local launch: serve this directory and open the browser.
# Usage: ./run.sh [port]
set -euo pipefail
PORT="${1:-8080}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="http://localhost:${PORT}/"

if command -v python3 >/dev/null 2>&1; then
  SERVE=(python3 -m http.server "$PORT" --directory "$DIR")
elif command -v python >/dev/null 2>&1; then
  SERVE=(python -m http.server "$PORT" --directory "$DIR")
elif command -v npx >/dev/null 2>&1; then
  SERVE=(npx --yes serve -l "$PORT" "$DIR")
else
  echo "Need python3, python, or npx on PATH to serve static files." >&2
  exit 1
fi

echo "Serving $DIR at $URL (Ctrl-C to stop)"
"${SERVE[@]}" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
sleep 1

if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then open "$URL" || true
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "$URL" || true
else echo "Open $URL in a browser."
fi

wait "$SERVER_PID"

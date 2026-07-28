#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Dino Royale Evolution - launcher for macOS and Linux
#  Starts the game server and opens the browser. No installation required.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed."
  echo "  Install it from https://nodejs.org (version 20 or newer), then run this again."
  echo ""
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo ""
  echo "  Node.js $(node -v) is too old - version 20 or newer is required."
  echo ""
  exit 1
fi

echo ""
echo "  Starting Dino Royale Evolution on http://localhost:$PORT"
echo "  Keep this window open while you play. Press Ctrl+C to stop."
echo ""

# Open the browser once the port is actually accepting connections.
(
  for _ in $(seq 1 40); do
    if (echo > "/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT"
      fi
      break
    fi
    sleep 0.25
  done
) &

PORT="$PORT" exec node server/server.js

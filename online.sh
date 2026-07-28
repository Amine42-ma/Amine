#!/bin/sh
# Starts Dino Royale Evolution and publishes a public link for it.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed."
  echo "  Install the LTS version from https://nodejs.org and run this again."
  echo
  exit 1
fi

exec node tools/online.js "$@"

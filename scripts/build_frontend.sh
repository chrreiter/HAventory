#!/usr/bin/env bash
# Build the HAventory Lovelace card (cards/haventory-card -> www/haventory).
source "$(dirname "$0")/common.sh"

if ! command -v npm >/dev/null 2>&1; then
  err 'npm not found; cannot build the frontend card.'
  exit 1
fi

cd "$CARD_DIR"
info 'npm install --no-audit --no-fund...'
npm install --no-audit --no-fund
info 'npm run build...'
npm run build
ok 'Frontend build complete.'

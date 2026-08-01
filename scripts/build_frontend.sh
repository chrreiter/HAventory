#!/usr/bin/env bash
# Build the HAventory Lovelace card
# (cards/haventory-card -> custom_components/haventory/www/haventory-card.js).
source "$(dirname "$0")/common.sh"

if ! command -v npm >/dev/null 2>&1; then
  err 'npm not found; cannot build the frontend card.'
  exit 1
fi

cd "$CARD_DIR"
info 'npm ci --no-audit --no-fund...'
npm ci --no-audit --no-fund
info 'npm run build...'
npm run build
ok 'Frontend build complete.'

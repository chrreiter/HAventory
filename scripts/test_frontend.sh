#!/usr/bin/env bash
# Run the frontend (Vitest) test suite for the HAventory card.
#   --coverage   generate a coverage report
#   --watch      run in interactive watch mode
source "$(dirname "$0")/common.sh"

if ! command -v npm >/dev/null 2>&1; then
  err 'npm not found. Install Node 22.13+ / 24 LTS.'
  exit 1
fi

cd "$CARD_DIR"
[ -d node_modules ] || { info 'Installing dependencies (npm install --no-audit --no-fund)...'; npm install --no-audit --no-fund; }

case "${1:-}" in
  --watch)    info 'Running frontend tests (watch)...';    npm run test:watch ;;
  --coverage) info 'Running frontend tests (coverage)...'; npm run test:coverage ;;
  *)          info 'Running frontend tests...';            npm test ;;
esac

ok 'Frontend tests OK'

#!/usr/bin/env bash
# Run all linters: ruff (backend), mypy (backend types), eslint (frontend).
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

info 'ruff check...'
ruff_run check .

info 'ruff format --check...'
ruff_run format --check .

info 'mypy...'
mypy_run

if command -v npm >/dev/null 2>&1; then
  info 'eslint (frontend)...'
  (cd "$CARD_DIR" && npx eslint .)
else
  err 'npm not found; skipping frontend lint.'
fi

ok 'Lint OK'

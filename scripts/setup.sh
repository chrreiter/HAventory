#!/usr/bin/env bash
# Bootstrap the HAventory dev environment (Linux/bash).
#   - syncs the Python dev environment with uv (creates .venv from
#     pyproject.toml + uv.lock, installs the `dev` dependency group)
#   - installs frontend deps with npm install --no-audit --no-fund
#   - installs pre-commit hooks (unless --ci)
source "$(dirname "$0")/common.sh"

CI=0
[ "${1:-}" = "--ci" ] && CI=1

if [ -z "${UV:-}" ]; then
  err 'uv not found. Install it: https://docs.astral.sh/uv/getting-started/installation/'
  exit 1
fi

info 'Syncing Python dev environment with uv...'
"$UV" sync

if command -v npm >/dev/null 2>&1; then
  info 'Installing frontend dependencies (npm install --no-audit --no-fund)...'
  (cd "$CARD_DIR" && npm install --no-audit --no-fund)
else
  err 'npm not found; skipping frontend bootstrap (install Node 22.13+ / 24 LTS).'
fi

if [ "$CI" -eq 0 ] && [ -f "$REPO_ROOT/.pre-commit-config.yaml" ] && [ -d "$REPO_ROOT/.git" ]; then
  info 'Installing pre-commit hooks...'
  "$UV" run pre-commit install
fi

ok 'Setup complete.'

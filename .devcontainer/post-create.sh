#!/usr/bin/env bash
# Devcontainer bootstrap: sync the Python dev env with uv and install card deps.
# It ends by running the offline suite, so a container that comes up green is one
# the gate can be run in. A real HA with HACS is .devcontainer/develop.sh.
set -euo pipefail

echo "[post-create] uv sync (Python dev environment, provisions CPython 3.14)..."
uv sync

if command -v npm >/dev/null 2>&1; then
  echo "[post-create] npm ci (frontend card)..."
  (cd cards/haventory-card && npm ci --no-audit --no-fund)
fi

echo "[post-create] Verifying the offline suite runs..."
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q

echo "[post-create] Done. Run HA + HACS locally with: bash .devcontainer/develop.sh"

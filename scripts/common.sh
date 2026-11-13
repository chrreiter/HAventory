#!/usr/bin/env bash
# Shared helpers for the dev scripts: source "$(dirname "$0")/common.sh"
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARD_DIR="$REPO_ROOT/cards/haventory-card"

info() { printf '\033[36m[INFO]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[ OK ]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[ERR ]\033[0m %s\n' "$*" >&2; }

find_uv() {
  local c
  for c in uv "$HOME/.local/bin/uv" /root/.local/bin/uv; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
  done
  return 1
}
UV="$(find_uv || true)"

# Prefer `uv run` (the locked dev environment), else the bare tool.
py()        { if [ -n "${UV:-}" ]; then "$UV" run python "$@"; else python3 "$@"; fi; }
pytest_run(){ if [ -n "${UV:-}" ]; then "$UV" run pytest "$@"; else python3 -m pytest "$@"; fi; }
ruff_run()  { if [ -n "${UV:-}" ]; then "$UV" run ruff "$@"; else ruff "$@"; fi; }
mypy_run()  { if [ -n "${UV:-}" ]; then "$UV" run mypy "$@"; else mypy "$@"; fi; }

# The environment the in-process suite runs in and mypy resolves imports from:
# the interpreter series the declared HA floor runs on, and the real
# Home Assistant that requirements-integration.txt pins to the declared floor.
# Kept apart from the offline `.venv`, which must stay Home-Assistant-free.
INT_VENV="$REPO_ROOT/.venv-integration"
INT_VENV_PYTHON="$INT_VENV/bin/python"

ensure_integration_venv() {
  local py_version="${HAVENTORY_INTEGRATION_PYTHON:-3.14}"
  if [ -z "${UV:-}" ]; then
    err 'uv not found — needed to provision Python 3.14 for the integration environment.'
    err 'Install uv: https://docs.astral.sh/uv/getting-started/installation/'
    return 1
  fi
  info "Provisioning Python ${py_version} (uv downloads it if missing)..."
  "$UV" python install "$py_version"
  if [ ! -x "$INT_VENV_PYTHON" ]; then
    info "Creating integration venv at $INT_VENV..."
    "$UV" venv --python "$py_version" "$INT_VENV"
  fi
  info 'Installing integration deps (phacc + HA core) from requirements-integration.txt...'
  "$UV" pip install --python "$INT_VENV_PYTHON" -r "$REPO_ROOT/requirements-integration.txt"
}

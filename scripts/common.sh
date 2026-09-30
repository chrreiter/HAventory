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

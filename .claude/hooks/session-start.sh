#!/bin/bash
# HAventory SessionStart hook: bootstrap a fresh Claude Code session.
#
# Idempotent — safe to re-run when dependencies already exist:
#   * syncs the backend env from pyproject.toml + uv.lock (`uv sync`), falling
#     back to venv + requirements-dev.txt only where uv is absent
#   * runs `npm ci` in cards/haventory-card only when node_modules is absent
#   * provisions the separate integration env (.venv-integration), best-effort
#
# Runs synchronously so tests/lint/build are ready before the agent starts.
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

log() { printf '[session-start] %s\n' "$1" >&2; }

# Every Python path below is the POSIX venv layout (`bin/`), and so is every
# helper that consumes these environments — scripts/test_integration.sh runs
# "$INT_VENV/bin/python" directly. Under Git Bash / MSYS / Cygwin on Windows, uv
# and venv write `Scripts/` instead, so `bin/python` never appears no matter how
# well the environment was built. Teaching this one script both layouts would
# produce an environment the rest of the repo still cannot run, so the Python
# blocks are skipped outright instead. CONTRIBUTING.md → "Development setup" is
# explicit: there is no Windows host support — develop through WSL2, where these
# paths are the Linux ones.
#
# macOS is deliberately not excluded: it is POSIX and `bin/` is correct there.
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW* | MSYS* | CYGWIN*) POSIX_VENV_HOST=0 ;;
  *) POSIX_VENV_HOST=1 ;;
esac

# --- Backend: Python environment + dev dependencies -------------------------
# `uv sync` is what docs/developing.md → "Setup" bootstraps with — scripts/setup.sh
# runs it — and the only one that reproduces the locked set: requirements-dev.txt
# carries its own header saying it is a generated pip fallback for environments
# without uv, not a second source of truth. The fallback searches for Python 3.14
# first because that is the floor `requires-python` declares, and the source uses
# PEP 758 unparenthesized `except A, B:`, which does not parse on 3.13 — an older
# interpreter yields an environment that cannot import the integration at all,
# which is worse than no environment.
if [ "$POSIX_VENV_HOST" -eq 0 ]; then
  log "Windows shell detected; skipping the Python bootstrap (develop through WSL2, see CONTRIBUTING.md)"
elif command -v uv >/dev/null 2>&1; then
  log "syncing backend environment (uv sync)"
  uv sync
elif [ -x .venv/bin/pip ]; then
  log "uv not found; installing backend dev dependencies into the existing .venv"
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements-dev.txt
else
  PYTHON_BIN=""
  for candidate in python3.14 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
  if [ -z "$PYTHON_BIN" ]; then
    log "no uv and no python interpreter found; skipping backend bootstrap"
  else
    log "uv not found; creating .venv with $PYTHON_BIN"
    "$PYTHON_BIN" -m venv .venv
    .venv/bin/python -m pip install --quiet --upgrade pip
    .venv/bin/pip install --quiet -r requirements-dev.txt
  fi
fi

# --- Frontend: npm dependencies --------------------------------------------
CARD_DIR="cards/haventory-card"
if command -v npm >/dev/null 2>&1; then
  if [ ! -d "$CARD_DIR/node_modules" ]; then
    log "installing frontend dependencies (npm ci)"
    (cd "$CARD_DIR" && npm ci)
  else
    log "frontend node_modules present; skipping npm ci"
  fi
else
  log "npm not found; skipping frontend bootstrap"
fi

# --- Integration test harness (in-process HA via phacc) --------------------
# The second test mode (tests/integration/) runs against a REAL Home Assistant
# core, which needs Python 3.14 and a full HA install (phacc, from
# requirements-integration.txt). It uses a DEDICATED env (.venv-integration) so
# the offline `.venv` above stays Home-Assistant-free.
#
# This is heavy and needs a Python 3.14 interpreter plus network for the HA core,
# so it is strictly best-effort: it must NEVER fail session bootstrap (e.g. in
# restricted-egress sandboxes that can't fetch Python 3.14). The offline suite is
# unaffected either way. Run the suite with: scripts/test_integration.sh
INT_VENV=".venv-integration"
if [ "$POSIX_VENV_HOST" -eq 0 ]; then
  log "Windows shell detected; skipping the integration env (scripts/test_integration.sh is POSIX-only)"
elif ! command -v uv >/dev/null 2>&1; then
  log "uv not found; skipping integration env bootstrap"
elif [ -x "$INT_VENV/bin/python" ]; then
  log "integration env present; skipping"
else
  log "provisioning integration test env ($INT_VENV) — best-effort"
  if uv python install 3.14 >/dev/null 2>&1 \
     && uv venv --python 3.14 "$INT_VENV" >/dev/null 2>&1 \
     && uv pip install --python "$INT_VENV/bin/python" \
          -r requirements-integration.txt >/dev/null 2>&1; then
    log "integration env ready; run scripts/test_integration.sh"
  else
    # Only reachable when this run just tried to build the env, so this removes a
    # half-provisioned directory rather than a working one somebody else made.
    log "integration env unavailable (needs Python 3.14 + network for HA core); skipping"
    rm -rf "$INT_VENV" 2>/dev/null || true
  fi
fi

log "bootstrap complete"

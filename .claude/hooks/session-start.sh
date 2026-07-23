#!/bin/bash
# HAventory SessionStart hook: bootstrap a fresh Claude Code session.
#
# Idempotent — safe to re-run when dependencies already exist:
#   * creates .venv (preferring python3.12, the project target) if missing,
#     then pip-installs backend dev deps (pip skips already-satisfied ones)
#   * runs `npm ci` in cards/haventory-card only when node_modules is absent
#
# Runs synchronously so tests/lint/build are ready before the agent starts.
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

log() { printf '[session-start] %s\n' "$1" >&2; }

# --- Backend: Python venv + dev dependencies -------------------------------
if [ ! -d .venv ]; then
  PYTHON_BIN=""
  for candidate in python3.12 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
  if [ -z "$PYTHON_BIN" ]; then
    log "no python interpreter found; skipping backend bootstrap"
  else
    log "creating .venv with $PYTHON_BIN"
    "$PYTHON_BIN" -m venv .venv
  fi
fi

if [ -x .venv/bin/pip ]; then
  log "installing backend dev dependencies"
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements-dev.txt
else
  log "no .venv/bin/pip; skipping backend dependency install"
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
# This is heavy and needs a 3.14 interpreter plus network for the HA core, so it
# is strictly best-effort: it must NEVER fail session bootstrap (e.g. in
# restricted-egress sandboxes that can't fetch Python 3.14). The offline suite is
# unaffected either way. Run the suite with: scripts/test_integration.sh
INT_VENV=".venv-integration"
if command -v uv >/dev/null 2>&1; then
  if [ ! -x "$INT_VENV/bin/python" ]; then
    log "provisioning integration test env ($INT_VENV) — best-effort"
    if uv python install 3.14 >/dev/null 2>&1 \
       && uv venv --python 3.14 "$INT_VENV" >/dev/null 2>&1 \
       && uv pip install --python "$INT_VENV/bin/python" \
            -r requirements-integration.txt >/dev/null 2>&1; then
      log "integration env ready; run scripts/test_integration.sh"
    else
      log "integration env unavailable (needs Python 3.14 + network for HA core); skipping"
      rm -rf "$INT_VENV" 2>/dev/null || true
    fi
  else
    log "integration env present; skipping"
  fi
else
  log "uv not found; skipping integration env bootstrap"
fi

log "bootstrap complete"

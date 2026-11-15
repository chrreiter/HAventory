#!/usr/bin/env bash
# Run every backend test against the real Home Assistant at the declared floor.
#
# Builds or refreshes .venv-integration from requirements-integration.txt (a
# no-op once it is current), then runs pytest there. Extra args are forwarded
# to pytest, e.g. `scripts/test.sh --cov=custom_components/haventory`.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

ensure_integration_venv

info 'Running the backend tests...'
"$INT_VENV_PYTHON" -m pytest -q tests "$@"
ok 'Backend tests OK'

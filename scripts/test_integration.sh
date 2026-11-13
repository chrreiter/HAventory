#!/usr/bin/env bash
# Run the in-process Home Assistant integration test suite (tests/integration/).
#
# Loads a real Home Assistant core via pytest-homeassistant-custom-component
# (phacc), so it needs:
#   * Python 3.14 (the declared HA runtime; the integration source is 3.14-only), and
#   * the phacc harness from requirements-integration.txt.
#
# A dedicated .venv-integration keeps the offline `.venv` Home-Assistant-free.
# Extra args are forwarded to pytest.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

ensure_integration_venv

# phacc needs plugin autoload on; do not inherit the offline flag.
unset PYTEST_DISABLE_PLUGIN_AUTOLOAD

info 'Running in-process HA integration tests (phacc)...'
"$INT_VENV_PYTHON" -m pytest -q -o asyncio_mode=auto tests/integration "$@"
ok 'Integration tests OK'

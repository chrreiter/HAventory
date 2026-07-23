#!/usr/bin/env bash
# Run the in-process Home Assistant integration test suite (tests/integration/).
#
# Unlike the offline suite (HA stubbed), this loads a REAL Home Assistant core via
# pytest-homeassistant-custom-component (phacc), so it needs:
#   * Python 3.14 (the declared HA runtime; the integration source is 3.14-only), and
#   * the phacc harness from requirements-integration.txt (pulls a full HA core).
#
# It uses a DEDICATED environment (.venv-integration) so the offline `.venv` stays
# Home-Assistant-free (tests/conftest.py stubs HA there). Plugin autoload stays ON
# (phacc must load) and pytest-asyncio runs in auto mode (phacc requires it). Extra
# args are forwarded to pytest.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

INT_VENV="$REPO_ROOT/.venv-integration"
PY_VERSION="${HAVENTORY_INTEGRATION_PYTHON:-3.14}"

if [ -z "${UV:-}" ]; then
  err 'uv not found — needed to provision Python 3.14 for the integration suite.'
  err 'Install uv: https://docs.astral.sh/uv/getting-started/installation/'
  exit 1
fi

info "Provisioning Python ${PY_VERSION} (uv downloads it if missing)..."
"$UV" python install "$PY_VERSION"

if [ ! -x "$INT_VENV/bin/python" ]; then
  info "Creating integration venv at $INT_VENV..."
  "$UV" venv --python "$PY_VERSION" "$INT_VENV"
fi

info 'Installing integration harness deps (phacc + HA core)...'
"$UV" pip install --python "$INT_VENV/bin/python" -r requirements-integration.txt

# Autoload MUST be enabled for phacc; make sure the offline flag isn't inherited.
unset PYTEST_DISABLE_PLUGIN_AUTOLOAD

info 'Running in-process HA integration tests (phacc)...'
"$INT_VENV/bin/python" -m pytest -q -o asyncio_mode=auto tests/integration "$@"
ok 'Integration tests OK'

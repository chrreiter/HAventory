#!/usr/bin/env bash
# Run the offline backend test suite (HA is stubbed; 3rd-party plugin autoload
# disabled). Extra args are forwarded to pytest.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"
export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1

info 'Running offline backend tests...'
pytest_run -q "$@"
ok 'Tests OK'

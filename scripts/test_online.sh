#!/usr/bin/env bash
# Run the opt-in online backend tests against a real Home Assistant instance.
# Requires RUN_ONLINE=1, HA_BASE_URL and HA_TOKEN (see README). Extra args are
# forwarded to pytest.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"
export RUN_ONLINE="${RUN_ONLINE:-1}"
export HA_ALLOW_AREA_MUTATIONS="${HA_ALLOW_AREA_MUTATIONS:-1}"

info 'Running online backend tests (marker: online)...'
pytest_run -q -m online "$@"
ok 'Online tests OK'

#!/usr/bin/env bash
# Run the online WebSocket smoke tests against a real Home Assistant instance.
# Requires RUN_ONLINE=1, HA_TOKEN (and optionally HA_BASE_URL, HA_CONTAINER).
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

if [ -z "${RUN_ONLINE:-}" ]; then
  info 'RUN_ONLINE is not set; skipping online smoke tests.'
  exit 0
fi

export HA_BASE_URL="${HA_BASE_URL:-http://localhost:8123}"
if [ -z "${HA_TOKEN:-}" ]; then
  err 'HA_TOKEN is not set. Export a Home Assistant long-lived token.'
  exit 2
fi

# Optional: purge storage + reload the integration for a clean start.
if [ -n "${HA_CONTAINER:-}" ]; then
  info "Purging HAventory storage in container '$HA_CONTAINER'..."
  docker exec "$HA_CONTAINER" sh -lc \
    'rm -f /config/.storage/haventory_store /workspaces/home-assistant_core/config/.storage/haventory_store 2>/dev/null || true' >/dev/null 2>&1 || true
  "$REPO_ROOT/scripts/reload_addon.sh" --container "$HA_CONTAINER" --sleep 8 \
    || info 'reload_addon.sh reported an issue; continuing.'
fi

export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
info 'Running online smoke tests...'
pytest_run -q -m online --disable-warnings --maxfail=1 \
  tests/test_ws_smoke_online.py \
  tests/test_ws_smoke_advanced_online.py

ok 'Online smoke test completed successfully.'

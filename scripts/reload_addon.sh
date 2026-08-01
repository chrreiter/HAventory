#!/usr/bin/env bash
# Redeploy the HAventory integration + built card into a running Home Assistant
# Docker container, restart HA, and (optionally) initialise the config entry.
#
# This is a manual dev-loop helper for a hand-managed HA container. For a
# reproducible environment prefer .devcontainer/ (VS Code / Codespaces).
#
# Usage:
#   scripts/reload_addon.sh --container NAME [options]
# Options (env var / flag):
#   --container NAME         (required) target docker container name
#   --examples-config        deploy examples/configuration.yaml (default: dev config)
#   --no-clean               don't purge __pycache__ before copying
#   --no-start-ha            don't start HA inside the container (supervisor-managed)
#   --no-init-entry          don't initialise the HAventory config entry via WS
#   --tail-logs              tail recent HA logs filtered by 'haventory'
#   --sleep N                seconds to wait after restart (default: 8)
source "$(dirname "$0")/common.sh"

CONTAINER=""
USE_DEV_CONFIG=1
CLEAN=1
START_HA=1
INIT_ENTRY=1
TAIL_LOGS=0
SLEEP_AFTER=8

while [ $# -gt 0 ]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --examples-config) USE_DEV_CONFIG=0; shift ;;
    --no-clean) CLEAN=0; shift ;;
    --no-start-ha) START_HA=0; shift ;;
    --no-init-entry) INIT_ENTRY=0; shift ;;
    --tail-logs) TAIL_LOGS=1; shift ;;
    --sleep) SLEEP_AFTER="$2"; shift 2 ;;
    *) err "Unknown option: $1"; exit 2 ;;
  esac
done

[ -n "$CONTAINER" ] || { err 'Missing required --container NAME'; exit 2; }
command -v docker >/dev/null 2>&1 || { err 'docker not found on PATH.'; exit 1; }

local_component="$REPO_ROOT/custom_components/haventory"
[ -d "$local_component" ] || { err "Local component not found: $local_component"; exit 1; }

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  err "Container '$CONTAINER' not found."
  exit 1
fi

# Detect the HA config directory inside the container.
remote_cfg="$(docker exec "$CONTAINER" sh -lc \
  'if [ -d /config ]; then echo /config; elif [ -d /workspaces/home-assistant_core/config ]; then echo /workspaces/home-assistant_core/config; else echo /config; fi' \
  2>/dev/null | tr -d '\r')"
remote_cfg="${remote_cfg:-/config}"
target_root="$remote_cfg/custom_components"

info "Ensuring $target_root exists..."
docker exec "$CONTAINER" sh -lc "mkdir -p '$target_root'" >/dev/null

if [ "$CLEAN" -eq 1 ]; then
  info 'Cleaning __pycache__ folders...'
  docker exec "$CONTAINER" sh -lc "find '$target_root' -type d -name __pycache__ -prune -exec rm -rf {} +" >/dev/null 2>&1 || true
fi

# Build the card first: it lands in custom_components/haventory/www/ and rides
# along with the component copy below. Building afterwards would deploy the
# previous build.
if command -v npm >/dev/null 2>&1; then
  info 'Building frontend card (npm ci --no-audit --no-fund && npm run build)...'
  (cd "$CARD_DIR" && npm ci --no-audit --no-fund >/dev/null && npm run build --silent >/dev/null) \
    || err 'card build failed'
fi

info 'Copying integration (incl. the card bundle) into container...'
docker cp "$local_component" "$CONTAINER:$target_root" >/dev/null
ok "Copied to $target_root"

# Deploy config.
if [ "$USE_DEV_CONFIG" -eq 1 ]; then
  src_config="$REPO_ROOT/dev/ha_config_for_dev.yaml"
else
  src_config="$REPO_ROOT/examples/configuration.yaml"
fi
if [ -f "$src_config" ]; then
  info "Deploying $(basename "$src_config") -> $remote_cfg/configuration.yaml ..."
  docker exec "$CONTAINER" sh -lc \
    "mkdir -p '$remote_cfg'; [ -f '$remote_cfg/configuration.yaml' ] && cp -f '$remote_cfg/configuration.yaml' '$remote_cfg/configuration.yaml.bak' || true" >/dev/null
  docker cp "$src_config" "$CONTAINER:$remote_cfg/configuration.yaml" >/dev/null
else
  err "Config not found: $src_config (skipping)"
fi

info "Restarting container '$CONTAINER'..."
docker restart "$CONTAINER" >/dev/null
ok 'Restarted'

if [ "$START_HA" -eq 1 ]; then
  has_dev_py="$(docker exec "$CONTAINER" sh -lc '[ -x /home/vscode/.local/ha-venv/bin/python ] && echo yes || echo no' 2>/dev/null | tr -d '\r')"
  if [ "$has_dev_py" = "yes" ]; then
    info 'Starting Home Assistant inside container (dev venv)...'
    docker exec "$CONTAINER" sh -lc \
      '. /home/vscode/.local/ha-venv/bin/activate && cd /workspaces/home-assistant_core && nohup python -m homeassistant --config config >config/ha.out 2>&1 &' >/dev/null
  else
    info 'Skipping manual HA start (managed by container supervisor).'
  fi
  [ "$SLEEP_AFTER" -gt 0 ] && sleep "$SLEEP_AFTER"
fi

if [ "$INIT_ENTRY" -eq 1 ]; then
  if [ -z "${HA_TOKEN:-}" ] || [ -z "${HA_BASE_URL:-}" ]; then
    info 'Skipping config entry init (HA_TOKEN/HA_BASE_URL not set).'
  else
    sleep 2
    info 'Initialising HAventory config entry via WS...'
    py "$REPO_ROOT/scripts/ws_init_haventory.py" || err 'WS init failed (is HA up and reachable?)'
  fi
fi

if [ "$TAIL_LOGS" -eq 1 ]; then
  [ "$SLEEP_AFTER" -gt 0 ] && sleep "$SLEEP_AFTER"
  info 'Recent logs (filtered by haventory)...'
  docker logs "$CONTAINER" --since 2m 2>&1 | grep -i haventory || true
fi

ok 'Done.'

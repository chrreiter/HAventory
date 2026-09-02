#!/usr/bin/env bash
# Run Home Assistant with HAventory (+ HACS) against the working tree.
#
# Brings up a real Home Assistant (current stable on Python 3.14, provisioned by
# uv) with the integration symlinked in, so edits are picked up on restart. This
# runs current stable, not the declared floor — the floor is what the phacc suite
# pins. Requires network access.
#
# Home Assistant lives in its own environment, .venv-ha/ (git-ignored), never in
# the offline .venv — the split scripts/test_integration.sh makes for
# .venv-integration, for the same reason. It also has to outlive one run: the
# requirements Home Assistant installs for its own components at startup land in
# the environment `hass` runs from, and a throwaway one (`uv run --with`) makes
# every start install them again. `hass` is installed once; delete .venv-ha/ to
# move to a newer stable.
#
# The config directory is .ha-config/ at the repository root (git-ignored;
# HA_CONFIG_DIR overrides it). A first run creates it with Home Assistant's own
# default set of files and then puts dev/ha_config_for_dev.yaml in as
# configuration.yaml — the file scripts/reload_addon.sh deploys, so HAventory
# logs at debug here too. From there Home Assistant is set up in the browser:
# onboarding, then Settings → Devices & services → Add integration.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${HA_CONFIG_DIR:-$ROOT/.ha-config}"
HA_VENV="${HA_VENV:-$ROOT/.venv-ha}"
PY_VER="${HA_PYTHON:-3.14}"
HASS="$HA_VENV/bin/hass"

if [ ! -x "$HASS" ]; then
  # uv refuses to `--clear` a directory that is not a virtual environment and
  # points at `--force`, which removes whatever HA_VENV names — a path this
  # script does not own, since HA_VENV is overridable. A directory here without
  # a pyvenv.cfg is therefore the operator's to remove, and saying which one it
  # is beats a hint that deletes it. A half-built environment still has that
  # file, so the interrupted install this branch exists for is still cleared.
  if [ -e "$HA_VENV" ] && [ ! -f "$HA_VENV/pyvenv.cfg" ]; then
    echo "[develop] $HA_VENV exists and is not a virtual environment." >&2
    echo "[develop] Remove it, or point HA_VENV somewhere else, and run this again." >&2
    exit 1
  fi
  echo "[develop] Installing current stable Home Assistant into $HA_VENV ..."
  uv venv --clear --python "$PY_VER" "$HA_VENV"
  uv pip install --python "$HA_VENV/bin/python" homeassistant
fi

mkdir -p "$CONFIG/custom_components"

# Symlink the integration so a restart picks up local changes.
ln -sfn "$ROOT/custom_components/haventory" "$CONFIG/custom_components/haventory"

# The HACS installer below finds the config directory by the `.HA_VERSION` file
# Home Assistant writes beside configuration.yaml, so on an empty directory it
# finds nothing and HACS would only land on the second run. `ensure_config`
# writes the default set (configuration.yaml, automations.yaml, scripts.yaml,
# scenes.yaml, secrets.yaml, .HA_VERSION) and touches nothing that exists.
if [ ! -f "$CONFIG/configuration.yaml" ]; then
  echo "[develop] Creating a default configuration in $CONFIG ..."
  "$HASS" --script ensure_config --config "$CONFIG"
  cp "$ROOT/dev/ha_config_for_dev.yaml" "$CONFIG/configuration.yaml"
fi

# Install HACS into the config if not already present (official installer).
if [ ! -d "$CONFIG/custom_components/hacs" ]; then
  echo "[develop] Installing HACS..."
  ( cd "$CONFIG" && wget -q -O - https://get.hacs.xyz | bash - ) \
    || echo "[develop] HACS install failed; continuing without it."
fi

# Build the Lovelace card. It lands in custom_components/haventory/www/, which
# the symlink above already exposes to Home Assistant — nothing to copy.
echo "[develop] Building card..."
( cd "$ROOT/cards/haventory-card" && npm ci --no-audit --no-fund && npm run build )

echo "[develop] Starting Home Assistant at http://localhost:8123 ..."
# A restart asked for in the UI ends the process with exit code 100 and expects
# whatever started it to start it again — which is also how an edited module is
# picked up without leaving this script.
while :; do
  status=0
  "$HASS" --config "$CONFIG" || status=$?
  [ "$status" -eq 100 ] || exit "$status"
  echo "[develop] Restart requested; starting Home Assistant again..."
done

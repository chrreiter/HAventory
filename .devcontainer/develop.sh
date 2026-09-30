#!/usr/bin/env bash
# Run Home Assistant with HAventory (+ HACS) against the working tree.
#
# Brings up a real Home Assistant (current stable on Python 3.14, provisioned by
# uv) with the integration symlinked in, so edits are picked up on restart. This
# is current stable, not the declared floor. Requires network access.
#
# HA lives in .venv-ha/ (git-ignored), never in the offline .venv, and persists
# across runs so the component requirements it installs at startup are not
# reinstalled each time. Delete .venv-ha/ to move to a newer stable.
#
# The config directory is .ha-config/ (git-ignored; HA_CONFIG_DIR overrides it).
# A first run creates it and installs dev/ha_config_for_dev.yaml (the file
# scripts/reload_addon.sh deploys) as configuration.yaml. Then set HA up in the
# browser.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${HA_CONFIG_DIR:-$ROOT/.ha-config}"
HA_VENV="${HA_VENV:-$ROOT/.venv-ha}"
PY_VER="${HA_PYTHON:-3.14}"
HASS="$HA_VENV/bin/hass"

if [ ! -x "$HASS" ]; then
  # uv's hint for a non-venv directory is `--force`, which would delete whatever
  # the overridable HA_VENV names. A half-built venv still has pyvenv.cfg and is cleared.
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

ln -sfn "$ROOT/custom_components/haventory" "$CONFIG/custom_components/haventory"

# The HACS installer finds the config directory by `.HA_VERSION`, which
# `ensure_config` writes (with the default files) and never overwrites.
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

# The build lands in custom_components/haventory/www/, already exposed by the symlink.
echo "[develop] Building card..."
( cd "$ROOT/cards/haventory-card" && npm ci --no-audit --no-fund && npm run build )

echo "[develop] Starting Home Assistant at http://localhost:8123 ..."
# A restart asked for in the UI exits with code 100 and expects a restart.
while :; do
  status=0
  "$HASS" --config "$CONFIG" || status=$?
  [ "$status" -eq 100 ] || exit "$status"
  echo "[develop] Restart requested; starting Home Assistant again..."
done

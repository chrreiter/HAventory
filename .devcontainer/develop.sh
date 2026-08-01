#!/usr/bin/env bash
# Run Home Assistant with HAventory (+ HACS) against the working tree.
#
# Brings up a real Home Assistant (current stable on Python 3.14, provisioned by
# uv) with the integration symlinked in, so edits are picked up on restart. This
# runs current stable, not the declared 2026.6.0 floor — the floor is what the
# phacc suite pins. Requires network access.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${HA_CONFIG_DIR:-$ROOT/.ha-config}"
PY_VER="${HA_PYTHON:-3.14}"

mkdir -p "$CONFIG/custom_components"

# Symlink the integration so a restart picks up local changes.
ln -sfn "$ROOT/custom_components/haventory" "$CONFIG/custom_components/haventory"

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

echo "[develop] Starting Home Assistant (Python $PY_VER) at http://localhost:8123 ..."
exec uv run --python "$PY_VER" --with homeassistant hass --config "$CONFIG"

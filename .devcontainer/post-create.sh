#!/usr/bin/env bash
# Devcontainer bootstrap: the repository's own setup (uv sync, card deps,
# pre-commit hooks), then the offline suite, so a container that comes up green
# is one the gate can be run in. A real HA with HACS is .devcontainer/develop.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

# A workspace bind-mounted from the host can belong to a different user than the
# one the container runs as, and git then refuses the repository outright — which
# fails `pre-commit install` below and every test that reads `git ls-files`. The
# exception is scoped to this checkout.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "[post-create] Marking $PWD as a safe git directory (owned by another user)..."
  git config --global --add safe.directory "$PWD"
fi

bash scripts/setup.sh

echo "[post-create] Verifying the offline suite runs..."
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q

echo "[post-create] Done. Run HA + HACS locally with: bash .devcontainer/develop.sh"

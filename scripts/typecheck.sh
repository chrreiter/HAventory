#!/usr/bin/env bash
# Type-check the integration against the real Home Assistant at the declared floor.
#
# mypy runs from the locked dev environment, and `python_executable` in
# pyproject.toml points its import resolution at .venv-integration, which holds
# the Home Assistant release requirements-integration.txt pins. This builds or
# refreshes that environment first (a no-op once it is current), then runs mypy.
# Extra args are forwarded to mypy.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

ensure_integration_venv
info 'Backend: mypy against the real Home Assistant...'
mypy_run "$@"
ok 'mypy OK'

#!/usr/bin/env bash
# Run the full local gate: backend lint + types + tests (with coverage), then
# frontend install + audit + lint + types + tests + build. Mirrors the CI pipeline.
source "$(dirname "$0")/common.sh"

cd "$REPO_ROOT"

info 'Backend: ruff check...'
ruff_run check .

info 'Backend: ruff format --check...'
ruff_run format --check .

info 'Backend: mypy...'
mypy_run

info 'Backend: offline tests with coverage...'
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest_run -q -p pytest_cov \
  --cov=custom_components/haventory \
  --cov-report=term-missing:skip-covered \
  --cov-report=xml --cov-report=html \
  --junitxml=junit.xml

if [ -f coverage.xml ]; then
  rate="$(py - <<'PY'
import xml.etree.ElementTree as ET
try:
    root = ET.parse("coverage.xml").getroot()
    print(f"{100 * float(root.get('line-rate', 0)):.2f}")
except Exception:
    print("n/a")
PY
)"
  info "Backend coverage: ${rate}% (HTML: htmlcov/index.html)"
fi

if command -v npm >/dev/null 2>&1; then
  info 'Frontend: install, audit, lint, types, test, build...'
  (cd "$CARD_DIR" && npm ci --no-audit --no-fund && npm audit --audit-level=moderate \
    && npm run lint && npm run typecheck && npm test -- --coverage && npm run build)
else
  err 'npm not found; skipping frontend tasks.'
fi

ok 'Local CI completed.'

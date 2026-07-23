# HAventory

[![CI](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml)
[![CodeQL](https://github.com/chrreiter/HAventory/actions/workflows/codeql.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/chrreiter/HAventory/badge)](https://securityscorecards.dev/viewer/?uri=github.com/chrreiter/HAventory)
[![HACS: Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: Apache-2.0](https://img.shields.io/github/license/chrreiter/HAventory)](LICENSE)

Home Assistant custom integration (domain `haventory`) for household inventory tracking,
plus a Lit + TypeScript Lovelace card. Local-push, single-instance, HA `Store`-backed
persistence — no external services.

**Targets:** Linux dev + `ubuntu-latest` CI. Minimum Home Assistant **2026.7** ⇒ Python
**3.14** everywhere (uv provisions the interpreter automatically; the source uses 3.14-only
PEP 758 syntax). Node **22.13+ / 24 LTS** for the card.

---

## Installation

HAventory isn't in the HACS default store yet. To install from this repository:

1. In Home Assistant, open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/chrreiter/HAventory` with category **Integration**.
3. Install **HAventory**, then restart Home Assistant.
4. Add it via **Settings → Devices & Services → Add Integration → HAventory**.
5. Refresh your browser (Ctrl/Cmd+Shift+R) so the Lovelace card appears in the picker.

Minimum Home Assistant version: **2026.7**. Developers: see the Developer Checklist below
and [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Developer Checklist

Use this checklist when working on HAventory. Keep it up to date if conventions change.

### Setup (Linux/bash)

Prereqs: [uv](https://docs.astral.sh/uv/), Node 22.13+ (or 24 LTS), git.

```bash
# One-shot bootstrap: uv env + card deps + pre-commit hooks
scripts/setup.sh

# ...or manually:
uv sync                                   # creates .venv from pyproject.toml + uv.lock
(cd cards/haventory-card && npm ci)       # reproducible install from the committed lockfile
```

Run any Python tool through uv (`uv run <tool>`), so it uses the locked dev environment.

### Tooling

- **uv** — Python env, dependency resolution, and lockfile (`uv.lock`). Dev deps live in
  `pyproject.toml` under `[dependency-groups]`; `requirements-dev.txt` is a generated,
  pip-installable export kept for environments without uv.
- **Ruff** `0.15.x` — lint + format, configured in `pyproject.toml`.
- **mypy** `2.x` — type checking (non-strict baseline; scoped to `custom_components/haventory`).
- **ESLint** `10` (flat config `cards/haventory-card/eslint.config.js`) + `@typescript-eslint 8`.
- **TypeScript** `6`, **Vite** `8`, **Vitest** `4` (+ `@vitest/coverage-v8`) for the card.
- **pre-commit** — ruff, codespell, basic hooks.

### The gate (run before every commit — both halves must be green)

```bash
# Backend
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run mypy

# Frontend (in cards/haventory-card)
npx eslint .
npx vitest run
npm run build
```

Or all at once: `scripts/ci_local.sh` (backend lint + types + tests w/ coverage, then
frontend install + lint + test + build). Lint only: `scripts/lint.sh`. Backend tests
only: `scripts/test.sh`. Frontend tests: `scripts/test_frontend.sh [--coverage|--watch]`.

### Testing

There are two backend test modes, kept deliberately separate:

- **Offline (fast, default).** HA is stubbed in `tests/conftest.py`, so the suite runs
  in milliseconds with no HA install. Invoke with plugin autoload disabled; async tests
  use `@pytest.mark.asyncio`:

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
  ```

- **In-process HA integration (opt-in).** Runs the integration inside a *real* Home
  Assistant core via [`pytest-homeassistant-custom-component`][phacc] (phacc), catching
  drift against real HA APIs the stubs can't see. See below.

Every feature/fix ships with tests — happy path plus at least one edge/error case.

[phacc]: https://github.com/MatthewFlamm/pytest-homeassistant-custom-component

#### In-process HA integration tests (opt-in)

These load a genuine HA core, so they need **Python 3.14** and a full HA install
(phacc, from `requirements-integration.txt` — kept out of `pyproject`/`uv.lock` and the
offline `.venv` so the fast suite stays lean). They live under `tests/integration/` and
run with plugin autoload **on** (phacc must load) in pytest-asyncio's auto mode.

```bash
# One-shot: provisions Python 3.14 + a dedicated .venv-integration, then runs them
scripts/test_integration.sh

# ...or manually:
uv venv --python 3.14 .venv-integration
uv pip install --python .venv-integration/bin/python -r requirements-integration.txt
.venv-integration/bin/python -m pytest -o asyncio_mode=auto tests/integration
```

Do **not** set `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` for this mode. `tests/conftest.py`
detects the real `homeassistant` package these tests pull in and installs none of the
offline stubs, so the two modes never collide; the offline run never collects
`tests/integration/`. Covered: config-entry setup/unload, WebSocket item CRUD end-to-end,
Store persistence round-trip, and `haventory/areas/list` against the real area registry.

> Restricted-egress environments (e.g. sandboxes that can't fetch Python 3.14 or the HA
> core) can't run this mode — CI provisions 3.14 and runs it in its own job.

#### Online smoke tests (opt-in)

These hit a real Home Assistant instance over WebSocket. Require env vars:

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
scripts/smoke_online.sh
# or: uv run pytest -q -m online -k "ws_smoke or ws_smoke_advanced"
```

Area-registry e2e (optional; temporarily mutates your HA instance):

```bash
export HA_ALLOW_AREA_MUTATIONS=1
uv run pytest -q -m online -k ws_areas_online
```

Included: `tests/test_ws_smoke_online.py`, `tests/test_ws_smoke_advanced_online.py`,
`tests/test_ws_areas_online.py`.

#### Coverage

- Backend: `scripts/ci_local.sh` produces `coverage.xml` + browsable `htmlcov/index.html`.
- Frontend: `scripts/test_frontend.sh --coverage` (report at `cards/haventory-card/coverage/`).

### Backend (custom component)

- `custom_components/haventory/` with `manifest.json`, `__init__.py`, `config_flow.py`, `services.yaml`.
- Store: `hass.data[DOMAIN]["store"]` with versioned schema and safe writes.
- Persistence architecture:
  - **WebSocket / service handlers**: immediate saves via `async_persist_repo` — storage
    errors propagate to clients as `storage_error`.
  - **Shutdown/unload**: immediate save via `async_persist_immediate`.
  - **Debounced saves**: `async_request_persist` for batch/internal operations only.
  - **Concurrency**: all persist paths use `asyncio.Lock` to serialize writes.
- Repository generation counter increments on every state modification (optimistic locking/debugging).
- WebSocket-first CRUD via `homeassistant.components.websocket_api` decorators.
- Services via `hass.services.async_register` with `voluptuous` schemas; handlers re-raise
  validation/repository/storage errors so HA surfaces them.
- Areas via `homeassistant.helpers.area_registry.async_get(hass)`; never auto-create areas.
- Case-insensitive search; denormalized `location_path` on items; item `version` for optimistic concurrency.

### Frontend (Lovelace card)

- Lit + TypeScript + Vite; tests with Vitest. Build outputs to `www/haventory/`.
- Real-time via WebSocket; optimistic UI; virtualization for large lists.
- Sorting by name, updated, created, quantity, **due date**, and **inspection date**
  (date sorts place undated items last); filters include checked-out, low-stock-first,
  and **"No location"** (orphaned items).
- Location management in the picker: create, rename, re-area, **delete** (backend
  rejects deleting non-empty locations — the card explains how to proceed), and
  **move a whole subtree** to a new parent, with descendant paths updating live.
- Expanded view includes a diagnostics panel with **storage health**
  (`haventory/health`: status, issues, generation) and a refresh action.
- Card auto-registered as a Lovelace resource on integration setup.
- **Note:** after first install, a browser refresh (F5 / Ctrl+Shift+R) is required for the
  card to appear in the picker (standard for all custom cards).

### CI/CD & Ops

- GitHub Actions (`ubuntu-latest`): backend (uv, ruff + mypy + pytest w/ coverage, Python
  3.14), a dedicated **integration** job (in-process HA via phacc, Python 3.14),
  frontend (eslint + vitest + build, Node 22/24 matrix), actionlint,
  hassfest + HACS validation, CodeQL, OpenSSF Scorecard, and dependency review.
  Third-party actions are SHA-pinned; first-party `actions/*` use `@v7`.
- PR hygiene: Conventional-Commit PR-title check, path-based auto-labeling
  (`.github/labeler.yml`), labels-as-code (`.github/labels.yml`), CODEOWNERS review
  requests, and issue/PR templates.
- Dependabot: grouped updates for `github-actions`, `npm` (card), and `uv` (Python).
- Release automation via **release-please** is config-ready but deferred (WP5) — enable it
  by uncommenting the `push` trigger in `.github/workflows/release-please.yml`.
- Contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md).
- Conventional Commits; update this README when behavior changes.

---

## Reproducible dev environment (.devcontainer)

Open the repo in VS Code / GitHub Codespaces and "Reopen in Container" for a ready-to-go
environment (uv + Node 24). `post-create` runs `uv sync`, installs card deps, and verifies
the offline suite. To bring up a real Home Assistant with HACS against the working tree
(WP4 E2E), run `bash .devcontainer/develop.sh` (needs network; provisions Python 3.14).

---

## Implementation Status

### ✅ Phase 1: Backend & WebSocket API (Complete)
- Full CRUD for Items and Locations via WebSocket; optimistic concurrency with versioning;
  Areas integration; real-time subscriptions (items, locations, stats); documented persistence.
- `haventory/distinct_values` returns distinct categories and tags with usage counts
  (categories grouped case-insensitively) — powers category/tag autocomplete and browser views.

### ✅ Phase 2: Frontend Lovelace Card (Complete)
- Lit 3 + TypeScript components (`haventory-card`, `hv-search-bar`, `hv-inventory-list`,
  `hv-item-row`, `hv-item-dialog`, `hv-location-selector`); real-time sync; optimistic
  updates with conflict resolution; Vite build → `www/haventory/haventory-card.js`.

### 🚧 Phase 3: Polish & HACS (Planned)
- HACS publication; release automation (release-please); additional optimizations.

---

## Dev helper scripts

All scripts are Linux/bash under `scripts/` (the former `.ps1` scripts were retired in WP1).

### Reload into a running HA dev container

```bash
scripts/reload_addon.sh --container <your_container> --tail-logs
# deploy examples/configuration.yaml instead of the dev config: add --examples-config
```

### WebSocket helper scripts (cross-platform Python)

Quick probes/subscriptions without writing test code. Run via `uv run python scripts/<name>.py`.

`scripts/ws_probe.py` — send a single WS command and print the first reply:

```bash
export HA_TOKEN=<token>            # HA_BASE_URL defaults to http://localhost:8123
export HAV_MSG='{"id":1,"type":"haventory/ping","echo":"hi"}'
uv run python scripts/ws_probe.py
```

`scripts/ws_subscribe.py` — subscribe to a topic (`items` | `locations` | `stats`) and
print events. Optional: `HAV_LOCATION_ID`, `HAV_INCLUDE_SUBTREE`, `HAV_MAX_EVENTS`,
`HAV_MUTATIONS` (JSON array of WS messages to send after subscribing):

```bash
export HA_TOKEN=<token>
export HAV_TOPIC=items HAV_MAX_EVENTS=3
uv run python scripts/ws_subscribe.py
```

### Backend stress testing

`scripts/stress_test.py` validates persistence/concurrency against a Docker-based HA
instance. Requires `HA_CONTAINER`, `HA_BASE_URL`, `HA_TOKEN`:

```bash
export HA_CONTAINER=home-assistant HA_BASE_URL=http://localhost:8123 HA_TOKEN=<token>
uv run python scripts/stress_test.py                          # full run (deploy + test)
uv run python scripts/stress_test.py --skip-deploy --skip-confirm  # quick re-run
```

Scenarios: rapid sequential mutations, concurrent burst, bulk-under-load, mixed workload,
persistence-across-restart. Exit codes: `0` pass, `1` failures, `2` setup error.

---

## Contributing

Contributions are welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)**. File bugs and feature
requests through the [issue tracker](https://github.com/chrreiter/HAventory/issues/new/choose),
and ask questions in [Discussions](https://github.com/chrreiter/HAventory/discussions).

## Conventions

- Domain/package: `haventory` under `custom_components/haventory`; services `haventory.*`;
  built assets `www/haventory/`; calendar entity `calendar.haventory`.
- Logging: avoid reserved `LogRecord` keys in logger extras — use `item_name` /
  `location_name`, not `name`.

## Developer docs

- WebSocket API contract: `docs/backend_api_contract.md`
- Data shapes (Item/Location/filter/sort/events): `docs/data_shapes.md`
- Frontend architecture: `docs/frontend_architecture.md`

## Troubleshooting

- Container logs: `docker logs -f <container>` (or `-n 200` for recent)
- HA log file (if enabled): `/config/home-assistant.log` inside the container
- HAventory storage file: `/config/.storage/haventory_store`

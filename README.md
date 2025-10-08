## HAventory — Developer Checklist

Use this checklist when working on HAventory. Keep it up to date if conventions change.

### Setup
- [ ] Windows-first (PowerShell); provide macOS/Linux fallbacks in scripts/CI; Python 3.12; Home Assistant ≥ 2024.8
- [ ] Create venv: `python -m venv .venv` and activate: `\.venv\Scripts\Activate.ps1`
- [ ] `python -m pip install -U pip`
- [ ] Install dev deps: `pip install -r requirements-dev.txt` (or run `scripts/setup.ps1` to bootstrap venv, deps, and install pre-commit hooks)
- [ ] Frontend: Node 20 (pinned via engines); install with `npm ci` in `cards/haventory-card`

### Tooling
- [ ] Ruff configured via `pyproject.toml` (Python 3.12 target; import sorting, pyupgrade, security, etc.).
- [ ] Pre-commit hooks (optional): install via `pre-commit install` or `scripts/setup.ps1`.
- [ ] Frontend ESLint v9 using flat config `cards/haventory-card/eslint.config.js`.
- [ ] Vitest configured with coverage (v8) in `cards/haventory-card/vite.config.ts`.

### Testing
- [ ] Default to offline tests; disable plugin autoload: `$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; pytest -q`
- [ ] Async tests use `@pytest.mark.asyncio`; HA stubs in `tests/conftest.py`.
- [ ] Edge cases covered; errors log context; coverage ≥ target.
- [ ] Optional: integration smoke tests (pytest-homeassistant-custom-component).

#### Online smoke tests (optional)
These tests hit a real Home Assistant instance over WebSocket. They are opt-in and require environment variables.

- Prereqs: Home Assistant running, long-lived token, venv activated
- Set env and run (PowerShell):

```powershell
$env:RUN_ONLINE = '1'
$env:HA_BASE_URL = 'http://localhost:8123'
$env:HA_TOKEN = '<your-long-lived-token>'
pytest -q -m online -k "ws_smoke or ws_smoke_advanced"
Remove-Item Env:\RUN_ONLINE
```

Included smoke tests:
- `tests/test_ws_smoke_online.py` — Phase-0 ping/version/stats + Phase-1 locations CRUD tree/validation
- `tests/test_ws_smoke_advanced_online.py` — Phase-3 bulk mixed/all-failure flows

#### Coverage
- Backend (pytest-cov):
  - Local quick run: `scripts\ci_local.ps1` (produces `coverage.xml` and browsable `htmlcov\index.html`).
  - Manual: `$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; pytest -q --cov=custom_components/haventory --cov-report=term-missing:skip-covered --cov-report=xml --cov-report=html`.
- Frontend (Vitest):
  - In `cards/haventory-card`: `npm test -- --coverage` (opens `coverage/index.html`).

### Backend (custom component)
- [ ] `custom_components/haventory/` with `manifest.json`, `__init__.py`, `config_flow.py`, `services.yaml`
- [ ] Store: `hass.data[DOMAIN]["store"]` with versioned schema and safe writes
- [ ] WebSocket-only CRUD via `homeassistant.components.websocket_api` decorators (production). For local tooling, an optional dev-only HTTP shim may be enabled behind an env flag.
- [ ] Services via `hass.services.async_register` with `voluptuous` schemas
- [ ] Areas via `hass.helpers.area_registry.async_get(hass)`; do not auto-create areas
- [ ] Summary sensors via `DataUpdateCoordinator` + `CoordinatorEntity`
- [ ] Calendar entity via `CalendarEntity`; implement `async_get_events`
- [ ] Single device in device registry (`device_info`); stable `unique_id` for entities
- [ ] Case-insensitive search; denormalized `location_path` on items
- [ ] Checkout: boolean + optional `due_date` (no quantity decrement)
- [ ] History retention: 20 per item; global 1000 FIFO, keep ≥1 per item; exclude reminder events from retention counts

### Frontend (Lovelace card)
- [ ] Lit + TypeScript + Vite; tests with Vitest
- [ ] Build outputs to `www/haventory/`
- [ ] Real-time via WebSocket; optimistic UI; virtualization for large lists
- [ ] MVP: direct search; filters/sorts later; location tree selector; check-in/out actions

### Notifications & Scheduling
- [ ] Notifications via `notify.notify`; title-only by default
- [ ] Calendar defaults: entity `calendar.haventory`; all-day; title `Inspect {item_name}`
- [ ] Reminders: intervals days/weeks/months; rely on HA for offline catch-up

### CI/CD & Ops
- [ ] GitHub Actions: hassfest, HACS validation (no publish until Phase 3), Ruff, pytest (offline) with coverage and artifacts, frontend lint/test/coverage/build, CodeQL.
- [ ] CI coverage summary is added to the job summary; artifacts (`coverage.xml`, `junit.xml`, `htmlcov/**`, frontend `coverage/**`) are uploaded.
- [ ] Dependabot enabled for GitHub Actions, npm (card), and pip dev deps.
- [ ] Release automation planned via Release Please (see roadmap “Phase: Polish”).
- [ ] Conventional Commits; update README and `roadmap/implementation_roadmap.md` before merging a PR (add an entry under `## Changelog`).
- [ ] Backups: Store data included in HA snapshots; document restore behavior.
- [ ] Translations under `translations/` (EN initial); strings externalized.

### Dev add-on loop
## Phase 0 usage guide

### 1) Bootstrap and lint/test
- Clone repo and open PowerShell in the repo root
- Run `scripts/setup.ps1` (installs venv deps)
- Lint: `scripts/lint.ps1`
- Local CI (lint + tests + coverage + frontend): `scripts/ci_local.ps1`

### 2) Frontend card
- Build: `scripts/build_frontend.ps1` (skips if npm not on PATH)
- Output is written to `www/haventory/haventory-card.js`

### 3) Dev add-on workflow (optional)
- Reload HA dev container and deploy config/integration (explicit container name required):
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\reload_addon.ps1 -ContainerName <your_container> -UseDevConfig:$true -TailLogs:$true -SleepSecondsAfterRestart 8`

### 4) CI
- GitHub Actions runs: backend lint/tests/coverage (Windows), frontend lint/test/coverage/build (Ubuntu), hassfest/HACS validation, CodeQL.

### 5) Conventions
- Domain/package: `haventory` under `custom_components/haventory`
- Services: `haventory.*`
- Built assets: `www/haventory/`
- Calendar entity id: `calendar.haventory`
- Logging: Avoid reserved LogRecord keys in logger extras; use `item_name`/`location_name` instead of `name` in logging context

### Developer docs

- WebSocket API contract: `docs/backend_api_contract.md`
- Data shapes (Item/Location/filter/sort/events): `docs/data_shapes.md`

- [ ] Use `scripts/reload_addon.ps1 -ContainerName <your_container> -UseDevConfig:$true -TailLogs:$true -SleepSecondsAfterRestart 8`
- [ ] When `-UseDevConfig:$false`, deploy `examples\configuration.yaml`

### WebSocket helper scripts

Quick probes and subscriptions without writing test code.

1) `scripts/ws_probe.py` — send a single WS command and print the first reply

Environment (PowerShell):
- `HA_BASE_URL` (default `http://localhost:8123`)
- `HA_TOKEN` (required)
- `HAV_MSG` (required; JSON string)

Examples:
```powershell
$env:HAV_MSG = '{"id":1,"type":"haventory/ping","echo":"hi"}'
python .\scripts\ws_probe.py

$env:HAV_MSG = '{"id":2,"type":"haventory/version"}'
python .\scripts\ws_probe.py
```

2) `scripts/ws_subscribe.py` — subscribe to a topic and print events/results

Environment (PowerShell):
- `HA_BASE_URL`, `HA_TOKEN`
- `HAV_TOPIC` = `items` | `locations` | `stats`
- Optional: `HAV_LOCATION_ID`, `HAV_INCLUDE_SUBTREE` (for `locations`), `HAV_MAX_EVENTS` (default 5)
- Optional: `HAV_MUTATIONS` (JSON array of WS messages to send after subscribing)

Examples:
```powershell
# Items topic with two mutations, stop after 3 frames
$env:HAV_TOPIC = 'items'
$env:HAV_MAX_EVENTS = '3'
$env:HAV_MUTATIONS = '[{"id":101,"type":"haventory/item/create","name":"Bananas"},{"id":102,"type":"haventory/item/delete","item_id":"<id>"}]'
python .\scripts\ws_subscribe.py

# Subtree-filtered locations
$env:HAV_TOPIC = 'locations'
$env:HAV_LOCATION_ID = '<root-location-uuid>'
$env:HAV_INCLUDE_SUBTREE = 'true'
$env:HAV_MAX_EVENTS = '4'
python .\scripts\ws_subscribe.py
```

### Logs and troubleshooting
- Container logs: `docker logs -f <container>` (or `-n 200` for recent)
- HA log file (if enabled): `/config/home-assistant.log` inside the container
- HAventory storage file: `/config/.storage/haventory_store`

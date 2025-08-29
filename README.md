## HAventory — Developer Checklist

Use this checklist when working on HAventory. Keep it up to date if conventions change.

### Setup
- [ ] Windows-first (PowerShell); provide macOS/Linux fallbacks in scripts/CI; Python 3.12; Home Assistant ≥ 2024.8
- [ ] Create venv: `python -m venv .venv` and activate: `\.venv\Scripts\Activate.ps1`
- [ ] `python -m pip install -U pip`
- [ ] Install dev deps: `pip install pytest ruff pre-commit`
- [ ] Run `scripts/setup.ps1` to bootstrap venv, deps, and install pre-commit hooks (non-CI)
- [ ] Frontend: Node 20 (pinned via engines); enable corepack if needed; install per `packageManager` (`npm ci` here) in `cards/haventory-card`

### Tooling
- [ ] Pre-commit hooks enabled (ruff, codespell, yaml, eof, trailing whitespace). Install via `pre-commit install` or `scripts/setup.ps1`.
- [ ] Ruff lint clean; type-check if enabled; Vitest/ESLint clean for frontend

### Testing
- [ ] Default to offline tests; disable plugin autoload: `$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; pytest -q`
- [ ] `pytest.ini` disables `socket` and `homeassistant_custom_component` plugins by default to avoid IDE auto-loaded plugin interference on Windows
- [ ] Async tests use `@pytest.mark.asyncio`
- [ ] HA stubs in `tests/conftest.py` (minimal `homeassistant` modules)
- [ ] Edge cases covered; errors log context; coverage ≥ target
- [ ] Optional: integration smoke tests (pytest-homeassistant-custom-component)

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
- [ ] GitHub Actions: hassfest, HACS validation (no publish until Phase 3), ruff, pytest (offline), frontend lint/test/build, CodeQL, Release Please
- [ ] Conventional Commits; changelog via Release Please
- [ ] README and `roadmap/implementation_roadmap.md` updated before merging a PR; roadmap edits include entry under `## Changelog`
- [ ] Backups: Store data included in HA snapshots; document restore behavior
- [ ] Translations under `translations/` (EN initial); strings externalized

### Dev add-on loop
## Phase 0 usage guide

### 1) Bootstrap and lint/test
- Clone repo and open PowerShell in the repo root
- Run `scripts/setup.ps1` (installs venv deps)
- Lint: `scripts/lint.ps1`
- Tests (offline): `scripts/test.ps1`

### 2) Frontend card
- Build: `scripts/build_frontend.ps1` (skips if npm not on PATH)
- Output is written to `www/haventory/haventory-card.js`

### 3) Dev add-on workflow (optional)
- Reload HA dev container and deploy config/integration (explicit container name required):
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\reload_addon.ps1 -ContainerName <your_container> -UseDevConfig:$true -TailLogs:$true -SleepSecondsAfterRestart 8`

### 4) CI
- GitHub Actions runs: backend lint/tests (Windows), frontend lint/test/build (Ubuntu), hassfest/HACS validation

### 5) Conventions
- Domain/package: `haventory` under `custom_components/haventory`
- Services: `haventory.*`
- Built assets: `www/haventory/`
- Calendar entity id: `calendar.haventory`

- [ ] Use `scripts/reload_addon.ps1 -ContainerName <your_container> -UseDevConfig:$true -TailLogs:$true -SleepSecondsAfterRestart 8`
- [ ] When `-UseDevConfig:$false`, deploy `examples\configuration.yaml`

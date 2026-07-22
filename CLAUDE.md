# CLAUDE.md

Guidance for Claude Code when working in the HAventory repository.

## What this is

HAventory is a Home Assistant **custom integration** (domain `haventory`) for household
inventory tracking, plus a Lovelace **card** frontend. Local-push, single-instance, HA
`Store`-backed persistence — no external services.

Targets: minimum Home Assistant is a recent stable release (2026.x era; no legacy support),
Python 3.12 (`pyproject.toml` ruff `target-version = py312`, CI Python 3.12), Node 20
(`engines: node >=20 <23`). Version 0.0.1, unreleased.

## Architecture & key files

### Backend — `custom_components/haventory/`
- `__init__.py` — integration setup/teardown, `hass.data[DOMAIN]` wiring, persistence helpers
  (`async_persist_repo`, `async_persist_immediate`, `async_request_persist`), Lovelace resource
  registration.
- `models.py` — `Item` / `Location` dataclasses, validation, serializers. Items carry a
  denormalized `location_path` (rebuilt on location changes) and a `version` int (starts at 1,
  bumped on each mutation) for **optimistic concurrency**.
- `repository.py` — in-memory indexed repository (the source of truth at runtime). Owns the
  search indexes; **search is case-insensitive** (casefold + NFKD accent-stripping) — see
  `_normalize_for_search`. Maintains a generation counter for optimistic locking / debugging.
- `storage.py` — HA `Store` persistence with schema versioning (`CURRENT_SCHEMA_VERSION`,
  `STORAGE_KEY = "haventory_store"`), plus `asyncio.Lock`-serialized writes.
- `migrations.py` — forward-only, **idempotent** schema migrations (`migrate_N_to_N+1`).
- `ws.py` — WebSocket-first CRUD API (`websocket_api` decorators) and subscriptions
  (items / locations / stats). This is the primary API surface.
- `services.py` / `services.yaml` — HA services (`haventory.*`) with voluptuous schemas; handlers
  re-raise validation/repository/storage errors so HA surfaces them.
- `areas.py` — HA area registry integration (read-only; never auto-creates areas).
- `config_flow.py` — single-instance config flow. `const.py`, `exceptions.py`, `manifest.json`,
  `strings.json`, `translations/`.

### Frontend — `cards/haventory-card/`
Lit 3 + TypeScript + Vite Lovelace card. Source in `src/` (`haventory-card` container,
`hv-*` components, `store/` for WS client + state). Builds to `www/haventory/haventory-card.js`
(git-ignored; produced in CI and by `npm run build`).

### Docs — `docs/` (link here, don't duplicate)
- `backend_api_contract.md` — WebSocket envelope, error taxonomy, command catalog, events.
- `data_shapes.md` — canonical Item/Location/filter/sort/event shapes.
- `frontend_architecture.md` — card component architecture.

## Running tests / lint / build (Linux)

Backend (repo root, venv activated):
```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest -q
ruff check .
```

Frontend (in `cards/haventory-card`):
```bash
npx eslint .
npx vitest run
npm run build
```

Bootstrap a fresh session (also run automatically by the SessionStart hook):
```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
(cd cards/haventory-card && npm ci)
```

Online smoke tests (`tests/*_online.py`) are opt-in and need a real HA instance plus
`RUN_ONLINE=1`, `HA_BASE_URL`, `HA_TOKEN` — see the README. Offline tests stub HA via
`tests/conftest.py`.

> The `scripts/*.ps1` files are **legacy** PowerShell tooling, slated for replacement in WP1.
> Develop and document for Linux/bash; leave the `.ps1` scripts (and the `windows-latest` CI
> job) untouched for now.

## Conventions

- **TDD**: every feature/fix ships with tests — happy path plus at least one edge/error case.
- **Gate before each commit**: run the backend gate *and* the frontend gate+build above; both
  must be green.
- **Offline-first testing**: default to offline tests with the plugin autoload disabled; HA is
  stubbed. Async tests use `@pytest.mark.asyncio`.
- **WebSocket API contract lives in `docs/`** — keep `ws.py`, `docs/backend_api_contract.md`,
  and `docs/data_shapes.md` in sync when the API changes.
- **Case-insensitive search** and **denormalized `location_path`** on items are load-bearing
  invariants — preserve them.
- **Optimistic concurrency** via the item `version` field — mutations expect/return it.
- **Conventional Commits**; small, focused commits. Update `README.md` when behavior changes.
- **Persistence**: WS and service handlers save immediately (errors propagate as
  `storage_error`); shutdown/unload flushes immediately; debounced saves are for internal/batch
  work only.
- **Logging**: avoid reserved `LogRecord` keys in `extra=` — use `item_name` / `location_name`,
  not `name`.
- Naming: domain/package `haventory`, services `haventory.*`, built assets `www/haventory/`,
  calendar entity `calendar.haventory`.
- Report out-of-scope findings under a "Follow-ups" note rather than fixing them.

See the README "Developer Checklist" for the full backend/frontend/CI checklist.

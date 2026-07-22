# CLAUDE.md

Guidance for Claude Code when working in the HAventory repository.

## What this is

HAventory is a Home Assistant **custom integration** (domain `haventory`) for household
inventory tracking, plus a Lovelace **card** frontend. Local-push, single-instance, HA
`Store`-backed persistence — no external services.

Targets: minimum Home Assistant is a recent stable release (2026.x era; no legacy support),
Python 3.12 (`pyproject.toml` ruff `target-version = py312`, CI Python 3.12), Node 20
(`engines: node >=20 <23`). Version 0.0.1, unreleased.

> **Superseded by WP0.5 (2026-07-22):** the Python target is now **3.14** (forced by HA
> ≥ 2026.3) and the min HA is **2026.7** — see the "HA / Python compatibility baseline"
> section below. The `py312` / CI-3.12 values above describe the *current* toolchain; the
> bump to 3.14 lands in WP1.

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

---

## HA / Python compatibility baseline (WP0.5, established 2026-07-22)

Established empirically (real HA installed in a throwaway venv + integration smoke-tested)
and by inspecting `home-assistant/core` at the `2026.7.3` tag. Sources: PyPI
`homeassistant` per-version `requires_python`; HA release blog 2026.1–2026.7; HA developer
blog.

- **Current stable HA:** `2026.7.3` (2026.7 series, released 2026-07-01).
- **HA Python floor:** **Python `>=3.14.2`**, bumped from 3.13 → **3.14 in HA 2026.3**
  (2026-03-04). Every HA release from 2026.3 onward requires Python 3.14. This is not
  optional: declaring a min HA of 2026.3+ forces Python 3.14 on the toolchain.

### Decisions to adopt at release (min HA + Python)

- **Minimum supported HA:** **`2026.7`** (current stable at review time; policy = "a recent
  stable release"). Re-confirm against whatever is current stable on the actual release date.
- **Python:** **`3.14`** (forced by HA ≥ 2026.3). Non-negotiable given the min-HA choice.

> Status: RECOMMENDED, pending owner confirmation of the exact min-HA number. The Python
> floor is determined by the min-HA choice and is not a free variable.

### Toolchain targets for WP1 (record now, change lands in WP1 — not WP0.5)

The min-HA/Python decision above implies these toolchain edits (do them in WP1):

- CI `.github/workflows/ci.yml` → `actions/setup-python` `python-version: '3.12'` → `'3.14'`.
- `pyproject.toml` `[tool.ruff]` `target-version = "py312"` → `"py314"`.
- mypy (when configured) `python_version = "3.14"`.
- Note: the offline test suite stubs HA and does not import real `homeassistant`, so the
  suite itself does not require Python 3.14 to run — but the declared support target does.

---

## HA compatibility review — findings (WP0.5)

Full report is in the WP0.5 session; the durable conclusions:

- **No breaking incompatibility** with current stable (2026.7.3) in any touch point.
  Verified compatible: `websocket_api` command registration + `@websocket_command` /
  `@async_response` decorators; `helpers.storage.Store(hass, version, key)`; config-entry
  lifecycle (`async_setup_entry` / `async_unload_entry`); `helpers.area_registry.async_get`;
  Lovelace resource auto-registration (`LOVELACE_DATA` + resource collection API unchanged
  despite the 2026.1 & 2026.6 dashboard overhauls); `manifest.json` keys (no newly-required
  key). Empirical smoke against real HA 2026.2.3 (last 3.13-compatible release): import +
  `async_setup_entry` + WS command + `async_unload_entry` all pass, 0 deprecation warnings.
- **Not affected** by the two 2026.6 config-entry deprecations: HAventory registers no
  config-entry update listener and uses no advanced-mode config flow.
- **Fixed (mechanical):** `config_flow.py` now annotates the flow step with
  `ConfigFlowResult` (HA's recommended type since 2024.4) instead of importing `FlowResult`.
- **Flagged for WP1 (not fixed — needs a small guarded change):** `storage.py` uses bare
  `asyncio.create_task(...)` for the debounced persist. HA guidance is to use hass/entry
  tracked task helpers (`hass.async_create_background_task(coro, name=...)`). Not a
  deprecation and not broken (the task ref is held in `hass.data`, so no GC), but tracked
  tasks are cancelled/awaited on shutdown. Effort: S.
- **Optional nice-to-haves (not required):** add `"single_config_entry": true` to
  `manifest.json` (matches the flow's single-instance guard); frontend card could opt into
  the 2026.6 picker via `getEntitySuggestion`. Neither affects current functionality.

---

## Redundancy review vs. core HA (WP0.5, Part B)

Core HA has shipped **no** first-party inventory/pantry/stock feature as of 2026.7. Overlap
is partial and confined to primitives (counters, to-do due dates, labels/categories, local
calendar) plus the one strong overlap: **HA Areas** (which HAventory already integrates
with). HA has **no** nested/multi-level location tree (hard-capped at floor → area).

**Per-item redundancy decisions: PENDING owner calls.** Do NOT rework any pillar until the
owner has answered the WP0.5 decision table. Record the answers here when given.

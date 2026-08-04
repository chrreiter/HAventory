# CLAUDE.md

Guidance for Claude Code when working in the HAventory repository.

This file carries no version numbers — not the project's, not the platform floors', not the
toolchain pins'. Each of those is declared in exactly one file that CI or a test defends, and
is named here instead of copied, so this file stays true across releases.

## What this is

HAventory is a Home Assistant **custom integration** (domain `haventory`) for household
inventory tracking, plus a Lovelace **card** frontend. Local-push, single-instance, HA
`Store`-backed persistence — no external services.

The released version lives in `custom_components/haventory/manifest.json` and
`cards/haventory-card/package.json`; release-please cuts it and
`scripts/check_version_consistency.py` (release workflow) plus
`tests/test_release_version_consistency.py` (CI) keep the two in agreement. Never hand-edit
either number.

### Platform floors (load-bearing)

Three floors constrain everything, none of them written down here:

- **Minimum Home Assistant** — declared in `hacs.json`, which is what HACS enforces at
  install time. Every other spelling of it is a copy, and `tests/test_min_ha_version.py`
  enumerates the copies and fails when one drifts. Add a new copy to that test or don't
  write it. `requirements-integration.txt` pins the in-process suite to the floor, so CI
  runs the integration *at* it rather than at whatever is current.
- **Python** — `requires-python` in `pyproject.toml`; ruff's `target-version` and mypy's
  `python_version` follow it, and CI installs it. It cannot go lower than HA's own floor,
  and the source uses PEP 758 unparenthesized `except A, B:`, which does not parse on
  older interpreters — so an older HA could not import the integration at all. uv
  provisions the interpreter automatically on `uv sync`; an environment with restricted
  egress must preinstall it or allow the python-build-standalone download, otherwise the
  offline suite cannot run there.
- **Node** — `engines` in `cards/haventory-card/package.json`; CI runs a matrix across the
  supported majors.

When raising the HA floor, three constraints stack and the binding one is not always the
same: the HA APIs the integration touches, the Python floor those releases carry, and
**security** — a declared floor is a recommendation about what to run, so it must not point
at a release with a known unpatched advisory. That last one moves with new advisories, so
"the oldest release with no known advisory" is not a fixed number; re-derive it rather than
assuming the current floor is still the right one. `dependency-review` fails CI if
`requirements-integration.txt` is pinned below it.

Toolchain: **uv** (env + lockfile + dependency groups), ruff, mypy, ESLint (no separate
formatter), TypeScript, Vite, Vitest. Pins live in `pyproject.toml` and
`cards/haventory-card/package.json`; ruff's pin is duplicated in `.pre-commit-config.yaml`
and the two must move together.

## Architecture & key files

### Backend — `custom_components/haventory/`
- `__init__.py` — integration setup/teardown, `hass.data[DOMAIN]` wiring, persistence helpers
  (`async_persist_repo`, `async_persist_immediate`, `async_request_persist`), Lovelace resource
  registration, and the sidebar panel (`_async_apply_sidebar_panel`: `panel_custom` at
  `/haventory`, remove-then-register, driven by the `sidebar_panel_enabled` option).
- `models.py` — `Item` / `Location` dataclasses, validation, serializers. Items carry a
  denormalized `location_path` (rebuilt on location changes) and a `version` int (starts at 1,
  bumped on each *item* mutation — derived `location_path` rewrites excluded) for
  **optimistic concurrency**.
- `repository.py` — in-memory indexed repository (the source of truth at runtime). Owns the
  search indexes; **search is case-insensitive** (casefold + NFKD accent-stripping) — see
  `_normalize_for_search`. Maintains a generation counter for optimistic locking / debugging.
- `storage.py` — HA `Store` persistence with schema versioning (`CURRENT_SCHEMA_VERSION`,
  `STORAGE_KEY = "haventory_store"`), plus `asyncio.Lock`-serialized writes. A store written
  by a newer schema is refused, not relabelled — there is no downgrade path except a JSON
  export taken while the newer version still ran.
- `migrations.py` — forward-only, **idempotent** schema migrations (`migrate_N_to_N+1`).
- `ws.py` — WebSocket-first CRUD API (`websocket_api` decorators) and subscriptions
  (items / locations / stats). This is the primary API surface. Every command is wrapped
  by `ws_guard` (error taxonomy incl. `unknown_error` catch-all, the opt-in `rate_limited`
  check, and the loaded-runtime requirement that makes commands refuse once the config
  entry is gone); error envelopes are built by `_error_envelope`, NOT
  `websocket_api.error_message` (HA's helper has no `data` param).
- `rate_limit.py` — opt-in token-bucket rate limiting (per-connection + global, for
  commands and broadcasts). Off by default; configured via the options flow
  (`config_flow.py`); limiter instance lives in `hass.data[DOMAIN]["rate_limiter"]`.
- `import_export.py` — JSON import/export with `merge` / `replace` / `skip` policies and a
  read-only preview. **Import identity is the id, never the name.**
- `stale_files.py` — `RETIRED_PATHS`, the explicit list of files earlier releases shipped
  inside the integration package and this one does not, swept on setup because a HACS
  upgrade never deletes. Executor-offloaded, files only, and refuses any entry resolving
  outside the package directory. Guard tests reject an entry this release still ships and
  any non-relative path.
- `services.py` / `services.yaml` — HA services (`haventory.*`) with voluptuous schemas; handlers
  re-raise validation/repository/storage errors so HA surfaces them. Registration binds
  `async def` adapters: a lambda handler is classified as an executor job, runs on a worker
  thread, and its coroutine is never awaited — a silent no-op that offline tests cannot see.
- `areas.py` — HA area registry integration (read-only; never auto-creates areas).
- `config_flow.py` — single-instance config flow; asks for card title and the sidebar-panel
  preference at setup, and the options flow carries those plus the rate-limit section.
  `const.py`, `exceptions.py`, `manifest.json`, `strings.json`, `translations/`.

### Frontend — `cards/haventory-card/`
Lit + TypeScript + Vite Lovelace card. Source in `src/` (`haventory-card` container,
`hv-*` components, `store/` for WS client + state). Builds to
`custom_components/haventory/www/haventory-card.js` (git-ignored; produced in CI and by
`npm run build`) — inside the integration package, which is the only tree HACS copies. The
integration serves that directory at `/haventory_static/` and loads the card through both
a Lovelace resource and `frontend.add_extra_js_url`, on one identical URL.

The same bundle registers the custom icon set that the backend's `PANEL_ICON` names, so the
sidebar entry only draws its mark once the bundle has loaded;
`tests/test_frontend_registration.py` pins that constant and the bundle's exported
identifier to the same string, across the language boundary neither side can check alone.

### Docs — `docs/` (link here, don't duplicate)
- `backend_api_contract.md` — WebSocket envelope, error taxonomy, command catalog, events.
- `data_shapes.md` — canonical Item/Location/filter/sort/event shapes.
- `frontend_architecture.md` — card component architecture.
- `rate_limiting.md` — what the rate-limit options mean and when enabling them is worth it.
- `release_testing_plan.md` — the manual pre-1.0 validation program (environments,
  scenarios, exit criteria).
- `open-items.md` — the pre-v1.0 tracker (see "Where work is tracked" below).

The remaining `docs/*_plan.md` files are per-task design documents, live only until the task
they describe ships; they are retired as a batch before 1.0.

## Running tests / lint / build (Linux)

Backend (repo root):
```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run ruff format --check .   # CI fails on formatting alone; `ruff check` does not cover it
uv run mypy
```

mypy holds the core modules (`models`, `repository`, `storage`, `ws`) to per-module strict
mode against local HA stubs in `stubs/` (`mypy_path = custom_components:stubs`); the rest of
the integration sits at the non-strict baseline.

Frontend (in `cards/haventory-card`):
```bash
npm audit --audit-level=high   # dev-scope alerts are auto-dismissed on GitHub; CI is the gate
npx eslint .
npm run typecheck
npx vitest run
npm run build
```

In-process HA integration tests (a second, separate mode, opt-in): run the integration
against a **real** Home Assistant core via `pytest-homeassistant-custom-component` (phacc).
Needs a full HA install (from `requirements-integration.txt`; kept out of
`pyproject`/`uv.lock`/the offline `.venv` so the fast suite stays lean), plugin autoload
**on**, pytest-asyncio auto mode:
```bash
scripts/test_integration.sh               # provisions .venv-integration
# manual: .venv-integration/bin/python -m pytest -o asyncio_mode=auto tests/integration
```
The offline suite stays byte-identical: `tests/conftest.py` stubs HA only when the real
package is absent, and the offline run never collects `tests/integration/`. Do **not**
set `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` for the integration mode.

The offline `HomeAssistant` stub has no service registry, so `services.setup()` early-returns
and no offline test can observe real registration semantics. Anything about how HA *dispatches*
a handler has to be asserted in the integration mode or it is not asserted at all.

Bootstrap a fresh session (also run by the SessionStart hook):
```bash
uv sync                                   # env from pyproject.toml + uv.lock
(cd cards/haventory-card && npm ci)       # reproducible install from the committed lockfile
```

Convenience wrappers live in `scripts/*.sh` (`setup.sh`, `lint.sh`, `test.sh`,
`ci_local.sh`, `build_frontend.sh`, …). Online smoke tests (`tests/*_online.py`) are opt-in
and need a real HA instance plus `RUN_ONLINE=1`, `HA_BASE_URL`, `HA_TOKEN` — see the README.
Offline tests stub HA via `tests/conftest.py`.

> Everything is Linux/bash: `scripts/` holds no `.ps1`, CI runs on `ubuntu-latest`, and
> there is **no Windows host support** — the helpers assume a UTF-8 terminal and the test
> scaffolding carries no platform branch. Develop on Windows through WSL2. The Python
> helpers (`ws_probe.py`, `ws_subscribe.py`, `ws_init_haventory.py`, `stress_test.py`,
> `create_test_items.py`) run via `uv run python scripts/<name>.py`.

## Conventions

- **TDD**: every feature/fix ships with tests — happy path plus at least one edge/error case.
- **Gate before each commit**: run the backend gate *and* the frontend gate+build above; both
  must be green.
- **Offline-first testing**: default to offline tests with the plugin autoload disabled; HA is
  stubbed. Async tests use `@pytest.mark.asyncio`.
- **WebSocket API contract lives in `docs/`** — keep `ws.py`, `docs/backend_api_contract.md`,
  and `docs/data_shapes.md` in sync when the API changes.
- **Case-insensitive search** and **denormalized `location_path`** on items are load-bearing
  invariants — preserve them. `location_path` is derived: the backend computes it from the
  tree, no client can write it, and rewriting it must not touch an item's `version` or
  `updated_at` (a location rename is not an item edit).
- **Optimistic concurrency** via the item `version` field — mutations expect/return it.
- **Conventional Commits**; small, focused commits. Update `README.md` when behavior changes.
- **Persistence**: WS and service handlers save immediately (errors propagate as
  `storage_error`); shutdown/unload flushes immediately; debounced saves are for internal/batch
  work only, and are scheduled through `hass.async_create_background_task` so a pending write
  is cancelled and awaited on shutdown.
- **Deleting or renaming a file inside `custom_components/haventory/`** means appending its
  old path to `RETIRED_PATHS` in the same PR — a HACS upgrade leaves it behind otherwise.
  The rule is stated in `CONTRIBUTING.md`.
- **Logging**: avoid reserved `LogRecord` keys in `extra=` — use `item_name` / `location_name`,
  not `name`.
- **Comments explain constraints, not history.** A comment earns its place by encoding
  something the code cannot say itself: a browser or platform quirk, an API contract, a
  required ordering, an accessibility requirement, a deliberate tradeoff whose alternative
  looks better than it is. Write it in the present tense, about the code as it stands.
  - Do **not** narrate development history — no references to what a component replaced,
    what an earlier iteration did, which work package introduced it, or what "used to" be
    here. That context dies with the branch and leaves a dangling reference. Git history is
    where it belongs.
  - Do **not** point at anything a reader of this repository cannot open: design-mock
    numbers, an external design canvas, or a numbered entry in a tracker or ledger. State
    the constraint the reference was standing in for.
  - Do **not** restate the line below. If a comment paraphrases the code, delete the
    comment or fix the naming.
  - A comment that is wrong is worse than none. When a comment names a symbol, a type, a
    caller or a stored shape, that name must still be correct.
  - `TODO`/`FIXME` markers do not belong in committed code — the repo has zero and keeps it
    that way. Record follow-ups as GitHub issues (🔧 Task template). Pre-v1.0 release work
    is the one exception: it stays in `docs/open-items.md` until 1.0, and no new features
    land before then.
  - Component-level JSDoc says what the component is responsible for and what it talks to.
    Non-obvious CSS gets a why-comment; obvious CSS gets none.
  - Applies to TypeScript and Python alike. Enforced by review, not by a lint rule — the
    distinction is a judgment call and a mechanical check would be wrong often enough to be
    ignored.
- Naming: domain/package `haventory`, services `haventory.*`, built assets
  `custom_components/haventory/www/` served at `/haventory_static/`, calendar entity
  `calendar.haventory` — a name reserved for the post-1.0 calendar work, not an entity that
  exists today.
- Report out-of-scope findings under a "Follow-ups" note rather than fixing them.

See the README "Developer Checklist" for the full backend/frontend/CI checklist.

## Scope decisions that stay true

- **HAventory keeps all of its pillars.** Core HA has shipped no first-party
  inventory/pantry/stock feature; the overlap is confined to primitives (counters, to-do due
  dates, labels/categories, local calendar) and there is no native nested location tree —
  HA is hard-capped at floor → area, which is the differentiator. Do not migrate a pillar
  onto a core primitive on the theory that it duplicates one.
- **Areas are HA's, not ours.** The integration reads the area registry and never creates
  areas. An item's area is inherited from its location tree's root, exposed as
  `effective_area_id`, and shown with one chip vocabulary wherever the card marks an area.
- **Reminders/calendar, when built, ride HA-native primitives** — a `CalendarEntity` plus
  automations, not a bespoke scheduler. Post-1.0, tracked as an issue; do not start it.

## Where work is tracked

**GitHub issues** are the tracker: bugs, feature requests, and every deferred follow-up,
filed with the templates in `.github/ISSUE_TEMPLATE/`. `docs/open-items.md` is the one
exception — the pre-v1.0 release tracker, carrying the remaining release stages and the
staging table that says which release each lands in. It is authoritative for staging, and it
is deleted when 1.0 is cut.

**Feature-frozen until 1.0**: a new finding either blocks the release — and goes to
`docs/open-items.md` — or it is an issue. Nothing else lands in between.

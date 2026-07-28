# CLAUDE.md

Guidance for Claude Code when working in the HAventory repository.

## What this is

HAventory is a Home Assistant **custom integration** (domain `haventory`) for household
inventory tracking, plus a Lovelace **card** frontend. Local-push, single-instance, HA
`Store`-backed persistence — no external services.

Targets (as of WP1): minimum Home Assistant **2026.7** ⇒ **Python 3.14 everywhere**
(`requires-python >=3.14`, ruff `target-version = py314`, mypy `3.14`, CI 3.14; the source
uses 3.14-only PEP 758 syntax). uv provisions the interpreter automatically. Node
**22.13+ / 24 LTS** (`engines: ^22.13 || >=24`). Toolchain: **uv** (env + lockfile +
dependency groups), ruff `0.15`, mypy `2`, ESLint `10`, TypeScript `6`, Vite `8`,
Vitest `4`. Version 0.0.1, unreleased.

> See the "WP1 Decisions" section at the end for the full adopted platform + tooling set.

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
  (items / locations / stats). This is the primary API surface. Every command is wrapped
  by `ws_guard` (error taxonomy incl. `unknown_error` catch-all and the opt-in
  `rate_limited` check); error envelopes are built by `_error_envelope`, NOT
  `websocket_api.error_message` (HA's helper has no `data` param).
- `rate_limit.py` — WP4 opt-in token-bucket rate limiting (per-connection + global, for
  commands and broadcasts). Off by default; configured via the options flow
  (`config_flow.py`); limiter instance lives in `hass.data[DOMAIN]["rate_limiter"]`.
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

Backend (repo root):
```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run mypy
```

Frontend (in `cards/haventory-card`):
```bash
npx eslint .
npm run typecheck
npx vitest run
npm run build
```

In-process HA integration tests (WP1.5 — second, separate mode, opt-in): run the
integration against a **real** Home Assistant core via
`pytest-homeassistant-custom-component` (phacc). Needs Python 3.14 + a full HA install
(from `requirements-integration.txt`; kept out of `pyproject`/`uv.lock`/the offline
`.venv` so the fast suite stays lean), plugin autoload **on**, pytest-asyncio auto mode:
```bash
scripts/test_integration.sh               # provisions .venv-integration (Py 3.14 + phacc)
# manual: .venv-integration/bin/python -m pytest -o asyncio_mode=auto tests/integration
```
The offline suite stays byte-identical: `tests/conftest.py` stubs HA only when the real
package is absent, and the offline run never collects `tests/integration/`. Do **not**
set `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` for the integration mode.

Bootstrap a fresh session (also run by the SessionStart hook):
```bash
uv sync                                   # env from pyproject.toml + uv.lock
(cd cards/haventory-card && npm ci)       # reproducible install from the committed lockfile
```

Convenience wrappers live in `scripts/*.sh` (`setup.sh`, `lint.sh`, `test.sh`,
`ci_local.sh`, `build_frontend.sh`, …). Online smoke tests (`tests/*_online.py`) are opt-in
and need a real HA instance plus `RUN_ONLINE=1`, `HA_BASE_URL`, `HA_TOKEN` — see the README.
Offline tests stub HA via `tests/conftest.py`.

> WP1 retired the `scripts/*.ps1` PowerShell tooling and moved CI off `windows-latest` —
> everything is Linux/bash now. The cross-platform Python helpers (`ws_probe.py`,
> `ws_subscribe.py`, `ws_init_haventory.py`, `stress_test.py`, `create_test_items.py`) are
> unchanged; run them via `uv run python scripts/<name>.py`.

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
    that way. Record follow-ups in `docs/open-items.md` instead.
  - Component-level JSDoc says what the component is responsible for and what it talks to.
    Non-obvious CSS gets a why-comment; obvious CSS gets none.
  - Applies to TypeScript and Python alike. Enforced by review, not by a lint rule — the
    distinction is a judgment call and a mechanical check would be wrong often enough to be
    ignored.
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
- ~~**Flagged for WP1 (not fixed — needs a small guarded change):** `storage.py` uses bare
  `asyncio.create_task(...)` for the debounced persist.~~ — fixed: the debounced persist is
  scheduled via `hass.async_create_background_task(coro, name=...)`, so a pending debounce
  is cancelled/awaited on shutdown.
- **Optional nice-to-haves (not required):** add `"single_config_entry": true` to
  `manifest.json` (matches the flow's single-instance guard); frontend card could opt into
  the 2026.6 picker via `getEntitySuggestion`. Neither affects current functionality.

---

## Redundancy review vs. core HA (WP0.5, Part B)

Core HA has shipped **no** first-party inventory/pantry/stock feature as of 2026.7. Overlap
is partial and confined to primitives (counters, to-do due dates, labels/categories, local
calendar) plus the one strong overlap: **HA Areas** (which HAventory already integrates
with). HA has **no** nested/multi-level location tree (hard-capped at floor → area).

### Per-item decisions (DECIDED by owner, 2026-07-22)

| # | Pillar | Nearest HA-native (since) | Overlap | Decision |
|---|---|---|---|---|
| 1 | Quantity + low-stock threshold | `counter` / `input_number` helpers | weak (no threshold logic) | **Keep as-is** |
| 2 | Categories + tags | Labels + Categories registries (2024.4) | partial (target HA entities, not item objects) | **Keep as-is** |
| 3 | Custom fields | none | none | **Keep as-is** |
| 4 | Check-out + due dates | `todo` due dates (2024.1) | none (primitive only; no borrow/return) | **Keep as-is** |
| 5 | Inspection dates | `todo` / `calendar` primitive | none | **Keep as-is** |
| 6 | Multi-level location tree | Floors → Areas (2024.4) = one level only | none (major gap; a differentiator) | **Keep as-is** |
| 7 | Areas integration | Area registry (0.87), Floors (2024.4) | strong | **Keep as-is** (already rides native Areas) |
| 8 | JSON import/export (planned) | none | none | **Keep / build as planned** |
| 9 | Reminders / calendar (post-1.0) | Local Calendar (2022.12) + `todo` + automations | partial | **Rework onto HA-native**: implement the roadmap's `CalendarEntity` (`calendar.haventory`) + HA automations rather than a bespoke reminder scheduler. Effort M, post-1.0. |

Net: HAventory keeps all pillars; only the post-1.0 reminders/calendar work is to be built on
HA-native primitives (`CalendarEntity` + automations) rather than a custom scheduler. Do NOT
start that rework here — it is post-1.0 and out of WP0.5 scope; this table just fixes the
direction. Everything else stays as implemented (no core-HA equivalent to migrate onto).

---

## WP1 Decisions — toolchain modernization + Linux-first (2026-07-22)

Adopted tooling (latest stable at review time; verified against release pages / npm registry):

| Area | Choice | Notes |
|---|---|---|
| Python env/deps | **uv** (`uv.lock` + `[dependency-groups]`, `[tool.uv] package=false`) | replaces pip + hand `.venv`; `requirements-dev.txt` is now a generated uv export |
| Lint/format | **ruff 0.15.22** | pin unified across `pyproject.toml` + pre-commit |
| Type checker | **mypy 2.x**; strict on the core four | WP4: per-module strict for `models`/`repository`/`storage`/`ws` against local HA stubs in `stubs/` (`mypy_path = custom_components:stubs`); the rest stays non-strict (WP5 ratchet) |
| Frontend pkg mgr | **npm** (kept) | pnpm not worth it for one small package |
| Frontend lint | **ESLint 10** + `@typescript-eslint 8`; no separate formatter | Biome not adopted (weaker Lit/TS type-aware coverage) |
| TypeScript | **6.0.3** (hold 7.x) | typescript-eslint 8.65 caps at `<6.1.0`; TS 7 would break type-aware lint. Follow-up: bump to 7 when typescript-eslint supports it |
| Vite / Vitest | **8 / 4** (+ coverage-v8 4) | upgraded together (vitest 4 needs vite ≥6) |
| Node | `engines ^22.13 || >=24`; CI 22 + 24 | Node 20 EOL 2026-04-30 |
| CI | ubuntu-latest, uv (`setup-uv` w/ cache), Python 3.12+3.14 matrix, concurrency+cancel, actionlint, `actions/*@v7`, SHA-pinned hassfest/hacs/setup-uv | moved off windows-latest |
| Dependabot | grouped updates; **uv** ecosystem for Python | kept over Renovate |
| Release automation | **release-please** | recommended now, implement in WP5 |

### Platform floors (important, load-bearing)

- **Python 3.14 everywhere** (floor raised 2026-07-22, completing the WP0.5 target):
  `requires-python = ">=3.14"`, ruff `target-version = "py314"`, mypy
  `python_version = "3.14"`, CI runs 3.14 only. The source uses PEP 758 unparenthesized
  `except A, B:` (emitted by ruff's 2026 formatter at py314), so it does **not parse on
  ≤ 3.13** — there is no 3.12/3.13 support anymore.
- Dev environments must be able to provide CPython 3.14: uv downloads it automatically on
  `uv sync`. Environments with restricted egress (e.g. a remote sandbox that blocks
  python-build-standalone downloads) must preinstall 3.14 or allow the download — otherwise
  the offline suite cannot run there.

### WP1 follow-ups (out of scope / environment-blocked)

- ~~**Type-harden** `ws.py` + `repository.py` and drop the mypy per-module override~~ —
  done in WP4 (per-module strict on the core four + `stubs/`).
- ~~**`storage.py`**: switch the debounced persist from bare `asyncio.create_task` to
  `hass.async_create_background_task(...)` (WP0.5 finding; effort S)~~ — done: the persist
  task is HA-tracked.
- **TypeScript 7**: adopt once typescript-eslint supports it (currently capped `<6.1.0`).
- ~~**`tsc --noEmit`** is clean as of WP2 follow-ups (`npm run typecheck`); not yet part of the
  gate — adding it is a WP4/WP5 call.~~ — done: `npm run typecheck` runs in the `frontend` CI
  job and in `scripts/lint.sh` / `scripts/ci_local.sh`.
- **release-please** wiring lands in WP5.
- ~~**Windows-only test scaffolding**: `tests/conftest.py` uses
  `asyncio.WindowsSelectorEventLoopPolicy` / `set_event_loop_policy`, both deprecated for
  removal in Python 3.16~~ — fixed: `tests/conftest.py` now implements the
  `pytest_asyncio_loop_factories` hook (Windows-only) to hand pytest-asyncio a
  `asyncio.SelectorEventLoop` factory directly, instead of mutating the process-wide event
  loop policy.

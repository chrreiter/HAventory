# HAventory

[![CI](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/ci.yml)
[![CodeQL](https://github.com/chrreiter/HAventory/actions/workflows/codeql.yml/badge.svg)](https://github.com/chrreiter/HAventory/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/chrreiter/HAventory/badge)](https://securityscorecards.dev/viewer/?uri=github.com/chrreiter/HAventory)
[![HACS: Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: Apache-2.0](https://img.shields.io/github/license/chrreiter/HAventory)](LICENSE)

Home Assistant custom integration (domain `haventory`) for household inventory tracking,
plus a Lit + TypeScript Lovelace card. Local-push, single-instance, HA `Store`-backed
persistence — no external services.

**Targets:** Linux dev + `ubuntu-latest` CI. Minimum Home Assistant **2026.3.1** ⇒ Python
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

Minimum Home Assistant version: **2026.3.1** — the first release series requiring Python
3.14, which the source needs. Developers: see the Developer Checklist below
and [CONTRIBUTING.md](CONTRIBUTING.md).

### YAML-mode dashboards

Step 5 assumes the default storage mode, where the integration registers the card as a
Lovelace resource for you. In YAML mode, Home Assistant reads the resource list from
`configuration.yaml` and no integration can add to it, so HAventory skips registration
(logging `Lovelace in YAML mode; manual resource configuration required` at debug level).
Nothing else reports the problem: the card is simply missing from the picker, and any
dashboard already using it shows *Custom element doesn't exist: haventory-card*.

You are in YAML mode if `configuration.yaml` has a `lovelace:` block with `mode: yaml`.
In the UI, with **Advanced Mode** enabled on your profile, **Settings → Dashboards → ⋮**
offers no **Resources** entry and the dashboard has no edit (pencil) button.

Register the card yourself next to that `mode:` key:

```yaml
lovelace:
  mode: yaml
  resources:
    - url: /local/haventory/haventory-card.js
      type: module
```

Restart Home Assistant, then refresh your browser (Ctrl/Cmd+Shift+R).

The mode of the *main* dashboard is what decides this. An extra YAML dashboard declared
under `lovelace: dashboards:` while the main one stays in storage mode still uses the
UI-managed resource list, so it needs nothing. In storage mode a `resources:` block in
`configuration.yaml` is ignored — Home Assistant warns and keeps using the UI list.

### Removing HAventory

Deleting the integration under **Settings → Devices & Services** removes the Lovelace
resource entry HAventory registered for `/local/haventory/haventory-card.js`, so no
dashboard is left loading a card that is about to disappear. (If your Lovelace runs in YAML
mode the entry is yours, in `configuration.yaml` — delete the `resources:` line by hand.)

**Your inventory is deliberately kept.** Items and locations live in the Home Assistant
store file `<config>/.storage/haventory_store`, which removal does not touch: adding the
integration again restores everything, which is what you want when you remove it to
reinstall, move to another HACS channel, or clear a bad config entry.

To delete the data as well — after exporting a backup, if you might want it later:

1. Remove the integration and stop Home Assistant.
2. Delete `<config>/.storage/haventory_store`.
3. Uninstalling for good? Also delete `<config>/www/haventory/` (the card bundle; HACS
   removes `custom_components/haventory/` but not the built asset).
4. Start Home Assistant.

---

## Known limitations

What HAventory does *not* do today, stated up front so none of it is a surprise:

- **Scale: a few thousand items.** Every mutation re-serializes the entire inventory and
  rewrites the store blob, so write latency grows with the total item count. Measured p50
  per create: ~70 ms at 250 items, ~114 ms at 500, ~200 ms at 1000; on that curve a single
  create trends toward ~1 s at a few thousand items. Reads don't share the problem (query
  paths are benchmarked at 10 000 items), correctness is unaffected at any size, and no
  limit is enforced — writes simply get slower. Treat a few thousand items as the
  comfortable ceiling.
- **No automation triggers.** The integration creates no entities and fires no events on
  the Home Assistant bus. Automations and scripts can *call* the `haventory.*` services,
  but nothing can trigger *on* an inventory change — there is no state object to watch and
  no event type to listen for. Change notification is WebSocket subscriptions only, for
  clients holding an open connection.
- **No admin gating.** No WebSocket command declares `require_admin`, so any logged-in
  Home Assistant user — not only administrators — can read and mutate the whole inventory.
  It is a household-wide tool, not a per-user one.
- **Rate limiting is opt-in and off by default.** Out of the box nothing bounds how fast a
  client may issue commands or how many subscription events it is sent. Enabling it under
  Settings → Devices & services → HAventory → **Configure** turns on per-connection and
  global token buckets: excess commands are rejected with a `rate_limited` error and
  excess subscription broadcasts are dropped. Dropped broadcasts are silent on the wire —
  events carry no sequence number, so a missing one cannot be detected by its absence. A
  limiter tight enough to refuse the card's *subscribe* is not silent, though: the card
  re-opens the refused round up to four times, waiting out a retry-after hint when the
  refusal carries one and backing off exponentially when it does not, and once that budget
  is spent it says **Live updates paused** and offers a Refresh — so a list that has
  stopped updating never passes for one with nothing to report.
- **Import identity is the id, never the name.** The `merge` / `replace` / `skip` policies
  all classify an incoming item or location by its id. Restoring a backup onto entities
  you rebuilt by hand — which carry fresh uuids — therefore duplicates them instead of
  merging, and the backup's items follow their stored `location_id` onto the duplicate.
  Restore into an empty inventory, or onto one whose ids are still intact.

These are tracked, with their measurements and proposed fixes, in
[`docs/open-items.md`](docs/open-items.md).

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
npm audit --audit-level=high
npx eslint .
npm run typecheck
npx vitest run
npm run build
```

The audit is the only place a development-scope npm vulnerability becomes visible: the
repository's Dependabot auto-triage rule dismisses dev-scope alerts, so the alert
dashboard is not ground truth for the card's lockfile — CI is.

Or all at once: `scripts/ci_local.sh` (backend lint + types + tests w/ coverage, then
frontend install + audit + lint + types + test + build). Lint only: `scripts/lint.sh`. Backend tests
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

Performance benchmarks live in `tests/test_repository_benchmarks_offline.py`,
including the WP4 percentile scenarios (item list: 50-item page p50 ≤ 30 ms /
p95 ≤ 75 ms; `move_subtree` p50 ≤ 80 ms / p95 ≤ 150 ms on the 2k-items /
60-locations typical dataset). They print results always and fail on budget
misses only with `ASSERT_BUDGETS=1`:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 ASSERT_BUDGETS=1 uv run pytest -q tests/test_repository_benchmarks_offline.py -s
```

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

Full online E2E gate against a **disposable** HA (e.g. the Docker dev container),
including the destructive and area-registry scenarios:

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
export HA_CONTAINER=home-assistant     # docker-logs assertions; also lets reload_addon.sh deploy
export HAV_ONLINE_DESTRUCTIVE=1        # unlocks the purging tests — disposable instances only!
export HA_ALLOW_AREA_MUTATIONS=1       # unlocks the area-registry e2e test

# Deploy the current working tree into the container and (re)create the config
# entry, so the instance matches the local CURRENT_SCHEMA_VERSION:
scripts/reload_addon.sh --container "$HA_CONTAINER"

scripts/test_online.sh                 # pytest -q -m online (all three online files)
```

Run the suite sequentially (no `-n`/xdist): destructive tests purge and then
assert exact totals, so they assume exclusive access to the instance.

> ⚠️ **Destructive scenario tests are double-gated.** A subset of the online
> suite **purges ALL HAventory items and locations** on the target instance
> before running (they assert exact totals against a clean dataset). Those
> tests are skipped unless you *also* set `HAV_ONLINE_DESTRUCTIVE=1` — do that
> only against a disposable HA. Everything that runs without the flag is
> self-contained: it creates uniquely-named entities and deletes them again.

Area-registry e2e (optional; temporarily mutates your HA instance):

```bash
export HA_ALLOW_AREA_MUTATIONS=1
uv run pytest -q -m online -k ws_areas_online
```

Included: `tests/test_ws_smoke_online.py`, `tests/test_ws_smoke_advanced_online.py`,
`tests/test_ws_areas_online.py`.

#### Live-update browser smoke (opt-in)

`cards/haventory-card/e2e/live-updates.smoke.mjs` drives the **real card** in a headless
browser against a running HA and asserts that out-of-band inventory changes (made over a
separate WebSocket connection) reach the card purely through its subscription — create →
rename → delete, live, with no manual re-list. It guards the "green unit tests, dead
feature" class of regression that unit mocks cannot (see PR #93): the mock is only ever as
truthful as the contract its author imagined.

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
cd cards/haventory-card
npm i && npx playwright install chromium   # one-time
npm run test:e2e                            # skips cleanly if RUN_ONLINE is unset
```

The card must be deployed on a dashboard at `--path` (default `/lovelace/default_view`),
e.g. via `scripts/reload_addon.sh`. The test is idempotent — it creates a uniquely-named
item and deletes it (best-effort cleanup even on failure).

#### Coverage

- Backend: `scripts/ci_local.sh` produces `coverage.xml` + browsable `htmlcov/index.html`.
- Frontend: `scripts/test_frontend.sh --coverage` (report at `cards/haventory-card/coverage/`).

### Backend (custom component)

- `custom_components/haventory/` with `manifest.json`, `__init__.py`, `config_flow.py`, `services.yaml`.
- Store: `hass.data[DOMAIN]["store"]` with versioned schema and safe writes. Migrations are
  forward-only: a store written by a **newer** HAventory version is refused (setup fails with
  an "upgrade HAventory" message) and never rewritten, so a rollback cannot relabel data the
  running build cannot read.
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
- Two calendar-derived counts on `haventory/stats`, each with a matching `item/list` filter:
  `overdue_count` / `overdue_only` for a passed `due_date` (checked-out items only, since
  that is where a due date can exist), and `inspection_overdue_count` /
  `inspection_overdue_only` for a passed `inspection_date` — the date the item is next due
  for inspection, over the whole inventory, since an inspection is independent of any
  check-out. Both move with the calendar and emit no event when the date rolls over.
- **WebSocket rate limiting (opt-in, off by default)**: per-connection **and** global
  token buckets for commands (excess requests get a `rate_limited` error) and for
  subscription broadcasts (excess events are dropped, never breaking the command).
  Enable and tune it under Settings → Devices & services → HAventory → **Configure**;
  `haventory/health` reports drop counters. Leave it disabled for stress testing
  (`scripts/stress_test.py`). Semantics and defaults:
  [`docs/backend_api_contract.md`](docs/backend_api_contract.md) → "Rate limiting".
- **JSON import/export (data safety)** via `haventory/export`, `haventory/import/preview`,
  and `haventory/import/execute`: back up to a versioned document before a breaking update
  and restore afterwards. Preview reports would-be adds/updates/conflicts without touching
  state; execute applies a `merge` / `replace` / `skip` conflict policy and rolls back on
  failure so a bad import never leaves partial state. This **complements** Home Assistant's
  own snapshots/backups — the HAventory store file is already captured by an HA backup;
  import/export adds a portable, human-readable document you can inspect, diff, and restore
  independently of a full-instance snapshot. See
  [`docs/backend_api_contract.md`](docs/backend_api_contract.md) and
  [`docs/data_shapes.md`](docs/data_shapes.md).
  - **Import matches entities by id, and only by id — never by name.** Every incoming item
    and location is looked up by its id: an id already in the inventory is the same entity
    (left `unchanged`, `update`d, or reported as a `conflict` under `skip`), an id that is
    absent is added. Names are not consulted under any policy, which is deliberate —
    matching by name would silently fuse two genuinely different "Shelf A"s.
  - **So restoring a backup onto hand-rebuilt locations or items duplicates them; it does
    not merge onto them.** Anything you delete and recreate by hand comes back with a fresh
    id, so the backup's copies count as new entities and you end up with two of each.
    The duplicates are not inert: each imported item carries the backup's `location_id`, so
    the items repoint onto the *newly added* duplicate location, and the location you
    rebuilt keeps its name while its contents move to its twin. Measured against a running
    instance: a 40-location backup previewed against a 53-location inventory gives
    `locations add=0 unchanged=40` when the ids are intact, but `add=17 unchanged=23` — 70
    locations with 17 duplicate name pairs, and 402 items moving from `unchanged` to
    `update` — when 17 of those locations had been rebuilt by hand first.
  - **Safe restore paths:** restore into an **empty inventory**, or restore a backup whose
    ids are still intact (the entities were never deleted and recreated). Either way run
    `import/preview` first and read the `add` counts: entities you expect the import to
    match onto must appear under `unchanged`/`update`, and a location you already have
    showing up under `add` means you are about to duplicate it.

### Frontend (Lovelace card)

Redesigned in WP4.1. Lit + TypeScript + Vite; tests with Vitest; build outputs to
`www/haventory/`. Real-time over WebSocket with optimistic writes throughout.

- **Standard card** — one Add button and a single ⋮ menu (Select items, Organize, Refresh,
  Diagnostics, Export backup / Export current view, Import); Columns is offered in the full
  view, which is the only surface it changes. Live stat badges — items, low stock, overdue,
  due for inspection, checked out — are click-to-filter. Rows carry a quantity stepper, a
  LOW badge, an overdue check-out chip, an "Inspection due" chip, and hover actions.
- **Filters** — a collapsible panel exposing the whole backend filter object: location
  (from a real tree), area, include-subtree, category chips with counts, tag chips with an
  any/all toggle, low-stock-only, checked-out, overdue, inspection-due and no-location —
  each with the count of what it would keep — plus updated / created windows (each row's ≥ flips to ≤ for
  "before") and sort across all six sortable fields.
  "Low stock" (a filter) and "Low stock first" (an ordering) are separate, independently
  clearable controls. Active filters appear as removable chips.
- **Editing** — the row expands in place; there is no dialog chain. Full field parity:
  name, description, quantity, low-stock threshold, category, tags, location (picked from
  a tree inside the form), checked-out with due date, next inspection (with the same
  +7 / +31 / +90 / +X quick offsets the check-out popover offers), and typed
  custom fields (text / number / yes-no / date). Saves send the item's expected version so
  a concurrent edit surfaces as a conflict.
- **Full view** — a fullscreen workspace with a coloured app bar, a **browse sidebar**, and
  a sortable table. Only columns the backend can sort by get a clickable header. The
  sidebar leads with the location tree carrying the backend's own per-location counts and
  an orphans row, then **Categories** and **Tags** as sections of their own; each heading
  collapses from a chevron and states how many there are — locations counted at every
  depth — and Locations stays at the top. Category picks one value and
  tags accumulate, matching how the backend treats them. With a filter on, each location
  row reads "4 / 37" — matches over total — so you can see where the matches are rather
  than a total that never moves. The counts ignore the *location* filter, since the sidebar
  is how you pick one. Each heading also offers a create action: Locations opens an inline
  name field, while Categories and Tags open the organize dialog on their own tab — a
  category exists through the items using it, so that is where making one is explained.
  From the second selected tag on, the Tags heading carries the same any/all control the
  filter panel has, since that is the mode governing what the sidebar just selected. The
  app bar's stat pills are the card's: low in amber, overdue in red, to-inspect in amber,
  checked out, each click-to-filter. An empty table names the reason and offers a way out — the same
  wording and the same offers as the card's list.

  At phone width the sidebar folds away and the surface hands its own breakpoint down to
  the edit form and the filter panel, so both take their phone layouts: one field per row,
  and filters staged behind a "Show N items" commit row exactly as in the card's sheet.
- **Multi-select and bulk actions** — move, add/remove tags, set category, adjust
  quantity, check out/in and delete over a selection. Work is chunked so progress is
  determinate and cancellable, and the result is reported *per operation*: "39 of 42
  succeeded", every failure named with its reason and a retry scoped to just those.
  Select-all covers loaded rows only and says so, with an explicit "load the rest" path.
- **Organize dialog** — Locations / Categories / Tags in one place, each tab stating its
  total above the list and each row offering the same moves: an "N items" link that opens
  the filtered list in the full view, plus rename, merge and delete. Locations keep their collapsible tree and edit inline, with a guarded
  delete that explains what is in the way. Category and tag rename, merge and removal are
  batch rewrites over every affected item; a location merge re-files that location's items,
  re-parents its children and deletes the husk — all with the same progress and
  partial-failure reporting.
- **Check-out** invites an optional due date (+7 / +31 / +90 / +X day suggestions) rather
  than silently checking out with none — the date is what makes overdue highlighting mean
  anything. "No due date" stays a first-class choice.
- **Mobile** — the card switches layout from its own width. Tapping a row opens one bottom
  sheet holding everything about the item; filters open as a staged sheet whose apply
  button shows the live matching count. Every surface honours the same 44px touch minimum
  and 16px field text (iOS zooms a page whose fields are smaller and never zooms back).
- **Import** keeps the mandatory server-side dry run: paste or pick a file, choose
  merge / replace / skip, preview add/update/conflict counts per items and locations, then
  import. An invalid document is shown as a list of JSON paths, not one flat message.
- **Diagnostics and degraded states** — the ⋮ menu carries a Diagnostics panel (health,
  rate-limit drop counters, subscription state, copyable report) badged only when
  something is wrong, plus banners for connection loss, rate limiting and the
  payload-free reload an import broadcasts. Because subscription events carry no sequence
  number, a dropped one is undetectable — so the card says the list may be stale and
  offers an explicit Refresh.
- Deletes use an in-app confirmation, not `window.confirm`.
- Card auto-registered as a Lovelace resource on integration setup.
- **Note:** after first install, a browser refresh (F5 / Ctrl+Shift+R) is required for the
  card to appear in the picker (standard for all custom cards).

#### Card configuration

```yaml
type: custom:haventory-card
title: Inventory   # optional; defaults to "Inventory"
```

`title` is the only option the card reads. Any other key is ignored rather than rejected,
so a stale dashboard config never breaks the card.

### CI/CD & Ops

- GitHub Actions (`ubuntu-latest`): backend (uv, ruff + mypy + pytest w/ coverage, Python
  3.14), a dedicated **integration** job (in-process HA via phacc, Python 3.14),
  frontend (npm audit + eslint + tsc + vitest + build, Node 22/24 matrix), actionlint,
  hassfest + HACS validation, CodeQL, OpenSSF Scorecard, and dependency review.
  Third-party actions are SHA-pinned; first-party `actions/*` use `@v7`.
- PR hygiene: Conventional-Commit PR-title check, path-based auto-labeling
  (`.github/labeler.yml`), labels-as-code (`.github/labels.yml`), CODEOWNERS review
  requests, and issue/PR templates.
- Dependabot: grouped updates for `github-actions`, `npm` (card), and `uv` (Python).
- `main` is protected by a checked-in ruleset (`.github/rulesets/main.json`): pull request
  required, the CI/CodeQL/dependency-review/PR-title checks required, no force-push or
  deletion. Edit it under *Settings → Rules → Rulesets*, or `PUT` the file to
  `repos/{owner}/{repo}/rulesets/{id}`; the required checks must keep matching the job
  names in `.github/workflows/`, or a pull request can never satisfy them.
- The repository's social preview is `docs/assets/social-preview.png`, rendered from the
  `.html` beside it. GitHub has no API for it — upload it under *Settings → General*.
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
  (categories grouped case-insensitively) plus distinct custom-field keys — powers
  category/tag autocomplete, the browser views, and custom-field key suggestions.

### ✅ Phase 2: Frontend Lovelace Card (Complete — superseded by Phase 2.5)
> Historical: this describes the proof-of-concept card. Phase 2.5 replaced its components;
> the capabilities below carried over, the surfaces they are reached through did not.

- Lit 3 + TypeScript components; real-time sync; optimistic updates with conflict
  resolution; Vite build → `www/haventory/haventory-card.js`.
- Item dialog offers debounced, keyboard-navigable category/tag autocomplete sourced from
  `haventory/distinct_values`.
- Dedicated **category browser** (header → "Categories"): lists used categories with item
  counts and drills down to the items filed under each.
- Dedicated **tag browser** (header → "Tags"): lists used tags with item counts and drills
  down to the items carrying each.
- **Column selection** (header → "Columns"): choose which optional columns (quantity,
  category, location, tags, due date) show in the standard vs expanded view; the choice is
  persisted in `localStorage` (`haventory:columns:v1`, per browser).
- **Custom fields UI** in the item dialog: define/edit/remove typed fields
  (string/number/boolean/date) with type-appropriate inputs; existing field keys across the
  dataset are offered as suggestions.

### ✅ Phase 2.5: UI revamp (WP4.1)
- The proof-of-concept card was replaced with the redesigned UI: decluttered header with a
  single ⋮ menu, complete filter panel, inline row editing, a full view with a real
  location tree sidebar and a sortable table, multi-select with per-operation bulk results,
  a tabbed organize dialog, an optional check-out due date, a two-step import flow, and
  diagnostics plus degraded-state banners. Mobile gets its own layout, detail sheet and
  staged filter sheet.
- Closes the standing gaps for the location tree view, bulk operations, unified
  category/tag browsing, and the card's silent failure when a subscription is
  rate-limited.
- Verified against a running Home Assistant frontend, after which the proof-of-concept
  components and the `ui: legacy` option that reached them were removed — there is one
  card now, not two.

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
  built assets `www/haventory/`; calendar entity `calendar.haventory` — a reserved name for
  the post-1.0 calendar work ([open item 9](docs/open-items.md)), not an entity that exists
  today.
- Logging: avoid reserved `LogRecord` keys in logger extras — use `item_name` /
  `location_name`, not `name`.

## Developer docs

- WebSocket API contract: `docs/backend_api_contract.md`
- Data shapes (Item/Location/filter/sort/events): `docs/data_shapes.md`
- Frontend architecture: `docs/frontend_architecture.md`
- Release testing plan (manual v1.0 readiness run): `docs/release_testing_plan.md`
- Open items / future work: `docs/open-items.md`

## Troubleshooting

- Container logs: `docker logs -f <container>` (or `-n 200` for recent)
- HA log file (if enabled): `/config/home-assistant.log` inside the container
- HAventory storage file: `/config/.storage/haventory_store`
- **"stored data uses schema version N, which is newer than this build supports"**: the store
  was written by a newer HAventory version — typically after rolling the integration back, or
  after restoring a backup taken on a newer version. The entry stops with that error and the
  store is left untouched; re-install the newer version to read it, or replace
  `haventory_store` with a backup taken on the running version.

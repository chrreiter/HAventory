# Developing HAventory

Everything needed to work on the integration and the card: the toolchain, the gate that
runs before every commit, both backend test modes, what the backend and the card are made
of, the CI jobs, and the dev helper scripts. [CONTRIBUTING.md](../CONTRIBUTING.md) is the
shorter, process-facing companion — how to file, branch and release.

## Setup (Linux/bash)

Prereqs: [uv](https://docs.astral.sh/uv/), Node 22.13+ (or 24 LTS), git.

```bash
# One-shot bootstrap: uv env + card deps + pre-commit hooks
scripts/setup.sh

# ...or manually:
uv sync                                   # creates .venv from pyproject.toml + uv.lock
(cd cards/haventory-card && npm ci)       # reproducible install from the committed lockfile
```

Run any Python tool through uv (`uv run <tool>`), so it uses the locked dev environment.

## Tooling

- **uv** — Python env, dependency resolution, and lockfile (`uv.lock`). Dev deps live in
  `pyproject.toml` under `[dependency-groups]`; `requirements-dev.txt` is a generated,
  pip-installable export kept for environments without uv.
- **Ruff** — lint + format, configured and pinned in `pyproject.toml`; the hook in
  `.pre-commit-config.yaml` pins the same version and `tests/test_toolchain_pins.py`
  holds the two together.
- **mypy** `2.x` — type checking, scoped to `custom_components/haventory`. The core
  modules are held to per-module strict mode against the local HA stubs in `stubs/`
  and the rest of the integration sits at the non-strict baseline; which modules those
  are is the `[[tool.mypy.overrides]]` list in `pyproject.toml`.
- **ESLint** `10` (flat config `cards/haventory-card/eslint.config.js`) + `@typescript-eslint 8`.
- **TypeScript** `6`, **Vite** `8`, **Vitest** `4` (+ `@vitest/coverage-v8`) for the card.
- **pre-commit** — ruff, codespell, basic hooks.

## The gate (run before every commit — both halves must be green)

```bash
# Backend
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run ruff format --check .   # CI fails on formatting alone; `ruff check` does not cover it
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

## Testing

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

Timings are measured where the load is real — `scripts/stress_test.py` against a live
Home Assistant (see [Backend stress testing](#backend-stress-testing)). A budget asserted
inside the offline suite would only be measuring the runner it happened to land on.

[phacc]: https://github.com/MatthewFlamm/pytest-homeassistant-custom-component

### In-process HA integration tests (opt-in)

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
`tests/integration/`. What they cover has grown to most of the HA-facing surface —
config-entry setup/unload, WebSocket CRUD and error envelopes, persistence and schema
migration, services and their broadcasts, the sensors, calendar, repairs, diagnostics,
to-do bridge, attachments, translations, the retired-files sweep and the frontend
registration — one file per subject under `tests/integration/`.

> Restricted-egress environments (e.g. sandboxes that can't fetch Python 3.14 or the HA
> core) can't run this mode — CI provisions Python 3.14 and runs it in its own job.

### Online smoke tests (opt-in)

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

### Live-update browser smoke (opt-in)

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

The card must be on a dashboard (deploy e.g. via `scripts/reload_addon.sh`), but no path is
assumed: the run walks the instance's dashboards for a view holding a `custom:haventory-card`
in a normal column — the narrow layout the assertions target — and prints the one it chose.
`--path <ha-url-path>` forces a different view. The test is idempotent — it creates a
uniquely-named item and deletes it (best-effort cleanup even on failure).

### Coverage

- Backend: `scripts/ci_local.sh` produces `coverage.xml` + browsable `htmlcov/index.html`.
- Frontend: `scripts/test_frontend.sh --coverage` (report at `cards/haventory-card/coverage/`).

## Backend (custom component)

- `custom_components/haventory/` with `manifest.json`, `__init__.py`, `config_flow.py`, `services.yaml`.
- Store: `entry.runtime_data.store` with versioned schema and safe writes. Migrations are
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
- Every free-text and collection field is capped on the way in — 4000 characters of
  description, 50 tags, 50 custom fields, and so on beside the 120-character name limit —
  because the store is one JSON document rewritten in full on every mutation. The caps refuse
  growth, never data that already exists: an item written before a cap existed still loads,
  saves, exports and — because a backup must restore — imports, on the backend and in the
  card's editor alike. The full table and the exact rule are in
  [`docs/data_shapes.md`](data_shapes.md) → "Input caps".
- Case-insensitive search; denormalized `location_path` on items; item `version` for optimistic
  concurrency. `version` counts *item* mutations only — renaming or moving a location rewrites
  the derived `location_path` across its whole subtree without bumping `version` or restamping
  `updated_at`, so an expected version taken before the rename is still accepted after it.
- Calendar-derived counts on `haventory/stats`, each with a matching `item/list` filter:
  `overdue_count` / `overdue_only` for a passed `due_date` (checked-out items only, since
  that is where a due date can exist), and `inspection_overdue_count` /
  `inspection_overdue_only` for a passed `inspection_date` — the date the item is next due
  for inspection, over the whole inventory, since an inspection is independent of any
  check-out. Each has a *due* twin that counts today as well:
  `checked_out_due_count` / `checked_out_due_only` and `inspection_due_count` /
  `inspection_due_only`. All of them move with the calendar and emit no event when the date
  rolls over.
- A stored per-item **status** — `ok` / `missing` / `needs_repair`, always exactly one,
  `ok` being the default and the way a flagged state clears. Filterable via the
  `item/list` `status` filter, counted on `haventory/stats` as `missing_count` /
  `needs_repair_count` (stored state, so unlike the calendar counts every change emits
  an event), and settable everywhere an item is written — WS create/update, the
  `haventory.item_create` / `haventory.item_update` services, and import. A store written
  before the field existed is migrated on load (schema v5 backfills `ok`); an export
  without it reads as `ok` too.
- **WebSocket rate limiting (opt-in, off by default)**: per-connection **and** global
  token buckets for commands (excess requests get a `rate_limited` error) and for
  subscription broadcasts (excess events are dropped, never breaking the command).
  Enable and tune it under Settings → Devices & services → HAventory → **Configure**;
  `haventory/health` reports drop counters. Leave it disabled for stress testing
  (`scripts/stress_test.py`). What each setting means and when to enable it:
  [`docs/rate_limiting.md`](rate_limiting.md); wire-level semantics and defaults:
  [`backend_api_contract.md`](backend_api_contract.md) → "Rate limiting".
- **JSON import/export (data safety)** via `haventory/export`, `haventory/import/preview`,
  and `haventory/import/execute`: back up to a versioned document before a breaking update
  and restore afterwards. Preview reports would-be adds/updates/conflicts without touching
  state; execute applies a `merge` / `replace` / `skip` conflict policy and rolls back on
  failure so a bad import never leaves partial state. This **complements** Home Assistant's
  own snapshots/backups — the HAventory store file is already captured by an HA backup;
  import/export adds a portable, human-readable document you can inspect, diff, and restore
  independently of a full-instance snapshot. See
  [`backend_api_contract.md`](backend_api_contract.md) and
  [`docs/data_shapes.md`](data_shapes.md).
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

## Frontend (Lovelace card)

Lit + TypeScript + Vite; tests with Vitest; build outputs to
`custom_components/haventory/www/`. Real-time over WebSocket with optimistic writes
throughout.

- **Sidebar page** — HAventory gets an entry in Home Assistant's sidebar, opening the full
  view as a page of its own with the same ⋮ menu, dialogs and editors the card's full view
  has. It loads the one card bundle and is named after the card title. Turn it off under
  Settings → Devices & services → HAventory → **Configure**; see
  [Finding HAventory after install](installing.md#finding-haventory-after-install).
- **Standard card** — one Add button and a single ⋮ menu (Select items, Organize, Refresh,
  Diagnostics, Export backup / Export current view, Import); Columns is offered in the full
  view, which is the only surface it changes. Live stat badges — items, low stock,
  overdue, due for inspection, reminders to do, checked out — are click-to-filter, and
  which of them a household offers is set under Settings → Devices & services →
  HAventory → **Configure**, or per dashboard with the card's `quick_filters:`. Rows
  carry a quantity stepper, a LOW badge, an overdue check-out chip, an "Inspection due"
  chip, an amber status chip when an item is flagged Missing / Needs repair, and hover
  actions.
- **Filters** — a collapsible panel exposing the whole backend filter object: location
  (from a real tree), area, include-subtree, category chips with counts, tag chips with an
  any/all toggle, low-stock-only, checked-out, overdue, inspection-due, reminder-due and no-location —
  each with the count of what it would keep — a single-select status row (OK / Missing /
  Needs repair, the flagged two priced from the stats counts), plus updated / created
  windows (each row's ≥ flips to ≤ for "before") and sort across every sortable field.
  "Low stock" (a filter) and "Low stock first" (an ordering) are separate, independently
  clearable controls. Active filters appear as removable chips.
- **Editing** — the row expands in place; there is no dialog chain. Full field parity:
  name, description, quantity, low-stock threshold, category, status, tags, location
  (picked from a tree inside the form), checked-out with due date, next inspection (with the same
  +7 / +31 / +90 / +X quick offsets the check-out popover offers), and typed
  custom fields (text / number / yes-no / date). Saves send the item's expected version so
  a concurrent edit surfaces as a conflict; a save that does not land says so in the form
  you are looking at and leaves your edits in it. Escape takes back one thing at a time: an open
  picker first, then the form. **Nothing throws typed edits away without asking** — Cancel,
  the ✕, Escape, tapping the scrim or swiping a phone sheet down, switching to another row,
  and closing the expanded view all raise the same question, and answering "keep" leaves the
  form exactly as it was.
  With no locations yet, the location picker creates the first one and files the item in
  it, rather than pointing at a menu three steps away.
- **Photos and manuals** attach from the same form, once the item exists — an upload is
  filed against an item id, and the create form says so instead of leaving the sections
  unexplained. On a desktop you can also **drop files straight onto the Photos or Documents
  section**; the file's own type decides which it becomes, so a PDF dropped on the photo
  strip attaches as a manual. Each queue reports itself under the section that started it,
  with a moving indicator while a file is in flight; a refused file keeps its error and
  Retry until you dismiss them. Removing an attachment asks first, because the file goes
  with it. A thumbnail is 72px of a photo, so **clicking one opens it full-size** — arrows
  and a counter to walk the strip, Escape to come back — on every surface the form appears
  on, and from the detail sheet's gallery just the same.
- **Full view** — a fullscreen workspace with a coloured app bar, a **browse sidebar**, and
  a sortable table. Only columns the backend can sort by get a clickable header — Location
  among them, ordering on the path each row shows, with items filed nowhere at the end
  whichever way it runs. A browser
  that has made no choice yet shows every optional column but one — quantity, status,
  category, location, tags, due, next inspection, updated — and the ⋮ → **Columns** picker
  is where you thin that down, switch on the one that starts off (**Reminder**), and put
  the ones you keep in the order you want them, with the up/down buttons beside each shown
  column and a **Reset order** back to the canonical one. Reminder is off by default
  because the panel's table has no width to spare: one more column on by default would put
  Location and Tags on their floors, and most households set no reminders at all. The
  order and the selection are one per-browser preference; the table scrolls sideways rather
  than dropping a column you kept.
  The Status column names every row, OK included, and the name's amber status chip stands
  down while it is shown so no row says the same word twice. The
  sidebar leads with the location tree carrying the backend's own per-location counts and
  an orphans row, then **Status**, **Categories** and **Tags** as sections of their own;
  each heading collapses from a chevron and states how many there are — locations counted
  at every depth, Status excepted because there that number would count the household's
  vocabulary rather than anything in the inventory — and
  Locations stays at the top. Every status row is priced from the backend's own per-status
  counts, so a status nothing carries reads 0 rather than inheriting the rest of the
  inventory. Locations, categories and tags all accumulate — pick a second and
  the list widens to hold both, pick a selected one again and it drops out — while
  status stays one value, matching how the backend treats each of them. Several
  categories or locations can only ever mean *or*, since an item has one of each,
  so neither carries the any/all control tags do. With a filter on, each location,
  category and tag row reads "4 / 37" — matches over total — so you can see where the
  matches are rather than a total that never moves. All three switch to the pair together,
  as soon as anything is filtering. Each list drops its own dimension from what it measures
  against, since that list is how you pick one: the location counts ignore the location
  filter, and the category and tag counts ignore the chosen category and tags — so with a
  category as the only filter its own list reads "43 / 43" while the locations beside it
  narrow, rather than one column carrying two kinds of number.
  No row disappears for matching nothing — the same list is what the item editor offers as
  autocomplete. Each heading also offers a create action: Locations opens an inline
  name field, while Categories, Tags and Status open the organize dialog on their own tab —
  a category exists through the items using it, so that is where making one is explained.
  The app bar carries an Organize button of its own, beside the ⋮ that also lists it.
  From the second selected tag on, the Tags heading carries the same any/all control the
  filter panel has, since that is the mode governing what the sidebar just selected. The
  app bar's stat pills are the card's: low in amber, overdue in red, to-inspect in amber,
  checked out, each click-to-filter. All four are derived from the item and mean the same
  thing in every household, which is what lets them share the bar's fixed hues; a status is
  the household's own word in the household's own colour, so the sidebar's Status section
  and the filter chips are where statuses are priced and picked.
  An empty table names the reason and offers a way out — the same
  wording and the same offers as the card's list. Every row carries the same ⋮ the card's
  rows do — Check out with a due date, Check in, Change due date, Delete — so the surface
  built for working through the whole inventory is not the one with the fewest actions per
  row.

  At phone width the sidebar folds away and the surface hands its own breakpoint down to
  the edit form and the filter panel, so both take their phone layouts: one field per row,
  and filters staged behind a "Show N items" commit row exactly as in the card's sheet.
  Tapping a row there opens the same **detail sheet** the card opens — photos, documents,
  facts and check-out, with Edit one tap deeper — rather than dropping you straight into a
  form. On a screen wide enough for the table, the table is the read view and a row click
  opens the form as before.
- **Multi-select and bulk actions** — move, add/remove tags, set category, adjust
  quantity, check out/in and delete over a selection. Work is chunked so progress is
  determinate and cancellable, and the result is reported *per operation*: "39 of 42
  succeeded", every failure named with its reason and a retry scoped to just those.
  Select-all covers loaded rows only and says so, with an explicit "load the rest" path.
- **Organize dialog** — Locations / Categories / Tags / Statuses in one place, reached from
  the full view's app bar as well as its ⋮ menu, each tab stating its
  total above the list and each row offering the same moves: an "N items" link that opens
  the filtered list in the full view, plus rename, merge and delete. Locations keep their collapsible tree and edit inline, with a guarded
  delete that explains what is in the way. Category and tag rename, merge and removal are
  batch rewrites over every affected item; a location merge re-files that location's items,
  re-parents its children and deletes the husk — all with the same progress and
  partial-failure reporting. A location's Area field says what picking one will do before
  you save it: an area belongs to a whole tree, so the line under the select names the tree
  root it will be stored on and how many locations that reaches — and on a location that
  merely inherits, it names the area it inherits. With no Home Assistant areas defined the
  field is not shown at all. The **Parent location** picker offers the areas alongside the
  locations, including areas nothing is filed under yet: picking one moves the whole
  subtree out to the top level *and* into that area, which is how a tree changes rooms.
  The merge target picker offers locations only — an area heads the tree without being part
  of it and holds no items itself, so a merge, which has to hand this location's items to
  something, always names a location. The Statuses tab also sets each status's colour and
  glyph: ten tones that follow your Home Assistant theme, plus an eleventh swatch that
  opens the browser's colour picker for a colour of your own. A colour picked that way is
  used exactly as entered — it is the one mark on the card that does not follow the theme —
  and the chip's text is black or white, whichever reads better on it.
- **Check-out** invites an optional due date (+7 / +31 / +90 / +X day suggestions) rather
  than silently checking out with none — the date is what makes overdue highlighting mean
  anything. "No due date" stays a first-class choice. Checking out a whole selection asks
  the same question once and gives every item the answer.
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
  offers an explicit Refresh. The banners are on **every** surface: the card, the expanded
  view and the sidebar page, with the same wording and the same recovery actions. A view
  left open when Home Assistant goes away says so on its own, without waiting for you to
  try something first.
- Deletes use an in-app confirmation, not `window.confirm`.
- Card auto-registered as a Lovelace resource on integration setup.
- **Note:** after first install, a browser refresh (F5 / Ctrl+Shift+R) is required for the
  card to appear in the picker (standard for all custom cards).

### Card configuration

```yaml
type: custom:haventory-card
title: Pantry   # optional; overrides the integration-wide card title
quick_filters:  # optional; which quick-filter pills this card offers
  - low_stock
  - checked_out
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `title` | string | the integration-wide card title | Names this card, for this dashboard only. |
| `quick_filters` | list | the integration-wide choice, or every pill | Which quick-filter pills the card and its full view offer: `total`, `low_stock`, `overdue`, `inspection_due`, `reminder_due`, `checked_out`. |

Those two are the only options the card reads. Any other key is ignored rather than
rejected, so a stale dashboard config never breaks the card — and the same holds inside
`quick_filters`: an unknown pill name is dropped, and a value that is not a list reads as
the key being absent.

Adding the card from the card picker opens a **visual editor** for `title`; the YAML above
stays equivalent, and switching to it shows the same config. The editor covers `title`
only — the pill choice that reaches every surface (the sidebar panel included) belongs to
the integration's options rather than one dashboard's card, and `quick_filters` above is
the per-dashboard exception to it, set in YAML. Editing a card that carries
`quick_filters` through the visual editor leaves that key exactly as it was.

Without `title`, the card uses the name set under Settings → Devices & services →
HAventory → **Configure** (asked for at setup too, and defaulting to "HAventory"), so one
setting renames every card. Per-dashboard `title:` wins over it — use that when two
dashboards should name the same inventory differently. An open dashboard picks up a
changed name on its next refresh or reload; the change is not pushed live.

`quick_filters` says which pills are *allowed*; a pill still only shows when it has
something to count, so `low_stock` draws nothing while nothing is low. An explicit empty
list is a choice and offers none. `total` is narrower than the other five: only the card
draws it as a pill, and only at full width — the full view and the sidebar page print the
total in their header instead, whichever way it is set.

Omitting the key hands the decision to **Quick-filter pills** under Settings → Devices &
services → HAventory → **Configure**, which is the one place that reaches every surface:
the sidebar panel has no dashboard config of its own, so that setting is all it reads.
Leave both unset — a fresh install, or any dashboard written before either option existed
— and all six pills are offered.

## CI/CD & Ops

- GitHub Actions (`ubuntu-latest`): backend (uv, ruff + mypy + pytest w/ coverage, Python
  3.14), a dedicated **integration** job (in-process HA via phacc, Python 3.14),
  frontend (npm audit + eslint + tsc + vitest + build, Node 22/24 matrix), actionlint,
  hassfest + HACS validation, CodeQL, OpenSSF Scorecard, and dependency review.
  Third-party actions are SHA-pinned; first-party `actions/*` use `@v7`.
- **`ha-latest`** runs the same integration suite against the *newest* Home Assistant on
  the 8th of each month (and on demand via *Run workflow*). The `integration` job above
  pins the declared floor, so this is the only thing in CI that meets a current core. A
  failure here is drift against that newer Home Assistant — not a regression in whatever
  pull request is open that day — and it opens or updates one issue labelled
  `ci:ha-latest`, which a later passing run closes again. It reports no check on a pull
  request and can never block one.
- **`card-smoke`** is the frontend counterpart, on the same schedule: it boots Home
  Assistant `stable` and `beta` in the runner, onboards them over REST
  (`scripts/ci_provision_ha.py`), installs the integration and the built card, and drives
  `cards/haventory-card/e2e/live-updates.smoke.mjs` against each. Nothing in the unit
  suite renders the card against a real Home Assistant, so this is what would catch the
  card's contact surface breaking; a `beta` failure arrives before users upgrade rather
  than after. Same handling: one issue labelled `ci:card-smoke`, closed again by a later
  passing run, and no check on a pull request.
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
- The icons and logos Home Assistant shows for the integration live in
  `custom_components/haventory/brand/` and are served from there, at
  `/api/brands/integration/haventory/<file>` — a custom integration's own images win
  over the brands CDN, so nothing has to be published anywhere for them to appear.
  They are rendered from the card's mark constants and the outlined wordmark by
  `uv run python scripts/render_brand_assets.py`; regenerate rather than edit, and
  `tests/test_brand_assets.py` fails when artwork and mark drift apart.
- Release automation via **release-please**: merging its release PR tags the version,
  drafts the GitHub Release, builds and attaches `haventory.zip` — the bundle HACS
  installs — and publishes the draft last. See [CONTRIBUTING.md](../CONTRIBUTING.md) →
  Releases.
- Contributor guide: [CONTRIBUTING.md](../CONTRIBUTING.md).
- Conventional Commits; update `README.md` when behavior changes.

---

## Reproducible dev environment (.devcontainer)

Open the repo in VS Code / GitHub Codespaces and "Reopen in Container" for a ready-to-go
environment (uv + Node 24). `post-create` runs `uv sync`, installs card deps, and verifies
the offline suite. To bring up a real Home Assistant with HACS against the working
tree, run `bash .devcontainer/develop.sh` (needs network; provisions Python 3.14).

---

## Dev helper scripts

All scripts are Linux/bash under `scripts/`, and the Python helpers assume a UTF-8
terminal. There is no Windows host support — use WSL2.

### Reload into a running HA dev container

```bash
scripts/reload_addon.sh --container <your_container> --tail-logs
```

### WebSocket helper scripts (cross-platform Python)

Quick probes/subscriptions without writing test code. Run via `uv run python scripts/<name>.py`.

They take `HA_BASE_URL`/`HA_TOKEN` from a `.env` at the root of the checkout they are run
from, which **wins over an inherited export** (`HAVENTORY_IGNORE_ENV_FILE=1` hands the
decision back to the environment), and each prints the instance it resolved — plus the
store's item and location totals — on stderr before it acts.

`scripts/ws_probe.py` — send a single WS command and print the first reply:

```bash
export HAV_MSG='{"id":1,"type":"haventory/ping","echo":"hi"}'
uv run python scripts/ws_probe.py
```

`scripts/ws_subscribe.py` — subscribe to a topic (`items` | `locations` | `stats`) and
print events. Optional: `HAV_LOCATION_ID`, `HAV_INCLUDE_SUBTREE`, `HAV_MAX_EVENTS`,
`HAV_MUTATIONS` (JSON array of WS messages to send after subscribing):

```bash
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

### Attachment probes

`scripts/probe_attachments.py` checks the attachment path against a live instance — and
against the **bytes on Home Assistant's disk**, not what the card reported. Pillow comes
from the non-default `probes` dependency group, so a plain `uv sync` stays lean:

```bash
uv sync --group probes
export RUN_ONLINE=1 HA_TOKEN=<token>   # HA_BASE_URL defaults to http://localhost:8123
export HA_CONTAINER=home-assistant     # or HA_CONFIG_DIR for a bind-mounted config
uv run --group probes python scripts/probe_attachments.py
```

It covers the 2 MiB re-encode threshold and the 2048-pixel cap, EXIF orientation applied
before the re-encode, PNG transparency surviving as WebP, an animated GIF kept whole, a
sub-threshold JPEG round-tripping byte-identical, the `206`/`404`/no-answer presence
semantics, and the `Content-Disposition` name. Exit codes: `0` pass, `1` a probe failed,
`2` setup error, `3` timeout.

`scripts/probe_fixtures.py --out DIR` writes those fixtures on their own (~30 MB of
generated images — they are never committed).

---

## Conventions

- Domain/package: `haventory` under `custom_components/haventory`; services `haventory.*`;
  built assets `custom_components/haventory/www/`, served at `/haventory_static/`;
  calendar entity `calendar.haventory`, whose `unique_id` is the constant
  `haventory_calendar`.
- Logging: every module takes its logger from `logs.context_logger`, which writes the
  `extra=` context into the message text as `key=value` pairs and passes the mapping on for
  any structured handler. Home Assistant's formatter renders the message and drops
  everything else, so a field that stayed in `extra=` was invisible in exactly the log a bug
  report carries. Avoid reserved `LogRecord` keys in the extras — use `item_name` /
  `location_name`, not `name`.

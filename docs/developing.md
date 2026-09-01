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

## The gate

Both halves have to be green before every commit. The commands, and why `npm audit` is one
of them, are in [CONTRIBUTING.md](../CONTRIBUTING.md#the-gate).

Or all at once: `scripts/ci_local.sh` (backend lint + types + tests w/ coverage, then
frontend install + audit + lint + types + test + build).

## Testing

There are two backend test modes, kept deliberately separate:

- **Offline (fast, default).** HA is stubbed in `tests/conftest.py`, so the suite runs
  in milliseconds with no HA install. Invoke with plugin autoload disabled; async tests
  use `@pytest.mark.asyncio`:

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
  ```

  The stub **records** what `services.setup()` registers, so which services exist, with
  which schema and which response mode, is asserted here. How HA *dispatches* to a
  handler is asserted in the other mode or it is not asserted at all.

- **In-process HA integration (opt-in).** Runs the integration inside a *real* Home
  Assistant core via [`pytest-homeassistant-custom-component`][phacc] (phacc), catching
  drift against real HA APIs the stubs can't see. See below.

Every feature/fix ships with tests — happy path plus at least one edge/error case.

Timings are measured where the load is real — the `test-haventory` skill's `stress.py`
against a live Home Assistant. A budget asserted inside the offline suite would only be
measuring the runner it happened to land on.

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

Build the card first, or `tests/integration/test_frontend.py` skips half its cases.

`scripts/test_integration.sh` **cannot run on a Windows host**: it builds a POSIX venv path
and HA core imports `fcntl`. Run it in a container with the venv on a named volume — the
first run takes about three minutes, re-runs about thirty seconds, and host edits are picked
up through the mount. The script installs its own interpreter, so the image needs uv and
nothing else:

```bash
MSYS_NO_PATHCONV=1 docker run -d --name hav-int -v "$(pwd):/work" \
  -v hav-int-venv:/work/.venv-integration -w /work \
  ghcr.io/astral-sh/uv:bookworm sleep 7200
MSYS_NO_PATHCONV=1 docker exec hav-int bash -lc 'cd /work && bash scripts/test_integration.sh'
```

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
export HA_CONTAINER=home-assistant     # lets smoke_online.sh purge and reload_addon.sh deploy
export HAV_ONLINE_DESTRUCTIVE=1        # unlocks the purging tests — disposable instances only!
export HA_ALLOW_AREA_MUTATIONS=1       # unlocks the area-registry e2e test

# Deploy the current working tree into the container and (re)create the config
# entry, so the instance matches the local CURRENT_SCHEMA_VERSION:
scripts/reload_addon.sh --container "$HA_CONTAINER"

uv run pytest -q -m online             # all three online files
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
- Frontend: `npx vitest run --coverage` (report at `cards/haventory-card/coverage/`).

## Backend (custom component)

- `custom_components/haventory/` with `manifest.json`, `__init__.py`, `config_flow.py`, `services.yaml`.
- Store: `entry.runtime_data.store` with a versioned schema and safe writes. The schema is
  at **1**, and the load fills in every field a store predates rather than stepping it
  through versions. A store stamped above 1 is refused and never rewritten, so a rollback
  cannot relabel data the running build cannot read. Two refusals, because there are two
  ways out: the stamps 2 through 9 are this project's own from before the collapse to 1,
  and a 0.8.x build is what reads one; anything above them was written by a newer
  HAventory. `import_export` draws the same line on a document's `schema_version`.
- Persistence architecture:
  - **WebSocket / service handlers**: immediate saves via `async_persist_repo` — storage
    errors propagate to clients as `storage_error`.
  - **Shutdown/unload**: immediate save via `async_persist_immediate`.
  - **Concurrency**: all persist paths use `asyncio.Lock` to serialize writes.
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
- A stored per-item **status** — exactly one slug from the store's `statuses` collection,
  which is seeded with the built-in `ok` / `missing` / `needs_repair` and is the
  household's from there: `status/create`, `status/update`, `status/reorder` and
  `status/delete` maintain the vocabulary, and the card's organize dialog is where it is
  edited. `ok` is the fixed default and the way a flagged state clears. Filterable via the `item/list`
  `status` filter, counted on `haventory/stats` as `missing_count` / `needs_repair_count`
  and as `status_counts` for every defined slug (stored state, so unlike the calendar
  counts every change emits an event), and settable everywhere an item is written — WS
  create/update, the `haventory.item_create` / `haventory.item_update` services, and
  import. A store written before the field existed has it filled in on load; an export
  without it reads as `ok` too, and one without a `statuses` section means the built-in
  three.
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
  Identity is the entity id and never the name, which is what a restore onto entities
  deleted and recreated by hand turns on: the contract's `haventory/import/execute` entry
  states the rule and what follows from it.

## Frontend (Lovelace card)

Lit + TypeScript + Vite, tests with Vitest, real-time over WebSocket with optimistic
writes. The build writes one bundle to
`custom_components/haventory/www/haventory-card.js` — git-ignored, and inside the
integration package, which is the only tree HACS copies, so a card change reaches an
install through a release like any backend change. That one bundle draws the dashboard
card and the sidebar page and registers the icon set the backend's `PANEL_ICON` names;
`tests/test_frontend_registration.py` holds the two sides together across a language
boundary neither can check alone.

What the card does for a household is the [README](../README.md#what-it-is) and
[`installing.md`](installing.md); how it is built — the component map, the store, the
shared `ui/` layer, the column preferences, the phone breakpoints and the known gaps — is
[`frontend_architecture.md`](frontend_architecture.md).

Three rules a card change is judged by, in full in
[CONTRIBUTING.md](../CONTRIBUTING.md#conventions): the card renders no `ha-*` element, no
user-facing string is a literal, and a component test mounts through `mountComponent` from
`src/test.utils.ts` rather than a private copy.

- The integration registers the card as a Lovelace resource on setup, under
  `…/haventory-card.js?v=<version>`, and points an entry left at an older version at the
  current URL rather than adding a second one.
- A page already open when the card is installed or rebuilt has to be reloaded once
  before the card is in it; an ordinary reload is enough, because the resource URL carries
  the version and the bundle is served without a `Cache-Control` header.
- Phone surfaces hold a 44px touch minimum (`--hv-tap-min`) and 16px field text — iOS
  zooms a page whose fields are smaller and never zooms back.
- Deletes ask through `hv-confirm`, never `window.confirm`.

## CI/CD & Ops

- GitHub Actions (`ubuntu-latest`): backend (uv, ruff + mypy + pytest w/ coverage, Python
  3.14), a dedicated **integration** job (in-process HA via phacc, Python 3.14),
  frontend (npm audit + eslint + tsc + vitest + build, Node 22/24 matrix), actionlint,
  hassfest + HACS validation, CodeQL, and dependency review.
  Third-party actions are pinned to an immutable revision; first-party `actions/*` are
  pinned by major tag (`tests/test_repo_hardening_offline.py` holds both).
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
- Dependabot: grouped updates for `github-actions`, `npm` (card) and `uv` (Python), plus a
  `pip` block for `requirements-integration.txt` so an advisory in that file arrives as a
  pull request and not only as an alert. Both root Python blocks ignore *version* updates
  to `homeassistant` and `home-assistant-frontend` — they are the declared floor and the
  wheel that release asks for, not dependencies to keep current — and the `pip` block is
  scoped off `pyproject.toml` and the generated `requirements-dev.txt`, which belong to the
  `uv` block.
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
terminal. There is no Windows host support — use WSL2. This is the whole list; a helper
that is not here does not exist.

| Script | What it does |
|---|---|
| `setup.sh` | the one-shot bootstrap under [Setup](#setup-linuxbash) |
| `ci_local.sh` | the whole gate in one run, with coverage |
| `test_integration.sh` | provisions `.venv-integration` and runs the in-process HA suite |
| `reload_addon.sh` | deploys the working tree into a running HA dev container |
| `smoke_online.sh` | the online WebSocket smoke; purges the store first when `HA_CONTAINER` is set |
| `ws_init_haventory.py` | creates the config entry over WebSocket |
| `ci_provision_ha.py` | onboards a fresh Home Assistant over REST — what `card-smoke` uses |
| `probe_attachments.py`, `probe_fixtures.py` | the attachment path against a live instance (below) |
| `render_brand_assets.py`, `brand_wordmark.py` | regenerate `custom_components/haventory/brand/` |
| `check_version_consistency.py`, `check_release_zip.py` | the release checks CI runs |
| `dev_env.py` | which instance a helper is about to talk to (below); imported, never run |
| `common.sh` | the shared bash helpers every `.sh` here sources |

Driving the WebSocket API by hand is the `run-haventory` skill's `driver.py`, which holds
one authenticated connection for a whole sequence: `status`, `send`, `watch` and `smoke`.

### Which instance a helper talks to

Every Python helper takes `HA_BASE_URL` / `HA_TOKEN` from the `.env` at the root of the
checkout it is run from, and that file **wins over an inherited export** — a worktree
carrying its own `.env` names the instance that worktree is for, whatever a shell profile
exported. `HAVENTORY_IGNORE_ENV_FILE=1` hands the decision back to the environment for one
run, which is how a recipe points a helper at a remote instance while a dev `.env` sits in
the tree. Each helper prints the resolved target — the base URL, where that value came
from, and the store's item and location totals — on stderr before it acts, so a run against
the wrong inventory shows up in the first line of output instead of in a number that looks
off later. `scripts/dev_env.py` is where both rules are implemented.

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

`scripts/probe_fixtures.py --out DIR` writes those fixtures on their own; its header says
what the five frames are for and how much disk they take. They are never committed.

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

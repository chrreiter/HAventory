# Developing HAventory

How to set up, test and find your way around the integration and the card.
[CONTRIBUTING.md](../CONTRIBUTING.md) is the process side: the gate that runs before every
commit, the conventions, pull requests and releases.

## Setup (Linux/bash)

You need [uv](https://docs.astral.sh/uv/), git, and a Node inside the range `engines`
declares in `cards/haventory-card/package.json`. uv fetches the Python that
`requires-python` in `pyproject.toml` names. The toolchain is Linux/bash only; on Windows,
work inside WSL2 ([CONTRIBUTING.md](../CONTRIBUTING.md#development-setup)).

```bash
# One-shot bootstrap: uv env + card deps + pre-commit hooks
scripts/setup.sh

# ...or by hand:
uv sync                                   # .venv from pyproject.toml + uv.lock
(cd cards/haventory-card && npm ci)       # card deps from the committed lockfile
uv run pre-commit install                 # optional: ruff and codespell on commit
```

Run every Python tool through uv (`uv run <tool>`) so it uses the locked environment.

## Tooling

- **uv** owns the Python environment and the lockfile. Dev dependencies are the
  `[dependency-groups]` in `pyproject.toml`. `requirements-dev.txt` is a pip-installable
  export for environments without uv: regenerate it with
  `bash scripts/export_dev_requirements.sh` rather than editing it, because
  `tests/test_toolchain_pins.py` fails while it disagrees with the lock.
- **Ruff** lints and formats. The `dev` group pins it exactly, and the hook in
  `.pre-commit-config.yaml` must name the same version (`tests/test_toolchain_pins.py`),
  because two ruff releases can format the same file differently.
- **mypy** checks `custom_components/haventory` against the local Home Assistant stubs in
  `stubs/`. The modules listed in `[[tool.mypy.overrides]]` in `pyproject.toml` are held to
  strict mode; the rest sit at the non-strict baseline.
- **The card** is Lit, TypeScript, Vite and Vitest with jsdom, linted by ESLint's flat config
  (`cards/haventory-card/eslint.config.js`). The versions are the ones `package.json` pins.
- **pre-commit** runs ruff, codespell and the basic hygiene hooks.

## The gate

Both halves, green before every commit. The commands, and why `npm audit` is one of them,
are in [CONTRIBUTING.md](../CONTRIBUTING.md#the-gate). `scripts/ci_local.sh` runs the whole
gate in one go, with coverage, and stops at the first failing step.

## Testing

Every feature or fix ships with tests: the happy path plus at least one edge or error case.
The backend has two test modes, kept apart on purpose.

**Offline** is the default and runs in seconds with no Home Assistant install. HA is stubbed
in `tests/conftest.py`, and the WebSocket stub applies each command's schema before
dispatch, so a test sends the frames a real client could send. Async tests use
`@pytest.mark.asyncio`.

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
```

The stub **records** what `services.setup()` registers, so which services exist, with which
schema and which response mode, is asserted offline. How Home Assistant *dispatches* to a
handler is asserted only in the in-process mode.

**In-process** runs the integration inside a real Home Assistant core, catching drift
against real HA APIs that the stubs cannot see. It is opt-in, below.

Timings are measured against a live Home Assistant with the `test-haventory` skill's
`stress.py`. A budget asserted inside the offline suite would only measure the machine it
ran on.

### In-process HA integration tests (opt-in)

These load a genuine Home Assistant core through
[`pytest-homeassistant-custom-component`](https://github.com/MatthewFlamm/pytest-homeassistant-custom-component)
(phacc). phacc and HA come from `requirements-integration.txt`, which pins HA to the
declared floor and stays out of `pyproject.toml`, `uv.lock` and the offline `.venv`. The
tests live in `tests/integration/`, one file per subject: config-entry setup and unload,
WebSocket CRUD and error envelopes, persistence and schema migration, services and their
broadcasts, the sensors, calendar, repairs, diagnostics, to-do bridge, attachments,
translations, the retired-files sweep and the frontend registration.

```bash
# One-shot: provisions the interpreter and a dedicated .venv-integration, then runs them
scripts/test_integration.sh

# ...or by hand:
uv venv --python 3.14 .venv-integration
uv pip install --python .venv-integration/bin/python -r requirements-integration.txt
.venv-integration/bin/python -m pytest -o asyncio_mode=auto tests/integration
```

- **Do not set `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` here.** phacc must load, and with the flag
  the run silently collects nothing. `tests/conftest.py` sees the real `homeassistant`
  package and installs none of the offline stubs, and the offline run never collects
  `tests/integration/`, so the two modes cannot collide.
- **Build the card first** (`npm run build`), or `tests/integration/test_frontend.py` skips
  half its cases.
- **It needs network access** to fetch the interpreter and Home Assistant. A sandbox without
  it cannot run this mode; CI runs it in its own `integration` job.
- **It cannot run on a Windows host**: the script builds a POSIX venv path and HA core
  imports `fcntl`. Run it in a container with the venv on a named volume. The image needs uv
  and nothing else. The first run takes about three minutes, a re-run about thirty seconds,
  and host edits are picked up through the mount:

  ```bash
  MSYS_NO_PATHCONV=1 docker run -d --name hav-int -v "$(pwd):/work" \
    -v hav-int-venv:/work/.venv-integration -w /work \
    ghcr.io/astral-sh/uv:bookworm sleep 7200
  MSYS_NO_PATHCONV=1 docker exec hav-int bash -lc 'cd /work && bash scripts/test_integration.sh'
  ```

### Online smoke tests (opt-in)

These drive a running Home Assistant over WebSocket: `tests/test_ws_smoke_online.py`,
`tests/test_ws_smoke_advanced_online.py` and `tests/test_ws_areas_online.py`, marked
`online`. Everything they create has a unique name and is deleted again.

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
scripts/smoke_online.sh
# or: uv run pytest -q -m online -k "ws_smoke or ws_smoke_advanced"
```

Two more flags unlock the rest of the suite, **for a disposable instance only** (the Docker
dev container, say):

- `HAV_ONLINE_DESTRUCTIVE=1` runs the scenarios that **purge every HAventory item and
  location** first and then assert exact totals.
- `HA_ALLOW_AREA_MUTATIONS=1` runs the area-registry test, which creates and deletes areas.

```bash
export HA_CONTAINER=home-assistant     # lets smoke_online.sh purge and reload_addon.sh deploy
export HAV_ONLINE_DESTRUCTIVE=1
export HA_ALLOW_AREA_MUTATIONS=1

# Deploy the working tree into the container and (re)create the config entry, so the
# instance runs the local schema:
scripts/reload_addon.sh --container "$HA_CONTAINER"

uv run pytest -q -m online             # all three files
```

Run them sequentially (no `-n`/xdist): the destructive tests assume exclusive access to the
instance. With `HA_CONTAINER` set, `smoke_online.sh` deletes the store before it runs, so
never point it at an inventory you keep.

### Live-update browser smoke (opt-in)

`cards/haventory-card/e2e/live-updates.smoke.mjs` drives the **real card** in headless
Chromium against a running Home Assistant. It creates, renames and deletes an item over a
separate WebSocket connection and asserts that each change reaches the card through its
subscription alone, with no re-list. That catches the "green unit tests, dead feature"
regression unit mocks cannot, because a mock is only as truthful as the contract its author
imagined.

```bash
export RUN_ONLINE=1
export HA_BASE_URL=http://localhost:8123
export HA_TOKEN=<your-long-lived-token>
cd cards/haventory-card
npx playwright install chromium   # one-time; playwright itself is a dev dependency
npm run test:e2e                  # skips cleanly when RUN_ONLINE is unset
```

The card must be on a dashboard (`scripts/reload_addon.sh` deploys it). The run walks the
instance's dashboards for a view holding `custom:haventory-card` in a normal column and
prints the one it chose; `--path <ha-url-path>` picks another. Its test item is deleted even
when the run fails.

### Coverage

- Backend: `scripts/ci_local.sh` writes `coverage.xml` and `htmlcov/index.html`.
- Card: `npx vitest run --coverage` writes `cards/haventory-card/coverage/`.

## Backend architecture

`custom_components/haventory/` is a local-push, single-instance integration. Each module's
docstring states its own constraints; this is the map.

**A write, end to end.** A WebSocket command (`ws.py`) or a `haventory.*` service
(`services.py`) validates its frame against its own schema, then calls the one function in
`ops.py` for that write. The op runs the repository call and returns what the write earns.
The caller then persists, announces and answers, always in that order:

1. **Persist.** `repository.py` holds the inventory in memory with its indexes. Every write
   is awaited through one persist path, serialized by one lock, and a failure reaches the
   client as `storage_error`. There is no scheduled or deferred save; shutdown and unload
   flush immediately.
2. **Announce.** `events.py` has one function per kind of change, and each covers every
   surface at once: the WebSocket topics (fanned out by `subscriptions.py`), the Home
   Assistant bus events, the low-stock diff, and the dispatcher signal the sensors and the
   calendar repaint on. It is the only module that broadcasts, so the two write surfaces
   cannot announce the same change differently.
3. **Answer.** Entities go out through `serialization.py`, shared by both surfaces.

The API contract's "What an event guarantees" is what this order buys.

**Validation** lives in `models.py`: the entity dataclasses, the input and filter shapes,
and every refusal, so one bad value gets one answer on every surface. Most command schema
fields are typed `object` so that the model, not Home Assistant, names the bad field
(contract → "`validation_error` or `invalid_format`").

**Storage** is Home Assistant's `Store`, one JSON document rewritten in full on every
mutation, which is why every free-text and collection field is capped
([`data_shapes.md`](data_shapes.md) → "Input caps"). The load fills in any field a store
lacks rather than stepping it through versions, and `migrations.py` is forward-only and
idempotent. A store stamped with a newer schema than the build knows is refused and never
rewritten, so a downgrade cannot relabel data it cannot read. `import_export.py` draws the
same line on a document's `schema_version`.

**The other modules:** `media.py` (attachment files and the authenticated view that serves
them), `sensor.py` and `calendar.py` / `calendar_projection.py` (entities, repainted on the
dispatcher signal and at local midnight), `todo_bridge.py` (the low-stock set mirrored onto
a to-do list), `repairs.py` and `diagnostics.py`, `config_flow.py`, and `stale_files.py`
(files an upgrade must delete). Areas are read from Home Assistant's area registry and never
created.

**Naming.** Package and domain `haventory`; services `haventory.*`; the card bundle lives in
`custom_components/haventory/www/`, served at `/haventory_static/`; the calendar entity is
`calendar.haventory`, whose `unique_id` is `CALENDAR_UNIQUE_ID` in `const.py`.

### Changing the WebSocket API

1. Add or change the command in `ws.py`: its schema, its handler under `@ws_guard`, and its
   entry in `HANDLERS`. A write both surfaces make goes in `ops.py`, and in `services.py`
   plus `services.yaml` and `strings.json` if it is a service too.
2. Update [`backend_api_contract.md`](backend_api_contract.md) and
   [`data_shapes.md`](data_shapes.md) in the same pull request.
   `tests/test_docs_contract_offline.py` checks the lists in the contract that name code.
3. Test it offline through `ws_send` from `tests/ws_helpers.py`, and in
   `tests/integration/` if it touches a Home Assistant API.
4. If the card calls it, add it to `WSClient` (`cards/haventory-card/src/store/ws.ts`) and
   to `makeMockHass` in `src/test.utils.ts`, which throws on any command it does not handle.

## Frontend

The card is one bundle, `custom_components/haventory/www/haventory-card.js`, git-ignored and
built into the integration package because that is the only tree HACS copies. It draws the
dashboard card and the sidebar page and registers the icon set the backend's `PANEL_ICON`
names; `tests/test_frontend_registration.py` holds the two sides together.

- On setup the integration registers the bundle as a Lovelace resource at
  `…/haventory-card.js?v=<version>`, and repoints an entry left at an older version rather
  than adding a second one.
- A page open when the card is installed or rebuilt needs one ordinary reload: the resource
  URL carries the version, and the bundle is served without a `Cache-Control` header.

How the card is built (the component map, the store, the shared `ui/` layer, the Home
Assistant contact surface, the phone breakpoints and the known gaps) is
[`frontend_architecture.md`](frontend_architecture.md). What it does for a household is the
[README](../README.md#what-it-is) and [`installing.md`](installing.md).

## CI and repository automation

- **CI** (`.github/workflows/ci.yml`) runs the backend gate with coverage, the in-process
  suite pinned to the declared Home Assistant floor (`integration`), the card gate on every
  Node major `engines` names, `actionlint` (through its pre-commit hook), hassfest and HACS
  validation. CodeQL, dependency review and the Conventional-Commit PR-title check run as
  their own workflows.
- **Action pinning.** Third-party actions, `docker://` images included, name an immutable
  revision (a commit SHA or an image digest), because a tag can be repointed by whoever owns
  it. GitHub's own `actions/*` are pinned by major tag. `tests/test_repo_hardening_offline.py`
  enforces both.
- **`ha-latest`** runs the in-process suite against the newest Home Assistant on the 8th of
  each month and on demand. **`card-smoke`**, on the same schedule, boots Home Assistant
  `stable` and `beta`, onboards them over REST (`scripts/ci_provision_ha.py`), installs the
  integration and the built card, and runs the live-update smoke against each. Both catch
  drift against a newer Home Assistant rather than a regression in an open pull request, so
  neither reports a check on a pull request: each opens or updates one issue (labelled
  `ci:ha-latest` / `ci:card-smoke`) and closes it again on a later passing run.
- **Dependabot** groups updates for `github-actions`, `npm`, `uv`, `pip`
  (`requirements-integration.txt`), `docker` (`.devcontainer/Dockerfile`) and
  `devcontainers`. The `uv` and `pre-commit` blocks share one group, so a ruff bump moves the
  pin and the hook rev in one pull request. The declared Home Assistant floor and the
  frontend wheel it asks for are ignored for version updates, because they are floors, not
  dependencies to keep current.
- **`main` is protected** by the checked-in ruleset `.github/rulesets/main.json`: a pull
  request and the CI, CodeQL, dependency-review and PR-title checks are required, and
  force-push and deletion are blocked. The required check names must match the job names in
  `.github/workflows/`, or no pull request can satisfy them. Edit it under *Settings → Rules
  → Rulesets*, or `PUT` the file to `repos/{owner}/{repo}/rulesets/{id}`.
- **Pull request hygiene**: path-based labels (`.github/labeler.yml`), labels as code
  (`.github/labels.yml`), CODEOWNERS review requests, and the issue and PR templates.
- **Brand assets** in `custom_components/haventory/brand/` are what Home Assistant shows
  for the integration, served at `/api/brands/integration/haventory/<file>`; a custom
  integration's own images win over the brands CDN. Regenerate them with
  `uv run python scripts/render_brand_assets.py` rather than editing them;
  `tests/test_brand_assets.py` fails when artwork and mark drift apart.
- **The social preview** is `docs/assets/social-preview.png`, rendered from the `.html`
  beside it. GitHub has no API for it; upload it under *Settings → General*.
- **Releases** are cut by release-please: [CONTRIBUTING.md](../CONTRIBUTING.md#releases).

## Reproducible dev environment (.devcontainer)

Open the repository in VS Code or GitHub Codespaces and choose *Reopen in Container*. The
post-create step runs `scripts/setup.sh` and the offline suite.

To run a real Home Assistant with HACS against the working tree, run
`bash .devcontainer/develop.sh` (needs network). It installs the current stable Home
Assistant into `.venv-ha/` with its config in `.ha-config/` (both git-ignored), symlinks the
integration in and logs HAventory at debug. Open `http://localhost:8123`, onboard, then add
the integration under *Settings → Devices & services*. A restart from the UI picks up the
working tree's current code, and the online smokes run against it with
`HA_BASE_URL=http://localhost:8123` and a long-lived token from its profile page.

On a Windows or macOS host, clone into a container volume (*Dev Containers: Clone Repository
in Container Volume*) rather than reopening a bind-mounted checkout: `.venv`,
`node_modules` and the Home Assistant environment are tens of thousands of small files, and a
bind mount makes every one of them slow.

## Dev helper scripts

Everything under `scripts/` is Linux/bash, and the Python helpers assume a UTF-8 terminal.

| Script | What it does |
|---|---|
| `setup.sh` | the bootstrap under [Setup](#setup-linuxbash); `--ci` skips the pre-commit hooks |
| `ci_local.sh` | the whole gate in one run, with coverage |
| `export_dev_requirements.sh` | regenerates `requirements-dev.txt` from `uv.lock` |
| `test_integration.sh` | provisions `.venv-integration` and runs the in-process suite |
| `reload_addon.sh` | deploys the working tree into a running Home Assistant dev container |
| `smoke_online.sh` | the online WebSocket smoke; purges the store first when `HA_CONTAINER` is set |
| `ws_init_haventory.py` | creates the config entry through Home Assistant's config-flow REST API, then checks `haventory/version` over WebSocket |
| `ci_provision_ha.py` | onboards a fresh Home Assistant over REST; what `card-smoke` uses |
| `probe_attachments.py`, `probe_fixtures.py` | the attachment path against a live instance (below) |
| `render_brand_assets.py`, `brand_wordmark.py` | regenerate `custom_components/haventory/brand/` |
| `check_version_consistency.py`, `check_release_zip.py` | the release checks CI runs |
| `dev_env.py` | which instance a helper talks to (below); imported, never run |
| `common.sh` | the shared bash helpers every `.sh` here sources |

Driving the WebSocket API by hand is the `run-haventory` skill's `driver.py`, which holds one
authenticated connection for a whole sequence: `status`, `send`, `watch` and `smoke`.

### Which instance a helper talks to

Every Python helper takes `HA_BASE_URL` and `HA_TOKEN` from the `.env` at the root of the
checkout it runs from, and that file **wins over an inherited export**, so a worktree's own
`.env` names the instance that worktree is for whatever a shell profile exported.
`HAVENTORY_IGNORE_ENV_FILE=1` hands the decision back to the environment for one run, which
is how a recipe points a helper at a remote instance while a dev `.env` sits in the tree.
Before it acts, each helper prints on stderr the base URL, where that value came from, and
the store's item and location totals, so a run against the wrong inventory shows in the
first line of output. `scripts/dev_env.py` implements both rules.

### Attachment probes

`scripts/probe_attachments.py` checks the attachment path against a live instance, reading
the **bytes on Home Assistant's disk** rather than what the card reported. Pillow comes from
the non-default `probes` dependency group, so a plain `uv sync` stays lean:

```bash
uv sync --group probes
export RUN_ONLINE=1 HA_TOKEN=<token>   # HA_BASE_URL defaults to http://localhost:8123
export HA_CONTAINER=home-assistant     # or HA_CONFIG_DIR for a bind-mounted config
uv run --group probes python scripts/probe_attachments.py
```

It covers the card's re-encode threshold and pixel cap (the constants in
`cards/haventory-card/src/ui/downscale.ts`, mirrored in Pillow), EXIF orientation applied
before the re-encode, PNG transparency surviving as WebP, an animated GIF kept whole, a
small JPEG round-tripping byte-identical, the `206`/`404`/no-answer presence semantics and
the `Content-Disposition` name. Exit codes: `0` pass, `1` a probe failed, `2` setup error,
`3` timeout. `scripts/probe_fixtures.py --out DIR` writes the fixtures on their own; its
header says what each is for. They are never committed.

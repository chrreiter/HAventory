---
name: run-haventory
description: Run, deploy, drive, and screenshot HAventory against the local dev Home Assistant (Docker). Use when asked to start/run the integration, deploy the integration or card into HA, poke the WebSocket API, verify a change in the real running app, or take a screenshot of the Lovelace card or the sidebar panel.
---

HAventory is a Home Assistant custom integration + Lovelace card. "Running the app"
means a **real HA instance in Docker** (container `home-assistant`, `http://localhost:8123`)
with the integration and built card deployed into it. Drive the backend over the HA
WebSocket API via `.claude/skills/run-haventory/driver.py`; drive/screenshot the card
or the sidebar panel in the real HA frontend via
`.claude/skills/run-haventory/screenshot.mjs` (Playwright).

All paths below are relative to the repo root. This is a **Windows host**: run the
`.sh` scripts through Git Bash (they work there), everything else is shell-agnostic.

## Prerequisites

- Docker Desktop with the dev container **`home-assistant`** running
  (`ghcr.io/home-assistant/home-assistant:stable`, port 8123). Check: `docker ps`.
  It was provisioned once by hand (image run + HA onboarding in the browser); if it's
  ever gone, that one-time onboarding has to be redone in a browser — not scripted.
- `uv` (Python 3.14 env) and Node ≥ 22 on PATH.
- Repo-root **`.env`** (gitignored) with the credentials both drivers auto-read:

  ```
  HA_BASE_URL=http://localhost:8123
  HA_TOKEN=<long-lived access token>
  ```

  Do **not** put `HA_CONTAINER` in `.env` — `scripts/smoke_online.sh` purges the
  HAventory store from that container whenever it's set (see Gotchas).

  If `HA_TOKEN` is missing/expired: HA UI → user profile → Security → Long-lived
  access tokens → create, then paste into `.env`.

## Setup

Once per clone (the SessionStart hook already does the first two):

```bash
uv sync
(cd cards/haventory-card && npm ci)
```

One-time for the screenshot harness (installs Playwright + Chromium into the skill dir;
`node_modules/` and `*.png` there are gitignored):

```bash
cd .claude/skills/run-haventory && npm install --no-audit --no-fund && npx playwright install chromium
```

## Deploy current branch into HA

Builds the card **into** `custom_components/haventory/www/` so it rides along with the
component copy, then copies the integration into the container, restarts HA (~30 s), and
initialises the config entry via WS. Run from Git Bash:

```bash
set -a; . ./.env; set +a
bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs
```

Success looks like: `{"ok": true, "version": {...}}` plus a
`Storage health: schema_version=N items=N locations=N` debug log line.
Backend-only change and HA already has the current card? The same script is still the
path — it redeploys both; there is no partial-deploy variant.

The integration serves the bundle itself at `/haventory_static/haventory-card.js`, with
**no `Cache-Control` header**, so the browser revalidates and a rebuild is picked up on a
normal reload — there is nothing to pin. To confirm the server has the new bytes:

```bash
curl -sI "$HA_BASE_URL/haventory_static/haventory-card.js" | grep -i cache-control   # no output
sha256sum custom_components/haventory/www/haventory-card.js
curl -s "$HA_BASE_URL/haventory_static/haventory-card.js" | sha256sum   # must match
```

### Wipe HAventory from the dev HA (fresh-start testing)

`smoke_online.sh` with `HA_CONTAINER` set only removes the store file. For a full purge —
data, config entry, Lovelace resource, deployed code — remove the config entry via REST
first (so the integration unloads and can't flush the store back out on shutdown):

```bash
ENTRY=$(curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "$HA_BASE_URL/api/config/config_entries/entry" \
  | python -c 'import json,sys; print(next(e["entry_id"] for e in json.load(sys.stdin) if e["domain"]=="haventory"))')
curl -s -X DELETE -H "Authorization: Bearer $HA_TOKEN" \
  "$HA_BASE_URL/api/config/config_entries/entry/$ENTRY"
docker exec home-assistant sh -lc \
  'rm -f /config/.storage/haventory_store*; rm -rf /config/custom_components/haventory /config/www/haventory'
```

(`/config/www/haventory` is only there on instances deployed before the bundle moved into
the integration package; new deploys write nothing to `www/`.)

Then redeploy as above. A clean result logs `Storage health: schema_version=N items=0
locations=0`. (`grep -il haventory /config/.storage/*` still matches
`core.entity_registry` if the HA instance itself is named "HAventory Dev" — that is the
weather entity's `original_name`, not a leftover.)

This purge leaves the dashboard alone, but a wipe that goes further — `docker volume rm
ha-config`, a rebuilt container — takes it, and the card does not come back with the
integration: the sidebar panel is registered in code, a dashboard is user data. See
"Putting the card back on a dashboard" below for the WS recipe that restores it.

## Run (agent path)

### WebSocket driver — status / arbitrary commands / smoke

`driver.py` holds **one authenticated WS connection** for a whole command sequence
(so item `version`s and ids flow between steps — `scripts/ws_probe.py` is one message
per connection and can't do that).

```bash
uv run python .claude/skills/run-haventory/driver.py status
uv run python .claude/skills/run-haventory/driver.py smoke
uv run python .claude/skills/run-haventory/driver.py send '{"type":"haventory/ping","echo":"hi"}' '{"type":"haventory/stats"}'
```

| command | what it does |
|---|---|
| `status` | HA version/state + `haventory/version`, `/health`, `/stats` in one JSON blob |
| `send <json>...` | send frames sequentially on one connection; ids auto-assigned; prints each result frame; exit 1 if any `success: false` |
| `smoke` | full CRUD user flow: create location → create item → case-insensitive search → `expected_version` update → stale-version `conflict` check → adjust quantity → delete both (self-cleaning, safe alongside existing data). Prints `[PASS]`/`[FAIL]` per step, ends `SMOKE OK` |

Command catalog + payload shapes: `docs/backend_api_contract.md` and `docs/data_shapes.md`.
Subscriptions (watch events while mutating): `uv run python scripts/ws_subscribe.py`
(env-driven, see its docstring). Seed data: `uv run python scripts/create_test_items.py`.

### Screenshot / drive the card or panel in the real HA frontend

From the skill dir (`cd .claude/skills/run-haventory`):

```bash
node screenshot.mjs                                          # the card in a dashboard column
node screenshot.mjs --search sponges --out screenshot-search.png   # type into the card's search box first
```

Screenshots land in `.claude/skills/run-haventory/*.png` (gitignored). The script
prints browser console errors — check them when the card renders blank.
With no `--path` it opens the discovered `column` view — see "Where the card lives" below.
`--search` exercises the real pipeline
(card → WS → repository index → filtered render), so it doubles as a UI smoke:
searching `sponges` must reduce the list to the one matching item.

#### Where the card lives

**Nothing hard-codes a dashboard.** Every card-driving harness asks the instance where the
card is, through the shared `card_views.mjs`: it walks `lovelace/dashboards/list`, reads
each dashboard's `lovelace/config`, and keeps the views that really hold a
`custom:haventory-card` — at any depth, so a card in a sections grid, a stack or behind a
conditional all count. Ask it yourself:

```bash
cd .claude/skills/run-haventory && node card_views.mjs
```

```
2 view(s) hold custom:haventory-card:
  column  /dashboard-dev/0         sections  dev › view 0
  wide    /dashboard-dev/wide      panel     dev › wide
wide    -> /dashboard-dev/wide
column  -> /dashboard-dev/0
```

Two view **shapes** matter, because the card picks its layout from **its own** rendered
width — 600px, `MOBILE_BREAKPOINT` in `src/ui/responsive.ts` — and not the window's. A
sections column measures ~500px even in a 1440px window, so it gets the narrow branch:

| shape | what qualifies | who asks for it |
|---|---|---|
| `wide` | a `type: panel` view — the card gets the whole content area (~1184px here) | `visual_pass.mjs` desktop, `drive_import.mjs` |
| `column` | any other view — sections, masonry — the column a card normally sits in | `screenshot.mjs`, `visual_pass.mjs` mobile, `import_policies.mjs`, `rl_banner.mjs` |

A view without a `path` is addressed by **index**, which is why the dev instance's sections
view is `/dashboard-dev/0`. Each harness prints the view it resolved and why, so a run says
where it went:

```
view (desktop): /dashboard-dev/wide  ← dev › wide (panel)
view (mobile): /dashboard-dev/0  ← dev › view 0 (sections)
```

Three things discovery does when it cannot give a clean answer, all of them out loud:

- **Nothing found** — no card on any dashboard, HA down, or a non-admin token that cannot
  list dashboards: falls back to `/dashboard-dev/wide` and `/dashboard-dev/0`, the dev
  instance's own views, so the harness still fails with its own message about the root it
  waited for.
- **Only the wrong shape exists** — say, a card that lives solely in a sections column:
  that view is used and the line carries a `WARNING`, because a recipe failing on the
  layout it did not ask for says more than a 404 on a path nothing has.
- **The shape was wrong anyway** — `visual_pass.mjs`'s two card passes assert the branch
  the card actually took (`d-layout`, `m-layout`) before running a single recipe. Enough
  testids are shared between the branches that a wrong-shape run would otherwise pass while
  photographing the other layout.

The sidebar panel at `/haventory` needs none of this — HA routes it from the integration's
own registration, so it is the one surface that survives any dashboard edit, and both
`panel` passes go straight there.

#### Putting the card back on a dashboard

`node card_views.mjs` printing **`0 view(s) hold custom:haventory-card`** means every
card-driving harness is about to run against the fallback paths and fail on a root that
was never there. Nothing puts the card back on its own: the panel is registered by the
integration, but a dashboard is user data, so a `docker volume rm ha-config` — or any
other wipe — takes it and only a human clicking through the sidebar restores it. This
recipe is that human, over WS:

```bash
set -a; . ./.env; set +a
uv run python .claude/skills/run-haventory/driver.py send \
 '{"type":"lovelace/dashboards/create","url_path":"dashboard-dev","title":"Dev","mode":"storage","show_in_sidebar":true,"require_admin":false,"icon":"mdi:flask"}' \
 '{"type":"lovelace/config/save","url_path":"dashboard-dev","config":{"views":[
    {"title":"view 0","type":"sections","sections":[{"type":"grid","cards":[{"type":"custom:haventory-card"}]}]},
    {"title":"wide","path":"wide","type":"panel","cards":[{"type":"custom:haventory-card"}]}]}}'
```

Both views, because the two shapes above are what the harnesses ask for by name — and the
sections one first, since it carries no `path` and is therefore addressed by its index.
Put the panel view first and the sections view becomes `/dashboard-dev/1`, which is a
working dashboard that every remembered `/dashboard-dev/0` now misses.

The `url_path` **must contain a hyphen**; HA answers a single-segment one with
`invalid_format`. `dashboard-dev` is the value `card_views.mjs` falls back to when it finds
nothing, so using that name keeps a half-restored instance pointing somewhere real. Confirm
with `node card_views.mjs`, which should print both views again.

Two answers worth recognising:

- **`The URL "dashboard-dev" is already in use`** — the dashboard survived and only its
  config is gone or wrong. Skip the create and send the `config/save` alone; it overwrites
  whatever is there.
- **`config_not_found` from `lovelace/config`** — a dashboard created but never saved into.
  It exists, the sidebar shows it, and it renders HA's auto-generated strategy view with no
  HAventory card anywhere. `card_views.mjs` counts nothing, correctly. Send the
  `config/save`.

To start over, delete by **`dashboard_id`** — the `id` field `create` and
`lovelace/dashboards/list` return, which is the `url_path` with underscores:

```bash
uv run python .claude/skills/run-haventory/driver.py send \
 '{"type":"lovelace/dashboards/delete","dashboard_id":"dashboard_dev"}'
```

#### The sidebar panel

```bash
node screenshot.mjs --path /haventory --element haventory-panel --out panel.png
```

`--element` names the root the run waits for and scopes `--search`/`--swipe` to; it
defaults to `haventory-card`. The sidebar panel is a **different custom element** —
`/haventory` renders `<haventory-panel>` and no card at all — so shooting it without
`--element` only ever times out. Both flags are needed together; the script says which
roots exist when the wait times out. From Git Bash, prefix the command with
`MSYS_NO_PATHCONV=1` — `--path /haventory` is exactly the leading-slash value the
path-conversion gotcha below mangles.

#### Mobile view + touch/swipe

```bash
node screenshot.mjs --mobile                          # iPhone 15 (390x844, touch on)
node screenshot.mjs --device "Pixel 8" --out m.png    # any Playwright descriptor
node screenshot.mjs --devices                         # list descriptor names
node screenshot.mjs --viewport 390x844                # raw size, touch on
node screenshot.mjs --mobile --dark                   # HA dark theme + dark OS scheme
```

`--mobile`/`--device`/`--viewport` enable `hasTouch` + `isMobile`, so the page takes
the touch / `pointer: coarse` code paths **and HA itself switches to its narrow,
sidebar-collapsed layout** — the card is then laid out exactly as on a phone.
(Playwright's `hasTouch` sets `maxTouchPoints` and `(pointer: coarse)` but leaves
`'ontouchstart' in window` **false**, so the script also launches Chromium with
`--touch-events=enabled` — code that feature-detects touch that way would otherwise
take the desktop path.)

`--search`, `--tap`, `--swipe` and `--wait` run **in the order given on the command
line**, so gestures chain:

```bash
node screenshot.mjs --mobile \
  --tap 'haventory-card [data-testid="add-item"]' \
  --wait 800 \
  --swipe 'down@hv-item-editor' \
  --out sheet-dismiss.png
```

- `--tap <selector>` dispatches a real tap when touch is on (falls back to click on desktop).
- `--swipe <dir>[:<px>][@<selector>]` — `up|down|left|right`, default target
  `haventory-card`, default distance 60 % of the target box. Implemented over CDP
  `Input.dispatchTouchEvent` (touchStart → 16 × touchMove @60 fps → touchEnd), so it is a
  genuine touch stream: scroll containers, `touch-action` rules and any gesture handler
  see exactly what a finger produces.
  Direction is the **finger's** direction — `--swipe up` scrolls the list down.
  The list's scroll container is **`hv-list`** (`--swipe 'up@hv-list'`), which is what
  verifies the header/search stay pinned while only the rows move.
  Measured limits: ~36 px is eaten by Chromium's touch-slop threshold before scrolling
  starts, and there is **no fling momentum** after `touchEnd` (a 200 px swipe scrolls
  164 px and stops dead). Distance-sensitive or momentum-sensitive behaviour needs a
  real device.
- `--full` captures the full scrollable page; `--dsf <n>` overrides the pixel ratio
  (device descriptors default to 3x, which makes big PNGs).

Limitation: this is **Chromium** emulation. iPhone descriptors set an iOS viewport and UA
but not WebKit's engine, so iOS-only issues (safe-area insets, `100vh`/`dvh` behaviour,
momentum-scroll quirks) still need a real device — see "Real phone on the LAN" below.

#### Real phone on the LAN (ground truth)

The container publishes 8123 on the host, so a phone on the same network can hit
`http://<host-LAN-IP>:8123` directly (`ipconfig` for the IP; Windows Firewall must allow
inbound 8123 on the private profile). This is the only way to test real fingers, momentum
scrolling, iOS Safari, and the HA Companion app's webview.

### Drive the import sheet

`drive_import.mjs` puts a backup document through the card's own Import UI — overflow menu →
paste → policy → Preview → optionally Import — and screenshots each step. Preview only unless
`--apply` is passed, because the server-side dry run is the point:

```bash
cd .claude/skills/run-haventory
node drive_import.mjs ~/backup.json                        # preview with merge
node drive_import.mjs ~/backup.json --policy replace       # preview with replace
node drive_import.mjs ~/backup.json --apply --out restore  # WRITES; screenshots the result
```

Defaults: `--policy merge`, `--out import`, and — with no `--path` — the discovered `wide`
view, so the preview table gets its room. The document is pasted
verbatim and deliberately **not** validated first, so malformed input can be used to drive the
card's parse-error and server-rejection paths. `--apply` mutates the instance and import is
all-or-nothing with no undo — export first.

This is what the WS-level scripts cannot check: whether the sheet *describes* the policy the
backend actually applies. `replace` overwrites the ids the document carries and deletes
nothing, which is only visible by reading the sheet next to the counts it produces.

From Git Bash, pass the document as a native path with forward slashes
(`"C:/Users/you/backup.json"`) and prefix the command with `MSYS_NO_PATHCONV=1` if you
override `--path` — see the path-conversion gotcha below.

## Verification harnesses

Four checks that need a real instance and a real browser, each with its own oracle so a
run either passes or says why not. All are read-only except `lifecycle_probe.py`.

| harness | what it proves |
|---|---|
| `rl_banner.mjs` | the card's rate-limit degraded-banner lifecycle, with the WS frames that caused each state |
| `visual_pass.mjs` | every card surface still opens, at desktop and mobile widths, and every panel surface on `/haventory` |
| `import_policies.mjs` | the import sheet describes the conflict policy the backend actually applied |
| `log_sweep.py` | the container log obeys the error taxonomy's severity policy |
| `lifecycle_probe.py` | resource cache-bust rewriting, schema-downgrade refusal, entry removal/re-add |

### Rate-limit banner lifecycle

```bash
cd .claude/skills/run-haventory
node rl_banner.mjs                       # both scenarios; leaves rate limiting OFF
node rl_banner.mjs --scenario exhausted   # just the paused -> Refresh half
node rl_banner.mjs --observe 30           # watch only; never touches the options flow
```

Squeezes the real per-connection command budget through the options flow so the card's
`subscribe` is refused, then reads what it renders. A refusal is retried four times
(400/800/1600/3200 ms), so there are two outcomes to check and both are: a retry that wins
must clear the banner with no user action and offer no button, and a budget that outlasts
the whole window must switch the wording to "until you refresh" and grow a Refresh that
restores live updates. Prints a WS trace next to the banner timeline — a paused banner with
no `rate_limited` frame behind it is a card bug, one with a refusal behind it is the card
doing its job. A scenario whose budget never provoked its state is reported
**INCONCLUSIVE**, not as a pass.

Rate limiting is reset to OFF on the way out, including after a failure — every other
harness assumes it is off.

### Visual surface pass

```bash
cd .claude/skills/run-haventory
node visual_pass.mjs --out before     # then make the change, redeploy
node visual_pass.mjs --out after      # and compare the two folders
node visual_pass.mjs --only mobile --surfaces detail-sheet,filter-sheet
node visual_pass.mjs --only panel         # sidebar panel, desktop width
node visual_pass.mjs --only panel-mobile  # sidebar panel, 375x812
node visual_pass.mjs --list               # surface names
node visual_pass.mjs --path desktop=/other/wide --path mobile=/other/0
```

Four passes — 14 card surfaces at desktop width, 8 at phone width, and the sidebar panel
at both (10 wide, 8 narrow) — each a recipe of clicks against the card's own
`data-testid`s. It is a DOM check as much as a screenshot run: a surface counts as
captured only if its root element exists afterwards, so a renamed testid fails loudly
instead of silently photographing the wrong screen. The two card passes additionally
assert the layout branch the card took (`d-layout`, `m-layout`), which is what makes 42
rows out of 40 surfaces. Exit is non-zero if any of them failed, or the browser logged a
console error. Files are prefixed `d-`, `m-`, `p-` and `pm-`.

The four passes open **three** URLs — two discovered dashboard views and `/haventory` — so
`--path` names the pass it applies to (`--path <pass>=<url>`) and may be repeated. A bare
`--path <url>` is ambiguous across a whole run and is rejected; it is accepted only next to
`--only`, where there is exactly one pass for it to mean:

```bash
node visual_pass.mjs --only desktop --path /dashboard-dev/wide
```

The card's narrow layout is a **different component tree** (sheets, not panels), which is
why the two card lists differ rather than sharing one. The panel's is not: `hv-full-view`
keeps one tree and switches on its own `(max-width: 700px)` query, so `panel-mobile` re-runs
the panel recipes at 375px and adds the three assertions that only hold there — the sidebar
is gone, the filter panel grows a staged apply/cancel footer instead of applying live, and
the app bar shows the button that reopens HA's drawer. That last one is driven by HA's
`narrow` property rather than the media query, so the width has to satisfy both switches.

The panel passes need no `wide` dashboard — HA gives a panel the whole content area.

### Import policy cross-check

```bash
cd .claude/skills/run-haventory
node import_policies.mjs              # synthesizes a document from live data
node import_policies.mjs --doc backup.json
```

Runs all three policies twice — once through `haventory/import/preview` on a direct WS
connection, once through the card's sheet — and compares the eight bucket counts the sheet
renders against the ones the server returned, plus the conflict sentence against the policy
it was computed under. Writes nothing: preview is a server-side dry run and there is no
`--apply`. With no `--doc` it builds its own document by exporting the live inventory,
cutting it to a handful of entities and editing some of them, which is the only way to get
entries in all four buckets without mutating anything.

### Log severity sweep

```bash
uv run python .claude/skills/run-haventory/log_sweep.py --since 30m
uv run python .claude/skills/run-haventory/log_sweep.py --all --show 20
```

Groups the container log into records (so a traceback stays with its header) and sorts them
three ways: **BLOCKING** — an HAventory traceback, an `unknown_error`, or a
client-recoverable code logged at ERROR; **EXPECTED** — the contract's WARNING rejections,
which fuzz layers produce by the hundred; **KNOWN** — type-loose frames HA core rejects
before `ws_guard` runs (open item 53), surfaced without failing the sweep. Exits 1 on any
blocking finding. Run it after every online layer: offline stubs stay green while real HA
throws, which is how the `__slots__` bug was found.

### Lifecycle probe (restarts HA, edits `.storage`)

```bash
uv run python .claude/skills/run-haventory/lifecycle_probe.py resources --yes
uv run python .claude/skills/run-haventory/lifecycle_probe.py downgrade --yes
uv run python .claude/skills/run-haventory/lifecycle_probe.py entry --yes
uv run python .claude/skills/run-haventory/lifecycle_probe.py all --yes
```

`resources` sets the Lovelace resource to each shape a restart can find — hand-pinned
`?v=<hash>`, stale `?v=<old version>`, bare URL, plus the two legacy
`/local/haventory/haventory-card.js` shapes an install predating the integration-served
bundle carries — restarts, and asserts one entry survives **under the original resource
id**; a second entry would load the card module twice and the second
`customElements.define` would throw. `downgrade` writes a higher `schema_version`
into the store and asserts the entry lands in `setup_error` (not `setup_retry` — retrying
cannot teach this build a newer schema) with the payload untouched. `entry` removes the
config entry, checks the resource went with it and the store did not, then re-adds through
the config flow and checks exactly one resource comes back.

`downgrade` and `entry` snapshot the store first and restore it on the way out, including
on failure — but each subcommand restarts the container several times, so point it only at
the disposable dev instance.

## Test

Offline suites (no HA needed — full gate incl. lint is in CLAUDE.md):

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
(cd cards/haventory-card && npx vitest run)
```

Expected at feature freeze: backend 350 passed / 22 skipped in ~11 s; frontend 812 passed
across 42 files in ~30 s.

The harness has its own unit cover for the parts of `card_views.mjs` that decide where a
run looks — which views hold the card, which URL addresses them, what `--path` asked for.
No HA and no dependency beyond Node:

```bash
cd .claude/skills/run-haventory && node --test
```

The in-process HA integration suite (`scripts/test_integration.sh`, real HA core via
phacc) does **not** run on this Windows host: the script builds a POSIX venv path and HA
core imports `fcntl`. A throwaway `python:3.14-slim` container is the proven way to run it
here — one `docker run` with the repo bind-mounted, `pip install -r
requirements-integration.txt`, then `pytest -o asyncio_mode=auto tests/integration`. That
path also covers hosts whose WSL has no DNS.

Online smoke against the running container (non-destructive as long as
`HA_CONTAINER` is unset — verify with `echo $HA_CONTAINER` first):

```bash
set -a; . ./.env; set +a
RUN_ONLINE=1 bash scripts/smoke_online.sh
```

Expected: `8 passed, 13 skipped` (the skips need `HA_CONTAINER`, i.e. the destructive
clean-start mode), then `Online smoke test completed successfully.`

## Gotchas

- **Git Bash rewrites any argument that looks like an absolute POSIX path** (MSYS path
  conversion), so a leading-slash flag value never reaches the script intact:
  `node screenshot.mjs --path /dashboard-dev/wide` navigates to
  `http://localhost:8123C:/Program Files/Git/dashboard-dev/wide`, and a `/c/Users/...`
  document path arrives as `C:\c\Users\...`. The per-pass form is rewritten too —
  `--path desktop=/dashboard-dev/wide` arrives as
  `desktop=C:/Program Files/Git/dashboard-dev/wide`, since conversion looks at the value
  after the `=`. Prefix the command with `MSYS_NO_PATHCONV=1`, or pass file paths natively
  with forward slashes (`"C:/Users/you/backup.json"`). Discovery leaves `--path` rarely
  needed, which is exactly why it bites the first time you do set one.
- **An unknown view path is not a 404** — Home Assistant keeps the URL and renders view 0.
  A harness pointed at a renamed or deleted view therefore finds a perfectly healthy card
  in the *other* layout, and every recipe whose testids exist in both branches passes on
  the wrong screen. That silent wrong-shape run is what discovery avoids by asking rather
  than assuming, and what `visual_pass.mjs`'s `d-layout` / `m-layout` checks catch when a
  `--path` override points a pass somewhere stale.
- **A card change you can't see in the browser**: the bundle is served without
  `Cache-Control`, so the browser revalidates and a plain reload is normally enough.
  Check the deployed bytes with the `sha256sum` pair under Deploy before concluding the
  fix didn't work; a hard reload (Ctrl+Shift+R) settles the rest.
- **`.storage/lovelace_resources` on disk lags the running instance by ~15 s.** HA's
  `Store` debounces its writes, so reading that file right after a restart shows the
  *previous* resource URL while the in-memory collection already serves the new one.
  Ask the running instance (`lovelace/resources` over WS, as `lifecycle_probe.py` does)
  rather than the file — a stale read here looks exactly like the cache-busting rewrite
  having failed, and it has not.
- **HA's service worker reloads the page ~30–90 s into a fresh browser context**,
  destroying Playwright's JS execution context mid-run. It looks exactly like a card
  crash but leaves no console output and no HA log entry. `screenshot.mjs` blocks
  service workers for this reason; the resulting single `navigator.serviceWorker is
  undefined` console error comes from HA's own bundle, not the card.
- **HA dark mode is independent of the OS `prefers-color-scheme`** — a card has to be
  checked in all four combinations. Drive HA's side with a `selectedTheme`
  localStorage entry (`{"dark":true}`) before load, the OS side with
  `page.emulateMedia({ colorScheme })`.
- **`HA_CONTAINER` turns `smoke_online.sh` destructive**: when set, the script
  `rm -f`s `haventory_store` inside that container and restarts HA before testing —
  all dev items/locations are gone. Leave it unset unless you *want* a wiped store.
- **`item/list` filter key is `q`, not `query`/`search` — and unknown filter keys are
  silently ignored**, so a typo'd filter matches *everything* instead of erroring.
  If a "filtered" list looks unfiltered, check the key.
- **`location_path` shape** is `{id_path, name_path, display_path, sort_key}` (see
  `docs/data_shapes.md`) — not `names`/`ids`.
- **Login bypass**: the HA frontend accepts an injected `hassTokens` localStorage entry
  with the long-lived token as `access_token`, a future `expires`, and
  `clientId === origin + "/"` (what `screenshot.mjs` does). No password needed, no
  login form automation.
- **Playwright selectors pierce shadow DOM but text extraction does not** —
  `haventory-card` and its inner `input[placeholder="Search"]` are directly selectable
  despite Lit shadow roots, yet `locator.innerText()` on a shadow host reads its *light*
  DOM and comes back empty. To read what a component renders, go through the root:
  `locator.evaluate((el) => el.shadowRoot.textContent)`.
- **`fill()` is unusable for a whole-inventory document** — a ~1 MB export types through
  the input pipeline for minutes and blows past Playwright's 30 s default. Set `value` and
  dispatch the `input` event the component listens for instead; that is one round trip
  (~6 s for 981 KiB, versus a 180 s timeout).
- **`reload_addon.sh` overwrites the container's `configuration.yaml`** with
  `dev/ha_config_for_dev.yaml` (previous one backed up as `.bak` inside the container).
  Fine for the dev container; don't point it at a container whose config you care about.
- **HA restart is slow**: after `docker restart`, WS auth succeeds only ~20–30 s later.
  `reload_addon.sh --sleep 30` covers it; with the default `--sleep 8` the final
  WS entry-init step can race a not-yet-up HA (it prints a WS-init error — harmless,
  rerun `uv run python scripts/ws_init_haventory.py`).
- **aiohttp `ws_connect` timeout**: passing a `ClientTimeout` to `ws_connect` is deprecated —
  use `aiohttp.ClientWSTimeout(ws_receive=...)` (per-receive budget). All WS scripts now use
  the new form; to bound the *upgrade handshake* wrap `ws_connect` in
  `asyncio.wait_for(..., timeout=connect_timeout_s)` (`ClientWSTimeout` does not cover it).
- **Mutations rejected with error code `conflict`** mean a stale `expected_version` —
  that's optimistic concurrency working, not a bug; re-`get` the item and retry.

## Troubleshooting

- **`screenshot.mjs`: "Redirected to the login page — hassTokens injection was rejected"**:
  `HA_TOKEN` in `.env` is invalid/expired. Mint a new long-lived token (see
  Prerequisites) and update `.env`.
- **Driver exits 3 with "Connection error … is HA up at …?"**: container stopped or
  still restarting. `docker ps`, `docker start home-assistant`, wait ~30 s, retry;
  `docker logs home-assistant --since 2m` for startup errors.
- **Smoke step `[FAIL] item/list case-insensitive search` returning many items**: the
  filter key regression above (`q` silently ignored → match-all).
- **Every card harness times out waiting for `haventory-card`, and the panel is fine**:
  the dashboard is gone, not the card. `node card_views.mjs` says `0 view(s)`; put it back
  with the recipe in "Putting the card back on a dashboard".

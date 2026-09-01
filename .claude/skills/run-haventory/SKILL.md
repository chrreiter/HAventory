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

All paths below are relative to the repo root and every command is **Linux/bash**, which is
the only development host the repo supports — on Windows the supported path is WSL2
(`CONTRIBUTING.md`). Notes tagged **[Windows/Git Bash]** cover driving a Windows host's
Docker and filesystem through Git Bash instead; nothing else here depends on them.

## Prerequisites

- Docker (Docker Desktop on a Windows host) with the dev container **`home-assistant`** running
  (`ghcr.io/home-assistant/home-assistant:stable`, port 8123). Check: `docker ps`.
  It was provisioned once by hand (image run + HA onboarding in the browser); if it's
  ever gone, that one-time onboarding has to be redone in a browser — not scripted.
- `uv` (Python 3.14 env) and Node 22.13+ (or ≥ 24, per the card's `engines`) on PATH.
- A **`.env`** (gitignored) at the root of the checkout you are standing in, with the
  credentials every driver and harness auto-reads:

  ```
  HA_BASE_URL=http://localhost:8123
  HA_TOKEN=<long-lived access token>
  ```

  Which instance that resolves to, and how to override it for one run, is
  `scripts/dev_env.py`'s rule — written out in `docs/developing.md` → "Which instance a
  helper talks to". Every driver and harness prints the resolved target on stderr before
  it acts (`[target] HA_BASE_URL=…`), the Python ones with the store's counts.

  Do **not** put `HA_CONTAINER` in `.env` — `scripts/smoke_online.sh` purges the
  HAventory store from that container whenever it's set (see Gotchas).

  If `HA_TOKEN` is missing/expired: HA UI → user profile → Security → Long-lived
  access tokens → create, then paste into `.env`.

## Setup

The repository's own bootstrap is `docs/developing.md` → "Setup"; the SessionStart hook
already runs it.

One-time for the screenshot harness (installs Playwright + Chromium into the skill dir;
`node_modules/` and `*.png` there are gitignored):

```bash
cd .claude/skills/run-haventory && npm install --no-audit --no-fund && npx playwright install chromium
```

## Deploy current branch into HA

Builds the card **into** `custom_components/haventory/www/` so it rides along with the
component copy, then copies the integration into the container, restarts HA (~30 s), and
initialises the config entry via WS. Run from the repo root:

```bash
set -a; . ./.env; set +a
bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs
```

Success looks like: `{"ok": true, "version": {...}}` plus a
`Storage health op=setup_storage_health schema_version=N items_count=N locations_count=N`
debug log line.
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

Then redeploy as above. A clean result logs `Storage health op=setup_storage_health
schema_version=N items_count=0 locations_count=0` — at DEBUG like every other healthy load,
so an empty store says nothing at HA's default level. (`grep -il haventory /config/.storage/*`
still matches
`core.entity_registry` if the HA instance itself is named "HAventory Dev" — that is the
weather entity's `original_name`, not a leftover.)

This purge leaves the dashboard alone, but a wipe that goes further — `docker volume rm
ha-config`, a rebuilt container — takes it, and the card does not come back with the
integration: the sidebar panel is registered in code, a dashboard is user data. See
"Putting the card back on a dashboard" below for the WS recipe that restores it.

## Run (agent path)

### WebSocket driver — status / arbitrary commands / smoke

`driver.py` holds **one authenticated WS connection** for a whole command sequence, so
item `version`s and ids flow between steps and a subscription stays open while another
window mutates.

```bash
uv run python .claude/skills/run-haventory/driver.py status
uv run python .claude/skills/run-haventory/driver.py smoke
uv run python .claude/skills/run-haventory/driver.py send '{"type":"haventory/ping","echo":"hi"}' '{"type":"haventory/stats"}'
uv run python .claude/skills/run-haventory/driver.py watch --count 3
uv run python .claude/skills/run-haventory/driver.py watch items stats --timeout 60
```

| command | what it does |
|---|---|
| `status` | HA version/state + `haventory/version`, `/health`, `/stats` in one JSON blob |
| `send <json>...` | send frames sequentially on one connection; ids auto-assigned; prints each result frame; exit 1 if any `success: false` |
| `watch [topic...]` | subscribe to `items`, `locations`, `stats`, `statuses` — or to the ones named — and print every event frame as it arrives. Runs until interrupted; `--count N` stops after N events, `--timeout SECONDS` after that much wall clock. A refused subscribe prints and exits 1 |
| `smoke` | full CRUD user flow: create location → create item → case-insensitive search → `expected_version` update → stale-version `conflict` check → adjust quantity → delete both (self-cleaning, safe alongside existing data). Prints `[PASS]`/`[FAIL]` per step, ends `SMOKE OK` |

`watch` is the "did that mutation actually broadcast?" tool: start it in one shell,
mutate in another, and read what came out. It only subscribes, so it is safe against
any instance.

Command catalog + payload shapes: `docs/backend_api_contract.md` and `docs/data_shapes.md`.
Seeding an instance is one `haventory/import/execute` of a generated document — `driver.py
send`, or `drive_import.mjs` below when the import sheet is what you want exercised — which
creates the locations along with the items rather than one WS call per row.

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
| `column` | any other view — sections, masonry — the column a card normally sits in | `screenshot.mjs`, `visual_pass.mjs` mobile, `import_policies.mjs` |

A view without a `path` is addressed by **index**, which is why the dev instance's sections
view is `/dashboard-dev/0`.

**Choosing between dashboards.** Discovery searches every dashboard and takes the first
matching view in `lovelace/dashboards/list` order, which is the right answer on an instance
with one card-bearing dashboard and an arbitrary one on an instance with two. Every harness
takes `--dashboard <url path or title>` (matched case-insensitively against either) to
narrow discovery before the shape is picked:

```bash
node visual_pass.mjs --dashboard household        # or --dashboard lovelace-household
node screenshot.mjs --dashboard "Family kitchen" --out kitchen.png
```

A `--dashboard` naming nothing is an **error**, not a fallback — quietly opening another
dashboard's card is the exact failure the flag exists to remove, and the message lists what
discovery did find. A `--path` names a URL outright and still wins for the pass it targets.

Each harness prints the view it resolved and why, so a run says where it went:

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
  photographing the other layout. Two desktop surfaces carry that check themselves, because
  they drive components the narrow branch also mounts: `d-02-filter-panel` asserts the
  filter sheet's Apply button is **absent** (both branches mount the same `hv-filter-panel`,
  but the desktop one applies each change live and renders no footer), and `d-11-full-view`
  asserts the shell's **`open-full-view` footer link** is present — `hv-card-shell` renders
  it only when it is not in its narrow branch, and the shell stays in the DOM under the
  modal. The full view itself cannot carry that check: it is a modal at any width and sizes
  its sidebar off the *window*, so a narrow card opening it in a wide window still shows the
  sidebar. The sidebar is asserted beside the link as the mirror of `pm-01-page`, which
  asserts the same element hidden at 375px.

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
roots exist when the wait times out. [Windows/Git Bash] prefix the command with
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
`http://<host-LAN-IP>:8123` directly — `ip addr` for the IP ([Windows/Git Bash] `ipconfig`),
and the host firewall has to allow inbound 8123 (on Windows, on the private profile). Docker
running *inside* WSL2 publishes onto the VM rather than the LAN, so that case additionally
needs mirrored networking mode or a `netsh interface portproxy` forward. This is the only way
to test real fingers, momentum scrolling, iOS Safari, and the HA Companion app's webview.

### Measure the DOM / read a component's state

```bash
cd .claude/skills/run-haventory
node probe.mjs --eval 'deepQuery("hv-list").getBoundingClientRect().toJSON()'
node probe.mjs --element haventory-card --mobile \
  --search projector --tap '[data-testid="row-secondary"]' --out row.png
node probe.mjs --viewport 900x800 --locale de-DE \
  --eval '({ bar: deepQuery(".appbar").clientWidth, heading: deepQuery(".appbar h2").scrollWidth })'
```

`probe.mjs` is `screenshot.mjs`'s sibling for numbers instead of pixels: same login, the same
`--path`/`--element`/`--mobile`/`--viewport`/`--locale`/`--dark`, the same actions in the order
typed (`--search`, `--click`/`--tap`, `--fill '<sel>=><value>'`, `--press`, `--wait`) — plus
`--eval '<expression>'`, which runs last. It answers what a screenshot only shows: whether that
chip really fits inside its line, what state a component holds, and — by injecting a `<style>`
into a shadow root — whether a CSS hypothesis works on the running card before it is written
into the source. `node probe.mjs --help` lists every flag, and `--out` still takes a screenshot
of the state the actions left behind.

- The JSON result is the **only** thing on stdout; the target line, each action and any console
  error go to stderr, so `node probe.mjs --eval … | jq .` works.
- `deepQuery(sel)` / `deepQueryAll(sel)` are in scope and walk every open shadow root — a plain
  `querySelector` stops at the first boundary and every HAventory component sits behind one. The
  expression may `await`, and its value has to survive `JSON.stringify`: return
  `…getBoundingClientRect().toJSON()` or a plain object of numbers, never a node.
- Defaults are the sidebar panel (`/haventory`, `haventory-panel`) at 1280x900 with no touch.
  `--element haventory-card` with no `--path` asks `card_views.mjs` where the card is.
- **`--viewport` alone only resizes the window**, unlike `screenshot.mjs`: it leaves `isMobile`
  off, because that flag switches HA to its narrow, sidebar-collapsed layout, which is not the
  layout a desktop window of the same width has. `--touch` adds the phone emulation, `--mobile`
  is the whole iPhone 15 descriptor.
- `--locale de-DE` decides the language only while the **profile's** language is unset (HA then
  falls back to the browser's); a profile that names a language wins over the flag — set it over
  WS as under "Screenshot the setup and options screens".
- [Windows/Git Bash] prefix the command with `MSYS_NO_PATHCONV=1` when you pass `--path /haventory`.

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

[Windows/Git Bash] pass the document as a native path with forward slashes
(`"C:/Users/you/backup.json"`) and prefix the command with `MSYS_NO_PATHCONV=1` if you
override `--path` — see the path-conversion gotcha below.

### Screenshot the setup and options screens

Neither dialog has a URL of its own, so both are opened by clicking through HA's own UI:

```bash
cd .claude/skills/run-haventory
node shot_options.mjs --out de            # de-entry.png, de-options.png + the step text
node shot_config_flow.mjs --out de-setup  # de-setup-step.png
node shot_config_flow.mjs --out de-setup --submit   # CREATES the config entry
```

`shot_options.mjs` opens the integration page and presses Configure, so it works whatever
language the profile is in — it matches the button on either spelling. `shot_config_flow.mjs`
goes through HA's own `/_my_redirect/config_flow_start?domain=haventory`, which **only starts
when no entry exists**: HAventory is single-instance, so the caller has to remove the entry
first and `--submit` is how it is put back.

The language is the Home Assistant *profile's*, not a flag. Set and restore it over WS —
`value: null` is what the profile looks like before anyone chose:

```bash
D=.claude/skills/run-haventory/driver.py
uv run python $D send '{"type":"frontend/set_user_data","key":"language","value":{"language":"de"}}'
uv run python $D send '{"type":"frontend/set_user_data","key":"language","value":null}'
uv run python $D send '{"type":"frontend/get_user_data","key":"language"}'   # confirm
```

Removing the entry keeps the store (`.storage/haventory_store` is not touched) but **drops
the entry's options**, so read them out first and put them back through the options flow
afterwards — every section key is required in that POST, `todo` included:

```bash
docker exec home-assistant python -c "import json; d = json.load(open('/config/.storage/core.config_entries')); print([e['options'] for e in d['data']['entries'] if e['domain'] == 'haventory'])"
```

## Verification harnesses

Six checks that need a real instance and a real browser, each with its own oracle so a
run either passes or says why not. All are read-only except `lifecycle_probe.py`.

| harness | what it proves |
|---|---|
| `visual_pass.mjs` | every card surface still opens, at desktop and mobile widths, and every panel surface on `/haventory` |
| `import_policies.mjs` | the import sheet describes the conflict policy the backend actually applied |
| `two_tab.mjs` | a mutation nobody in the browser made repaints every open card |
| `reload_probe.mjs` | a reload and an options change leave the card, the panel and the sidebar working |
| `log_sweep.py` | the container log obeys the error taxonomy's severity policy |
| `lifecycle_probe.py` | resource cache-bust rewriting, schema-downgrade refusal, entry removal/re-add |

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
node visual_pass.mjs --dashboard household   # an instance with two card dashboards
```

Four passes — 14 card surfaces at desktop width, 8 at phone width, and the sidebar panel
at both (10 wide, 8 narrow) — each a recipe of clicks against the card's own
`data-testid`s. It is a DOM check as much as a screenshot run: a surface counts as
captured only if its root element exists afterwards, so a renamed testid fails loudly
instead of silently photographing the wrong screen. The two card passes additionally
assert the layout branch the card took (`d-layout`, `m-layout`), which is what makes 42
rows out of 40 surfaces; the desktop filter-panel and full-view surfaces each carry that
check for themselves as well, so they fail on the narrow branch on their own rather than
relying on the pass-level one. Exit is non-zero if any of them failed, or the browser logged a
console error. Files are prefixed `d-`, `m-`, `p-` and `pm-`.

The four passes open **three** URLs — two discovered dashboard views and `/haventory` — so
`--path` names the pass it applies to (`--path <pass>=<url>`) and may be repeated. A bare
`--path <url>` is ambiguous across a whole run and is rejected; it is accepted only next to
`--only`, where there is exactly one pass for it to mean:

```bash
node visual_pass.mjs --only desktop --path /dashboard-dev/wide
```

`--dashboard` is the other half: it narrows *discovery* for the whole run rather than naming
a URL, so both card passes stay on the dashboard you meant and keep choosing their own view
shape within it. See "Where the card lives".

The card's narrow layout is a **different component tree** (sheets, not panels), which is
why the two card lists differ rather than sharing one. The panel's is not: `hv-full-view`
keeps one tree and switches on its own `(max-width: 700px)` query, so `panel-mobile` re-runs
the panel recipes at 375px and adds the three assertions that only hold there — the sidebar
is gone, the filter panel grows a staged apply/cancel footer instead of applying live, and
the app bar shows the button that reopens HA's drawer. That last one is driven by HA's
`narrow` property rather than the media query, so the width has to satisfy both switches.

The panel passes need no `wide` dashboard — HA gives a panel the whole content area.

### Two tabs, one mutation from neither of them

```bash
cd .claude/skills/run-haventory
node two_tab.mjs                     # via haventory.item_create, the service path
node two_tab.mjs --ws                # via haventory/item/create, the control
node two_tab.mjs --path /dashboard-dev/0 --out narrow
```

Two `context.newPage()` tabs are two independent HA WebSocket connections; the mutation goes
out over a **third**, by default as the core `call_service` frame Developer Tools → Actions
sends. So neither tab made the change and both have to repaint on their own — which is what
separates "the backend broadcast it" from "the card that sent it patched itself".

Both tabs type the probe name into the search box first, so the oracle is a row appearing out
of nothing, next to the WS frames each tab actually received. Creates one item and deletes it
again; screenshots land as `<out>-a.png` / `<out>-b.png`.

`--ws` is the control worth running next to any failure: if the WebSocket command repaints
both tabs and the service call does not, the gap is in the service path, not in the card.

### A reload and an options change, with two tabs open

```bash
cd .claude/skills/run-haventory
node reload_probe.mjs                 # reload, then options changed and changed back
node reload_probe.mjs --out before    # to compare two builds
```

One tab on the card, one on `/haventory`, neither touched. Reloads the entry over REST, then
drives the **real options flow** (fresh `flow_id` per POST, every section key present, the
values read back out of the form so the instance's own settings are restored). Watches for
the `unavailable` notice on each open topic, for the card re-subscribing on its own, for a
mutation afterwards still repainting it, and for the sidebar entry still being there.

Two of its lines are worth reading rather than just passing. `panel after reload` records
whether the open `/haventory` tab still carries the panel element at `/haventory`; it does,
because a reload re-applies the same title and module URL and an unchanged registration is
left in place — a count of 0, or a URL that has become the default dashboard, means the
reload dropped the panel. `panel mid-change` is the line where that redirect can legitimately
show: a rename or a sidebar toggle has to remove the registration before it can re-add it,
and for that moment the frontend sends whoever is standing on the page to the default
dashboard. The run leaves one item behind only if the delete at the end failed.

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
which fuzz layers produce by the hundred; **KNOWN** — ERROR lines HA core writes on its own
account for a rejection the integration already logged at WARNING: type-loose frames it
rejects before `ws_guard` runs (open item 53), a refused `haventory.*` service call (core's
`call_service` logs every `HomeAssistantError` at ERROR, its own `ServiceValidationError`
included) and the REST `/api/services` view's 500 for the same refusal — surfaced without
failing the sweep, because no change in the integration can quiet them. Exits 1 on any
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
`?v=<hash>`, stale `?v=<old version>`, bare URL, a URL carrying a second query parameter
— restarts, and asserts one entry survives **under the original resource id**; a second entry would load the card module twice and the second
`customElements.define` would throw. `downgrade` writes a higher `schema_version`
into the store and asserts the entry lands in `setup_error` (not `setup_retry` — retrying
cannot teach this build a newer schema) with the payload untouched. `entry` removes the
config entry, checks the resource went with it and the store did not, then re-adds through
the config flow and checks exactly one resource comes back.

`downgrade` and `entry` snapshot the store first and restore it on the way out, including
on failure — but each subcommand restarts the container several times, so point it only at
the disposable dev instance.

## Test

The repository's test surfaces are the sibling `/test-haventory` skill's job: the offline
gate and its expected counts, the stress regimen, the browser smoke and the online pytest
smokes. The in-process HA suite and its container recipe are in `docs/developing.md`.

What lives here is the harness's own unit cover for the parts that decide where a run looks,
which instance it looks at and whether it is signed in: `card_views.mjs` (which views hold
the card, which URL addresses them, what `--path` and `--dashboard` asked for, which `.env`
wins), `login.mjs` (the shape Home Assistant accepts the injected token in), `probe.mjs`
(which actions run in which order, and which screen a measurement was taken on) and
`surfaces.mjs`, whose
tables are checked about themselves — every selector a desktop surface asserts **absent** has
to be one a narrow surface asserts present, so a typo cannot leave a `hidden` check passing
vacuously. No HA and no dependency beyond Node:

```bash
cd .claude/skills/run-haventory && node --test
```

Online smoke against the running container (non-destructive as long as
`HA_CONTAINER` is unset — verify with `echo $HA_CONTAINER` first):

```bash
set -a; . ./.env; set +a
RUN_ONLINE=1 bash scripts/smoke_online.sh
```

Expected: `8 passed, 13 skipped` (the skips need `HA_CONTAINER`, i.e. the destructive
clean-start mode), then `Online smoke test completed successfully.`

## Gotchas

- [Windows/Git Bash] **Git Bash rewrites any argument that looks like an absolute POSIX
  path** (MSYS path conversion), so a leading-slash flag value never reaches the script intact:
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
- **`--full` mis-paints a fixed sheet on a page that scrolls.** A `fullPage` capture
  stitches the document at its own height, and the card's sheets are
  `position: fixed; bottom: 0; max-height: 92dvh` — so on a page even 28px taller than the
  viewport the panel's edge and the content slotted into it are painted against two
  different heights, and whatever sits at the top of the sheet comes out clipped by about
  9px. Nothing is clipped in the DOM: `getBoundingClientRect()` in the same state puts the
  panel at 65 and the pill at 74. This is what produced
  [#560](https://github.com/chrreiter/HAventory/issues/560)'s screenshot. Photograph a
  sheet with a plain viewport capture (what `visual_pass.mjs` does), and read a rect before
  believing a `--full` picture of one.
- **HA dark mode is independent of the OS `prefers-color-scheme`** — a card has to be
  checked in all four combinations. Drive HA's side with a `selectedTheme`
  localStorage entry (`{"dark":true}`) before load, the OS side with
  `page.emulateMedia({ colorScheme })`.
- **The harness browser speaks the host's language.** Chromium takes its locale from the
  host and Home Assistant falls back to the browser language whenever the profile has none
  — so with the profile cleared the whole UI, HAventory included, comes up in the host's
  language and a screenshot proves nothing about which language a string came from. Name it: `screenshot.mjs --locale en-US`, or set
  the profile language over WS (see "Screenshot the setup and options screens"). Only
  `screenshot.mjs` and `probe.mjs` take `--locale`; drive the others by setting the
  profile.
- **`HA_CONTAINER` turns `smoke_online.sh` destructive**: when set, the script
  `rm -f`s `haventory_store` inside that container and restarts HA before testing —
  all dev items/locations are gone. Leave it unset unless you *want* a wiped store.
- **`item/list` filter key is `q`, not `query`/`search`.** A typo'd key is refused, not
  dropped: the reply is `validation_error` naming it (`unknown filter key(s): …`), in a
  filter and a sort alike. So an empty-looking result is a real result, and a request that
  errors on a key you thought was valid is the API telling you the key does not exist.
- **`location_path` shape** is `{id_path, name_path, display_path, sort_key}` (see
  `docs/data_shapes.md`) — not `names`/`ids`.
- **Login bypass**: the HA frontend accepts an injected `hassTokens` localStorage entry
  with the long-lived token as `access_token`, a future `expires`, and
  `clientId === origin + "/"`. No password needed, no login form automation. Every
  harness gets it from `login.mjs` (`signIn(page|context, {base, token, dark})`), and
  asks `atLoginPage(page)` right after its first navigation — a refused token is not an
  error anywhere, it is a page where every selector times out.
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
  `q` predicate reached the repository and matched too much, so look at the search index
  and its casefold/accent normalization — a filter key that failed to apply would have
  come back as a `validation_error` instead, not as a wide result.
- **Every card harness times out waiting for `haventory-card`, and the panel is fine**:
  the dashboard is gone, not the card. `node card_views.mjs` says `0 view(s)`; put it back
  with the recipe in "Putting the card back on a dashboard".

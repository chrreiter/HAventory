---
name: run-haventory
description: Run, deploy, drive, and screenshot HAventory against the local dev Home Assistant (Docker). Use when asked to start/run the integration, deploy the integration or card into HA, poke the WebSocket API, verify a change in the real running app, or take a screenshot of the Lovelace card.
---

HAventory is a Home Assistant custom integration + Lovelace card. "Running the app"
means a **real HA instance in Docker** (container `home-assistant`, `http://localhost:8123`)
with the integration and built card deployed into it. Drive the backend over the HA
WebSocket API via `.claude/skills/run-haventory/driver.py`; drive/screenshot the card
in the real HA frontend via `.claude/skills/run-haventory/screenshot.mjs` (Playwright).

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

Builds the card (`npm ci` + `vite build`), copies integration + card into the container,
restarts HA (~30 s), and initialises the config entry via WS. Run from Git Bash:

```bash
set -a; . ./.env; set +a
bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs
uv run python .claude/skills/run-haventory/pin_resource.py   # <- always
```

Success looks like: `{"ok": true, "version": {...}}` plus a
`Storage health: schema_version=N items=N locations=N` debug log line.
Backend-only change and HA already has the current card? The same script is still the
path — it redeploys both; there is no partial-deploy variant.

**`pin_resource.py` is not optional after a card change.** HA serves `/local/` with
`Cache-Control: public, max-age=2678400` (31 days, no revalidation), so the browser
keeps running the *old* card from disk cache even though the new file is on the server.
The script re-registers the Lovelace resource as
`/local/haventory/haventory-card.js?v=<content-hash>` — a new build is a new URL, which
no cache can satisfy — and collapses the duplicate resource HA's restart re-adds. To
confirm the server itself has the new bytes:

```bash
sha256sum cards/www/haventory/haventory-card.js
curl -s "$HA_BASE_URL/local/haventory/haventory-card.js" | sha256sum   # must match
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

Then redeploy as above. A clean result logs `Storage health: schema_version=N items=0
locations=0`. (`grep -il haventory /config/.storage/*` still matches
`core.entity_registry` if the HA instance itself is named "HAventory Dev" — that is the
weather entity's `original_name`, not a leftover.)

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

### Screenshot / drive the card in the real HA frontend

From the skill dir (`cd .claude/skills/run-haventory`):

```bash
node screenshot.mjs                                          # default dashboard view
node screenshot.mjs --search sponges --out screenshot-search.png   # type into the card's search box first
```

Screenshots land in `.claude/skills/run-haventory/*.png` (gitignored). The script
prints browser console errors — check them when the card renders blank.
`--path /lovelace/default_view` is the default view; that dashboard already contains
`custom:haventory-card`. `--search` exercises the real pipeline
(card → WS → repository index → filtered render), so it doubles as a UI smoke:
searching `sponges` must reduce the list to the one matching item.

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

Defaults: `--policy merge`, `--out import`, `--path /lovelace/wide`. The document is pasted
verbatim and deliberately **not** validated first, so malformed input can be used to drive the
card's parse-error and server-rejection paths. `--apply` mutates the instance and import is
all-or-nothing with no undo — export first.

This is what the WS-level scripts cannot check: whether the sheet *describes* the policy the
backend actually applies. `replace` overwrites the ids the document carries and deletes
nothing, which is only visible by reading the sheet next to the counts it produces.

On Windows pass the document as a native path with forward slashes
(`"C:/Users/you/backup.json"`); a `/c/...` MSYS path reaches Node as `C:\c\...`.

## Test

Offline suites (no HA needed — full gate incl. lint is in CLAUDE.md):

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
(cd cards/haventory-card && npx vitest run)
```

Expected (as of WP4): backend ~200 passed / 22 skipped in ~7 s; frontend 163 passed
across 17 files in ~11 s.

Online smoke against the running container (non-destructive as long as
`HA_CONTAINER` is unset — verify with `echo $HA_CONTAINER` first):

```bash
set -a; . ./.env; set +a
RUN_ONLINE=1 bash scripts/smoke_online.sh
```

Expected: `8 passed, 13 skipped` (the skips need `HA_CONTAINER`, i.e. the destructive
clean-start mode), then `Online smoke test completed successfully.`

## Gotchas

- **A card change you can't see in the browser is almost always the 31-day
  `/local/` cache** — run `pin_resource.py` (see Deploy) before concluding the fix
  didn't work. Hard-reload (Ctrl+Shift+R) also works, once.
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

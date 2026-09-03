# Release Testing Plan: first public release readiness

Manual validation of HAventory on **real** Home Assistant instances, run against the release
candidate proposed for the HACS listing.

The automated suites (offline gate, in-process integration tests, online WS smokes, the
stress regimen) are assumed green before this plan starts; see `docs/developing.md`. This
document covers only what those suites cannot: real hardware, real phones, real networks,
real upgrades, real backups.

Out of scope: feature work and the backlog, which live in the GitHub issue tracker. Fixes,
docs and release chores found alongside this plan are issues too, staged under
[#236](https://github.com/chrreiter/HAventory/issues/236) when they block the first public
release. This file is tests only.

**Which release this runs against.** The release candidate proposed for the HACS listing,
whatever `0.x` carries every pending fix when the listing is cut. There is no feature
freeze, so the candidate is identified when the run starts rather than fixed in advance.
`1.0.0` is deferred indefinitely and gates nothing
([#278](https://github.com/chrreiter/HAventory/issues/278)).
[#236](https://github.com/chrreiter/HAventory/issues/236) is authoritative if this paragraph
ever falls behind it, and [#276](https://github.com/chrreiter/HAventory/issues/276) is the
issue that executes the run.

**Sequencing.** The run belongs after the candidate is cut and before the listing is
submitted. The minimum supported HA version is the floor declared in `hacs.json`, so D6 runs
against whatever that file declares at the time. D6 is the live half of that claim; the
in-process suite already runs the integration at the floor in CI.

---

## Exit criteria

A release is "ready" when **all** of the following hold:

1. Every scenario marked **Blocker** below passes on at least the environments listed for it.
2. Every non-blocker failure is triaged with an impact rating (a GitHub issue, staged under
   #236 if it must land before the first public release) and **no failure rated High
   remains open**.
3. `haventory/health`'s `counts` match what the card shows after **every** lifecycle
   scenario in groups D and E, checked after the restart, not before.
4. No unhandled exception or traceback from `custom_components.haventory` appears in the HA
   log across the entire run.
5. No uncaught frontend console error on desktop **or** on the phone webview.
6. Every item [#236](https://github.com/chrreiter/HAventory/issues/236) lists as mandatory
   before the first public release is closed.

---

## Test environments

| Env | What | Used for |
|-----|------|----------|
| **ENV-A** | Personal production HA instance, real data, real hardware | Everything except destructive scenarios (D8, E2–E4) |
| **ENV-B** | Throwaway HA in Docker (`scripts/reload_addon.sh`, `run-haventory` skill) | Destructive and adversarial scenarios; YAML-mode Lovelace |
| **ENV-C** | Docker HA pinned to the **declared minimum supported version** (`hacs.json` `homeassistant`) | D6, validates the floor |
| **ENV-D** | Docker HA restored from an **ENV-A production backup** | E2–E4 restore scenarios, without risking ENV-A |

Clients to cover: desktop Chrome, one of Firefox/Safari desktop, **iOS companion app**,
**Android companion app**, plus a tablet or wall panel if one exists. Record which client
each result came from; several scenarios only fail on one of them.

---

## Instrumentation: set this up before starting

**1. Logging.** In `configuration.yaml`:

```yaml
logger:
  default: warning
  logs:
    custom_components.haventory: debug
```

Run `debug` for groups A–H. Before the group-J soak, confirm the debug log volume is sane
over 24 h; if it is not, drop to `info` for the soak and note that in the results. Review
logs for accidental PII and for anything at WARNING+ that is **not** a contract-defined
client-recoverable rejection. `validation_error`, `not_found` and `conflict` each log
exactly one WARNING line, no traceback, by design. A traceback from
`custom_components.haventory` is always a finding (exit criterion 4).

**2. Objective consistency check.** `haventory/health` reports the `counts` aggregates over
the **in-memory** repository. Called *after a restart* they describe what was rehydrated
from disk, which makes them the corruption check for this plan: a count that dropped is data
that did not come back. `issues` is empty on every build and `healthy` is always `true`, so
**the counts are the whole oracle**. Read `counts` and compare the numbers.

```bash
HAVENTORY_IGNORE_ENV_FILE=1 HA_BASE_URL=http://<host>:8123 HA_TOKEN=<token> \
  uv run python .claude/skills/run-haventory/driver.py send '{"type":"haventory/health"}'
```

Pass = `counts` matching what the card shows.

`HAVENTORY_IGNORE_ENV_FILE=1` is what makes the two variables beside it win. Without it the
`.env` in the checkout takes precedence, and the driver would answer for the local dev
instance instead of the release-test host. It prints the target it resolved on stderr; read
that line before reading the result.

**3. Store snapshots.** Before and after every destructive scenario:

```bash
cp /config/.storage/haventory_store /config/haventory_store.<scenario>.<before|after>.json
```

Compare with `jq -S . a.json > a.s && jq -S . b.json > b.s && diff a.s b.s`. `jq .` failing
at all is itself a corruption finding.

**4. Frontend console.** Keep devtools open on desktop. For the phone, use Safari remote
debugging (iOS) or `chrome://inspect` (Android) against the companion app webview.
Card-side errors never reach `home-assistant.log`, so without this the mobile groups are
untested for errors.

**5. Per-session record.** HA version, HAventory version (`haventory/version`), card build,
client and OS version, date. Put it in the results log.

---

## Scenarios

`Blocker` = must pass to release. Steps are abbreviated; pass criteria are the contract.

### A: Install and first run

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| A1 | Fresh install on a clean HA (ENV-B): HACS or manual copy, restart, add integration via config flow, add card via the UI card picker | Integration sets up without error; card appears in the picker; empty state renders with no locations and no console error | ✅ |
| A2 | Card resource auto-registration (storage-mode Lovelace) | `/haventory_static/haventory-card.js?v=<version>` present exactly once in `.storage/lovelace_resources`; `curl -I` on it returns 200 with **no** `Cache-Control` header; card loads without a manual step | ✅ |
| A3 | YAML-mode Lovelace (ENV-B, `lovelace: mode: yaml`) | Resource registration is skipped with a clear log line, and the card still loads through the frontend extra-module URL | ✅ |
| A4 | Attempt a second config entry | Picking HAventory in the "Add integration" picker while an entry exists opens Home Assistant's own "This integration allows only one configuration" dialog and starts no flow (older frontends hid the brand instead); a flow initiated outside the picker aborts with "Already configured. Only a single configuration is possible." No duplicate storage or resource | |
| A5 | First run with a pre-existing store (upgrade in place from a dev instance) | Existing items and locations load; `haventory/health`'s `counts` match the store they came from | ✅ |
| A6 | Attachment round trip, automated: `RUN_ONLINE=1 HA_TOKEN=<token> uv run --group probes python scripts/probe_attachments.py` | All probes pass. The stored bytes on HA's disk match what the card's re-encode should have produced: 4032×3024 JPEG capped at 2048, transparent PNG stored as WebP with its alpha, animated GIF untouched with all 24 frames, sub-2 MiB JPEG byte-identical | ✅ |
| A7 | EXIF orientation, from the same run (case "EXIF Orientation=6 is applied before the re-encode") | The stored frame is upright: portrait 1536×2048, not landscape. This is the one attachment defect that looks correct in every automated test and wrong on every phone, so read this line even when the run is green overall | ✅ |
| A8 | Attachment liveness and naming, from the same run | The presence probe answers `206` with `Content-Length: 1` on a live file, `404` on a deleted one, and nothing at all on an unreachable host; a manual is served `inline` under its title (its filename when untitled), non-ASCII intact | |
| A9 | Save a manual from the browser: open an item's Documents row, save the file | It saves under the attachment's title, or the original filename when untitled, never the attachment UUID; clicking still opens it in a tab rather than downloading it | |

Fixtures for A6–A8 are generated, never committed: `scripts/probe_fixtures.py` writes them
into a temporary directory each run, and `--fixtures-dir DIR` reuses one across runs.
Reading the stored bytes needs either `HA_CONFIG_DIR` (a bind-mounted config) or
`HA_CONTAINER` (read out through `docker exec`). Pillow comes from the non-default `probes`
dependency group: `uv sync --group probes` first.

### B: Mobile / touch (companion app)

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| B1 | Portrait phone: walk the full CRUD path (create item, edit, adjust quantity, move, delete) | Every interactive control is hittable one-handed; no target smaller than ~44 px; no horizontal scroll | ✅ |
| B2 | On-screen keyboard vs. dialogs (item dialog, location selector, custom fields) | Focused field stays visible; Save/Cancel reachable without dismissing the keyboard | ✅ |
| B3 | Landscape and tablet width | Layout reflows; no clipped or overlapping controls | |
| B4 | Dark mode and one custom HA theme | Text/background contrast holds; no hard-coded colors that break | |
| B5 | System large-font / display-zoom setting | Rows and dialogs remain usable, no truncated labels | |
| B6 | Long or awkward values: 60-char names, German compound words, emoji, deep `location_path` | Values wrap or ellipsize; row height stays stable; search still finds them | |
| B7 | Check-out and due-date flow on the phone, then check-in | Date picker usable; stored date matches what was picked, displayed in local time; a DST-boundary date (late Oct / late Mar) stores the intended day | ✅ |
| B8 | Live update: mutate on desktop, watch the phone | Change appears within ~1 s without touching the phone | ✅ |
| B9 | Long-list scrolling: pull-to-refresh gesture, momentum scroll, sticky headers | No gesture trap; the app's pull-to-refresh does not fight the list | |
| B10 | Export download **and** import file picker from inside the companion app webview | Export file lands somewhere retrievable; import picker opens and accepts a file. Webviews commonly break both | ✅ |
| B11 | *Take photo* tile in the item editor on both phones | iOS companion app opens the camera and the shot lands upright and under the 8 MB cap; Chrome on Android opens the camera; the Android companion app opens its file picker instead (upstream home-assistant/android#6055) and the library tile still adds a photo taken with the camera app | |

### C: Connectivity

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| C1 | Disable WiFi mid-session, re-enable after ~1 min | No stuck spinner; the disconnect is visible to the user, not silent; card recovers on reconnect | ✅ |
| C2 | Disable WiFi **while a mutation is in flight** | Exactly-once outcome: the write either landed or did not (verify against the store snapshot); no duplicate item, no silent loss | ✅ |
| C3 | **Stale after reconnect**: put the phone offline, mutate several items from the desktop, bring the phone back | The areas come back current and the item rows do not. `store.ts`'s `watchConnectionGaps` raises the connection-lost banner once the socket has been down past its grace period and re-reads the areas when it reports ready again; nothing re-reads the items, because Home Assistant re-issues the subscriptions before it reports ready, so the events fired into the closed socket are gone. Expect the banner to clear over a list that is still stale; record which rows were stale and what it took to clear them | ✅ |
| C4 | Restart HA while the card is open | Card reconnects; no error spam; data correct after reconnect | ✅ |
| C5 | Background the companion app 30+ min, then resume (iOS especially) | Socket re-established; list is current, not stale | ✅ |
| C6 | Remote access over Nabu Casa, reverse proxy or VPN | Card asset loads over the external URL; subscriptions work; latency is tolerable for quantity adjustments | ✅ |

### D: Lifecycle: restart, update, rollback

Run `haventory/health` after **each** of these and compare its `counts`, and snapshot the
store around D7–D9.

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| D1 | Clean HA restart | Data intact; `haventory/health`'s `counts` unchanged | ✅ |
| D2 | Hard kill mid-write (`docker kill` during a bulk operation) | Store file is valid JSON, not truncated; at most the in-flight mutation is lost; `haventory/health`'s `counts` are the pre-kill numbers or one less | ✅ |
| D3 | Config-entry reload (no HA restart) | Reload succeeds; subscriptions re-established; no duplicate WS handler registration | ✅ |
| D4 | HA minor update (current stable to next stable) with HAventory installed | Setup succeeds; no deprecation warnings from `custom_components.haventory` | ✅ |
| D5 | HA **next beta** | Same; any breakage is filed before it reaches stable | |
| D6 | Minimum supported HA, the `hacs.json` floor (ENV-C). The phacc suite already runs the integration in-process at that version in CI; D6 is the live counterpart with a real container, the card and the browser | Integration sets up and the full CRUD path works on the declared floor; if it does not, the floor is wrong and must be raised before release | ✅ |
| D7 | Integration update N to N+1 **with real data** | Data intact and `haventory/health`'s `counts` unchanged; a restart that changes nothing writes nothing to the store | ✅ |
| D8 | Integration **rollback** N+1 to N (ENV-B only) | Newer-schema data is **refused loudly**: setup fails with `ConfigEntryError` naming both versions and the store file is left byte-identical, never migrated down, never silently relabeled (fixed by #120). An export taken before the update is the way back across a schema change | ✅ |
| D9 | Card update with a warm browser cache: update the integration, then reload normally (no hard refresh), on desktop **and** in the companion app | New card version actually loads; check `haventory/version` against the card build. The resource is registered as `…haventory-card.js?v=<manifest version>` and a stale entry is rewritten in place (fixed by #122) | ✅ |

### E: Backup and restore

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| E1 | Take a full HA backup; inspect the archive | Contains `.storage/haventory_store`, `.storage/lovelace_resources`, and `custom_components/haventory/www/haventory-card.js` | ✅ |
| E2 | Backup taken **while HAventory is being written to** (run a bulk import during the backup), restore into ENV-D | Restored store is valid JSON; `haventory/health`'s `counts` match the pre-backup numbers ± the in-flight batch | ✅ |
| E3 | Restore an **older** backup into the **current** integration (ENV-D) | A backup carrying no stamp, or stamped 1, loads and lands at v1 with the fields it predates filled in; data intact, `haventory/health`'s `counts` unchanged | ✅ |
| E4 | Restore a backup stamped **2–9**, and one stamped **above every number this project ever used**, into the current integration (ENV-D) | Both are refused loudly, as D8, and each names its own way out: the 2–9 stamp says to install 0.8.x and let it read the store once, the higher one says to upgrade HAventory | ✅ |
| E5 | Partial or selective backup | Document the minimum set a user must select to fully restore HAventory. The card bundle rides inside `custom_components/haventory/`, so the set is the store plus the integration folder, or "reinstall the integration and restore only the store". The Lovelace resource is rebuilt on setup and does not have to be backed up | ✅ |

### F: Data integrity and scale

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| F1 | Structural audit of the store after a mixed workload (creates, moves, renames, deletes, bulk ops) | `jq` parses it; no duplicate ids; every `item.location_id` resolves to an existing location; every `location_path` matches the current tree; every `version` ≥ 1 | ✅ |
| F2 | `haventory/health`'s `counts` after each of D1–D9 and E2–E4 | `counts` match the pre-scenario numbers, allowing for what the scenario changed | ✅ |
| F3 | Scale on **real** hardware: load ~2× the real inventory and measure create, update and list latency | Latency is acceptable at the target size; record the size at which it degrades and publish it as a supported ceiling. Every mutation re-serializes the whole dataset, and the README's Known limitations carries the curve measured so far. This row is where the number for real hardware comes from ([#277](https://github.com/chrreiter/HAventory/issues/277)) | ✅ |
| F4 | Store file size across the run | Growth is proportional to content; no unbounded growth from repeated edits | |
| F5 | Rename a location near the root of a deep tree | All descendant items' `location_path` rewritten; their `version` and `updated_at` unchanged; `haventory/health`'s `counts` unchanged | |

### G: Multi-client and permissions

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| G1 | Phone and desktop open simultaneously; edit the same item from both | The loser gets a `conflict` with a usable recovery path ("View latest"), not a dead form or a silent overwrite | ✅ |
| G2 | Same card on two dashboards or two browser tabs, left open through several mutations | Both stay in sync; no duplicated or leaked subscriptions (compare subscription count before and after navigating away and back) | ✅ |
| G3 | Log in as a **non-admin** HA user | What the README's Known limitations describes, seen live: the sidebar panel is there (it is registered `require_admin=False`) and the whole inventory reads and edits, because no WS command and no `haventory.*` service asks whether the caller is an administrator. Household-wide by design, decided in [#479](https://github.com/chrreiter/HAventory/issues/479). The finding this row can produce is a difference from that description, not the absence of gating | ✅ |
| G4 | Two different HA users editing concurrently | Live updates cross users; no per-user state bleed | |

### H: Import / export

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| H1 | Export the full inventory; inspect the document | `haventory_export_version`, `schema_version`, `integration_version` present; counts match `haventory/stats` | ✅ |
| H2 | Round trip: export, wipe, import | Resulting dataset is equivalent to the original (ids, quantities, locations, custom fields, check-out state) | ✅ |
| H3 | Import onto a **non-empty** store under each policy: `merge`, `replace`, `skip` | Preview matches the executed result for each policy; `add`/`update`/`conflict` classifications are correct | ✅ |
| H4 | Import malformed input: truncated JSON, valid JSON of the wrong shape, a foreign export, an empty file | Rejected with actionable validation errors; **store untouched** (verify by snapshot diff) | ✅ |
| H5 | Import an export whose `schema_version` is above the running build's: one stamped 2–9, one stamped higher still | Both refused, and the card shows the message each earns: the 2–9 stamp is told to re-export on 0.8.x, the higher one to upgrade HAventory | |
| H6 | Export and re-import the **full real inventory** from the phone | Completes without timeout; see also B10 | ✅ |

### I: Services and automations

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| I1 | Call each `haventory.*` service from a script or automation, every service `services.yaml` declares, twelve of them today: `item_create`, `item_update`, `item_delete`, `item_move`, `item_adjust_quantity`, `item_set_quantity`, `item_check_out`, `item_check_in`, `reminder_bump`, `location_create`, `location_update`, `location_delete` | Each succeeds; the change is visible in the card immediately | ✅ |
| I2 | Call a service with invalid data (missing required field, bad `expected_version`) | Error surfaces in the HA UI/log with a usable message; no partial mutation | ✅ |
| I3 | Build the three automations `docs/automations.md` documents: one triggered by `haventory_item_changed`, one by `haventory_low_stock` with `action: entered`, one by a `calendar.haventory` event start | Each fires from an ordinary edit made in the card: checking an item out fires `haventory_item_changed` with `action: checked_out`, dropping a quantity below its threshold fires `haventory_low_stock` once on the crossing, and an item carrying tomorrow's date (a reminder, an inspection, or the due date on something checked out) puts an all-day event on the calendar for the trigger to pick up. The payloads carry the fields the documented templates read (`name`, `quantity`, `low_stock_threshold`), and both bus events are fired after the write, so an automation that calls a `haventory.*` service straight back reads the saved item | |

### J: Soak

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| J1 | 7 days uptime on ENV-A with a card left open on a spare device or tablet | HA process RSS stable (no monotonic climb attributable to HAventory); card still responsive without a reload; store size stable | ✅ |
| J2 | Daily `haventory/health` and store snapshot during the soak | `counts` match the card every day; snapshots differ only by real changes | ✅ |
| J3 | Log review at the end of the soak | No repeated warnings, no unbounded log growth, no reserved-`LogRecord`-key breakage, no PII | ✅ |

---

## Results log

Copy a row per attempt. `Result` = pass / fail / n-a.

**Run 1 (2026-09-02/03, session V of #276, against the v0.9.0 release).** Per-session record:
HA 2026.8.3 on ENV-B (`home-assistant`, the dev container, plus the throwaway `hav-b`, `hav-e`
and `hav-e2`; `hav-b` moved to 2026.9.0 and the `beta` tag for D4/D5), HA 2026.6.0 on ENV-C
(`hav-c`); HAventory 0.9.0 from the tag build's `haventory.zip` (sha256 `68557cc3…`, bundle
`968b5d79…`, byte-identical to a local build of `ea8bedc`); client Chromium 151 headless
(Playwright, desktop 1280×900 and iPhone 15 emulation) on Windows 10 Pro 19045; the dev HA
seeded with the 558-item household (92 locations, 42 attachments) on the real 0.8.1 first, so
the 0.9.0 install was a true upgrade. Two findings, each fixed and re-run before the log
closed: #712 (the setup-time attachment sweep on a store-less boot, fixed in #713) and #715
(topic subscriptions leaked on every in-app navigation, fixed in #716). ENV-A, ENV-D and the
phone were not available to this run (owner's decision, 2026-09-03): the rows that need them
stay open on #276 and are listed at the end of the table.

| ID | Env | Client | HA ver | HAventory ver | Date | Result | Notes / open-item ref |
|----|-----|--------|--------|---------------|------|--------|-----------------------|
| A1 | ENV-B (hav-b, blank HA) | Chromium (HA UI) | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | manual copy of the release zip into `custom_components/haventory/` (what HACS's `zip_release` extracts), restart, "Add integration" → brand search → HAventory → config-flow form → "Successfully configured HAventory"; entry `loaded`; `/haventory` renders the empty panel; dashboard "Add card" → By card → HAventory tile → editor preview → Save → the card renders "No items yet. Add your first item, or restore a backup."; 0 console errors. HACS-app install itself needs the owner's HACS GitHub login (private repository): owner hand-test |
| A2 | ENV-B (hav-b, fresh) | curl + WS | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | `.storage/lovelace_resources` holds exactly one `/haventory_static/haventory-card.js?v=0.9.0`; `curl -I` 200, ETag + Last-Modified, no `Cache-Control` |
| A3 | ENV-B (hav-b) | Chromium | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | `lovelace: mode: yaml` + `ui-lovelace.yaml` holding the card: after the restart the log reads "Lovelace in YAML mode; the card loads through the frontend module URL instead op=frontend_register url=…?v=0.9.0" (at DEBUG, the plan's logger block on), and the card renders on `/lovelace/inv` with its four items through the extra-module URL, no manual resource step |
| A4 | ENV-B (hav-b) | REST + Chromium | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | a flow started outside the picker aborts `single_instance_allowed` (HA's "Already configured. Only a single configuration is possible."); one entry, one resource, options intact; the picker half is in the A1 row |
| A4 | ENV-B (hav-b) | Chromium (HA UI) | 2026.8.3 | 0.9.0 | 2026-09-02 | pass (note) | the brand still appears in "Select brand"; picking it opens HA's own `dialog-single-config-entry-warning` ("This integration allows only one configuration. HAventory supports only one configuration. Adding additional ones is not needed.") and no flow starts — HA 2026.8 interposes that dialog instead of hiding the brand, so the row's "absent from the picker" wording describes older HA; no second entry, storage or resource either way |
| A5 | ENV-B (dev HA) | WS | 2026.8.3 | 0.8.1 → 0.9.0 | 2026-09-02 | pass | household (558 items / 92 locations / 42 attachments) seeded on the real 0.8.1, then the 0.9.0 zip extracted over the install dir HACS-style; boots, `Storage health … items_count=558 locations_count=92`, health counts identical to the 0.8.1 baseline |
| A6 | ENV-B (dev HA) | probe_attachments.py | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | 7/7: 4032×3024 JPEG stored 2048×1536; transparent PNG stored as WebP with alpha; animated GIF untouched, 24 frames; sub-2 MiB JPEG byte-identical (254 160 bytes) |
| A7 | ENV-B (dev HA) | probe_attachments.py | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | "EXIF Orientation=6 is applied before the re-encode": on disk 1536×2048 (portrait) |
| A8 | ENV-B (dev HA) | probe_attachments.py | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | presence probe 206 + Content-Length 1 live, 404 deleted, no answer unreachable; manual served `inline; filename="Splmaschine - Anleitung (DE)"; filename*=UTF-8''Sp%C3%BClmaschine…` (title), `scan_0142.pdf` when untitled |
| B1–B6 (pre-pass) | ENV-B (dev HA) | Chromium emulation (iPhone 15 + 375 px panel) | 2026.8.3 | 0.9.0 | 2026-09-03 | pass (emulation only) | `visual_pass` 42/42 light and 42/42 dark: every card surface at desktop and phone width and every panel surface wide and narrow opens, layout branch asserted, 0 console errors (exit criterion 5, desktop half). Real fingers, WebKit, large-font and the companion webview: owner's phone |
| C1 | ENV-B (dev HA) | Chromium (socket closed + offline 60 s) | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | after 8 s the card shows "Connection lost · showing the data already loaded"; no spinner, rows stay; the banner clears on reconnect and a mutation from another connection repaints the row; 0 console errors beyond the disconnect. Phone/WiFi half: owner |
| C2 | ENV-B (dev HA) | Chromium + WS proxy | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | the card's +1 sent, the server's result frame dropped and the socket cut, page offline 6 s: the server holds exactly q0+1 (never more); after reconnect the row agrees with the server, no duplicate; the banner appears past the card's grace period (C1/C3 show it at 8 s). Phone/WiFi half: owner |
| C3 | ENV-B (dev HA) | Chromium (offline 45 s, 2 items + 1 area changed meanwhile) | 2026.8.3 | 0.9.0 | 2026-09-02 | pass (better than the row expects) | on reconnect the banner cleared, the new area was in `hass.areas`, and both changed rows already showed the server's quantities — nothing was stale in this run, so nothing had to be cleared; recorded for the C3 row's "record which rows were stale" |
| C4 | ENV-B (dev HA) | Chromium + `docker restart` | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | "Connection lost · showing the data already loaded" during the restart, card reconnected after 20 s, a mutation from another connection repainted it; the only console lines are the browser's five "WebSocket connection … failed" from HA's own reconnect loop, nothing from the card |
| D1 | ENV-B (dev HA) | WS + docker | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | `docker restart`; counts identical, store bytes and mtime unchanged, 0 WARNING+ lines from `custom_components.haventory` |
| D2 | ENV-B (dev HA) | `stress.py bulk 1000` + `docker kill` | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | killed 25 s in, during the third bucket (client acknowledged 250 + 250 + 234 = 734 creates, 266 answers lost with the socket); the store on disk is valid JSON, 558 + 741 items — the seven creates persisted whose answers never left, nothing acknowledged missing; after `docker start` health = 1299 = on disk; `cleanup` removed the 741, back to 558/92 |
| D3 | ENV-B (dev HA) | Chromium ×2 + REST | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | `reload_probe.mjs` 11/11: entry loaded again after the reload, both open tabs got `unavailable` on all four topics and re-subscribed on their own and saw a new item, options changed and restored through the real flow, panel and sidebar survived, 51 rows showing |
| D4 | ENV-B (hav-b) | docker + REST + Chromium | **2026.8.3 → 2026.9.0** (released 2026-09-02) | 0.9.0 | 2026-09-03 | pass | container recreated on the 2026.9.0 image over the same volume: entry `loaded`, `Storage health … items_count=4`, no deprecation line and no WARNING+ from `custom_components.haventory`, the card renders on the YAML dashboard |
| D5 | ENV-B (hav-b) | docker + REST + Chromium | **2026.9.0 → `:beta`** | 0.9.0 | 2026-09-03 | pass (same image) | the `beta` tag resolves to the 2026.9.0 image today (digest identical to `2026.9.0`; the first 2026.10 beta is not out yet): same result. Re-run on a real 2026.10 beta when one exists |
| D6 | ENV-C (hav-c, floor) | WS + Chromium | **2026.6.0** | 0.9.0 | 2026-09-02 | pass | fresh container on the `hacs.json` floor image, zip installed clean, entry via the flow, household seeded (558/92 + 42 attachments through `file_upload`); `driver.py smoke` SMOKE OK (create, search, update with `expected_version`, conflict, adjust, delete); `visual_pass` 42/42 light and 42/42 dark (card desktop + phone, panel wide + narrow), 0 console errors |
| D6 (card mutations) | ENV-C (hav-c, floor) | Chromium (card) + bus | **2026.6.0** | 0.9.0 | 2026-09-02 | pass | on the floor image: the row stepper 5 → 2 and a check-out from the detail sheet both save; `haventory_low_stock` and `haventory_item_changed` fire with the documented payloads; 0 console errors |
| D7 | ENV-B (dev HA) | WS + docker | 2026.8.3 | 0.8.1 → 0.9.0 | 2026-09-02 | pass | same upgrade: store sha256 `3592e548…` and mtime (23:05:51) unchanged across the upgrade restart — the update wrote nothing to the store; resource rewritten in place under the same id from `?v=0.8.1` to `?v=0.9.0` (one INFO line) |
| D8 | ENV-B (dev HA) | `lifecycle_probe.py downgrade` | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | schema_version 1 → 100: entry `setup_error` (no retry), WS unregistered, payload not rewritten, recovers after restore. A real rollback 0.9.0 → 0.8.1 is benign today (both write schema 1) |
| D9 | ENV-B (dev HA) | Chromium, persistent profile | 2026.8.3 | 0.8.1 → 0.9.0 | 2026-09-02 | pass (desktop) | profile warmed on `?v=0.8.1` (second load served from cache, transfer 0); after the update a normal reload loaded `?v=0.9.0`, bundle sha `968b5d79…` == the release's, on the card and the panel; companion-app half: phone |
| E1 | ENV-B (dev HA) | WS `backup/generate` | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | full backup to `backup.local` (database excluded, unprotected): the inner `homeassistant.tar.gz` carries `data/.storage/haventory_store`, `data/.storage/lovelace_resources`, `data/custom_components/haventory/manifest.json` and `data/custom_components/haventory/www/haventory-card.js` |
| E2 | ENV-B (dev HA → hav-e2, blank HA) | WS `backup/generate` mid-bulk + onboarding restore | 2026.8.3 | 0.9.0 | 2026-09-03 | pass (rehearsal on dev data; ENV-D on production data: owner) | backup generated 6 s into a 500-item bulk create: the archive's store is valid JSON with 872 items (558 + the 314 in flight), locations 92; uploaded through `POST /api/onboarding/backup/upload` and restored with `/api/onboarding/backup/restore` into a blank 2026.8.3 container (the manager reports "busy: blocked" for the first ~15 s after boot, then accepts): HAventory 0.9.0 sets up, `Storage health … items_count=872 locations_count=92`, 74 attachment files restored beside it, one resource registered, the dev instance's token valid on the restored auth |
| E3 | ENV-B (dev HA) | store swap | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | the household store with its `schema_version` key removed (and one item's `status` removed): entry `loaded`, restamped 1 on disk, 558 / 92 and every count unchanged, no Repairs issue |
| E4 | ENV-B (dev HA) | store swap + Repairs card | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | the owner's real Dec-2025 store (schema 2, 103 items): setup fails, Repairs card "HAventory cannot read the stored data" quoting "…neither the current schema (1) nor an older one this build migrates forward… install 0.8.x, start Home Assistant once so it reads and restamps the store, then upgrade again. The stored data was left unchanged." — file sha256 identical before and after; the same store stamped 11: "…newer than this build supports (1); HAventory will not downgrade it. Upgrade HAventory…", file untouched |
| E5 | ENV-B (hav-e, fresh HA) | zip + store file | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | "reinstall the integration and restore only the store": blank HA, the zip extracted into `custom_components/haventory/`, `.storage/haventory_store` dropped in with HA stopped, entry added → 558 / 92 with every count matching the source, resource registered; the 42 attachment references survive with no file behind them (the documented "file missing" state). Minimum set to restore fully: the store plus `custom_components/haventory/` (or the release zip again) plus `haventory/attachments/` for the files; the Lovelace resource is rebuilt on setup |
| F1 | ENV-B (dev HA) | store dump + audit | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | after seed, upgrade, attachment probes, reload, F5 rename: Python's JSON parser reads the file (no `jq` on this host), 558 items / 92 locations, no duplicate id, every `location_id` resolves, every stored `display_path` equals the tree's, every `version` ≥ 1 |
| F2 | ENV-B (dev HA) | `haventory/health` | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | counts read after the restart of each of D1, D2 (1299 = 558 + 741 persisted creates, then 558 after cleanup), D3, D7, D8 (recovered), E3, E4 (refused, no counts by design) and the H2 wipe: 558 / 92 with identical status counts every time |
| F4 | ENV-B (dev HA) | store file size | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | 736 635 B at 558 items on 0.8.1 → 736 635 after the 0.9.0 upgrade and D1 → 736 636 after the H2 round trip → 735 446 after the reseed → 1 366 780 B at 1 299 items (D2, mid-bulk) → 736 612 after E3 → 735 446 restored: proportional to content; ~20 edits (renames, ±1 steppers, check-outs) moved it by tens of bytes, no growth from repeated edits |
| F5 | ENV-B (dev HA) | WS | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | root "Küche" (124 descendant items, depth 3) renamed: every descendant's path rewritten, no `version` or `updated_at` moved, health counts unchanged; renamed back |
| G1 | ENV-B (dev HA) | Chromium: iPhone 15 emulation + desktop | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | both editors open on the same item; the desktop's rename saves (version +1) while the phone's socket withheld the event; the phone's save is refused as `conflict`: the form says "Someone else changed this item." and the card offers "View latest" and "Re-apply my change"; no silent overwrite (the server keeps the desktop's name); leaving the form asks "Discard your changes?"; a real tap on View latest shows the desktop's name. Real phone: owner |
| G2 | ENV-B (dev HA) | Chromium ×2 + HA websocket debug log | 2026.8.3 | 0.9.0 | 2026-09-03 | **fail** (finding F-2) | both tabs (a dashboard card and `/haventory`) repaint three mutations made by neither and stay in sync after three in-app away-and-back cycles; but the subscriptions leak: each return re-subscribes the four topics plus the area registry and nothing unsubscribes the previous set, so after three cycles one mutation is delivered to four `items` subscriptions per tab (ids 77, 137, 180, 223) — the card and panel never dispose the store an unmounted element built. A full page load is clean (the socket closes, HA tears the set down). Filed as the next issue; fix PR and re-run below |
| G2 (re-run, F-2 patched) | ENV-B (dev HA) | Chromium ×2 + HA websocket debug log | 2026.8.3 | 0.9.0 + #716 (`bc0b262`) | 2026-09-03 | pass | the patched bundle served in place: after three in-app away-and-back cycles in both tabs, one mutation is delivered to exactly one `items` subscription per tab (ids moved 77 → 237 and 83 → 255, the earlier rounds released), 33 `unsubscribe_events` for 24 topic subscribes (the other nine are the six area-registry watches and HA's own three `lovelace_updated`), both tabs still in sync, connections closed with the tabs, 0 console errors |
| G3 | ENV-B (dev HA) | WS + REST as a non-admin | 2026.8.3 | 0.9.0 | 2026-09-02 | pass (WS half) | user `guest` (system-users, `is_admin: false`): `haventory/version`, `item/list`, `stats`, `adjust_quantity` all succeed, `haventory.item_adjust_quantity` service 200 — household-wide as the README documents; browser half in the next row |
| G3 | ENV-B (dev HA) | Chromium as `guest` | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | signed in as the non-admin: the sidebar carries the HAventory entry, `/haventory` renders the whole inventory (pills 19 low / 7 overdue / 8 to inspect / 6 to do / 10 checked out — in German, the guest's profile language being unset), a +1 from the card row saves; matches the README's "No admin gating" |
| G4 | ENV-B (dev HA) | Chromium ×2 (admin + guest) | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | the guest's +1 repainted the admin's tab live and the admin's −1 repainted the guest's; the admin's search box unaffected by the guest's typing (no per-user state bleed); 0 console errors |
| H1 | ENV-B (dev HA) | WS | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | export carries `haventory_export_version` 1, `schema_version` 1, `integration_version` 0.9.0, `exported_at`; 558 items / 92 locations / 7 statuses == `haventory/stats` |
| H2 | ENV-B (dev HA) | WS + docker | 2026.8.3 | 0.9.0 | 2026-09-02 | pass (finding noted) | export → store file deleted with HA stopped → boot empty (0/0) → `import/execute` merge adds 558/92 → export again: EQUIVALENT on ids, names, quantities, locations, custom fields, tags, status, check-out and due state, thresholds, dates, reminders, versions and timestamps. Observed beside it: the boot on the missing store ran the setup-time orphan sweep and deleted all 72 attachment files (42 originals + 30 thumbnails) before the import could re-reference them — FINDING F-1, filed below |
| H2 (re-run, F-1 patched) | ENV-B (hav-e) | docker + WS | 2026.8.3 | 0.9.0 + #713 (`90efa3d`) | 2026-09-03 | pass | control on the released 0.9.0: a file under the media root and no store → boot deletes it; the patched build: a file the export references, store deleted → boot keeps it and logs "Kept every attachment file: the inventory holds no items … op=attachment_sweep files=1"; the export re-imported (558/92) → the post-import sweep keeps the referenced file; the media route serves it byte-identical (254 160 B, `inline; filename="IMG_7988.jpg"`); a later boot with items still removes a real orphan. phacc 160 passed on the branch |
| H3 | ENV-B (dev HA) | Chromium + WS | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | `import_policies.mjs` 3/3: sheet counts and the conflict sentence agree with the server under merge, replace and skip (skip: 2 conflicts named) |
| H4 | ENV-B (dev HA) | Chromium (import sheet) + WS | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | empty file: Preview disabled; truncated JSON: "That is not valid JSON — Unterminated string in JSON at position 249190"; wrong shape and a foreign (grocy-shaped) export: "This file can't be imported · 2 problems found · nothing was changed" naming `haventory_export_version` and `schema_version`; WS `import/execute` refuses each with `validation_error`; store sha256 identical before and after |
| H5 | ENV-B (dev HA) | Chromium (import sheet) + WS | 2026.8.3 | 0.9.0 | 2026-09-02 | pass | stamp 9: "document schema version 9 predates the collapse to 1 and no newer build reads it; open it on HAventory 0.8.x and export again"; stamp 11: "document schema version 11 is newer than supported (1); upgrade HAventory before importing" — on the sheet and over WS, store untouched |
| I3 | ENV-B (hav-b) | Chromium (card) + bus | 2026.8.3 | 0.9.0 | 2026-09-02 | pass (2 of 3) | the three documented automations built through the config API (action swapped to `persistent_notification.create`, templates verbatim); stepping Peanut butter 5 → 2 from the row stepper fired `haventory_low_stock` exactly once (`entered`, name / quantity 2 / low_stock_threshold 2) and the notification read "Peanut butter is down to 2 (threshold 2)"; checking the Projector out from the detail sheet fired `haventory_item_changed action=checked_out` once and the automation's name condition matched; both fired after the write (the check-out's payload carried the saved version). Calendar trigger: HVAC filter reminder and a Ladder due tomorrow on `calendar.haventory`, next event 2026-09-03 00:00 all-day — result recorded after local midnight |
| I3 (calendar) | ENV-B (hav-b) | calendar trigger | 2026.8.3 | 0.9.0 | 2026-09-03 | pass | `calendar.haventory` carried the HVAC filter reminder and the Ladder due date as all-day events for 2026-09-03; the documented `trigger: calendar, event: start` automation fired at 2026-09-03 00:00:00.014 local (two traces, one per event), its `trigger.calendar_event.summary` rendering "Ladder due back"; the entity's state read `on` for the day. All three documented automations therefore fired from ordinary edits and dates |
| Exit criterion 4 | ENV-B (dev HA, hav-b, hav-c, hav-e) + ENV-C | `log_sweep.py --all` + traceback census | 2026.8.3 / 2026.9.0 / 2026.6.0 | 0.9.0 | 2026-09-03 | pass | dev HA whole log: 21 traceback blocks, every one the designed schema refusal (`SchemaDowngradeError` → `ConfigEntryError`) on the seven deliberately refused boots of D8/E4 and L1's M1 block; no other traceback, no other ERROR from a `custom_components.haventory` logger, 59 WARNINGs all contract-defined `ws` rejections from the fuzz layers. hav-b, hav-c, hav-e: 0 blocking, 0 known. The sweep's 29 "unknown_error" hits are HA core's websocket debug echoes of translation payloads (the key name), present only while G2 held that logger at debug — a classifier note, not a finding |
| B1–B11 (real device) | ENV-A + phone | iOS / Android companion app | — | 0.9.x | — | open | not run: no phone against an instance this session; the checklist is in the V handover on #236 |
| C5, C6 | ENV-A | companion app / remote access | — | 0.9.x | — | open | not run: no production instance this session |
| E2–E4 (production data) | ENV-D | — | — | 0.9.x | — | open | rehearsed on the dev household only (rows above); the production backup was not handed over |
| F3 | ENV-A | `stress.py bulk` on real hardware | — | 0.9.x | — | open | not run: #277's number needs the owner's hardware |
| H6 | ENV-A + phone | companion app | — | 0.9.x | — | open | not run |
| J1–J3 | ENV-A | 7-day soak | — | 0.9.x | — | open | not started: needs the production instance |

---

## Handling failures

Every failure gets an impact-and-effort-rated GitHub issue, staged under
[#236](https://github.com/chrreiter/HAventory/issues/236) if it must land before the first
public release. High-impact failures are release blockers. A scenario that fails, gets
fixed, and passes on retest is recorded twice (fail, fix PR, pass), so the log shows what
changed before the release rather than only the final green state.

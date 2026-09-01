# Release Testing Plan — first public release readiness

Manual validation of HAventory on **real** Home Assistant instances, executed against the
release candidate proposed for the HACS listing.

The automated suites (offline gate, in-process integration tests, online WS smokes, the
adversarial stress regimen) are assumed green before this plan starts — see
`docs/developing.md`. This document covers only what those suites structurally cannot:
real hardware, real phones, real networks, real upgrades, real backups.

Out of scope: feature work, and the backlog — all of it lives in the GitHub issue tracker.
Fixes, docs and release chores identified alongside this plan are issues too, staged under
[#236](https://github.com/chrreiter/HAventory/issues/236) when they block the first public
release. This file is tests only.

**Which release this runs against.** The release candidate proposed for the HACS listing —
whatever `0.x` carries every pending fix when the listing is cut. There is no feature freeze:
features land in `0.x` releases as they are accepted, so the candidate is identified when the
run starts rather than fixed in advance. `1.0.0` is deferred indefinitely and gates nothing
([#278](https://github.com/chrreiter/HAventory/issues/278)) — it is not what this plan
validates. [#236](https://github.com/chrreiter/HAventory/issues/236) is authoritative if this
paragraph ever falls behind it, and
[#276](https://github.com/chrreiter/HAventory/issues/276) is the issue that executes the run.

**Sequencing.** The run belongs after the candidate is cut and before the listing is
submitted. D6's prerequisite is met: the minimum supported HA version is the floor declared
in `hacs.json` — derived from the HA APIs the integration actually touches and the security
floor below which every release carries a known advisory (see CLAUDE.md) — so D6 runs
against whatever that file declares at the time. D6 is the live half of that claim; the
in-process suite already runs the integration at the floor in CI.

---

## Exit criteria

A release is "ready" when **all** of the following hold:

1. Every scenario marked **Blocker** below passes on at least the environments listed for it.
2. Every non-blocker failure is triaged with an impact rating — a GitHub issue, staged
   under #236 if it must land before the first public release — and
   **no failure rated High remains open**.
3. `haventory/health`'s `counts` match what the card shows after **every** lifecycle
   scenario in groups D and E — checked after the restart, not before.
4. No unhandled exception or traceback from `custom_components.haventory` appears in the
   HA log across the entire run.
5. No uncaught frontend console error on desktop **or** on the phone webview.
6. Every item [#236](https://github.com/chrreiter/HAventory/issues/236) lists as mandatory
   before the first public release is closed.

---

## Test environments

| Env | What | Used for |
|-----|------|----------|
| **ENV-A** | Personal production HA instance, real data, real hardware | Everything except destructive scenarios (D8, E2–E4) |
| **ENV-B** | Throwaway HA in Docker (`scripts/reload_addon.sh`, `run-haventory` skill) | Destructive + adversarial scenarios; YAML-mode Lovelace |
| **ENV-C** | Docker HA pinned to the **declared minimum supported version** (`hacs.json` `homeassistant`) | D6 — validates the floor |
| **ENV-D** | Docker HA restored from an **ENV-A production backup** | E2–E4 restore scenarios, without risking ENV-A |

Clients to cover: desktop Chrome, one of Firefox/Safari desktop, **iOS companion app**,
**Android companion app**, plus a tablet/wall panel if one exists. Record which client each
result came from — several scenarios only fail on one of them.

---

## Instrumentation — set this up before starting

**1. Logging.** In `configuration.yaml`:

```yaml
logger:
  default: warning
  logs:
    custom_components.haventory: debug
```

Run `debug` for groups A–H. Before the group-J soak, confirm the debug log volume is
sane over 24 h; if it is not, drop to `info` for the soak and note that in the results.
Review logs for accidental PII and for anything at WARNING+ that is **not** a
contract-defined client-recoverable rejection — `validation_error`, `not_found` and
`conflict` each log exactly one WARNING line, no traceback, by design; a
traceback from `custom_components.haventory` is always a finding (exit criterion 4).

**2. Objective consistency check.** `haventory/health` (`ws.py`) reports the `counts`
aggregates over the **in-memory** repository. Called *after a restart* they describe what
was rehydrated from disk, which makes them the corruption check for this plan — a count
that dropped is data that did not come back. Prefer it over eyeballing the JSON. The
index cross-checks that used to ride along here run in the test suite instead
(`tests/repository_invariants.py`), so `issues` is empty on every build and `healthy` is
always `true`: **the counts are the whole oracle**, and a scenario that says "healthy"
means nothing. Read `counts` and compare the numbers.

```bash
HAVENTORY_IGNORE_ENV_FILE=1 HA_BASE_URL=http://<host>:8123 HA_TOKEN=<token> \
  uv run python .claude/skills/run-haventory/driver.py send '{"type":"haventory/health"}'
```

Pass = `counts` matching what the card shows.

`HAVENTORY_IGNORE_ENV_FILE=1` is what makes the two variables beside it win: without it
the `.env` in the checkout takes precedence, and the driver would answer for the local dev
instance instead of the release-test host. It prints the target it resolved on stderr —
read that line before reading the result.

**3. Store snapshots.** Before and after every destructive scenario:

```bash
cp /config/.storage/haventory_store /config/haventory_store.<scenario>.<before|after>.json
```

Compare with `jq -S . a.json > a.s && jq -S . b.json > b.s && diff a.s b.s` — diff the
snapshots rather than reading them. `jq .` failing at all is itself a corruption finding.

**4. Frontend console.** Keep devtools open on desktop. For the phone, use Safari remote
debugging (iOS) or `chrome://inspect` (Android) against the companion app webview —
card-side errors never reach `home-assistant.log`, so without this the mobile groups are
untested for errors.

**5. Per-session record.** HA version, HAventory version (`haventory/version`), card build,
client + OS version, date. Put it in the results log.

---

## Scenarios

`Blocker` = must pass to release. Steps are abbreviated; pass criteria are the contract.

### A — Install & first run

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| A1 | Fresh install on a clean HA (ENV-B): HACS/manual copy → restart → add integration via config flow → add card via the UI card picker | Integration sets up without error; card appears in the picker; empty state renders with no locations and no console error | ✅ |
| A2 | Card resource auto-registration (storage-mode Lovelace) | `/haventory_static/haventory-card.js?v=<version>` present exactly once in `.storage/lovelace_resources`; `curl -I` on it returns 200 with **no** `Cache-Control` header; card loads without a manual step | ✅ |
| A3 | YAML-mode Lovelace (ENV-B, `lovelace: mode: yaml`) | Resource registration is skipped with a clear log line, and the card still loads — the frontend extra-module URL covers YAML mode, so there is no manual step here either | ✅ |
| A4 | Attempt a second config entry | HAventory is absent from the "Add integration" picker while an entry exists, so the attempt cannot start; a flow initiated outside the picker aborts with "Already configured. Only a single configuration is possible." No duplicate storage or resource | |
| A5 | First-run with a pre-existing store (upgrade-in-place from a dev instance) | Existing items/locations load; `haventory/health`'s `counts` match the store they came from | ✅ |
| A6 | Attachment round trip, automated: `RUN_ONLINE=1 HA_TOKEN=<token> uv run --group probes python scripts/probe_attachments.py` | All probes pass. The stored bytes on HA's disk — not what the card reported — match what the card's re-encode should have produced: 4032×3024 JPEG capped at 2048, transparent PNG stored as WebP with its alpha, animated GIF untouched with all 24 frames, sub-2 MiB JPEG byte-identical | ✅ |
| A7 | EXIF orientation, from the same run (case "EXIF Orientation=6 is applied before the re-encode") | The stored frame is upright — portrait 1536×2048, not landscape. This is the one attachment defect that looks correct in every automated test and wrong on every phone, so read this line even when the run is green overall | ✅ |
| A8 | Attachment liveness and naming, from the same run | The presence probe answers `206` with `Content-Length: 1` on a live file, `404` on a deleted one, and nothing at all on an unreachable host; a manual is served `inline` under its title (its filename when untitled), non-ASCII intact | |
| A9 | Save a manual from the browser: open an item's Documents row, save the file | It saves under the attachment's title — or the original filename when untitled — never the attachment UUID, and clicking still opens it in a tab rather than downloading it | |

Fixtures for A6–A8 are generated, never committed: `scripts/probe_fixtures.py` writes them
(~30 MB) into a temporary directory each run, and `--fixtures-dir DIR` reuses one across
runs. Reading the stored bytes needs either `HA_CONFIG_DIR` (a bind-mounted config) or
`HA_CONTAINER` (read out through `docker exec`). Pillow comes from the non-default `probes`
dependency group — `uv sync --group probes` first.

### B — Mobile / touch (companion app)

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| B1 | Portrait phone: walk the full CRUD path — create item, edit, adjust quantity, move, delete | Every interactive control is hittable one-handed; no target smaller than ~44 px; no horizontal scroll | ✅ |
| B2 | On-screen keyboard vs. dialogs (item dialog, location selector, custom fields) | Focused field stays visible; Save/Cancel reachable without dismissing the keyboard | ✅ |
| B3 | Landscape + tablet width | Layout reflows; no clipped or overlapping controls | |
| B4 | Dark mode and one custom HA theme | Text/background contrast holds; no hard-coded colors that break | |
| B5 | System large-font / display-zoom setting | Rows and dialogs remain usable, no truncated labels | |
| B6 | Long/awkward values: 60-char names, German compound words, emoji, deep `location_path` | Values wrap or ellipsize; row height stays stable; search still finds them | |
| B7 | Check-out + due-date flow on the phone; then check-in | Date picker usable; stored date matches what was picked, displayed in local time; DST-boundary date (late Oct / late Mar) stores the intended day | ✅ |
| B8 | Live update: mutate on desktop, watch the phone | Change appears within ~1 s without touching the phone | ✅ |
| B9 | Long-list scrolling: pull-to-refresh gesture, momentum scroll, sticky headers | No gesture trap; the app's pull-to-refresh does not fight the list | |
| B10 | Export download **and** import file-picker from inside the companion app webview | Export file actually lands somewhere retrievable; import picker opens and accepts a file — webviews commonly break both | ✅ |

### C — Connectivity

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| C1 | Disable WiFi mid-session, re-enable after ~1 min | No stuck spinner; the disconnect is visible to the user, not silent; card recovers on reconnect | ✅ |
| C2 | Disable WiFi **while a mutation is in flight** | Exactly-once outcome: the write either landed or did not — verify against the store snapshot; no duplicate item, no silent loss | ✅ |
| C3 | **Stale-after-reconnect**: put the phone offline, mutate several items from the desktop, bring the phone back | Phone's list reflects the changes made while it was offline. *Suspected failure* — HA re-subscribes automatically but the card has no reconnect refetch (`store/ws.ts`, `index.ts`), so gap events are lost | ✅ |
| C4 | Restart HA while the card is open | Card reconnects; no error spam; data correct after reconnect | ✅ |
| C5 | Background the companion app 30+ min, then resume (iOS especially) | Socket re-established; list is current, not stale | ✅ |
| C6 | Remote access over Nabu Casa / reverse proxy / VPN | Card asset loads over the external URL; subscriptions work; latency is tolerable for quantity adjustments | ✅ |

### D — Lifecycle: restart, update, rollback

Run `haventory/health` after **each** of these and compare its `counts`, and snapshot the
store around D7–D9.

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| D1 | Clean HA restart | Data intact; `haventory/health`'s `counts` unchanged | ✅ |
| D2 | Hard kill mid-write (`docker kill` during a bulk operation) | Store file is valid JSON, not truncated; at most the in-flight mutation is lost; `haventory/health`'s `counts` are the pre-kill numbers or one less | ✅ |
| D3 | Config-entry reload (no HA restart) | Reload succeeds; subscriptions re-established; no duplicate WS handler registration | ✅ |
| D4 | HA minor update (current stable → next stable) with HAventory installed | Setup succeeds; no deprecation warnings from `custom_components.haventory` | ✅ |
| D5 | HA **next beta** | Same; any breakage is filed before it reaches stable | |
| D6 | Minimum supported HA, the `hacs.json` floor (ENV-C). The phacc suite already runs the integration in-process at that version in CI; D6 is the live counterpart — a real container, the card, and the browser | Integration sets up and the full CRUD path works on the declared floor; if it does not, the floor is wrong and must be raised before release | ✅ |
| D7 | Integration update N → N+1 **with real data** | Data intact and `haventory/health`'s `counts` unchanged; a restart that changes nothing writes nothing to the store | ✅ |
| D8 | Integration **rollback** N+1 → N (ENV-B only) | Newer-schema data is **refused loudly**: setup fails with `ConfigEntryError` naming both versions and the store file is left byte-identical — never migrated down, never silently relabeled (decided; fixed by #120). An export taken before the update is the way back across a schema change | ✅ |
| D9 | Card update with a warm browser cache: update the integration, then reload normally (no hard refresh), on desktop **and** in the companion app | New card version actually loads; check `haventory/version` vs. the card build. The resource is now registered as `…haventory-card.js?v=<manifest version>` and a stale entry is rewritten in place (fixed by #122) | ✅ |

### E — Backup & restore

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| E1 | Take a full HA backup; inspect the archive | Contains `.storage/haventory_store`, `.storage/lovelace_resources`, and `custom_components/haventory/www/haventory-card.js` | ✅ |
| E2 | Backup taken **while HAventory is being written to** (run a bulk import during the backup), restore into ENV-D | Restored store is valid JSON; `haventory/health`'s `counts` match the pre-backup numbers ±the in-flight batch | ✅ |
| E3 | Restore an **older** backup into the **current** integration (ENV-D) | A backup carrying no stamp, or stamped 1, loads and lands at v1 with the fields it predates filled in; data intact, `haventory/health`'s `counts` unchanged | ✅ |
| E4 | Restore a backup stamped **2–9**, and one stamped **above every number this project ever used**, into the current integration (ENV-D) | Both are refused loudly, as D8 — never migrated down, never silently relabeled (fixed by #120) — and each names its own way out: the 2–9 stamp says to install 0.8.x and let it read the store once, the higher one says to upgrade HAventory | ✅ |
| E5 | Partial/selective backup | Document the minimum set a user must select to fully restore HAventory. The card bundle now rides inside `custom_components/haventory/`, so the set is the store plus the integration folder — or "reinstall the integration and restore only the store". The Lovelace resource is rebuilt on setup and no longer has to be backed up | ✅ |

### F — Data integrity & scale

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| F1 | Structural audit of the store after a mixed workload (creates, moves, renames, deletes, bulk ops) | `jq` parses it; no duplicate ids; every `item.location_id` resolves to an existing location; every `location_path` matches the current tree; every `version` ≥ 1 | ✅ |
| F2 | `haventory/health`'s `counts` after each of D1–D9 and E2–E4 | `counts` match the pre-scenario numbers, allowing for what the scenario changed | ✅ |
| F3 | Scale on **real** hardware: load ~2× the real inventory and measure create/update/list latency | Latency is acceptable at the target size; record the size at which it degrades and publish it as a supported ceiling. Known: whole-dataset rewrite per mutation, ~200 ms/create @1000 items | ✅ |
| F4 | Store file size across the run | Growth is proportional to content — no unbounded growth from repeated edits | |
| F5 | Rename a location near the root of a deep tree | All descendant items' `location_path` rewritten; their `version` and `updated_at` unchanged; `haventory/health`'s `counts` unchanged | |

### G — Multi-client & permissions

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| G1 | Phone and desktop open simultaneously; edit the same item from both | The loser gets a `conflict` with a usable recovery path ("View latest"), not a dead form or a silent overwrite | ✅ |
| G2 | Same card on two dashboards / two browser tabs, left open through several mutations | Both stay in sync; no duplicated or leaked subscriptions (compare subscription count before/after navigating away and back) | ✅ |
| G3 | Log in as a **non-admin** HA user | Record actual behavior: no WS command currently declares `require_admin`, so a non-admin can mutate the inventory. Decide explicitly — gate it or document it as intended for a household | ✅ |
| G4 | Two different HA users editing concurrently | Live updates cross users; no per-user state bleed | |

### H — Import / export

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| H1 | Export the full inventory; inspect the document | `haventory_export_version`, `schema_version`, `integration_version` present; counts match `haventory/stats` | ✅ |
| H2 | Round trip: export → wipe → import | Resulting dataset is equivalent to the original (ids, quantities, locations, custom fields, check-out state) | ✅ |
| H3 | Import onto a **non-empty** store under each policy — `merge`, `replace`, `skip` | Preview matches the executed result for each policy; `add`/`update`/`conflict` classifications are correct | ✅ |
| H4 | Import malformed input: truncated JSON, valid JSON of the wrong shape, a foreign export, an empty file | Rejected with actionable validation errors; **store untouched** (verify by snapshot diff) | ✅ |
| H5 | Import an export whose `schema_version` is above the running build's: one stamped 2–9, one stamped higher still | Both refused, and the card shows the message each earns — the 2–9 stamp is told to re-export on 0.8.x, the higher one to upgrade HAventory | |
| H6 | Export + re-import the **full real inventory** from the phone | Completes without timeout; see also B10 | ✅ |

### I — Services & automations

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| I1 | Call each `haventory.*` service from a script/automation (11 services: `item_create`, `item_update`, `item_delete`, `item_move`, `item_adjust_quantity`, `item_set_quantity`, `item_check_out`, `item_check_in`, `location_create`, `location_update`, `location_delete`) | Each succeeds; the change is visible in the card immediately | ✅ |
| I2 | Call a service with invalid data (missing required field, bad `expected_version`) | Error surfaces in the HA UI/log with a usable message; no partial mutation | ✅ |
| I3 | Try to build an automation that **reacts** to an inventory change | Records a known limitation: the integration fires no HA bus events, so automations can only *call* services, not trigger on inventory changes. Decide whether to document it or defer to the post-1.0 calendar/entity work | |

### J — Soak

| ID | Scenario | Pass criteria | Blocker |
|----|----------|---------------|---------|
| J1 | 7 days uptime on ENV-A with a card left open on a spare device/tablet | HA process RSS stable (no monotonic climb attributable to HAventory); card still responsive without a reload; store size stable | ✅ |
| J2 | Daily `haventory/health` + store snapshot during the soak | `counts` match the card every day; snapshots differ only by real changes | ✅ |
| J3 | Log review at the end of the soak | No repeated warnings, no unbounded log growth, no reserved-`LogRecord`-key breakage, no PII | ✅ |

---

## Results log

Copy a row per attempt. `Result` = pass / fail / n-a.

| ID | Env | Client | HA ver | HAventory ver | Date | Result | Notes / open-item ref |
|----|-----|--------|--------|---------------|------|--------|-----------------------|
|    |     |        |        |               |      |        |                       |

---

## Handling failures

Every failure gets an impact-and-effort-rated GitHub issue, staged under
[#236](https://github.com/chrreiter/HAventory/issues/236) if it must land before the first
public release. High-impact failures are release blockers. A scenario that fails, gets fixed, and passes on
retest is recorded twice (fail → fix PR → pass), so the log shows what actually changed
before the release rather than only the final green state.

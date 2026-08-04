# HAventory public-release review — 2026-08-03

A critical assessment of whether HAventory is ready to release publicly, whether the
"AI slop" allegation would stick, and what it needs to gain traction. Working document:
action it, then delete it (it is itself the kind of internal doc this review says should
not ship).

Method: full read of all 14 backend modules and all frontend sources, sampled test
suites, all docs and CI workflows, plus web research on the competitive landscape
(repo pages, issues, release histories, HA community forum threads, as of 2026-08-03).
All quality gates were re-run from a cold clone as part of this review: 461 backend
tests pass in 6.4 s, 1021 frontend tests pass, ruff/mypy/eslint/tsc all clean, the card
builds at 450 kB raw / 103 kB gzip.

---

## Executive summary

**Release it — but not this week, and not as "inventory tracking."**

1. **The code is not AI slop.** It is the opposite failure mode: disciplined
   over-engineering. Roughly a quarter of the backend and ~10% of the frontend could be
   deleted without behavior loss, and the frontend's comments narrate debugging history
   against the repo's own policy — but the architecture is coherent, the tests are
   behavioral, the invariants are documented, and every gate is green from a cold
   clone. Slop does not do that.
2. **The docs, today, would make the allegation stick anyway.** `docs/` ships a file of
   paste-ready AI prompts, a 75 KB session-by-session dev ledger, and plan docs with
   model names in section titles — and the README links into them. First impressions
   are formed there, not in `repository.py`. One purge PR fixes this.
3. **Competitively, HAventory is not a me-too — in the right segment.** The pantry
   segment (Grocy, simple_inventory, a 2026 wave of AI/barcode entrants) is crowded and
   HAventory would lose there. The **household asset inventory** segment inside HA is
   effectively empty: the only native attempt is an 11-star project dormant since
   Oct 2025, and the real leader (Homebox, 6.6k stars) needs Docker plus a third-party
   polling bridge. HAventory's actual pillar set — deep location tree on HA Areas,
   check-out/due dates, inspection dates, custom fields, zero infrastructure — is an
   asset tracker's feature set. Own that.
4. **The one must-have before announcing: an automation surface.** Every competitor
   exposes sensors and events; HAventory exposes only WebSocket. Without
   `sensor.haventory_low_stock` and bus events, it is an app that *runs in* HA, not an
   integration — and the data to build them (`get_counts()`) already exists.

---

## Q1 — How does HAventory compare?

### The named competitors

**SnipsC0/Home-Inventory** — 11 stars, created 2025-10-13, last commit 2025-10-23,
dormant ~9 months; its 4 open issues are unanswered translation offers. HA custom
integration with a *fixed* 4-level hierarchy (Rooms → Cupboards → Shelves → Organizers),
quantity + min threshold, item photos behind an authenticated API, 3 sensors + a
low-stock event, sidebar panel. No Areas linkage, no export, no custom fields, no
check-out. The closest architectural cousin — and proof that this niche has demand
(people keep asking for translations into a dead repo) but no serious occupant.

**blaineventurine/simple_inventory** — 43 stars, actively maintained (commits June
2026), SQLite-backed with history, plus a separate card. Dense pantry feature set:
multiple barcodes per item with OpenFoodFacts/UPCItemDB lookup and camera scanning,
expiry dates with per-item alert thresholds, **auto-add to todo lists on low stock**
(auto-remove on restock), consumption/spend analytics, 8 sensors + 8 events, 10
services with `response_variable`, JSON/CSV import with merge strategies. Its gaps are
HAventory's strengths: flat string locations, no Areas, no nesting, no custom fields,
no photos, no check-out, no sidebar panel. The strongest HA-native competitor — on
pantry turf.

**grocy/grocy** — 9.3k stars, the household-ERP incumbent (stock with best-before,
shopping lists, recipes, meal planning, chores, batteries, barcode ecosystem). But for
HA users it is a separate PHP application bolted on through a chronically fragile
integration: the custom-components/grocy bridge (240 stars) carries 56 open issues,
repeated `pygrocy`/pydantic install breakages across HA releases (#317, #321, #358),
community forks born of maintenance gaps, and even a HACS removal request
(hacs/integration#4589). The forum thread "Keeping track of pantry items (*not* using
grocy)" exists because of its complexity. Grocy's weakness for HA users is exactly the
seam HAventory doesn't have: HAventory *is* the integration.

### The broader field (matters as much as the named three)

- **Homebox** (6.6k stars, active): Go+SQLite self-hosted *asset* inventory — nested
  locations, custom fields, photos, documents, maintenance schedules, QR labels. Two
  thin third-party HA bridges exist (stats sensors, area-to-location sync). This is
  the feature bar for the asset niche — but it demands a server.
- **2026 pantry wave**: EverShelf (AI expiry OCR, IoT scales, native HACS sensors),
  PantrLytics (HA add-on, reports, label printing), Home Organizer HO-AI (Gemini
  receipt scanning, explicitly positioned against "complex" existing tools),
  homeassistant-grocery-tracker (ESP32 barcode). The pantry arms race is fast-moving
  and AI-flavored.
- **HA core**: still no first-party inventory feature as of 2026.7; Areas remain
  hard-capped at floor → area (one level).

### Feature matrix

| Feature | HAventory | Home-Inventory | simple_inventory | Grocy (+HA int.) | Homebox (+bridge) |
|---|---|---|---|---|---|
| Install | HACS, zero infra | HACS | HACS (+card) | PHP server/add-on + brittle bridge | Docker + bridge |
| Nested locations | **Arbitrary depth** | Fixed 4 levels | Flat strings | Flat | Nested |
| HA Areas integration | **Yes** | No | No | No | Via bridge |
| Custom fields | **Yes** | No | No | Userfields | Yes |
| Check-out / due dates | **Yes** | No | No | No | No |
| Inspection dates | **Yes** | No | No | Chores (detached) | Maintenance |
| Expiry / best-before | No | No | Yes + sensors | Core feature | No |
| Barcode | No | dead roadmap | Yes (camera + lookup) | Core | No |
| Todo/shopping bridge | No | No | **Yes (auto)** | Shopping lists | No |
| Photos | No | Yes | No | Yes | Yes + docs |
| Sensors/events | **No** | 3 + event | 8 + 8 | Many | Stats |
| Real-time UI | WS subscriptions, optimistic concurrency | No | WS | REST poll | REST poll |
| Sidebar panel + card | **Both** | Panel | Card | Ingress iframe | External UI |
| Import/export | JSON | No | JSON/CSV | Yes | Yes |
| Maintenance | active | dormant | active | core slowing, bridge breaking | active |

### Verdict: me-too risk

- **As a pantry tracker: high me-too risk.** No barcode, no expiry, no shopping-list
  bridge — head-to-head it is a worse simple_inventory.
- **As a household asset inventory: the niche is empty inside HA.** Nobody ships
  "Homebox-class inventory that installs from HACS in two clicks and rides native
  Areas." HAventory's genuine differentiators — arbitrary-depth tree bound to real HA
  Areas, lending semantics (check-out/due), inspection dates, custom fields, WS-first
  contract with optimistic concurrency, both a card *and* a panel, no server — are all
  asset-tracker features no HA-native rival has.

**Positioning: "The household asset inventory that lives inside Home Assistant."**
Frame against Homebox (no Docker, no bridge, native Areas), not against Grocy. Tell the
inspection/lending automation story (smoke-detector tests, fire-extinguisher checks,
overdue loans → notifications) that neither an external server nor Grocy's detached
chores can tell. Say "local, contract-tested, no dependencies" out loud — Grocy's
bridge breaking on every other HA release is the most-documented pain in this
landscape, and HAventory's design is the direct answer. Do **not** chase recipes, meal
planning, receipt OCR, or IoT scales.

---

## Q2 — Is it "AI slop"? Code and docs standard

Slop scores (1 = hand-crafted minimalism, 10 = incoherent generated bloat):
**backend 4/10, frontend 3.5/10, docs-as-shipped 7/10 (docs-after-purge ~2/10).**

### The defense that holds

- **Gates**: 461 backend tests in 6.4 s and 1021 frontend tests, all green from a cold
  clone; ruff + mypy (per-module strict on the four core modules against hand-written
  HA stubs) + eslint + tsc clean; 103 kB gzipped bundle.
- **Test architecture**: offline stubbed suite + a second in-process suite against a
  *real* HA core pinned to the declared floor, + `test_min_ha_version.py` guarding
  every floor-declaration site. Tests are behavioral (mount components, click, assert
  user-visible outcomes), not implementation-detail mirrors.
- **Release engineering**: draft-first release-please flow so HACS can never see a
  zip-less release, zip-layout assertion script, six version files with a consistency
  checker in CI *and* the release job. Better than most popular HACS projects.
- **Design coherence**: documented invariants at point of use (fixed-width UTC
  timestamps so lexicographic compare is chronological; derived `location_path`
  rewrites deliberately not bumping `version`), a centralized error taxonomy mapping
  code → log severity so WS and service boundaries cannot drift, forward-only
  idempotent migrations with downgrade *refusal*, honest degraded-state UX traceable
  line-by-line to real contract constraints, correct HA-theme-aware theming
  (`light-dark()` + painted-theme sync), real ARIA engineering (hand-rolled combobox
  with `aria-activedescendant`, focus management, `prefers-reduced-motion`).

### The charges that stick (and their fixes)

1. **Docs residue (the actual slop, severity: release-blocking).**
   `dev/v1_prompts.md` is paste-ready AI prompts; `dev/open-items.md` is a 75 KB
   session ledger the README links twice; `item38_area_display_plan.md` has model
   names in a section title; README carries "WP4.1"/"Phase 2.5 superseded" residue and
   an "Implementation Status" tracker. `dev/item70_toolchain_retirement_plan.md` is
   the purge plan — currently sequenced *after* going public. Resequence: purge first.
2. **Comment archaeology in the frontend (severity: high, cheap to fix).** Hundreds of
   lines of past-tense pixel forensics ("The host measured scrollWidth 874…",
   hv-data-table.ts:96-111; "It **used to be** an outlined 12.5px pill",
   hv-item-editor.ts:642-646) violating CLAUDE.md's own comments policy. Backend has a
   few too (`repository.py:119` "in Phase 1", `repository.py:1714` "pre-WP4",
   `storage.py:5`). Est. 600–900 lines to strip; the single highest-leverage
   "de-slop" edit in the repo.
3. **Over-engineering vs. the domain (severity: medium; it's *defensible*, but costs
   maintenance).** The repo's own benchmarks set budgets at 2,000 items — a scale
   Python linear-scans in milliseconds — yet the read path carries word/prefix/trigram
   text indexes with token caches (~300 LOC), a ~120-LOC index-health subsystem that
   only exists because the indexes exist (`ws.py:829-974`), and micro-optimizations
   (`copy.copy` over `replace` "on this hot path"), while every single mutation pays
   O(N): full `export_state()` + deepcopy + JSON write per keystroke-level operation.
   The optimization effort went where the profiler wasn't. Add: a 241-LOC, 9-option
   rate limiter (off by default, LAN, authenticated) where one global bucket would do;
   a debounced-persist path (`storage.py:297-363`) **no production code calls**;
   `stale_files.py` guarding an empty `RETIRED_PATHS = ()`.
4. **Duplication.** The item wire shape is hand-written in three places (`ws.py:1779`,
   `repository.py:1617`, `import_export.py:90`); 12 WS mutation handlers repeat the
   serialize/broadcast/persist/reply tail even though the `_execute_item_op` dispatch
   table exists; the card's two shells (`hv-card-shell` 1,267 + `hv-full-view` 1,766
   lines) write the stat badges, debounced search, and save handler twice (~300 lines).
5. **Dead code.** Frontend: `pendingOps` maintained in the store but read by no
   component; `hv-list` props never set in production; `WSClient.ping/getLocation/
   updateCustomFields` uncalled; `@lit-labs/virtualizer` a declared dependency never
   imported. Backend: the debounce machinery above; test-stub branches shipped in
   production (`__init__.py:247-275` reads the offline stub's private registry;
   `ws.py:193-197`, `services.py:394-396`, `areas.py:25-29`).
6. **Edge-case asymmetry — the tell that hurts most.** Four location-graph walkers
   guard against cycles that validation makes impossible, while the fifth
   (`_get_ancestors`, `repository.py:678-689`) has **no** guard and a corrupt store
   can hang HA startup. WS create enforces the 120-char name cap and the
   due-date⇔checked-out invariant; import and `load_state` enforce neither.
   `description`/`tags`/`custom_fields` are unbounded (a 10 MB description is accepted
   and trigram-indexed — next to a rate limiter). Corrupt entities are silently
   dropped at DEBUG on load, then the next save rewrites the store without them:
   silent data loss where a repairs-issue belongs.

### Actual bugs found (fix regardless of any release decision)

1. **Short-substring search misses** (verified). `_get_filtered_candidates`
   (`repository.py:1007-1015`) treats the text index as authoritative and returns `[]`
   on a miss, so the documented substring semantics in `models.py` never run. A 1–2
   char mid-word fragment (`q="wi"` vs item "Kiwi") returns nothing: no word match, not
   a name *prefix*, and the trigram fallback requires ≥ 3 chars. The elaborate index
   created a correctness gap a naive scan wouldn't have.
2. **Broadcast-before-persist with no rollback** (verified, `ws.py:1094-1097` and 11
   siblings). On persist failure the caller sees `storage_error` but subscribers
   already received "created" and memory keeps the item — client retry duplicates it.
   `ws_import_execute` (`ws.py:1925-1938`) *does* snapshot and roll back; the code
   can't decide whether memory/disk divergence matters. Pick one (persist-then-
   broadcast is the cheap fix).
3. **Card picker contract broken** (verified). `getStubConfig` is a module-level
   export (`index.ts:137`) — HA reads statics off `customElements.get(type)`, so it
   never sees it; there is no `static getConfigElement` and no `getGridOptions`. The
   test asserts the module export, i.e. verifies the wrong surface.
4. **`_get_ancestors` cycle guard missing** — see §6 above; can hang startup on a
   hand-edited store.
5. **Keyboard access gap in the full-view table**: rows are `tabindex="0"` with click
   handlers but no keydown (`hv-data-table.ts:383-393`) — keyboard users cannot open an
   item there (the card list row does it right). Also no loading state: a filter change
   flashes "No items match" during fetch.
6. `strings.json` / `translations/en.json` drift: en.json carries a `services` block
   strings.json lacks.

### Net judgment on the allegation

A hostile reviewer reading the *code* would find: consistent architecture, documented
invariants, behavioral tests, green gates — and would have to retreat to "it's
over-engineered and verbose in places," which is a normal engineering critique, not
slop. A hostile reviewer reading the *repo as shipped today* would screenshot
`v1_prompts.md` and the README's WP references and be done. The allegation is
defeatable, but only after the purge — and after the comment-archaeology strip, which
is the one place the code itself echoes the charge.

---

## Q3 — Must-have features for traction (ranked, by evidence of demand)

1. **Sensor entities + bus events** (table stakes; blocks the entire automation story).
   `low_stock_count`, `overdue_count`, `inspection_overdue_count`, `items_total` are
   already computed in `get_counts()` (`repository.py:1138-1148`) — a sensor platform
   is ~60 lines. Fire `haventory_low_stock`-style events on mutations. Every
   competitor has this (Home-Inventory 3+1, simple_inventory 8+8, the Grocy bridge's
   entire reason to exist). Without it, "no automation triggers" (README known
   limitation) reads as "not really a Home Assistant integration."
2. **Low-stock → `todo.*` auto-add** (cheapest high-demand win). simple_inventory's
   headline feature and the main reason it gets recommended; HAventory already has
   thresholds — the bridge is the missing 20%. Auto-remove on restock.
3. **Photos on items.** The asset niche's flagship feature: Home-Inventory's one
   distinctive capability, core to Homebox, explicitly missing from simple_inventory.
   For insurance documentation and "which cable is this" use cases, photos matter more
   than any pantry feature. Serve them authenticated (as Home-Inventory does), not via
   `/local`.
4. **Service responses** (`SupportsResponse.OPTIONAL`): `haventory.item_create`
   currently returns nothing, so scripts can't chain on the created id — a dated
   omission for 2026-era HA.
5. **`calendar.haventory`** (already planned post-1.0 — pull it forward): due dates +
   inspection dates as calendar events is the automation story only an HA-native tool
   can tell, and it powers the positioning in Q1.
6. **i18n for the card + visual config editor.** Zero `hass.language` awareness and a
   single hardcoded language today; the German/Spanish/Russian translation offers
   piling up in Home-Inventory's dead issue tracker are literally the market asking.
   The config editor (`static getConfigElement`, even just for `title`) plus fixed
   picker statics is HA-card table stakes.
7. **QR labels per location** (later): print a QR per shelf/bin → opens the panel
   filtered to that node. Natural fit for the deep tree; Homebox has it, nothing
   HA-native does.
8. **Barcode** (later, and only as lookup/labeling via the browser BarcodeDetector
   API): don't chase the pantry pipeline (OFF lookups, expiry OCR) — that race is
   crowded and orthogonal to the asset niche.

Explicitly **not** worth building: recipes/meal planning, receipt OCR, consumption
analytics, IoT scales — the 2026 pantry wave owns those.

---

## Action plan (sequenced)

### Wave 1 — before any public link (days)

1. Execute the `dev/item70` purge now, not post-validation: delete `v1_prompts.md`,
   the delivered `item*_plan.md` docs, distill `card_shipping_plan.md` +
   `sidebar-panel.md` into `frontend_architecture.md`; move `open-items.md`,
   `schema_*_plan.md`, `release_testing_plan.md` to GitHub issues/private notes.
2. Rewrite the README: ~150 user-facing lines (what it is, hero screenshot + phone
   layout GIF, install, configure, card YAML, service examples, known limitations,
   troubleshooting for HA OS not docker-dev); move lines 181–679 to
   `docs/developing.md`; delete "Implementation Status"; drop the WP references and
   the "PEP 758 / WSL2" paragraph from the top fold. The screenshot harness
   (`run-haventory` skill) already exists — this is a one-session task.
3. Trim CLAUDE.md to ~80 lines (architecture map, commands, conventions); the WP
   decision logs violate its own "no history, no unopenable references" rule.
4. Small fixes: issue-template version strings (still "0.0.1"), Discussions contact
   link, `hacs.json` `country` key, sync `services` block into `strings.json`, add
   SECURITY.md + CODE_OF_CONDUCT.md, my.home-assistant redirect badges.

### Wave 2 — before announcing (1–2 weeks)

5. Sensor platform + bus events + `supports_response` (+ `single_config_entry` in the
   manifest, `diagnostics.py`, repairs-issues for schema refusal and corrupt-entity
   drops — all cheap, all idiomatic).
6. Fix the verified bugs: search short-circuit, persist-then-broadcast ordering,
   `_get_ancestors` guard, card picker statics, data-table keyboard access + loading
   state, import-side validation parity + size caps on text fields.
7. Announce: HACS custom repo + community forum post positioned per Q1, with the
   Homebox comparison and the automation story. Submit to home-assistant/brands
   (currently `ignore: brands` in CI) and then the HACS default store.

### Wave 3 — subtraction (background, no user-visible change)

8. Strip comment archaeology (frontend ~600–900 lines; a few backend spots).
9. Backend cuts: text-index machinery (fixes bug #1 as a side effect), index-health
   subsystem, dead debounce path, stub branches out of production, one `to_dict()` per
   model, collapse the 12 handler tails onto `_execute_item_op`, shrink or fold the
   rate limiter. ~1,450 production LOC.
10. Frontend cuts: shared shell chrome (badges/search/save ~300 LOC), dead code
    (`pendingOps` chain, unused WS methods, virtualizer dep — or actually adopt the
    virtualizer for `loadAllPages`), merge the two store test suites. ~1,500–2,000 LOC.

### Wave 4 — traction features (the roadmap that earns stars)

11. Todo bridge → photos → calendar entity → i18n + config editor → QR labels, in that
    order (each is independently shippable and each has demonstrated demand).

---

## Follow-ups (out of scope here, noted per repo convention)

- Consider decoupling "minimum HA that runs" (API floor: 2026.3) from "recommended"
  (advisory-clean: 2026.6) once real users exist — mechanically re-raising the floor
  on every HA CVE will exclude the slow-updating tail.
- A monthly scheduled CI job running the phacc suite against *latest* HA would catch
  monthly-release drift automatically (currently only the pinned floor is CI-covered).
- Coverage upload (Codecov) + badge; digest-pin the actionlint docker tag (Scorecard
  flags it).
- `hass.data[DOMAIN]` → `entry.runtime_data` where the unload-refusal design allows.
- Vestigial one-entry Python matrix in `ci.yml`; CLAUDE.md still claims a 3.12+3.14
  matrix.

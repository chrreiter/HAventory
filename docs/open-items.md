# Open Items — future work & identified gaps from closed PRs

Compiled from a sweep of **all closed pull requests** (#1–#91) plus the follow-up
notes they reference in `CLAUDE.md`, `README.md`, and `docs/`, and extended by the
**release-readiness review (2026-07-25)** that produced
[`release_testing_plan.md`](release_testing_plan.md). Pure Dependabot /
tooling-bump PRs (the majority of the closed set) carry no future-work notes and are
excluded. Each item records its **source PR**, **impact**, **effort**, and whether it
is **pre-v1.0** (should land before a 1.0 release) or **post-v1.0** (enhancement /
non-blocking).

- **Impact** — High / Medium / Low (user-facing or release/correctness/security risk).
- **Effort** — S (≲ half a day) · M (~1–3 days) · L (multi-day).
- Status verified against the working tree at `main` @ WP4 (`390cba6`), then reconciled
  against the **2026-07-27 fix batch** (PRs #120–#130). The batch edits below assume those
  eleven PRs merge — this file's update is meant to land **after** them.
- **Item numbers are stable and append-only** — new items get the next free number
  rather than renumbering the list, so references from PRs and docs keep resolving.
  Read each table's own ordering, not the numbering, for priority.

> Already resolved along the way (not listed below): type-hardening `ws.py`/`repository.py`
> + dropping the mypy override (done in #91/WP4); the `*.sh` CRLF guard, now present in
> `.gitattributes` (added in #74, so the #91 note is closed); and the Phase-1 "advanced
> filters/sorts deferred" note from #18 (delivered by WP2/WP3 + full-text search #49).

> The **2026-07-27 fix batch** — eleven one-item PRs, each developed unattended from this
> file's item text — resolved items **25** (#120), **27** (#121), **26** (#122), **8**
> (#123), **32** (#124), **28** (#125), **37** (#126), the **docs half of 40** (#127),
> **1** (#128), **31** (#129) and **39** (#130). Their rows are removed below; the
> follow-ups those PRs reported instead of fixing are items **41–51**. The deferred
> halves live on: item 37's effective-area preview → item 46, item 40's preview warning
> → item 47, item 39's select-all semantics → item 49. The merged batch (`main` @
> `c3d6223`) was then **live-verified on 2026-07-28** against a real HA 2026.7.3 Docker
> container — every check passed, including the first real-HA integration-suite run and a
> 14 701-line full-log sweep meeting release exit criterion 4; that run's findings are
> items **52–55**. Item **52** (event-loop `manifest.json` read behind the cache-buster)
> was fixed the same day by **#132** — version now comes from the loader's already-parsed
> manifest, with an executor-offloaded file read as fallback; live-verified 12 → 0
> blocking-call warnings across a restart.

> The **card-shipping rework** ([`card_shipping_plan.md`](card_shipping_plan.md)) resolved
> item **44** in its PR-1: the bundle is served from inside the integration package with no
> `Cache-Control`, so the dev loop no longer needs a hand-pinned content hash and
> `pin_resource.py` was retired rather than repointed. Its row is removed above; the one
> cleanup PR-1 deliberately left behind is item **56**.

---

## Pre-v1.0

Ordered by impact.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 2 | **Triage the 19 Dependabot security alerts on `main`** (`/security/dependabot`). Pre-existing, flagged as unrelated to #76 but still open. | #76 | Medium (security) | S–M |
| 3 | **Enable release automation.** `release-please` is config-ready but dormant — uncomment the `push` trigger in `.github/workflows/release-please.yml` and run the release flow. Needed to cut a 1.0. | #74, #76 | Medium (release-blocking) | S |
| 4 | **HACS publication** (Phase 3 "Polish & HACS"). Distribution path for a 1.0. | README Phase 3 | Medium (distribution) | M |
| 36 | **`inspection_date` has no agreed meaning, and the card says both.** The backend only validates the shape — `inspection_date: str \| None` (`models.py:73`), `validate_inspection_date` (`models.py:309-313`) checks `YYYY-MM-DD` and nothing else — so the meaning lives entirely in the wording, and the wording disagrees with itself: the editor labels the box **"Inspection date"** (`hv-item-editor.ts:1011`) and the sort menu agrees (`hv-filter-panel.ts:24`), while the table column header reads **"Inspected"** (`columns.ts:41`) and the mobile detail sheet's fact row reads **"Last inspected"** (`hv-detail-sheet.ts:384-389`) — past tense, the opposite reading. **Owner's decision (2026-07-26): it is a future date** — when the item is next due for inspection — the same shape as the checkout's due date, and it needs an "inspection overdue" badge to match. Split of the work: **card-only** — settle on one forward-looking label across editor, column, sort menu and sheet; badge a row whose `inspection_date` is in the past, which `isOverdue` (`ui/relative-time.ts`) already computes for `due_date` on an item the card is holding; sorting needs nothing (`sortField: 'inspection_date'` exists). **Backend, and therefore a contract change** — an app-bar pill needs a whole-inventory count, and `Repository.get_counts()` (`repository.py:1138-1147`) returns only `items_total`, `low_stock_count`, `checked_out_count`, `overdue_count`, `locations_total`, `no_location_count`; pressing that pill needs a server-side filter, and `ItemFilter` (`models.py:120-142`) has `overdue_only` for `due_date` alone. Mirror `_count_overdue` (`repository.py:1149-1163`), which is deliberately unindexed because "overdue" moves with the calendar and no mutation invalidates it at midnight — but walk the whole inventory rather than only `_checked_out_item_ids`, since an inspection is independent of any checkout. Two notes: the export column list already carries `inspection_date` (`import_export.py:72`), so no migration is needed — only the meaning changes, and existing rows may hold *past* dates entered under the old reading; and once it is a future date, the checkout dialog's quick offsets (+7 / +31 / +90 / +X days, `hv-checkout-popover.ts`) are the obvious way to set it, which the owner suggested and which is deliberately not built until this is settled. | card UI consistency review 2026-07-26 | Medium (user-facing) | M |
| 41 | **Post-batch README truth-ups.** Three small accuracy fixes that only make sense once the 2026-07-27 batch is merged: (a) the Known limitations rate-limiting entry (#129) deliberately describes backend posture only — add the card behavior #128 shipped (a rate-limited `subscribe` is retried up to 4 times, honouring a retry-after hint when the envelope carries one, then pauses visibly with a Refresh action); (b) `## Conventions` lists `calendar.haventory` while Known limitations states the integration creates no entities — both true today, so add "reserved for the post-1.0 calendar work (item 9)" to the Conventions line; (c) the published scale ceiling is extrapolated from item 19's stress curve — replace it with the measured number once release-test F3 runs. The #129 follow-up also notes the *Implementation Status → Phase 2.5* claim about the rate-limited-subscribe gap: stale against pre-batch `main`, accurate once #128 merges — verify, don't edit. | PR #128/#129 follow-ups | Low–Med (docs accuracy) | S |
| 5 | **Add `tsc --noEmit` (typecheck) to the CI gate.** It is clean (#89/#91) but still not gated, so card type regressions can slip through. | #74, `docs/frontend_architecture.md` | Low–Med | S |
| 6 | **Pin the service-registration pattern with a test.** `services.py` registers sync lambdas that return coroutines; the integration suite passes, but a targeted service-call integration test would guard it. | #91 | Low–Med (correctness) | S |
| 7 | **GitHub repo hardening (manual, GitHub UI):** branch protection/ruleset on `main`, secret scanning + push protection, enable Discussions, run the `labels` workflow once, set a social-preview image. | #76 | Low | S (manual) |

### Release-readiness tasks (from the 2026-07-25 review)

Work items — **not** tests — surfaced while drafting
[`release_testing_plan.md`](release_testing_plan.md), plus later findings of the same
release-blocking kind. The confirmed defects in this group (25, 26) and the documentation
gaps (28, 31, 40) were fixed by the 2026-07-27 batch; what remains are the two release
chores below — 29 after feature freeze, 30 via item 3's release automation. Ordered by
impact.

| # | Item | Source | Impact | Effort |
|---|------|--------|--------|--------|
| 29 | **Set the real minimum supported HA version — the current `2026.7.0` is a stale leftover.** `hacs.json` `homeassistant: "2026.7.0"` predates the current feature set and was never verified against a running instance (CI runs the HA-less offline suite; the integration suite pins whatever `requirements-integration.txt` resolves — currently `2026.7.3`). **Sequencing: do this after v1.0 is feature-complete**, once every HA API the integration actually touches is known; deriving the floor earlier just re-stales it. Then (a) update `hacs.json`, (b) update every other place the number is repeated — `README.md` (2×), `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/bug_report.yml` (2×), and the explanatory comments in `pyproject.toml` and `.github/workflows/ci.yml` — (c) pin `requirements-integration.txt` / the integration-test HA to that floor so CI defends it, and (d) verify a real instance at the floor via release-test D6. Note the coupling: HA ≥ 2026.3 forces Python 3.14, and the source uses PEP 758 syntax that does not parse on ≤ 3.13, so choosing a floor below 2026.3 is a toolchain change, not a one-line edit. | release review 2026-07-25 | Medium (release claim) | S–M |
| 30 | **Version numbers are still `0.0.1`.** `manifest.json` `version` (and `INTEGRATION_VERSION`, surfaced by `haventory/version` and stamped into export documents) must be bumped for the release and kept in sync with the release tag — which is what item 3 (release-please) is meant to automate. Add a check that the manifest version, `.release-please-manifest.json`, and the tag agree. | release review 2026-07-25 | Medium (release-blocking) | S |

> Items 2 (Dependabot alerts), 3 (release-please) and 4 (HACS publication) above are also
> release-readiness tasks and are referenced from the test plan; they are already tracked
> and are not duplicated here.

---

## Post-v1.0

Ordered by impact.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 9 | **Reminders / calendar rework onto HA-native primitives** — implement the roadmap's `CalendarEntity` (`calendar.haventory`) + HA automations instead of a bespoke scheduler. Explicitly decided as post-1.0. | #73 (CLAUDE.md pillar #9); #18 ("sensors/calendar evolve post-MVP") | Medium (feature) | M |
| 10 | **Location tree view** — recursive expand/collapse rendering (list is currently flat; "deferred to Phase 2.5"). | #32, `docs/frontend_architecture.md` | Medium | M |
| 11 | **Bulk operations** — multi-select with bulk edit/delete. | `docs/frontend_architecture.md` (Future Enhancements) | Medium | M |
| 12 | **Unify `hv-category-browser` + `hv-tag-browser`** into one kind-parameterized value-browser. Already tracked as **open issue #87**; frontend-only, no behavior change. | #84, issue #87 | Low | M |
| 13 | **Perf (stretch):** 10k-item `low_stock_first` full-scan path is p50 32 ms vs a 30 ms budget (p95 fine). A cached low-stock-first ordering would close it. | #91 | Low | M |
| 14 | **Perf:** back-to-back subtree moves within one second pay a +1 s monotonic-bump slow path per item (pathological; one-off moves are fine). A batch-aware bump would fix it. | #91 | Low | M |
| 15 | **Rate limiting:** a per-connection command token is consumed even when the global bucket then rejects (deliberate check order; could refund). | #91 | Low | S |
| 16 | **TypeScript 7 adoption** once typescript-eslint supports it (currently capped `<6.1.0`). | #74 | Low | S |
| 17 | **`tests/conftest.py`** uses `WindowsSelectorEventLoopPolicy` / `set_event_loop_policy`, both deprecated for removal in Python 3.16. Replace when convenient. | #74, #91 | Low | S |
| 18 | **Other frontend enhancements** (roadmap): advanced date-range filters, drag & drop move/reorder, item image upload (HA media), mobile touch/swipe optimization, offline/service-worker support, virtual-scroll/lazy-load perf. | `docs/frontend_architecture.md` (Future Enhancements Phase 2.5+) | Low | L (each) |
| 19 | **O(N²) persistence: every single mutation serializes the *whole* dataset and rewrites the store blob** (immediate persist, serialized by the write lock). Measured per-create p50 climbs 70 ms @250 → 114 ms @500 → 200 ms @1000 items; at a few thousand items a single create trends toward ~1 s. Correctness is unaffected. A debounced/delta persistence path for bulk work would flatten the curve. | WP4 stress test | Medium (scaling) | M |
| 20 | **No upper bound on `description` length (1 MB accepted) or `custom_fields` key count (~1000 accepted).** A persistence-bloat vector, amplified by #19. Add sane input caps. | WP4 stress test | Low | S |
| 21 | **Undecodable pagination `cursor` returns a full unfiltered page** (`"garbage"`, `""`, base64-junk) instead of `validation_error`. Reject malformed cursors explicitly. | WP4 stress test | Low | S |
| 22 | **Duplicate bulk `op_id`s collapse silently** — the operations execute but the per-`op_id` results dict keeps only the last, so the client can't tell which of its ops succeeded. Reject duplicate `op_id`s (or document last-wins in the contract). | WP4 stress test | Low | S |
| 23 | **Location rename bumps every subtree item's `version`** (denormalized `location_path` rewrite), so a client holding a stale `expected_version` for an unrelated field gets a spurious `conflict`. Indexes stay consistent — it's a UX surprise, not corruption. A path-only rewrite need not bump the optimistic-concurrency version. | WP4 stress test | Low | M |
| 24 | **`item/list` silently ignores unknown filter keys.** The `filter`/`sort` payloads are schema-validated only as `dict` (`ws.py`), and `repository.list_items` reads known keys via `flt.get(...)`, so a typo'd or unsupported key (e.g. `query`/`search` instead of `q`) is dropped and the "filtered" list returns **everything** instead of erroring — a silent-match-all footgun. Same input-hardening family as #20/#21: reject unknown `filter`/`sort` keys with `validation_error`. Confirm the card sends only known keys before tightening (contract change). | run-haventory skill gotcha review | Low | S |
| 33 | **Category and tag tallies ignore the active filter while location tallies honour it** — one sidebar column, two meanings for the same grey number. Measured in the expanded view with the low-stock filter on: location rows read `8 / 37`, `23 / 172` (matches over total) while category rows still read `43`, `74` — whole-inventory counts. Cause: `refreshLocationTree` refetches `location/tree` *with* the active filter (`store.ts:481`), but `haventory/distinct_values` (`ws.py:734`) accepts no filter at all, so `distinctValuesCache` is always global. The fix is a **backend contract change** — an optional `filter` on `haventory/distinct_values`, mirroring what `location/tree` already takes — plus passing it from `Store.refreshDistinctValues` and re-fetching on filter change like the tree does. Frontend-only interim options if that is unwanted: suppress the facet tallies while a filter is active, or mark them as totals. Deferred past v1.0 by the owner. | card UI consistency review 2026-07-26 | Medium (user-facing) | M |
| 34 | **The desktop filter panel's chips expose no pressed state to assistive tech.** Seven chips in `hv-filter-panel.ts` (lines 462, 523, 583, 643, 650, 657, 664) carry their selected state in an `on` CSS class and nothing else — no `aria-pressed`, no `role`. The *same four* "Show only" facets in that component's mobile branch use `role="checkbox"` + `aria-checked`, and both app bars' stat pills plus the sidebar facet rows use `aria-pressed`, so the desktop panel is the sole surface where a screen reader cannot tell an active filter from an inactive one. Add `aria-pressed` to all seven (or `role="checkbox"`/`aria-checked` to match the mobile branch — pick one and use it for both branches). Deferred past v1.0 by the owner. | card UI consistency review 2026-07-26 | Low–Med (accessibility) | S |
| 35 | **Only tags can be multi-selected; categories and locations cannot** — the sidebar lets you accumulate tags but replaces the category or location on every click, and the filter is the reason, not the UI. `category` is a scalar the backend `.strip().casefold()`s (`models.py:758`, `:805`), so a list raises `AttributeError` inside `_get_filtered_candidates` (`repository.py:1033-1040`) and reaches the client as `unknown_error`; `location_id` is a single uuid-v4 that `str()`-stringifies to `"['a', 'b']"`, misses both `_items_in_subtree` and `_items_by_location_id` (`repository.py:1017-1031`) and returns `total: 0` **with no error** — a silent wrong answer. Inventing client-side keys fails the other way: `vol.Optional("filter"): dict` (`ws.py:1445-1453`) accepts unknown keys and `filter_items` ignores them, so the server returns the *unfiltered* set with a plausible `total` (same footgun as #24). There is no honest frontend-only version — client-side merging of N queries also breaks the server-computed `total`, the opaque cursor, and `location/tree`'s `matching_direct_count`/`matching_subtree_count`. The fix is additive: new `categories: list[str]` / `location_ids: list[str]` beside today's scalars, unioning the index buckets exactly as `tags_any` already does (`repository.py:1046-1056`), carried through `models.ItemFilter`, `models.filter_items`, `repository._get_filtered_candidates`, `repository.count_matching_by_location`, the subscription matcher `_item_matches_filter` (`ws.py:560-570`, a separate scalar path that would otherwise drift) and both contract docs. Open design question: whether one `include_subtree` flag applies to every picked location or becomes per-entry. Card side: `StoreFilters`, `toWireFilter`, `activeFilterCount`, `hv-filter-chips`, `hv-full-view`'s sidebar, `hv-filter-panel` (single-select today, would otherwise disagree with the sidebar) and `hv-location-tree`'s `selectedId` — the editor's location *picker* must stay single-select. No Any/All control is needed: an item has exactly one category and one location, so multi-select can only ever mean OR. Deferred past v1.0 by the owner. | card UI consistency review 2026-07-26 | Medium (user-facing) | M–L |
| 38 | **An item's area is nowhere in the card, even though the backend already computes and ships it.** The organize dialog's location tree shows an explicit `Area: <Name>` chip (`hv-location-tree.ts:301,345`, gated on `showAreas` + its own `_areaName` lookup against `this.areas`), so a location's area is discoverable *there* — but every item-facing surface prints only the location name path (`Test: Living Room › Sub Living Room`) with no area anywhere, so a user looking at their inventory has no way to tell which room a location is even in without leaving the item view to go look it up in Organize. Confirmed live 2026-07-27: a location created under HA area "Living Room" shows `Area: Living Room` in the organize tree and nothing at all in the card's item list. Three surfaces share the gap and all three go through the same two helpers, `displayPath`/`prettyPath` (`hv-list-row.ts:16-19`, `ui/location-path.ts:11-13`), which only ever read `item.location_path.display_path` — never area: the list row's secondary line (`hv-list-row.ts:383-385`), the desktop table's Location column (`hv-data-table.ts:290-291`), and the detail sheet's path crumb (`hv-detail-sheet.ts:319,327`). The data is not missing — it is unused: `Item.effective_area_id` is already computed server-side per item (`_effective_area_id_for_item`, `ws.py:1675-1681`) and shipped on every `Item` (`ws.py:1703`, `docs/data_shapes.md:35`), and the frontend type already declares it (`types.ts:40`) — but no component reads that field, so it is dead on arrival. The area-name lookup this needs already exists too: `store.ts:380-381` fetches `areasCache` once at startup, and it is wired into exactly two components, `hv-location-tree` and `hv-organize-dialog` (`hv-card-shell.ts:1015,1113`, `hv-full-view.ts:1176,1270,1475`, `hv-organize-dialog.ts:750,990`) — not to `hv-list-row`, `hv-data-table`, or `hv-detail-sheet`. Fix is additive on both ends: thread `areasCache` (or a resolved area name) down to those three components the same way it already reaches the tree, and render it — e.g. an `Area: <Name>` chip beside the path, matching the tree's own wording, shown only when `effective_area_id` is non-null. No backend or contract change needed; the field is already on the wire. | user report 2026-07-27 (screenshot) | Medium (user-facing) | S–M |
| 47 | **`import/preview` name-collision warning** — warn when an incoming entity's name collides with a *different* existing id. The docs now state the duplicate-on-rebuilt-ids hazard plainly (#127), but the preview is the only surface that could catch it *before* the write, since it already holds both sides in hand. The deferred M half of item 40. | item 40 + PR #127 follow-up | Medium (data safety) | M |
| 43 | **The WS API keeps answering — and writing the kept store — after config-entry removal, until restart.** `async_remove_entry` (#121) removes the Lovelace resource but leaves `hass.data[DOMAIN]["store"]`/`["repository"]` in place, and HA has no way to unregister WS commands, so an open dashboard can keep mutating the inventory after the integration is removed; a restart finishes the teardown. Decide whether handlers should refuse once the entry is gone. | PR #121 follow-up | Low–Med | S–M |
| 49 | **Select-all semantics: loaded page vs whole filtered set** — item 39's secondary question, deliberately untouched by #130. The header checkbox selects **loaded** rows only (`store.selectAllLoaded`, `store.ts:628`) while the selection bar counts the full filtered total; `loadAllThenSelectAll` (`store.ts:633`) already implements the other reading. Product decision — e.g. a "select all N matching" affordance after a partial select-all. | item 39 + PR #130 follow-up | Low–Med (user-facing) | S–M |
| 46 | **Area propagation is surprising at the point of use — the effective-area preview from item 37.** Choosing the relabeled default option (#126) on a nested location does more than "stop inheriting": `Repository.update_location` runs `_propagate_area_to_root(key, None)`, clearing the area from the whole tree, and picking an explicit area moves the assignment to the tree root — nothing in the dialog warns about either. Item 37's live-preview idea lands here, with its recorded caution: an honest preview of the non-default options is a whole-tree effect and worth designing deliberately, and the dialog has no walk-up-to-root helper (`_findNode` only walks down), so the preview needs either a client-side walk or a `location/tree` contract change shipping `effective_area_id` per node. Cosmetic while there: with no HA areas the dropdown renders a one-entry select. | item 37 + PR #126 follow-ups | Low–Med | M |
| 48 | **Card rate-limit polish left over from #128:** `Store.run()`'s command retries use a fixed exponential backoff and ignore the retry-after hint (`subscribeRetryDelayMs` is exported and reusable); the shell's banner chain is exclusive, so the queued-command "Busy — retrying" state is hidden while live updates are paused; and nothing calls `Store.dispose()`, so a shell torn down mid-backoff relies on GC rather than on the cancellation `dispose()` now performs. | PR #128 follow-ups | Low | S–M |
| 42 | **Storage crashes generically on a corrupt (non-integer) `schema_version`.** `int(raw.get("schema_version", 0))` in `storage.py` raises `ValueError`/`TypeError` on a hand-edited `"schema_version": "4"` or `null`, surfacing as the catch-all `ConfigEntryNotReady("storage load failed")` rather than a specific corruption message; `import_export.py` already type-checks its version fields, storage could match. Related trap: `migrations.migrate`'s downgrade pass-through is unreachable from production now that storage refuses first (#120) — a second caller would reintroduce the silent relabel. | PR #120 follow-ups | Low | S |
| 45 | **The YAML-mode registration skip logs at DEBUG**, so a YAML-mode user sees nothing at default log levels. The README now documents the situation (#125), but an INFO/WARNING line — it is an actionable misconfiguration for anyone expecting the card — would make the integration self-documenting. | PR #125 follow-up | Low | S |
| 50 | **Two severity calls the #124 logging audit deliberately left open:** the frontend-resource registration failure logs WARNING + traceback although the card never loading is arguably operator-actionable (ERROR — but it is outside the error taxonomy's codes and the integration still functions); and `ws_items_bulk`'s "completed with no successful operations" WARNING summary is redundant with the per-op WARNING lines it follows. | PR #124 follow-ups | Low | S |
| 51 | **Real-HA integration coverage for the batch's stub-tested paths.** Three changes are asserted against stubs/mocks only, since no batch session could provision `.venv-integration`: `async_remove_entry` against a real `ResourceStorageCollection.async_delete_item` (#121), the tracked-task debounced persist (#123), and the `ConfigEntryError` downgrade refusal (#120). Add cases under `tests/integration/`; until then a local `scripts/test_integration.sh` run covers the gap. | PR #120/#121/#123 follow-ups | Low | S–M |
| 53 | **Type-loose WS frames bypass `ws_guard` and land in HA core's log at ERROR.** A frame that fails the voluptuous schema in `ws.py` is rejected by HA core *before* `ws_guard` runs, and `homeassistant.components.websocket_api.http.connection` logs it at ERROR with the client payload (e.g. `expected int for dictionary value @ data['quantity']. Got 1.5`) — exactly the client mistakes item 32 downgraded to WARNING re-enter the log as ERROR through the front door (4 such lines in the 2026-07-28 session, all from deliberate fuzz). `ws.py` already widens some fields to `object` (`description`, `location_id`, `low_stock_threshold`) and validates them in the model layer; doing the same for `quantity` / `delta` / `operations` / required `name` would route them through `ws_guard` as typed `validation_error` WARNINGs. Deliberate trade-off, flagged rather than decided: schema-level typing is free documentation, so this is a judgment call, not an obvious win. | local verification run 2026-07-28 (F1) | Low–Med (support burden) | S–M |
| 54 | **`stress.py`'s idle control WS connection dies on any layer longer than ~90 s.** aiohttp only answers server pings while a `receive()` is in flight, and nothing awaits the control connection while the workers run, so HA closes it after ~90 s idle. Reproduced standalone; in the 2026-07-28 run the bulk-1000 layer finished all 1000 creates with 0 errors, then failed its post-run health check (`ClientConnectionResetError: Cannot write to closing transport`), skipping its delete/cleanup and leaving 1000 `stress_test_` items to sweep by hand. Not an HAventory bug — but it will keep masquerading as one. Fix: pump the control connection periodically, or open it lazily after the workload. | local verification run 2026-07-28 (F3) | Low (test harness) | S |
| 55 | **Adopt the 2026-07-28 verification harnesses into the `run-haventory` skill.** Three Playwright harnesses (`rl_banner.mjs` — WS tracing + shadow-DOM-piercing banner enumeration for the rate-limit lifecycle, `visual_pass.mjs`, `import_policies.mjs`) and two Python drivers were written for the batch verification and preserved only in the run's evidence folder; adding them to the skill would make the checks repeatable. Record two gotchas while there: HA's `Store` debounce delays `.storage/lovelace_resources` disk writes ~15 s, so reading the file right after a restart shows the old URL while the in-memory collection is already correct (do not misread as a cache-busting regression); and `scripts/test_integration.sh` runs fine inside a throwaway `python:3.14-slim` container when the host cannot provide Python 3.14 + PyPI access — the proven path on Windows hosts whose WSL lacks DNS. | local verification run 2026-07-28 | Low (dev tooling) | S–M |
| 56 | **The manual `resources.async_load()` in `_async_lovelace_resources` is redundant** at the declared 2026.6.0 floor: `ResourceStorageCollection`'s `async_items` / `async_create_item` / `async_update_item` / `async_delete_item` each ensure the collection is loaded before touching it, so the explicit load-and-flag dance only duplicates that — and writing `resources.loaded = True` reaches into another component's object to do it. A pure cleanup, deliberately left out of the card-shipping PR-1 scope; needs its own test pass because `tests/test_entry_removal_offline.py` asserts the current load-before-delete behaviour. | `docs/card_shipping_plan.md` (PR-1 non-goal) | Low | S |

---

## Notes on sources

- **WP4 (#91)** is the richest source: its "Follow-ups (out of scope)" section supplies
  items 1, 6, 8, 13, 14, 15, 17.
- **WP1 (#74)** and **WP0.5 (#73)** contributed the toolchain/deprecation follow-ups
  (items 3, 5, 8, 16, 17), most of which are also mirrored in the `CLAUDE.md`
  "WP1 follow-ups" list.
- **#76** (GitHub project setup) contributed the repo-hygiene + Dependabot items (2, 7).
- **Docs** (`frontend_architecture.md` "Future Enhancements", the `Phase 2.5+` list) and
  the **README** Phase 3 roadmap supply the larger post-1.0 UI features (items 4, 10, 11, 18);
  these were created/extended by the frontend PRs (#32, #79, #82–#86).
- The four WP2 PRs (#79, #80, #88, #90) shipped with empty bodies (`@-`); their follow-ups
  were consolidated into #80/#88 (already merged) and the `docs` staleness notes.
- The **WP4 online stress test** (an exploratory break-it run against the Docker HA container
  — bulk 250→1000 items, adversarial fuzzing, concurrency races, rate-limit toggling,
  mid-load restart with an on-disk cross-check, and a browser-driven card under load) surfaced
  items 19–23. The two confirmed breakages from the same run — the card not live-updating from
  WS subscriptions, and "Subscription not found" teardown rejections — are addressed separately
  in PRs #93 and #94.
- The **release-readiness review (2026-07-25)** — a code read of the install, update,
  rollback, backup and removal paths while drafting `release_testing_plan.md` — supplied
  items 25–31. Items 25 and 26 are confirmed from source, not hypotheses; the rest are
  release chores. The scenarios that exercise them are cross-referenced in the plan.
- A **dev-log review (2026-07-25)** of the Docker test instance supplied item 32. All 49
  `version conflict` ERRORs in that container's log are test fixtures (the `driver.py smoke`
  stale-version step and the online smoke/stress scripts — signatures `expected 1, actual 2`,
  `expected 1, actual 6`, `expected 999, actual 1`); none originated from the card. The
  conflict path itself is correct, so item 32 is about how loudly it is logged, not about
  the behavior.
- A later **gotcha triage of the `run-haventory`/`test-haventory` skills** surfaced item 24
  (lenient `item/list` filters). The other skill gotchas are environmental (broken `.venv`,
  partial `node_modules`, Python 3.14 requirement) or expected behavior (optimistic-concurrency
  `conflict`s, the destructive `HA_CONTAINER` clean-start mode), not tracked here.
- A **card UI consistency review (2026-07-26)**, run against the revamped card on
  `claude/ui-revamp-implementation-8fl22q` at 1440×900 and 375×812, supplied items 33–36.
  Everything else it found was fixed in that branch; these four are here because each needs
  a backend or contract change (33, 35, 36) or was deferred on effort (34). 33–35 were
  deferred past v1.0 by the owner; **36 is pre-v1.0 at the owner's request** (2026-07-26),
  because it settles what a stored field means rather than adding a feature — data entered
  under the old reading does not become wrong later. Each is measured against the running
  container rather than read off the source alone.
- Two **owner screenshot reports against the live dev container (2026-07-27)** supplied
  items 37, 38, and 39: the location editor's unexplained "Inherit" area option, the card's
  item-facing surfaces never showing an item's area even though the backend already computes
  and ships it (`effective_area_id`), and the table's select-all checkbox being invisible
  until a row is already selected. **37 and 39 were promoted to pre-v1.0 at the owner's
  request** (2026-07-27) — a UX-clarity fix and a CSS-specificity fix respectively, both
  small and neither gated on a contract change; 38 needs the frontend to thread `areasCache`
  into three more components and stays post-v1.0. Item 39 was originally drafted as item 36,
  but that number was already in use by the unrelated `inspection_date` item above (both were
  assigned independently before the branches carrying them were reconciled) — renumbered to
  39 to keep item numbers unique.
- A **live merge test (2026-07-27)** supplied item 40. A 1000-item R1 backup was restored into
  an empty instance and verified field-for-field, the instance was purged and re-seeded with a
  1000-item R2 set sharing three R1 location subtrees *by their original uuids*, and the R1
  backup was then merged back in. The merge itself was correct on every axis — 2000 items,
  53 locations, no duplicates, no losses, every projected counter hit exactly — so item 40 is
  about what the docs fail to say, not about the behavior. The duplicate-and-capture numbers
  in it come from a second, read-only `import/preview` of the same backup with the shared
  locations' uuids reassigned, which is why they are measured rather than reasoned.
- The **2026-07-27 fix batch** (PRs #120–#130 — one PR per pre-v1.0 item, each developed
  unattended from this file's item text) supplied items 41–51 via the "Follow-ups" sections
  of its PR bodies. Each PR deliberately left this file untouched so the eleven parallel
  branches would not conflict on it; the batch is reconciled here in one pass instead. The
  same pass settled two release-plan wordings the batch decided (D8/E4 now read "refuse",
  the log-review step exempts contract-defined WARNING rejections) and struck the
  now-done `storage.py` tracked-task bullets in `CLAUDE.md`.
- The **local verification run (2026-07-28)** supplied items 52–55. The merged batch
  (`main` @ `c3d6223`) was deployed into the throwaway Docker dev HA (2026.7.3, 2000
  items / 53 locations) and driven through both gates, the real-HA integration suite
  (7/7 — its first execution anywhere), the cache-busting rewrite matrix (pinned / stale
  `?v=` / bare URL, all rewritten in place under the same resource id), log-severity
  provocations plus a 14 701-line full-log sweep (exit criterion 4 met: zero HAventory
  tracebacks, zero ERROR for client-recoverable codes), the schema-downgrade refusal
  (store byte-identical, `setup_error` without retry), entry removal/re-add (store
  survives, resource re-registered once), the full rate-limit banner lifecycle
  (retrying → recovered, exhausted → Refresh restores), and DOM + screenshot passes for
  the cosmetic fixes at desktop and mobile widths. Every check passed; the instance ended
  at its exact pre-run baseline. Items 52 and 53 are the two log-hygiene gaps the sweep
  exposed around item 32's policy — one write path (52) and one schema path (53).

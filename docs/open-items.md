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
  against the **2026-07-27 fix batch** (PRs #120–#130), the **2026-07-28 WP5 burn-down**
  (PRs #134–#140), the **card-shipping rework** (#141–#148), and a **2026-08-01 cleanup
  pass** against `main` @ `08218f0` (post-#159), refreshed against `d65ff64` once the
  sidebar panel's PR-2 (#160) landed.
- **Item numbers are stable and append-only** — new items get the next free number
  rather than renumbering the list, so references from PRs and docs keep resolving.
  Read each table's own ordering, not the numbering, for priority. (The one exception —
  a branch race over numbers 56–65 — is recorded in the 2026-08-01 note below.)

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
> blocking-call warnings across a restart. Item **36** (`inspection_date` semantics) was
> resolved by **#133**: the field is settled as the *next inspection due* date —
> `inspection_overdue_count` in `get_counts()`, `inspection_overdue_only` on `ItemFilter`
> (carried through list, filter and subscribe), and the card unified on "Next inspection"
> across editor, sort menu, table header and detail sheet, with overdue badges via the
> same strictly-before comparison the backend makes. No storage migration — only the
> meaning of the existing field was settled.

> The **WP5 pre-release burn-down (2026-07-28)** — four more one-item PRs — resolved items
> **5** (#134, `tsc --noEmit` gated in CI and mirrored in `scripts/lint.sh` /
> `ci_local.sh`), **2** (#135 — all 30 Dependabot alerts triaged: 29 genuinely fixed by the
> WP1 toolchain bumps, and the one live one, `brace-expansion` GHSA-mh99-v99m-4gvg (high,
> dev-only), had been auto-dismissed within a second of filing and still sat in the
> lockfile — fixed by a transitive bump to 5.0.8, `npm audit` now clean), **6** (#136 —
> writing the guard test exposed that **every `haventory.*` service was a silent no-op on
> real HA**: lambda handlers were classified `HassJobType.Executor`, so HA ran them on a
> worker thread and never awaited the coroutine they returned; registration now binds
> `async def` adapters, guarded by a real-HA service-call suite and an offline
> every-handler-is-a-coroutine-function check) and **41** (#137, README truth-ups; the
> deferred (c) — the measured scale ceiling — lives on as item 60). Item **7** closed with
> **#138** plus the two owner-only steps: #138 checked the `main` ruleset into
> `.github/rulesets/main.json` (with the offline guard test that re-derives the check
> names from the workflows) and enabled Discussions; the owner then applied the ruleset
> and uploaded the social preview, both verified live 2026-07-28 — the
> `rules/branches/main` API returns all four rules (PR required, ten required status
> checks, deletion + force-push blocks) exactly matching the committed file, and the repo
> page serves the custom `og:image`. (Known limitation, accepted: nothing re-diffs the
> live ruleset against the committed file after that one-time verification — drift on the
> GitHub side is invisible; the guard test only protects the committed side.) The
> follow-ups these PRs reported that remain open are items **60–65**; #136's
> stub-divergence finding was folded into item 51; and two more — the npm-audit CI gate
> and the retry-after test's timing flake — closed the same evening as the first PRs
> merged under the active ruleset: **#139** put the `npm audit --audit-level=high` step in
> the `frontend` CI job (mirrored in `scripts/ci_local.sh`; the auto-dismissal rule stays
> on, the gate is the compensating control), and **#140** moved the retry-after test onto
> fake timers with `Date` mocked beside `setTimeout`, pinning the exact 40 ms boundary
> (no retry at 39 ms, retry at 40) and proving stability over 50 runs under deliberate
> CPU saturation. Their own follow-ups are items **66–67**.

> The **card-shipping rework** ([`card_shipping_plan.md`](card_shipping_plan.md)) resolved
> item **44** in its PR-1: the bundle is served from inside the integration package with no
> `Cache-Control`, so the dev loop no longer needs a hand-pinned content hash and
> `pin_resource.py` was retired rather than repointed. Its row is removed above; the one
> cleanup PR-1 deliberately left behind is item **56**. PR-2 (**#148**) made the release
> workflow build and attach the `haventory.zip` asset a HACS install reads; reviewing it
> caught that item **3**'s row ("config-ready but dormant") had been stale since #142
> turned the `push` trigger on, so that row is removed below, and the HACS upgrade-leftover
> caveat the same review surfaced is item **57**.

> A **truth-up pass (2026-07-31)**, prompted by item 3's staleness, checked the rest of the
> ledger against `main` and closed two more rows whose work had already landed
> unattributed. Item **17** — `tests/conftest.py` hands pytest-asyncio a
> `SelectorEventLoop` *factory* through the `pytest_asyncio_loop_factories` hook and
> mutates no process-wide policy; the two deprecated names now appear there only in a
> comment explaining what it deliberately avoids. Item **29** — the floor was set to
> `2026.6.0` at feature freeze, every declaration site carries that number,
> `tests/test_min_ha_version.py` fails if any of them drift, and
> `requirements-integration.txt` pins the in-process suite to it so CI runs against the
> floor rather than whatever is current. Item 29's last part, a *live* instance at the
> floor, is release-test **D6** and stays tracked in
> [`release_testing_plan.md`](release_testing_plan.md) rather than here.

> Item **59** (the sidebar panel's dead surfaces) was resolved inside item 58's PR-1:
> `host-surfaces.ts` now owns every surface `hv-full-view` can raise — the confirm, the
> organize dialog, the import sheet, diagnostics with its refresh state, and the shared
> ⋮ menu builder — with an instance in `hv-card-shell` and in `haventory-panel`, so the
> panel answers the full menu vocabulary. Its row is removed below.

> Item **58** (the sidebar panel) is delivered. **#159** shipped the frontend half — the
> `embedded` full view, the `haventory-panel` element, and the host-surface parity that
> closed item 59 — and **#160** registers that element at `/haventory` through
> `panel_custom`, on the same module URL both card loaders receive, converging
> remove-then-register so a reload cannot hit `Overwriting panel haventory`, under a
> `sidebar_panel_enabled` option (default on) that applies live through the existing
> update listener. The phacc suite asserts the real registration at the 2026.6.0 floor.
> Its row is removed below and [`sidebar-panel.md`](sidebar-panel.md) is marked
> delivered; the two follow-ups #160 reported are items **68** and **69**.

> A **cleanup pass (2026-08-01)**, run against `main` @ `08218f0` after #159, reconciled
> this ledger's two parallel lineages — the WP5 burn-down notes had lived on an unmerged
> branch while the card-shipping and sidebar work updated `main`'s copy — and closed eight
> more rows against the code. Item **30** — the version is `0.1.1` everywhere:
> release-please cut v0.1.0 and v0.1.1 on merge of its release PRs,
> `scripts/check_version_consistency.py` runs in the release workflow, and
> `tests/test_release_version_consistency.py` guards the file-to-file half in CI. Items
> **10** and **11** — both shipped with the card revamp: `hv-location-tree` renders the
> recursive expand/collapse tree (used by the sidebar, the organize dialog, the filter
> panel, the item editor and the bulk bar), and `hv-bulk-bar` drives multi-select bulk
> move / add-tags / remove-tags / set-category / adjust-quantity / check-out / check-in /
> delete. Item **12** — obsolete: `hv-category-browser` and `hv-tag-browser` no longer
> exist (the revamp removed the browse modals; issue #87 was closed as completed
> 2026-07-27). Item **45** — obsolete since the card-shipping rework: the card loads
> through `add_extra_js_url` in every Lovelace mode, so the YAML-mode resource skip is
> correctly DEBUG (its message says the card loads through the frontend module URL
> instead) and the unregister path already speaks at INFO. Item **49** — the selection
> bar now reads "N selected of T matching the current filter" and offers a
> "Load all T to select" action wired to `loadAllThenSelectAll`. Item **54** — the stress
> harness gained a control-connection keepalive when it moved into the `test-haventory`
> skill. Item **55** — #144 adopted the Playwright harnesses and Python drivers into the
> `run-haventory` skill. **Numbering:** the burn-down lineage had assigned its follow-ups
> numbers 56–65 while `main` independently assigned 56–59 to the card-shipping/sidebar
> items; `main`'s assignments stand (56 resource-load cleanup, 57 HACS upgrade leftovers,
> 58 sidebar panel, 59 dead surfaces), and the burn-down follow-ups are renumbered
> **60–67** — the same keep-numbers-unique rule as item 39's renumbering, applied to a
> branch race.

> **Scope change (2026-08-01, owner):** items **38**, **46**, **23** and **57** move from
> post-v1.0 to pre-v1.0. 38 (an item's area is nowhere in the card) and 46 (area
> propagation is surprising at the point of use) are the two halves of the same gap —
> the backend computes `effective_area_id` per item and no item-facing surface reads it;
> 23 is the subtree `version` churn a location rename causes; 57 is the HACS upgrade
> leaving retired files behind. Their rows move to the Pre-v1.0 table unchanged —
> same source, impact and effort — so only the release-scope classification changes.

> Item **38** (an item's area is nowhere in the card) is delivered, together with the three
> requirements the owner extended it with — recorded, with the design, in
> [`item38_area_display_plan.md`](item38_area_display_plan.md). Four stages on one branch:
> the shared helpers (`ui/area.ts`'s `areaNameById` + the cycle-guarded
> `effectiveAreaIdForLocation`, the `itemPathParts` / `locationPathParts` / `pathTitle` /
> `renderAreaChip` layer in `ui/location-path.ts`, the `.hv-area-chip` treatment promoted
> into `ui/tokens.ts`, and `groupRootsByArea` in `store/location-tree.ts`); grouped trees at
> all six `hv-location-tree` call sites; the three item-facing surfaces the row was filed
> about; and the remaining location-facing labels. **R2** — `effective_area_id` is now read
> by `hv-list-row`, `hv-data-table` and `hv-detail-sheet`, and the ancestor walk backs
> `hv-filter-chips`, `hv-filter-panel`, `hv-item-editor` and `hv-full-view`'s breadcrumb.
> **R1** — every tree groups its top-level locations under their HA area, ordered by area
> name with an arealess tail that only appears when some area group does, and the sidebar's
> headers set the `filters.areaId` the item query already accepted. **R3** — one chip
> vocabulary marks an area wherever it is shown, with `Area: <Name>` in words at the two
> places a chip would nest inside a chip; the organize tree's per-node chip retired into the
> group header that now states the same fact. No backend or contract change —
> `backend_api_contract.md` and `data_shapes.md` are untouched, the field was already on the
> wire. Its row is removed below, [`frontend_architecture.md`](frontend_architecture.md)
> carries the pattern, and the follow-ups the work reported are items **71–73**.

---

## Pre-v1.0

Ordered by impact.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 4 | **HACS publication** (Phase 3 "Polish & HACS"). Distribution path for a 1.0. The delivery mechanics landed with #148 — `zip_release`: the release workflow builds the card, attaches `haventory.zip`, drafts first and publishes last — and release-please has since cut v0.1.0 and v0.1.1; what remains is verifying a clean-HA install through HACS as a custom repository (release-test A1) and submission to the HACS default store. | README Phase 3, #148 | Medium (distribution) | M |
| 68 | **`scripts/create_test_items.py` crashes on a Windows console mid-run.** It prints a `✓` per created item (`create_test_items.py:229`); under cp1252, the default Windows console encoding, that raises `UnicodeEncodeError: 'charmap' codec can't encode character '✓'` and aborts the run partway — with the items up to that point already created, so the seed is partial rather than cleanly absent. `PYTHONIOENCODING=utf-8` works around it; the fix is ASCII output or an explicit UTF-8 stream wrapper on stdout. **Gates the launch material:** this script seeds the demo inventory the README and the announcement posts are shot against, and a run that aborts partway leaves a half-filled inventory that photographs badly. Do this before item 70, which retires the script once the assets exist. | PR #160 follow-up | Medium (release assets) | S |
| 69 | **The screenshot harness cannot reach the sidebar panel.** `.claude/skills/run-haventory/screenshot.mjs` hardcodes `waitForSelector("haventory-card")` (`screenshot.mjs:179`), so `--path /haventory` — where only `haventory-panel` exists — times out; PR #160's panel screenshots needed a throwaway script. An `--element` flag (or a `--panel` mode) defaulting to the current selector would let the skill cover the panel surface, and `visual_pass.mjs` could then gain the panel's surfaces too. **Gates the launch material:** the sidebar panel is the surface the README and the announcement posts lead with — HAventory as a page of its own — and it is precisely the one the harness cannot photograph today. Do this before item 70, which retires the harness once the assets exist. | PR #160 follow-up | Medium (release assets) | S |
| 70 | **Strip the scoping-only toolchain before 1.0.** A new contributor currently has to work out for themselves which half of `docs/` and `scripts/` is still live: the repo carries planning and one-off exploration artifacts that were load-bearing while the work was in flight and are dead weight once it ships. **Delivered plan docs** — `docs/sidebar-panel.md` (25 KB, its own status line reads *delivered*; nothing outside this ledger links it) and `docs/card_shipping_plan.md` (20 KB, status *PR-1 and PR-2 implemented*; linked from `CLAUDE.md:57`, from the card-shipping note above and from item 56's row). **Exception:** `docs/release_testing_plan.md` is the v1.0 readiness run itself: item 4 is gated on its A1, item 60 on its F3, and closed item 29's last part was deferred into it as D6 — so it goes *after* the release run, not before. **Exploration scripts** to triage the same way: `stress_test.py`, `create_test_items.py`, `ws_probe.py`, `ws_subscribe.py`, `ws_init_haventory.py`, and the agent harnesses under `.claude/skills/` (`run-haventory`'s `screenshot.mjs` / `visual_pass.mjs` / `log_sweep.py` / `driver.py` and `test-haventory`'s `stress.py`). Nothing here is a free delete: every script except `common.sh` (sourced by the others) has at least one inbound reference from CI, `CONTRIBUTING.md`, `README.md` or `CLAUDE.md`, and `tests/test_ws_logging_offline.py:12` cites the release plan in a docstring — so each removal takes its references with it, and whatever survives earns one line in `CONTRIBUTING.md` saying what it is for. **Sequence this after items 68 and 69**, not before: those two repair the seeding script and the screenshot harness that produce the README and announcement-post imagery, so this removal is what closes the door behind them. Retiring the harness first would only mean rebuilding it the next time a screenshot is needed. | owner 2026-08-01 (contributor onboarding) | Medium (contributor onboarding) | M |
| 46 | **Area propagation is surprising at the point of use — the effective-area preview from item 37.** Choosing the relabeled default option (#126) on a nested location does more than "stop inheriting": `Repository.update_location` runs `_propagate_area_to_root(key, None)`, clearing the area from the whole tree, and picking an explicit area moves the assignment to the tree root — nothing in the dialog warns about either. Item 37's live-preview idea lands here, with its recorded caution: an honest preview of the non-default options is a whole-tree effect and worth designing deliberately, and the dialog has no walk-up-to-root helper (`_findNode` only walks down), so the preview needs either a client-side walk or a `location/tree` contract change shipping `effective_area_id` per node. Cosmetic while there: with no HA areas the dropdown renders a one-entry select. | item 37 + PR #126 follow-ups | Low–Med | M |
| 23 | **Location rename bumps every subtree item's `version`** (denormalized `location_path` rewrite), so a client holding a stale `expected_version` for an unrelated field gets a spurious `conflict`. Indexes stay consistent — it's a UX surprise, not corruption. A path-only rewrite need not bump the optimistic-concurrency version. | WP4 stress test | Low | M |
| 57 | **A HACS upgrade never deletes files inside the integration directory.** With `zip_release`, HACS backs up the previous install and then runs `zipfile.extractall` straight over `<config>/custom_components/haventory/` without clearing it first (HACS `repositories/base.py`), so any file a newer release deletes or renames survives every user's upgrade; the dev container shows the same leftover class because `docker cp` also merges rather than replaces. Inert until a release actually removes a module or renames the card bundle — from that release on, either sweep the known stale paths at setup or call the leftover out in the release notes. `scripts/check_release_zip.py` cannot catch this: it validates the asset's layout, not the install directory's history. | PR #148 review | Low (upgrade hygiene) | S |

### Release-readiness tasks (from the 2026-07-25 review)

Work items — **not** tests — surfaced while drafting
[`release_testing_plan.md`](release_testing_plan.md), plus later findings of the same
release-blocking kind. All of the original group is now closed: the confirmed defects
(25, 26) and documentation gaps (28, 31, 40) by the 2026-07-27 batch, item 29 at feature
freeze (`2026.6.0`, defended by `tests/test_min_ha_version.py`), and item 30 by the
release automation cutting v0.1.0/v0.1.1. What remains is the one docs chore below,
gated on the release run's F3.

| # | Item | Source | Impact | Effort |
|---|------|--------|--------|--------|
| 60 | **Publish the measured scale ceiling once release-test F3 runs** — the deferred (c) of item 41. The README's Known-limitations entry gives measured per-create latencies up to 1000 items (~70 ms @250, ~114 @500, ~200 @1000) and extrapolates beyond ("on that curve a single create trends toward ~1 s at a few thousand items"); F3 ("Scale on real hardware") produces the measured degradation point that replaces the trend claim. One README edit after the F3 pass of the release run. | PR #137 follow-up (item 41c) | Low–Med (docs accuracy / release claim) | S (after F3) |

> Item 4 (HACS publication) above is also a release-readiness task and is referenced from
> the test plan; it is already tracked and is not duplicated here.

---

## Post-v1.0

Ordered by impact.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 9 | **Reminders / calendar rework onto HA-native primitives** — implement the roadmap's `CalendarEntity` (`calendar.haventory`) + HA automations instead of a bespoke scheduler. Explicitly decided as post-1.0. | #73 (CLAUDE.md pillar #9); #18 ("sensors/calendar evolve post-MVP") | Medium (feature) | M |
| 13 | **Perf (stretch):** 10k-item `low_stock_first` full-scan path is p50 32 ms vs a 30 ms budget (p95 fine). A cached low-stock-first ordering would close it. | #91 | Low | M |
| 14 | **Perf:** back-to-back subtree moves within one second pay a +1 s monotonic-bump slow path per item (pathological; one-off moves are fine). A batch-aware bump would fix it. | #91 | Low | M |
| 15 | **Rate limiting:** a per-connection command token is consumed even when the global bucket then rejects (deliberate check order; could refund). | #91 | Low | S |
| 16 | **TypeScript 7 adoption** once typescript-eslint supports it (currently capped `<6.1.0`). | #74 | Low | S |
| 18 | **Other frontend enhancements** (roadmap): advanced date-range filters, drag & drop move/reorder, item image upload (HA media), mobile touch/swipe optimization, offline/service-worker support, virtual-scroll/lazy-load perf. | `docs/frontend_architecture.md` (Future Enhancements Phase 2.5+) | Low | L (each) |
| 19 | **O(N²) persistence: every single mutation serializes the *whole* dataset and rewrites the store blob** (immediate persist, serialized by the write lock). Measured per-create p50 climbs 70 ms @250 → 114 ms @500 → 200 ms @1000 items; at a few thousand items a single create trends toward ~1 s. Correctness is unaffected. A debounced/delta persistence path for bulk work would flatten the curve. | WP4 stress test | Medium (scaling) | M |
| 20 | **No upper bound on `description` length (1 MB accepted) or `custom_fields` key count (~1000 accepted).** A persistence-bloat vector, amplified by #19. Add sane input caps. | WP4 stress test | Low | S |
| 21 | **Undecodable pagination `cursor` returns a full unfiltered page** (`"garbage"`, `""`, base64-junk) instead of `validation_error`. Reject malformed cursors explicitly. | WP4 stress test | Low | S |
| 22 | **Duplicate bulk `op_id`s collapse silently** — the operations execute but the per-`op_id` results dict keeps only the last, so the client can't tell which of its ops succeeded. Reject duplicate `op_id`s (or document last-wins in the contract). | WP4 stress test | Low | S |
| 24 | **`item/list` silently ignores unknown filter keys.** The `filter`/`sort` payloads are schema-validated only as `dict` (`ws.py`), and `repository.list_items` reads known keys via `flt.get(...)`, so a typo'd or unsupported key (e.g. `query`/`search` instead of `q`) is dropped and the "filtered" list returns **everything** instead of erroring — a silent-match-all footgun. Same input-hardening family as #20/#21: reject unknown `filter`/`sort` keys with `validation_error`. Confirm the card sends only known keys before tightening (contract change). | run-haventory skill gotcha review | Low | S |
| 33 | **Category and tag tallies ignore the active filter while location tallies honour it** — one sidebar column, two meanings for the same grey number. Measured in the expanded view with the low-stock filter on: location rows read `8 / 37`, `23 / 172` (matches over total) while category rows still read `43`, `74` — whole-inventory counts. Cause: `refreshLocationTree` refetches `location/tree` *with* the active filter (`store.ts:481`), but `haventory/distinct_values` (`ws.py:770`) accepts no filter at all, so `distinctValuesCache` is always global. The fix is a **backend contract change** — an optional `filter` on `haventory/distinct_values`, mirroring what `location/tree` already takes — plus passing it from `Store.refreshDistinctValues` and re-fetching on filter change like the tree does. Frontend-only interim options if that is unwanted: suppress the facet tallies while a filter is active, or mark them as totals. Deferred past v1.0 by the owner. | card UI consistency review 2026-07-26 | Medium (user-facing) | M |
| 34 | **The desktop filter panel's chips expose no pressed state to assistive tech.** Seven chips in `hv-filter-panel.ts` carry their selected state in an `on` CSS class and nothing else — no `aria-pressed`, no `role` (re-verified 2026-08-01: the file contains zero `aria-pressed`). The *same four* "Show only" facets in that component's mobile branch use `role="checkbox"` + `aria-checked`, and both app bars' stat pills plus the sidebar facet rows use `aria-pressed`, so the desktop panel is the sole surface where a screen reader cannot tell an active filter from an inactive one. Add `aria-pressed` to all seven (or `role="checkbox"`/`aria-checked` to match the mobile branch — pick one and use it for both branches). Deferred past v1.0 by the owner. | card UI consistency review 2026-07-26 | Low–Med (accessibility) | S |
| 35 | **Only tags can be multi-selected; categories and locations cannot** — the sidebar lets you accumulate tags but replaces the category or location on every click, and the filter is the reason, not the UI. `category` is a scalar the backend `.strip().casefold()`s (`models.py:758`, `:805`), so a list raises `AttributeError` inside `_get_filtered_candidates` (`repository.py:1033-1040`) and reaches the client as `unknown_error`; `location_id` is a single uuid-v4 that `str()`-stringifies to `"['a', 'b']"`, misses both `_items_in_subtree` and `_items_by_location_id` (`repository.py:1017-1031`) and returns `total: 0` **with no error** — a silent wrong answer. Inventing client-side keys fails the other way: `vol.Optional("filter"): dict` (`ws.py:1445-1453`) accepts unknown keys and `filter_items` ignores them, so the server returns the *unfiltered* set with a plausible `total` (same footgun as #24). There is no honest frontend-only version — client-side merging of N queries also breaks the server-computed `total`, the opaque cursor, and `location/tree`'s `matching_direct_count`/`matching_subtree_count`. The fix is additive: new `categories: list[str]` / `location_ids: list[str]` beside today's scalars, unioning the index buckets exactly as `tags_any` already does (`repository.py:1046-1056`), carried through `models.ItemFilter`, `models.filter_items`, `repository._get_filtered_candidates`, `repository.count_matching_by_location`, the subscription matcher `_item_matches_filter` (`ws.py:560-570`, a separate scalar path that would otherwise drift) and both contract docs. Open design question: whether one `include_subtree` flag applies to every picked location or becomes per-entry. Card side: `StoreFilters`, `toWireFilter`, `activeFilterCount`, `hv-filter-chips`, `hv-full-view`'s sidebar, `hv-filter-panel` (single-select today, would otherwise disagree with the sidebar) and `hv-location-tree`'s `selectedId` — the editor's location *picker* must stay single-select. No Any/All control is needed: an item has exactly one category and one location, so multi-select can only ever mean OR. Deferred past v1.0 by the owner. | card UI consistency review 2026-07-26 | Medium (user-facing) | M–L |
| 47 | **`import/preview` name-collision warning** — warn when an incoming entity's name collides with a *different* existing id. The docs now state the duplicate-on-rebuilt-ids hazard plainly (#127), but the preview is the only surface that could catch it *before* the write, since it already holds both sides in hand. The deferred M half of item 40. | item 40 + PR #127 follow-up | Medium (data safety) | M |
| 43 | **The WS API keeps answering — and writing the kept store — after config-entry removal, until restart.** `async_remove_entry` (#121) removes the Lovelace resource but leaves `hass.data[DOMAIN]["store"]`/`["repository"]` in place, and HA has no way to unregister WS commands, so an open dashboard can keep mutating the inventory after the integration is removed; a restart finishes the teardown. Decide whether handlers should refuse once the entry is gone. | PR #121 follow-up | Low–Med | S–M |
| 48 | **Card rate-limit polish left over from #128:** `Store.run()`'s command retries use a fixed exponential backoff (`retryBaseMs * 2 ** attempt`) and ignore the retry-after hint (`subscribeRetryDelayMs` is exported and reusable); the shell's banner chain is exclusive, so the queued-command "Busy — retrying" state is hidden while live updates are paused; and nothing calls `Store.dispose()` — its only caller is still its own test — so a shell torn down mid-backoff relies on GC rather than on the cancellation `dispose()` performs. | PR #128 follow-ups | Low | S–M |
| 42 | **Storage crashes generically on a corrupt (non-integer) `schema_version`.** `int(raw.get("schema_version", 0))` in `storage.py` raises `ValueError`/`TypeError` on a hand-edited `"schema_version": null` or non-numeric string (a numeric string like `"4"` is silently coerced instead), surfacing as the catch-all `ConfigEntryNotReady("storage load failed")` rather than a specific corruption message — and `_validate_storage_payload` in `__init__.py` repeats the pattern with `int(payload.get("schema_version", -1))`. `import_export.py` already type-checks its version fields; storage could match. Related trap: `migrations.migrate`'s downgrade pass-through is unreachable from production now that storage refuses first (#120) — a second caller would reintroduce the silent relabel. | PR #120 follow-ups | Low | S |
| 50 | **Two severity calls the #124 logging audit deliberately left open:** the frontend-resource registration failure logs WARNING + traceback although the card never loading is arguably operator-actionable (ERROR — but it is outside the error taxonomy's codes and the integration still functions); and `ws_items_bulk`'s "completed with no successful operations" WARNING summary is redundant with the per-op WARNING lines it follows. | PR #124 follow-ups | Low | S |
| 51 | **Real-HA integration coverage for the batch's stub-tested paths.** Three changes are asserted against stubs/mocks only, since no batch session could provision `.venv-integration`: `async_remove_entry` against a real `ResourceStorageCollection.async_delete_item` (#121), the tracked-task debounced persist (#123), and the `ConfigEntryError` downgrade refusal (#120). Add cases under `tests/integration/`; until then a local `scripts/test_integration.sh` run covers the gap. #136 sharpened the stakes: the offline `HomeAssistant` stub has no service registry, so `services.setup()` early-returns offline and no offline test can observe real registration semantics — exactly how the never-awaited executor-dispatched service handlers stayed invisible until the item-6 integration test ran (and HA's `_execute_service` executor fallback fails silently, so the same mistake in a future registration would be invisible again outside an integration test). Worth a wider sweep of what else the stubs let through. Still absent as of the 2026-08-01 check: `tests/integration/` has grown to eight modules (config entry, frontend serving, persistence, services, WS items, import/export, areas) and covers none of the three cases. | PR #120/#121/#123 follow-ups, #136 | Low | S–M |
| 53 | **Type-loose WS frames bypass `ws_guard` and land in HA core's log at ERROR.** A frame that fails the voluptuous schema in `ws.py` is rejected by HA core *before* `ws_guard` runs, and `homeassistant.components.websocket_api.http.connection` logs it at ERROR with the client payload (e.g. `expected int for dictionary value @ data['quantity']. Got 1.5`) — exactly the client mistakes item 32 downgraded to WARNING re-enter the log as ERROR through the front door (4 such lines in the 2026-07-28 session, all from deliberate fuzz). `ws.py` already widens some fields to `object` (`description`, `location_id`, `low_stock_threshold`) and validates them in the model layer; doing the same for `quantity` / `delta` / `operations` / required `name` would route them through `ws_guard` as typed `validation_error` WARNINGs. Deliberate trade-off, flagged rather than decided: schema-level typing is free documentation, so this is a judgment call, not an obvious win. | local verification run 2026-07-28 (F1) | Low–Med (support burden) | S–M |
| 56 | **The manual `resources.async_load()` in `_async_lovelace_resources` is redundant** at the declared 2026.6.0 floor: `ResourceStorageCollection`'s `async_items` / `async_create_item` / `async_update_item` / `async_delete_item` each ensure the collection is loaded before touching it, so the explicit load-and-flag dance only duplicates that — and writing `resources.loaded = True` reaches into another component's object to do it. A pure cleanup, deliberately left out of the card-shipping PR-1 scope; needs its own test pass because `tests/test_entry_removal_offline.py` asserts the current load-before-delete behaviour. | `docs/card_shipping_plan.md` (PR-1 non-goal) | Low | S |
| 61 | **Dependabot opens no update PRs for `requirements-integration.txt`.** `.github/dependabot.yml` declares `github-actions`, `npm` and `uv` ecosystems but no `pip` entry. The dependency graph does scan the file (`homeassistant` and `pytest-homeassistant-custom-component` are in the SBOM), so a vulnerability there would alert — what's missing is the automated fix PR. Add a `pip` ecosystem block for `/`; item 29 has since pinned the file to the `2026.6.0` floor, so configure the block to leave the pinned `homeassistant` line alone (an ignore rule, or security-only updates) rather than fight the pin. | PR #135 follow-up | Low | S |
| 62 | **The tsc gate covers `src/` only.** `tsconfig.json`'s `include` leaves `vite.config.ts`, `eslint.config.js` and the remaining `e2e/*.mjs` Playwright driver (`live-updates.smoke.mjs`; the other harnesses moved into the `run-haventory` skill) un-typechecked by the item-5 gate (#134); widening needs `allowJs`/`checkJs` decisions for the plain-`.mjs` driver. Minor sibling from the same PR: the typecheck runs identically on both Node matrix legs (~5 s each, `tsc` output does not vary with the Node runtime) — hoist to a single leg if the matrix ever gets expensive. | PR #134 follow-ups | Low | S–M |
| 63 | **pre-commit has no frontend hooks** — no eslint, no tsc, no vitest — so the card half of the gate is CI- and script-only for local commits. Adding npm-backed hooks is a new pattern for that config, not a tweak. | PR #134 follow-up | Low | S–M |
| 64 | **The card build warns `inlineDynamicImports` is deprecated** — switch the Vite config to `codeSplitting: false`. Pre-existing and harmless today; becomes an error in a future Vite major. | PR #135 follow-up | Low | S |
| 65 | **`CLAUDE.md` staleness sweep.** The Naming line still lists a bare `calendar.haventory` — the same "entity that doesn't exist yet" ambiguity item 41(b) fixed in the README (#137 added "reserved for the post-1.0 calendar work, item 9"). And since the card-shipping rework the build-path claims are stale too: the card builds to `custom_components/haventory/www/` and is served from the integration package, while `CLAUDE.md` still says the card builds to `www/haventory/haventory-card.js` and Naming lists built assets under `www/haventory/`. One docs pass over `CLAUDE.md`. | PR #137 follow-up, #147 | Low | S |
| 66 | **The `npm audit` gate stops at high/critical — moderate dev-scope advisories stay invisible.** #139 runs `--audit-level=high`, and the Dependabot auto-triage rule still dismisses every development-scope alert, so a moderate dev-scope advisory surfaces nowhere: auto-dismissed on the dashboard, below the CI gate's threshold. Tightening to `--audit-level=moderate` is a noise-tolerance call — moderate advisories in dev toolchains are frequent and often unfixable upstream; decide once the gate has some history. Sibling note from the same PR: the audit runs identically on both Node matrix legs; a single-leg gate would halve the (cheap) duplicate work. | PR #139 follow-up | Low (security posture) | S |
| 67 | **~1.5 s of one-sided wall-clock waits in the frontend suite could ride fake timers.** #140's sweep confirmed the remaining real-timer waits are slow, not flaky — each is one-sided ("has happened by now" / "still unchanged by now"), a shape extra scheduling delay can only strengthen: `store.revamp.test.ts:728`/`:748` (400 ms each, covering the 250 ms `scheduleTreeRefresh` debounce) and `:829` (5 ms), plus `hv-card-shell.test.ts:258`/`:769` and `hv-full-view.test.ts:1023` (250 ms each). Converting them to the #140 fake-timer pattern cuts ~1.5 s off every vitest run. | PR #140 follow-up | Low (suite speed) | S |
| 71 | **Should the table be able to sort items by area?** With the area now printed beside every path, the full view's Location column still orders on the backend's `location_path.sort_key` — path text, which knows nothing about areas — so two locations in the same room can sit anywhere relative to each other. Deliberately out of scope for item 38: its R1 is about how *locations* are ordered inside a tree, not how *items* are ordered in a list, and this is a contract question rather than a card one. `sort_key` is computed server-side (`repository.py`), so an area-aware ordering means either folding the area into that key or adding a sort field for it, plus a decision on where arealess items land. There is no honest card-only version: the list is paginated on an opaque cursor and `total` is server-computed, so re-ordering the loaded page would misrepresent the rest. | item 38 stage 4 (plan §3.6) | Low | M |
| 72 | **Is the filter panel's area `<select>` still worth its space beside the sidebar's area headers?** Both write and both reflect the same `filters.areaId` — the panel's select (`hv-filter-panel`, `filter-area`) and the full view's grouped-tree headers (`areaSelectable` → `select-area`) — so nothing disagrees; the question is whether the card wants two controls for one filter. It cuts both ways: the sidebar exists only in the full view while the panel is also the card's mobile filter sheet, so retiring the select would leave a phone with no way to pick an area at all, yet keeping it means the desktop full view offers the same filter twice a few hundred pixels apart. Worth deciding once the grouped sidebar has some use behind it. | item 38 stage 4 (plan §6) | Low | S |
| 73 | **A latent millisecond-boundary flake in `hv-full-view.test.ts`.** "keeps the editor open when some other item is deleted" builds two fixtures with `makeItem`, which stamps `updated_at` from the wall clock on each call; the list sorts `updated_at` descending with an `id`-ascending tie-break, so the rows come back in id order only while both stamps land inside the same millisecond. When they straddle one, the *second* item sorts first, the test's `table-edit` click opens the editor on the very item it then deletes, and the assertion fails. Observed once in a full-suite run and never in a single-file run — extra load makes the straddle likelier, which is what hides it. The fix is to pin `updated_at` on fixtures whose order the test depends on, not to add waiting; same family as item 67, and worth a sweep for other fixtures that lean on wall-clock ordering. | item 38 stage 4 (frontend gate) | Low (suite reliability) | S |

---

## Notes on sources

- **WP4 (#91)** is the richest source: its "Follow-ups (out of scope)" section supplies
  items 1, 6, 8, 13, 14, 15.
- **WP1 (#74)** and **WP0.5 (#73)** contributed the toolchain/deprecation follow-ups
  (items 8, 16), most of which are also mirrored in the `CLAUDE.md` "WP1 follow-ups" list.
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
  small and neither gated on a contract change; 38 was moved pre-v1.0 the following week
  (the scope-change note above) and delivered with it. Item 39 was originally drafted as item 36,
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
- The **item 38 area work (2026-08-01)** — four staged commits on one branch, designed in
  [`item38_area_display_plan.md`](item38_area_display_plan.md) — supplied items 71–73. The
  first two are questions the plan deliberately parked (§3.6 and §6) rather than findings;
  the third is a latent test flake the stage-4 gate happened to expose.
- The **WP5 pre-release burn-down (2026-07-28, PRs #134–#140)** supplied items 60–67 via
  its PR-body "Follow-ups" sections (originally numbered 56–65 on the branch that carried
  the reconciliation; renumbered in the 2026-08-01 cleanup after `main` independently
  assigned 56–59 — see the numbering note above).

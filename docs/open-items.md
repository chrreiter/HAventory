# Open Items — future work & identified gaps from closed PRs

Compiled from a sweep of **all closed pull requests** (#1–#91) plus the follow-up
notes they reference in `CLAUDE.md`, `README.md`, and `docs/`. Pure Dependabot /
tooling-bump PRs (the majority of the closed set) carry no future-work notes and are
excluded. Each item records its **source PR**, **impact**, **effort**, and whether it
is **pre-v1.0** (should land before a 1.0 release) or **post-v1.0** (enhancement /
non-blocking).

- **Impact** — High / Medium / Low (user-facing or release/correctness/security risk).
- **Effort** — S (≲ half a day) · M (~1–3 days) · L (multi-day).
- Status verified against the working tree at `main` @ WP4 (`390cba6`); items 1, 10, 11 and
  12 were resolved afterwards by the WP4.1 UI revamp.

> Already resolved along the way (not listed below): type-hardening `ws.py`/`repository.py`
> + dropping the mypy override (done in #91/WP4); the `*.sh` CRLF guard, now present in
> `.gitattributes` (added in #74, so the #91 note is closed); and the Phase-1 "advanced
> filters/sorts deferred" note from #18 (delivered by WP2/WP3 + full-text search #49).
>
> **Resolved by the WP4.1 UI revamp** (frontend only; struck through in the tables below):
> #1 rate-limited subscriptions, #10 location tree view, #11 bulk operations, #12 unifying
> the category/tag browsers.

---

## Pre-v1.0

Ordered by impact.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 1 | ~~**Card doesn't handle `rate_limited` on `subscribe`.**~~ **Done (WP4.1).** A refused subscribe now marks the card degraded and drops `connected`; commands retry with backoff; a banner and the diagnostics panel say the list may be stale, with an explicit Refresh. | #91 (WP4) | Medium | S–M |
| 2 | **Triage the 19 Dependabot security alerts on `main`** (`/security/dependabot`). Pre-existing, flagged as unrelated to #76 but still open. | #76 | Medium (security) | S–M |
| 3 | **Enable release automation.** `release-please` is config-ready but dormant — uncomment the `push` trigger in `.github/workflows/release-please.yml` and run the release flow. Needed to cut a 1.0. | #74, #76 | Medium (release-blocking) | S |
| 4 | **HACS publication** (Phase 3 "Polish & HACS"). Distribution path for a 1.0. | README Phase 3 | Medium (distribution) | M |
| 5 | **Add `tsc --noEmit` (typecheck) to the CI gate.** It is clean (#89/#91) but still not gated, so card type regressions can slip through. | #74, `docs/frontend_architecture.md` | Low–Med | S |
| 6 | **Pin the service-registration pattern with a test.** `services.py` registers sync lambdas that return coroutines; the integration suite passes, but a targeted service-call integration test would guard it. | #91 | Low–Med (correctness) | S |
| 7 | **GitHub repo hardening (manual, GitHub UI):** branch protection/ruleset on `main`, secret scanning + push protection, enable Discussions, run the `labels` workflow once, set a social-preview image. | #76 | Low | S (manual) |
| 8 | **`storage.py` debounced persist uses bare `asyncio.create_task`** instead of `hass.async_create_background_task(...)` (HA guidance: tracked tasks are cancelled/awaited on shutdown). Note: this path is currently production-dead (WS handlers persist immediately), so low impact. | #73 (WP0.5), #74, #91 | Low | S |

---

## Post-v1.0

Ordered by impact.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 9 | **Reminders / calendar rework onto HA-native primitives** — implement the roadmap's `CalendarEntity` (`calendar.haventory`) + HA automations instead of a bespoke scheduler. Explicitly decided as post-1.0. | #73 (CLAUDE.md pillar #9); #18 ("sensors/calendar evolve post-MVP") | Medium (feature) | M |
| 10 | ~~**Location tree view**~~ **Done (WP4.1).** `hv-location-tree` renders the real nested tree with the backend's own direct/subtree counts, used by the full-view sidebar, the filter panel, the item editor and the organize dialog. | #32, `docs/frontend_architecture.md` | Medium | M |
| 11 | ~~**Bulk operations**~~ **Done (WP4.1).** Selection mode in the full view plus a bulk bar over `haventory/items/bulk`, chunked for determinate progress, with per-operation results and retry-failed. | `docs/frontend_architecture.md` (Future Enhancements) | Medium | M |
| 12 | ~~**Unify `hv-category-browser` + `hv-tag-browser`**~~ **Done (WP4.1).** Both are superseded by the tabbed `hv-organize-dialog`, which also gains rename, merge and guarded removal. The old browsers have since been deleted. Issue #87 can be closed. | #84, issue #87 | Low | M |
| 13 | **Perf (stretch):** 10k-item `low_stock_first` full-scan path is p50 32 ms vs a 30 ms budget (p95 fine). A cached low-stock-first ordering would close it. | #91 | Low | M |
| 14 | **Perf:** back-to-back subtree moves within one second pay a +1 s monotonic-bump slow path per item (pathological; one-off moves are fine). A batch-aware bump would fix it. | #91 | Low | M |
| 15 | **Rate limiting:** a per-connection command token is consumed even when the global bucket then rejects (deliberate check order; could refund). | #91 | Low | S |
| 16 | **TypeScript 7 adoption** once typescript-eslint supports it (currently capped `<6.1.0`). | #74 | Low | S |
| 17 | **`tests/conftest.py`** uses `WindowsSelectorEventLoopPolicy` / `set_event_loop_policy`, both deprecated for removal in Python 3.16. Replace when convenient. | #74, #91 | Low | S |
| 18 | **Other frontend enhancements** (roadmap): drag & drop move/reorder (the handoff's optional "drag items onto a location" is not built), item image upload (HA media), offline/service-worker support, virtual-scroll perf (`@lit-labs/virtualizer` is a declared dependency that nothing imports). *Partly delivered by WP4.1: date filters — updated-since / created-since — and the mobile layout, detail sheet and staged filter sheet are in.* | `docs/frontend_architecture.md` | Low | L (each) |
| 19 | **O(N²) persistence: every single mutation serializes the *whole* dataset and rewrites the store blob** (immediate persist, serialized by the write lock). Measured per-create p50 climbs 70 ms @250 → 114 ms @500 → 200 ms @1000 items; at a few thousand items a single create trends toward ~1 s. Correctness is unaffected. A debounced/delta persistence path for bulk work would flatten the curve. | WP4 stress test | Medium (scaling) | M |
| 20 | **No upper bound on `description` length (1 MB accepted) or `custom_fields` key count (~1000 accepted).** A persistence-bloat vector, amplified by #19. Add sane input caps. | WP4 stress test | Low | S |
| 21 | **Undecodable pagination `cursor` returns a full unfiltered page** (`"garbage"`, `""`, base64-junk) instead of `validation_error`. Reject malformed cursors explicitly. | WP4 stress test | Low | S |
| 22 | **Duplicate bulk `op_id`s collapse silently** — the operations execute but the per-`op_id` results dict keeps only the last, so the client can't tell which of its ops succeeded. Reject duplicate `op_id`s (or document last-wins in the contract). | WP4 stress test | Low | S |
| 23 | **Location rename bumps every subtree item's `version`** (denormalized `location_path` rewrite), so a client holding a stale `expected_version` for an unrelated field gets a spurious `conflict`. Indexes stay consistent — it's a UX surprise, not corruption. A path-only rewrite need not bump the optimistic-concurrency version. | WP4 stress test | Low | M |
| 24 | **`item/list` silently ignores unknown filter keys.** The `filter`/`sort` payloads are schema-validated only as `dict` (`ws.py`), and `repository.list_items` reads known keys via `flt.get(...)`, so a typo'd or unsupported key (e.g. `query`/`search` instead of `q`) is dropped and the "filtered" list returns **everything** instead of erroring — a silent-match-all footgun. Same input-hardening family as #20/#21: reject unknown `filter`/`sort` keys with `validation_error`. Confirm the card sends only known keys before tightening (contract change). | run-haventory skill gotcha review | Low | S |

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
- A later **gotcha triage of the `run-haventory`/`test-haventory` skills** surfaced item 24
  (lenient `item/list` filters). The other skill gotchas are environmental (broken `.venv`,
  partial `node_modules`, Python 3.14 requirement) or expected behavior (optimistic-concurrency
  `conflict`s, the destructive `HA_CONTAINER` clean-start mode), not tracked here.

# Open Items — future work & identified gaps from closed PRs

Compiled from a sweep of **all closed pull requests** (#1–#91) plus the follow-up
notes they reference in `CLAUDE.md`, `README.md`, and `docs/`. Pure Dependabot /
tooling-bump PRs (the majority of the closed set) carry no future-work notes and are
excluded. Each item records its **source PR**, **impact**, **effort**, and whether it
is **pre-v1.0** (should land before a 1.0 release) or **post-v1.0** (enhancement /
non-blocking).

- **Impact** — High / Medium / Low (user-facing or release/correctness/security risk).
- **Effort** — S (≲ half a day) · M (~1–3 days) · L (multi-day).
- Status verified against the working tree at `main` @ WP4 (`390cba6`).

> Already resolved along the way (not listed below): type-hardening `ws.py`/`repository.py`
> + dropping the mypy override (done in #91/WP4); the `*.sh` CRLF guard, now present in
> `.gitattributes` (added in #74, so the #91 note is closed); and the Phase-1 "advanced
> filters/sorts deferred" note from #18 (delivered by WP2/WP3 + full-text search #49).

---

## Pre-v1.0

Ordered by impact.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 1 | **Card doesn't handle `rate_limited` on `subscribe`.** If opt-in rate limiting is enabled and tripped, live updates die **silently** — the card should surface the condition and/or retry. | #91 (WP4) | Medium | S–M |
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
| 10 | **Location tree view** — recursive expand/collapse rendering (list is currently flat; "deferred to Phase 2.5"). | #32, `docs/frontend_architecture.md` | Medium | M |
| 11 | **Bulk operations** — multi-select with bulk edit/delete. | `docs/frontend_architecture.md` (Future Enhancements) | Medium | M |
| 12 | **Unify `hv-category-browser` + `hv-tag-browser`** into one kind-parameterized value-browser. Already tracked as **open issue #87**; frontend-only, no behavior change. | #84, issue #87 | Low | M |
| 13 | **Perf (stretch):** 10k-item `low_stock_first` full-scan path is p50 32 ms vs a 30 ms budget (p95 fine). A cached low-stock-first ordering would close it. | #91 | Low | M |
| 14 | **Perf:** back-to-back subtree moves within one second pay a +1 s monotonic-bump slow path per item (pathological; one-off moves are fine). A batch-aware bump would fix it. | #91 | Low | M |
| 15 | **Rate limiting:** a per-connection command token is consumed even when the global bucket then rejects (deliberate check order; could refund). | #91 | Low | S |
| 16 | **TypeScript 7 adoption** once typescript-eslint supports it (currently capped `<6.1.0`). | #74 | Low | S |
| 17 | **`tests/conftest.py`** uses `WindowsSelectorEventLoopPolicy` / `set_event_loop_policy`, both deprecated for removal in Python 3.16. Replace when convenient. | #74, #91 | Low | S |
| 18 | **Other frontend enhancements** (roadmap): advanced date-range filters, drag & drop move/reorder, item image upload (HA media), mobile touch/swipe optimization, offline/service-worker support, virtual-scroll/lazy-load perf. | `docs/frontend_architecture.md` (Future Enhancements Phase 2.5+) | Low | L (each) |

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

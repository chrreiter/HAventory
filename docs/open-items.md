# Open Items — pre-v1.0 tracker

**Post-v1.0 tracking moved to GitHub issues on 2026-08-03.** Every unresolved post-v1.0
row of this ledger became an issue — filed with the 🔧 *Task / tracked work item*
template, each citing its ledger item number(s); the
[migration map](#post-v10--github-issues-migrated-2026-08-03) below keeps retired
numbers resolving. New findings are filed as issues directly, which is also where user
bug reports and feature requests land. This file now carries only what ships **before
`v1.0.0`**, and is deleted at v1.0.

**Triage is hard: no new features before v1.0** (owner, 2026-08-03). A new finding is
either release-blocking — a row here, or shipped straight from a session prompt the way
the v0.2.0 follow-up batch was — or it is post-v1.0 and goes to the issue tracker.

- **Impact** — High / Medium / Low (user-facing or release/correctness/security risk).
- **Effort** — S (≲ half a day) · M (~1–3 days) · L (multi-day).
- **Item numbers are stable and append-only** — retired numbers are never reused. The
  history of everything closed before the migration lives in git
  (`git log -- docs/open-items.md`), not in this file.

## Release staging

This section is authoritative for staging (it superseded the roadmap artifact on
2026-08-02; when they disagree, this section wins). Every remaining task has a
paste-ready prompt in [`v1_prompts.md`](v1_prompts.md); the complex ones have a
companion plan doc, linked from their rows below.

**Where it stands (2026-08-03).** `v0.2.0` is cut, carrying the full payload
(#167–#172) and its follow-up fixes. Two features merged after the cut (#183 sidebar
mark, #185 empty-area filing) ride release-please's pending `v0.3.0` (#186); with the
feature freeze, that makes `v0.3.0` the **last feature release** — item 79's validation
run targets it once cut (the run was defined against `v0.2.0` before the post-cut
features landed; the staging's own rule already covered this: later features take their
own 0.x minors and the stages below move down). **Item 79 — the validation run — is
next.**

| Stage | Carries | Gate before moving on |
|---|---|---|
| **last feature release** — `v0.3.0`, pending #186 | The two post-`v0.2.0` features (#183, #185). Feature-frozen from here. | [`release_testing_plan.md`](release_testing_plan.md) in full: scenario groups A–J on ENV-A/B/C/D, all six exit criteria (item 79). Thoroughly, because this is the release that gets exercised, not the 1.0. |
| **`0.x` patches** | Validation-run findings, one PR per fix, re-running the affected scenarios. | The plan runs clean. |
| **schema exercise** — the next 0.x minor | The deliberate `v4 → v5` forward migration, proving the migration machinery on the live production store (item 80). | Data integrity after the migration (counts before/after, spot checks, JSON export diff) plus an agreed watch window. |
| **schema collapse** — another 0.x minor | The dev migrations squashed into a clean **v1** (item 81). Intentionally breaking; safe only because nothing 0.x is published beyond the owner's own install. | The crossing rehearsed, then done: **JSON export taken *before* installing this release** — storage refuses version downgrades (#120), so there is no way back afterwards except through that export. Watch window. |
| **`v1.0.0`** | **Nothing.** A version bump on a proven 0.x (item 83). This file is deleted here. | — |
| after 1.0 | HACS default-store submission — [issue #196](https://github.com/chrreiter/HAventory/issues/196). | — |

Pinned decisions (owner, 2026-08-02): **the schema bump waits for the features** (no
schema version moves until the last feature release is out, so a migration is never
rehearsed against a store about to change shape again); **the collapse to v1 is a 0.x
release, not the 1.0 step** (it ships and gets used one release early, so 1.0.0 is a
bump over something proven in daily use); **1.0.0 carries no change** and no separate
validation run of its own.

**Versioning policy** (governs every release above): semver on the HACS cadence —
**PATCH** bugfix with no schema change; **MINOR** backward-compatible, including
automatic migrations; **MAJOR** breaking / non-auto-migratable (the item-81 collapse is
exempted only because nothing 0.x is published beyond the owner's install).
Pre-releases `-alpha/-beta/-rc`; deprecations survive ≥ 1 MINOR with warnings; the
changelog carries migration notes. Performance budgets, for the record: 2k items / 60
locations typical, 10k / 200 stretch; item list 50-row filtered+sorted page p50 ≤ 30 ms /
p95 ≤ 75 ms; subtree move (≤ 200 locations, ≤ 5k items) p50 ≤ 80 ms / p95 ≤ 150 ms; card
first 50-row render ≤ 200 ms p95, 60 fps scroll, type-ahead round trip ≤ 200 ms p95.

**Risk watch-list:**

- HA ships monthly — re-skim the dev blog + breaking changes before each release; the
  min-HA floor (2026.6.0) and the phacc pin age, and the floor moves with new advisories.
- The collapse (81) is the one breaking step: **export before installing it** — storage
  refuses downgrades (#120); a missed export means manual store surgery.
- The dogfood loop has no natural end — each watch window is defined up front (N days,
  zero new Blocker/Major), so the 1.0 date doesn't drift on vibes.
- Workflow-file pushes need the GitHub App's `workflows` permission — a rejected push
  means outputting the diff for the owner to apply, not failing.
- Dependabot alerts are invisible from cloud sessions — that triage is local-only or
  needs the alert list pasted in.
- Log-review literacy for the run: exit criterion 4 counts `custom_components.haventory`
  tracebacks only; item-32 WARNINGs and item-53 core ERRORs are expected, not findings.
- brands + HACS default-store reviews run on external timelines — file early
  ([#196](https://github.com/chrreiter/HAventory/issues/196)); the custom-repo path
  works meanwhile.

## Pre-v1.0

One row remains, sequenced after item 79's run; everything else before 1.0 is the
release-stage table below.

| # | Item | Source PR(s) | Impact | Effort |
|---|------|--------------|--------|--------|
| 70 | **Strip the scoping-only toolchain before 1.0.** A new contributor currently has to work out for themselves which half of `docs/` and `scripts/` is still live: the repo carries planning and one-off exploration artifacts that were load-bearing while the work was in flight and are dead weight once it ships. **Delivered plan docs** — `docs/sidebar-panel.md` (its own status line reads *delivered*) and `docs/card_shipping_plan.md` (status *PR-1 and PR-2 implemented*; linked from `CLAUDE.md` and cited by [issue #207](https://github.com/chrreiter/HAventory/issues/207)). **Exception:** `docs/release_testing_plan.md` is the validation run itself — item 79 executes it, item 60 (F3) and the HACS listing's verification half (release-test A1, [issue #196](https://github.com/chrreiter/HAventory/issues/196)) are gated on it, and closed item 29's last part was deferred into it as D6 — so it goes *after* that run, not before. **Exploration scripts** to triage the same way: `stress_test.py`, `create_test_items.py`, `ws_probe.py`, `ws_subscribe.py`, `ws_init_haventory.py`, and the agent harnesses under `.claude/skills/` (`run-haventory`'s `screenshot.mjs` / `visual_pass.mjs` / `log_sweep.py` / `driver.py` and `test-haventory`'s `stress.py`). Nothing here is a free delete: every script except `common.sh` (sourced by the others) has at least one inbound reference from CI, `CONTRIBUTING.md`, `README.md` or `CLAUDE.md`, and `tests/test_ws_logging_offline.py:12` cites the release plan in a docstring — so each removal takes its references with it, and whatever survives earns one line in `CONTRIBUTING.md` saying what it is for. Item 69 (the screenshot-harness repair this was sequenced behind) is delivered, so this waits only on item 79's run. Design: [`item70_toolchain_retirement_plan.md`](item70_toolchain_retirement_plan.md). | owner 2026-08-01 (contributor onboarding) | Medium (contributor onboarding) | M |

### Release-stage tasks (executed in staging order, not by impact)

The stages of the staging table above, as numbered items. Prompts for every row live in
[`v1_prompts.md`](v1_prompts.md).

| # | Item | Source | Impact | Effort |
|---|------|--------|--------|--------|
| 79 | **Execute the validation run against the last feature release** (`v0.3.0` once #186 cuts) — [`release_testing_plan.md`](release_testing_plan.md) in full: scenario groups A–J on ENV-A (real production instance) / ENV-B (throwaway Docker) / ENV-C (floor-pinned 2026.6.0; D6 is the live half of the min-HA claim) / ENV-D (backup restore), the group-J soak included, all six exit criteria. The install via HACS custom repository is release-test A1 and closes the verification half of the HACS listing ([issue #196](https://github.com/chrreiter/HAventory/issues/196)); F3 produces item 60's numbers. Findings are triaged here with impact ratings; fixes ship one PR each as 0.x patches, re-running affected scenarios until the plan is clean. Runs in **local** Claude Code next to the Docker host / real HA — not a web session. | roadmap WP8, restaged 2026-08-02 | High (the release gate) | L |
| 60 | **Publish the measured scale ceiling once release-test F3 runs** — the deferred (c) of item 41. The README's Known-limitations entry gives measured per-create latencies up to 1000 items (~70 ms @250, ~114 @500, ~200 @1000) and extrapolates beyond ("on that curve a single create trends toward ~1 s at a few thousand items"); F3 ("Scale on real hardware") produces the measured degradation point that replaces the trend claim. One README edit after the F3 pass of item 79's run. The structural fix behind those numbers is post-v1.0 ([issue #200](https://github.com/chrreiter/HAventory/issues/200)). | PR #137 follow-up (item 41c) | Low–Med (docs accuracy / release claim) | S (after F3) |
| 82 | **README promotion: real screenshots + docs consistency pass.** The README leads with what HAventory looks like — 2–3 real captures from a seeded instance (sidebar panel full view, card list with the editor open, phone layout are the strong candidates; the owner approves the set), wired into the README top, plus a consistency pass over README / CONTRIBUTING / `docs/`. Item 69's harness fix is in, so the panel captures are `visual_pass.mjs --only panel`; any time after the last feature release, required before item 83. `CLAUDE.md`'s own staleness sweep is post-v1.0 ([issue #213](https://github.com/chrreiter/HAventory/issues/213)). | roadmap WP9 step 1, restaged 2026-08-02 | Medium (launch material) | S–M |
| 80 | **Schema exercise: the first real migration (`v4 → v5`), proven on the live production store.** Every existing migration is a `setdefault`/no-op, so the machinery has never moved real data; before the collapse and before strangers' stores depend on it, one deliberate forward, idempotent migration ships as the next 0.x minor *after the last feature release* and upgrades the owner's live store in place, verified by counts before/after, spot checks and a JSON export diff, then an owner-defined watch window. Design: [`schema_exercise_plan.md`](schema_exercise_plan.md). | roadmap WP8 schema half, restaged 2026-08-02 | High (migration confidence) | M |
| 81 | **Schema collapse to v1 + the export→import crossing** — the one deliberately breaking release. `CURRENT_SCHEMA_VERSION` → 1 at the post-exercise shape, `migrations.py` emptied, higher-versioned stores refused (#120); the owner's store crosses via JSON export (taken **before** installing) → clean install → import, **rehearsed first** on a copy of the real export in a throwaway Docker HA; release-tests D7/D8/E3/E4 re-run against the collapsed schema; owner's explicit go before merge; watch window after. Design: [`schema_collapse_plan.md`](schema_collapse_plan.md). | roadmap WP9 step 2, restaged 2026-08-02 | High (breaking step) | M |
| 83 | **Cut `v1.0.0` — carrying nothing.** After item 81's watch window closes, the version bump that declares the proven 0.x stable: release-please needs an explicit one-shot instruction to cross 1.0 (`bump-minor-pre-major` stops at 0.x; verify the `release-as` mechanism against the release-please docs, configure exactly one 1.0.0 cut, revert the config after so the next fix is 1.0.1). Release notes summarize the 1.0 feature set and carry the one-time crossing instruction for anyone still on 0.x. Deleting this file (tracking is all-GitHub from here) belongs to this step. | roadmap WP9 step 3, restaged 2026-08-02 | High (the release) | S |

## Post-v1.0 → GitHub issues (migrated 2026-08-03)

Filed from this ledger's post-v1.0 tables plus a sweep of the PRs merged since the last
reconcile (`28f5ccd`, i.e. #179–#185). The sweep found one new follow-up — #181's
"No area" band label mismatch — folded into issue #203; #180's follow-up (the
live-update smoke's hardcoded dashboard path) was already fixed by #182; #179, #182,
#183 and #185 reported nothing new. Tightly-related small items were consolidated into
one issue each; every issue cites its ledger item number(s) and carries the row's full
text, so the rows are gone from this file.

| Ledger item(s) | Issue |
|---|---|
| 4 (post-1.0 submission half) | [#196](https://github.com/chrreiter/HAventory/issues/196) HACS default-store listing |
| 9 | [#187](https://github.com/chrreiter/HAventory/issues/187) Reminders / calendar on HA-native primitives |
| 13, 14 | [#201](https://github.com/chrreiter/HAventory/issues/201) Repository perf stretch |
| 15, 48 | [#199](https://github.com/chrreiter/HAventory/issues/199) Rate-limit polish (backend refund + card retry-after/banner/dispose) |
| 16 | [#211](https://github.com/chrreiter/HAventory/issues/211) TypeScript 7 adoption |
| 18 | [#191](https://github.com/chrreiter/HAventory/issues/191) Frontend enhancements backlog |
| 19 | [#200](https://github.com/chrreiter/HAventory/issues/200) Persistence scaling (whole-blob rewrite per mutation) |
| 20, 21, 22, 24, 53 | [#197](https://github.com/chrreiter/HAventory/issues/197) WS API input hardening |
| 33 | [#193](https://github.com/chrreiter/HAventory/issues/193) Facet tallies ignore the active filter |
| 35 | [#192](https://github.com/chrreiter/HAventory/issues/192) Multi-select for categories and locations |
| 42 | [#198](https://github.com/chrreiter/HAventory/issues/198) Corrupt `schema_version` handling |
| 47 | [#195](https://github.com/chrreiter/HAventory/issues/195) `import/preview` name-collision warning |
| 50 | [#206](https://github.com/chrreiter/HAventory/issues/206) Logging severity calls from the #124 audit |
| 51 | [#208](https://github.com/chrreiter/HAventory/issues/208) Real-HA coverage for stub-tested paths |
| 56 | [#207](https://github.com/chrreiter/HAventory/issues/207) Drop the manual `resources.async_load()` |
| 61, 62, 63, 64, 66 | [#210](https://github.com/chrreiter/HAventory/issues/210) Toolchain/CI polish |
| 65 | [#213](https://github.com/chrreiter/HAventory/issues/213) CLAUDE.md staleness sweep |
| 67, 77 | [#209](https://github.com/chrreiter/HAventory/issues/209) Frontend suite: fake timers + `setTimeout` teardown sweep |
| 71 | [#204](https://github.com/chrreiter/HAventory/issues/204) Design: sort items by area? |
| 72 | [#205](https://github.com/chrreiter/HAventory/issues/205) Design: area select vs sidebar headers |
| 76 (+ PR #181 follow-up) | [#203](https://github.com/chrreiter/HAventory/issues/203) Area label polish (phone row, "No area" band) |
| 78 | [#202](https://github.com/chrreiter/HAventory/issues/202) Retry a refused area-registry subscription |
| 84 | [#188](https://github.com/chrreiter/HAventory/issues/188) History log + CSV export |
| 85 | [#190](https://github.com/chrreiter/HAventory/issues/190) Localization beyond English |
| 86 | [#189](https://github.com/chrreiter/HAventory/issues/189) Item status field |
| 87 | [#194](https://github.com/chrreiter/HAventory/issues/194) Area filter on `haventory/subscribe` |
| 88 | [#214](https://github.com/chrreiter/HAventory/issues/214) Quality backlog (property tests, visual regression, telemetry) |
| 89, 90 | [#212](https://github.com/chrreiter/HAventory/issues/212) Visual-pass harness follow-ups |

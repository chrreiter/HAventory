# Prompts — every task from here to v1.0.0

The definitive task set for the road to 1.0, one paste-ready prompt per item. The
staging (which release each item ships in, and in what order) is the **Release staging**
section of [`open-items.md`](open-items.md) — that section is authoritative; this file
carries the execution prompts. Complex items have a companion plan doc; their prompts
here point at it. This file supersedes the roadmap artifact's WP8/WP9 prompts, which
predate the 2026-08-02 staging revision.

Conventions every prompt below assumes (stated once here, per `CLAUDE.md`):

- TDD; both gates green before every commit — backend
  `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q` + `uv run ruff check .` +
  `uv run mypy`; frontend (in `cards/haventory-card`) `npx eslint .` +
  `npm run typecheck` + `npx vitest run` + `npm run build`.
- Fresh branch from latest `origin/main`, one PR per item, Conventional Commits.
- Run **serially**: update the item's row in `docs/open-items.md` in the same PR. If
  ever run as a parallel batch instead, do *not* touch the ledger — report follow-ups
  in the PR body and reconcile in one sweep afterwards (the fix-batch pattern).
- Out-of-scope findings go under a "Follow-ups" note, not into the diff.

---

## v0.2.0 payload

### Item 34

**Desktop filter chips: expose pressed state to assistive tech.**

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
docs/open-items.md item 34 is the spec. Seven chips in
cards/haventory-card/src/components/hv-filter-panel.ts carry their selected state in an
"on" CSS class and nothing else — no aria-pressed, no role. The same component's mobile
branch uses role="checkbox" + aria-checked for the same four "Show only" facets, and
both app bars' stat pills and the sidebar facet rows use aria-pressed — the desktop
panel is the only surface where a screen reader cannot tell an active filter from an
inactive one.

Pick ONE idiom and use it for both branches of the component (aria-pressed on button
chips is the natural fit for toggles; if you keep the mobile branch's role="checkbox",
convert the desktop chips to match — do not leave the two branches on different
vocabularies). TDD: component specs assert the attribute flips with the filter state on
every one of the seven chips, and that the mobile branch agrees.
```

### Item 43

**Refuse WS commands after config-entry removal.**

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
docs/open-items.md item 43 is the spec. async_remove_entry (__init__.py:282) removes
the frontend module but leaves hass.data[DOMAIN]["store"]/["repository"] in place, and
HA cannot unregister WS commands — so an open dashboard keeps mutating (and persisting)
the kept store after the integration is removed, until restart.

Decision (made): handlers must refuse once the entry is gone. ws.py's _repo(hass)
already raises StorageError("repository not initialized...") when the bucket is empty —
so the fix is to make removal empty it: pop the domain bucket (store, repository, rate
limiter, any persist debounce — flush/cancel it first, mirroring unload's teardown) in
async_remove_entry. Every subsequent command then lands as a storage_error envelope
through the existing ws_guard path; subscriptions: verify what broadcasts do with an
empty bucket and make teardown drop live subscriptions cleanly. First read
async_unload_entry and reuse/extract its teardown rather than duplicating it. The HA
Store *file* stays on disk (deliberate, documented in the removal docstring).

TDD offline: after async_remove_entry, a WS command gets storage_error (not
unknown_error, no traceback); persistence is not invoked again; re-adding the entry
restores service. Add the real-HA integration case (tests/integration/) — this is one
of item 51's stub-only paths, so note in the PR body that it closes the
async_remove_entry third of item 51.
```

### Item 57

**Sweep stale files left behind by HACS upgrades.**

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
docs/open-items.md item 57 is the spec. HACS zip_release upgrades extract over
<config>/custom_components/haventory/ without clearing it, so any file a release
deletes or renames survives every user's upgrade forever.

1. Determine whether any file shipped in v0.1.0/v0.1.1's haventory.zip no longer exists
   on current main (compare the release assets' file lists against the tree — the
   release workflow builds the zip, scripts/check_release_zip.py knows the layout).
2. Implement the sweep: at setup, remove known-stale paths inside the integration
   directory from an explicit allowlist of retired relative paths (never a wildcard —
   an operator's own files must survive). Executor-offloaded file I/O, tolerant of
   absence, logged at DEBUG.
3. Seed the allowlist with whatever (1) found; leave a clearly-marked list to append to
   in future releases that delete files.

TDD offline: stale path present → removed on setup; absent → no-op; a path NOT on the
list survives. Note in the PR body: from now on, any PR deleting a shipped integration
file must add it to the sweep list (one CONTRIBUTING sentence).
```

### Item 46
### Item 23

**Location rename must not bump subtree item versions.** Plan:
[`item23_rename_version_plan.md`](item23_rename_version_plan.md).

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
Read docs/item23_rename_version_plan.md — it is the design; implement it as written
(path-only rewrites update location_path + search tokens, version and updated_at stay
untouched; contract docs updated in the three places it names; the test list is the
TDD spec, including the integration-suite case). Verify the card-correctness assumption
it flags (what ws.py broadcasts on location/update) before relying on it.
```

### Item 46 — delivered

**Effective-area preview in the location editor.** Plan:
[`item46_area_preview_plan.md`](item46_area_preview_plan.md); the outcome is in
`open-items.md`'s item 46 resolution note. Kept for the record — nothing left to paste.

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
Read docs/item46_area_preview_plan.md — it is the design; implement both stages as
written (areaChangePreview pure function TDD-first, then the dialog render + the
empty-registry cosmetic fix). Frontend-only; no contract change. Verify the preview
copy against the live dev container (run-haventory skill) on a nested tree with and
without areas before committing stage 2.
```

---

## Release stages

### Item 79

**Execute the validation run against v0.2.0.** Program:
[`release_testing_plan.md`](release_testing_plan.md) (authoritative for
instrumentation, environments, scenarios, exit criteria). **Local Claude Code** next to
the Docker host / real HA — not a web session.

```text
PROJECT CONTEXT — run this in LOCAL Claude Code next to the Docker host / real HA.
v0.2.0 is released (every pending fix + the pre-v1.0 features) and installed on my real
production HA via HACS custom repository — that install step is release-test A1 and
closes the verification half of open-items item 4. docs/release_testing_plan.md is the
validation program: environments ENV-A (real instance) / ENV-B (throwaway Docker) /
ENV-C (floor-pinned 2026.6.0, scenario D6) / ENV-D (backup restore), scenario groups
A–J, six exit criteria. The run-haventory and test-haventory skills carry the
verification harnesses.

RULES
- The plan document is authoritative — follow its instrumentation section exactly.
- I am part of the test environment: pause for my on-device checks (companion-app
  groups) and my sign-offs wherever the plan says so.
- Every failure is triaged with an impact rating into docs/open-items.md; do not fix
  mid-run except Blockers. Fixes: one PR per fix from latest main, both gates green,
  released as the next 0.2.x patch via release-please, then re-run the affected
  scenarios on the updated install.
- Log-review literacy: exit criterion 4 counts tracebacks from
  custom_components.haventory only; contract-defined rejections log one WARNING by
  design (item 32), and HA core logs type-invalid client frames at ERROR (item 53) —
  expected, not findings.

TASK
1. Execute groups A–J in order, recording per-scenario results (client, environment,
   evidence). D6 validates the min-HA floor on ENV-C. Group J is the soak — schedule
   it, do not skip it. F3 produces the measured scale ceiling — hand its numbers to
   item 60.
2. Triage findings; tell me which are Blockers. Fixes ship as 0.2.x patches; re-run
   affected scenarios after each patch until the plan is clean.
3. Deliver the completed results log (per scenario: verdict + evidence). Exit: all six
   criteria hold. I make the go call for the schema stages.
```

### Item 60

**Publish the measured scale ceiling** (after item 79's F3).

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
docs/open-items.md item 60 is the spec. Release-test F3 has run (item 79) and produced
the measured degradation point on real hardware. Replace the README Known-limitations
extrapolation ("on that curve a single create trends toward ~1 s at a few thousand
items") with the measured numbers from the F3 results log — state what was measured, on
what dataset size, and where degradation began. One README edit; keep the existing
measured per-create latencies (they remain true); cite the run date.
```

### Item 70

**Retire the scoping-only toolchain.** Plan:
[`item70_toolchain_retirement_plan.md`](item70_toolchain_retirement_plan.md). Runs
after item 69 and after the v0.2.0 run is complete.

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
Read docs/item70_toolchain_retirement_plan.md and execute its triage list: delivered
plan docs deleted with their references, exploration scripts kept or deleted per the
list's reasoning, every survivor documented in one CONTRIBUTING.md line, grep-verified
zero dangling references after each removal. Respect its exception (the release plan
retires only with its evidence archived) and its note that ledger history may keep
naming retired docs while live tables and CLAUDE.md may not.
```

### Item 80

**Schema exercise — the first real migration.** Plan:
[`schema_exercise_plan.md`](schema_exercise_plan.md). Next 0.x minor after the last
feature release; live verification is owner-in-the-loop.

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
Read docs/schema_exercise_plan.md — it is the design. First ask me whether a pending
feature needs a real shape change; if none does, implement its default (the top-level
`meta` block) as migrate_4_to_5. Deliver per its list: offline migration tests
(idempotency, the 0→5 chain, downgrade refusal), the integration-suite boot-and-migrate
case, CURRENT_SCHEMA_VERSION → 5, shipped as feat: so release-please cuts the minor.
Then walk me through the live verification protocol (export + counts before; upgrade;
schema 5 + identical counts + export diff after) and record the result. The watch
window I define closes before the collapse (item 81) starts.
```

### Item 81

**Schema collapse to v1 + the export→import crossing.** Plan:
[`schema_collapse_plan.md`](schema_collapse_plan.md). **Breaking; owner's explicit go
before merge.**

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
Read docs/schema_collapse_plan.md — it is the design and the safety protocol. Implement
the collapse (CURRENT_SCHEMA_VERSION → 1 at the post-exercise shape, migrations.py
emptied to the driver, higher-versioned stores refused per #120), REHEARSE the
export→import crossing on a copy of my real export in a throwaway Docker HA and show me
the integrity evidence, re-run release-tests D7/D8/E3/E4 against the collapsed schema,
and prepare the release notes with the one-time crossing instruction. Do NOT merge on
green gates — the merge waits for my explicit go. After release I cross my production
store per the instruction; we verify together; my watch window closes before item 83.
```

### Item 82

**README promotion — screenshots and consistency pass.** Any time after the v0.2.0
payload lands; required before item 83.

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
docs/open-items.md item 82 is the spec. The README should lead with what HAventory
looks like. Using the run-haventory skill against the dev container (seeded inventory,
areas on some trees), produce 2–3 real captures — the sidebar panel full view, the
card's list with the item editor open, and the phone layout are the strongest
candidates; propose the exact set to me with drafts before wiring anything in. Wire the
approved images into the README top section (committed under docs/ or an assets path,
correct dimensions, alt text). Then a consistency pass over README / CONTRIBUTING /
docs/: versions, install steps, feature list, no stale claims. CLAUDE.md's staleness
sweep is item 65 (post-v1.0) — leave it unless a claim is outright wrong.
```

### Item 83

**Cut v1.0.0.** After item 81's watch window closes. Carries **no change**.

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
docs/open-items.md item 83 is the spec. The collapse (item 81) is live on the
production store and the watch window has closed; v1.0.0 ships NOTHING new — it is the
version bump that declares the proven 0.x stable. Mechanics: release-please with
bump-minor-pre-major needs an explicit instruction to cross 1.0 — verify the current
mechanism against the release-please docs (release-as in release-please-config.json is
the expected shape) and configure exactly one 1.0.0 cut, reverting the config
afterwards so the next fix is 1.0.1 not another forced version. Release notes:
summarize the 1.0 feature set and carry the one-time export→import crossing instruction
for anyone still on 0.x. I merge the release PR myself.
```

---

## After 1.0

### Item 4

**HACS default-store listing.** The custom-repo install half was verified as A1 during
item 79; this is the submission half. External reviews run on their own timelines —
file early.

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly.
docs/open-items.md item 4 is the spec; v1.0.0 is live. Verify current requirements from
the official HACS publisher docs before each step — do not work from memory. Then, with
my explicit go per submission:
a. Repo prep: description, topics, README requirements per the HACS docs.
b. home-assistant/brands PR for the `haventory` domain — ask me for the artwork with
   the required specs; I supply or approve it.
c. Submission PR to the HACS default repository.
Track both external PRs, relay reviewer feedback, and address it. Once the listing
merges: confirm a clean-instance install from HACS search, then switch the README
install section to store-first (custom repo becomes the fallback).
```

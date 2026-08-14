# V0.6.0 — session plan

Status: **planned**. Companion to [`V0_6_0_concept.md`](V0_6_0_concept.md), which carries
the user stories, the verified gaps and the reasons for the work order; this file assigns
the milestone's six open feature issues to sessions, states the rules each session runs
under, and ends with the paste-ready prompt each session is started from (§6). The six
already-closed 0.5.0-review fixes the milestone also carries need no session. The issues'
own implementation notes are the design — neither file restates them.

Five **local** sessions, strictly serial, seven PRs. Local means the session runs on the
owner's machine with the dev Docker Home Assistant available: the `run-haventory` and
`test-haventory` skills work, `scripts/test_integration.sh` works, and everything the
V0.5.0 plan had to hand over to "a local session" is now an in-session step. There is no
handover file this milestone.

The owner's total involvement, by design:

1. Paste one prompt per session — five pastes, each when the previous session reports done.
2. Read session S5's evidence and merge its PR — the **owner's explicit go** that #229
   requires. This is the milestone's one mandatory decision point.
3. Merge release-please's 0.6.0 PR when it is ready, and run #229's post-release
   verification against the production store.

Everything else — including opening and squash-merging PRs — the sessions do themselves.

Delete this file in the PR that closes the last V0.6.0 issue — a plan left behind reads
as pending work.

---

## 1. What changed since the V0.5.0 process

Two process changes, both owner direction (2026-08-12):

- **Sessions merge their own PRs.** V0.5.0's "no session merges its own PR" rule is
  reversed: a session squash-merges each of its PRs once both gates, the phacc suite and
  CI are green and its live checks have passed. Two exceptions stand: the **#229 PR is
  never self-merged** (the owner's merge is the go the issue demands), and
  **release-please's PRs belong to the owner** — sessions never merge, edit or close them.
- **Live verification happens in-session.** Every "deferred to live verification" item in
  the 2026-08-05 issue notes becomes a pre-merge step of the session that ships the
  change, driven through the `run-haventory` skill against the dev Docker HA. A session
  merges after its live checks pass; a purely cosmetic check may instead be recorded as
  waived in the PR body, with the reason.

Everything else — branch discipline, conventional-commit PR titles, TDD, the gate before
every commit, "issues are read, not rewritten" — carries over unchanged (§4).

## 2. The map

```
S1   #219 → #218        services answer, then sensors + bus events     2 PRs
──────────────────────────────────────────────────────────────────────
S2   #232               low-stock → to-do bridge                       1 PR
──────────────────────────────────────────────────────────────────────
S3   #187 A → #187 B    calendar projection, then stored reminders     2 PRs
──────────────────────────────────────────────────────────────────────
S4   #225               diagnostics, health move, repairs              1 PR
──────────────────────────────────────────────────────────────────────
S5   #229               schema collapse to v1 — owner merges           1 PR
```

A session starts only when the one before it has merged everything (for S5: when S4's PR
is on `main`). S1's start condition — the V0.5.0 milestone closed and release 0.5.0
tagged — is **satisfied as of 2026-08-14**: 0.5.0 is tagged, the post-release fix PRs
(#444, #446) are merged, and S1 can start as soon as this plan is on `main`.

Serial is the default on purpose: the sessions share one machine, one checkout and one
dev HA instance, and the milestone's file-contention hot spots (`__init__.py`,
`const.py`, `strings.json`, `services.py`, `ws.py`) all cool off when nothing runs
concurrently. If wall-clock ever matters more than that: S2, S3 and S4 touch disjoint
feature files and could interleave from separate worktrees with rebase-before-push
discipline — but nothing in this plan depends on it, and the shared dev HA makes their
live checks queue anyway.

## 3. Why the order is what it is

- **#219 before #218.** Both rewrite every handler in `services.py`. #219 first means
  each handler already binds the entity it returns when #218's `notify_mutation` arrives
  to sit beside it; the other order reworks #218's edits one PR later.
- **#218 before S2 and S3.** It creates the HAventory device, the `unique_id`
  convention, the HA-bus events, and the offline `bus` stub. #232 consumes the event as
  its reconcile trigger; #187's entity joins the device and re-renders on the same event.
- **S3 before S5.** #187 slice B is the milestone's only schema bump (v7 → v8) and the
  last planned change to the stored shape; #229 collapses only after the shape has
  stopped moving. If slice B slips out of the milestone, S5 moves to V0.7.0 with it
  rather than the release moving — #236's standing rule.
- **S4 before S5.** The repairs strings and the lossy-load flow should exist in the same
  release whose sunset adopter could first meet a store it mistrusts. S4 is otherwise
  independent and runs late simply to keep `ws.py`/`strings.json` churn serial.
- **S5 last, owner-merged.** Green gates alone do not merge the collapse — the issue says
  so, and this plan keeps it as the milestone's one designed interaction.

## 4. Rules every session follows

**Branches and PRs**

- One branch per PR, named `claude/v0-6-0-s<N>-<topic>` (e.g.
  `claude/v0-6-0-s1-service-responses`). Branch off the current `origin/main`; within a
  session, a later PR may stack on the session's earlier branch and rebases onto `main`
  when that PR merges.
- PR titles are **Conventional Commits**. The repository squash-merges, so the PR title
  becomes the commit message and release-please reads it for the changelog. A wrong title
  is a wrong changelog entry.
- Link the issue (`Closes #NNN` — or `Refs #NNN` for a PR that ships half of one) and
  fill in `.github/pull_request_template.md`. With no human reviewer in the loop, **the
  PR body is the review record**: decisions against drifted issue notes, live-check
  evidence (screenshots for anything visual), waivers, and the Follow-ups note all live
  there.

**Merging**

> A session squash-merges its own PR when — and only when — all of: both gates green
> locally, `scripts/test_integration.sh` green, CI green on the PR (hassfest included),
> and the session's live checks (§5) passed or explicitly waived in the PR body. Delete
> the branch on merge. **Exceptions: the #229 PR (S5) is left open for the owner, and
> release-please PRs are never touched.**

If CI is red, fix it and push — that is still the session's work. If the failure
reproduces on `main`, say so once in the PR thread, fix `main` first if the fix is
obvious and small, and otherwise stop and report.

**Issues are read, not rewritten**

The 2026-08-05 implementation notes are the design, but their file references were taken
against a tree seven-plus releases old — several anchors have already moved
(`V0_6_0_concept.md` records the known ones). Grep for the symbol or the message string,
never the line. Where a note's prose has gone stale, the session decides against the code
and records the decision in the PR body; it does not edit the issue. A short issue
comment is worth writing only when the decision changes what the issue asked for.

**The gate, before every commit**

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check .
uv run ruff format --check .     # CI fails on formatting alone
uv run mypy
```

```bash
cd cards/haventory-card
npx eslint . && npm run typecheck && npx vitest run && npm run build
```

Plus, this milestone: `scripts/test_integration.sh` **before every merge**. Every session
here ships something only the phacc suite can see — entity platforms, service dispatch,
the event bus, config-entry machinery, migrations under a real `Store`.

**Conventions that bite in this milestone specifically**

- New `strings.json` sections (`entity`, `issues`, the to-do options block) must be
  repeated **byte-identically** in `translations/en.json` —
  `test_translation_flow_sections_match_strings` enforces it.
- "An event implies a durable write" extends to the HA bus: fire after the persist,
  every path.
- Contract or shape changes update `docs/backend_api_contract.md` and
  `docs/data_shapes.md` in the same PR (S3 slice B is the one that does).
- Deleting or renaming a file under `custom_components/haventory/` means appending its
  old path to `RETIRED_PATHS` in the same PR. No session here plans a deletion — the
  health helpers *move* between modules that both ship — so a RETIRED_PATHS edit
  appearing in a diff is a sign to stop and re-check.
- Manifest questions the offline checkout cannot settle (a `repairs` dependency, a
  `response:` key for services) are answered by CI's hassfest job and the phacc run, not
  by guessing.
- TDD, no `TODO`/`FIXME`, comments encode constraints not history, plain words — as
  always. Out-of-scope findings go in the PR's Follow-ups note and become issues only if
  they can matter in a real install.

**Live checks**

Each session's package (§5) lists its live checks — the former "deferred to live
verification" items. Drive them with the `run-haventory` skill (deploy to the dev Docker
HA, drive the WS API, screenshot). Evidence lands in the PR body: a screenshot for
anything visual, a log excerpt or event trace for anything behavioral.

## 5. The sessions

### 5.1 S1 — #219 then #218: services answer, sensors + bus events

Two PRs, in order:

1. **"feat(services): return response data from every service"** — closes #219. The
   `serialization.py` extraction, `SupportsResponse.OPTIONAL` on all eleven services,
   every handler returning its envelope after the persist, the offline
   `SupportsResponse` stub, the `docs/data_shapes.md` note, and the phacc
   `return_response` cases. Mind the one trap the notes call out:
   `tests/test_ws_error_mapping_offline.py` monkeypatches `ws_module._serialize_item`
   and must patch the new module's symbol instead.
2. **"feat(sensor): four inventory sensors and bus events for automations"** — closes
   #218. `sensor.py`, `events.py`, the `Repository.low_stock_item_ids` accessor, platform
   forward/unload in `__init__.py`, `notify_mutation` beside every WS broadcast **and**
   after every service persist, the `entity.sensor` strings block ×2, the offline `bus`
   stub, the docs sections, and the README's "No automation triggers" bullet replaced
   with a worked automation example (the full rewrite stays #217).

Live checks: the HAventory device page shows four sensors with sensible names and ids;
`items_total` moves on a WS mutation *and* on a `haventory.item_create` service call with
no polling; an automation triggered on `haventory_low_stock` fires end to end; Developer
Tools → Actions renders the service response and a two-step script chains
`item_create` → `item_move` through `response_variable`.

Also: file the follow-up issue #218's notes name — a `haventory.*` service mutation
reaches no WebSocket subscriber, so an open card does not repaint — with the 🔧 Task
template, unmilestoned.

### 5.2 S2 — #232: the to-do bridge

One PR: **"feat(todo): mirror low-stock items onto a chosen to-do list"** — closes #232.
`todo_bridge.py` with the convergent reconcile pass, the options-flow `SECTION_TODO`
entity selector (empty = off, the default), the bridge's own `haventory_todo_links`
store, the reconcile triggers (bus event, setup, options change, import execute), the
`selector` stub for the offline suite, and the README "Shopping list" subsection.

The one question the notes could not settle offline — whether `todo.add_item` returns
the new uid, and whether `todo.remove_item` accepts one — is answered against the real
HA in this session; record the answer and the chosen path in the PR body.

Live checks: with a `local_todo` list selected, dropping an item below threshold puts
"Name ×N" on the list and restocking removes it; a restart and a wholesale import both
converge without duplicates; an unavailable list logs a warning and the mutation still
succeeds.

### 5.3 S3 — #187: calendar projection, then stored reminders

Two PRs, in order:

1. **"feat(calendar): project due and inspection dates"** — refs #187 (slice A; the
   issue stays open). `calendar.py` with the HA-free `build_events` helper, the entity
   joining #218's device, the constant `unique_id`, the README calendar section with the
   notify-automation example, and — in the same PR — the CLAUDE.md edits: the naming
   bullet's "not an entity that exists today" and the pillar's "do not start before the
   automation milestone" are both true only until this merges.
2. **"feat(reminders): recurring reminders on items"** — closes #187 (slice B).
   `reminder_date` / `reminder_interval` on `Item`, `CURRENT_SCHEMA_VERSION` 7 → 8 with
   an idempotent `migrate_7_to_8` (the notes say 5 → 6; the tree has moved twice since —
   same migration, a later number), the `haventory/reminder/*` WS commands, occurrence
   expansion on read in the calendar, and both docs files.

**The plan decides the open card question:** the reminder fields ship in the item
editor in the slice-B PR — the issue is labelled `area:card`, and a reminder nobody can
set from the card is API furniture. The recorded cut line, if the editor half grows past
a reviewable diff: ship WS-only, file the editor as a card follow-up issue, and say so
in the PR body. Either way the decision is written down, not asked.

Live checks: `calendar.haventory` exists with the constant `unique_id` and renders the
projected events on a calendar dashboard; checking an item out with a due date moves the
entity's state; the notify automation fires; after slice B, a reminder with a 3-month
interval shows its next occurrences in the calendar view, and the production-shaped dev
store upgrades v7 → v8 losslessly on restart.

### 5.4 S4 — #225: diagnostics, the health move, repairs

One PR: **"feat(diagnostics): entry diagnostics, repairs issues and a guarded lossy
load"** — closes #225. `diagnostics.py` (aggregates only — counts, schema versions,
generation, health issues, runtime key names, bundle state; not one item name),
`health.py` extracted from `ws.py`, `repairs.py` with the fixable corrupt-load flow
(backup store → `CONF_ALLOW_LOSSY_LOAD` → reload), the two schema repairs issues beside
the existing `ConfigEntryError` raises, the `issues` strings block ×2, and the README
Troubleshooting pointer. Two of the issue's bullets are already done
(`single_config_entry`, and `entry.runtime_data` split to #280) — do not re-do them.

Live checks: "Download diagnostics" appears on the entry and the JSON carries no item
content; a store hand-stamped above `CURRENT_SCHEMA_VERSION` puts a non-fixable issue in
Settings → Repairs and leaves the store untouched; a store with a corrupt row surfaces
the fixable issue, and running the fix writes the backup, reloads, and clears the card.

### 5.5 S5 — #229: the collapse — owner merges

One PR: **"feat(storage): collapse the schema to v1"** — closes #229, and follows the
issue's delivery protocol to the letter: offline TDD across the whole dev range (clean
install at v1; every dev-range version lands at v1 intact; the sunset adopter is
idempotent; above-range is refused with the store untouched; a current export imports
cleanly), the D7/D8/E3/E4 release-test scenarios re-run against v1, and the
release-notes text (in-place upgrade; take a JSON export first) written into the PR body
for the owner to carry into the GitHub release.

This PR also deletes `dev/schema_collapse_plan.md` (superseded by the issue),
`dev/V0_6_0_concept.md` and this file — it closes the milestone's last issue.

**This session does not merge.** End state: PR open, both gates + phacc + CI green, the
evidence and release-note text in the body, a comment summarizing what the adopter
accepts (v1–v8) and what it refuses. The owner's merge is the go; the post-release
production-store verification and its watch window are the owner's, per the issue.

## 6. The prompts

One prompt per session, paste-ready. Each assumes this plan is merged to `main` and
restates its own start condition; the owner starts a session by pasting its block,
nothing more.

### 6.1 S1 — start when V0.5.0 is closed and 0.5.0 is tagged (satisfied 2026-08-14)

```
Work in the HAventory repo, branching off the current origin/main. You are session S1 of
the V0.6.0 plan; start only when the V0.5.0 milestone is closed and release 0.5.0 is
tagged. Read dev/V0_6_0_implementation.md §4 (rules) and §5.1 (your session), skim
dev/V0_6_0_concept.md §3 stories S1–S4, then issues #219 and #218 — their implementation
notes are the design. Where a note's line numbers or prose have drifted from the code,
decide against the code and record the decision in the PR body; do not edit the issue.

Deliver two PRs, in this order:

1. "feat(services): return response data from every service" — closes #219.
2. "feat(sensor): four inventory sensors and bus events for automations" — closes #218.

For each PR: both gates and scripts/test_integration.sh before every merge, then the
live checks in §5.1 against the dev Docker HA (run-haventory skill), evidence in the PR
body. Squash-merge each PR yourself once gates, phacc, CI and live checks are all green;
delete the branch. Branch names claude/v0-6-0-s1-<topic>, one branch per PR. Never touch
a release-please PR.

Before you finish, file the follow-up issue #218's notes name (a haventory.* service
mutation reaches no WebSocket subscriber, so an open card does not repaint) with the 🔧
Task template, unmilestoned. Then report: PRs merged, live-check evidence, anything that
moved under you.
```

### 6.2 S2 — start when S1 has merged both PRs

```
Work in the HAventory repo, branching off the current origin/main. You are session S2 of
the V0.6.0 plan; start only when S1's two PRs (#219, #218) are merged. Read
dev/V0_6_0_implementation.md §4 (rules) and §5.2 (your session), skim
dev/V0_6_0_concept.md §3 story S3, then issue #232 — its implementation notes are the
design. Decide drifted details against the code and record decisions in the PR body; do
not edit the issue.

Deliver one PR: "feat(todo): mirror low-stock items onto a chosen to-do list" — closes
#232. Resolve the todo.add_item uid question against the real HA and record the answer
in the PR body.

Both gates and scripts/test_integration.sh before merging, then the live checks in §5.2
(run-haventory skill, a local_todo list), evidence in the PR body. Squash-merge yourself
once gates, phacc, CI and live checks are green; delete the branch. Branch name
claude/v0-6-0-s2-todo-bridge. Never touch a release-please PR. Then report.
```

### 6.3 S3 — start when S2's PR is merged

```
Work in the HAventory repo, branching off the current origin/main. You are session S3 of
the V0.6.0 plan; start only when S2's PR (#232) is merged. Read
dev/V0_6_0_implementation.md §4 (rules) and §5.3 (your session), skim
dev/V0_6_0_concept.md §3 stories S5–S6, then issue #187 — its implementation notes are
the design, split as slice A / slice B. Decide drifted details against the code (the
schema bump is 7 → 8, not the notes' 5 → 6) and record decisions in the PR body; do not
edit the issue.

Deliver two PRs, in this order:

1. "feat(calendar): project due and inspection dates" — refs #187, and edits CLAUDE.md's
   calendar reservation language in the same PR.
2. "feat(reminders): recurring reminders on items" — closes #187. The reminder fields
   ship in the item editor per §5.3; the recorded cut line is WS-only plus a filed card
   follow-up issue, and only if the editor half grows past a reviewable diff.

For each PR: both gates and scripts/test_integration.sh before every merge, then the
live checks in §5.3 (run-haventory skill), evidence in the PR body — including the
dev store's v7 → v8 upgrade for slice B. Squash-merge each PR yourself once gates,
phacc, CI and live checks are green; delete the branch. Branch names
claude/v0-6-0-s3-<topic>. Never touch a release-please PR. Then report.
```

### 6.4 S4 — start when S3 has merged both PRs

```
Work in the HAventory repo, branching off the current origin/main. You are session S4 of
the V0.6.0 plan; start only when S3's two PRs are merged and #187 is closed. Read
dev/V0_6_0_implementation.md §4 (rules) and §5.4 (your session), skim
dev/V0_6_0_concept.md §3 story S7, then issue #225 — its implementation notes are the
design. Two of its bullets are already done (single_config_entry; entry.runtime_data is
#280): do not re-do them. Decide drifted details against the code and record decisions
in the PR body; do not edit the issue.

Deliver one PR: "feat(diagnostics): entry diagnostics, repairs issues and a guarded
lossy load" — closes #225.

Both gates and scripts/test_integration.sh before merging, then the live checks in §5.4
(run-haventory skill; a hand-stamped downgrade store and a corrupt-row store), evidence
in the PR body. Squash-merge yourself once gates, phacc, CI and live checks are green;
delete the branch. Branch name claude/v0-6-0-s4-diagnostics. Never touch a
release-please PR. Then report.
```

### 6.5 S5 — start when S4's PR is merged

```
Work in the HAventory repo, branching off the current origin/main. You are session S5 of
the V0.6.0 plan; start only when S4's PR (#225) is merged and #229 is the milestone's
last open issue. Read dev/V0_6_0_implementation.md §4 (rules) and §5.5 (your session),
then issue #229 top to bottom — its body is the protocol, and where
dev/schema_collapse_plan.md disagrees with it, the issue wins.

Deliver one PR: "feat(storage): collapse the schema to v1" — closes #229. Follow the
issue's delivery list: offline TDD across the dev range v1–v8, the sunset adopter
(idempotent, a closed set, refusing above-range with the store untouched), release-test
scenarios D7/D8/E3/E4 re-run against v1, and the release-notes text in the PR body. This
PR also deletes dev/schema_collapse_plan.md, dev/V0_6_0_concept.md and
dev/V0_6_0_implementation.md.

Both gates and scripts/test_integration.sh before pushing; run the storage-lifecycle
live checks against the dev HA (run-haventory skill) and put the evidence in the PR
body, plus a comment stating exactly which stored versions the adopter accepts and what
it refuses.

DO NOT MERGE THIS PR. Your end state is: PR open, everything green, evidence complete.
The owner's merge is the explicit go #229 requires. Report and stop.
```

## 7. Milestone exit

V0.6.0 closes when:

- All six feature issues are closed — implemented, or closed as not-planned with the
  reason in the issue. (The milestone's six 0.5.0-review fixes were closed before the
  sessions began.)
- A clean install starts at schema v1; the owner's store crossed via the sunset adopter;
  the adopter's deletion is filed for V0.7.0 (it ships one milestone after the collapse,
  per #229).
- The README's "No automation triggers" limitation is gone, replaced by working
  automation, `response_variable` and calendar examples; `docs/backend_api_contract.md`
  and `docs/data_shapes.md` describe the bus events, the reminder fields and the reminder
  commands as `ws.py` ships them.
- Both gates green on `main`, plus one clean `scripts/test_integration.sh` run.
- `dev/schema_collapse_plan.md`, `dev/V0_6_0_concept.md` and this file are deleted — all
  in S5's PR.
- The owner has merged S5's PR and release-please's 0.6.0 PR, and #229's post-release
  store verification is underway on the owner's install.

Per #236, V0.7.0 (launch prep) then opens with the brands PR (#196) filed at its start.

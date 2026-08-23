# V0.8.0 — session plan

Status: **planned** (2026-08-22, re-planned 2026-08-23 after the 0.7.1 release). Assigns
the milestone's eleven issues to six master sessions, two local validation sessions, one
wording session and the closing pass; states the rules each runs under; fixes the model
each runs on; and ends with the paste-ready prompt each is started from (§8). The issues'
implementation notes are the design where they are still right; where the tree has moved
under them, §1 says what was measured and §6 says what the session does instead, and the
session records the rest in its PR body.

Baseline: `main` at `e878531`, the 0.7.1 release. Between the first draft of this plan
and this one, 0.7.0's fixup rounds and 0.7.1 shipped every defect the draft had packaged
as a refactor session's first commit (#559, #560, #562, #565–#569, #574, #546, #563,
#581–#584, #595–#600, #608–#610); what is left is subtraction, the translation layer and
the schema collapse. The analysis in §1 was measured at `b878bfe`; the tree has since
grown by about 400 backend and 3,000 card lines of fixes, none of which the cut lists
name and three of which they now meet (§1.2) — **grep for the symbol, never the line.**

**The milestone in one sentence:** subtraction with the behaviour held still, a
translation layer that a third language can join without touching code, the schema
collapsed to v1 at the end, and the German wording corrected last, from the owner's own
read of the finished screens.

**How the work runs** (§3 has the rules): one **master session** at a time — a Claude
Code session, cloud by default — spawns one **subagent per pull request**, each on Opus 5
at `xhigh` in its own git worktree, reviews the diff the subagent returns, runs the live
check on its own Home Assistant, merges, and starts the next. Work that is safer in
sequence runs in sequence: a lane's PRs stack, so they never run at once; the two lanes
share almost no files, so two masters may run side by side where §4 says so. **Local
validation is pushed as late as the dependencies allow**: two local sessions (L1 after
every code session, L2 after the docs and the collapse PR) and the closing pass Z, each
walking every "Validate locally" block the masters left in the PR bodies, instead of a
short local session per user-visible PR.

The owner's total involvement, by design:

1. **Pre-flight** (§2) — eight decisions, all taken on 2026-08-23; the verdicts are in
   the file, so no session has to ask.
2. **Paste one prompt per session** — ten pastes: M1–M6, L1, M7, L2, Z.
3. **Read each handover** (the last message of the session and the comment it leaves on
   #236) and run its hand-test list.
4. **Read the German screens once**, after the key consolidation, and mark up #540 — the
   one piece of review that is the owner's by nature.
5. **Merge three PRs the sessions leave open on purpose**: the rate-limiter removal (M2),
   the German wording (M7) and the schema collapse (M6 — the issue says "owner's explicit
   go", and it still does, after L2's rehearsal on a copy of the production store).
6. **Merge release-please's 0.8.0 PR** after Z has finished.

Delete this file, and `.claude/agents/v080-implementer.md` with it, in Z's closing PR —
a plan left behind reads as pending work.

---

## 1. What the analysis found

Twelve read-only measurements of the tree at `b878bfe` (one per subsystem, 2026-08-22),
each checked against #229, #230, #231 and #542. The full cut lists with their file:line
evidence are comments dated 2026-08-22 on #230 (six), #231 (four) and #542 (one); the
ids used below (`BE-WS-C2`, `FE-SHELLS-C1`, `TESTS-T5`, …) are theirs. The numbers are
counted ranges, not guesses, and the PR that makes a cut records the actual count. Those
comments name the first draft's sessions; the map to this draft is A1–A3 → M1, A4–A6 →
M2, B1–B2 → M3, B3–B4 → M4, B5 → M5 and M7, D1 + A7 → M6.

### 1.1 The shape of the tree today

| | production (`b878bfe` → `e878531`) | tests | comment share |
| --- | ---: | ---: | ---: |
| backend `custom_components/haventory/` (26 modules) | 14,469 → 14,881 | 27,380 offline + 4,805 phacc | 36–75 % in the lifecycle modules |
| card `src/` (non-test, incl. ≈1,790 lines of dictionaries) | 28,287 → 31,244 | 26,777 | 17 % overall; 28 % of `components/` + `ui/` is CSS |
| docs `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/*.md` | 3,842 | — | — |
| scripts + skills (tracked files) | 5,290 + 6,941 | — | — |

The growth since the measurement is 0.7.0's and 0.7.1's fixes: thumbnails and their
generation-named tiles (`media.py`), the local day and the midnight rollover
(`models.py`, `events.py`, `ui/day-clock.ts`), the service-field catalog (`strings.json`
87 → 204 leaves), `ui/roving-list.ts`, `ui/clipboard.ts`, `ui/location-path.ts`, the
missing-picture state, and the phone-width rows. Test-to-production is 2.2 on the backend
and 0.95 on the card; the outliers are the rate limiter (241 lines, a 593-line test),
storage (the debounce tests) and `test_frontend_registration.py` (1,089 lines, ten of
whose tests have a phacc twin).

### 1.2 Where the weight is

**Backend.** Four things account for most of what can go, and none of them is a feature:

1. **Two implementations of every mutation.** `services.py` re-implements the twelve
   operations `ws.py`'s `_op_item_*` table already carries, handler for handler, and six
   `ws_item_*` handlers are inline twins of their own table entry. 28 handlers persist;
   11–12 are table-shaped. The same field list is written nine times. What the collapse
   now inherits rather than fixes: #592 made `media.async_delete_item_files` the one
   post-persist step all three delete surfaces call, and #591 put the tags guard under
   `validate_tags` — so one tail is now the structural guarantee #592's follow-up asked
   for, and widening the `[str]` schemas to `object` turns no refusal into a silent drop.
2. **Machinery with no production caller or one that exists for the test stub.** The
   debounced-persist path (`async_request_persist`: zero callers, ≈110 lines + ≈395 test
   lines); the stub-compat branches (≈100 production lines across `__init__.py`, `ws.py`,
   `services.py`, `areas.py` — the whole of `areas.py` exists because the offline stub's
   `area_registry.async_get` is `async`); the manifest readers that duplicate
   `INTEGRATION_VERSION` (54); the `/local/…` legacy resource path no tagged release ever
   served (10); two unreachable schema checks after `store.async_load()` (22).
3. **Indexes the scan already makes redundant.** The text index (249 lines) is a
   pre-filter in front of `filter_items`, which applies `_item_matches_q` to every
   candidate anyway and is declared the contract. The index-health subsystem (233 backend
   + ≈170 card lines incl. 76 dictionary lines) hunts drift between those indexes; every
   issue it can raise names a repository bug, which makes it a test oracle, not a product
   feature.
4. **The rate limiter**: 241 lines, nine options, off by default, and ≈2,300 lines around
   it (config flow, three translation files, a docs page, the card's banner and retry
   hint for a `retry_after_ms` the backend never sends, a 473-line skill harness, a
   593-line test).

Smaller but real: five hand-written parent-chain walks in `repository.py`; the
create/update validation written twice (and the caps rule four times); `filter_items`
evaluating all sixteen predicates per item; `migrations.py` at 253 lines of which 82 are
code (#229 reduces it to a driver and one adopter, ≈190 lines).

**Card.** The duplication is structural, not dead code:

1. **Two workspaces.** `hv-card-shell` and `hv-full-view` each implement the item
   workspace — editor hosting, pinned row, detail sheet, check-out popover, row events,
   discard prompt — about 400 lines twice, beside the ≈300 lines of filter chrome #231
   item 2 names. Since the measurement #587 added a third copy of the sheet-head row
   (`full-panel-head`, restating `.sheet-head`'s three declarations in a second shadow
   root), so the chrome fold now has three adopters. Three hand-rolled `matchMedia`
   watchers do what `ViewportNarrow` already does; the Store/theme lifecycle is copied
   between `index.ts` and the panel.
2. **Dialog chrome written five times** (backdrop/wrap/panel CSS and markup in organize,
   import, confirm, column picker, diagnostics), the quick-day-offsets widget twice, the
   location-picker disclosure four times, the attachment strips twice, the discard confirm
   three times beside the shared `HostSurfaces.confirm`. `hv-item-editor` is ≈3,000 lines
   of which 962 are CSS. Since the measurement `ui/roving-list.ts` (#578) gave the facet
   lists one tab stop each, and `hv-location-tree` still carries its own `_walk` /
   `_syncRovingTabindex` / arrow handling — the fold #578's follow-up named.
3. **Dead plumbing** wider than #231 says: the whole selection mode of `hv-list-row`
   (unreachable — `hv-list`'s one host binds none of it), `fill`/`skeletonRows`, five
   `WSClient` methods, `pendingOps`, `forceMobile`, and a `retry_after` reader for a hint
   nobody sends. Re-checked at `e878531`: every one still has no caller.
4. **Dictionaries**: 724 keys; two unread; 61 removable by folding the groups that name
   one field in one role (§6.M5 says by what rule). The bundle is ≈710 kB, 83 kB of it
   dictionaries; a per-language split is not worth a second served file.

**Tests and docs.** The offline stub re-implements `panel_custom`'s registry in 60 lines
to support ten tests whose phacc twins run on every PR; fourteen phacc files carry the
same six-line `_setup`; three online smokes carry the same four helpers; the harness has
tests of its own (≈430 lines) that hundreds of other tests would fail first. The docs
repeat the gate in five places and the two test modes in four (§6.M6 carries the list);
`scripts/` holds 2,100 lines nothing calls any more.

### 1.3 What was deliberately not taken, so nobody re-derives it

- **The Lovelace resource loader** (188 lines beside `add_extra_js_url`): its only stated
  reason is HA Cast, which ignores `extra_js_url`. A real cost for a real household. Keep.
- **The desktop in-place editor expander** (`editorTemplate`/`editorEpoch`, ≈110 lines):
  removing it moves the form above the list on a desktop card. A product change, not a
  subtraction. Keep (§2 item 3).
- **The card's mirror of the backend's size caps** (`ui/item-form.ts`): deleting it turns
  an inline field error into a Save-time banner. Keep.
- **A native `<datalist>` for the category combobox**: the editor's own comment records
  why the chevron exists. Keep the control; stop it floating (§6.M4).
- **`test_repo_hardening_offline.py`** (491 lines): CI policy the owner asked for in
  #210. Keep.
- **`serialization.py`, the to-do bridge's own `Store`, `calendar_projection.py`**: each
  measured and found justified (the #230 comment says why per file).
- **A language-split bundle** (#542's "not in scope"): ≈11 kB gzipped per language against
  a second served path and a flash of English on every German load. No.
- **From the 0.7.0/0.7.1 follow-ups, named and not filed** (each below the real-world
  bar, recorded so the sessions do not re-find them): a phone abroad reads its own day for
  the chips while the sensors read the household's (#579, #588 — `hass.config.time_zone`
  would close it; not a household's daily case); `hv-list-row` subscribing to the day
  clock per row (#588 — one `requestUpdate` per row per day); the `20ch` filter-chip cap
  counting no overflow (#587); the filter panel's eight labels being alphabetical rather
  than most-used (#585 — L1 judges it on the seeded household and files it if the first
  eight are useless); desktop rows growing with a deep path (#604 — the path is on screen
  there); the selection bar wrapping above 701 px (#611); a `tags_any` filter given a bare
  string matching letters (#591 — a wrong answer to a wrong query, nothing written; the
  uniform-typing PR in §6.M1 refuses it anyway); core logging its own ERROR on a refused
  service call (#594); two copies of the `hassTokens` init script in the skill harnesses
  (#613 — §6.M6 PR 3 may fold them if it is in there anyway).

### 1.4 The issues' text against the tree

Recorded as comments on the issues; the short version, so a session is not surprised:

- **#230** item 1's "0.012 s at 10 k items vs a 0.5 s budget" cites a benchmark test no
  longer in the tree; the text-index PR re-measures before it deletes. Item 2's subsystem
  is `health.py` (175) + accessors, not "≈120 lines in `ws.py`", and `ws_location_list` /
  `ws_location_tree` reach the same debug accessor in production. Item 4 is 28 persisting
  handlers, not 12. Item 6 is ≈100 lines and a `conftest.py` + `ws_helpers.py` rewrite,
  not four sites. Item 7's "one bucket, three options" leaves ≈900 lines of plumbing;
  deletion is the honest cut (§2 item 1). Item 10's list misses the class docstring in
  `repository.py` that states the opposite of the `location_path` invariant.
- **#231** item 2 undercounts by the workspace layer (§1.2); "`_onEditorSave` differs by
  `_editorError`" is stale (both set it); "banner rendering" is already shared. Item 3
  undercounts the dead selection chain. Item 4's "promise-unwrap helper in `ws.ts`" has no
  target left; the real twin is the subscribe unwrap. Item 5's two store specs overlap by
  three cases, not hundreds of lines. Item 1's three greps find 12 real sites across
  `src/` and miss seven narrative blocks a fourth grep catches (§6.M3).
- **#229**: the adoptable set is 2–9 and every export in the wild is stamped 9, so the
  import-side amnesty is not optional; there is no literal "9" in `strings.json`; only two
  test files name a migration step.
- **#542**: "61 removable" is true only with the `hv.field.*` step (56 without); the
  backend's keys are all reachable; two `t()` literals (`hv-import-sheet.ts`,
  `hv-organize-dialog.ts`'s bare "Create") are missing from it, and two accessible names
  are English literals (#615). Its item 4 ("`tn` falling back to `.other`") is answered by
  plural categories (§6.M5), which also makes the layer fit languages with more than two
  forms. The fold criterion in its comment — "English and German both identical" — is the
  wrong rule for a layer meant to take a third language; §6.M5 states the right one.
- **#540**: two things have changed since the tables were posted. #593 added 114 German
  service-field names and descriptions without the owner's read (noted on #570), so the
  review surface is the keys that survive #542 *plus* those; and the conflict banner
  prints the backend's English detail beside its German heading (the issue's 2026-08-22
  comment) — that is a mechanism fix, not wording, and §6.M5 takes it.
- **#536**: `calendar.py` now resolves its summaries through
  `async_get_translations(hass, hass.config.language, "common", …)` (#572) — the right
  rule for a string the backend writes and automations consume. A status label has a
  per-user display path (the card), so it takes the other rule: the store stays
  English, the card translates (§2 item 2). Seven card files render a status label
  today (`hv-list-row`, `hv-filter-chips`, `hv-filter-panel`, `hv-item-editor`,
  `hv-full-view`, `hv-organize-dialog`, `ui/status.ts`); the backend needs nothing.
- **#333**: nothing in the tree does what the issue's option 2 describes — the size of the
  fix is still zero lines of existing code; but the attachment directory now also holds
  the generation-named thumbnail tiles (`THUMBNAIL_SUFFIX`), which the delete paths and
  the setup sweep already unlink; §6.M2 says what "last file" means now.
- **#331**: the sentence it quotes left the README in #547's rewrite and now lives in
  `docs/developing.md`; §6.M6 fixes it there. The README's and `docs/automations.md`'s
  `service:` examples have since been converted; six `platform:` trigger examples remain.
- **Docs that name what is not there**: `docs/frontend_architecture.md` describes a
  `haventory/cleanup` command that does not exist; `docs/developing.md` still lists
  "Debounced saves" and `--examples-config`; `docs/data_shapes.md`'s example envelopes say
  `schema_version: 4` against a current 9 (the collapse makes them 1); the skills'
  SKILL.md files quote test counts "as of v0.3.1". §6.M6 and the collapse own these.

## 2. Owner pre-flight

Decisions that would otherwise stop a session mid-way. **All eight were decided by the
owner on 2026-08-23** — the verdict heads each item; the reasoning beneath it is kept so
a session knows what the alternative was and why it was not taken. The prompts in §8
assume these verdicts.

1. **Decided: delete.** The rate limiter: delete it (recommended), or shrink it to one
   global command bucket with three options. Measured: deletion removes ≈471 backend, ≈120 card,
   ≈147 docs, ≈907 test and ≈661 skill lines, and with it the `rate_limited` error code,
   the options section (collapsed and off by default today), the health/diagnostics
   counters and the card's "Rate limited" banner. A household that turned it on loses
   the limit; stale option keys are ignored. Shrinking keeps ≈900 lines of plumbing for a
   feature whose only known callers are two skill scripts. The PR is left open for the
   owner either way.
2. **Decided: store the English seed; translate the three built-ins at display time,
   per user.** (Revised the same day — the first verdict, seeding in the server's
   language at first store write, was withdrawn after checking it against four cases.)
   The store keeps `OK` / `Missing` / `Needs repair` as language-neutral data; the card
   shows `t('hv.status.<slug>')` for a built-in slug **while its stored label still
   equals the English seed**, and the stored label otherwise — Home Assistant's own
   pattern for entity states. What that holds under, and seeding did not: the server
   language changing later (the chips follow the reader; nothing stored goes stale), a
   member whose profile language differs from the server's (each sees their own, like
   the rest of the card), a German export imported into an English server (an
   un-renamed store exports the English seeds, so they import as built-ins; only a
   deliberate rename travels as a rename), and a language that does not exist yet (a
   French household gets French chips the day the dictionary ships, instead of English
   frozen into its store). The backend changes nothing; the seed, the adopter and every
   export stay as they are. *M5.*
3. **Decided: keep.** The desktop in-place editor expander stays (§1.3). Saying "move
   the form above the list" would add ≈110 lines of removal to M4 and one user-visible
   change; if it is ever wanted, it is its own issue with a mock-up, not a cut.
4. **Decided: don't add it.** `CODECOV_TOKEN` stays absent; M6 closes #514 as
   not-planned with the reason (coverage is already in every run's summary and
   artifacts, and a coverage badge is the Scorecard argument of #497 in miniature). If
   the secret appears before M6 runs, M6 ships #514 in its #497 PR instead.
5. **Decided: V0.9.0 — and it exists** (milestone 16, created 2026-08-23). The
   collapse PR files the adopter-deletion issue into it; nothing is created.
6. **Decided: drop them.** The ten offline twins of phacc's frontend tests go in M2's
   test-folds PR. CI runs phacc on every PR, so nothing is uncovered; what is lost is that
   those ten facts can no longer be checked on a Windows host without Docker. The
   cross-language pins in the same file stay.
7. **Decided: the phone is the owner's.** No LAN opening for the sessions; Playwright's
   viewport matrix (375 px and up, both themes) covers the widths, and the companion app
   itself is checked by hand. So every `[phone]` step lives in a handover's "Test this by
   hand", never in "Validate locally". The rest as always: `home-assistant` on
   `http://localhost:8123`, `HA_BASE_URL` / `HA_TOKEN` exported per local session; for
   L2, a copy of the production store taken on the day of the rehearsal; the brands PR
   (#196) whenever it suits.
8. **Decided: one at a time.** §4's serial order, no overlap. The lane-overlap option
   (M1 ‖ M3, M2 ‖ M4, cross-lane PRs checking `gh pr list` before opening) stays
   written in §3 and §4 in case the owner changes this later; the prompts assume serial.

**Retired since the first draft**, so nobody looks for them: "#540's mark-up before the
wording session" (the mark-up now comes *after* the consolidation, from the owner's read
of the screens L1 hands over — §6.L1, §6.M7); "stage #546", "keep #563 out" and "one
household day" (all shipped in 0.7.0).

**What every decision and package was checked against** (2026-08-23, after item 2's
first verdict failed the check): the server language changing later; a member whose
profile language differs from the server's; an export made on one instance imported
into another (other language, other version); an upgrade in place, including the one
restart during which the new bundle talks to the old backend; an old backup restored
after a later release; a language that does not exist yet; names and queries in a
script without word boundaries. Where a case bites, the package says so where the work
is: the limiter's skew and stale options (§6.M2 PR 7), `invalid_format` against
`validation_error` (§6.M1 PR 6), the scan's answers for CJK names (§6.M1 PR 7), the
`rmdir` that cannot (§6.M2 PR 5), plural categories for a language with `few`/`many`
(§6.M5 PR 2), the built-ins under all four language cases (§6.M5 PR 4), a 0.1-era v1
store and a 2–9 backup restored after V0.9.0 (§6.M6 PR 4). Items 3, 4, 6, 7 and 8 have
no such surface: they decide process, not stored or displayed data.

## 3. Master sessions, subagents, and when validation is local

**A master session** is a Claude Code session started from one pasted prompt — on the
web by default, in a fresh Linux checkout; on the owner's host if the prompt's first line
says so. It runs on **Fable 5 at `xhigh`**: its job is to review every diff against the
subtraction rule, decide against drifted notes, run the live checks and merge, and a
wrong merge costs more than a subagent's tokens. It spawns **one subagent per PR**
through the repository's own agent definition, `.claude/agents/v080-implementer.md`
(added by this plan's PR): **Opus 5 at `xhigh`, in its own git worktree**, with the rules
of §5 and the return shape of §8.S built in. The master holds the session's Home
Assistant (below), runs each PR's live check on it, and never edits a subagent's branch
itself unless the subagent has failed twice — then it fixes by hand and says so.

**What a subagent does, and does not.** It reads the package text §6 names (one Read
of this file — not the whole of it), the issue comment that carries its cut list, and
CLAUDE.md / CONTRIBUTING.md; provisions its worktree (`uv sync`, `npm ci` when it
touches the card); works offline; runs both gates and phacc where §5 requires it; opens
the PR with the template filled in; watches CI; and **returns the report of §8.S and
stops**. It never merges, never touches the master's HA, never opens a second PR. A
subagent whose report the master rejects gets one follow-up message in the same worktree
with the review's findings; after a second rejection the master takes the branch over.

**The master's review**, before any merge: the full diff read against the subtraction
rule (no behaviour change without its own commit and test; tests deleted or moved, never
rewritten to pass); the counting table against `git diff --stat`; CI green including the
`integration` job (phacc runs there on every PR); the live check §6 names, run on the
master's own HA, with screenshots on the assets branch where the package says so; and
the subagent's follow-ups read, not skimmed — a follow-up that names a gap in the PR's
own work goes back to the subagent, one that names a real-world defect is filed, the rest
go into the handover.

**Sequence over parallelism.** Within a lane, PRs stack: the next subagent starts from
`origin/main` after the previous PR merged, never from an unmerged branch. A master runs
one subagent at a time unless §4 marks two packages as disjoint *and* the owner chose
"two" in pre-flight item 8 — and even then the two belong to different lanes. The three
cross-lane PRs (the health cut's card half, the rate limiter, the retry-after reader)
open only when `gh pr list` shows no PR from the other lane touching their files.

**What a master can stand up itself: a blank Home Assistant** from the wheel the phacc
suite installs, onboarded the way `card-smoke.yml` does it — no Docker:

```bash
PIN=$(grep -E '^homeassistant==' requirements-integration.txt)
FE=$(grep -E '^home-assistant-frontend==' requirements-integration.txt)
uv venv /tmp/ha --python 3.14 && uv pip install --python /tmp/ha/bin/python "$PIN" "$FE"
mkdir -p /tmp/ha-config/custom_components
ln -s "$PWD/custom_components/haventory" /tmp/ha-config/custom_components/haventory
(cd cards/haventory-card && npm ci && npm run build)
/tmp/ha/bin/hass -c /tmp/ha-config --skip-pip >/tmp/ha.log 2>&1 &
until curl -fsS -o /dev/null http://localhost:8123/; do sleep 3; done
uv run python scripts/ci_provision_ha.py --base-url http://localhost:8123   # prints HA_TOKEN
HA_BASE_URL=http://localhost:8123 HA_TOKEN=<token> HAVENTORY_IGNORE_ENV_FILE=1 \
  uv run python scripts/ws_init_haventory.py
(cd cards/haventory-card && npx playwright install --with-deps chromium)
```

With that, the `run-haventory` skill's harnesses (`driver.py`, `probe.mjs`,
`screenshot.mjs`, `two_tab.mjs`, `visual_pass.mjs`, `log_sweep.py`, `lifecycle_probe.py`)
and `test-haventory/stress.py` all have a target, and `dev/ha_config_for_dev.yaml` can be
dropped into `/tmp/ha-config` for the debug logging. The symlink serves the checkout's
own `custom_components/haventory` — to check a branch, check it out in the master's own
clone (the subagent's worktree is not the served tree). **The first master to run proves
the recipe** and records the outcome — booted or not, the boot time, anything the recipe
needed changed — at the top of its #236 comment; every later master reads it there and
re-runs the recipe in its own fresh environment. A master that cannot stand the HA up
says so in every affected PR body ("no cloud HA; L1 step n") and merges on the rest of the
evidence — that is what the late local sessions are for.

**When validation is local — and when.** A PR merges on the master's evidence when the
change is behaviour-preserving by test, the deletion's callers are proven absent by the
gate, or the refactor is exercised end to end by phacc or the live check. A PR that is
user-visible, touches the config-entry lifecycle or a WebSocket subscription shape, or
names a phone, a screenshot or a German reader in its acceptance **also merges** — with
its "Validate locally" block filled in — and that block is walked by the next local
session. The difference from the first draft of this plan: nothing waits open for a local
session; the local sessions come late and cover everything since the last one. Two kinds
of PR keep a harder floor because the offline stub has passed green on real breakage
there before: a lifecycle or subscription-shape PR merges only with phacc green (the
`integration` CI job) **and** either the master's live check or, for the card's
subscription opener, a `card-smoke.yml` run dispatched against the branch
(`gh workflow run card-smoke.yml --ref <branch>`; it is scheduled-only otherwise).

**The local sessions** are **L1** (after M5: every code change in the milestone, the
product as a household uses it, the phone, and the German review surface for #540), **L2**
(after M6: the docs, the collapse rehearsal on a copy of the production store, the
wording PR if M7 has run) and **Z** (the closing pass). They run on the owner's host
against the dev Home Assistant, on Fable 5, and are allowed to spawn the same
implementer subagents for the defects they find — one per defect, merged one at a time.

## 4. The map

```
M1  backend: dead persist path; stub conformance; one door,      9 PRs   cloud, Fable 5 master
    one tail, one op table, uniform typing; text index;                  (+ proves the HA recipe)
    health → test oracle; the repository's own copies
M2  backend: one field-rule table; predicate list; field         7 PRs   cloud
    catalog; lifecycle leftovers; #333; test folds;
    the rate limiter last (owner merges)
M3  card: dead code; comment sweep; one store spec; the store    4 PRs   cloud   (may run beside M1)
M4  card: discard in one place; one workspace; one chrome;       6 PRs   cloud   (may run beside M2)
    one modal; the widgets written twice; one row chrome
M5  i18n: the retry-after reader; plural categories + folds by   4 PRs   cloud
    role + the unused-key test (#542); accessible names (#615)
    + the conflict banner's detail; the built-ins translated
    on display (#536)
L1  local: deploy main, every regimen, the product at both               local, Fable 5
    widths / themes / languages, every "Validate locally" block
    since the start, fixes; the German review surface for #540
M6  docs + CI (#497, #514, #331, one home per fact, scripts);    5 PRs   cloud
    the schema collapse (#229; owner merges) + import validators
M7  #540: apply the owner's mark-up (owner merges)               1 PR    cloud, Opus 5 xhigh, no subagents
L2  local: M6's and M7's blocks; the collapse rehearsal on a              local, Fable 5
    copy of the production store; D7/D8/E3/E4 against v1
Z   the online regression / usability pass; sums the counts;             local, Fable 5
    deletes this file and the agent definition; then the release PR
```

Serial order: **M1, M2, M3, M4, M5, L1, M6, M7, L2, Z.** With pre-flight item 8 at
"two": M1 ‖ M3, then M2 ‖ M4, then M5 — the card sessions never touch a backend file and
the three cross-lane PRs check before opening. M7 needs the owner's mark-up on #540,
which L1 makes possible; it can run before, beside or after M6. Thirty-six planned PRs
plus whatever L1, L2 and Z ship. A session starts when the previous one in the order has
merged everything (or the owner has merged what it left open); M6's collapse PR opens
last in that session so the collapse lands on a tree that has stopped moving, per
#229's own rule; Z after the owner has merged it.

## 5. Rules every session follows

Everything from the V0.7.0 plan carries over — branch discipline, Conventional-Commit PR
titles, TDD, the gate before every commit, "issues are read, not rewritten", the PR body
as the review record, the Follow-ups bar — with these changes and additions.

**Model and start condition.** The first line of every prompt names the model, the
effort and where it runs. Each prompt restates its start condition and the session checks
it (`gh pr list`, `gh issue view`, the previous session's #236 comment) before anything
else.

**Branches and PRs.** One branch per PR, `claude/v0-8-0-<package>-<topic>`, off
`origin/main`. Link the issue (`Closes #NNN` / `Refs #NNN`) and fill in
`.github/pull_request_template.md`. A PR that removes a file under
`custom_components/haventory/` adds its path to `RETIRED_PATHS` in the same PR — this
milestone is the first to populate it (`areas.py`, `health.py`, `rate_limit.py`).

**The subtraction rule.** A cut PR changes no behaviour; its tests are deleted, moved or
left alone, never rewritten to pass. When a package carries a behaviour change (#333's
`rmdir`, #615's two keys, the banner detail, the built-ins' display-time translation),
that change is **its
own commit with its own test and closes or refs its own issue**, so the per-commit rule
holds and the changelog names it.

**The gate, before every commit.**

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check . && uv run ruff format --check . && uv run mypy
cd cards/haventory-card && npx eslint . && npm run typecheck && npx vitest run && npm run build
```

**phacc** (`scripts/test_integration.sh`, native on Linux; the Docker recipe from
`docs/developing.md` on the owner's Windows host) is required before a PR opens for any
PR touching `custom_components/` or `tests/integration/`; CI's `integration` job runs it
again on the PR. Build the card first or `test_frontend.py` skips half its cases.

**Merging.** The master squash-merges a PR when its review (§3) is done: both gates and
CI green, phacc where required, the live check run or honestly marked impossible, the
"Validate locally" block filled in for anything user-visible or lifecycle-shaped. **Left
open for the owner:** M2's rate-limiter PR, M7's wording PR, M6's collapse PR (with its
import-validators PR stacked on it). **Release-please PRs are never touched.**

**Counting.** Every cut PR's body carries a three-line table: production lines removed,
test lines removed, lines added — `git diff --stat` numbers, not estimates. Z sums them
in its closing comment on #236.

**Live checks from a master.** Drive the master's own HA (§3) with the `run-haventory`
skill's harnesses; put screenshots on an orphan `claude-assets-v0-8-0-<session>` branch
(commit with the noreply author or the push is refused) and link them in the PR body.

**The handover.** Every session's final message ends with `## Handover`, repeated as a
comment on #236 (the milestone's running record, as 0.7.0's rounds did) and, per PR, as
the last section of the PR body. Six parts, each present even when short:

1. **Merged / left open** — PR links; for each left-open PR, who merges it and why.
2. **Test this by hand** — what no session can do: a phone, a German reader, the owner's
   own store. Tagged `[phone]`, `[German]`, `[owner]`.
3. **Validate locally** — the numbered steps the next local session runs, each tagged
   `[dev-ha]`, `[browser]`, `[HA settings]`, `[phone]` or `[log]`, with the expected
   result. "Nothing — merged on a test that pins it: …" is a valid entry; an empty one is
   not. The #236 comment carries the union of the session's PR blocks, so L1 and L2 read
   one list per master.
4. **Decisions taken against drifted notes** — one line each.
5. **Follow-ups** — filed (links) or named and not filed, with the reason.
6. **State left behind** — branches, assets branches, the HA recipe's outcome, anything
   the next session must know, and the counting table's totals for this session.

**Conventions that bite in this milestone specifically.**

- **The stored payload does not move before the collapse.** No session changes what
  `serialize_state` writes; the collapse lands on a shape that has stopped moving. A
  session that finds it must stops and reports.
- **The WS contract does not move silently.** A schema type widened to `object` (M1), a
  field leaving `haventory/health` (M1), an error code retired (M2) each update
  `docs/backend_api_contract.md` and `docs/data_shapes.md` in the same PR;
  `tests/test_docs_contract_offline.py` will say so if not.
- **Dictionaries are edited by M5 only**, except for keys a cut makes unreachable (the
  health keys, the rate-limit keys, the dead pair), which the cut deletes itself. A
  session that needs a *new* key — there should be none outside M5 — adds it in both
  languages and says so in the handover.
- **Nothing German-specific in the mechanism.** English is the master dictionary; every
  other language is a file beside it, complete or partial, and `t()` falls through to
  English. No test, helper or type names `de`; a check that is true of one language is
  written over `DICTIONARIES` (card) or `translations/*.json` (integration). A key is
  folded because two call sites name the same thing in the same role, never because the
  German happens to match (§6.M5).
- **`tests/conftest.py` is rewritten by M1's second PR** (the stub conforms to real HA).
  Every backend PR after it starts from that stub; card PRs are unaffected.
- **Per-surface test ids and classes are parameters, never collapsed.** The browser
  harnesses under `.claude/skills/` locate `badge-*` / `full-badge-*`, `search-input` /
  `full-search`, `inline-editor` / `full-editor` / `sheet-editor`, `full-panel-head`; a
  shared renderer keeps them byte-identical.
- `tests/test_min_ha_version.py`, `test_toolchain_pins.py` and
  `test_release_version_consistency.py` stay exactly as they are; M6's README edits run
  the backend gate before they are believed.
- TDD, no `TODO`/`FIXME`, comments encode constraints not history, plain words — as
  always. Out-of-scope findings go in the Follow-ups note and become issues only if they
  clear the real-world bar.

## 6. The sessions

Each master's package lists its PRs in order — each PR is one subagent — with the cuts it
carries (by the ids the #230/#231/#542 comments use), the tests, the live check the master
runs, and what the "Validate locally" block should say. File references are to symbols;
line numbers in the issue comments are from `b878bfe`.

### 6.M1 — backend: the dead path, the stub, one tail, the indexes

Nine PRs, in order. The master proves the HA recipe (§3) before spawning the first.

1. **"refactor(storage): delete the debounced persist path nothing calls"** — refs #230
   (item 3), BE-LIFE-L1, TESTS-T2. `async_request_persist`, `cancel_pending_persist`,
   `PERSIST_DEBOUNCE_DELAY`, `runtime.persist_task`; `_async_flush_pending_writes` shrinks
   to "flush if loaded"; `async_persist_immediate` stays where it has callers
   (`__init__.py` has two). The `ws.py` docstring and `docs/developing.md`'s "Debounced
   saves" line go; CLAUDE.md's persistence convention loses its debounce clause. Tests:
   the debounce cases in `test_storage_concurrency_offline.py`, the debounce halves of
   the two refusal tests, the two phacc tests and module docstring in
   `tests/integration/test_persistence.py`, the `immediate_persist` fixture and its
   consumer, the `persist_task` key in the diagnostics expectation — ≈395 lines. The
   flush-on-unload tests stay and are what matters.
2. **"test: make the offline Home Assistant stub conform, and take the stub-compat
   branches out of production"** — refs #230 (item 6), BE-LIFE-L2, BE-WS-C4,
   TESTS-T1/T7. Stub side (`tests/conftest.py`, `tests/ws_helpers.py`): the WS command
   registry becomes a dict keyed by command type (re-registration overwrites, as HA);
   `area_registry.async_get` becomes synchronous; `RecordingConn` gains
   `subscriptions: dict` and a `close()` that drains it; `HomeAssistant` gains a recording
   `services.async_register` and an `http` with `register_view`/`register_static_path`;
   `config_entries` gains no-op `async_forward_entry_setups` / `async_unload_platforms`.
   Production side: `_cleanup_ws_test_stub_registry`, `_forget_registration_flags`, the
   bucket flags, the `async_setup` that only seeds `hass.data`, the dead `getattr` /
   `callable` guards in `__init__.py`, `ws.py`'s `_send_error` probe, the
   `async_send_message` branch, the `on_close` / `add_close_callback` fallback, the
   `subscriptions` probes, `services.py`'s `hasattr(hass, "services")` early return,
   `events.py`'s bus probes, `todo_bridge.py`'s four entry/bus probes, and **`areas.py`
   as a file** (`ws.py` calls `ar.async_get(hass)`; `RETIRED_PATHS` gains `"areas.py"`,
   its first entry). Expose the handler list `setup()` registers as a module constant.
   Delete the test-only stubs the comment lists; rewrite
   `test_integration_lifecycle_offline.py`'s cleanup assertion as "a second `setup_entry`
   leaves one handler per command". Retire the harness's own tests
   (`test_ws_helpers_offline.py`, `test_integration_bootstrap_offline.py`,
   `src/test.utils.test.ts`, `src/test.setup.test.ts`), moving the two production cases
   out of `test_ws_schema_validation_offline.py` first. CLAUDE.md's "the offline stub has
   no service registry" sentence becomes "registration is asserted offline; dispatch is
   phacc-only". *Lifecycle-shaped: the harder floor in §3 applies.*
3. **"refactor(ws): one door for every broadcast"** — refs #230 (items 4, 10), BE-WS-C5.
   The subscription/broadcast half of `ws.py` moves into `subscriptions.py`, which
   `events.py` imports, so its two function-local-import shims go and the cycle comment
   with them; `notify_status_mutation` so the four status handlers and import's two
   `reloaded` broadcasts use the same door as items and locations; the test-only
   `ITEM_ACTIONS` goes; `events.py`'s docstring says what is true. Note
   `events.async_track_day_rollover` (#588) lives there now and is a broadcast caller,
   not a door of its own. *Subscription-shaped: the harder floor applies.*
4. **"refactor(ws): one tail for every single-item mutation"** — refs #230 (item 4),
   BE-WS-C1/C7. One `_mutate_item(hass, conn, msg, kind, *, counts=True)` that strips
   `id`/`type`, runs `_execute_item_op`, persists, notifies, replies; the eleven
   table-shaped handlers become two-line bodies; the six inline twins of their
   `_op_item_*` entry go; the five hand-built payload dicts go; `ws_item_set_quantity`'s
   pre-check that restates the model goes; `ws_items_bulk`'s per-row error mapping reuses
   `_error_message` / `_context_from_msg`. `media.async_delete_item_files` (#592) is the
   delete op's post-persist step, called from the tail — and the test #592's follow-up
   asked for: every delete surface (`item/delete`, `items/bulk`, the service) frees the
   files through the same call, asserted once.
5. **"refactor(services): services and WebSocket share one op table"** — refs #230,
   BE-MODELS-C1, BE-WS-C8. Twelve `service_*` handlers (each eight identical lines and one
   identical `except`) become `_run_service(name, data)` over the same ops `ws.py`
   dispatches; `ws_item_create`, `ws_reminder_bump` and `ws_location_update` lose their
   duplicate bodies the same way; the location-update "what changed → which event"
   decision is written once. Give the repository public `iter_locations()` /
   `children_of(parent_id)` and retire `_debug_get_internal_indexes` from
   `ws_location_list` / `ws_location_tree`. What must survive, and the tests that pin it:
   the typed service schemas, `new_location_id`, the required `due_date` on check-out, the
   `{"item": …}` envelope, the per-op log context, `_bind`'s coroutine-function
   constraint, and `test_services_offline.py`'s catalog test, which holds the schemas,
   `services.yaml` and `strings.json` to one field set per service. Two #593 follow-ups
   ride along as their own commit: `item_create.tags` declares `text:` and
   `item_update.tags` `object:` for the same value — one selector; and `example:` is given
   to some fields and not others — fill the gaps.
6. **"refactor(models): type every payload field the same way"** — refs #230,
   BE-WS-C6. Widen the remaining `[str]` / `{str: object}` WS fields to `object` so the
   model answers every type error with `validation_error` (#591's guard under
   `validate_tags` makes this safe — a non-list and a non-string entry are both refused);
   the same rule for the filter path (`tags_any` / `tags_all` given a bare string →
   `validation_error`, as `categories` and `location_ids` already answer) and for
   `haventory/subscribe`'s `location_ids` (refuse a non-string entry rather than
   `str()` it); delete the contract's paragraph enumerating the exceptions and the half of
   `test_docs_contract_offline.py` that kept the list in sync; `_payload_int` goes.
   `docs/backend_api_contract.md` and `docs/data_shapes.md` move in the same PR. The
   rule #541 wrote stays true and gets simpler: `invalid_format` is core's answer to a
   frame whose *shape* the command schema refuses (a missing `id`, an unknown top-level
   key), `validation_error` is the model's answer to every *value* — a wrong type
   included. The card's two paths (`host-surfaces.ts` reads `validation_error`'s field
   errors; anything else is the generic banner) are unchanged and their tests are the
   pin.
7. **"refactor(repository): the scan answers q; delete the text index"** — refs #230
   (item 1), BE-REPO-1. **First commit: a benchmark** — `list_items` with `q="Widget"`
   over a generated 10,000-item repository, timed before and after, in a test marked to
   run only with `ASSERT_BUDGETS=1`; the two numbers go in the PR body, and the cut lands
   only if the scan is under the 0.5 s the issue named. Then everything BE-REPO-1 lists.
   Tests: the five fall-through tests keep passing and are the oracle; the six
   `_get_filtered_candidates` assertions and the three-dict rebuild comparison go; add
   the accent/case and multi-word AND cases on results, and names in a script without
   word boundaries (a Japanese or Chinese item name, a query that is a substring of it):
   the scan's answer is the contract, and a query the index's pre-filter had been
   narrowing below the scan's answer is a fix to record in the PR body, not a regression.
8. **"refactor(health): index health becomes a test oracle, not a product feature"** —
   refs #230 (item 2), BE-REPO-2/7, FE-LISTS-L4, I18N-I3. `collect_health_issues` and its
   five checkers move into `tests/` as a fixture that runs after every `Repository` test;
   `haventory/health` keeps its shape with `issues: []`, the diagnostics JSON keeps
   `health_issues: []`, `generation` leaves both. Card half: `ui/health-codes.ts` and its
   test, the panel's "Issues found" rendering, the 38 `hv.health.*` keys and
   `hv.count.issue` in both dictionaries; `HealthResult.issues` stays typed `string[]`.
   `health.py` joins `RETIRED_PATHS`. Docs: README's "index-health checks",
   `frontend_architecture.md`, the contract's health line, `dev/release_testing_plan.md`'s
   five `issues == []` assertions become "counts match"; `stress.py`'s `assert_healthy`
   the same. **Cross-lane**: opens when no card PR touching `hv-diagnostics-panel.ts`,
   `host-surfaces.ts` or `src/i18n/` is open.
9. **"refactor(repository): one chain walk, from_dict on the models, and the small
   copies"** — refs #230, BE-REPO-3/4/5/6/8. Five parent-chain walks → one `_chain()`;
   the staged-map copy in `update_location`; `from_dict` on `Item`, `Location`,
   `LocationPath` so `load_state` and `import_export._recompute_paths` stop building them
   field by field; five `_count_*` → one; the class docstring that states the opposite of
   the `location_path` invariant, the "pre-WP4" pair, the narrated call sequence.
   `test_load_report_offline.py` stays green untouched.

phacc required for every PR but 7 and 9's benchmark commit (all touch
`custom_components/`). **Live checks the master runs** on its HA: after PR 2, reload the
entry twice from `/api/config/config_entries/entry/<id>/reload` and grep the log for
`Overwriting|Traceback`; after PRs 4–6, every `haventory.*` service from
`POST /api/services/haventory/<name>?return_response` answers the same envelope as before
(one response per service in the PR body) and two WS clients see the same `items` /
`locations` / `statuses` / `stats` frames as on `main` (the `two_tab` recipe); after PRs
7–9, 2,000 seeded items — search, filter, sort, a subtree move and a rename; the
diagnostics panel opens with counts and no "Issues" section; `stress.py baseline`.

**Validate locally** (the union L1 walks): `[dev-ha]` deploy `main`, reload the entry
from Settings → Devices & services, `[log]` nothing at ERROR carrying `haventory`;
`[HA settings]` Developer Tools → Actions → `haventory.item_update` with `tags: kitchen`
(a string) answers `validation_error` and changes nothing; `[browser]` the diagnostics
panel shows counts and no "Issues" section.

### 6.M2 — backend: the field rules, the predicate list, the lifecycle leftovers, the rate limiter

Seven PRs, in order. The rate-limiter PR is last because the owner merges it, so nothing
in this session stacks on it.

1. **"refactor(models): every field rule written once"** — refs #230, BE-MODELS-C3. A
   per-field rule table applied by `create_item_from_create` with `previous=None` and by
   `apply_item_update` with `previous=item.<field>`; the nine `_update_*` helpers become
   the table walk; `validate_item_status` / `coerce_item_status` become one function with
   `default=`; the second `CUSTOM_FIELDS_MAX_KEYS` check goes; `new_uuid4_str` (zero
   production callers) goes. `validate_optional_date(value, *, field_name)` (#590) is
   already the shape the table wants. Every existing message stays byte-identical — the
   sixteen message tests #590 added are the pin.
2. **"refactor(models): filter_items as a predicate list"** — refs #230 (item 1's scan),
   BE-MODELS-C4. Predicates built once per query for the keys present; the fourteen
   `if "x" in flt else False` lines, the `predicates_active` block and the sixteen eager
   `matches_*` go; the five `item_*_is_*` functions become one `_date_passed(item, field,
   today, inclusive)` behind the five public names, `today` staying a parameter the caller
   fills from `today_local_date()` (#579) — `filter_items` imports no `hass`;
   `sort_items`' re-validation of what `validate_sort` already checked goes;
   `repository.py`'s `_count_*` collapse onto the same predicates. Re-run M1's benchmark
   after; record it.
3. **"refactor(models): one field catalog"** — refs #230, BE-MODELS-C8. `ItemCreate` /
   `ItemUpdate`, both voluptuous schemas (typed for services, `object` for WS), the bulk
   whitelist and `_ITEM_SOURCE_FIELDS` derived from one `ITEM_FIELDS` table;
   `Item.to_dict` stays hand-written (it is the stored shape). Droppable if the generator
   needs more than it saves — the subagent says so in its report and the master decides.
4. **"refactor(init): the manifest is already a constant; the /local path never shipped;
   the unreachable checks"** — refs #230, BE-LIFE-L4/L5/L7. `_read_manifest_version`,
   `_async_manifest_version`, `_MANIFEST_PATH`, `_async_card_url` becomes sync (the `?v=`
   string is byte-identical by `test_release_version_consistency.py`);
   `_LEGACY_CARD_URL_PATH` and its test; the two branches of `_validate_storage_payload`
   that `DomainStore.async_load` makes unreachable, one `_normalized(payload)` for the
   four `STORE_COLLECTIONS` defaults, `schema_downgrade_message` inlined, the second raw
   backup in `_async_settle_lossy_load` that `repairs.py` already wrote.
   `tests/integration/test_repairs.py` is the gate for the last one.
5. **"fix(media): remove an item's attachment directory once its last file is gone"** —
   **closes #333** (option 2). After the last unlink on item delete and on
   last-attachment removal, `rmdir` the item's directory with `OSError` swallowed — the
   operator's-own-file case the `_sweep_blocking` docstring protects, falling out of the
   API. "Last file" now includes the thumbnail tile beside each picture
   (`thumbnail_path`, `THUMBNAIL_SUFFIX`); `async_delete_attachments` and
   `async_delete_item_files` already unlink both, so the `rmdir` follows the pair. The
   setup sweep removes a directory it has itself just emptied (a tile from an earlier
   encoder generation is its orphan), and no other. Tests: delete → directory gone; a
   stray file → kept; the sweep on an old-generation tile → directory gone. A `rmdir`
   that fails for any other reason (a tile being served at that instant, a mount point)
   leaves the directory exactly as today — accepted, and said in the docstring, which
   keeps the constraint and loses the "deliberate tradeoff" sentence.
6. **"test: one setup per phacc file, one helper per online smoke, and the phacc twins"**
   — refs #230, TESTS-T5/T6. One `setup_entry` fixture in `tests/integration/conftest.py`
   replacing fourteen `_setup`s; `install_runtime(…, ws=True)` replacing six
   `_make_hass`; one `tests/online_helpers.py` for the three smokes' four identical
   helpers; `_utc_day_offset` once; the two `MockResourceCollection` pairs once; a
   `mountHost` for the card's four host specs; and (§2 item 6: yes) the ten offline
   frontend tests with a phacc twin, `conftest.py`'s hand-written `async_register_panel`
   and the `__panel_registrations__` log (the cross-language pins in the same file stay).
   While in there: any test that freezes `dt_util.now` and then compares against
   `datetime.now(UTC)` or `date.today()` (the pattern that turned `main` red at 00:00Z on
   2026-08-23, #586) takes its expected value from the frozen clock instead.
7. **"refactor: remove the WebSocket rate limiter"** — refs #230 (item 7), #199;
   BE-WS-C2, BE-LIFE-L8, I18N-I4, TESTS-T4 — **left open for the owner** (§2 item 1).
   Every site the #230 comment enumerates: `rate_limit.py` (→ `RETIRED_PATHS`), the
   limiter branches in `ws.py` / `subscriptions.py`, nine `CONF_`/`DEFAULT_` pairs in
   `const.py`, the options section in `config_flow.py` and its keys in `strings.json` and
   both translations, the diagnostics block, the health sub-block, the `rate_limited`
   error code (contract and `exceptions.py`), `docs/rate_limiting.md` (deleted, with its
   five inbound links; `test_docs_links_offline.py` finds any missed), the README's
   section and line, `developing.md` / `frontend_architecture.md` references,
   `dev/release_testing_plan.md`'s two scenarios. Card: the `rate_limited` branches of
   `store.ts`, the `rateLimited` flag and banner (`ui/banners.ts`), `hv-bulk-bar`'s
   string, `hv-diagnostics-panel`'s lines, five keys in each dictionary; the
   subscribe-retry path **stays** (it serves `unavailable`); the `retryAfterHintMs` reader
   is M5's. Skills: `rl_banner.mjs`, `stress.py`'s `ratelimit` regimen and `RL_DEFAULTS`,
   four SKILL.md passages. Tests: `test_ws_rate_limit_offline.py` and the rate-limit
   cases in seven other files; the card's `describe('Store: rate limiting …')`. Edge cases
   to add: an entry whose options still carry the nine keys sets up and ignores them,
   and the options flow's next save drops them; and the one-restart skew a HACS update
   creates — the new bundle is served from disk while the old backend still runs — means
   a `rate_limited` frame can still reach the new card once: it renders the generic
   failure banner like any unknown code (a card test with an unknown code is the pin).
   *If shrinking instead:* BE-WS-C3 — `TokenBucket`, one global command bucket,
   `RateLimitConfig(enabled, per_second, burst)`, three options, `retry_after_ms` emitted
   so the card's reader finally reads something. **Cross-lane**: opens when no card PR
   touching `src/store/store.ts`, `src/ui/banners.ts` or `src/i18n/` is open.

phacc required for every PR. **Live checks the master runs**: after PRs 1–3, the
benchmark numbers in the PR body and `stress.py baseline` on 2,000 items; after PR 4, the
card served at `?v=<INTEGRATION_VERSION>` (`lovelace/resources` over WS shows one entry);
after PR 5, an item with a photo deleted leaves no directory under
`/tmp/ha-config/haventory/attachments`, a directory holding a stray file survives; after
PR 7, the options form renders without the section (or with three fields), no rate-limit
banner under a `hammer` run, every `stress.py` regimen other than `ratelimit` passes.

**Validate locally**: `[dev-ha]` deploy `main`; `[HA settings]` HAventory → Configure
saves with no rate-limit section; `[browser]` the card and `/haventory` work as before;
`[dev-ha]` delete an item that has a photo — no directory left under
`/config/haventory/attachments/`.

### 6.M3 — card: dead code, the comment sweep, one store spec, the store

Four PRs, in order.

1. **"refactor(card): delete the dead selection chain, the unused client methods and the
   unbound props"** — refs #231 (item 3), FE-STORE-S1/S2, FE-LISTS-L1/L5/L8,
   FE-SHELLS-C7. `pendingOps` (state field, seed, six write sites, the
   `frontend_architecture.md` line); `hv-list`'s `selectable` / `selection` / `pendingIds`
   / `fill` / `skeletonRows` and their bindings; `hv-list-row`'s whole selection mode —
   `selectable` / `selected` / `pending`, the `.row.selected` and `.box` rules, the
   checkbox, the `toggle-select` branch nothing listens to, the pending chip, the
   hover-action gate; `WSClient.ping`, `addTags`, `removeTags`, `updateCustomFields`,
   `getLocation` and the mock's `location/get` case (the `item/add_tags` cases stay — bulk
   dispatches them); `hv-location-tree`'s never-bound `allLabel` / `allIcon`;
   `hv-card-shell.forceMobile` and `ResponsiveController.setForced`; `MediaUrls.failed()`
   if still unreferenced after #606; the dead `--hv-error-border` token; the two i18n
   pairs this makes unread (`hv.row.pending`, `hv.row.select`) and the two #542 names
   (`hv.term.checkedOutUntil`, `hv.action.apply`). Tests: the "selection mode" cases, the
   `updateCustomFields` case, the `setForced` cases; add "no `row-pending` renders" and
   "`StoreState` carries no `pendingOps`".
2. **"docs(card): comments that state the rule, not the measurement"** — refs #231 (item
   1). The #231 comment's list: 12 sites from the issue's three greps and 7 narrative
   blocks a fourth grep catches
   (`showed nothing|said nothing|sat there|doing nothing|never (set|forwarded)|now (reads|render|take)|bit once`);
   `docs/frontend_architecture.md`'s "Each split bit once" passage; and whatever the four
   greps find in the ≈3,000 lines added since (#573–#614 — the phone-row and app-bar
   fixes measured a great deal). Rule: keep the constraint the block ends on, drop the
   trace. Then the length pass: doc blocks of eight lines or more in the editor, organize
   dialog, detail sheet, filter panel, import sheet, `ui/media.ts` and
   `ui/dialog-focus.ts` restated in four lines or fewer where the constraint allows it; a
   block that cannot be shortened without losing a rule stays. Test files get the same
   greps. No CSS changes; the gate passing unchanged is the assertion. Acceptance: the
   four greps over `src/` return only the false positives the comment lists.
3. **"test(card): one store spec"** — **closes #231** (item 5). `store.test.ts`'s three
   duplicate cases go; the rest moves into `store.revamp.test.ts`, which is renamed
   `store.test.ts` and split by `describe` into files named for what they pin (filters,
   degraded, subscriptions, events — `store.day-clock.test.ts` already has that shape).
4. **"refactor(store): one optimistic write, one read path, one subscription opener"** —
   refs #231 (item 4), FE-STORE-S3/S4/S5/S8. The six identical mutators onto
   `optimisticWrite(itemId, patch, call, details?)`; the four attachment wrappers onto
   `applyResult`; the location/status mutators onto an `after*Change` wrapper; `listItems`
   and the other direct `this.ws.*` reads through `run()` so the comment claiming they do
   is true (keep the `inflight` map); `subscribe()` and `subscribeAreaRegistry()` onto one
   `openSubscription(msg, cb, opts)` — the function-or-promise, early-cancel unwrap; one
   `Coalesced` helper for the four debounce slots, three cancel helpers and three seq
   guards, `dispose()` cancelling each. `store.test.ts`'s optimistic apply/rollback cases
   are the guard and stay. *Subscription-shaped: the harder floor in §3 applies —
   `card-smoke.yml` dispatched against the branch, or the `two_tab` recipe on the
   master's HA.*

No phacc. **Live checks the master runs**: after PR 1, the card, the full view and the
panel render (the live-update smoke in Chromium; registration in Firefox if Playwright's
Firefox installs) and a hovered row shows its actions; after PR 4, the two-tab fan-out —
a mutation in one tab repaints the other's list and counts — and a forced `conflict`
(the `routeWebSocket` recipe) rolls the optimistic row back and shows the banner.

**Validate locally**: `[browser]` two tabs on the card, an item created in one appears in
the other with its count; `[browser]` a forced conflict rolls back and the banner names
it; `[browser]` hover a row — the actions appear; nothing else should have changed.

### 6.M4 — card: one workspace, one chrome, one modal, the widgets, one row

Six PRs, in order.

1. **"refactor(card): the discard question asked in one place"** — refs #231 (item 2),
   FE-DIALOGS-6. `hv-item-editor` takes a `confirmDiscard(onConfirm)` callback; the
   detail sheet and the full view pass `surfaces.confirm`, the shell already does; the
   three private `<hv-confirm>`s and two `_pendingDiscard` machines go. Why first: it
   makes the shell's and the full view's editor halves identical, which PR 2 needs.
2. **"refactor(card): one item workspace for the shell and the full view"** — refs #231
   (item 2), FE-SHELLS-C1/C3/C4, FE-LISTS-L3. A plain class in the `HostSurfaces` style
   (`src/item-workspace.ts`) holding `_editing` / `_editorBusy` / `_editorError` /
   `_pinnedItem` / `_checkout` / `_detailItemId`, `syncPinnedItem`, `editorItem`,
   `onEditorSave`, `createLocationForEditor`, `media`, the store subscription, the
   row-action/row-event dispatch table (each host keeps its three overrides — anchor,
   delete routing, open), and three template functions `renderEditor`,
   `renderDetailSheet`, `renderCheckoutPopover` parameterised by `{testid, mobile,
   anchor?}`. One viewport watcher: `HostSurfaces` and `hv-full-view` use
   `ViewportNarrow`; `connect()` / `disconnect()` and their four call sites go. One
   Store/theme lifecycle for `index.ts` and the panel (keep the panel's
   `requestUpdate()`). The phone edit bar (#573), the sheet pill (#586) and the panel's
   phone rows (#604, #614) are pinned by their tests and must measure the same after.
3. **"refactor(card): the filter chrome, once"** — refs #231 (item 2), FE-SHELLS-C2/C8,
   TESTS-T9. `ui/stat-badges.ts` (`renderStatBadges` with `{prefix, chipClass, total?}` —
   the shell's `badge-*` / `hv-chip badge toggle` and the full view's `full-badge-*` /
   `hv-chip pill` are parameters), `ui/filter-chrome.ts` (`renderSearch`,
   `renderFilterChips`, `renderFilterPanel`, `renderStagedFooter`, **one sheet/panel head
   row** — `.sheet-head` and `full-panel-head` (#587) are its two adopters — one
   `SEARCH_DEBOUNCE_MS`, `searchDebounce(store)` / `priceStaged(store, set)`), the
   search-box and pill CSS exported the way `bannerStack` is. Functions, not a base
   class. Tests: the four cases both host specs name identically move to the new
   modules' tests with one "renders the badges" smoke per host.
4. **"refactor(card): one modal chrome"** — refs #231, FE-DIALOGS-1/4. `ui/modal.ts`
   exporting the backdrop/wrap/panel CSS once and `renderModal({z, label, testid,
   onClose}, body)` owning `nextZBase()`, the `DialogFocus` sync and `onEscape`;
   adopters: organize, import, confirm (gains the return-focus it lacks), column picker,
   diagnostics; `ui/dialog-sheet.ts` folds in; one close convention (emit `cancel`, never
   flip `open` from inside — the `hv-bottom-sheet` comment says why). The organize
   dialog's two action sheets, three toolbars and five footers become one each; the
   seven-entry disclosure-reveal registry becomes a `ref` callback that scrolls and
   focuses on first render (the "a re-opened dialog moves nothing" rule is the test).
5. **"refactor(card): the widgets written twice"** — refs #231, FE-DIALOGS-2/3/5/7a.
   `ui/day-offsets.ts` for the editor and the check-out popover; `hv-location-picker`
   (the trigger/`aria-expanded`/`.tree-holder`/tree disclosure the editor, filter panel,
   organize parent picker, merge target and bulk bar each write; `keepOpenOnSelect` for
   the filter panel); `ui/attachments.ts` (the photo figure and document row the editor
   and the detail sheet share — including #606's missing-picture placeholder, which both
   now draw — and the lightbox host block); the category list renders in flow under its
   input like the location tree does (the floating placement, its two window listeners
   and its fixed positioning go; the chevron and the show-all affordance stay). And the
   fold #578's follow-up named: `hv-location-tree`'s own `_walk` / `_syncRovingTabindex`
   / arrow handling onto `ui/roving-list.ts`, which grows open/close and parent stepping
   — #575's keyboard tests on every host are the pin (one tab stop, ↓↑→← Home/End).
6. **"refactor(card): one row chrome for the list row and the table"** — refs #231,
   FE-LISTS-L2/L6. `ui/row-chrome.ts` with `renderRowThumb` (the thumb, its missing
   state and the `?size=thumb` URL — #576, #606), `rowKeyAction` (the four-key table; the
   table's `target !== currentTarget` guard survives as the shared shape) and
   `renderNameChips(item, statuses, {statusChip, overdueText})` — `overdue` vs
   `overdueOn` stays a parameter (#552/#553); `isLowStock`, `rowMenuEntries` move out of
   the component file; `ui/location-path.ts` (#604) is already the shared path helper;
   the thumb and chip-spacing CSS exported once. The phone row's area pill (#614) and the
   one-line rule (#604) are pinned and must measure the same after.

No phacc. **Live checks the master runs** on its HA at 1920 px (docked and hidden
sidebar) and 375 px, light and dark, on the card, the full view and `/haventory`: editor
open/save/cancel/discard on all three hosts and the phone add sheet; the check-out
popover from a row and from the editor; the detail sheet on a phone width; every dialog
opens, Escape closes one layer, focus returns to the opener; the editor's location
picker, category list, day offsets and photo strip; the organize dialog's four tabs and
their inline editors; the import sheet's preview; the filter panel's tree stays open while
multi-selecting; keyboard-only from the search box to the first table row in the count
#578 measured (31) or fewer; every `data-testid` the harnesses name still resolves
(`card_views.test.mjs`, `surfaces.mjs`); `visual_pass.mjs` light and dark with before/after
captures on the assets branch, looked at, not only counted.

**Validate locally**: `[browser]` the list above at 1920 and 375 on the dev HA, against
0.7.1's captures. **Test this by hand** (the owner's, §2 item 7): `[phone]` edit from a
row on `/haventory` and in the card — the Save pill whole, the action row one line in
German; `[phone]` the organize dialog's phone page and the editor's phone sheet.

### 6.M5 — i18n: the reader, plural categories and the folds, the accessible names, the seed

Four PRs, in order. Start condition: M1–M4 merged and the owner has merged the
rate-limiter PR. The order inside the milestone is the owner's: consolidate first, then
the German wording from the owner's read (M7) — **this session rewords nothing.**

1. **"refactor(store): drop the retry-after reader nobody sends to"** — refs #230 (item
   7). The limiter was deleted (§2 item 1), so nothing will ever send the hint.
   `retryAfterHintMs`, `nonNegativeNumber`, the hint half of
   `subscribeRetryDelayMs`, the two hint tests, the `frontend_architecture.md` paragraph.
2. **"refactor(i18n): plural categories, one key per thing-in-a-role, and a test for a
   key nothing reads"** — **closes #542**. Three parts, three commits:
   - **The mechanism, made language-neutral.** `tn()` picks the form through
     `Intl.PluralRules(language()).select(count)` and looks up `<key>.<category>`, then
     `<key>.other`, then English; `en.ts` keeps `one`/`other`, a dictionary may carry any
     CLDR category its language needs (`few`, `many`) or only `other` where the noun does
     not inflect. The "pairs every counted key" test becomes "every counted key has
     `.other` in English"; the six German pairs that write the same string twice drop
     their `.one`. The `Dictionary` type admits every CLDR category for a `PluralKey`
     base (`.few` is not an English key, so the type must say so, or a Polish dictionary
     cannot compile); a test pins that English and German answer exactly as before for
     0, 1 and 2 — the change shows only in a language whose rules differ (French:
     `select(0)` is `one`, which is the point). In `catalog.test.ts` nothing names `de`: completeness is asserted for
     every dictionary typed complete (a `COMPLETE` list in the test, `['de']` today), the
     identical-to-English allowlist is a per-language map, and the orphan and
     placeholder checks already run over `DICTIONARIES`. `CONTRIBUTING.md`'s "Adding a
     language" gains the plural sentence; `frontend_architecture.md`'s wording section the
     namespace, in one line each.
   - **The unused-key test** (I1, ≈40 lines): every key literal or computed-prefix
     reachable from a non-test source, with the computed prefixes and map-reached bases as
     the allowlist. Without it the two dead keys M3 deleted come back.
   - **The folds, by role.** A key is folded when two call sites name the same thing in
     the same role — a field's noun as a label (column header, sort field, editor label,
     facet tab, fact row), an action's accessible name (`Edit {name}` on a row, a tree
     node, a table row) — and kept when the role differs (a verb on a button against a
     noun in a caption, a sentence against a label, a progress line against a tab),
     **whatever the German says**. The `hv.field.*` namespace (I2: 13 keys replacing 28
     across `hv.column.*`, `hv.filter.sortField.*`, `hv.filter.dateNoun.*`,
     `hv.editor.field.*`, with `hv.column.quantity` = `Qty` and `hv.column.due_date` =
     `Due` kept as column overrides) and the remaining groups in the #542 comment's merge
     map, each re-judged by that rule (≈50 call sites). The 19 same-German groups are
     read and left, except `locationCreateFailed` (one event, two English sentences —
     keep one). The two `t()` literals (`hv-import-sheet.ts`'s "That is not valid JSON",
     `hv-organize-dialog.ts`'s "Create") become keys. `hv.diagnostics.copyReport` /
     `hv.import.copyErrors` stay (#580's reason: each names what it copies).
3. **"fix(card): accessible names and the conflict banner through the catalog"** —
   **closes #615** (two keys beside `hv.action.clearAll` — `Clear filter {label}`,
   `Remove {tag}` — in both languages, and a test that greps `src/` for an
   `` aria-label=${` `` followed by a capital letter and finds nothing), then **refs #540**
   as its own commit: the banner above the editor shows `hv.banner.conflict.heading`
   alone for a `conflict`, the way `ui/editor-error.ts` already drops the backend's
   "version conflict: expected 4, actual 5" inside the form — the numbers say nothing to a
   household, in any language.
4. **"feat(card): the built-in statuses in the reader's language"** — **closes #536**
   (§2 item 2). Card only. One helper, `statusLabel(def)` in `ui/status.ts`: for a slug
   in the built-in set whose stored label equals the English seed (the
   `BUILT_IN_STATUSES` mirror, which `tests/test_frontend_registration.py` keeps equal to
   `_SEED_STATUSES`), return `t('hv.status.<slug>')` — three new keys in both
   dictionaries — else the stored label; applied at every surface that renders a status
   label (the seven files §1.4 names). Three rules, each a test: **a renamed status shows
   as stored**, in every language; **the organize dialog's Statuses tab never writes the
   translation into the store** — an untouched field saves nothing, and the field shows
   the stored English (with the translation beside it) rather than the translation, so a
   German household that opens and closes the editor has not silently renamed three
   statuses for everyone; **the stand-in and the store agree**, so no chip changes its
   wording when `haventory/config` answers, in any language. Search is unaffected:
   `_item_matches_q` reads name, description, category, the location path and the tags,
   never a status label. The backend, the seed, the adopter and the export format are
   untouched.

No phacc. **Live checks the master runs** with the profile language set to Deutsch on an
English-server instance, then the reverse: the card and `/haventory` show *OK / Fehlt /
Reparatur nötig* (or the dictionary's words) for a fresh store, with no flicker; rename
one built-in in the organize dialog — it shows as renamed in both languages; open and
close the Statuses editor without changes — the store's labels are unchanged
(`haventory/config`); import an export taken before the rename — the built-ins come back
translated; the conflict banner from the `routeWebSocket` recipe shows the heading only;
a filter chip's × carries a German `aria-label`. Screenshots of both languages on the
assets branch, and the bundle size before and after in PR 2's body.

**Validate locally** (L1 walks it; L1 also produces the German review surface for #540 —
§6.L1): `[dev-ha]` `[browser]` the live-check list in German on the dev HA; `[German]`
the screens are the owner's to read, through #540.

### 6.L1 — local validation, the first: everything since the start

Start condition: M1–M5 merged (the rate-limiter PR by the owner), no V0.8.0 PR open.
Local session on the owner's host, Fable 5 at `xhigh`; it may spawn implementer
subagents for the defects it finds, one per defect, merged one at a time.

1. **Deploy `main` to the dev HA** on a clean store (the volume route), seeded through
   `import/execute` with a household-shaped inventory (the 0.7.0 closing pass's document
   or its like: German and English names, photos, custom statuses, check-outs,
   inspections, month-end reminders, the to-do bridge). Keep a 0.7.1 control container
   (the tag, port 8124) for every "did this change?" question.
2. **Every automated regimen**, stopping to file on the first red: both gates, phacc
   (Docker), every `stress.py` layer (minus `ratelimit` if the limiter went), the online
   WS smokes, the live-update smoke in Chromium and Firefox, `visual_pass.mjs` light and
   dark, the lifecycle probe, `log_sweep.py`.
3. **Every "Validate locally" block** from M1–M5's #236 comments, in order, recording the
   result beside each step in a comment on the PR it came from.
4. **The product as a household uses it**, desktop and 375 px, English and German, light
   and dark, with 0.7.1 as the control: add an item with a photo, search/filter/sort, the
   organize dialog's four tabs, bulk tag/untag, check-out and return, reminders and the
   calendar, every `haventory.*` service with its response, the to-do bridge, the sensors,
   Repairs with a hand-corrupted store, keyboard-only through the table and dialogs, a
   slow link, a dropped WebSocket, a forced two-tab conflict. The phone is the owner's
   (§2 item 7): collect every `[phone]` step the masters left into the handover's "Test
   this by hand", in one list.
5. **Fix what is found**: a defect that clears the bar is an issue (bug template,
   reproduction, screenshot) on V0.8.0 and a PR in the same session where the fix is
   small and obvious; the rest is filed. Judge the #585 question (are the first eight
   labels useful on a real household?) and file it or record "fine".
6. **The German review surface for #540**: the EN/DE table of every key that survived M5
   — card and integration, the 114 service-field strings from #593 included — and a
   German screenshot set (375 and 1920, light) of every surface, on the assets branch,
   posted as one comment on #540 with the table. The owner marks up in place; M7 applies.
7. **Restore** the dev HA's data and profile language and say so.

Handover: the six parts, with "Test this by hand" naming what only the owner can do
(`[German]` the #540 read, `[owner]` nothing else yet) and the round's comment on #236.

### 6.M6 — docs and CI, then the schema collapse

Five PRs, in order: the three docs PRs first so the docs describe the tree that ships,
the collapse last so it lands on a tree that has stopped moving. Start condition: L1
merged and closed what it found; no V0.8.0 PR open.

1. **"ci: retire the Scorecard badge and workflow; rework the badge row"** — **closes
   #497** to the letter of its "Done when": `scorecard.yml` deleted, the open Scorecard
   alerts dismissed over the API, the CodeQL badge dropped, the header row at four
   badges, the My HA button at the head of Installation, `HACS-Custom` kept. **#514**
   closed as not-planned in the same PR's comment, with the reason (§2 item 4: the
   secret is not added) — unless `gh secret list` shows it has appeared meanwhile, in
   which case it ships here instead.
2. **"docs: the status vocabulary is the household's; triggers are `trigger:`"** —
   **closes #331** (the sentence is in `docs/developing.md`'s architecture list), plus
   the sweep the README rewrite named and did not finish: the six `platform:` trigger
   examples (two in `README.md`, four in `docs/automations.md`) in Home Assistant's
   current `trigger:` spelling; `docs/developing.md`'s `--examples-config` claim removed
   with `scripts/reload_addon.sh`'s dead flag; `frontend_architecture.md`'s
   `haventory/cleanup` command that does not exist (it is a `connection.subscriptions`
   key); and whether the README's feature list says the status vocabulary is editable at
   all (#331's second note).
3. **"docs: one home per fact; scripts nothing calls"** — refs #230, #231. One home per
   duplicated passage: the gate block is written five times (`developing.md`,
   `CONTRIBUTING.md`, `CLAUDE.md`, `test-haventory/SKILL.md`, `frontend_architecture.md`)
   — keep it in `CONTRIBUTING.md` and `CLAUDE.md` and link from the other three; the
   bootstrap (four copies), the two test modes (four), the ".env wins over an inherited
   export" paragraph (ten) and the helper-script list (two) go to `docs/developing.md`.
   The stale claims the cuts left behind: the health line, the rate-limit references,
   `pendingOps` and `retry_after`, "three editor hosts" and the two-breakpoints passage;
   `dev/release_testing_plan.md`'s health oracle restated as counts. Scripts: delete
   `stress_test.py`, `ws_probe.py`, `ws_subscribe.py` (its `watch` moves into the skill's
   `driver.py` if not already there), `create_test_items.py`, `build_frontend.sh`,
   `test.sh`, `lint.sh`, `test_frontend.sh`, `test_online.sh`; keep `setup.sh` and
   `ci_local.sh`, the CI-used four, the brand renderer and `dev_env.py`;
   `probe_attachments.py`, `probe_fixtures.py` and `smoke_online.sh` wait for #276's
   validation run. `test_toolchain_pins.py` registers `setup.sh` and `test_frontend.sh`
   as Node-pin sites — it moves with every deletion, and is the proof. Check whether
   `labeler.yml` and the `labels` workflow still earn their place. Optional, if in there
   anyway: one `login.mjs` for the two copies of the `hassTokens` init script in
   `screenshot.mjs` and `probe.mjs` (#613).
4. **"feat(storage): collapse the schema to v1 with a one-release adopter"** — **closes
   #229** — **left open for the owner**, after L2's rehearsal. The issue's body, its
   2026-08-05 notes and its comments are the design; §1.4 lists where the tree has
   moved. `CURRENT_SCHEMA_VERSION = 1`; `migrations.py` becomes the driver (keeps
   `SchemaDowngradeError` for 0→1) plus `ADOPTABLE_SCHEMA_VERSIONS = frozenset(range(2,
   10))` and `adopt_dev_schema` folding the four backfills (statuses, seeded statuses +
   attachments, reminder nulls, the anchor) as idempotent `setdefault`s;
   `async_migrate_if_needed` adopts a store inside the set before it refuses what is
   above it; `import_export._parse_envelope` accepts the set (every export in the wild is
   stamped 9); the stored artifacts outside the payload (`haventory_todo_links`, entry
   options, a corrupt backup, the thumbnail tiles) are named in the PR body as untouched.
   Tests per the issue: clean install at v1; a store at each of 2–9 lands at v1 intact; a
   double load is equal; 10 is refused with the store untouched and `ConfigEntryError`; a
   v9 export imports; the repairs card still works on a v1 store. Two cases the issue
   does not name: **a store stamped 1 from the 0.1 era** is not today's v1 — it predates
   every backfill — and with `CURRENT = 1` it reads as current; since the backfills are
   `setdefault`s, run the adopter on every load at or below 9, including 1, and test "a
   v1-stamped store lacking `statuses` loads with the seeds". And **the refusal message**
   for a store above 9 must stay the downgrade one; after V0.9.0 deletes the adopter, a
   store stamped 2–9 (an old Home Assistant backup restored a year on) must be refused
   with a message that says "neither current nor adoptable — restore onto 0.8.x first",
   not "written by a newer schema" — that wording, and the fact that exports stamped 2–9
   stop importing (re-export on 0.8.x), go into the adopter-deletion issue's text.
   `test_migrations_offline.py`'s per-step tests become adopter tests;
   `tests/integration/test_schema_migration.py` is rewritten v9 → 1. Docs:
   `data_shapes.md`'s example envelopes and the three function names it cites, the
   contract's import section, the README's two lines, `release_testing_plan.md`'s
   D7/D8/E3/E4 restated against v1. **In this PR:** file the adopter-deletion issue
   (🔧 Task) into milestone V0.9.0 (§2 item 5; it exists): delete
   `adopt_dev_schema`, `ADOPTABLE_SCHEMA_VERSIONS` and the import-side exception. The
   release-notes text (in-place upgrade; take an export first as the way back) and the
   rehearsal protocol (#229's 2026-08-21 comment, item 1) go in the PR body.
5. **"refactor(import): validate a document through the models' validators"** — refs
   #230 (BE-MODELS-C2), stacked on PR 4 so `_parse_envelope` is edited once. A
   `caps=False` mode on the model validators and one `_collect(errors, path, fn, …)`
   helper replace the nine identical try/except blocks and the hand-written
   quantity/threshold/text/tag/custom-field checks; `_recompute_paths` uses
   `LocationPath.to_dict()`; the legacy dict-shaped entity list in `_coerce_entity_list`
   goes. Error paths and messages stay byte-identical — the import sheet renders them.
   Left open with PR 4, for the same merge.

phacc for PRs 4 and 5. **Live checks the master runs**: `test_docs_links_offline.py`,
`test_docs_contract_offline.py` and `test_toolchain_pins.py` green; the My HA button
resolves; one command from each SKILL.md recipe still works against the master's HA;
for PR 4, a store hand-stamped at 9 with the seeded household adopts on boot (the log's
one `warning` names 9 → 1), export → preview → import reports zero changes, a store
stamped 10 is refused and the Repairs card names it.

**Validate locally** (L2): `[owner]` a copy of the production store; `[dev-ha]` wipe the
dev HA (the volume route), restore the copy, deploy the collapse branch, boot; counts
before and after, spot-check ten items, an export diff showing only the metadata deltas
— #226's protocol; `[HA settings]` D7/D8/E3/E4 from `dev/release_testing_plan.md`;
`[owner]` read the README's Installation and Automations sections once more as a
stranger.

### 6.M7 — the German wording, from the owner's mark-up

One PR, one session, **Opus 5 at `xhigh`, no subagents** — the work is mechanical and
the judgement is already on the issue. Start condition: the owner has marked up #540's
review comment (L1's table) — rows changed in place, or a reply naming them.

**"fix(i18n): the German wording corrections"** — **closes #540**, **left open for the
owner**. Apply the mark-up: `de.ts` and `translations/de.json`, values only;
`catalog.test.ts` holds the placeholders and the per-language allowlist (a value the
owner made identical to the English joins it, on purpose); the component tests that
assert German strings (`hv-list-row`, `hv-item-editor`, `hv-bulk-bar`,
`hv-organize-dialog`, `columns`, `plural`, `relative-time`, `media`) are updated to the
new value, never loosened. An EN/DE table of every changed row in the PR body. The three
word choices the issue settles first (`Gegenstand`, `Ort`, `Label`) change only if the
mark-up says so, and then everywhere.

No phacc. **Validate locally** (L2): `[browser]` the German screenshot set again, beside
L1's; `[German]` the owner reads the diff table — what is still wrong is a comment on the
PR, which the session amends before the owner merges.

### 6.L2 — local validation, the second: the docs, the collapse rehearsal, the wording

Start condition: M6's docs PRs merged, its collapse PR (with PR 5 stacked) open and CI
green, M7's PR open if the owner's mark-up existed in time. Local session, Fable 5 at
`xhigh`.

1. M6's and M7's "Validate locally" blocks, in order: the docs' live links and recipes;
   the German set beside L1's; then the collapse rehearsal on the owner's store copy
   (§6.M6 PR 4's block), and D7/D8/E3/E4 against v1. Every result beside its step in a
   comment on the PR.
2. What the rehearsal finds is the collapse PR's to fix — comment with the exact store
   shape that misbehaved, and stop on that PR; nothing else in the milestone waits.
3. Restore the dev HA and say so. Handover with "Test this by hand": `[owner]` merge the
   collapse PR and, after the release, the watch window (#229 step 5, with the exit
   condition its 2026-08-21 comment states).

### 6.Z — the online regression, jank and usability pass (Fable 5, local)

Start condition: the collapse PR is merged (after the owner's go and L2's rehearsal),
#540's PR is merged, every V0.8.0 issue is closed or re-milestoned with a reason, no
Dependabot PR is open against the milestone; release-please's 0.8.0 PR may be open but
**is not merged**.

The session is the 0.7.0 closing pass again, against a tree that has lost a fifth of its
backend and a tenth of its card: a clean, realistic instance seeded through
`import/execute`; every automated regimen the repo has, stopping to file on the first
red; the product driven the way a household uses it at desktop and 375 px, English and
German, light and dark — with **0.7.1 as the control** and the question for every screen
"does anything look or behave differently, and was that intended by a §6 package?"; then
D7/D8/E3/E4 against v1 if L2 left them open.

Outputs: every finding is an issue (bug template, reproduction, screenshot), milestoned
V0.8.0 if it should ship in 0.8.0, V0.9.0 if it is the clean candidate's, otherwise
unmilestoned or not filed; a small, obvious, test-covered fix ships as its own PR; the
closing comment on #236's V0.8.0 line sums the counting tables from every PR body; the
V0.7.1 milestone is closed if it is still open (it has no open issues); the last PR
deletes `dev/V0_8_0_implementation.md` and `.claude/agents/v080-implementer.md`.

Handover hand-tests: `[phone]` the card on a real phone in the companion app — add an
item with a photo, search, check out, the organize dialog; `[German]` the whole product
once in German; `[owner]` the production store after the 0.8.0 upgrade (counts,
spot-checks, export diff) and the watch window's start.

## 7. Why the order is what it is

- **One subagent per PR, in sequence within a lane**: every backend PR after M1's second
  runs on the stub it rewrites; M1's op table is what its index PRs and M2's field rules
  edit; M3's dead-code removal is what M4 rewrites less of; M4's discard PR is what makes
  its workspace PR a fold rather than a merge of two half-identical halves. A stacked
  branch would carry every later PR's risk into the earlier one's review.
- **The master reviews and the subagent implements** because the review is where a
  subtraction milestone goes wrong — a "refactor" that quietly changes an answer — and
  the reviewer should not be the author.
- **The rate limiter last in M2, the collapse last in M6, the wording its own session**:
  the three owner-merged PRs sit where nothing stacks on them.
- **M5 after M1–M4**: #542's folds retarget call sites M3 and M4 have just moved, and
  M1's health cut and M2's limiter cut delete keys M5 would otherwise fold; landing the
  folds after means each call site moves once.
- **L1 after M5, not after M4**: one local session then covers every code change in the
  milestone and produces the German review surface from the consolidated set — the
  owner reads the screens once, not twice.
- **M7 after L1**: the German is corrected from the owner's read of finished screens,
  which is what the owner asked for, and the consolidation has already removed the rows
  that would have been reworded twice.
- **M6 after L1**: the docs describe the tree that ships, including L1's fixes; the
  collapse lands on a tree that has stopped moving, per #229's own rule; the rehearsal
  is the owner's store and is L2's.
- **Two masters side by side only across lanes**: the card sessions never touch a
  backend file; the three PRs that cross check before opening; everything else is
  disjoint, and a second master costs the owner one paste.

## 8. The prompts

Each prompt is pasted as the first message of a new session. Before pasting: set the
model and effort named on the first line, and start the session where the first line
says (the web, or the owner's host for L1, L2 and Z).

### 8.S — the subagent contract (what `.claude/agents/v080-implementer.md` carries)

The agent definition in the repository fixes the model (`opus`), the effort (`xhigh`),
the worktree isolation and the standing rules; the master's spawn message adds only the
package: *"You are implementing PR n of §6.Mk of `dev/V0_8_0_implementation.md`: <the
PR's title>. Read §5 and §6.Mk of that file, then the issue comment named there, then
CLAUDE.md and CONTRIBUTING.md. Branch `claude/v0-8-0-<package>-<topic>` off
`origin/main`."* The definition tells the subagent to provision its worktree (`uv sync`;
`npm ci` when it touches the card), work offline, run both gates before every commit and
phacc before the PR opens where §5 requires it, open the PR with the template and the
six-part handover in its body, watch CI to green, and return — as its last message, and
nothing else — this report:

```
PR: <url>  branch: <name>  issue: <Closes/Refs #NNN>
Commits: <one line each>
Counting: production removed <n> · tests removed <n> · added <n>   (git diff --stat)
Gates: backend <pass/fail> · frontend <pass/fail> · phacc <pass/fail/not required> · CI <green/red/pending>
Decisions against drifted notes: <one line each, or none>
Follow-ups: <named, with "filed #NNN" or "not filed: <reason>">
Validate locally: <numbered, tagged steps with expected results, or "nothing — pinned by <test>">
Open questions for the master: <or none>
```

It never merges, never touches the master's Home Assistant, and never opens a second PR.

### 8.M1

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M1 of the V0.8.0 plan, dev/V0_8_0_implementation.md in this
repository — read it in full first (§3, §5, §6.M1 and §8.S are yours), then CLAUDE.md and
CONTRIBUTING.md. Start condition: release-please's 0.7.1 PR has merged (`git log` shows
the release commit) and no V0.8.0 PR is open. If the condition fails, stop and say what
you found.

First, prove the Home Assistant recipe in §3: boot it, onboard it, add the HAventory
entry, open the card through the live-update smoke. Record the outcome, the boot time and
any change the recipe needed as the first paragraph of your #236 comment.

Then the nine PRs of §6.M1 in order, one subagent each through the repository's
`v080-implementer` agent (§8.S), one at a time: for each, spawn, read the report, review
the diff in full under §3's rules, run the live check §6.M1 names on your HA, merge when
§5's merge rule holds, delete the branch, and only then spawn the next. A rejected report
goes back to the same subagent once with your findings; a second rejection means you take
the branch over and say so. Issue #230's 2026-08-22 comments carry the file-by-file lists;
grep for the symbol, never the line.

End with the six-part handover of §5 as your last message and as a comment on #236, with
the union of the PRs' "Validate locally" blocks.
```

### 8.M2

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M2 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in
full (§2 items 1 and 6, §3, §5, §6.M2, §8.S), then CLAUDE.md and CONTRIBUTING.md, then
M1's comment on #236 (the HA recipe's outcome and its handover). Start condition: M1's
nine PRs are merged and no backend PR is open. §2 item 1 is decided: the limiter is
deleted, not shrunk.

Re-run §3's HA recipe in your environment. Then the seven PRs of §6.M2 in order, one
subagent each, one at a time, under §3's review and §5's merge rule. PR 7 (the rate
limiter) opens only when no card PR touching src/store/store.ts, src/ui/banners.ts or
src/i18n/ is open; bring it to everything green with the options-form and card evidence
from your HA in its body, write the handover, and **stop — the owner merges that PR.**

End with the six-part handover as your last message and as a comment on #236.
```

### 8.M3

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M3 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in
full (§3, §5, §6.M3, §8.S), then CLAUDE.md and CONTRIBUTING.md, then whatever M1 has
posted on #236 (if M1 has not run, prove §3's HA recipe yourself and report it). Start
condition: release-please's 0.7.1 PR has merged and no card PR is open. A backend master
may be running beside you — its files are not yours; every subagent branches from
origin/main at the moment it starts.

The four PRs of §6.M3 in order, one subagent each, one at a time, under §3's review and
§5's merge rule. PR 4 changes the subscription opener: its evidence is the `two_tab`
recipe on your HA or a `card-smoke.yml` run dispatched against the branch
(`gh workflow run card-smoke.yml --ref <branch>`), and the PR merges with that evidence
and its "Validate locally" block in the body. Issue #231's 2026-08-22 comments carry the
lists; grep for the symbol, never the line.

End with the six-part handover as your last message and as a comment on #236.
```

### 8.M4

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M4 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in
full (§2 item 3, §3, §5, §6.M4, §8.S), then CLAUDE.md and CONTRIBUTING.md, then M3's
comment on #236. Start condition: M3's PRs are merged and no card PR is open.

Re-run §3's HA recipe. Then the six PRs of §6.M4 in order, one subagent each, one at a
time. Every one is user-visible: run §6.M4's live check on your HA at both widths and
both themes with before/after captures on the assets branch, look at the captures, and
merge under §5 with the "Validate locally" block filled in — L1 walks it later; nothing
waits open. Every per-surface test id and class is a parameter (§5). The 2026-08-22
comments on #231 (FE-SHELLS, FE-DIALOGS, FE-LISTS) carry the lists.

End with the six-part handover as your last message and as a comment on #236.
```

### 8.M5

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M5 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in
full (§2 item 2, §3, §5 — the "nothing German-specific" convention in particular —
§6.M5, §8.S), then CLAUDE.md and CONTRIBUTING.md, then M2's and M4's comments on #236.
Start condition: M1–M4 merged, the owner has merged the rate-limiter PR, and no PR
touching src/i18n/ or strings.json is open.

Re-run §3's HA recipe. Then the four PRs of §6.M5 in order, one subagent each, one at a
time: the retry-after reader (skip and say so if the limiter was shrunk, not deleted);
#542 — plural categories, the folds by role, the unused-key test; #615 and the conflict
banner's detail; #536, the built-ins translated on display, per user — the store stays
English (§2 item 2 says why seeding was withdrawn). This session rewords no
German: the wording is the owner's, after L1. Run the German live checks on your HA with
screenshots; put the bundle size before and after in PR 2's body.

End with the six-part handover as your last message and as a comment on #236.
```

### 8.L1

```
Model: Fable 5, effort xhigh. Local session, on the owner's host with the dev Home
Assistant.

You are local validation session L1 of the V0.8.0 plan, dev/V0_8_0_implementation.md —
read it in full (§3, §5, §6.L1), then CLAUDE.md, CONTRIBUTING.md and
dev/release_testing_plan.md, then every V0.8.0 comment on #236 (M1–M5's handovers and
their "Validate locally" blocks). Start condition: M1–M5 merged, no V0.8.0 PR open.

Do §6.L1's seven steps in order: deploy main on a clean seeded store with a 0.7.1
control; every regimen; every "Validate locally" block, each result in a comment on the
PR it came from; the product as a household uses it at both widths, both languages, both
themes, and on the phone; fix what clears the bar (one implementer subagent per defect,
merged one at a time) and file the rest; post the German review surface for #540 — the
EN/DE table of the surviving keys and the screenshot set — as one comment on #540; restore
the dev HA.

End with the six-part handover as your last message and as a comment on #236.
```

### 8.M6

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M6 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in
full (§2 items 4 and 5, §3, §5, §6.M6, §8.S), then CLAUDE.md and CONTRIBUTING.md, then
L1's comment on #236. Start condition: L1 has merged what it fixed, and the only open
milestone issues are #229, #497, #514, #331, #540 (M7's) and whatever L1 filed for Z.

Re-run §3's HA recipe. Then the five PRs of §6.M6 in order, one subagent each, one at a
time: the three docs/CI PRs merged under §5 (the backend gate run on every README edit);
then the collapse PR — everything green, the release-notes text and the rehearsal
protocol in its body, the adopter-deletion issue filed into the V0.9.0 milestone — and
PR 5 stacked on it; write the handover and **stop — the owner
merges PRs 4 and 5 after L2's rehearsal.**

End with the six-part handover as your last message and as a comment on #236.
```

### 8.M7

```
Model: Opus 5, effort xhigh. Cloud session. No subagents.

You are session M7 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read §5 and §6.M7,
then CLAUDE.md and CONTRIBUTING.md, then issue #540 in full: its body, its tables, and
the owner's mark-up on L1's review comment. Start condition: the mark-up exists; M5's
PRs are merged; no PR touching src/i18n/ or translations/ is open.

One PR: apply the mark-up to de.ts and translations/de.json, values only, with the
component tests that assert German strings updated to the new values and never loosened;
an EN/DE table of every changed row in the PR body. Bring it to everything green, write
the handover, and **stop — the owner merges this PR.**

End with the six-part handover as your last message and as a comment on #236.
```

### 8.L2

```
Model: Fable 5, effort xhigh. Local session, on the owner's host with the dev Home
Assistant and a copy of the production store.

You are local validation session L2 of the V0.8.0 plan, dev/V0_8_0_implementation.md —
read it in full (§3, §5, §6.L2, §6.M6 PR 4's "Validate locally"), then CLAUDE.md,
CONTRIBUTING.md and dev/release_testing_plan.md, then M6's and M7's comments on #236 and
issue #229's 2026-08-21 comment. Start condition: M6's docs PRs merged, its collapse PR
open and green, M7's PR open if it has run.

Do §6.L2's steps: every "Validate locally" block from M6 and M7, each result in a
comment on its PR; the collapse rehearsal on the owner's store copy in a wiped dev HA —
counts before and after, ten spot checks, the export diff — and D7/D8/E3/E4 against v1;
what fails is a comment on the collapse PR with the exact store shape, and you stop on
that PR. Restore the dev HA and say so.

End with the six-part handover as your last message and as a comment on #236.
```

### 8.Z

```
Model: Fable 5, effort xhigh. Local session.

You are session Z of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§6.Z, §5), then CLAUDE.md, CONTRIBUTING.md and dev/release_testing_plan.md. Start
condition: every V0.8.0 issue is closed or re-milestoned with a reason, every V0.8.0 PR
including the collapse and the wording is merged, no Dependabot PR is open against the
milestone; release-please's 0.8.0 PR may be open and is not merged.

Deploy main to a clean dev Home Assistant and spend the whole session finding what is
wrong with it, with 0.7.1 as the control: the regimens, then the product as a household
uses it, in the order and with the priorities §6.Z gives. File every finding that clears
CLAUDE.md's bar; ship a fix only when it is small, obvious and test-covered. Close with
the comment on #236 that sums every PR's counting table, close the V0.7.1 milestone if it
is still open, and open the PR that deletes dev/V0_8_0_implementation.md and
.claude/agents/v080-implementer.md.

End with the six-part handover.
```

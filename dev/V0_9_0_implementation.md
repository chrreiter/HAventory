# V0.9.0: session plan

Status: **planned** (2026-09-01, tree at `0dab75b`, the 0.8.1 release). Assigns the
milestone's seven issues to three master sessions, one local validation session and the
validation run; states the rules each runs under; fixes the model each runs on; and ends
with the paste-ready prompt each is started from (§8). This plan lands with its own PR,
which also adds `.claude/agents/v090-implementer.md`.

**The milestone in one sentence:** the clean candidate, the schema-collapse adopter
deleted one release after it did its job (#668), the tree swept once more for comments and
dead weight before strangers read it (#684–#687, filed from the 2026-09-01 audit), the
Dependabot backlog cleared, then the 0.9.0 release, the validation run (#276) against it,
and the measured scale ceiling (#277) off F3's pass. What this milestone is for is fixed by
#236's stage 6: the HACS tag is cut from what ships here, so this is the last tree state
that is private. Nothing lands in V0.9.0 that is not on that list; a new feature would
re-open the shape the collapse closed.

**How the work runs** (§3 has the rules): one **master session** at a time (a Claude Code
session, cloud by default, on **Fable 5 at `xhigh`**) spawns one **subagent per pull
request** through the repository's own agent definition,
`.claude/agents/v090-implementer.md`: **Opus 5 at `xhigh`, in its own git worktree**, with
the rules of §5 and the return shape of §8.S built in. The master reviews every diff, runs
the live check on its own Home Assistant, merges, and starts the next. The local sessions
(L1 and V) run on the owner's host against the dev Home Assistant, on Fable 5 at `xhigh`,
and may spawn the same implementer subagents for the defects they find, one per defect.

The owner's total involvement, by design:

1. **Pre-flight** (§2): six decisions; four have a recommended verdict written in, two
   need the owner's own state (production's upgrade, the brands artwork).
2. **Paste one prompt per session**: five pastes: M1, M2, M3, L1, V.
3. **Read each handover** (the last message of the session and its comment on #236) and
   run its hand-test list.
4. **Merge release-please's 0.9.0 PR** after L1.
5. **Be present for the validation run**: the production store copy (or the backup
   emergency kit) for ENV-D, the phone for group B, the production instance for ENV-A, and
   the go/no-go on each finding's patch.
6. **After V**: flip the repository public and proceed with #196; the submission is
   V1.0.0's, not this plan's.

Delete this file, and `.claude/agents/v090-implementer.md` with it, in V's closing PR; a
plan left behind reads as pending work (`CONTRIBUTING.md` → "a plan document is deleted in
the pull request that ships the work it describes").

---

## 1. What the analysis found

Four read-only audits of the tree at `0dab75b` (2026-09-01), one per area, each instructed
with the house rules ("comments encode constraints, not history"), the V0.8.0 keep-list
(§1.3) and #668's claims as guardrails, and each claim verified against the code before it
was written down. The findings are filed as **#684 (backend), #685 (tests), #686 (card),
#687 (docs/process)**; the file-by-file lists with dispositions are the 2026-09-01 comments
on those issues. Line numbers there are from `0dab75b`: **grep for the symbol, never the
line.**

### 1.1 The shape of the tree today

| | lines | audit found removable |
| --- | ---: | ---: |
| backend `custom_components/haventory/` (26 modules) | 13,539 | ≈250 (comments and small probes; no subsystems left) |
| backend `tests/` | 33,939 | ≈1,350 (~650 whole files/tests, ~700 mechanical) |
| card `cards/haventory-card/src/` (incl. specs and dictionaries) | 61,012 | ≈420 (~150 production, ~270 test) |
| docs + `dev/` + `scripts/` + skills + `.github/` | ≈13,100 + workflows | 18 verified stale claims, 3 second-home violations, residue |

V0.8.0 removed the subsystems (9,693 production and 7,748 test lines over 42 PRs); what the
audits found is the residue that pass could not see: prose, not machinery. The pattern is
consistent across areas: the newest code is the cleanest, and the slop concentrates in the
oldest layers (`repository.py`'s index paths, `test_storage_offline.py`'s first half, the
online smoke) and in what #231's greps structurally missed (spec-file preambles, CSS
comments, wording that dodges the grep).

### 1.2 Where the weight is

- **Backend (#684).** No dead subsystems: ~35 restating comments in `repository.py`'s
  index and location-write paths, ~30 label-only banners, a handful of history paragraphs,
  two comments that are factually wrong about the card (the `manual` kind "awaiting its
  card surface" that shipped in v0.4.0), one provably dead branch, eight
  `getattr(entry, "options", …)` probes, the hand-written sort constants beside the
  TypedDict they restate, and `import_export`'s private reach into repository indexes.
- **Tests (#685).** Four files that test nothing (`test_bulk_operations_offline.py`
  simulates the bulk API around single calls and asserts on its own lists; the two
  "performance" files claim to observe index behaviour no assertion can see, one confessing
  it in a comment; `test_smoke_offline.py` asserts imports), a tautological assertion
  (`assert X in ([], X)`), a monkeypatch on a discarded object, 66 copies of a three-line
  setup `ws_hass()` already replaces, 112 async decorators on tests that never await, ~98
  banner blocks, and the online smoke's `phase0`/`test_p2_*` naming pointing at a deleted
  plan.
- **Card (#686).** The copy-id widget written three times one function short of the shared
  module that should own it; pixel-measured debugging logs in `hv-full-view.ts`'s CSS
  comments; ~100 lines of PR-body prose in spec preambles (#231 swept sources, not specs);
  six specs re-running the lightbox suite against its host; three dead test helpers, two
  unbound `@property` knobs, one unread token, and a `vite.config.ts` key Rollup ignores.
- **Docs/process (#687).** The documented gate weaker than CI (`npm audit` level),
  CLAUDE.md claiming the public release "ships as v1.0.0" against its own tracker and
  citing closed #231 as pending, `dev/release_testing_plan.md` denying the event bus the
  README leads with and listing eleven of twelve services, five ledger references
  CONTRIBUTING forbids by name, a `.gitignore` that is ~200 lines of GitHub template with
  17 duplicate lines, and two personal-machine artifacts in the skills.

### 1.3 What was deliberately not taken, so nobody re-derives it

The audits ran with V0.8.0's keep-list and confirmed it; these stay, and a session that
finds them again records nothing:

- The Lovelace resource loader beside `add_extra_js_url` (HA Cast); `serialization.py`;
  the to-do bridge's own `Store`; `calendar_projection.py`; the desktop in-place editor
  expander; the card's mirror of the backend's size caps; the category combobox's chevron;
  `test_repo_hardening_offline.py`; the cross-language pins and the three drift sweeps
  (`test_min_ha_version.py`, `test_toolchain_pins.py`,
  `test_release_version_consistency.py`); the single-bundle i18n.
- `const.py`'s section banners (each heads a real constraint paragraph; the rule is
  "label-only banners go", not "banners go").
- Verified clean and not to be re-swept: `ops.py`, `media.py`, `calendar_projection.py`,
  `runtime.py`, `logs.py`, `repairs.py`, `subscriptions.py`, the translation trees, the
  card's i18n layer (every key reached), `store/ws.ts`, `store/types.ts`,
  `hv-card-shell.ts`, all 15 `scripts/` (every one referenced), the workflows, the label
  and ruleset configs.
- `services.async_persist_repo` stays as a wrapper (only its "exposed for tests" docstring
  goes); `migrate()` and the `SchemaDowngradeError` guard stay; they are the forward path
  and the second line of defence, per #668 itself.

### 1.4 The issues' text against the tree

- **#668** holds as written; re-checked at `0dab75b`. The six test files it names for the
  `max(ADOPTABLE_SCHEMA_VERSIONS) + 1` stamp all still carry it; the adopter tests are
  where it says. One addition the issue implies but does not spell: the Repairs card
  renders the refusal's `{error}` sentence, so the new 2–9 wording surfaces there too;
  the live check reads it on the card, not only in the log.
- **#276**'s body still says the candidate is `v0.8.x` (its 2026-08-06 restaging); the
  milestone assignment has moved it once more: the candidate is **`v0.9.x`**, per #236's
  stage 6/7, the run validates what the tag is cut from, and ~2,000 lines leave the tree
  in this milestone. Its implementation notes (2026-08-05 comment) remain the program;
  the plan-document retarget it asks for is #687's release-testing-plan PR (§6.M3), which
  lands before V starts.
- **#277** is unchanged: one README edit, off F3's measured number, nothing else.
- **#684–#687** were filed from this analysis and carry their own acceptance; the sessions
  read the issue comment, not this plan, for the cut lists.

## 2. Owner pre-flight

Decisions that would otherwise stop a session mid-way. Items 1 and 2 were **decided on
2026-09-01**; item 4 needs the owner's own state; 3, 5 and 6 carry a recommended verdict a
session may assume unless the owner says otherwise before M1 starts.

1. **Decided: confirmed.** Production crossed to v1 on 0.8.x (the owner's word,
   2026-09-01, recorded on #236). #668's premise, that the adopter shipped in a build the
   owner actually runs, holds, and **M1 may start**. The reasoning stays for the record:
   the deletion is safe only after the owner's own store has been read once by 0.8.x
   (`Adopting … from_version=9 to_version=1`; the dev instance crossed on 2026-08-30).
2. **Decided and done (2026-09-01): four of the Dependabot six were pulled for v0.9.0,
   two wait for after the HACS release.** Taken from each PR's CI and failure logs (all
   six are dev-scope; the evidence is in the 2026-09-01 comment on #236) and executed the
   same day, **after M1 and M2 had merged, before M3**, rather than inside M3 where the
   first draft put them.

   Ideally they would have gone in ahead of the sweeps: these are the linter, the
   formatter and the test DOM the swept code is judged by, and a bump landing afterwards
   asks a fresh ruff and a fresh eslint to re-judge ~2,000 freshly rewritten lines on a
   tree whose review is over. That was checked rather than assumed: both gates were run
   on the combined result (backend 1,359 passed, ruff 0.16.4 / format / mypy clean;
   frontend 2,042 passed, eslint clean under the new jsdom), and nothing the sweeps
   wrote falls foul of the newer rules. What was done:
   - **#665** (codeql-action 4.37.7 → 4.37.9) and **#653** (the card-deps group: seven
     minor/patch bumps, eslint, typescript-eslint, vitest, vite, playwright, coverage),
     every check green, no change needed. **Merged** (`8ce193c`, `006ebee`).
   - **#657** (the python-dev group): 1,407 tests passed; the only two failures were the
     pin sweep itself, since Dependabot moved ruff 0.16.3 → 0.16.4 in `pyproject.toml` and
     `requirements-dev.txt` but not the two copies `test_toolchain_pins.py` also
     enumerates. **Merged with a companion commit** aligning `.pre-commit-config.yaml`'s
     hook rev and the lint command in `test-haventory/SKILL.md`; the backend gate then ran
     clean on ruff 0.16.4 (1,409 passed, format and mypy clean).
   - **#654** (jsdom 26 → 30): 2,014 of 2,015 tests passed; the failure was
     `hv-overflow-menu.test.ts`'s two `:scope > …` lookups, which jsdom 30 answers with
     `null`. **Merged with a companion commit** reading the children directly instead.
     Worth recording: only one of the two assertions failed; the other, "no direct-child
     `.meta`", had turned into a test that would pass whatever the row rendered, so the
     bump exposed a silently dead assertion rather than merely breaking a working one.
     `:scope` appears nowhere in production code; the whole blast is in that one spec.
   - **#655** (typescript 6.0.3 → 7.0.2): **waits.** `npm ci` fails with ERESOLVE:
     `@typescript-eslint` peer-requires `typescript >=4.8.4 <6.1.0`, so the toolchain
     refuses TS 7 before a test runs and nothing in-repo fixes that honestly. **Closed**,
     with a dependabot ignore rule for typescript majors carrying the lift condition:
     typescript-eslint declaring support for 7.
   - **#656** (@types/node 22 → 26): **waits.** The typings would describe a runtime
     newer than the card supports (`engines` floors at `^22.13.0 || >=24`, CI runs a 22/24
     matrix) and `tsc` already rejects them (TS2550 `.at()` lib errors). **Closed**, with
     the matching ignore rule; it lifts with a deliberate Node-floor bump, which moves
     `engines`, the CI matrix and `test_toolchain_pins.py` together.

   Both ignore rules are scoped to `semver-major`, so minor and patch releases of either,
   and a security update for either, still open a pull request. Left for the owner: none;
   no Dependabot PR was open when M3 started.
3. **Repository visibility. Recommended: flip after V, with #196.** The sweep exists so
   the first public read happens after it lands; the earliest sensible flip is after M1–M3
   merge, and #236 stage 7 puts it at the HACS release. Flipping earlier costs the sweep
   nothing once M1–M3 are merged; the owner chooses the moment.
4. **The brands PR (#196's first half).** CI still runs the HACS action with
   `ignore: brands`, so it is not merged; whether it is *filed* is outside this
   repository's view. If it is not, file it when V0.9.0 starts; it runs on an external
   review timeline and the artwork (`brand/` renders) is the owner's to approve. Not a
   session's job beyond the reminder.
5. **The validation run's inputs. Recommended: prepare during L1.** V needs what L2
   could not get on 2026-08-30: a readable copy of production's
   `.storage/haventory_store` (or the backup emergency kit; the OneDrive backups are
   encrypted placeholders, ~160 s to hydrate), the phone with the companion app for group
   B and H6, and ENV-A time on the production instance. The L2 session's kit
   (`rehearse.sh` and friends) lives in its session scratchpad and is re-scriptable from
   its #236 handover if the scratchpad is gone.
6. **#277's hardware framing. Recommended: ENV-A.** The ceiling is measured on the
   owner's production hardware during F3, and the README names that hardware beside the
   number. A number measured on the dev container would be the same extrapolation problem
   in different clothes.

## 3. Master sessions, subagents, and the Home Assistant recipe

**A master session** is a Claude Code session started from one pasted prompt, on the web
by default, in a fresh Linux checkout. It runs on **Fable 5 at `xhigh`**: its job is to
review every diff against the subtraction rule, run the live checks and merge, and a wrong
merge costs more than a subagent's tokens. It spawns **one subagent per PR** through
`.claude/agents/v090-implementer.md` (added by this plan's PR): **Opus 5 at `xhigh`, in
its own git worktree**, with the rules of §5 and the return shape of §8.S built in. The
master holds the session's Home Assistant, runs each PR's live check on it, and never
edits a subagent's branch itself unless the subagent has failed twice; then it fixes by
hand and says so.

**What a subagent does, and does not.** It reads §5 and its §6 package (one Read of this
file, not the whole of it), the 2026-09-01 comment on its issue (the cut list), and
CLAUDE.md / CONTRIBUTING.md; provisions its worktree (`uv sync`, `npm ci` when it touches
the card); works offline; runs both gates before every commit and phacc where §5 requires
it; opens the PR with the template filled in; watches CI; and **returns the report of §8.S
and stops**. It never merges, never touches the master's HA, never opens a second PR. A
subagent whose report the master rejects gets one follow-up message in the same worktree;
after a second rejection the master takes the branch over.

**The master's review**, before any merge: the full diff read against the subtraction rule
(no behaviour change without its own commit and test; tests deleted or moved, never
rewritten to pass); the counting table against `git diff --stat`; CI green including the
`integration` job; the live check §6 names, run on the master's own HA; and the subagent's
follow-ups read, not skimmed; one that names a gap in the PR's own work goes back to the
subagent, one that names a real-world defect is filed, the rest go into the handover.

**The blank Home Assistant a master stands up itself**: proven twice in V0.8.0 (M1's and
M8's #236 comments, 2026-08-30, carry the details); the recipe with the four recorded
fixes:

```bash
# uv first: the image's bare `--python 3.14` resolves to an rc build the HA pin refuses.
pip install -U uv                      # 0.12.7+ knows Python 3.14.7
PIN=$(grep -E '^homeassistant==' requirements-integration.txt)
FE=$(grep -E '^home-assistant-frontend==' requirements-integration.txt)
uv venv /tmp/ha --python 3.14 && uv pip install --python /tmp/ha/bin/python "$PIN" "$FE"
mkdir -p /tmp/ha-config/custom_components
ln -s "$PWD/custom_components/haventory" /tmp/ha-config/custom_components/haventory
(cd cards/haventory-card && npm ci && npm run build)
# minimal configuration.yaml + the extra wheels per M1's comment on #236
/tmp/ha/bin/hass -c /tmp/ha-config --skip-pip >/tmp/ha.log 2>&1 &
until curl -fsS -o /dev/null http://localhost:8123/; do sleep 3; done
uv run python scripts/ci_provision_ha.py --base-url http://localhost:8123   # prints HA_TOKEN
HA_BASE_URL=http://localhost:8123 HA_TOKEN=<token> HAVENTORY_IGNORE_ENV_FILE=1 \
  uv run python scripts/ws_init_haventory.py
(cd cards/haventory-card && npx playwright install --with-deps chromium)
# Playwright may need the 1194-build bridge symlinks (M1's comment); stop and start hass
# in separate commands: a compound pkill+start loses the start (M2's gotcha).
```

The symlink serves the checkout's own `custom_components/haventory`; to check a branch,
check it out in the master's own clone (the subagent's worktree is not the served tree). A
master that cannot stand the HA up says so in every affected PR body ("no cloud HA; L1
step n") and merges on the rest of the evidence.

**When validation is local.** A PR merges on the master's evidence when the change is
behaviour-preserving by test or exercised by phacc or the live check, which in this
milestone is every PR except #668's, whose refusal wording is user-visible: it merges too,
with its "Validate locally" block filled in, and L1 walks the block. Nothing waits open
for a local session; the two owner-state gates are pre-flight item 1 (before M1) and the
release merge (after L1).

## 4. The map

```
M1  backend + tests: the adopter deletion (#668); the backend      4 PRs   cloud, Fable 5 master
    sweep (#684); the test suite's dead files, then its            (+ re-proves the HA recipe)
    scaffolding (#685)
M2  card: the copy-id fold; the dead surface; the comment          3 PRs   cloud   (may run beside M1)
    and spec-preamble sweep (#686)
M3  docs/process: the wrong claims; one home per fact and          3 PRs   cloud   (after M1 and M2)
    the residue; the release-testing-plan rows (#687)
L1  local: deploy main, every regimen, the "Validate locally"              local, Fable 5
    blocks; then the owner merges release-please's 0.9.0 PR
V   the validation run (#276) against v0.9.x per                            local, Fable 5
    dev/release_testing_plan.md; findings ship as v0.9.x
    patches; #277 off F3's pass; the closing PR deletes
    this file and the agent definition
```

Serial order: **M1, M2, M3, L1, V.** M2 may run beside M1; the card sessions touch no
backend file and every subagent branches from `origin/main` at the moment it starts. M3
runs after both: its skills PR restates test counts the M1 cuts change, and its
CLAUDE.md/CONTRIBUTING edits should land on the swept tree. Ten planned PRs plus six
whatever L1 and V ship. A session starts when the previous one in
the order has merged everything.

## 5. Rules every session follows

Everything from the V0.8.0 plan carries over: branch discipline
(`claude/v0-9-0-<package>-<topic>` off `origin/main`), Conventional-Commit PR titles, TDD,
the gate before every commit, "issues are read, not rewritten", the PR body as the review
record, the six-part handover repeated as a comment on #236, the Follow-ups bar
(an issue only when it can matter in the real world), with these changes and additions.

**The subtraction rule, again.** #684–#687 are cut PRs: no behaviour change, tests deleted
or moved, never rewritten to pass; a deleted test names its keeper (the issue comments
already do). The behaviour changes in this milestone are exactly two, #668's refusal
wording and the import-side refusal, and each is **its own commit with its own test and
refs its own issue**.

**The gate, before every commit.**

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check . && uv run ruff format --check . && uv run mypy
cd cards/haventory-card && npx eslint . && npm run typecheck && npx vitest run && npm run build
```

**phacc** (`scripts/test_integration.sh`; build the card first) is required before a PR
opens for any PR touching `custom_components/` or `tests/integration/`; in this milestone that is
M1's PRs 1, 2 and 4. CI's `integration` job runs it again.

**Counting.** Every cut PR's body carries the three-line table: production lines removed,
test lines removed, lines added, `git diff --stat` numbers, not estimates. V sums them in
its closing comment on #236.

**Conventions that bite in this milestone specifically.**

- **The stored payload does not move.** Nothing here changes what `serialize_state`
  writes; #668 deletes a read-side amnesty. A session that finds itself editing the write
  path stops and reports.
- **The acceptance greps are the acceptance.** #684's narration greps over
  `custom_components/`, #686's four #231 greps plus `previously|used to|no longer` over
  `src/` including `*.test.ts`; a PR is not done while they return new hits. Run them in
  the PR, paste the residue (expected false positives only) in the body.
- **A rewritten comment states the constraint, not a shorter history.** The test of a
  rewrite: delete the sentence and ask what a maintainer would break; if the answer is
  "nothing", delete rather than rewrite. Where the issue comment says "keep the
  constraint", the constraint is usually the last sentence of the block.
- **Wrong-count fixes drop the count.** "The five names" becomes "the fixed vocabulary",
  "~30 glyphs" becomes no number; a count in prose is the next stale claim.
- **Refusal messages are backend exception text** (English, like the downgrade text
  today); the Repairs card wraps them in its translated title and body. #668 changes the
  sentence, not the mechanism; the mixed-language Repairs body was seen by L2 and is the
  owner's call, out of scope here.
- **Dictionaries are edited by nobody.** No i18n key moves in this milestone; #686's fold
  keeps every `data-testid`, class and key as-is. A session that needs a new key has left
  the milestone's scope and says so.
- **Dependabot and release-please PRs are never touched.** The six open at the start of
  the milestone were resolved after M1 and M2 merged and before M3 (§2 item 2); anything
  Dependabot opens while the milestone runs waits for the owner, so no session merges a
  dependency bump under a sweep it is in the middle of reviewing.
- `tests/test_min_ha_version.py`, `test_toolchain_pins.py` and
  `test_release_version_consistency.py` stay exactly as they are.

## 6. The sessions

### 6.M1 (backend and tests): the adopter's exit, then the sweep

Four PRs, in order. Start condition: the owner has confirmed on #236 that production runs
0.8.x and its store crossed to v1 (§2 item 1); release-please's 0.8.1 PR is merged and no
V0.9.0 PR is open. The master proves the HA recipe (§3) before spawning the first
subagent.

1. **"feat(storage): delete the schema-collapse adopter and the import-side exception"**,
   **closes #668**. The issue's body is the design and is current (§1.4). Three deletions:
   `adopt_dev_schema` with its frozen literals; `ADOPTABLE_SCHEMA_VERSIONS` and the
   amnesty branch (with its `_LOGGER.warning`) in `DomainStore.async_migrate_if_needed`;
   the `sv not in ADOPTABLE_SCHEMA_VERSIONS` half of `import_export._parse_envelope`'s
   check. Two behaviour changes, each its own commit with its own test: **the store
   refusal** for a stamp in 2–9 says what is true (neither current nor adoptable; install
   0.8.x, let it read the store once, come back), while a stamp above
   `CURRENT_SCHEMA_VERSION` keeps the downgrade wording; **the import refusal** for a
   document stamped 2–9 says to open it on 0.8.x and export again. Tests per the issue:
   the six files naming `max(ADOPTABLE_SCHEMA_VERSIONS) + 1` go back to
   `CURRENT_SCHEMA_VERSION + 1`; the adopter tests and the fill assertions go; the
   drivers, the downgrade guard and the refusal cases survive, plus one case per new
   wording; a store stamped 0 (no `schema_version` key) still loads; that is the forward
   path through `_normalized`, not amnesty. Docs in the same PR: `data_shapes.md`'s
   import-error list, the contract's import section, `developing.md`'s storage line, the
   README's "Upgrading an install from before 0.8.0" paragraph (removable now), and
   `release_testing_plan.md`'s D8/E4/H5 losing the two-directions wording.
2. **"refactor: the backend's comments say the constraint or nothing"**: **closes #684**.
   The 2026-09-01 comment on #684 is the cut list, grouped by disposition. Code cuts as
   their own commits: the dead "Defensive:" branch, the unused `enumerate`, the eight
   `getattr(entry, "options", …)` probes, `storage.py`'s stub-shaped `getattr`,
   `serialization.py`'s probe, the derivation of `SORT_FIELDS`/`SORT_ORDERS`/`SORT_KEYS`
   from `Sort`, `import_export`'s public accessors and the annotation of its callback
   parameters. Prose cuts as prose commits. The two wrong `manual` comments go; the module
   docstrings of `repository.py`, `models.py`, `__init__.py` are rewritten to their traps.
   Acceptance: the narration greps return nothing new over `custom_components/`.
3. **"test: delete what tests nothing"**: refs #685. The four files
   (`test_bulk_operations_offline.py`, `test_repository_performance_offline.py`,
   `test_repository_location_performance_offline.py`, `test_smoke_offline.py`), the
   assertions that cannot fail, the duplicated tests with keepers named in the comment,
   and the online smoke's tautologies, dead helpers and skip-swallowing log test. Before
   deleting the two "performance" files, confirm the two location-move cases add nothing
   over `test_repository_move_reindex_offline.py`; fold them if they do.
4. **"test: one setup, one mark, and comments that pin instead of narrate"**: **closes
   #685**. The mechanical half: `ws_hass()` everywhere (66 sites), the no-op store
   assignments, the async decorators on sync tests (112), one `requires_online` mark in
   the online helpers, `item_event_ids` / `_dfs` / the purges defined once, `_repo_of`
   gone, the banner blocks and restating comments, the Arrange/Act/Assert residue, the
   "Scenarios:" lists trimmed to their constraint sentences, the WP4 story and the ~30
   past-tense docstrings rewritten present-tense, the `phase0`/`test_p2_*` names renamed
   by behaviour. Acceptance: the suite is green with the same or better runtime and no
   invariant lost its pin.

phacc for PRs 1, 2 and 4. **Live checks the master runs** on its HA: for PR 1, a store
hand-stamped 5 refuses on boot with the new wording, and the Repairs card shows that
sentence; a store stamped `CURRENT + 1` refuses with the downgrade wording; a store with
no stamp loads; an import document stamped 9 refuses with the re-export wording; a clean
install lands at v1. For PRs 2–4, reload the entry twice; nothing at ERROR carrying
`haventory`; one `haventory.*` service round-trips; `stress.py baseline` if standing.

**Validate locally** (L1 walks it): `[dev-ha]` deploy `main` over the dev HA's v1 store,
boots clean, no repairs issue; `[dev-ha]` restore any pre-0.8.0 dev-era store copy (L2's
`inputs/` had a v2 and a v4), refused with the "install 0.8.x first" wording in the
Repairs card; `[browser]` import of a v9-stamped export refused with the re-export
message; `[log]` nothing at ERROR carrying `haventory`.

### 6.M2 (card): the fold, the dead surface, the sweep

Three PRs, in order. Start condition: release-please's 0.8.1 PR merged, no card PR open. A
backend master may run beside this one; its files are not yours.

1. **"refactor(card): the copy-id widget lives in ui/clipboard.ts"**: refs #686. The
   flash-state controller (`_copiedId` / `_copiedTimer` / `_clearCopied` / `_copyId`) and
   an `idRow` css fragment move into `ui/clipboard.ts`; the editor, organize dialog and
   detail sheet adopt it; `ui/attachments.ts` gains the css fragment it stopped short of
   (`.doc-icon`). One spec against the controller; one integration assertion per surface;
   the twelve duplicated specs go. Every `data-testid` and class is a parameter and stays
   byte-identical; the browser harnesses under `.claude/skills/` locate them.
2. **"refactor(card): the surface nothing binds"**: refs #686. `ownCss`,
   `pendingIntervalCount`, `pendingTimeoutCount` (and `ownCss`'s row in CONTRIBUTING's
   helper list); `cancelLabel`, `maxSuggestions` inlined; `--hv-warn-border`;
   `triggerDownload` un-exported; `vite.config.ts`'s `codeSplitting` and `external: []`
   verified against the pinned Rollup, then cut; `eslint.config.js`'s six labels and the
   stray comma.
3. **"docs(card): comments state the rule; specs state the behaviour"**: **closes #686**.
   The CSS debugging logs in `hv-full-view.ts` and `hv-overflow-menu.ts` cut to their
   constraints; `ui/plural.ts`'s and the three shared-module headers' used-to/now openings
   rewritten present-tense; the ~100 lines of spec-preamble prose across six spec files
   rewritten as the rule each assertion defends; the six duplicated lightbox specs deleted
   (the two sheet-specific ones stay); the small stales (`dispose()`'s JSDoc,
   "load-bearing", the `store.ts` fragment, the two banner boxes normalised). Acceptance:
   the four #231 greps plus `previously|used to|no longer` return only documented false
   positives over `src/` including `*.test.ts`.

No phacc. **Live checks the master runs**: after PR 1, the card, the full view and
`/haventory` render; the copy-id button on all three surfaces copies and flashes
(`two_tab` not needed; no subscription shape moves); after PR 3, the frontend gate and
build with the bundle size unchanged (±1 kB) in the PR body.

**Validate locally** (L1): `[browser]` copy an item id from the editor, the detail sheet
and the organize dialog, the flash appears and reverts on each; nothing else should have
changed on any surface.

### 6.M3 (docs and process): the claims, the homes, the residue

Three PRs, in order. Start condition: M1 and M2 merged (the
skills PR restates test counts M1 changes), no V0.9.0 PR open.

1. **"docs: the plan tests what ships"**: refs #687, refs #276. The
   `dev/release_testing_plan.md` rows only: I3 rewritten to trigger on
   `haventory_item_changed` / `haventory_low_stock` and `calendar.haventory` and pass when
   the automation fires; I1 counts twelve services with `reminder_bump`; G3 verifies the
   README's documented no-admin-gating behaviour instead of asking the decided question;
   C3 reworded around `watchConnectionGaps` (the un-refetched items are the half worth
   keeping); the superseded ~200 ms figure; the five `item NN` ledger tokens. First so V's
   program is correct however the milestone's tail moves.
2. **"docs: what the tree says, said once"**: refs #687. The wrong claims: the audit
   level (`moderate`, one home in CONTRIBUTING), six→seven version files with the lockfile
   row, CLAUDE.md's v1.0.0 sentence and the #231 clause and the six missing modules,
   `frontend_architecture.md`'s five stales and the design-canvas passage (with its twin
   in `ui/icons.ts`), the `statuses` topic in `data_shapes.md`, the `0.0.1` examples, the
   Pillow comments in `pyproject.toml` and the brand renderer, the README hard-refresh
   line, the `@v7` claim, the fixture size measured once. The homes: the gate block in
   CONTRIBUTING with links from CLAUDE.md and the PR template (which gains `npm audit`);
   `developing.md`'s card catalogue cut to what a developer needs; the import rule's third
   copy. The backend gate runs before any README edit is believed.
3. **"chore: residue a stranger notices"**: **closes #687**. The `.gitignore` rewrite
   (keep the hand-written tail and the ~30 needed lines; `/roadmap` goes); the bug
   template's `0.8.1` placeholder; `card-smoke.yml`'s "until now" clause; `stress.py`'s
   "Robust,"; the skills' two personal-machine lines de-personalised and the
   Windows/Git-Bash apparatus stated once (§2's framing: the maintainer's host drives
   Docker from Git Bash; WSL2 is the supported path) or dropped; the subagent proposes
   from the read; `installing.md`'s trailing `---`; `session-start.sh`'s bootstrap
   pointer; the `op_id` and #507 corrections in the two SKILL.md files and
   `frontend_architecture.md`.

No phacc. **Live checks the master runs**: `test_docs_links_offline.py`,
`test_docs_contract_offline.py`, `test_docs_examples_offline.py` and the backend gate
green; the README rendered once on the branch (the badges resolve).

**Validate locally** (L1): `[browser]` the README and `docs/installing.md` read once as a
stranger, the install steps agree with each other; nothing else is user-visible.

### 6.L1: local validation, then the release

Start condition: M1–M3 merged, no V0.9.0 PR open. Local
session on the owner's host, Fable 5 at `xhigh`; implementer subagents for what it finds,
one per defect.

1. **Deploy `main` to the dev HA** (the store is v1 since 2026-08-30). Run every automated
   regimen, stopping to file on the first red: both gates, phacc (Docker), every
   `stress.py` layer, the online WS smokes, the live-update smoke, `visual_pass.mjs` light
   and dark, the lifecycle probe, `log_sweep.py`.
2. **Every "Validate locally" block** from M1–M3's #236 comments, in order, each result
   recorded beside its step in a comment on the PR it came from, the refusal wordings on
   real old stores above all.
3. **The product, briefly, as a household uses it**: this milestone changed two refusal
   sentences and a clipboard widget, so the walk is one pass at both widths and both
   languages, with the copy-id flash and the import-refusal wording as the only new
   things to see.
4. **Prepare V's inputs** (§2 item 5): the production store copy or the emergency kit,
   confirmed readable; the 0.8.1 control container; the plan-document row check (M3 PR 1
   landed).
5. **Fix what clears the bar, file the rest.** Then the handover, and the owner merges
   **release-please's 0.9.0 PR**. The tag build's `haventory.zip` is what V installs.

### 6.V: the validation run, and the close

Start condition: v0.9.0 is released, L1's handover is on #236, the owner is available for
the ENV-A/ENV-D/phone parts. Local session on the owner's host, Fable 5 at `xhigh`. This
session **is** #276: `dev/release_testing_plan.md` in full, scenario groups A–J on ENV-A
(production), ENV-B (throwaway Docker), ENV-C (the `hacs.json` floor image), ENV-D (backup
restore), the six exit criteria, the group-J soak last. The issue's 2026-08-05
implementation-notes comment is the program (what is automated, what is manual, the
smoke-script warning for ENV-A); the expected-output notes there and in the 2026-08-06
comment (core's `file_upload` blocking-call warning) are triage rules, not findings.

- **Findings ship as patches**: one issue (bug template, impact-rated) and one PR each,
  as `v0.9.x` releases, re-running affected scenario rows until the plan is clean. The
  Results log fills one row per attempt.
- **A1** (HACS custom-repository install) closes the verification half of #196. **F3**
  produces the measured ceiling on ENV-A hardware; **#277** is the one README edit that
  replaces the extrapolation with that number, its own PR off the F3 pass.
- **Done** when all six exit criteria pass with no open finding above Minor. Then the
  close: the counting comment on #236 summing every V0.9.0 PR's table; #276 and #277
  closed; the V0.9.0 milestone closed; and the closing PR, which **deletes this file and
  `.claude/agents/v090-implementer.md`**.
- The J1 soak is seven days: start it once everything else is clean, keep the session's
  check-ins daily, and do not hold the closing PR for it if the owner wants the flip
  earlier, the soak's exit is #276's, and the issue stays open on it alone.

Handover hand-tests: `[owner]` flip the repository public when ready (§2 item 3) and
proceed with #196's submission, V1.0.0's milestone, a new session, not this plan's;
`[phone]` group B and H6 during the run itself; `[German]` one pass during group A.

## 7. Why the order is what it is

- **#668 first, in M1's first PR**: it is the milestone's reason to exist, its wording is
  the only behaviour change, and everything after it edits prose. If pre-flight item 1
  fails, the whole milestone waits on the owner's upgrade, and knowing that on day one
  costs nothing.
- **The test deletions (PR 3) before the test folds (PR 4)**: folding setup into files
  that are about to be deleted is motion for nothing.
- **M2 beside M1, M3 after both**: the card sweep shares no files with the backend; the
  docs sweep restates counts and claims the code sweeps change, so it lands on the tree
  it describes.
- **The release-testing-plan rows first in M3**: V executes that document; its rows must
  be right before anything else competes for attention.
- **The Dependabot six out of M3**: they move the linter, the formatter and the test DOM,
  which makes them inputs to the sweeps rather than housekeeping after them: the earlier
  they land, the fewer freshly rewritten lines a new rule can surprise. In the event they
  went in between M2 and M3, once the sweeps had already merged, so the combined result
  was gated explicitly instead of assumed (§2 item 2). Two of the four earned their keep
  on the way in: the ruff bump needed two more pin sites than Dependabot can see, and
  jsdom 30 exposed an assertion that had been passing for the wrong reason.
- **L1 before the release, V after it**: L1 validates the tree the tag is cut from; V
  validates the released artifact through the install path a stranger uses, the same
  split #276's restagings kept insisting on.
- **The closing PR in V**: the plan describes work that is done only when the validation
  run is clean; deleting it earlier would leave the run without its program, later would
  leave a plan lying around after the milestone closed.

## 8. The prompts

Each prompt is pasted as the first message of a new session. Before pasting: set the model
and effort named on the first line, and start the session where the first line says.

### 8.S: the subagent contract (what `.claude/agents/v090-implementer.md` carries)

The agent definition fixes the model (`opus`), the effort (`xhigh`), the worktree
isolation and the standing rules; the master's spawn message adds only the package: *"You
are implementing PR n of §6.Mk of `dev/V0_9_0_implementation.md`: <the PR's title>. Read
§5 and §6.Mk of that file, then the 2026-09-01 comment on issue #NNN, then CLAUDE.md and
CONTRIBUTING.md. Branch `claude/v0-9-0-<package>-<topic>` off `origin/main`."* The
definition tells the subagent to provision its worktree, work offline, run both gates
before every commit and phacc before the PR opens where §5 requires it, open the PR with
the template and the handover in its body, watch CI to green, and return, as its last
message, and nothing else, this report:

```
PR: <url>  branch: <name>  issue: <Closes/Refs #NNN>
Commits: <one line each>
Counting: production removed <n> · tests removed <n> · added <n>   (git diff --stat)
Gates: backend <pass/fail> · frontend <pass/fail> · phacc <pass/fail/not required> · CI <green/red/pending>
Greps: <the package's acceptance greps and what they still return, or "not required">
Decisions against drifted notes: <one line each, or none>
Follow-ups: <named, with "filed #NNN" or "not filed: <reason>">
Validate locally: <numbered, tagged steps with expected results, or "nothing, pinned by <test>">
Open questions for the master: <or none>
```

It never merges, never touches the master's Home Assistant, and never opens a second PR.

### 8.M1

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M1 of the V0.9.0 plan (dev/V0_9_0_implementation.md in this
repository); read it in full first (§2 item 1, §3, §5, §6.M1 and §8.S are yours), then
CLAUDE.md and CONTRIBUTING.md, then issue #668 in full and the 2026-09-01 comments on #684
and #685. Start condition: the owner has confirmed on #236 that production runs 0.8.x and
its store crossed to v1; release-please's 0.8.1 PR is merged; no V0.9.0 PR is open. If any
part fails, stop and say what you found.

First, prove the Home Assistant recipe in §3 (M1's and M8's 2026-08-30 comments on #236
carry the recorded fixes). Record the outcome as the first paragraph of your #236 comment.

Then the four PRs of §6.M1 in order, one subagent each through the repository's
v090-implementer agent (§8.S), one at a time: for each, spawn, read the report, review the
diff in full under §3's rules, run the live check §6.M1 names on your HA, merge when §5's
merge rule holds, delete the branch, and only then spawn the next. A rejected report goes
back to the same subagent once with your findings; a second rejection means you take the
branch over and say so. The issue comments carry the file-by-file lists; grep for the
symbol, never the line.

End with the six-part handover of §5 as your last message and as a comment on #236, with
the union of the PRs' "Validate locally" blocks.
```

### 8.M2

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M2 of the V0.9.0 plan (dev/V0_9_0_implementation.md); read it in
full (§3, §5, §6.M2, §8.S), then CLAUDE.md and CONTRIBUTING.md, then the 2026-09-01
comment on #686. Start condition: release-please's 0.8.1 PR is merged and no card PR is
open. A backend master may be running beside you, and its files are not yours; every subagent
branches from origin/main at the moment it starts.

The three PRs of §6.M2 in order, one subagent each, one at a time, under §3's review and
§5's merge rule. PR 1 keeps every data-testid, class and i18n key byte-identical; the
browser harnesses under .claude/skills/ locate them. PR 3's acceptance is the greps over
src/ including *.test.ts; the bundle size before and after goes in its body.

End with the six-part handover as your last message and as a comment on #236.
```

### 8.M3

```
Model: Fable 5, effort xhigh. Cloud session. Master.

You are master session M3 of the V0.9.0 plan (dev/V0_9_0_implementation.md); read it in
full (§2 items 2 and 4, §3, §5, §6.M3, §8.S), then CLAUDE.md and CONTRIBUTING.md, then the
2026-09-01 comment on #687 and M1's and M2's comments on #236. Start condition: M1 and M2
merged, no V0.9.0 PR open.

The three PRs of §6.M3 in order, one subagent each, one at a time: the release-testing-
plan rows first, and the backend gate run before any README edit is believed. The Dependabot
six were resolved after M1 and M2 merged, before you start (§2 item 2); Dependabot and
release-please PRs are not yours.

End with the six-part handover as your last message and as a comment on #236.
```

### 8.L1

```
Model: Fable 5, effort xhigh. Local session, on the owner's host with the dev Home
Assistant.

You are local validation session L1 of the V0.9.0 plan (dev/V0_9_0_implementation.md);
read it in full (§3, §5, §6.L1), then CLAUDE.md, CONTRIBUTING.md and
dev/release_testing_plan.md, then every V0.9.0 comment on #236. Start condition: M1–M3
merged, no V0.9.0 PR open.

Do §6.L1's five steps in order: deploy main to the dev HA; every regimen, stopping to file
on the first red; every "Validate locally" block, each result in a comment on the PR it
came from, the refusal wordings on real old stores above all; the short product pass;
V's inputs prepared (§2 item 5). Fix what clears the bar (one implementer subagent per
defect, merged one at a time) and file the rest. Restore the dev HA and say so.

End with the six-part handover as your last message and as a comment on #236, then the
owner merges release-please's 0.9.0 PR.
```

### 8.V

```
Model: Fable 5, effort xhigh. Local session, on the owner's host, with the owner
reachable for ENV-A, ENV-D and the phone.

You are session V of the V0.9.0 plan (dev/V0_9_0_implementation.md); read it in full
(§6.V, §5), then dev/release_testing_plan.md in full, then issue #276 with its
2026-08-05 and 2026-08-06 comments, then CLAUDE.md, CONTRIBUTING.md and L1's comment on
#236. Start condition: v0.9.0 is released and L1's handover is posted.

Execute the plan document in full, ENV-B, ENV-C, ENV-A, ENV-D, the group-J soak last,
recording every attempt in the Results log. Each finding is an issue and its own v0.9.x
patch PR, re-running affected rows until clean. A1 closes #196's verification half; F3's
measurement lands as #277's README edit, its own PR. When all six exit criteria pass with
no finding above Minor: the counting comment on #236, #276 and #277 closed, the V0.9.0
milestone closed, and the closing PR that deletes dev/V0_9_0_implementation.md and
.claude/agents/v090-implementer.md.

End with the six-part handover, its hand-tests naming what remains the owner's: the
public flip and #196's submission.
```

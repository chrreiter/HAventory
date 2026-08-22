# V0.8.0 — session plan

Status: **planned** (2026-08-22). Assigns the milestone's issues to fourteen sessions in
two lanes, states the rules each session runs under, fixes the model each one runs on,
and ends with the paste-ready prompt each session is started from (§8). The issues'
implementation notes are the design where they are still right; where the tree has moved
under them, §1 says what was measured and §6 says what the session does instead, and the
session records the rest in its PR body.

Baseline: `main` after the 0.7.0 release — S11 of the V0.7.0 plan has merged its five
PRs (#555–#557, #561, #564) and filed #559, #560, #562 into this milestone; only
release-please's 0.7.0 PR (#491) was open when this plan was written, and it merges
before A1 starts. The analysis in §1 was measured at `b878bfe`; S11's later edits touch
`hv-full-view.ts` and three skill harnesses and move nothing the analysis relies on —
**grep for the symbol, never the line.**

**The milestone in one sentence:** subtraction with the behaviour held still, the schema
collapsed to v1 at the end, and the small defects and wording found on the way fixed in
the same files the cuts touch. The measured target is roughly **3,000 backend and 2,700
card production lines** removed (≈21 % and ≈10 %), plus about 3,500 test lines and the
rate limiter's 900 lines of documentation and harness, with no user-visible change that
§2 has not put in front of the owner first.

What changed in the process since V0.7.0, in one line each (the rest is in §3):

- **Sessions run in the cloud** and hand over to a local session only when validation
  needs the dev Home Assistant, a browser on a real dashboard, a phone, or a German
  reader. Each session's package says which, and the handover carries a "Validate
  locally" block a local session can run from one paste.
- **Two lanes.** Backend (A) and card (B) have almost no shared files; they can run as
  two concurrent cloud sessions. §4 gives the serial order for running one at a time.
- **A subtraction PR that turns a test red is a defect in the cut** (owner, 2026-08-06).
  The fixes staged here (#559, #560, #565–#568) ride the session whose cut touches
  their file and are their own commits, so the rule still reads cleanly per commit.

The owner's total involvement, by design:

1. **Pre-flight, once** (§2) — eleven decisions, most of them a yes to a recommendation.
2. **Paste one prompt per session** — fourteen pastes (plus the local validation pastes
   the handovers ask for; §5 counts them at four to six).
3. **Read each handover** and run its hand-test list.
4. **Merge three PRs the sessions leave open on purpose**: the rate-limiter removal
   (A5), the German wording corrections (B5), and the schema collapse (A7 — the issue
   says "owner's explicit go", and it still does).
5. **Merge release-please's 0.8.0 PR** after Z has finished.

Delete this file in Z's closing PR — a plan left behind reads as pending work.

---

## 1. What the analysis found

Twelve read-only measurements of the tree at `b878bfe` (one per subsystem, 2026-08-22),
each checked against #229, #230, #231 and #542. The reports' evidence is file:line on that
commit; the numbers below are counted ranges, not guesses, and the PR that makes a cut
records the actual count. Full cut lists with their evidence are comments on #230, #231
and #542 (dated 2026-08-22).

### 1.1 The shape of the tree today

| | production | tests | comment share |
| --- | ---: | ---: | ---: |
| backend `custom_components/haventory/` (26 modules) | 14,469 | 27,380 offline + 4,805 phacc | 36–75 % in the lifecycle modules |
| card `src/` (non-test, incl. 1,779 lines of dictionaries) | 28,287 | 26,777 | 17 % overall; 28 % of `components/` + `ui/` is CSS |
| docs `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/*.md` | 3,842 | — | — |
| scripts + skills (tracked files) | 5,290 + 6,941 | — | — |

Test-to-production is 2.2 on the backend and 0.95 on the card; the outliers are the rate
limiter (241 lines, a 593-line test), storage (the debounce tests) and
`test_frontend_registration.py` (1,089 lines, ten of whose tests have a phacc twin).

### 1.2 Where the weight is

**Backend.** Four things account for most of what can go, and none of them is a feature:

1. **Two implementations of every mutation.** `services.py` re-implements the twelve
   operations `ws.py`'s `_op_item_*` table already carries (handler for handler, e.g.
   `service_reminder_bump` ≡ `ws_reminder_bump`, `service_location_update` ≡
   `ws_location_update` including the moved/renamed/counts decision), and six `ws_item_*`
   handlers are inline twins of their own table entry. 28 handlers persist; 11–12 are
   table-shaped. The same field list is then written nine times (two TypedDicts, two
   voluptuous schemas per surface, the bulk whitelist, the import field list). Measured
   difference that the collapse closes: bulk `item_delete` never unlinks attachment files
   (#565), and `item/update` types `tags` as `object` with no list guard beneath it (#567).
2. **Machinery with no production caller or one that exists for the test stub.** The
   debounced-persist path (`async_request_persist`: zero callers, ≈110 lines + ≈395 test
   lines built to test it); the stub-compat branches (≈100 production lines across
   `__init__.py`, `ws.py`, `services.py`, `areas.py` — the whole of `areas.py` exists
   because the offline stub's `area_registry.async_get` is `async`; five of the probes
   are already dead against today's stub); the manifest readers that duplicate
   `INTEGRATION_VERSION` (54); the `/local/…` legacy resource path that no tagged release
   ever served (10); two unreachable schema checks after `store.async_load()` (22).
3. **Indexes the scan already makes redundant.** The text index (249 lines) is a
   pre-filter in front of `filter_items`, which applies `_item_matches_q` to every
   candidate anyway and is declared the contract; the index already falls through to the
   scan for short and punctuation-only queries. The index-health subsystem (233 backend
   + ≈170 card lines incl. 76 dictionary lines) hunts drift between those indexes; every
   issue it can raise names a repository bug, which makes it a test oracle, not a product
   feature — and two of its sixteen codes have no card message today.
4. **The rate limiter**: 241 lines, nine options, off by default, and ≈2,300 lines around
   it (config flow, three translation files, a docs page, the card's banner and retry
   hint for a `retry_after_ms` the backend never sends, a 473-line skill harness, a
   593-line test).

Smaller but real: five hand-written parent-chain walks in `repository.py`; the
create/update validation written twice (and the caps rule four times); `filter_items`
evaluating all sixteen predicates per item; `migrations.py` at 253 lines of which 82 are
code (#229 reduces it to a driver and one adopter, ≈190 lines).

**Card.** The duplication is structural, not dead code:

1. **Two workspaces.** `hv-card-shell` (1,219) and `hv-full-view` (2,333) each implement
   the item workspace — editor hosting, pinned row, detail sheet, check-out popover, row
   events, discard prompt — about 400 lines twice, beside the ≈300 lines of filter chrome
   #231 item 2 names (stat pills, search box, staged-filter footer, panel/chips bindings).
   Three hand-rolled `matchMedia` watchers do what `ViewportNarrow` already does; the
   Store/theme lifecycle is copied between `index.ts` and the panel.
2. **Dialog chrome written five times** (backdrop/wrap/panel CSS and markup in organize,
   import, confirm, column picker, diagnostics), the quick-day-offsets widget twice
   (editor, check-out popover), the location-picker disclosure four times, the attachment
   strips twice, the discard confirm three times privately beside the shared
   `HostSurfaces.confirm`. `hv-item-editor` is 2,917 lines of which 962 are CSS and ≈850
   are attachments.
3. **Dead plumbing** wider than #231 says: the whole selection mode of `hv-list-row`
   (unreachable — `hv-list`'s one host binds none of it), `fill`/`skeletonRows`, five
   `WSClient` methods, `pendingOps`, `forceMobile`, and a `retry_after` reader for a hint
   nobody sends.
4. **Dictionaries**: 719 keys; two unread, 61 removable by folding 42 groups whose English
   and German are both identical onto one `hv.field.*` namespace (23 of the 61 are only
   reachable through computed prefixes, which is why the namespace is needed, not only
   nice). The bundle is 710 kB, 83 kB of it dictionaries; a per-language split is not
   worth a second served file (I5 in the #542 comment).

**Tests and docs.** The offline stub re-implements `panel_custom`'s registry in 60 lines
to support ten tests whose phacc twins run on every PR; fourteen phacc files carry the
same six-line `_setup`; three online smokes carry the same four helpers; the harness has
tests of its own (≈430 lines) that hundreds of other tests would fail first. The docs
repeat the gate in five places and the two test modes in four (§6.D1 carries the
measured list); `scripts/` holds 2,100 lines nothing calls any more — `stress_test.py`
(superseded by the skill's `stress.py`, whose docstring says so), `ws_probe.py` and
`ws_subscribe.py` (the skill's `driver.py`), `create_test_items.py` (seeding goes through
`import/execute`), `build_frontend.sh` (no caller at all) and four `.sh` wrappers only the
docs mention; none of the `.sh` wrappers is used by CI.

### 1.3 What was deliberately not taken, so nobody re-derives it

- **The Lovelace resource loader** (188 lines beside `add_extra_js_url`): its only stated
  reason is HA Cast, which ignores `extra_js_url`. A real cost for a real household. Keep.
- **The desktop in-place editor expander** (`editorTemplate`/`editorEpoch`, ≈110 lines):
  removing it moves the form above the list on a desktop card. A product change, not a
  subtraction. Keep, unless §2 item 4 says otherwise.
- **The card's mirror of the backend's size caps** (`ui/item-form.ts`, 58 lines + 130
  test lines): deleting it turns an inline field error into a Save-time banner. Keep.
- **A native `<datalist>` for the category combobox**: the editor's own comment records
  why the chevron exists. Keep the control; stop it floating (§6.B4).
- **`test_repo_hardening_offline.py`** (491 lines on rulesets, Dependabot blocks, cron
  slots): CI policy the owner asked for in #210. Keep.
- **`serialization.py`, the to-do bridge's own `Store`, `media.py`'s empty directories,
  `calendar_projection.py`**: each measured and found justified (the #230 comment says
  why per file).
- **A language-split bundle** (#542's "not in scope"): ≈11 kB gzipped per language against
  a second served path and a flash of English on every German load. No.
- **`tn()` falling back to `.other`** (#542 item 4): there is no such fallback to decide;
  `t()` falls through to English. The four "identical halves" pairs are all `hv.health.*`
  and go with the health cut.

### 1.4 The issues' text against the tree

Recorded as comments on the issues; the short version, so a session is not surprised:

- **#230** item 1's "0.012 s at 10 k items vs a 0.5 s budget" cites a benchmark test no
  longer in the tree; A3 re-measures before it deletes. Item 2's subsystem is `health.py`
  (175) + accessors, not "≈120 lines in `ws.py`", and `ws_location_list/tree` reach the
  same debug accessor in production. Item 4 is 28 persisting handlers, not 12. Item 6 is
  ≈100 lines and a `conftest.py` + `ws_helpers.py` rewrite, not four sites. Item 7's
  "one bucket, three options" leaves ≈900 lines of plumbing; deletion is the honest cut
  (§2 item 1). Item 10's list misses the class docstring in `repository.py` that states the
  opposite of the `location_path` invariant.
- **#231** item 2 undercounts by the workspace layer (§1.2); "`_onEditorSave` differs by
  `_editorError`" is stale (both set it); "banner rendering" is already shared. Item 3
  undercounts the dead selection chain. Item 4's "promise-unwrap helper in `ws.ts`" has
  no target left; the real twin is the subscribe unwrap. Item 5's two store specs overlap
  by three cases, not hundreds of lines. Item 1's three greps find 12 real sites across
  `src/` and miss seven narrative blocks a fourth grep catches (§6.B1).
- **#229**: the adoptable set is 2–9 and every export in the wild is stamped 9, so the
  import-side amnesty is not optional; there is no literal "9" in `strings.json` (the
  number is interpolated); only two test files name a migration step, the rest import the
  constant and survive.
- **#542**: every number checks out; "61 removable" is true only with the `hv.field.*`
  step (56 without); the backend's 87 keys are all reachable; two `t()` literals
  (`hv-import-sheet.ts`, `hv-organize-dialog.ts`'s bare "Create") are missing from it.
- **#333**: nothing in the tree does what the issue's option 2 describes — the size of the
  fix today is zero lines of existing code; A6 takes option 2.
- **#331**: the sentence it quotes left the README in #547's rewrite and now lives in
  `docs/developing.md` ("a stored per-item status — `ok` / `missing` / `needs_repair`");
  D1 fixes it there.
- **Docs that name what is not there**: `docs/frontend_architecture.md` describes a
  `haventory/cleanup` command that does not exist (it is a `connection.subscriptions`
  key); `docs/data_shapes.md`'s example envelopes say `schema_version: 4` against a
  current 9 (A7 makes them 1); the skills' SKILL.md files quote test counts "as of
  v0.3.1". D1 and A7 own these.

## 2. Owner pre-flight (before pasting A1 or B1)

Decisions that would otherwise stop a session mid-way. Each has a recommendation; "yes"
to all eleven is a valid answer and the prompts in §8 assume it.

1. **The rate limiter: delete it (recommended), or shrink it to one global command
   bucket with three options.** Measured: deletion removes ≈471 backend, ≈120 card,
   ≈147 docs, ≈907 test and ≈661 skill lines, and with it the `rate_limited` error code,
   the options section (collapsed and off by default today), the health/diagnostics
   counters and the card's "Rate limited" banner. A household that turned it on loses
   the limit; stale option keys are ignored. Shrinking keeps ≈900 lines of plumbing for a
   feature whose only known callers are two skill scripts. The PR is left open for the
   owner either way.
2. **Seed the three built-in statuses in the server's language** (`hass.config.language`
   at first store write) — recommended for #536, and the same rule #562 needs for the
   calendar summaries. An existing store keeps its English seeds (the organize dialog
   renames them); a household whose members read different languages sees the server's.
   The alternative the issue weighs — a display-time translation while the label still
   equals the seed — is a rule the card would have to apply on every surface.
3. **#540's German tables**: mark up what should change before B5 runs, or tell B5 to apply
   its own judgement to the strings the issue itself flags and leave the rest. B5 applies
   what it is given; it does not invent a second review.
4. **The desktop in-place editor expander stays** (recommended; §1.3). Saying "move the
   form above the list" adds ≈110 lines of removal to B3 and one user-visible change.
5. **Stage #546** (an item's id readable and copyable in the detail sheet, a location's
   in the organize dialog) **into V0.8.0** — recommended; it is S-effort, lives in files
   B4 rewrites anyway, and the README currently documents the JSON-export workaround.
   Saying no leaves it unmilestoned.
6. **#563 (server-side thumbnails) stays out** — recommended. It is a feature with a
   Pillow re-encode, a new media route parameter and a cache rule; V0.8.0 is subtraction.
   Milestone it V1.X.X or leave it; it is not on the path to the public release.
7. **`CODECOV_TOKEN`**: add it and #514 ships in D1; don't, and D1 closes #514 as
   not-planned with the reason (coverage is already in every run's summary and
   artifacts). Either is fine; leaving it open a third milestone is not.
8. **The milestone after V0.8.0 exists before A7 opens.** #229 files the adopter-deletion
   issue into it. Recommended name **V0.9.0** ("Clean candidate"); A7 creates it with
   `gh api` if it is absent, so this is a naming decision only.
9. **Drop the ten offline twins of phacc's frontend tests** (recommended; A6). CI runs phacc
   on every PR, so nothing is uncovered; what is lost is that those ten facts can no
   longer be checked on a Windows host without Docker.
10. **One household day** (#568) — recommended, and a reversal of a recorded decision:
    `docs/automations.md` says the two date-derived counts "measure against the UTC day"
    on purpose, written when #472 moved the reminder bump to the local day and left the
    counts behind. Today every household outside UTC sees the sensor, the pill and the
    row disagree for hours every night (two in Berlin, from midnight). Saying yes moves
    the counts, filters and sensors onto Home Assistant's local day — a badge flips at
    local midnight instead of UTC midnight, and an automation on the overdue sensor fires
    when the card says so. Saying no closes #568 as not-planned and A4 skips its third PR.
11. **The dev Home Assistant and the token** for the local validation sessions and Z:
    `home-assistant` on `http://localhost:8123`, `HA_BASE_URL` / `HA_TOKEN` exported. And
    the same two items as last time — a phone on the LAN (the firewall profile) if the
    phone tests are to run locally, and the brands PR (#196) whenever it suits.

## 3. Cloud sessions, local validation

**A cloud session** is a Claude Code session on the web, started from one pasted prompt,
working in a fresh Linux checkout. What it has: both gates, the phacc suite natively
(`scripts/test_integration.sh` — the Linux layout the script was written for), CI on its
PRs, `gh`, and the network for `uv`, `npm` and Playwright. What it does not have: the
owner's dev container, a phone, a German reader.

**What a cloud session can stand up itself.** A blank Home Assistant from the wheel the
phacc suite already installs, onboarded the way `card-smoke.yml` does it — no Docker
involved:

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

With that, the `run-haventory` skill's WS driver, the two-tab recipe, the live-update
smoke and the screenshot harnesses all have a target, and `dev/ha_config_for_dev.yaml`
can be dropped into `/tmp/ha-config` for the debug logging. **A1 proves this recipe
first** (§6.A1) and records the outcome in its handover; until then every later session
assumes it works and falls back to a hand-over if it does not. The recipe is a session
tool, not a product feature: it lives here and in the handovers, not in `docs/`.

**When a local session is necessary.** A PR is merged on the cloud's own evidence when
the change is behaviour-preserving by test — byte-identical outputs pinned by an existing
test, a deletion whose callers the gate proves absent, a refactor the phacc suite
exercises end to end. A PR **waits for local validation** when any of these holds and the
cloud HA could not produce the evidence: the change is user-visible (layout, a dialog, a
string, an options form); it touches the config-entry lifecycle or a WebSocket
subscription shape (the offline stub has hidden real breakage there before); its
acceptance names a screenshot, a phone width, or a German reader. The package in §6 says
per PR which it expects; the session decides on the day and says so in the handover.

**The local validation session** is a short local session (Opus 5, `xhigh`) started from
the paste in §8.V: it deploys the branch to the dev HA, runs the handover's "Validate
locally" steps, merges if everything holds, and files what it finds. Four to six of these
over the milestone is the expectation (B3, B4, B5, A4's clock change, A5 if the cloud HA
is not up, A7's rehearsal — which is the owner's store and is always local).

**Concurrency.** Lanes A and B can run at once as two cloud sessions. Three PRs cross
lanes and are owned by one of them: the health cut (A3, touches the card's diagnostics
panel and dictionaries), the rate limiter (A5, touches the card's store and banners),
and the i18n/seed PR (B5, touches `strings.json`). A cross-lane PR is opened when the
other lane has no open PR on those files; the other lane rebases after it merges. Running
one session at a time needs no such care — use §4's serial order.

## 4. The map

```
Lane A — backend                                       Lane B — card
─────────────────────────────────────────────────────  ────────────────────────────────────────────
A1  dead persist path; stub conformance      2 PRs     B1  dead code; comment archaeology;   3 PRs
    (+ proves the cloud HA recipe)                         one store spec
A2  one fan-out door; one tail; one op       4 PRs     B2  store dedup                       2 PRs
    table for WS + services; tags guard
    → closes #565, #567
A3  text index; health → test oracle;        3 PRs     B3  one workspace, one chrome         3 PRs
    chains and from_dict                                   → closes #560        [local validation]
A4  one field-rule table; predicate list;    4 PRs     B4  dialog chrome; shared widgets;    4 PRs
    the household day → closes #566, #568                  row chrome → closes #559, #546
    [local validation: a non-UTC clock]                                         [local validation]
A5  the rate limiter (owner merges)          1–2 PRs   B5  #542 → #540 → #536 + #562 +       3 PRs
    [local validation if no cloud HA]                      #569  (owner merges #540)
                                                                                [local validation]
A6  lifecycle, load path, #333, test folds   3 PRs
A7  #229 schema collapse (owner merges)      2 PRs
    [local: rehearsal on the owner's store]
D1  docs, scripts, CI: #497, #331, #514,     3 PRs
    docs drift from every cut above
─────────────────────────────────────────────────────────────────────────────────────────────────
Z   online regression / usability pass — Fable 5, local; deletes this file; then the release PR
```

Serial order if one session runs at a time: **A1, B1, A2, B2, A3, B3, A4, B4, A5, B5,
A6, D1, A7, Z.** Fourteen sessions, 37 planned PRs plus whatever Z ships. A lane's
session starts when the previous session in that lane has merged everything (or the
owner has merged what it left open); D1 starts after A6 and B5; A7 after D1 (so the
collapse lands on a tree that has stopped moving, per #229's own rule); Z after A7.

## 5. Rules every session follows

Everything from the V0.7.0 plan carries over — branch discipline, Conventional-Commit PR
titles, TDD, the gate before every commit, "issues are read, not rewritten", the PR body
as the review record, the Follow-ups bar — with these changes and additions.

**Model and start condition.** The first line of every prompt names the model and effort
(Opus 5 at `xhigh` for every session but Z, which is Fable 5). Each prompt restates its
start condition and the session checks it (`gh pr list`, `gh issue view`) before branching.

**Branches and PRs.** One branch per PR, `claude/v0-8-0-<lane><n>-<topic>`, off
`origin/main`. Link the issue (`Closes #NNN` / `Refs #NNN`) and fill in
`.github/pull_request_template.md`. A PR that removes a file under
`custom_components/haventory/` adds its path to `RETIRED_PATHS` in the same PR — this
milestone is the first to populate it (`areas.py`, `health.py`, `rate_limit.py`).

**The subtraction rule.** A cut PR changes no behaviour; its tests are deleted, moved or
left alone, never rewritten to pass. When a cut needs a behaviour change to be clean
(bulk delete's attachments, the tags guard, the date message), that change is **its own
commit with its own test and closes its own issue**, in the same PR, so the per-commit
rule holds and the changelog names it.

**The gate, before every commit.**

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q
uv run ruff check . && uv run ruff format --check . && uv run mypy
cd cards/haventory-card && npx eslint . && npm run typecheck && npx vitest run && npm run build
```

**phacc** (`scripts/test_integration.sh`, native on the cloud's Linux; the Docker recipe
from the V0.7.0 plan on the owner's Windows host) is required for any PR touching
`custom_components/` or `tests/integration/`. Build the card first or `test_frontend.py`
skips half its cases.

**Merging.** A session squash-merges its own PR when both gates, phacc (where required)
and CI are green **and** the PR's validation need (§3) is met — by the cloud HA, by a
test, or by nothing being user-visible. Otherwise the PR stays open, labelled in its body
"validation pending — see Handover §6", and the session moves on to work that does not
stack on it. **Left open for the owner:** A5's rate-limiter PR, B5's #540 PR, A7's
collapse PR. **Release-please PRs are never touched.**

**Counting.** Every cut PR's body carries a three-line table: production lines removed,
test lines removed, lines added — `git diff --stat` numbers, not estimates. Z sums them
in its closing comment on #236.

**Live checks from the cloud.** Drive the session's own HA (§3) with the `run-haventory`
skill's harnesses; put screenshots on an orphan `claude-assets-v0-8-0-<session>` branch
(the V0.7.0 recipe; commit with the noreply author or the push is refused) and link them
in the PR body. A session that cannot stand up the HA says so in the handover and marks
its PRs "validation pending".

**The handover.** The session's final message ends with `## Handover`, repeated as the
last section of every PR body it opened. Six parts, each present even when short:

1. **Merged / left open** — PR links; for each left-open PR, "waits for local validation"
   or "waits for the owner", and why.
2. **Test this by hand** — what no session can do: a phone, a German reader, the owner's
   own store. Tagged `[phone]`, `[German]`, `[owner]`.
3. **Validate locally** — the numbered steps a local validation session runs, each tagged
   `[dev-ha]`, `[browser]`, `[HA settings]` or `[log]`, with the expected result, against
   the named branch. "Nothing — merged on the cloud's evidence: …" is a valid entry; an
   empty one is not.
4. **Decisions taken against drifted notes** — one line each.
5. **Follow-ups** — filed (links) or named and not filed, with the reason.
6. **State left behind** — branches, assets branches, anything the next session in either
   lane must know, and the counting table's totals for this session.

**Conventions that bite in this milestone specifically.**

- **The stored payload does not move before A7.** No session changes what
  `serialize_state` writes; A7's collapse lands on a shape that has stopped moving. A
  session that finds it must stops and reports.
- **The WS contract does not move silently.** A schema type widened to `object` (A2),
  a field leaving `haventory/health` (A3), an error code retired (A5) each update
  `docs/backend_api_contract.md` and `docs/data_shapes.md` in the same PR;
  `tests/test_docs_contract_offline.py` will say so if not.
- **Dictionaries are edited by B5 only**, except for keys a cut makes unreachable (A3's
  `hv.health.*`, A5's rate-limit keys, B1's dead pair), which the cut deletes itself. A
  session in either lane that needs a *new* key files it for B5 in its handover rather
  than adding one.
- **`tests/conftest.py` is rewritten by A1** (the stub conforms to real HA). Every
  backend session after A1 starts from that stub; B sessions are unaffected.
- **Per-surface test ids and classes are parameters, never collapsed.** The browser
  harnesses under `.claude/skills/` locate `badge-*` / `full-badge-*`, `search-input` /
  `full-search`, `inline-editor` / `full-editor` / `sheet-editor`; a shared renderer keeps
  them byte-identical.
- `tests/test_min_ha_version.py`, `test_toolchain_pins.py` and
  `test_release_version_consistency.py` stay exactly as they are; D1's README edits run
  the backend gate before they are believed.
- TDD, no `TODO`/`FIXME`, comments encode constraints not history, plain words — as
  always. Out-of-scope findings go in the Follow-ups note and become issues only if they
  clear the real-world bar.

## 6. The sessions

Each package lists its PRs in order, the cuts each carries (by the ids the #230/#231/#542
comments use), the tests, the verification, and whether local validation is expected.
File references are to symbols; line numbers in the issue comments are from `b878bfe`.

### 6.A1 — A1: the dead persist path, and a stub that conforms

Two PRs:

1. **"refactor(storage): delete the debounced persist path nothing calls"** — refs #230
   (item 3). `async_request_persist`, `cancel_pending_persist`, `async_persist_immediate`,
   `PERSIST_DEBOUNCE_DELAY`, `runtime.persist_task`; `_async_flush_pending_writes`
   shrinks to "flush if loaded"; the `ws.py` docstring and `docs/developing.md`'s
   "Debounced saves" line go; CLAUDE.md's persistence convention loses its debounce
   clause. Tests: the debounce cases in `test_storage_concurrency_offline.py`, the
   debounce halves of the two refusal tests, the two phacc tests and module docstring in
   `tests/integration/test_persistence.py`, the `immediate_persist` fixture and its one
   consumer, the `persist_task` key in the diagnostics expectation — ≈395 lines. The
   flush-on-unload tests stay and are what matters.
2. **"test: make the offline Home Assistant stub conform, and take the stub-compat
   branches out of production"** — refs #230 (item 6). Stub side (`tests/conftest.py`,
   `tests/ws_helpers.py`): the WS command registry becomes a dict keyed by command type
   (re-registration overwrites, as HA); `area_registry.async_get` becomes synchronous;
   `RecordingConn` gains `subscriptions: dict` and a `close()` that drains it;
   `HomeAssistant` gains a recording `services.async_register` (moved from the two tests
   that bolt one on) and an `http` with `register_view`/`register_static_path` (moved
   from `test_frontend_registration.py`'s `HttpStub`); `config_entries` gains no-op
   `async_forward_entry_setups` / `async_unload_platforms`. Production side: delete
   `_cleanup_ws_test_stub_registry` and its call, `_forget_registration_flags`, the
   `ws_registered` / `services_registered` / `ws_handlers` bucket flags, the `async_setup`
   that only seeds `hass.data`, the dead `getattr`/`callable` guards in `__init__.py`
   (`add_update_listener`, `async_update_entry`), `ws.py`'s `_send_error` probe, the
   `async_send_message` branch, the `on_close` / `add_close_callback` fallback and its
   docstring, the `subscriptions` probes, `services.py`'s `hasattr(hass, "services")`
   early return, `events.py`'s bus probes, `todo_bridge.py`'s four entry/bus probes, and
   **`areas.py` as a file** (`ws.py` calls `ar.async_get(hass)` at its three sites;
   `RETIRED_PATHS` gains `"areas.py"` — its first entry). Expose the handler list
   `setup()` registers as a module constant so `test_ws_error_mapping_offline.py` reads
   that instead of the bucket. Delete the two `_ConnStub`s, `_HAConnStub`, the two
   `_Services`, `HassStub`/`HttpStub`; rewrite `test_integration_lifecycle_offline.py`'s
   cleanup assertion as "a second `setup_entry` leaves one handler per command". Retire
   the tests of the harness itself (`test_ws_helpers_offline.py`,
   `test_integration_bootstrap_offline.py`, `src/test.utils.test.ts`,
   `src/test.setup.test.ts`), moving the two production cases out of
   `test_ws_schema_validation_offline.py` into `test_ws_items_offline.py` first.
   CLAUDE.md's "the offline stub has no service registry" sentence becomes "registration
   is asserted offline; dispatch is phacc-only".

**Before PR 1: prove the cloud HA recipe** (§3) and put the outcome — booted or not, the
boot time, anything the recipe needed changed — at the top of the handover. Every
session after reads it there.

phacc required for both (the stub now claims to match real HA; phacc is the oracle).
Live check: the session's own HA — reload the config entry twice from
`/api/config/config_entries/entry/<id>/reload`, then `grep -E "Overwriting|Traceback"`
the log finds nothing.

Validation: merged on the cloud's evidence. Handover "Validate locally": `[dev-ha]`
deploy `main`, reload the entry from Settings → Devices & services, `[log]` nothing at
ERROR carrying `haventory` — optional, the phacc reload test covers it.

### 6.A2 — A2: one fan-out door, one tail, one op table

Four PRs, in order:

1. **"refactor(ws): one door for every broadcast"** — refs #230 (items 4, 10). Move the
   subscription/broadcast half of `ws.py` (`_subscription_location_ids` …
   `broadcast_counts`, ≈350 lines) into a module `events.py` imports — `subscriptions.py`
   — so `events.py`'s two function-local-import shims go and the cycle comment with
   them. Add `notify_status_mutation` so the four status handlers and import's two
   `reloaded` broadcasts go through the same door as items and locations. Delete the
   test-only `ITEM_ACTIONS`, rewrite `events.py`'s docstring to what is true (not every
   path called `notify_mutation`; now every path does), drop the history sentence.
   Keep a `broadcast_event` re-export from `ws` for the tests that import it, or update
   the imports.
2. **"refactor(ws): one tail for every single-item mutation"** — refs #230 (item 4),
   **closes #565** as its own commit. One `_mutate_item(hass, conn, msg, kind, *,
   counts=True, after_persist=None)` that strips `id`/`type`, runs `_execute_item_op`,
   persists, notifies, replies; the eleven table-shaped handlers become two-line bodies;
   the six inline twins of their `_op_item_*` entry go; the five hand-built payload dicts
   go; `ws_item_set_quantity`'s pre-check that restates the model goes. The #565 commit
   moves attachment deletion onto the delete op's post-persist step so bulk and single
   agree, with the test "a bulk delete of an item with attachments unlinks after the
   persist; a raising persist leaves the files". `ws_items_bulk`'s per-row error
   mapping reuses `_error_message` / `_context_from_msg` (#230's C7).
3. **"refactor(services): services and WebSocket share one op table"** — refs #230.
   Twelve `service_*` handlers (each eight identical lines and one identical `except`)
   become `_run_service(name, data)` over the same ops `ws.py` dispatches; `ws_item_create`,
   `ws_reminder_bump` and `ws_location_update` lose their duplicate bodies the same way.
   The location-update "what changed → which event" decision is written once (beside
   `Repository.update_location` or in `events.py`) and both surfaces call it. Give the
   repository public `iter_locations()` / `children_of(parent_id)` and retire
   `_debug_get_internal_indexes` from `ws_location_list` / `ws_location_tree` (its header
   says "for tests", and production calls it). What must survive, and the tests that pin
   it: services keep their typed schemas, `new_location_id`, the required `due_date` on
   check-out, the `{"item": …}` envelope, the per-op log context, and `_bind`'s
   coroutine-function constraint. `services.yaml` loses the 24 name/description lines
   `strings.json` already carries.
4. **"fix(models): refuse a non-list tags, and type every payload field the same way"**
   — **closes #567** (first commit: the `isinstance(tags, list)` guard in `validate_tags`
   with its test, `tags: null` still clearing), then refs #230: widen the remaining
   `[str]` / `{str: object}` fields to `object` so the model answers every type error
   with `validation_error`; delete the contract's paragraph enumerating the exceptions and
   the half of `test_docs_contract_offline.py` that kept the list in sync; `_payload_int`
   goes. `docs/backend_api_contract.md` and `docs/data_shapes.md` move in the same PR.

phacc required for 2–4 (dispatch, service registration). Live check on the session's HA:
every `haventory.*` service from `POST /api/services/haventory/<name>?return_response`
answers the same envelope as before (record one response per service in the PR body);
two WS clients, one mutating, the other receiving the same `items` / `locations` /
`statuses` / `stats` frames as on `main` (the two-tab recipe; a WS client is enough).

Validation: merged on the cloud's evidence (every envelope is test-pinned). Handover
"Validate locally": `[HA settings]` Developer Tools → Actions → `haventory.item_update`
with `tags: kitchen` (a string) answers `validation_error` and changes nothing.

### 6.A3 — A3: the text index, health as an oracle, the repository's own copies

Three PRs, in order:

1. **"refactor(repository): the scan answers q; delete the text index"** — refs #230
   (item 1). Everything the #230 comment's BE-REPO-1 lists (`_TextTokens`, the three
   dicts, the tokenizer/trigram/prefix helpers, `_search_by_text`,
   `_text_index_covers_query`, the path-token delta, step "0" of
   `_get_filtered_candidates`, `re`). **First commit: a benchmark** — `list_items` with
   `q="Widget"` over a generated 10,000-item repository, timed before and after, in a
   test marked to run only with `ASSERT_BUDGETS=1` (the budget file the issue cites is
   gone); the two numbers go in the PR body, and the cut lands only if the scan is under
   the 0.5 s the issue named. Tests: the five fall-through tests keep passing and are the
   oracle; the six `_get_filtered_candidates` assertions and the three-dict rebuild
   comparison go; add the accent/case and multi-word AND cases on results.
2. **"refactor(health): index health becomes a test oracle, not a product feature"** —
   refs #230 (item 2). Move `collect_health_issues` and its five checkers into
   `tests/` as a fixture that runs after every `Repository` test (this is the invariant
   checker for the repository refactors of this milestone, and it has found exactly
   nothing in production). `haventory/health` keeps its shape with `issues: []`, the
   diagnostics JSON keeps `health_issues: []`, and `generation` leaves both (it was
   reported for this subsystem; the store stopped persisting it in #496). Card half:
   delete `ui/health-codes.ts` and its test, the panel's "Issues found" rendering, the 38
   `hv.health.*` keys and `hv.count.issue` in both dictionaries; `HealthResult.issues`
   stays typed `string[]`. `InternalIndexes` and `_debug_get_internal_indexes` lose their
   last production caller (A2 added the public accessors) and move to the test fixture.
   `health.py` joins `RETIRED_PATHS`. Docs: README's "index-health checks",
   `frontend_architecture.md`, `backend_api_contract.md`'s health line (always empty),
   and `dev/release_testing_plan.md`'s five `issues == []` assertions become "counts
   match"; `.claude/skills/test-haventory/stress.py`'s `assert_healthy` the same.
3. **"refactor(repository): one chain walk, from_dict on the models, and the small
   copies"** — refs #230. BE-REPO-3 (five hand-written parent-chain walks → one
   `_chain()`; the builders already exist as `build_location_path_from_map`), BE-REPO-4
   (the staged-map copy in `update_location` defends a failure `_validate_parent_move`
   already excludes), BE-REPO-5 (`from_dict` on `Item`, `Location`, `LocationPath`, so
   `load_state` and `import_export._recompute_paths` stop building them field by field
   and the `sort_key` backfill exists once), BE-REPO-6 (five `_count_*` → one, the
   bucket-discard dance, the name-sort cache that saves one comparison, a local dressed
   as an index, three one-line wrappers), BE-REPO-8 (the class docstring that states the
   opposite of the `location_path` invariant, the "pre-WP4" pair, the narrated call
   sequence, the `_generation` history in `load_state`). `test_load_report_offline.py`
   (the corrupt-store cases) must stay green untouched.

phacc required for all three. Live check: the session's HA with 2,000 seeded items —
search, filter, sort, a subtree move and a rename; the diagnostics panel opens and shows
counts and no "Issues" section; `stress.py baseline` passes on counts.

Validation: merged on the cloud's evidence. Cross-lane: PR 2 edits
`hv-diagnostics-panel.ts`, `host-surfaces.ts` and both dictionaries — open it when lane
B has no PR touching those files open.

### 6.A4 — A4: one field-rule table, a predicate list, the household day

Four PRs, in order:

1. **"refactor(models): every field rule written once"** — **closes #566** as its own
   commit (a `field_name` on `normalize_date_yyyy_mm_dd`; `validate_inspection_date` /
   `validate_reminder_date` become one `validate_optional_date(value, field_name)`), then
   refs #230: a per-field rule table applied by `create_item_from_create` with
   `previous=None` and by `apply_item_update` with `previous=item.<field>`; the nine
   `_update_*` helpers become the table walk; `validate_item_status` /
   `coerce_item_status` become one function with `default=`; the second
   `CUSTOM_FIELDS_MAX_KEYS` check goes; `new_uuid4_str` (zero production callers) goes.
   Every existing message stays byte-identical except the #566 fix.
2. **"refactor(models): filter_items as a predicate list"** — refs #230 (item 1's scan).
   Predicates built once per query for the keys present; the fourteen
   `if "x" in flt else False` lines, the `predicates_active` block and the sixteen eager
   `matches_*` go; the five `item_*_is_*` functions become one `_date_passed(item,
   field, today, inclusive)` behind the five public names; `sort_items`' re-validation of
   what `validate_sort` already checked goes; `repository.py`'s five `_count_*` collapse
   onto the same predicate. Re-run A3's benchmark after; record it.
3. **"fix(dates): one household day"** — **closes #568**, if §2 item 10 said yes. The
   backend's date predicates take the day the caller supplies, and every caller supplies
   Home Assistant's local day (`dt_util.now().date()` — what the calendar and
   `reminder_bump` already use); `today_utc_date()` goes; the sensors roll over on local
   midnight with the calendar (`async_track_time_change`, not `_utc_`); `ws.py`'s third
   copy of the inspection predicate over a dict (`_payload_inspection_is_overdue`) goes in
   favour of the shared one. `filter_items` stays pure: `today` is a parameter, never an
   import of `hass`. Docs: `docs/automations.md`'s "UTC day" paragraph becomes the one
   sentence that is now true ("dates are compared on the instance's calendar day"), and
   the `ws.py` comment that points at "the README's note" points at it;
   `backend_api_contract.md`'s filter section, `data_shapes.md`, the `const.py` /
   `sensor.py` docstrings and `store/types.ts`'s filter comments follow. Tests freeze the
   clock through the parameter; two zone-pinned cases (a UTC+12 and a UTC−7 instance) in
   `tests/integration/test_sensor.py`; and the card's `test.utils.ts` stops building
   "today" in UTC while the components use local time (a latent midnight flake on a
   non-UTC machine, same PR).
4. **"refactor(models): one field catalog"** — refs #230. After PR 1: `ItemCreate` /
   `ItemUpdate`, both voluptuous schemas (typed for services, `object` for WS), the bulk
   whitelist and `_ITEM_SOURCE_FIELDS` derived from one `ITEM_FIELDS` table;
   `Item.to_dict` stays hand-written (it is the stored shape). Droppable if the
   generator needs more than it saves — say so in the handover.

phacc required for PR 3 (sensor rollover, calendar agreement) and PR 4 (the generated
schemas are the `websocket_command` input). Live check for PR 3 on the session's HA with
`time_zone: America/Los_Angeles` (UTC−7 in August, so the two midnights are seven hours
apart): an item due today at 18:00 local — the sensor, the card's pill, the row chip and
the calendar all say "due", none "overdue".

Validation: PR 3 **waits for local validation** unless the cloud HA produced the
evidence above. Handover "Validate locally": `[dev-ha]` set the container's time zone to
`Pacific/Auckland` (UTC+12) and give an item a due date of tomorrow's local date at 23:00
local — `[browser]` the card shows it as due tomorrow and `sensor.haventory_checked_out_due`
does not count it; at 00:05 local both count it; restore the time zone.

### 6.A5 — A5: the rate limiter — owner merges

One PR if the owner chose deletion (§2 item 1), two if shrinking:

1. **"refactor: remove the WebSocket rate limiter"** — refs #230 (item 7), #199. Every
   site the #230 comment's C2 enumerates: `rate_limit.py` (→ `RETIRED_PATHS`), the
   limiter branches in `ws.py` / `subscriptions.py`, nine `CONF_`/`DEFAULT_` pairs in
   `const.py`, the options section in `config_flow.py` and its 18 keys in `strings.json`
   and both translations, the diagnostics block, the health sub-block, the
   `rate_limited` error code (contract and `exceptions.py`), `docs/rate_limiting.md`
   (deleted, with its five inbound links — three in the README, one each in
   `developing.md` and `backend_api_contract.md`; `test_docs_links_offline.py` finds any
   missed), the README's section and line, `developing.md` / `frontend_architecture.md`
   references, `dev/release_testing_plan.md`'s two rate-limit scenarios. Card: the
   `rate_limited` branches of `store.ts` (`RATE_LIMIT_ATTEMPTS`, `retryAfterHintMs`,
   `nonNegativeNumber`, the refusal branch, `run()`'s retry loop becomes a plain call),
   the `rateLimited` flag and banner (`ui/banners.ts`), `hv-bulk-bar`'s string,
   `hv-diagnostics-panel`'s lines, five keys in each dictionary; the subscribe-retry
   path **stays** (it serves `unavailable`). Skills: `rl_banner.mjs`, `stress.py`'s
   `ratelimit` regimen and `RL_DEFAULTS`, four SKILL.md passages. Tests:
   `test_ws_rate_limit_offline.py` and the rate-limit cases in seven other files; the
   card's `describe('Store: rate limiting …')`. Edge case to add: an entry whose options
   still carry the nine keys sets up and ignores them.
   *If shrinking instead:* C3 in the #230 comment — keep `TokenBucket`, one global
   command bucket, `RateLimitConfig(enabled, per_second, burst)`, three options; emit
   `retry_after_ms` from the surviving bucket so the card's reader finally reads
   something; docs and card shrink accordingly.

phacc required (the options flow, the entry with stale keys). Live check: the options
form on the session's HA renders without the section (or with three fields); the card
shows no rate-limit banner under a `hammer` run; `stress.py` regimens other than
`ratelimit` pass.

**Left open for the owner.** Validation: the session's own HA suffices for the options
form; if none, **waits for local validation** — `[HA settings]` open HAventory → Configure:
the form saves with no rate-limit section; `[browser]` the card and `/haventory` work
as before.

### 6.A6 — A6: lifecycle, the load path, #333, and the test folds

Three PRs, in order:

1. **"refactor(init): the manifest is already a constant; the /local path never shipped;
   the unreachable checks"** — refs #230. L4 (`_read_manifest_version`,
   `_async_manifest_version`, `_MANIFEST_PATH`, `_async_card_url` becomes sync — the
   `?v=` string is byte-identical by `test_release_version_consistency.py`), L5
   (`_LEGACY_CARD_URL_PATH` and its test — no tagged release served it), L7 (the two
   branches of `_validate_storage_payload` that `DomainStore.async_load` makes
   unreachable; one `_normalized(payload)` for the four `STORE_COLLECTIONS` defaults;
   `schema_downgrade_message` inlined; the second raw backup in `_async_settle_lossy_load`
   that `repairs.py` already wrote — keep the flow's, it is the one that can still
   refuse). `tests/integration/test_repairs.py` is the gate for the last one.
2. **"fix(media): remove an item's attachment directory once its last file is gone"** —
   **closes #333** (option 2): `rmdir` after the last unlink on item delete and
   last-attachment removal, `OSError` swallowed — which is the operator's-own-file case
   the docstring protects, falling out of the API; `_sweep_blocking`'s docstring moves
   with it. Tests: delete → directory gone; a stray file → kept. The PR deletes the
   "deliberate tradeoff" sentence, not the constraint.
3. **"test: one setup per phacc file, one helper per online smoke, and the phacc twins"**
   — refs #230. T6 (one `setup_entry` fixture in `tests/integration/conftest.py`
   replacing fourteen `_setup`s; `install_runtime(…, ws=True)` replacing six
   `_make_hass`; one `tests/online_helpers.py` for the three smokes' four identical
   helpers; `_utc_day_offset` once; the two `MockResourceCollection` pairs once; a
   `mountHost` for the card's four host specs) and, if §2 item 9 is yes, T5 (the ten
   offline frontend tests with a phacc twin, `conftest.py`'s hand-written
   `async_register_panel` and the `__panel_registrations__` log; the cross-language pins
   in the same file stay).

phacc required for all three. Live check: the session's HA serves the card at
`?v=<INTEGRATION_VERSION>` (`lovelace/resources` over WS shows one entry); an item with a
photo deleted leaves no directory; a directory holding a stray file survives a delete.

Validation: merged on the cloud's evidence. Handover "Validate locally": nothing beyond
`[dev-ha]` deploy and open the card once.

### 6.A7 — A7: the schema collapse — owner merges

Two PRs, in order, **after D1** so the collapse lands last:

1. **"feat(storage): collapse the schema to v1 with a one-release adopter"** — **closes
   #229**. The issue's 2026-08-05 notes plus its three comments are the design; the drift
   list in §1.4 is what to decide against the code. `CURRENT_SCHEMA_VERSION = 1`;
   `migrations.py` becomes the driver (keeps `SchemaDowngradeError` for 0→1) plus
   `ADOPTABLE_SCHEMA_VERSIONS = frozenset(range(2, 10))` and `adopt_dev_schema` folding
   the four backfills (statuses, seeded statuses + attachments, reminder nulls, the
   anchor) as idempotent `setdefault`s; `async_migrate_if_needed` adopts a store inside
   the set before it refuses what is above it; `import_export._parse_envelope` accepts
   the set (every export in the wild is stamped 9); the three stored artifacts outside
   the payload (`haventory_todo_links`, entry options, a corrupt backup) are named in
   the PR body as untouched. Tests per the issue: clean install at v1; a store at each of
   2–9 lands at v1 intact; a double load is equal; 10 is refused with the store untouched
   and `ConfigEntryError`; a v9 export imports; the repairs card still works on a v1
   store. `test_migrations_offline.py`'s per-step tests become adopter tests;
   `tests/integration/test_schema_migration.py` is rewritten v9 → 1. Docs:
   `data_shapes.md`'s example envelopes and the three function names it cites, the
   contract's import section, the README's two lines, `release_testing_plan.md`'s
   D7/D8/E3/E4 restated against v1. **In this PR:** create milestone V0.9.0 if absent
   (§2 item 8) and file the adopter-deletion issue (🔧 Task) into it: delete
   `adopt_dev_schema`, `ADOPTABLE_SCHEMA_VERSIONS` and the import-side exception.
2. **"refactor(import): validate a document through the models' validators"** — refs
   #230 (be-models-io C2, after the collapse so `_parse_envelope` is edited once). A
   `caps=False` mode on the model validators and one `_collect(errors, path, fn, …)`
   helper replace the nine identical try/except blocks and the hand-written
   quantity/threshold/text/tag/custom-field checks; `_recompute_paths` uses
   `LocationPath.to_dict()`; the legacy dict-shaped entity list in `_coerce_entity_list`
   goes (no exporter writes it). Error paths and messages stay byte-identical — the
   import sheet renders them.

phacc required for both. Live check on the session's HA: a store hand-stamped at 9 with
the seeded household adopts on boot (the log's one `warning` names 9 → 1); export →
preview → import reports zero changes; a store stamped 10 is refused and the Repairs card
names it.

**Left open for the owner, and always local.** Handover "Validate locally", for the
owner's own hands or a local session: `[owner]` take a copy of the production store;
`[dev-ha]` wipe the dev HA (the volume route), restore the copy, deploy the branch, boot;
counts before and after, spot-check ten items, an export diff showing only the metadata
deltas — #226's protocol, restated in the issue's 2026-08-21 comment; `[HA settings]`
run D7/D8/E3/E4 from `dev/release_testing_plan.md`. The watch-window and exit conditions
the same comment carries go into the release notes text in the PR body.

### 6.B1 — B1: dead code, comment archaeology, one store spec

Three PRs, in order:

1. **"refactor(card): delete the dead selection chain, the unused client methods and the
   unbound props"** — refs #231 (item 3), extended by the measurement. `pendingOps` (state
   field, seed, six write sites, the `frontend_architecture.md` line); `hv-list`'s
   `selectable` / `selection` / `pendingIds` / `fill` / `skeletonRows` and their
   bindings; `hv-list-row`'s whole selection mode — `selectable` / `selected` /
   `pending`, the `.row.selected` and `.box` rules, the checkbox, the `toggle-select`
   branch nothing listens to, the pending chip, the hover-action gate; `WSClient.ping`,
   `addTags`, `removeTags`, `updateCustomFields`, `getLocation` and the mock's
   `location/get` case (the `item/add_tags` cases stay — bulk dispatches them);
   `hv-location-tree`'s never-bound `allLabel` / `allIcon`; `hv-card-shell.forceMobile`
   and `ResponsiveController.setForced` (tests drive `setWidth`); `MediaUrls.failed()`;
   the dead `--hv-error-border` token; the two i18n pairs this makes unread
   (`hv.row.pending`, `hv.row.select`) and the two #542 names
   (`hv.term.checkedOutUntil`, `hv.action.apply`). Tests: the "selection mode" cases,
   the `updateCustomFields` case, the `setForced` cases; add "no `row-pending` renders"
   and "`StoreState` carries no `pendingOps`".
2. **"docs(card): comments that state the rule, not the measurement"** — refs #231 (item
   1). The #231 comment's list: 12 sites from the issue's three greps and 7 narrative
   blocks a fourth grep catches
   (`showed nothing|said nothing|sat there|doing nothing|never (set|forwarded)|now (reads|render|take)|bit once`);
   `docs/frontend_architecture.md`'s "Each split bit once" passage. Rule: keep the
   constraint the block ends on, drop the trace. Then the length pass the issue does not
   measure: the 53 doc blocks of eight lines or more in the editor, organize dialog,
   detail sheet, filter panel, import sheet, `ui/media.ts` and `ui/dialog-focus.ts` are
   restated in four lines or fewer where the constraint allows it — about 270 lines; a
   block that cannot be shortened without losing a rule stays. Test files get the same
   greps (`hv-full-view.test.ts`'s "It measured 380..490"). No CSS changes; the gate
   passing unchanged is the assertion. Acceptance: the four greps over `src/` return
   only the false positives the comment lists.
3. **"test(card): one store spec"** — **closes #231** (item 5). `store.test.ts`'s three
   duplicate cases go; the rest moves into `store.revamp.test.ts`, which is renamed
   `store.test.ts` and split by `describe` into files named for what they pin (filters,
   degraded, subscriptions, events) — the issue's intent is a file that does not narrate
   history, and four named files read better than one of 2,750 lines.

No phacc. Live check: the card, full view and panel render on the session's HA (the
live-update smoke in Chromium; registration in Firefox if Playwright's Firefox installs).

Validation: merged on the cloud's evidence. Handover "Validate locally": `[browser]`
open the card on a desktop dashboard and hover a row — the hover actions appear; nothing
else should have changed, say so if it did.

### 6.B2 — B2: the store

Two PRs, in order:

1. **"refactor(store): one optimistic write, one read path, one subscription opener"** —
   refs #231 (item 4). FE-S3 (the six identical mutators onto `optimisticWrite(itemId,
   patch, call, details?)`; the four attachment wrappers onto `applyResult`; the
   location/status mutators onto an `after*Change` wrapper), FE-S4 (`listItems` and the
   other direct `this.ws.*` reads go through `run()` so the comment claiming they do is
   true; keep the `inflight` map), FE-S5 (`subscribe()` and `subscribeAreaRegistry()`
   onto one `openSubscription(msg, cb, opts)` — the function-or-promise, early-cancel
   unwrap), FE-S8 (one `Coalesced` helper for the four debounce slots, three cancel
   helpers and three seq guards; `dispose()` cancels each). `store.test.ts`'s optimistic
   apply/rollback cases are the guard and stay.
2. **"refactor(store): drop the retry-after reader nobody sends to"** — refs #230 (item
   7) — **only if A5 deleted the limiter** (otherwise A5's shrink made the backend send
   it; keep). `retryAfterHintMs`, `nonNegativeNumber`, the hint half of
   `subscribeRetryDelayMs`, the two hint tests, the `frontend_architecture.md` paragraph.
   Skip this PR if A5 has not merged yet and say so.

No phacc. Live check: the two-tab fan-out recipe on the session's HA — a mutation in one
tab repaints the other's list and counts; a forced `conflict` (the `routeWebSocket`
recipe) rolls the optimistic row back and shows the banner.

Validation: PR 1 **waits for local validation** unless the two-tab evidence came from the
cloud HA — the subscribe unwrap is where the offline stubs have passed green on real
breakage before. Handover "Validate locally": `[dev-ha]` `[browser]` two tabs on the
card, an item created in one appears in the other with its count; `[browser]` a forced
conflict rolls back and the banner names it.

### 6.B3 — B3: one workspace, one chrome — local validation

Three PRs, in order:

1. **"refactor(card): the discard question asked in one place"** — refs #231 (item 2).
   FE-DLG-6: `hv-item-editor` takes a `confirmDiscard(onConfirm)` callback; the detail
   sheet and the full view pass `surfaces.confirm`, the shell already does; the three
   private `<hv-confirm>`s and two `_pendingDiscard` machines go. Why first: it makes the
   shell's and the full view's editor halves identical, which PR 2 needs.
2. **"refactor(card): one item workspace for the shell and the full view"** — refs #231
   (item 2), **closes #560** as its own commit. A plain class in the `HostSurfaces` style
   (`src/item-workspace.ts`) holding `_editing` / `_editorBusy` / `_editorError` /
   `_pinnedItem` / `_checkout` / `_detailItemId`, `syncPinnedItem`, `editorItem`,
   `onEditorSave`, `createLocationForEditor`, `media`, the store subscription, the
   row-action/row-event dispatch table (FE-L3: each host keeps its three overrides —
   anchor, delete routing, open), and three template functions `renderEditor`,
   `renderDetailSheet`, `renderCheckoutPopover` parameterised by `{testid, mobile,
   anchor?}`. The #560 commit measures the detail sheet's edit bar on the full view's
   narrow branch live before fixing it (the issue says the screenshot is the symptom).
   One viewport watcher (C3): `HostSurfaces` and `hv-full-view` use `ViewportNarrow`;
   `connect()` / `disconnect()` and their four call sites go. One Store/theme lifecycle
   (C4) for `index.ts` and the panel (`withStore` or a base class; keep the panel's
   `requestUpdate()`).
3. **"refactor(card): the filter chrome, once"** — **closes #231** (item 2).
   `ui/stat-badges.ts` (`renderStatBadges` with `{prefix, chipClass, total?}` — the
   shell's `badge-*` / `hv-chip badge toggle` and the full view's `full-badge-*` /
   `hv-chip pill` are parameters), `ui/filter-chrome.ts` (`renderSearch`,
   `renderFilterChips`, `renderFilterPanel`, `renderStagedFooter`, one
   `SEARCH_DEBOUNCE_MS`, `searchDebounce(store)` / `priceStaged(store, set)`), the
   search-box and pill CSS exported the way `bannerStack` is (C8). Functions, not a base
   class. Tests: the four cases both host specs name identically move to the new
   modules' tests with one "renders the badges" smoke per host (T9); the twelve spec files
   still reading stylesheets after #532 are checked for what they pin.

No phacc. Live check on the session's HA at 1920 px (docked and hidden sidebar), and
375 px, light and dark, on the card, the full view and `/haventory`: editor open/save/
cancel/discard on all three hosts and the phone add sheet; the check-out popover from a
row and from the editor; the detail sheet on a phone; every `data-testid` the harnesses
name still resolves (`card_views.test.mjs` passes); screenshots before and after.

Validation: **waits for local validation.** Handover "Validate locally": `[dev-ha]`
deploy the branch (hand-rolled `docker cp` from a worktree); `[browser]` the list in
§6.B3's live check at the two widths; `[phone]` if the LAN allows: edit from a row on
`/haventory`, the Save pill is whole (#560).

### 6.B4 — B4: dialog chrome, shared widgets, row chrome — local validation

Four PRs, in order:

1. **"refactor(card): one modal chrome"** — refs #231. FE-DLG-1: `ui/modal.ts` exporting
   the backdrop/wrap/panel CSS once and `renderModal({z, label, testid, onClose}, body)`
   owning `nextZBase()`, the `DialogFocus` sync and `onEscape`; adopters: organize,
   import, confirm (gains the return-focus it lacks), column picker, diagnostics;
   `ui/dialog-sheet.ts` folds in; one close convention (emit `cancel`, never flip `open`
   from inside — the `hv-bottom-sheet` comment says why). FE-DLG-4: the organize dialog's
   two action sheets, three toolbars and five footers become one each; the seven-entry
   disclosure-reveal registry becomes a `ref` callback that scrolls and focuses on first
   render (the "a re-opened dialog moves nothing" rule is the test).
2. **"refactor(card): the widgets written twice"** — refs #231, **closes #559** as its own
   commit. FE-DLG-2 (`ui/day-offsets.ts` for the editor and the check-out popover),
   FE-DLG-3 (`hv-location-picker`: the trigger/`aria-expanded`/`.tree-holder`/tree
   disclosure the editor, filter panel, organize parent picker, merge target and bulk bar
   each write; `keepOpenOnSelect` for the filter panel), FE-DLG-5 (`ui/attachments.ts`:
   the photo figure and document row the editor and the detail sheet share; the lightbox
   host block), FE-DLG-7a (the category list renders in flow under its input like the
   location tree does — the floating placement, its two window listeners and its fixed
   positioning go; the chevron and the show-all affordance stay, per the editor's own
   comment). The #559 commit gives `hv-location-tree` a roving `tabindex` — one tab stop,
   arrows inside, Tab leaves — with a keyboard test on every host the picker serves.
3. **"refactor(card): one row chrome for the list row and the table"** — refs #231.
   FE-L2: `ui/row-chrome.ts` with `renderRowThumb`, `rowKeyAction` (the four-key table;
   the table's `target !== currentTarget` guard survives as the shared shape) and
   `renderNameChips(item, statuses, {statusChip, overdueText})` — `overdue` vs
   `overdueOn` stays a parameter (#552/#553); `isLowStock`, `rowMenuEntries` and
   `elidePath` move out of the component file; the thumb and chip-spacing CSS exported
   once (FE-L6).
4. **"feat(card): an item's id, readable and copyable"** — **closes #546** if §2 item 5
   said yes. A row in the detail sheet's facts (beside "Updated"), copy-to-clipboard; the
   location's id in the organize dialog's location editor the same way; the README's
   "the ids are in a JSON export" sentence goes. Two keys for B5 (named in the handover;
   this PR adds them in both languages itself since it closes an issue).

No phacc. Live check on the session's HA, both widths, both themes: every dialog opens,
Escape closes one layer, focus returns to the opener; the editor's location picker,
category list, day offsets and photo strip; the organize dialog's four tabs and their
inline editors; the import sheet's preview; the filter panel's tree stays open while
multi-selecting; keyboard-only from the search box to the first table row in under ten
Tabs (#559); `card_views.test.mjs` and `surfaces.mjs` pass.

Validation: **waits for local validation.** Handover "Validate locally": `[dev-ha]`
`[browser]` the list above at 1920 and 375; `[phone]` the organize dialog's phone page
and the editor's phone sheet.

### 6.B5 — B5: translation keys, German wording, the server's language — owner merges #540

Three PRs, in order; #542 says "do this before #540" and the plan agrees:

1. **"refactor(i18n): delete what nothing reads; one key per word"** — **closes #542**.
   I1: the unused-key test (≈40 lines: every key literal or computed-prefix reachable from
   a non-test source, with the ten computed prefixes and three map-reached bases as the
   allowlist); I2: the `hv.field.*` namespace (13 keys replacing 28 across `hv.column.*`,
   `hv.filter.sortField.*`, `hv.filter.dateNoun.*`, `hv.editor.field.*`, with
   `hv.column.quantity` = `Qty` and `hv.column.due_date` = `Due` kept as column
   overrides) and the 29 remaining groups folded per the #542 comment's merge map (≈50
   call sites); `SAME_IN_BOTH` shrinks to 11; the two `t()` literals
   (`hv-import-sheet.ts`'s "That is not valid JSON", `hv-organize-dialog.ts`'s "Create")
   become keys; `frontend_architecture.md`'s wording section gains the namespace in one
   line. The 19 same-German groups are read and left, except `locationCreateFailed`
   (one event, two English sentences — keep one).
2. **"fix(i18n): the German wording corrections"** — **closes #540**, **left open for the
   owner**. Apply §2 item 3: the owner's mark-up, or the strings the issue flags itself
   with the session's judgement. Two files, values only; `catalog.test.ts` holds the
   placeholders and the pairs. An EN/DE table of every changed row in the PR body.
3. **"feat(i18n): the built-in statuses and the calendar summaries in the server's
   language"** — **closes #536, #562, #569**. Backend: the three seed labels and the
   three calendar suffixes live in `strings.json` (and `translations/de.json`) under keys
   resolved through `translation.async_get_translations` for `hass.config.language`,
   English fallback — the seed once at first store write (§2 item 2), the summaries once
   per projection refresh; `tests/test_frontend_registration.py`'s pin of the card's
   `BUILT_IN_STATUSES` against the backend's seed moves to the English strings. #569:
   a `name` and `description` for every one of the 41 service fields in `strings.json`
   and `de.json` (HA renders them in Developer Tools → Actions, which shows bare keys
   today). phacc for the translation loading (`tests/integration/test_translations.py`).

phacc for PR 3. Live check on the session's HA with the profile and the instance language
set to Deutsch: the card, `/haventory`, the config and options flows, a new store's
three status chips, a calendar card with `calendar.haventory`, Developer Tools → Actions
→ `haventory.item_create` — all German; switch back, all English; screenshots of both.

Validation: **waits for local validation**, and the German half is the owner's.
Handover "Validate locally": `[dev-ha]` `[browser]` the live-check list in German;
`[German]` read every screen as a German speaker — what is still wrong is a comment on
#540's PR, which the session amends before the owner merges.

### 6.D1 — D1: docs, CI and scripts

Three PRs, in order, after A6 and B5 (so the docs describe the tree that ships):

1. **"ci: retire the Scorecard badge and workflow; rework the badge row"** — **closes
   #497** to the letter of its "Done when": `scorecard.yml` deleted, the 33 open Scorecard
   alerts dismissed over the API, the CodeQL badge dropped, the header row at four
   badges, the My HA button at the head of Installation, `HACS-Custom` kept.
   **#514** in the same PR if `CODECOV_TOKEN` exists (`gh secret list`), else closed as
   not-planned with the reason.
2. **"docs: the status vocabulary is the household's; actions are `action:`"** — **closes
   #331** (the sentence is in `docs/developing.md` now, not the README — §1.4), plus the
   sweep the README rewrite named and did not do: the fifteen `service:` / `platform:`
   examples (five in `README.md`, ten in `docs/automations.md`) in Home Assistant's
   current `action:` / `trigger:` spelling; `docs/developing.md`'s `--examples-config`
   claim removed with `scripts/reload_addon.sh`'s dead flag;
   `frontend_architecture.md`'s `haventory/cleanup` command that does not exist
   (it is a `connection.subscriptions` key).
3. **"docs: one home per fact; scripts nothing calls"** — refs #230, #231. One home per
   duplicated passage: the gate block is written five times (`developing.md`,
   `CONTRIBUTING.md` byte-identically, `CLAUDE.md`, `test-haventory/SKILL.md`,
   `frontend_architecture.md`) — keep it in `CONTRIBUTING.md` and `CLAUDE.md` (the two
   files a person or a session reads first) and link from the other three; the
   bootstrap (four copies), the two test modes (four), the ".env wins over an inherited
   export" paragraph (ten: `dev_env.py` and eight docstrings and two SKILL.md — one in
   `dev_env.py`, one sentence elsewhere) and the helper-script list (two) go to
   `docs/developing.md`. The stale claims the cuts left behind: A3's health line, A5's
   rate-limit references, B1's `pendingOps` and `retry_after`, B3's "three editor hosts"
   and the two-breakpoints passage; `dev/release_testing_plan.md`'s health oracle on
   thirteen lines (F2 exists only for it) restated as counts. Scripts: delete
   `stress_test.py`, `ws_probe.py`, `ws_subscribe.py` (its `watch` moves into the skill's
   `driver.py` if not already there), `create_test_items.py`, `build_frontend.sh`,
   `test.sh`, `lint.sh`, `test_frontend.sh`, `test_online.sh`; keep `setup.sh` and
   `ci_local.sh` (what `CONTRIBUTING.md` points a contributor at), the CI-used four, the
   brand renderer and `dev_env.py`; `probe_attachments.py`, `probe_fixtures.py` and
   `smoke_online.sh` wait for #276's validation run to decide. `test_toolchain_pins.py`
   registers `setup.sh` and `test_frontend.sh` as Node-pin sites and counts Python-version
   spellings per doc file — it moves with every deletion and merge, and is the proof.
   Also check whether `labeler.yml` and the `labels` workflow still earn their place
   (the notifier labels come from `.github/labels.yml`, which stays).

No phacc (PR 3's script deletions are dev-only). Live check: `tests/test_docs_links_offline.py`,
`test_docs_contract_offline.py` and `test_toolchain_pins.py` green; the My HA button
resolves; the `run-haventory` and `test-haventory` SKILL.md files still describe a
recipe that works (drive one command from each against the cloud HA).

Validation: merged on the cloud's evidence. Handover "Test this by hand": `[owner]` read
the README's Installation and Automations sections once more as a stranger.

### 6.Z — Z: the online regression, jank and usability pass (Fable 5, local)

Start condition: A7's collapse PR is merged (after the owner's go and the rehearsal),
every V0.8.0 issue is closed or re-milestoned with a reason, no Dependabot PR is open
against the milestone; release-please's 0.8.0 PR may be open but **is not merged**.

The session is the V0.7.0 plan's S11 again, against a tree that has lost a fifth of its
backend and a tenth of its card: a clean, realistic instance seeded through
`import/execute` (German and English names, photos, custom statuses, check-outs,
inspections, month-end reminders, a to-do bridge); every automated regimen the repo has,
stopping to file on the first red (the offline gates, the stress regimen minus
`ratelimit` if A5 deleted it, the live-update smoke in Chromium and Firefox, the online
WS smokes, the visual pass in both themes, the lifecycle probe); the product driven the
way a household uses it at desktop and 375 px, English and German, light and dark —
with **0.7.0 as the control** (the tagged image or a worktree at the tag) and the
question for every screen "does anything look or behave differently, and was that
intended by a §6 package?"; then D7/D8/E3/E4 against v1 if A7's handover left them
open.

Outputs: every finding is an issue (bug template, reproduction, screenshot), milestoned
V0.8.0 if it should ship in 0.8.0, V0.9.0 if it is the clean candidate's, otherwise
unmilestoned or not filed; a small, obvious, test-covered fix ships as its own PR; the
closing comment on #236's V0.8.0 line sums the counting tables from every PR body; the
last PR deletes `dev/V0_8_0_implementation.md`.

Model: Fable 5, effort `xhigh`. Go deep on the flows a household hits daily before going
wide.

Handover hand-tests: `[phone]` the card on a real phone in the companion app — add an
item with a photo, search, check out, the organize dialog; `[German]` the whole product
once in German; `[owner]` the production store after the 0.8.0 upgrade (counts,
spot-checks, export diff) and the watch window's start.

## 7. Why the order is what it is

- **A1 first in its lane**: every later backend PR's tests run on the stub it rewrites,
  and it carries the cloud HA recipe every session after relies on.
- **A2 before A3**: the public location accessors A2 adds are what lets A3 retire the
  debug accessor from production; A2's smaller `ws.py` is what A3 and A5 edit.
- **A3 before A4**: A4's predicate list reshapes the scan that A3 makes authoritative;
  the benchmark runs in A3 and is re-run in A4, so a regression is attributable.
- **A4's clock change in its own PR, third**: it is the one user-visible change in the
  lane (a badge flips at local midnight instead of UTC midnight) and wants its own
  validation entry.
- **A5 after A4, before A6**: the rate-limiter removal touches `config_flow.py`,
  `diagnostics.py` and the card; A6's lifecycle edits and B2's reader deletion want it
  settled. It is the one PR in lane A the owner merges, so nothing stacks on it.
- **A6 late**: its test folds (T5/T6) rewrite files every earlier backend PR touched;
  doing them last means doing them once.
- **D1 after both lanes' code sessions**: the docs describe the tree that ships, and
  `test_docs_contract_offline.py` / `test_docs_links_offline.py` are the proof.
- **A7 last**: #229's own rule — the collapse lands on a tree that has stopped moving —
  and the rehearsal is the owner's store.
- **B1 first in its lane**: the dead chain and the comment sweep touch the same files B3
  and B4 rewrite; removing first means rewriting less.
- **B2 before B3**: B3's workspace class calls the store through the helpers B2
  introduces.
- **B3's discard PR before its workspace PR**: the three private confirms are what keep
  the shell's and the full view's editor halves from being identical.
- **B3 before B4**: the dialog chrome adopters include the confirm B3 routes everything
  through; the location picker B4 builds is bound from the workspace B3 owns.
- **B5 last among the card sessions**: #542's key folds retarget call sites B3 and B4 have
  just moved; landing the folds after means each call site moves once. And the German
  review (#540) reads the final screens.
- **Lanes over a single serial run**: the two lanes share three PRs' worth of files; the
  rest is disjoint, and a cloud session costs the owner one paste either way.

## 8. The prompts

Each prompt is pasted as the first message of a new cloud session (§8.V: a local
session). Before pasting: set the model and effort named on the first line; for lane B
sessions after A3 or A5 merged, nothing extra — the prompt says to rebase.

### 8.A1

```
Model: Opus 5, effort xhigh. Cloud session.

You are session A1 of the V0.8.0 plan, dev/V0_8_0_implementation.md in this repository —
read it in full first (§3, §5 and §6.A1 are yours), then CLAUDE.md and CONTRIBUTING.md.
Start condition: release-please's 0.7.0 PR has merged (`gh pr list` shows no
`chore(main): release` PR open; `git log` shows the release commit) and no V0.8.0 PR is
open. If the condition fails, stop and say what you found.

First, prove the cloud Home Assistant recipe in §3: boot it, onboard it, add the
HAventory entry, open the card through the live-update smoke. Record the outcome, the
boot time and any change the recipe needed as the first paragraph of your handover.

Then the two PRs of §6.A1 in order, under §5's rules: the debounced persist path nothing
calls, and the stub that conforms (with the stub-compat branches, `areas.py` and the
harness's own tests going). Issue #230's items 3 and 6 and the 2026-08-22 comment on #230
(BE-LIFE-L1/L2, BE-WS-C4, TESTS-T1/T7) carry the file-by-file lists; grep for the symbol,
never the line. phacc is required for both PRs. Self-merge under §5 when green.

End with the six-part handover of §5, repeated in each PR body.
```

### 8.A2

```
Model: Opus 5, effort xhigh. Cloud session.

You are session A2 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§3, §5, §6.A2), then CLAUDE.md and CONTRIBUTING.md, then A1's handover (the PR bodies
of A1's two merged PRs) for the cloud HA recipe's outcome. Start condition: A1's PRs
are merged and no lane-A PR is open.

Four PRs in §6.A2's order: one door for every broadcast; one tail for every single-item
mutation (closing #565 as its own commit); services and WebSocket sharing one op table;
the tags guard (#567) and uniform `object` typing. The 2026-08-22 comment on #230
(BE-WS-C1/C5/C6/C7/C8, BE-MODELS-C1) carries the measured lists. The WS contract docs
move with PR 4 in the same PR. phacc is required for PRs 2–4; the live checks in
§6.A2 run on the cloud HA (every service's response envelope recorded in the PR body).
Self-merge under §5 when green.

End with the six-part handover.
```

### 8.A3

```
Model: Opus 5, effort xhigh. Cloud session.

You are session A3 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§3, §5, §6.A3), then CLAUDE.md and CONTRIBUTING.md, then A2's handover. Start
condition: A2's four PRs are merged, no lane-A PR is open, and no lane-B PR touching
hv-diagnostics-panel.ts, host-surfaces.ts or src/i18n/ is open (check `gh pr list`; if
one is, do PRs 1 and 3 first and open PR 2 when it has merged).

Three PRs in §6.A3's order: the text index goes after the benchmark says the scan is
under budget (first commit is the benchmark; both numbers in the PR body); index health
becomes a test fixture, with its card half and `health.py` to RETIRED_PATHS; the
repository's own copies (one chain walk, from_dict, the count helpers, the docstring that
states the opposite of the invariant). The 2026-08-22 comment on #230 (BE-REPO-1..8)
carries the lists. phacc for all three. Self-merge under §5 when green.

End with the six-part handover.
```

### 8.A4

```
Model: Opus 5, effort xhigh. Cloud session.

You are session A4 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§3, §5, §6.A4), then CLAUDE.md and CONTRIBUTING.md, then A3's handover. Start
condition: A3's PRs are merged and no lane-A PR is open.

Four PRs in §6.A4's order: every field rule once (closing #566 as its own commit); the
predicate list (re-run A3's benchmark); one household day (closing #568 — read its
body and the 2026-08-22 comment on #230, BE-MODELS-C3/C4/C5/C8); the field catalog, if it
pays for itself. PR 3 is user-visible: a date-derived badge and sensor flip on the
instance's local midnight, not UTC's. Run its live check on the cloud HA with a
non-UTC time zone as §6.A4 describes; if you cannot produce that evidence, leave PR 3
open with "validation pending" and its "Validate locally" steps, and do not stack PR 4
on it. phacc for PRs 3 and 4.

End with the six-part handover.
```

### 8.A5

```
Model: Opus 5, effort xhigh. Cloud session.

You are session A5 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§2 item 1, §3, §5, §6.A5), then CLAUDE.md and CONTRIBUTING.md, then A4's handover.
Start condition: A4's PRs are merged (PR 3 may be open awaiting validation — that is
fine, it does not touch your files), no lane-A PR touching config_flow.py,
diagnostics.py or the card's store is open, and no lane-B PR touching
src/store/store.ts, src/ui/banners.ts or src/i18n/ is open.

One PR: remove the rate limiter, every site the 2026-08-22 comment on #230 (BE-WS-C2,
BE-LIFE-L8, I18N-I4, TESTS-T4) enumerates — backend, card, strings, docs, skills,
tests — with `rate_limit.py` added to RETIRED_PATHS and the edge case that an entry
still carrying the nine option keys sets up cleanly. (If the owner's pre-flight chose
to shrink instead, the PR is BE-WS-C3: one global command bucket, three options,
`retry_after_ms` emitted.) phacc required. Bring the PR to everything green with the
options-form and card evidence from the cloud HA in the body, write the handover, and
**stop — the owner merges this PR.**

End with the six-part handover.
```

### 8.A6

```
Model: Opus 5, effort xhigh. Cloud session.

You are session A6 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§2 item 9, §3, §5, §6.A6), then CLAUDE.md and CONTRIBUTING.md, then A5's handover.
Start condition: the owner has merged A5's PR and no lane-A PR is open.

Three PRs in §6.A6's order: the manifest readers, the /local path and the unreachable
checks; the attachment directory (#333, option 2); the test folds (and the ten offline
frontend twins if pre-flight item 9 is yes). The 2026-08-22 comment on #230
(BE-LIFE-L4/L5/L7, TESTS-T5/T6) carries the lists. phacc for all three. Self-merge under
§5 when green.

End with the six-part handover.
```

### 8.A7

```
Model: Opus 5, effort xhigh. Cloud session.

You are session A7 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§2 item 8, §3, §5, §6.A7), then CLAUDE.md and CONTRIBUTING.md, then D1's handover.
Start condition: D1's PRs and every other V0.8.0 PR are merged (A5's by the owner), and
the only open milestone issues are #229 and whatever Z will take.

Two PRs: the schema collapse (closing #229 — its body, its 2026-08-05 notes and its
three comments are the design; §1.4 of the plan lists where the tree has moved), which
also creates the V0.9.0 milestone if absent and files the adopter-deletion issue into
it; then the import validators onto the models' validators. phacc for both; the
cloud-HA live checks in §6.A7. Bring PR 1 to everything green with the release-notes
text and the rehearsal protocol in its body, write the handover, and **stop — the
owner merges PR 1 after the rehearsal on a copy of the production store.** Open PR 2
stacked on PR 1 and leave it for the same merge.

End with the six-part handover.
```

### 8.B1

```
Model: Opus 5, effort xhigh. Cloud session.

You are session B1 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§3, §5, §6.B1), then CLAUDE.md and CONTRIBUTING.md. Start condition: release-please's
0.7.0 PR has merged and no lane-B PR is open. Lane A may be running — its files are not
yours; rebase on main before each PR.

Three PRs in §6.B1's order: the dead chain and the unused methods (issue #231 item 3 and
the 2026-08-22 comment on #231, FE-STORE-S1/S2, FE-LISTS-L1/L5/L8, FE-SHELLS-C7); the
comment sweep (the issue's three greps plus the fourth in §6.B1, then the length pass);
one store spec. Neither phacc nor a backend change is involved; the live check is the
card rendering on the cloud HA (A1's handover says whether the recipe works — if A1 has
not run yet, try §3's recipe yourself and report). Self-merge under §5 when green.

End with the six-part handover.
```

### 8.B2

```
Model: Opus 5, effort xhigh. Cloud session.

You are session B2 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§3, §5, §6.B2), then CLAUDE.md and CONTRIBUTING.md, then B1's handover. Start
condition: B1's PRs are merged and no lane-B PR is open.

Two PRs: the store's helpers (FE-STORE-S3/S4/S5/S8 in the 2026-08-22 comment on #231);
then the retry-after reader, only if A5's rate-limiter PR has merged as a deletion —
otherwise skip it and say so. PR 1's live check is the two-tab fan-out and a forced
conflict on the cloud HA; if you cannot produce that evidence, leave PR 1 open with
"validation pending" and its "Validate locally" steps.

End with the six-part handover.
```

### 8.B3

```
Model: Opus 5, effort xhigh. Cloud session.

You are session B3 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§2 item 4, §3, §5, §6.B3), then CLAUDE.md and CONTRIBUTING.md, then B2's handover.
Start condition: B2's PRs are merged or validated-and-merged, and no lane-B PR is open.

Three PRs in §6.B3's order: the discard question in one place; one item workspace for
the shell and the full view (closing #560 as its own commit, measured live first), with
one viewport watcher and one Store/theme lifecycle; the filter chrome once (closing
#231). The 2026-08-22 comment on #231 (FE-SHELLS-C1..C4/C8, FE-LISTS-L3, FE-DIALOGS-6,
TESTS-T9) carries the lists; every per-surface test id and class is a parameter. Run
the live checks on the cloud HA and put before/after screenshots at both widths and
both themes in each PR body. These PRs **wait for local validation** (§3) unless the
cloud evidence covers every step in §6.B3's "Validate locally" — leave them open with
that block filled in.

End with the six-part handover.
```

### 8.B4

```
Model: Opus 5, effort xhigh. Cloud session.

You are session B4 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§2 item 5, §3, §5, §6.B4), then CLAUDE.md and CONTRIBUTING.md, then B3's handover.
Start condition: B3's PRs have merged (after their local validation) and no lane-B PR
is open.

Four PRs in §6.B4's order: one modal chrome; the widgets written twice (closing #559 as
its own commit — a roving tabindex on the tree); one row chrome; an item's id readable
and copyable (#546, if pre-flight item 5 is yes). The 2026-08-22 comment on #231
(FE-DIALOGS-1..5/7a, FE-LISTS-L2/L6) carries the lists. Live checks on the cloud HA with
screenshots; the PRs **wait for local validation** unless the cloud evidence covers
§6.B4's "Validate locally" block.

End with the six-part handover.
```

### 8.B5

```
Model: Opus 5, effort xhigh. Cloud session.

You are session B5 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§2 items 2 and 3, §3, §5, §6.B5), then CLAUDE.md and CONTRIBUTING.md, then B4's
handover. Start condition: B4's PRs have merged, A3's health PR and A5's rate-limiter
PR have merged (they delete dictionary keys you would otherwise fold), and no PR
touching src/i18n/ or strings.json is open.

Three PRs in §6.B5's order: #542 (the unused-key test, the hv.field.* namespace and the
merge map in the 2026-08-22 comment on #542); #540's wording corrections per pre-flight
item 3 — everything green, the EN/DE table of changed rows in the body, then **stop on
that PR: the owner merges it**; the server's language for the built-in statuses and the
calendar summaries, plus the service field descriptions (#536, #562, #569). phacc
for PR 3. Live checks in German on the cloud HA with screenshots; PRs 1 and 3 **wait for
local validation** unless the cloud evidence covers §6.B5's block.

End with the six-part handover.
```

### 8.D1

```
Model: Opus 5, effort xhigh. Cloud session.

You are session D1 of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§2 item 7, §3, §5, §6.D1), then CLAUDE.md and CONTRIBUTING.md, then A6's and B5's
handovers. Start condition: A6's and B5's PRs are merged (B5's #540 PR by the owner) and
no V0.8.0 PR other than A4's or B-lane validation-pending ones is open.

Three PRs in §6.D1's order: #497 (and #514 if the secret exists, else close it as
not-planned with the reason); #331 and the `action:` sweep; one home per fact and the
docs every cut moved (the 2026-08-22 comment on #230 carries the docs-and-scripts
measurement, DOCS-*). `tests/test_docs_links_offline.py` and
`test_docs_contract_offline.py` are your proof; run the backend gate on every README
edit. Self-merge under §5 when green.

End with the six-part handover.
```

### 8.V — a local validation session

```
Model: Opus 5, effort xhigh. Local session.

You are a validation session for the V0.8.0 plan, dev/V0_8_0_implementation.md — read
§3 and §5, then CLAUDE.md. The PRs to validate are: <PR numbers>. For each, read its
body's "Handover → Validate locally" block, check out the branch in a git worktree (the
memory notes on this host: UV_LINK_MODE=copy, a fresh npm ci, the hand-rolled docker cp
deploy), deploy it to the dev Home Assistant, and run every step with the run-haventory
skill's harnesses, recording the result beside each step in a PR comment with
screenshots where the step names one. If every step holds and CI is green, squash-merge
the PR and delete the branch; if a step fails, do not merge — file the defect if it is
new, comment on the PR with what failed, and stop on that PR. Restore the dev HA's data
and profile language afterwards and say so.

End with a short handover: merged / not merged and why, and the state of the dev HA.
```

### 8.Z

```
Model: Fable 5, effort xhigh. Local session.

You are session Z of the V0.8.0 plan, dev/V0_8_0_implementation.md — read it in full
(§6.Z, §5), then CLAUDE.md, CONTRIBUTING.md and dev/release_testing_plan.md. Start
condition: every V0.8.0 issue is closed or re-milestoned with a reason, every V0.8.0 PR
including A7's collapse is merged, no Dependabot PR is open against the milestone;
release-please's 0.8.0 PR may be open and is not merged.

Deploy main to a clean dev Home Assistant and spend the whole session finding what is
wrong with it, with 0.7.0 as the control: the regimens, then the product as a household
uses it, in the order and with the priorities §6.Z gives. File every finding that clears
CLAUDE.md's bar; ship a fix only when it is small, obvious and test-covered. Close with
the comment on #236 that sums every PR's counting table, and the PR that deletes
dev/V0_8_0_implementation.md.

End with the six-part handover.
```

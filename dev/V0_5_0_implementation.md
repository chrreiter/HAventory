# V0.5.0 — implementation plan

Status: **planned**. Covers every issue in
[milestone V0.5.0](https://github.com/chrreiter/HAventory/milestone/6) — 15 open issues,
none closed — and nothing else. Baseline is `main` at `17dc662` (release 0.4.2), offline
suite **752 passed / 22 skipped**, both gates green.

The milestone's own description reads "Backend fixes". That undersells it: five of the
fifteen change the WebSocket contract, four touch the card, and three are CI or test-only.
This document assigns each one to a session, fixes the order the dependencies actually
require, says where a cloud session has to stop and hand over to a local one, and ends
with the paste-ready prompt each session is started from (§7).

Delete this file in the PR that closes the last V0.5.0 issue — a plan left behind reads as
pending work.

---

## 1. The fifteen issues

| # | Title (short) | Kind | Effort | Session |
|---|---|---|---|---|
| [#356](https://github.com/chrreiter/HAventory/issues/356) | Nothing guards the Python floor's copies | ci | S | **W0** |
| [#355](https://github.com/chrreiter/HAventory/issues/355) | CodeQL analyses Python on 3.12 while the floor is 3.14 | ci | S | **W0** |
| [#358](https://github.com/chrreiter/HAventory/issues/358) | Clear the open Dependabot PRs; stop the HA-floor pins from being bumped | ci | S | **W0** |
| [#197](https://github.com/chrreiter/HAventory/issues/197) | WS API input hardening (caps, cursors, op_ids, unknown keys, typed frames) | backend | M | **W1a** |
| [#293](https://github.com/chrreiter/HAventory/issues/293) | Two `ws.py` type guards unreachable behind their own schemas | backend | S | **W1a** |
| [#195](https://github.com/chrreiter/HAventory/issues/195) | `import/preview`: warn on name↔id collisions | backend + card | M | **W1a** |
| [#194](https://github.com/chrreiter/HAventory/issues/194) | Area filter on `haventory/subscribe` | backend + card | S–M | **W1b** |
| [#365](https://github.com/chrreiter/HAventory/issues/365) | Quick-filter pills: integration-wide default in the options flow | backend + card | M | **W1c** |
| [#298](https://github.com/chrreiter/HAventory/issues/298) | Free hex colours for custom statuses | backend + card | M | **W1c** |
| [#193](https://github.com/chrreiter/HAventory/issues/193) | Category and tag facet tallies ignore the active filter | backend + card | M | **W2** |
| [#192](https://github.com/chrreiter/HAventory/issues/192) | Multi-select for categories and locations in filters | backend + card | M–L | **W2** |
| [#204](https://github.com/chrreiter/HAventory/issues/204) | Design: should items be sortable by area? | backend + card | S | **W2** |
| [#357](https://github.com/chrreiter/HAventory/issues/357) | Offline WS tests: 22 private `_send()` helpers | tests | M | **W3** |
| [#307](https://github.com/chrreiter/HAventory/issues/307) | Consolidate the card's component-test harness | tests | M | **W3** |
| [#200](https://github.com/chrreiter/HAventory/issues/200) | Persistence scaling: every mutation rewrites the whole blob | backend | M | **W3** |

Seven of them carry **Implementation notes** written into the issue on 2026-08-05 (#197,
#195, #194, #193) or a triage comment that decides something (#307, #298, #204). Those
notes are the design; this plan sequences them and does not restate them. Read the issue
before writing code.

### The issue bodies are a starting point, not a specification

Every file reference in them was taken between 2026-08-05 and 2026-08-10, and several no
longer point where they say. Two confirmed:

- #293's `ws.py:1890` (the `filter must be an object` guard) is now **`ws.py:2256`**, inside
  `ws_export`.
- #293's `ws.py:234` (`operations must be a list`) is now **`ws.py:258`**, inside
  `_validate_bulk_ops`.

Grep for the symbol or the message string, never for the line. The same applies to #365's
`index.ts:32-47` / `haventory-panel.ts:127-139` and #197's `repository.py:1773`.

The same goes for the prose. Where an issue's description of the code has gone stale, **the
session decides against the code and records the decision in its PR body** — it does not
stop to rewrite the issue. #204 is the clearest case (§6.5): its premise describes a
behaviour the tree does not have, and the answer follows from what is actually there.

---

## 2. Scope

All fifteen are in scope, and none of them needs a decision before work starts.

[#236](https://github.com/chrreiter/HAventory/issues/236)'s "Post-release (explicitly not
gating)" line still names #192, #200, #204 and #298. **That staging is obsolete** (owner,
2026-08-11) — the milestone is the assignment, and a comment on #236 records it. Ignore any
post-release framing those four still carry, in the tracker or in their own triage comments;
#298's "recommended placement is the unmilestoned backlog" is superseded by the same
decision.

---

## 3. Waves and sessions

Six cloud sessions across four waves. A **wave is a barrier**: a wave starts only when
every PR of the wave before it is merged into `main`. A session lives entirely inside one
wave — it never waits mid-flight for a sibling's PR, and everything it builds on is merged
before it starts. The only concurrency is inside wave 1, whose three sessions are split so
that no two of them edit the same function (§3.3).

### 3.1 The map

```
wave 0   W0    #356 (+#355 folded in) → #358      toolchain & CI floors — everything waits
────────────────────────────────────────────────────────────────────────────────
wave 1   W1a   #197 + #293  →  #195               input validation & import safety
(three   W1b   #194                               area-filtered subscriptions
 parallel) W1c #365  →  #298                      options surface & status colours
────────────────────────────────────────────────────────────────────────────────
wave 2   W2    #193  →  #192  →  #204             facets, multi-select, location sort
────────────────────────────────────────────────────────────────────────────────
wave 3   W3    #357  →  #307  →  #200             test harness, then persistence
```

Critical path: **W0 → the slowest wave-1 session → W2 → W3**. W1a is the likely slowest of
wave 1; W1b almost certainly finishes first and simply ends — its session does not pick up
more work.

### 3.2 Why the order is what it is

- **Wave 0 first, alone.** #358 merges the python-dev Dependabot group, which moves ruff
  0.15.22 → 0.16.1, and ruff 0.16.1 raises five findings the current tree does not have
  (`RUF036` ×4 in `repository.py`, `PLR0917` in `tests/conftest.py`). Landing that
  mid-stream turns every other session's branch red on lint through no fault of its own.
  W0 is ≲ a day; everyone waits for it.
- **#197 before wave 2.** #197 introduces `validate_item_filter` in `models.py`, keyed off
  `ItemFilter.__annotations__`, and starts rejecting unknown filter keys. #192 adds
  `categories` / `location_ids` to `ItemFilter`; #193 adds a filter argument to
  `distinct_values` that routes through the same validator; #204 adds a sort field that
  `validate_sort` then has to accept. In this order all three are free; in the other order
  each of them ships something #197 must be taught about, and there is a window where the
  card sends a key the server refuses.
- **#194 and #298 before #192.** #194 and #192 both edit `_item_matches_filter`
  (`ws.py:621`). #298 changes `statusToneClass()`'s contract — from "returns a class" to
  "returns a class *or* sets an inline custom property" — and its two call sites
  (`hv-filter-chips.ts:105`, `hv-filter-panel.ts:725`) sit in the two files #192 rewrites.
  In a concurrent split those are live collisions needing rebase rules; the barrier simply
  serializes them — both are merged before W2 writes a line.
- **Wave 3 last.** #357 rewrites the private `_send` helper in 22 offline test files; #307
  rewrites `mount` / `q` / `all` / the cssText reader in 22 card test files. Every other
  session adds tests to those files. Running the consolidation last migrates everything
  this milestone wrote in one pass; running it earlier guarantees conflicts.

### 3.3 Wave 1 — the only concurrency, verified

Wave 1's three sessions are split by conflict domain. Checked file by file against the
tree at `17dc662`: sharing a file is not a conflict, sharing a *region* is, and no shared
region remains.

| File | W1a | W1b | W1c |
|---|---|---|---|
| `ws.py` | schemas of `item/list`, `location/tree`, `export`, `items/bulk`; `_validate_bulk_ops` (258) | `_item_matches_filter` (621), subscribe schema (1064) | `ws_config` (835) |
| `models.py` | caps near `NAME_MAX_LENGTH` (74), `validate_custom_fields` (364), `_validate_optional_text` (649) | — | `validate_status_definition` (440) |
| `store/types.ts` | — | subscription options | `IntegrationConfig` (285-292), state slice (~618-630) |
| `store/store.ts` | — | `openSubscriptions` (542) | `refreshConfig` (922) |
| `src/test.utils.ts` | mock caps | subscribe mock honours `area_id` | mock config carries the pill list |
| `docs/*.md`, `README.md` | caps, cursors, typed frames | `subscribe.area_id` | README quick-filters |

All separate functions or separate regions. The discipline that keeps it that way: rebase
on `origin/main` before every push, and keep new code inside the named function rather
than at the top of the file, where additions stack. The docs rows are prose — a conflict
there resolves by hand and means nothing.

### 3.4 If the waves feel slow

The barrier trades a little wall-clock for the coordination rules it deletes. Only these
shortcuts stay safe:

- **Wave 2's strict prerequisites are #197+#293, #194 and #298 on `main`.** #195 and #365
  are not among them, so W2 may start while those two PRs are still in review. Use this
  only if wave 1's tail is dragging.
- **#200 can leave W3 and become its own session** any time after #197 is merged. It is
  the only package touching `storage.py` and `__init__.py`'s persistence helpers and
  shares no region with anything else. The cost: its before/after numbers then describe a
  midpoint of the milestone rather than the finished set — a reporting loss, not a
  correctness one.
- **#357 and #307 cannot move forward** under any arrangement — they rewrite the files
  every other package adds tests to.

---

## 4. Rules every session follows

**Branches and PRs**

- One branch per PR, named `claude/v0-5-0-<session>-<topic>` (e.g.
  `claude/v0-5-0-w1a-input-hardening`). A session may open several; keep each one to a
  reviewable diff.
- Branch off the current `origin/main`, never off a sibling session's branch. Within a
  session, a later PR may stack on the session's own earlier branch; rebase onto `main`
  as each earlier PR merges. When an upstream PR merges,
  `git fetch origin main && git rebase origin/main`.
- PR titles are **Conventional Commits**. The repository squash-merges, so the PR title
  becomes the squashed commit message and release-please reads it for the changelog. A
  wrong title is a wrong changelog entry.
- Link the issue in the PR body (`Closes #NNN`) and fill in the template at
  `.github/pull_request_template.md`.

**Merging — the hard rule**

> **No session merges its own PR.** Not `merge_pull_request`, not auto-merge, not a squash
> from the CLI. A session's job ends at: branch pushed, PR open, CI green, review comments
> answered. The owner merges.

If CI is red, fix it and push again — that is still the session's work. If CI is red for a
reason that reproduces on `main`, say so in the PR thread once and carry on.

**Issues are read, not rewritten**

A session does not edit an issue body to correct a stale line number, a drifted symbol name
or a description that no longer matches the code. It decides against the code and records
the decision in the PR body. A short issue comment is worth writing only when the decision
changes *what the issue asked for* — a different mechanism, or a smaller scope than the
issue describes. Everything else belongs in the PR, where a reviewer is already reading the
diff it explains.

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

**The in-process HA suite** (`scripts/test_integration.sh`) provisions `.venv-integration`
from `requirements-integration.txt`. PyPI and the npm registry are both reachable from the
cloud environment, so this is expected to work; the first session to need it confirms that
and records the result in its PR body. If provisioning fails, that becomes a handover item
rather than a skipped check — the phacc mode is the only place the voluptuous schemas are
actually applied, so anything about frame typing is asserted there or not at all.

**Conventions that bite in this milestone specifically**

- Contract changes update `docs/backend_api_contract.md` and `docs/data_shapes.md` **in the
  same PR**. Five of the fifteen change the contract.
- Deleting or renaming any file under `custom_components/haventory/` means appending its old
  path to `RETIRED_PATHS` in `stale_files.py` in the same PR.
- TDD: happy path plus at least one edge or error case, every time.
- No `TODO`/`FIXME` in committed code. Out-of-scope findings go in the PR's **Follow-ups**
  note, and become issues only if they can matter in a real install.
- Comments encode constraints, not history. No references to what a thing replaced, no
  milestone or work-package numbers, no stock review vocabulary.

---

## 5. Handover to a local session

Cloud sessions have no Home Assistant. Several items in this milestone can only be finished
in front of a running one — the dev Docker instance the `run-haventory` and `test-haventory`
skills drive.

**Protocol.** When a session reaches something it cannot verify, it:

1. Finishes and pushes everything that does not depend on the answer.
2. Appends a handover section to **`dev/v0_5_0_handover_prompts.md`** (create it on first
   use; delete it with this plan when the milestone closes) using the template below.
3. Names the handover in the PR body under **Live verification**, so a reviewer sees the PR
   is complete-but-unverified rather than complete.
4. Does **not** block on it. A handover that comes back with a problem is a follow-up
   commit on the same branch.

**Template** — one section per handover, appended in session order:

```markdown
## H<n> — <issue #> <one-line subject>

**Branch / PR**: `claude/v0-5-0-...` / #NNN
**Why this needs a real HA**: <the specific thing offline cannot show>

### Setup
    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs
    <any seeding: driver.py calls, import of a fixture document, ...>

### Steps
1. ...
2. ...

### What "pass" looks like
- <observable, specific — a log line absent, a chip legible, a number that moves>

### What to send back
- <screenshot / log excerpt / stress-run table>
- Paste the result as a comment on #NNN and reply on the PR thread.
```

**The handovers this milestone is expected to produce** — nine, listed here so the local
session can be booked once rather than nine times:

| H | Issue | Session | What only a real HA shows |
|---|---|---|---|
| H1 | #197 | W1a | That widened frames stop `websocket_api.http.connection` logging the client payload at ERROR. The log line comes from HA core. |
| H2 | #195 | W1a | Importing a backup onto an inventory whose locations were rebuilt by hand, and reading the warning block in the import sheet. |
| H3 | #194 | W1b | Two dashboards, one filtered to an area: a mutation outside that area must produce no event on it. |
| H4 | #193 | W2 | The expanded sidebar with the low-stock filter on — Categories and Tags now move with it the way Locations does. Screenshot, both themes. |
| H5 | #192 | W2 | Multi-select interaction in the filter panel and the sidebar, and that the two agree. |
| H6 | #365 | W1c | How HA renders a multi-pick selector inside an options flow, and that the sidebar panel honours the stored value. |
| H7 | #298 | W1c | Chip legibility at a user-chosen hex in light and dark, against a non-default HA theme. |
| H8 | #200 | W3 | Before/after `stress.py` numbers at 250 / 500 / 1000 items — the only measurement that answers whether the fix worked. |
| H9 | #204 | W2 | That a location-ordered list paginates correctly past the first page against a real store. |

H8 is the one that gates its own issue: #200 without a measured before/after is a change
nobody can evaluate. The rest are confirmations, and their PRs can be reviewed without them.

---

## 6. The work packages

### 6.1 W0 — Toolchain & CI floors (wave 0)

**Issues**: #356, #355, #358. **Starts**: immediately. **Blocks**: every other session.
**Handovers**: none.

The order is from #356's own note — the guard first makes #355 a one-line change the guard
then defends, and #358 moves the ruff pin the guard also defends.

**PR A — `fix(ci): guard the Python floor's copies` (#356, with #355 folded in)**

A test shaped like `tests/test_min_ha_version.py`: read `requires-python` from
`pyproject.toml` as the single source, enumerate every copy explicitly, fail when one
disagrees. Known copies today:

- `pyproject.toml:51` ruff `target-version = "py314"`
- `pyproject.toml:89` mypy `python_version = "3.14"`
- `.github/workflows/ci.yml:26` backend matrix
- `.github/workflows/codeql.yml:35` — currently `"3.12"`, which is #355. Fold the fix in:
  landing the guard first with that site expected-fail, then flipping it in a second PR,
  splits a one-line change across two PRs for no reader's benefit. Keep them separable
  only if the owner asks.
- `README.md` (8 sites), `CONTRIBUTING.md:24`

For #355 itself: raise `codeql.yml`'s pin to 3.14 **or** drop `setup-python` from the
Python leg — the job never installs the project and `build-mode` defaults to `none`.
Decide one; do not leave both. Then read the
[code-scanning status page](https://github.com/chrreiter/HAventory/security/code-scanning/tools/CodeQL/status/)
and record in the PR body which 16 files go unscanned and what the 6 raw diagnostics say.
**If a shipped module under `custom_components/haventory/` is among the unscanned, that is
the real finding** — say so in the issue and retitle it rather than closing on the pin fix.

Two siblings, both cheap and both real gaps — fold them in and say so in the PR body:

- **Node**: `engines: "^22.13.0 || >=24"` in `cards/haventory-card/package.json` versus the
  hardcoded `[ '22', '24' ]` frontend matrix in `ci.yml:121`. Nothing ties them.
- **ruff**: `pyproject.toml:25` pins `ruff==0.15.22` and `.pre-commit-config.yaml` repeats
  it. `CLAUDE.md` states the two must move together and no test enforces it — #358 is about
  to move that pin, which is exactly when the gap costs something.

Carry the "add a new copy to this test or don't write it" rule into `CLAUDE.md` next to the
sentence that already states it for the HA floor.

**PR B — the Dependabot sweep (#358)**

Not one PR — four dispositions on existing PRs, plus one config change:

| PR | CI as of 2026-08-11 | Action |
|---|---|---|
| [#321](https://github.com/chrreiter/HAventory/pull/321) actions group ×8 | all green | ready to merge — **owner merges**, session confirms green after rebase |
| [#259](https://github.com/chrreiter/HAventory/pull/259) aiohttp 3.14.3 | all green | same |
| [#320](https://github.com/chrreiter/HAventory/pull/320) python-dev ×8 (ruff 0.16.1) | `backend (3.14)` ✗, `integration` ✗ | push fixes to the Dependabot branch, then owner merges |
| [#155](https://github.com/chrreiter/HAventory/pull/155) home-assistant-frontend | `integration` ✗ | **close as not-planned**, with the ignore rule in the same change |

#320's five findings, all confirmed present in the tree today:

- `RUF036` — `None` not last in a union: `repository.py:706`, `:726`, `:1872`, `:1873`.
  `ruff check --fix` handles all four.
- `PLR0917` — `tests/conftest.py:517` carries `# noqa: PLR0913`, which does not cover
  `PLR0917`. Hand-extend the noqa.

Also bump `.pre-commit-config.yaml`'s ruff pin in the same push — Dependabot's `uv`
ecosystem does not see it, and PR A's new guard will catch it if you forget.

#320's `integration` leg fails one assertion over a pinned dependency list (43 passed, 1
failed). **Confirm whether that is `tests/integration/test_frontend.py::test_the_frontend_wheel_matches_what_this_ha_release_asks_for`** before merging — if it is, #320 carries part of
#155's problem and the frontend pin has to come back out of the group.

#155 must not merge: `requirements-integration.txt` pins
`home-assistant-frontend==20260527.4` because that is the wheel HA 2026.6.0's own manifest
asks for, and the test compares the two. The pin moves when the HA floor moves, never on its
own. `.github/dependabot.yml` has no `ignore` under the `uv` entry, so the PR reopens
weekly — add `home-assistant-frontend` **and** `homeassistant` to an ignore list there in
the same change. Relates to #210's Dependabot item; note it there, do not fix it here.

**Exit**: all four Dependabot PRs resolved (three merged by the owner, one closed with the
ignore rule landed), the floor guard fails on a hand-broken copy, CodeQL's Python leg either
runs on 3.14 or has no `setup-python` step, and both gates are green under ruff 0.16.1.

---

### 6.2 W1a — Input validation & import safety (wave 1)

**Issues**: #197, #293, #195. **Starts**: when wave 0 is merged. **Blocks**: wave 2.
**Handovers**: H1 (#197), H2 (#195).

#197 has the fullest implementation notes of any issue in this milestone — approach, file
list, test list, verification, sequencing. Follow them; they are a design, not a sketch. Two
things in them are now stale and one is now unblocked:

- **Unblocked**: the notes say the `load_state` parity half waits on #228. **#228 is closed
  (completed, V0.3.3).** The `load_state` half can land in this milestone. Decide
  deliberately whether to take it — the notes deliberately kept it out of #197's PR, and it
  is the half most likely to surprise a real store.
- **Stale**: `repository.py:1773` (`name=str(...)` in `load_state`) has drifted; `load_state`
  is now at `repository.py:2203`.

**PR A — `fix(ws): bound and type the WebSocket inputs` (#197 + #293)**

The two belong together: #293's `filter must be an object` guard sits in `ws_export`
(`ws.py:2256`), and #197 replaces exactly that check with `validate_item_filter`. Fixing
#293 separately means writing a guard decision that #197 then deletes.

Five halves, per #197:

1. **Caps in `models.py`** — `DESCRIPTION_MAX_LENGTH = 4_000`, `CATEGORY_MAX_LENGTH = 120`,
   `TAG_MAX_LENGTH = 64`, `TAGS_MAX_COUNT = 50`, `CUSTOM_FIELDS_MAX_KEYS = 50`,
   `CUSTOM_FIELD_KEY_MAX_LENGTH = 64`, `CUSTOM_FIELD_VALUE_MAX_LENGTH = 1_000`, beside the
   existing `NAME_MAX_LENGTH = 120` (`models.py:74`). New `validate_tags` rather than a check
   inside `normalize_tags` — that helper also normalizes *filter* values, and a filter is not
   an item.
2. **Malformed cursors** — `_paginate` (`repository.py:2048`) raises rather than silently
   restarting at index 0 when `_decode_cursor` (`repository.py:2004`) returns `None`. Bound
   the cursor at `CURSOR_MAX_LENGTH = 2_048` before decoding; reject `""` at the WS layer;
   promote the silent "sort differs → ignore the cursor" branch to the same error.
3. **Duplicate `op_id`** — reject, do not document last-wins. `_validate_bulk_ops`
   (`ws.py:258`) already normalizes with `str(op_id)`, so `1` and `"1"` collide; carry a
   `seen: set[str]`.
4. **Unknown filter/sort keys** — `validate_item_filter` keyed off `ItemFilter.__annotations__`
   (`models.py:202`) and `validate_sort` reusing `sort_items`' `allowed_fields`
   (`models.py:1200`). Called from `ws_item_list`, `ws_location_tree`, `ws_export`.
5. **Type-loose frames** — widen `quantity`, `delta`, `operations` and required `name` to
   `object` so they route through `ws_guard` as `validation_error` instead of an HA-core
   schema ERROR. One prerequisite: `create_item_from_create` calls `name.strip()` before any
   `isinstance` check, so the type check moves ahead of the strip.

#293 on top: delete the two now-unreachable guards, then **sweep for the shape** — any
`isinstance` check in a handler against a field its own command schema already types
concretely. Every survivor gets a comment saying what it defends against;
`haventory/item/update`'s handler validation stays, because its schema types fields as
`object` and the looseness is what lets a null tag reach `normalize_tags`.

Docs in the same PR: cursor refusals and unknown filter/sort keys under `item/list`,
duplicate `op_id` under `items/bulk`, the widened frames' new error code — all in
`docs/backend_api_contract.md`; cap values, "unknown keys rejected", cursor rules in
`docs/data_shapes.md`; one line in `README.md`. Mirror the description / tag / custom-field
limits in the card's `ui/item-form.ts` `validateForm` so the editor refuses before the round
trip.

`scripts/test_integration.sh` is not optional here. The offline stub stores `_ws_schema`
without applying it (`tests/conftest.py:318-334`), so the whole of half 5 is verified in
phacc mode or nowhere. Offline tests can still assert the schema *maps* those keys to
`object`.

**PR B — `feat(import): warn when an incoming name collides with another id` (#195)**

Follow the notes verbatim. The one decision worth re-reading before writing: the check
applies only to the `add` bucket. `update`/`unchanged` are the same entity by id, so a
shared name there is an ordinary namesake and warning on it fires on healthy documents. The
regression test that matters is the clean round-trip producing **zero** warnings under every
policy — a check that fires on the normal case is worse than no check.

Warnings never touch `report["valid"]` and never reach `import/execute`. `report` carries
`"warnings": []` from construction so an invalid document returns the same shape.

**Exit**: no input the schema accepts is mis-served; a malformed cursor is an error rather
than a full page; duplicate `op_id`s reject the batch; unknown filter and sort keys are
refused by name; the widened frames answer `validation_error`; the import preview flags
name↔id collisions and stays silent on a clean round-trip; both contract docs match `ws.py`;
H1 and H2 written.

---

### 6.3 W1b — Area-filtered subscriptions (wave 1)

**Issues**: #194. **Starts**: when wave 0 is merged. **Blocks**: wave 2 (#192 edits the
same matcher). **Handovers**: H3.

One PR — **`feat(ws): filter subscriptions by area` (#194)**.

Purely additive, mirroring how `location_id` is already plumbed. `_Subscription`
(`ws.py:454`) gains `area_id: str | None`; the schema takes `vol.Optional("area_id"): object`
— `object` not `str`, matching `location_id`, so an explicit `null` clears rather than
raising. The matcher resolves through the payload's own `effective_area_id`, **not** through
the repository, so the delivery fan-out stays free of per-subscriber tree walks. Place the
area check with `inspection_overdue_only` at the top, before the `location_id` branch — that
branch returns.

Two behaviours to design in rather than discover: an item with no location has
`effective_area_id: null` and must **not** be delivered to an area-filtered subscription; and
moving a location to another area rewrites `effective_area_id` for the whole subtree while
emitting `locations/moved`, not item events, so an area-filtered items subscription sees no
departure. Document the second, do not invent a synthetic event.

Card side ships in the same PR — without it the motivating case is unchanged. Update both
contract docs in the same PR.

W1a and W1c are editing other functions in `ws.py` at the same time — rebase on
`origin/main` before every push.

**Exit**: an area-filtered subscription delivers only that area's items and never an
orphan; both contract docs match; H3 written.

---

### 6.4 W1c — Options surface & status colours (wave 1)

**Issues**: #365, #298. **Starts**: when wave 0 is merged. **Blocks**: wave 2 (#192
rewrites the two files #298 touches). **Handovers**: H6 (#365), H7 (#298).

Independent of W1a and W1b — the only shared backend file is `ws.py`, and only `ws_config`
(`ws.py:835`), which neither of them edits.

**PR A — `feat(config): offer the quick-filter pills in the options flow` (#365)**

The feature exists as a card YAML key and is unreachable on the sidebar panel by
construction — `haventory-panel.ts` renders `hv-full-view` without setting `.quickFilters`,
so the property keeps its `null` default and the panel always offers all five pills. The
options flow is the only surface that reaches both.

Precedence, copied from `index.ts:_heading()` which already resolves `title` this way:

```
card:   this.config?.quickFilters ?? store.quickFilters ?? null   // null = all pills
panel:  store.quickFilters ?? null
```

Keep `null` (unset) distinct from `[]` (an explicit choice of no pills) end to end. That
distinction is what makes every dashboard written before #241 keep all five.

Backend: `CONF_QUICK_FILTERS` / `DEFAULT_QUICK_FILTERS` and the canonical pill list in
`const.py` (beside `CONF_SIDEBAR_PANEL_ENABLED` at `:35`); the options-flow `init` step in
`config_flow.py:_options_schema`; the pill list added to `ws_config`'s payload; label and
description in **both** `strings.json` and `translations/en.json`, which mirror each other.
Decide explicitly whether the setup `user` step asks too — `card_title` does, but setup is
deliberately two fields and this has a sane default. Recommendation: **options flow only**;
setup stays short.

Frontend: `store/types.ts` (response shape and state slice), `store.ts:refreshConfig()`
(`:922` — two lines next to `cardTitle`), `index.ts` precedence, `haventory-panel.ts` passing
the store value through, and `README.md`'s `quick_filters` section, which documents it as
YAML-only.

**The cross-language pin.** The five pill names live in TypeScript only, as
`QUICK_FILTER_KEYS` in `ui/quick-filters.ts:15-21`. Putting them in the options flow means
the vocabulary exists in Python too and nothing would catch a drift — a mismatch silently
drops a pill rather than failing. Pin them the way `tests/test_frontend_registration.py`
pins `PANEL_ICON` and the bundle's exported identifier across the same boundary.

The options-flow value lands in the existing `normalizeQuickFilters`
(`ui/quick-filters.ts:33-42`) rather than growing a second set of rules: the backend's job is
to hand over a list, not to re-decide what is valid.

**PR B — `feat(status): accept a hex colour beside the ten tokens` (#298)**

The schema part is one line — `STATUS_COLORS` membership in `validate_status_definition`
becomes "a token **or** a `#rrggbb` literal", and `haventory/config` keeps reporting the
token list as the *offered* palette. Everything else is the work:

- **Ink is derived, not looked up.** Every strong fill in `ui/tokens.ts` carries a fixed ink
  token, for the reason the comment beside `--hv-on-amber` gives. An arbitrary fill needs its
  foreground computed from relative luminance — the first colour maths in the card. One rule
  (WCAG relative luminance), applied in exactly one place, the way `statusToneClass()` is the
  one place a tone is resolved now.
- **It stops deferring to the HA theme.** Every token in the card resolves a theme variable
  first. A literal hex resolves nothing, so a hex-coloured chip is the one element that
  ignores the user's theme. Say so in the UI copy; do not pretend otherwise.
- **`statusToneClass()` returns a class; a hex needs an inline custom property instead**, so
  the chip takes both paths. W2's #192 rewrites both calling files after this merges — state
  the new contract plainly in the PR body, where W2 will look.

No migration and no rewrite: the stored field is a `str` under either rule, so every document
written under the narrow rule stays valid.

Sibling stretch goal named in the issue and **dropped rather than deferred**: the full `mdi:`
icon set. Do not start it. If ten curated glyphs proves tight, the answer is thirty curated
glyphs (~3 kB), not `mdi:`.

**Exit**: pills set in the options flow change both the card and the sidebar panel, and a
dashboard naming its own `quick_filters:` still wins for that card; the pill vocabulary is
pinned across the language boundary; a household can enter an arbitrary colour, the chip
stays legible at it in both themes, and a document written before this still loads; H6 and
H7 written.

---

### 6.5 W2 — Facets, multi-select & location sort (wave 2)

**Issues**: #193, #192, #204. **Starts**: when every wave-1 PR is merged (strictly:
#197+#293, #194 and #298 — see §3.4). **Blocks**: wave 3.
**Handovers**: H4 (#193), H5 (#192), H9 (#204).

Ordered smallest-first so the shared plumbing settles before the largest diff arrives.
Everything this session builds on is already merged: W1a's `validate_item_filter`, W1b's
edit to `_item_matches_filter`, W1c's new `statusToneClass()` contract.

**PR A — `feat(ws): price category and tag facets against the active filter` (#193)**

Take the contract change. `haventory/distinct_values` (`ws.py:875` — note it is currently the
bare `{"type": ...}` form and moves to `vol.Required("type")` plus `vol.Optional("filter"):
dict`) grows an optional filter; each `categories`/`tags` entry gains `matching_count`
**beside** its existing `count`, and the list never shrinks — the same payload feeds
autocomplete and the organize dialog, which a shrinking list would starve.

`get_distinct_field_values` (`repository.py:1732`) takes `flt: ItemFilter | None = None` and
adds exactly one pass over the filtered candidates, accumulating per category key and per
tag — the shape `count_matching_by_location` (`repository.py:1698`) already uses. One pass
prices both facets.

Measure against everything active **except** `category` and `tags`, for the reason
`Store.locationCountFilters()` already drops `locationId`: feeding a facet its own selection
zeroes every other row exactly when the user wants to see where else the matches are.
`custom_field_keys` stays whole-inventory — it is a key picker, not a tally.

Because W1a landed first, the new `filter` argument goes through `validate_item_filter` like
every other filter-accepting command. Add `ws_distinct_values` to that call list.

**PR B — `feat(ws): multi-select categories and locations in filters` (#192)**

The largest diff in the milestone. Additive: new `categories: list[str]` and
`location_ids: list[str]` beside today's scalars, unioning the index buckets exactly as
`tags_any` already does. Carried through `models.ItemFilter`, `models.filter_items`
(`models.py:1040`), `repository._get_filtered_candidates` (`repository.py:1462`),
`repository.count_matching_by_location`, and `_item_matches_filter` in `ws.py` — that last
one is a separate scalar path that would otherwise drift; #194 edited it last wave, so this
builds on its merged form.

Because W1a keyed `validate_item_filter` off `ItemFilter.__annotations__`, the new keys are
accepted automatically. Add a test that asserts exactly that, so the coupling is stated
rather than incidental.

Card side per the issue: `StoreFilters`, `toWireFilter`, `activeFilterCount`,
`hv-filter-chips`, `hv-full-view`'s sidebar, `hv-filter-panel` (single-select today, and it
would otherwise disagree with the sidebar) and `hv-location-tree`'s `selectedId`. The
editor's location *picker* stays single-select. No Any/All control: an item has one category
and one location, so multi-select can only mean OR. Adopt #298's `statusToneClass()` call
shape as merged — its PR body states the contract.

**Open design question the issue leaves open**: whether one `include_subtree` flag applies to
every picked location or becomes per-entry. Recommendation — keep it **one flag for the
whole selection**. Per-entry doubles the wire shape and the matcher's branches to serve a
case ("include children of this location but not that one") nobody has asked for, and it can
be added later without breaking the single-flag form. State the choice in
`docs/backend_api_contract.md` so it is a decision rather than an omission.

**PR C — `feat(ws): order items by their location path` (#204)**

Solve it the cheapest way the current code allows, and ignore the issue's premise — it
describes an ordering the tree does not have (§1). What the code says:

- `repository.list_items` (`:1596`) delegates ordering entirely to `models.sort_items`
  (`models.py:1179`), which receives **`Item` objects and nothing else**. Any sort key has to
  be derivable from an `Item` alone.
- `Item.location_path` (`models.py:161`) is a denormalized `LocationPath` carrying a
  ready-made `sort_key` (`models.py:68`), rebuilt by the backend whenever the tree changes.
  It is right there on the item.
- `effective_area_id` is **not** on the item. It is resolved by walking the tree —
  `Repository._resolve_effective_area_id_for_location` (`:479`), reached from `ws.py`'s
  `_effective_area_id_for_item` (`:2047`). `models.py` cannot see it.
- Area *names* are further away still: they live in Home Assistant's area registry, read
  through `areas.py` from `ws.py` only (`ws_areas_list`, `:2230`). Neither `models.py` nor
  `repository.py` can reach a name.

So a true area sort costs either a resolver threaded into `sort_items` — changing a pure
function's contract — or a new denormalized field on `Item`, which is a schema change. And
even then it would order by `area_id`, since the name is unreachable: HA generates that id
from the name at creation and never changes it on rename, so a renamed area sorts under its
old name. That is a wrong-looking list produced by expensive code.

**Do this instead: add `location` to the sort vocabulary, keyed on
`item.location_path.sort_key`.** It needs no new data, no plumbing and no schema change, and
it is the ordering the Location column implies. Because an item's area is inherited from its
location tree's root, a path-ordered list groups by root — which is where the area is
anchored — so it answers most of what #204 was reaching for.

The whole change:

- `models.py:1200` — `location` joins `allowed_fields`; one branch in `sort_items` reading
  `x.location_path.sort_key`. Items with no location have `sort_key == ""` and must sort
  **last in both orders**, the rule `date_sort_key` already applies to undated items — a
  plain empty string would float them to the top of an ascending list.
- `repository.py:2014` — one branch in `_primary_sort_value` returning the same value, so
  the cursor round-trips. W1a has already made a cursor minted under a different sort an
  error, so nothing silently re-paginates.
- `store/types.ts:172` — `location` joins `SortField`.
- `store/columns.ts:31` — `sortField` union gains `'location'`; the Location column gets it,
  which is what makes its header a sort control.
- `hv-filter-panel.ts:14` — one entry in `SORT_FIELDS`.
- Both contract docs: `location` in the sort vocabulary, and the unlocated-last rule.

Record in the PR body what this deliberately does not do — sort by area — and why, so the
next reader does not re-derive the area-registry problem from scratch. H9 covers the one
thing offline tests cannot show: that a location-ordered list paginates correctly past the
first page against a real store.

**Exit**: category and tag rows read `matches / total` the way location rows do; categories
and locations multi-select and the sidebar and filter panel agree; items order by location
path with unlocated last; both contract docs match; H4, H5 and H9 written.

---

### 6.6 W3 — Test harness, then persistence (wave 3)

**Issues**: #357, #307, #200. **Starts**: when every wave-2 PR is merged. **Blocks**:
nothing. **Handovers**: H8 (#200) — this one gates its issue.

Two consolidations that must not run under active feature work, then the one structural
change whose value is a measurement.

**PR A — `test: one WebSocket send helper for the offline suite` (#357)**

Confirmed against the tree today: **22** offline test files each define a private `_send`,
across **8 distinct declaration lines** (the issue counts 14 implementations and 7
signatures — it is counting bodies and annotation-stripped signatures, not declarations;
either way the shape is the same):

| files | signature |
|---|---|
| 11 | `(hass, _id, type_, **payload)` |
| 2 | `(hass, conn, _id, type_, **payload: Any) -> dict` |
| 2 | `(hass, _id, type_, conn=None, **payload)` |
| 2 | `(hass, _id, type_, conn: object = None, **payload)` |
| 2 | `(_id, type_, **payload)` *(nested)* |
| 1 | `(hass, conn, _id, type_, **payload)` |
| 1 | `(hass, _id, type_, **payload: Any) -> dict[str, Any]` |
| 1 | `(hass, _id, type_, **payload: Any) -> dict` |

The shape decides what a test can check: the dominant variant takes no `conn` at all, so a
test in one of those 11 files cannot assert anything the handler sends on the connection
without rewriting its own file's helper first.

One `_send` — in `tests/conftest.py` (694 lines, one fixture, so there is room) or a small
`tests/ws_helpers.py` — with `conn` a first-class optional argument and the **full result
envelope** as the return value, so any test can assert on either. Migrate all 22 files and
delete the local copies. The measure of done is that the next WS test does not write a ninth
variant.

**PR B — `test: one component-test harness for the card` (#307)**

The same shape on the card side, counted against the tree today: all **22** files in
`src/components/` define a local `mount()`, 14 a `q`, 12 an `all`, 16 a `cssText` reader
(with a further variant in `src/ui/chip.test.ts`) and 7 a `settle()` racing
`setTimeout(0)` against `updateComplete`.

The divergence is not cosmetic: some `mount()` helpers forward `statuses`/`areas` to the mock
hass and some do not, and the cssText readers differ in whether they join every fragment or
only the component's own block — which changes what a `not.toMatch` guard proves.

`src/test.utils.ts` already exists (`makeMockHass`, `makeItem`, `makeAttachment`,
`makeMediaBindings`, `stubViewport`) and is the obvious home. Add one `mountComponent`, one
`q`/`all`, one `settle`, one `ownCss`; the shared `mount` forwards the full `MockConfig`,
statuses and areas included; per-file `mount`s become thin options wrappers.

Both PRs: **no assertion deleted without a replacement**, and both gates green. Mechanical
churn belongs in its own PR precisely so a reviewer can read it as churn.

**PR C — `perf(storage): stop rewriting the whole store on every mutation` (#200)**

Every mutation serializes the whole dataset and rewrites the blob, serialized by the write
lock. Measured per-create p50: 70 ms @250 → 114 ms @500 → 200 ms @1000 items, trending
toward ~1 s at a few thousand. A later datapoint on the same curve: bulk-create p50 grew
**399 ms → 661 ms over the course of a single 1000-item run** — a run that grows the store
measures its own slowdown. Correctness is unaffected; this is scaling only.

**Measure before you change anything.** H8 is not a confirmation at the end, it is the first
step and the last: a before/after pair at 250 / 500 / 1000 items via
`.claude/skills/test-haventory/stress.py`, recording p50 at the start and at the end of each
run at a known item count. Without the "before", nothing in this PR can be evaluated.

Design constraints that survive from the rest of the repo, and that this PR must not quietly
break:

- WS and service handlers **save immediately**; errors propagate as `storage_error`.
  Shutdown and unload flush immediately. Debounced saves are for internal and batch work
  only, and are scheduled through `hass.async_create_background_task` so a pending write is
  cancelled and awaited on shutdown. A delta path that makes an interactive mutation
  eventually-persistent changes the contract, and that is a different issue.
- The store is refused, never relabelled, when written by a newer schema. Any change to what
  is written on disk is a schema change and takes `CURRENT_SCHEMA_VERSION` up with a
  migration — and #229's collapse (V0.6.0, per #236) flattens whatever this reaches, so
  taking the version up here is unremarkable.
- #197's input caps bound the same bloat from the other side, and they have already landed
  by the time this PR starts. Say in the PR body how much of the measured improvement is
  theirs.

If the measurement comes back showing the caps alone flattened the curve enough, **closing
#200 as not-planned with the numbers recorded is a good outcome**, not a failure.

**Exit**: the four helpers exist in exactly one place on each side and every test file
imports them; #200 either ships with a measured before/after or closes with the measurement
that made it unnecessary; H8 written and answered.

---

## 7. The prompts

One prompt per session, paste-ready. Each assumes this plan is merged to `main` and
restates its own start condition; the owner starts a session by pasting its block, nothing
more.

### 7.1 W0 — start immediately

```
Work in chrreiter/HAventory, branching off the current origin/main. You are session W0 of
the V0.5.0 plan. Read dev/V0_5_0_implementation.md §4 (rules) and §6.1 (your work
packages), then issues #356, #355 and #358.

Deliver two PRs, in this order:

1. "fix(ci): guard the Python floor's copies" — closes #356 and #355 together (§6.1 says
   why folding is right). A guard test in the shape of tests/test_min_ha_version.py, the
   CodeQL pin fix, and the two named siblings: the Node engines/CI-matrix gap and the
   duplicated ruff pin in .pre-commit-config.yaml.
2. The Dependabot sweep for #358. Push the ruff-0.16.1 fixes to Dependabot's own branch
   for PR #320 (bump .pre-commit-config.yaml's ruff pin in the same push, and confirm
   which integration test fails there before calling it mergeable). Close PR #155 as
   not-planned and add home-assistant-frontend and homeassistant to an ignore list in
   .github/dependabot.yml in the same change. PRs #321 and #259 are green — report them
   ready; the owner merges them, not you.

Branch names claude/v0-5-0-w0-<topic>, one branch per PR. Run both gates (§4) before
every commit. Never merge a PR — the owner merges; your job ends at pushed, PR open, CI
green, review comments answered. Every other session waits on this one, so raise anything
that blocks you in the PR thread immediately.
```

### 7.2 W1a — start when wave 0 is merged

```
Work in chrreiter/HAventory, branching off the current origin/main. You are session W1a
of the V0.5.0 plan; start only after wave 0's PRs (#356/#355 and #358) are merged. Read
dev/V0_5_0_implementation.md §4 (rules), §5 (handover protocol) and §6.2 (your work
packages), then issues #197, #293 and #195 — their implementation notes are the design.
Where an issue's line numbers or prose have drifted from the code, decide against the
code and record the decision in the PR body; do not edit the issue.

Deliver two PRs, in this order:

1. "fix(ws): bound and type the WebSocket inputs" — closes #197 and #293 together (§6.2
   says why they are one PR). Note #228 is closed, so #197's load_state half is
   unblocked — decide deliberately whether to take it and say what you decided. Run
   scripts/test_integration.sh for this PR: the frame-typing half is verified in phacc
   mode or nowhere.
2. "feat(import): warn when an incoming name collides with another id" — closes #195.
   The clean round-trip must produce zero warnings under every policy.

Update docs/backend_api_contract.md and docs/data_shapes.md in the same PR as each
contract change. Write handovers H1 (#197) and H2 (#195) into
dev/v0_5_0_handover_prompts.md per §5. Branch names claude/v0-5-0-w1a-<topic>. Run both
gates before every commit. Never merge a PR — the owner merges. Two sibling sessions are
editing other functions in ws.py: rebase on origin/main before every push.
```

### 7.3 W1b — start when wave 0 is merged

```
Work in chrreiter/HAventory, branching off the current origin/main. You are session W1b
of the V0.5.0 plan; start only after wave 0's PRs are merged. Read
dev/V0_5_0_implementation.md §4 (rules), §5 (handover protocol) and §6.3 (your work
package), then issue #194 — its implementation notes are the design.

Deliver one PR: "feat(ws): filter subscriptions by area" — closes #194, backend and card
in the same PR. The matcher resolves through the payload's own effective_area_id, never
the repository; an item with no location is not delivered to an area-filtered
subscription; a location moving areas emits locations/moved and no synthetic item events
— document that behaviour, do not invent an event. Update both contract docs in the same
PR.

Write handover H3 into dev/v0_5_0_handover_prompts.md per §5. Branch name
claude/v0-5-0-w1b-subscribe-area. Run both gates before every commit. Never merge a PR —
the owner merges. Two sibling sessions are editing other functions in ws.py: rebase on
origin/main before every push. When your PR is open and green, you are done — this
session takes no further work.
```

### 7.4 W1c — start when wave 0 is merged

```
Work in chrreiter/HAventory, branching off the current origin/main. You are session W1c
of the V0.5.0 plan; start only after wave 0's PRs are merged. Read
dev/V0_5_0_implementation.md §4 (rules), §5 (handover protocol) and §6.4 (your work
packages), then issues #365 and #298, including #298's triage comment.

Deliver two PRs, in this order:

1. "feat(config): offer the quick-filter pills in the options flow" — closes #365.
   Keep null (unset) distinct from [] (no pills) end to end; options flow only, setup
   stays short; pin the pill vocabulary across the language boundary the way
   tests/test_frontend_registration.py pins PANEL_ICON.
2. "feat(status): accept a hex colour beside the ten tokens" — closes #298. Ink is
   computed from relative luminance in exactly one place; a hex chip ignores the HA
   theme and the UI copy says so; no migration — stored documents stay valid. Do not
   start the mdi: icon set; it is dropped, not deferred. State statusToneClass()'s new
   contract plainly in the PR body — the wave-2 session rewrites both calling files and
   will read it there.

Write handovers H6 (#365) and H7 (#298) into dev/v0_5_0_handover_prompts.md per §5.
Branch names claude/v0-5-0-w1c-<topic>. Run both gates before every commit. Never merge
a PR — the owner merges. Two sibling sessions are editing other functions in ws.py:
rebase on origin/main before every push.
```

### 7.5 W2 — start when every wave-1 PR is merged

```
Work in chrreiter/HAventory, branching off the current origin/main. You are session W2 of
the V0.5.0 plan; start only when every wave-1 PR is merged (strictly required: the
#197+#293 PR, the #194 PR and the #298 PR). Read dev/V0_5_0_implementation.md §4 (rules),
§5 (handover protocol) and §6.5 (your work packages), then issues #193, #192 and #204.
Where an issue has drifted from the code, decide against the code and record the decision
in the PR body — #204 is the known case, and §6.5 PR C fixes the approach: a "location"
sort field on the denormalized location_path.sort_key, not an area sort.

Deliver three PRs, in this order:

1. "feat(ws): price category and tag facets against the active filter" — closes #193.
   matching_count lands beside count and the list never shrinks; measure against
   everything active except category and tags; route the new filter argument through
   validate_item_filter.
2. "feat(ws): multi-select categories and locations in filters" — closes #192. Additive
   list keys beside the scalars, unioned like tags_any; carry them through every path
   §6.5 names, including _item_matches_filter; include_subtree stays one flag for the
   whole selection, stated in the contract doc. Adopt statusToneClass()'s merged
   contract from #298's PR body.
3. "feat(ws): order items by their location path" — closes #204. Unlocated items sort
   last in both orders; the cursor round-trips; record in the PR body why this is not an
   area sort.

Update both contract docs in the same PR as each change. Write handovers H4, H5 and H9
into dev/v0_5_0_handover_prompts.md per §5. Branch names claude/v0-5-0-w2-<topic>; a
later PR may stack on your own earlier branch — rebase onto main as each merges. Run both
gates before every commit. Never merge a PR — the owner merges.
```

### 7.6 W3 — start when every wave-2 PR is merged

```
Work in chrreiter/HAventory, branching off the current origin/main. You are session W3 of
the V0.5.0 plan, the last one; start only when every wave-2 PR is merged. You run last on
purpose: your first two PRs rewrite the test files every other session added to. Read
dev/V0_5_0_implementation.md §4 (rules), §5 (handover protocol) and §6.6 (your work
packages), then issues #357, #307 and #200, including #307's triage comment.

Deliver three PRs, in this order:

1. "test: one WebSocket send helper for the offline suite" — closes #357. One _send with
   conn as a first-class optional argument, returning the full result envelope; migrate
   all 22 files; no assertion deleted without a replacement.
2. "test: one component-test harness for the card" — closes #307. One
   mountComponent/q/all/settle/ownCss in src/test.utils.ts; the shared mount forwards
   the full MockConfig; same no-deleted-assertion rule.
3. "perf(storage): stop rewriting the whole store on every mutation" — closes #200.
   Measure FIRST: write handover H8 (the before-numbers at 250/500/1000 items) before
   designing anything. Immediate-save semantics and the schema-version rules in §6.6 are
   contracts this PR must not break. If the measurement shows #197's caps already
   flattened the curve, closing #200 as not-planned with the numbers recorded is a good
   outcome.

If your last PR closes the milestone's last open issue, delete
dev/V0_5_0_implementation.md and dev/v0_5_0_handover_prompts.md in that PR. Branch names
claude/v0-5-0-w3-<topic>. Run both gates before every commit. Never merge a PR — the
owner merges.
```

---

## 8. Milestone exit

V0.5.0 closes when:

- All 15 issues are closed — implemented, or closed as not-planned with the reason recorded
  in the issue.
- No Dependabot PR is open against `main`, and the frontend/HA pins carry an ignore rule.
- `docs/backend_api_contract.md` and `docs/data_shapes.md` describe `ws.py` as it stands:
  input caps, cursor refusals, unknown-key rejection, duplicate `op_id`, `subscribe`'s
  `area_id`, `distinct_values`' filter and `matching_count`, and the multi-select filter keys.
- Both gates green on `main`, plus one clean `scripts/test_integration.sh` run.
- Every handover in `dev/v0_5_0_handover_prompts.md` is answered, or explicitly waived in the
  issue it belongs to.
- This file and `dev/v0_5_0_handover_prompts.md` are deleted, in the PR that closes the last
  issue.

Nothing in this milestone touches `CURRENT_SCHEMA_VERSION` except possibly #200, and nothing
in it blocks #229's collapse, which stays where #236 puts it: last in V0.6.0, after #187.

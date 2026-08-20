# V0.7.0 — session plan

Status: **planned** (2026-08-20). Assigns the milestone's 23 open issues to eleven
**local** sessions, states the rules each session runs under, fixes the model each one
runs on, and ends with the paste-ready prompt each session is started from (§7). The
issues' own implementation notes (written 2026-08-05 for most of them) are the design —
this file does not restate them; where a note and the tree disagree, §6 says which way the
plan decides, and the session records the rest in its PR body.

Baseline: `main` after release 0.6.0 (tagged 2026-08-20), the two Dependabot PRs (#455,
#456) merged, and #302 and #442 closed on the evidence (no alert in any state;
#442 shipped as #488), and two issues filed into the milestone the same day: #490 (the
row thumbnail the card shows and the full view and panel do not) and #493 (three more
count sensors). The 23 open issues are all below.

Local means the session runs on the owner's machine with the dev Docker Home Assistant
(`home-assistant`, `http://localhost:8123`) available: the `run-haventory` and
`test-haventory` skills work, and the phacc suite runs through the Docker recipe in §4.
The sessions run strictly serially — one machine, one checkout, one dev HA.

The owner's total involvement, by design:

1. **Pre-flight, once** (§2) — three decisions that would otherwise stop a session mid-way.
2. **Paste one prompt per session** — eleven pastes, each when the previous session's
   handover has been read.
3. **Read each session's handover** (§4, "The handover") and run the short hand-test list
   it carries — the things a harness cannot prove: a real phone, German wording read by a
   German speaker, a README read as a stranger.
4. **Merge four PRs the sessions leave open on purpose** (§4, "Merging"): the two test
   purges of #353, the `CLAUDE.md` trim of #216, and the README rewrite of #217.
5. **Decide whether the `home-assistant/brands` PR is still worth filing.** It is no
   longer what makes the artwork appear: the integration ships its own icons and logos
   in `custom_components/haventory/brand/`, and Home Assistant serves those in
   preference to the brands CDN. What the CDN still backs is the HACS store listing,
   which is read before anything is installed. Either way it goes to another project's
   repository under the owner's name, so no session files it. #196 tracks it.
6. **Merge release-please's 0.7.0 PR** after S11 has finished — S11's findings ship in
   0.7.0, so the release PR waits for it.

Everything else — including opening and squash-merging the other PRs — the sessions do.

Delete this file in S11's closing PR — a plan left behind reads as pending work.

---

## 1. What changed since the V0.6.0 process

Four process changes, all owner direction (2026-08-20):

- **Every session ends with a handover.** Not a report of what merged — a short,
  fixed-format block (§4) whose centre is *what to test by hand and what to expect*.
  A session that merged everything green still writes one; "nothing to test by hand —
  here is what the harness proved" is a valid handover, an empty one is not.
- **Small PRs self-merge; four do not.** The V0.6.0 rule (sessions squash-merge their own
  PRs once gates, phacc, CI and live checks are green) stands, with an explicit list of
  PRs that stay open for the owner (§4). The criterion: a PR whose review is a judgment
  the owner would want to make — bulk test deletion, the file every future session reads
  first, the document every stranger reads first.
- **Each session names its model.** Opus 5 at `xhigh` effort for every session but the
  last — one model throughout, because switching models between sessions is not worth
  the owner's effort. The closing online pass (S11) runs on **Fable 5**, and that is not
  negotiable — it is the one session whose value is in noticing what nobody wrote an
  assertion for.
- **The milestone closes with a testing session, not a feature.** S11 deploys `main` to a
  clean dev HA, runs every automated regimen the repo has, then drives the product the
  way a household would — desktop, phone width, German, dark theme, two tabs, slow
  network — looking for regressions against 0.6.0, new bugs, jank and plain bad
  usability. Findings become issues; small fixes ship; the release PR waits for it.

Everything else — branch discipline, conventional-commit PR titles, TDD, the gate before
every commit, "issues are read, not rewritten", live verification in-session — carries
over from the V0.6.0 plan unchanged (§4).

## 2. Owner pre-flight (before pasting S1)

Three things that are the owner's to decide and that a session must not wait on:

1. **The dev HA and its token.** The `home-assistant` container is up and `HA_BASE_URL`
   / `HA_TOKEN` are exported in the shell profile every session inherits. A session that
   finds them missing stops and says so — that is the one interruption this plan cannot
   design away, so it is better spent here.
2. **Coverage upload (#210, S3).** Codecov needs a `CODECOV_TOKEN` repository secret
   while the repository is private. Add it before S3 if the coverage bullet is wanted;
   if the secret is absent when S3 runs, the session drops that one bullet, says so in
   the PR body, and the rest of #210 ships. No mid-session question either way.
3. **A real phone on the LAN (S11).** The dev HA publishes 8123, but the active WLAN
   profile is `Public` and Docker Desktop's inbound rule blocks it there, so a phone on
   the LAN cannot reach the dev HA today. Either change the profile / add a targeted
   allow for TCP 8123 before S11, or accept that the phone items in S11's handover are
   yours to run on your own instance. S11 does not touch the firewall.

## 3. The map

```
S1   #285 + brands prep → #482 ×2 → #466    Opus 5 xhigh   the stored shape settles      4 PRs
──────────────────────────────────────────────────────────────────────────────────────────
S2   #493 → #450 → #280 → #430              Opus 5 xhigh   three more sensors, service    4 PRs
                                                           fan-out, runtime, greppable
                                                           logs
──────────────────────────────────────────────────────────────────────────────────────────
S3   #433 → #235 → #210                     Opus 5 xhigh   floors, the floor policy,      3 PRs
                                                           CI polish
──────────────────────────────────────────────────────────────────────────────────────────
S4   #432 → #212 → #209                     Opus 5 xhigh   harness and suite hygiene      3 PRs
──────────────────────────────────────────────────────────────────────────────────────────
S5   #208 → #227 → #366 item 4              Opus 5 xhigh   real-HA coverage, scheduled    3 PRs
                                                           drift checks
──────────────────────────────────────────────────────────────────────────────────────────
S6   #353 backend → #353 card               Opus 5 xhigh   test purge — owner merges      2 PRs
──────────────────────────────────────────────────────────────────────────────────────────
S7   #426 → #490 → #366 items 1+3           Opus 5 xhigh   the area-chip clip, row        3 PRs
                                                           thumbnails, the HA contact
                                                           surface
──────────────────────────────────────────────────────────────────────────────────────────
S8   #190                                   Opus 5 xhigh   German                         3 PRs
──────────────────────────────────────────────────────────────────────────────────────────
S9   #441 → #216                            Opus 5 xhigh   docs truth, dev-residue purge  2 PRs
                                                           — #216 owner merges
──────────────────────────────────────────────────────────────────────────────────────────
S10  #217                                   Opus 5 xhigh   the README — owner merges      1 PR
──────────────────────────────────────────────────────────────────────────────────────────
S11  online regression / usability pass     Fable 5 xhigh  findings → issues + small      n PRs
                                                           fixes; deletes this file
```

A session starts only when the one before it has merged everything — or, for S6, S9 and
S10, when the owner has merged the PR(s) it left open. Eleven sessions, 28 planned PRs
plus whatever S11 ships.

## 4. Rules every session follows

**Model and start condition**

The first line of every prompt names the model and effort. Set them before pasting; the
session cannot. Each prompt restates its start condition and the session checks it
(`gh pr list`, `gh issue view`) before branching.

**Branches and PRs**

- One branch per PR, named `claude/v0-7-0-s<N>-<topic>`. Branch off the current
  `origin/main`; within a session a later PR may stack on the session's earlier branch
  and rebases onto `main` when that PR merges.
- PR titles are **Conventional Commits**. The repository squash-merges, so the PR title
  becomes the commit message and release-please reads it for the changelog.
- Link the issue (`Closes #NNN`, or `Refs #NNN` for a PR that ships part of one) and fill
  in `.github/pull_request_template.md`. With no human reviewer in the loop **the PR body
  is the review record**: decisions against drifted issue notes, live-check evidence
  (screenshots for anything visual, via the assets-branch recipe the `run-haventory`
  skill documents), waivers, the Follow-ups note, and the hand-test list from the
  handover.

**Merging**

> A session squash-merges its own PR when — and only when — all of: both gates green
> locally; `scripts/test_integration.sh` green (through the Docker recipe below) for any
> PR touching `custom_components/` or `tests/integration/`; CI green on the PR, hassfest
> included; and the session's live checks (§6) passed or explicitly waived in the PR
> body with the reason. Delete the branch on merge.
>
> **Left open for the owner, never self-merged:** S6's two #353 PRs, S9's #216 PR, S10's
> #217 PR. The session brings each to "everything green, evidence complete", writes the
> handover, and stops. **Release-please PRs are never merged, edited or closed by a
> session.**

If CI is red, fix it and push — that is still the session's work. If the failure
reproduces on `main`, say so once in the PR thread, fix `main` first if the fix is small
and obvious, and otherwise stop and report.

**Issues are read, not rewritten**

The 2026-08-05 implementation notes are the design, but their file references were taken
against a tree many releases old. Grep for the symbol or the message string, never the
line. Where a note's prose has gone stale, the session decides against the code and
records the decision in the PR body; it does not edit the issue. A short issue comment
is worth writing only when the decision changes what the issue asked for. §6 lists the
drifts already known per session.

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

**The phacc suite on this host.** `scripts/test_integration.sh` cannot run natively on
Windows (POSIX venv layout, and Home Assistant core imports `fcntl`). Run it in a
container with the venv on a named volume — first run about three minutes, re-runs about
thirty seconds, host edits picked up through the bind mount:

```bash
MSYS_NO_PATHCONV=1 docker run -d --name hav-int \
  -v "C:/Users/chrre/OneDrive/Dokumente/Code/HAventory/HAventory:/work" \
  -v hav-int-venv:/work/.venv-integration -w /work \
  ghcr.io/astral-sh/uv:python3.14-bookworm sleep 7200
MSYS_NO_PATHCONV=1 docker exec hav-int bash -lc 'cd /work && bash scripts/test_integration.sh'
```

Build the card first (`npm run build`), or `tests/integration/test_frontend.py` skips
half its cases. CI's `integration` job is the gate of record; the local run is what lets
a session fix before it pushes.

**Live checks**

Each session's package (§6) lists its live checks. Drive them with the `run-haventory`
skill (deploy to the dev HA, drive the WS API, screenshot), and the `test-haventory`
skill where a regimen fits. Evidence lands in the PR body. Two facts the skills'
gotchas sections carry and every session here needs: card *registration* is only
proven in Firefox (Chromium wins the `customElements` race HA's boot creates), and a
`.storage` edit needs HA stopped and the volume route, never a `docker cp` into the
running container. A session that changes the dev HA's data (a hand-edited store, a
German profile) restores it before the handover, and says so.

**The handover**

The session's final message ends with a block headed `## Handover`, and the same block
is the last section of the PR body of every PR the session opened (so an owner-merged PR
carries its own). Five parts, in this order, each present even when short:

1. **Merged / left open** — PR links; for a left-open PR, the one sentence saying why
   the owner's merge is wanted.
2. **Test this by hand** — numbered steps with the expected result, each tagged
   `[desktop]`, `[phone]`, `[HA settings]` or `[log]`. Only what the harness could not
   prove. When that is nothing, write "nothing by hand" and list what the harness proved
   instead, with links to the evidence.
3. **Decisions taken against drifted notes** — one line each.
4. **Follow-ups** — filed as issues (links), or named and deliberately not filed, with
   the reason (the bar is CLAUDE.md's: it earns an issue only if it can matter in a real
   install).
5. **State left behind** — the dev HA (data restored? profile language?), branches,
   anything the next session must know.

**Conventions that bite in this milestone specifically**

- **The stored payload is settled by S1 and then does not move.** After S1 merges, no
  session changes what `serialize_state` writes. If a later session finds it must, it
  stops and reports — #482's rule is that the collapse (#229, V0.8.0) lands on a shape
  that has stopped moving, and a surprise here re-stages the collapse.
- `tests/test_min_ha_version.py` pins `README.md` to exactly two spellings of the floor
  and `tests/test_toolchain_pins.py` sweeps every tracked file for an unregistered copy
  of the Python or Node floor. Any README or toolchain edit runs the backend gate before
  it is believed.
- New `strings.json` sections are repeated byte-identically in `translations/en.json`
  (`test_translation_flow_sections_match_strings`). S8's `translations/de.json` mirrors
  the key tree, not the values.
- Contract or shape changes update `docs/backend_api_contract.md` and
  `docs/data_shapes.md` in the same PR.
- Deleting or renaming a file under `custom_components/haventory/` means appending its
  old path to `RETIRED_PATHS` in the same PR. No session here plans such a deletion; a
  `RETIRED_PATHS` edit appearing in a diff is a sign to stop and re-check.
- TDD, no `TODO`/`FIXME`, comments encode constraints not history, plain words — as
  always. Out-of-scope findings go in the PR's Follow-ups note and become issues only if
  they clear the real-world bar.
- If `git status` shows changes the session did not make, or HEAD moves under it, another
  session is in the checkout: move to a `git worktree` (with `UV_LINK_MODE=copy` and a
  fresh `npm ci`) rather than sharing the tree.

## 5. Why the order is what it is

- **S1 first, and the brands prep at its head.** #236 stages #482 as the one V0.7.0 item
  the collapse depends on, and it stages the brands PR "at the start" of launch prep
  because it runs on an external review timeline. Both want to be first; they share a
  session so the owner's one brands decision arrives in the first handover.
- **S2 after S1, and #493 at its head.** #482 changes the serializers in `repository.py`;
  #280 moves the wiring around them; #430 then rewrites log calls across every backend
  module. Running the sweeping textual change last keeps it from conflicting with the
  structural ones. #493 — a catalog edit plus one repository count — goes first so the
  runtime move ports a settled seven-sensor catalog rather than chasing it.
- **#280 before #230, inverting its notes.** The notes say to land #280 after #230's
  cuts; the owner staged #230 in V0.8.0 and #280 here. The notes' own assessment stands:
  #280 is safe in either order and the V0.8.0 cuts simply port a little less.
- **S3 before S5.** #210's action-pinning guard test should exist before #227 adds a
  workflow; #433's floor change wants to be in before anything else provisions Python.
- **S4 anywhere after S3.** Nothing depends on it; it is placed where it
  cannot collide with S3's edits to `tests/test_toolchain_pins.py`.
- **S5 before S7.** #366 item 4 (the scheduled card smoke) reuses what #227 builds; S7
  closes #366 on items 1 and 3 only once item 4 has either landed or been re-filed.
- **S6 (the purge) before S7 and S8.** #366 item 1 moves ~56 call sites and #190
  touches 52 source files; purging first means both refactors update fewer tests.
- **#490 rides S7.** It changes the same table row #426 measures, and its one judgment
  — what the name column gives up at the docked-sidebar width — is taken there, with the
  screenshots that prove it.
- **S8 (German) last among the card sessions.** It is the largest card diff; nothing
  should have to rebase over it.
- **S9's `CLAUDE.md` trim after every code session.** The trim moves conventions into
  `CONTRIBUTING.md`, which sessions do not load automatically. Code sessions run against
  the untrimmed file; S10 and S11 are told to read `CONTRIBUTING.md` explicitly.
- **S10 after S9, and last among the writing.** The README absorbs the one-line edits
  S3, S5 and S8 make (policy sentence, badge, job line, languages line) rather than each
  of them editing a structure that is about to change, and its screenshots show the
  final 0.7.0 card.
- **S11 last, before the release PR.** Its fixes ship in 0.7.0.

## 6. The sessions

### 6.1 S1 — #285, the brands prep, #482 ×2, #466: the shape settles

Four PRs, in order:

1. **"test(brand): bind the card's mark and the social preview to one geometry"** —
   closes #285. The issue's options (1) + (3): cross-reference comments in
   `cards/haventory-card/src/ui/brand-icon.ts` and `docs/assets/social-preview.html`
   stating why the winding differs, and a test that normalises both `d` strings to one
   winding and asserts they describe the same shape. `tests/test_frontend_registration.py`
   is the precedent for a Python test reading a TypeScript constant across the language
   boundary; follow it.
   **In the same PR, the brands prep:** render the raster assets the
   `home-assistant/brands` repository asks for under `custom_integrations/haventory/`
   (at the time of writing: `icon.png` 256×256, `icon@2x.png` 512×512, optional
   `logo*.png` / `dark_*` variants — verify against the brands README on the day) from
   the *TypeScript* constant, not by hand, so the three copies #285 worried about are
   one source and two renderings. Commit the renderer and its output under
   `docs/assets/brand/`. Write the brands PR body and the exact `gh` sequence (fork,
   branch, copy, PR) into the handover. **Do not open the external PR** — it goes under
   the owner's name to another project's repository.
   *Outcome:* shipped, then moved. Home Assistant 2026.3 — three releases below this
   project's floor — serves a custom integration's own brand images from a `brand/`
   directory inside it, in preference to the CDN, so the artwork now lives at
   `custom_components/haventory/brand/` and a logo was added beside the icon. The
   external PR became optional; see item 5 of §1.
2. **"refactor(storage): stop persisting the write-only `_generation`"** — refs #482.
   Plan decision: **no schema bump.** A missing key reads as absent on both sides, and a
   bump would add a migration step the collapse deletes anyway. Tests: a store with the
   key and one without both load; the written payload's top-level keys are exactly
   `items, locations, statuses, schema_version`; `haventory/version` and the diagnostics
   payload still report the runtime generation.
3. **"refactor(models): one `to_dict()` per model"** — closes #482. Plan decision: the
   **stored form is exactly today's** (`attachments` included; neither `location_path`
   nor `effective_area_id` acquires a stored form). One serializer per model; the export
   document and the wire frame wrap it and add their derived fields at the boundary.
   Pin it with a golden fixture: the stored payload for a fixed repository is
   byte-identical before and after, and the export and wire shapes are unchanged against
   `docs/data_shapes.md`.
4. **"fix(storage): count a stored row with no name as unreadable"** — closes #466.
   `validate_item_name` in `models.py`, the four validators delegating, both `load_state`
   sites calling it instead of `str(...)`. Non-empty only, not the length cap. The
   location twin behaves the same.

phacc required for PRs 2–4 (a real `Store` round trip; #466's Repairs flow).

Live checks: after a mutation on the dev HA, `/config/.storage/haventory_store` carries
no `_generation`; export → preview → import round-trips with zero changes reported;
with HA stopped, null out one item's `name` in the store (volume route), start, and the
corrupt-store Repairs card names the dropped row — run the fix, confirm the backup and
the reload; restore the store afterwards.

Handover hand-tests: `[desktop]` open the card and the panel — nothing visible should
have changed, say so if it did. Owner decision carried: **approve the brand artwork and
file the brands PR** with the prepared text and commands.

### 6.2 S2 — #493, #450, #280, #430: three more sensors, fan-out, runtime wiring, greppable logs

Four PRs, in order:

1. **"feat(sensor): checked-out, locations and inspection-due counts"** — closes #493.
   Two catalog entries over counts `get_counts()` already returns, and one new count —
   `inspection_due_count`, inspection date **on or before** today (UTC), the reminder
   reading of "due" — with its `models.py` helper, `date_derived=True`, both translation
   files, both docs files, the card's counts type and the README's sensor table. A
   look-ahead window is out of scope by the issue's own line. #492 renames the existing
   four sensors and is the owner's own in-flight work; if it has not landed when this
   PR opens, take the new names from #492's title vocabulary and leave the four alone.
2. **"fix(services): broadcast service mutations to WebSocket subscribers"** — closes
   #450. Take the issue's second shape: the WS broadcast rides beside
   `events.notify_mutation`, so one call after every persist covers the bus, the
   sensors, the `items` event and the `stats` counts. The one constraint: the rate
   limiter's event budget is charged for the WS half exactly as today, and bus events
   are never charged. Asserted in the phacc suite (the offline stub has no service
   registry), plus the offline rate-limit accounting.
3. **"refactor: move the runtime onto `entry.runtime_data`"** — closes #280. The notes'
   design stands (`runtime.py`, the PEP 695 alias, the **two lookups** — the client
   boundary checks `LOADED`, the teardown path does not, or the final flush is lost).
   mypy strict over `haventory.runtime` with no new `cast(...)` is part of acceptance.
   The 27 test files that hand-wire `hass.data[DOMAIN]` convert to the new
   `haventory_entry` fixture.
4. **"fix(logging): put the context a bug report needs into the message text"** — closes
   #430. One helper that folds a context dict into the message and keeps `extra=`;
   `op`, `elapsed_ms`, the schema versions and `storage_key` are the fields that must be
   greppable. Rewrite the rule in `CONTRIBUTING.md` and `CLAUDE.md` to describe what
   actually happens. Test via `caplog`: `record.getMessage()` carries
   `op=persist_complete elapsed_ms=`.

phacc required for all four.

Live checks: the HAventory device page shows seven sensors with sensible names and
ids; checking an item out moves `Checked out count` at once, and an item whose
inspection date is today counts as due and not as overdue; two browser tabs on the card; `haventory.item_create` from Developer Tools
→ Actions repaints the *other* tab's list and counts with no interaction (the
`two-tab` recipe in the `run-haventory` skill); a config-entry reload and an options
change with a dashboard open — the card reconnects, the sidebar panel survives;
`grep persist_complete /config/home-assistant.log` inside the container finds lines
carrying `elapsed_ms`.

Handover hand-tests: `[HA settings]` the HAventory device page lists seven sensors and
their values match the card's counts. `[phone]` with the card open, trigger an
automation or script that calls a `haventory.*` service — the list updates without
touching it. `[log]` Settings →
System → Logs, filter `haventory`: the lines name their operation.

### 6.3 S3 — #433, #235, #210: floors, the floor policy, CI polish

Three PRs, in order:

1. **"build: raise the Python floor to the one Home Assistant requires"** — closes #433.
   The issue's option 1: `requires-python = ">=3.14.2"`, the copies
   `tests/test_toolchain_pins.py` enumerates telling a major-minor spelling from a
   patch-level one. The guard that the declared floor is not below the pinned HA
   release's `requires_python` belongs where HA is installed —
   `tests/integration/`, via `importlib.metadata` — with the offline side checking that
   every major-minor copy agrees with the floor's major-minor. Decide and record which
   file holds which half. (This host runs 3.14.6; the change bites nothing locally.)
2. **"docs: one declared floor, and a guard against a second README version"** — closes
   #235. The notes' recommendation: keep one floor, write the policy down (CLAUDE.md's
   "Scope decisions that stay true", the README sentence, the
   `requirements-integration.txt` comment), restrict the security clause to
   high/critical, and add the README guard to `tests/test_min_ha_version.py`.
3. **"ci: Dependabot pip block, wider tsc gate, frontend pre-commit hooks, moderate
   audit level, coverage upload, digest-pinned actionlint"** — closes #210. Six bullets,
   each droppable. **Coverage:** `gh secret list` — if `CODECOV_TOKEN` is present,
   implement the upload and the badge; if absent, drop that bullet and say so in the PR
   body and the handover (owner pre-flight item 2). **actionlint digest:**
   `tests/test_toolchain_pins.py` ties the `ci.yml` pin to `.pre-commit-config.yaml`'s
   `rev`; the digest form must keep that tie readable (the trailing `# v1.7.12` comment
   is where the version lives). The action-pinning guard test lands here because S5's
   new workflow has to satisfy it on arrival.

phacc: required for PR 1 (the guard lives there); not for PRs 2–3.

Live checks: `uv sync` on a fresh venv at the raised floor; `pre-commit run <hook-id>
--all-files` for the two new local hooks; CI green including the widened typecheck.

Handover hand-tests: nothing by hand. If coverage was enabled: `[desktop]` the Codecov
badge resolves after the first `main` run.

### 6.4 S4 — #432, #212, #209: harness and suite hygiene

Three PRs, in order; each is fully specified by its issue and carries no design choice:

1. **"fix(skills): make stress.py honour the worktree's .env and name its target"** —
   closes #432. Plan decision on precedence: **a `.env` beside the script wins over an
   inherited export**, and every command prints the base URL and `items_total` before
   it does anything; destructive commands print and proceed (no prompt). Apply the same
   two rules to `scripts/ws_probe.py`, `ws_subscribe.py`, `ws_init_haventory.py`,
   `create_test_items.py` where they read `.env`. Update the `test-haventory` skill's
   `SKILL.md` where it describes the env handling.
2. **"test(skills): branch-discriminating desktop surfaces and `--dashboard`
   selection"** — closes #212. The notes' two selector additions and the
   `filterByDashboard` design; `node --test` in `.claude/skills/run-haventory/` is the
   gate for the pure half.
3. **"test(card): fake-timer the remaining wall-clock waits; sweep pending timeouts in
   teardown"** — closes #209. The notes' table of six waits and the timeout wrapper
   that unregisters on fire. Run `npx vitest run` twice and compare wall time before and
   after — a run that did not get faster still waits on something real.

phacc: not involved.

Live checks: `stress.py baseline` from a worktree carrying its own `.env` names *that*
instance in its first line; `node visual_pass.mjs --only desktop` and
`--only mobile --surfaces filter-sheet` against the dev HA both pass after #212.

Handover hand-tests: nothing by hand.

### 6.5 S5 — #208, #227, #366 item 4: real-HA coverage, scheduled drift checks

Three PRs, in order:

1. **"test(integration): cover the debounced persist, the downgrade refusal, the error
   envelope and the retired-files sweep against real HA"** — closes #208. The notes'
   four additions; no production code. The `ERR_ID_REUSE` / `ERR_UNKNOWN_COMMAND` stub
   divergences the 2026-08-05 comment names are covered here if a case each is cheap,
   and otherwise named in the Follow-ups note — not filed unless they clear the bar.
2. **"ci: run the integration suite against the newest Home Assistant monthly"** —
   closes #227. The notes' `ha-latest.yml`: phacc alone unpinned, the frontend wheel
   derived from the installed core's manifest, cron on the 8th plus
   `workflow_dispatch`, the `gh`-driven pinned-issue notifier, the `ci:ha-latest` label
   in `.github/labels.yml`, and the three guard tests in
   `tests/test_repo_hardening_offline.py`. After merge, `gh workflow run` it once and put
   the step summary (the resolved HA version) in the handover.
3. **"ci: drive the card's live smoke against Home Assistant stable and beta on a
   schedule"** — refs #366 (item 4). A second scheduled job on the same pattern: boot
   `ghcr.io/home-assistant/home-assistant:{stable,beta}` in the runner, onboard over
   REST and mint a token (the `run-haventory` skill and `scripts/ws_init_haventory.py`
   carry the recipe), install the integration and the built card, put the card on a
   dashboard over WS, run `cards/haventory-card/e2e/live-updates.smoke.mjs` with
   `--path` pointing at it, fail → the same pinned-issue notifier. **Recorded cut line:**
   if the HA-in-Actions boot is not green by the time PRs 1–2 are merged and one honest
   attempt is in, stop — leave a comment on #366 with what was tried and what blocked
   it, and S7 closes #366 on items 1–3 with item 4 re-filed as its own issue (🔧 Task,
   V0.8.0). Either way the decision is written, not asked.

phacc required for PR 1 (it *is* the deliverable) and a floor run for PR 2 (the new job
must not disturb it).

Live checks: both workflows dispatched once by hand after merge; their step summaries
name the HA version they ran against.

Handover hand-tests: nothing by hand. Note the scheduled dates so a first failure on the
8th is read as drift, not as a regression in whatever PR is open that day.

### 6.6 S6 — #353: the test purge — owner merges

Two PRs, both left open:

1. **"test: purge backend tests that pin no real-world behaviour"** — refs #353
   (findings 1–5).
2. **"test(card): purge stylesheet-regex, negative-CSS and duplicated guard-matrix
   tests"** — closes #353 (findings 6–9).

The counts in the issue were taken against `602bf71`; the tree has moved. **Re-run
findings 6, 7 and 8 as queries** (a regex over `*.test.ts` for `.styles` / `cssText`
readers with no mount; `not.toMatch` / `not.toContain` against CSS; the guard matrix on
surfaces other than `hv-item-editor`) and purge what the queries find, not the file list.
Per-deletion accounting in the PR body: for every removed test, either where the
behaviour is covered instead or why it fails the bar. The "what must not be purged" list
is checked line by line and the check is in the body. Both gates green with no new
failures.

phacc: a floor run for PR 1, since `tests/integration/` must be demonstrably untouched.

Live checks: none — nothing here is observable against a running HA.

Handover hand-tests: nothing by hand. **Owner merges both PRs**; S7 starts after.

### 6.7 S7 — #426, #490, #366 items 1+3: the area-chip clip, row thumbnails, the HA contact surface

Three PRs, in order:

1. **"fix(card): keep the location tree's tally whole when an area name is long"** —
   closes #426. Clip the *name* with an ellipsis the way the category and tag rows do;
   the tally draws in full at the default 264px sidebar. The dev HA already has the
   `Ground Floor Utility Room` area the issue reproduces with. Before/after screenshots
   in the PR body.
2. **"feat(card): show the row thumbnail in the full view and the sidebar panel"** —
   closes #490. `hv-data-table`'s name cell gains the leading thumbnail `hv-list-row`
   already renders: the same `MediaBindings` / `MediaUrls` path, the same fixed box,
   lazy loading, and **nothing for a row without a picture**. The one measurement the
   issue asks for is taken, not assumed: the full column set at the docked-sidebar
   width (~1400px at 1920) and at 375px, before and after, in the PR body — if the name
   column loses its last word on that width, the column template moves, not the
   thumbnail.
3. **"refactor(card): name the Home Assistant contact surface in one module and hold
   `ha-*` at zero"** — closes #366 if item 4 landed in S5, otherwise closes it on items
   1–3 with item 4 re-filed (§6.5). `src/ha-contract.ts` re-exporting thin wrappers for
   `callWS`, `subscribeMessage`, the `window.customCards` registration and
   `SURFACE_VARS`; every call site in `store/` and the components routed through it; a
   Vitest test that fails on any `<ha-` in a component template; the one-line rule and
   its reason in `CONTRIBUTING.md`.

phacc: not involved (nothing crosses the boundary).

Live checks: deploy and confirm the card registers and subscribes — **in Firefox**, the
only browser where registration is a real test; the live-update smoke passes; the panel
at `/haventory` renders; the area row at 264px shows `18 / 41`-shaped tallies whole;
a row with a picture shows it in the full view, the panel and the narrow branch, and a
row without shows no placeholder.

Handover hand-tests: `[desktop]` `[phone]` open the full view's sidebar with a long area
name — the number on the right is whole and the name is the thing that shortens.
`[desktop]` `[phone]` browse the panel and the full view — rows with photos carry the
same small picture the card shows, at the same size, and nothing else moved.

### 6.8 S8 — #190: German

Three PRs, in order; the first is green and shippable on its own:

1. **"feat(i18n): translation mechanism, German backend translations and the shared copy
   modules"** — refs #190. The notes' design, option by option: `hass.language` as the
   source; a module singleton `src/i18n/` with `t(key, params?)` / `setLanguage(tag)`;
   exact tag → primary subtag → `en`; a missing key returns the English string, never
   the key; `en.ts` is the key universe; two-form plurals in the dictionaries;
   `relative-time.ts` moves to `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat`;
   `DEFAULT_CARD_TITLE` and backend error messages deliberately untranslated.
   `translations/de.json` mirrors `strings.json`'s key tree with German values; the
   `de.json` shape and placeholder tests in `tests/test_config_flow_offline.py`.
2. **"feat(i18n): translate the card components (1/2)"** — refs #190.
3. **"feat(i18n): translate the card components (2/2)"** — closes #190. Also
   `docs/frontend_architecture.md` "Shared wording", the `CONTRIBUTING.md` recipe for
   adding a language, and one README line naming the languages that ship (S10 absorbs
   it).

**Register and wording.** Match Home Assistant's own German: read a few of the installed
core's `homeassistant/components/*/translations/de.json` in the dev container and adopt
its form of address and its terms (`Bereich` for area, and so on) rather than inventing
a vocabulary. Put an EN/DE table of every key in PR 1's body so the owner can review the
wording in one place.

Plan decision: **the docs-site / public-roadmap half of #190 is dropped, not filed.** It
does not clear the real-world bar until there is an audience; the closing comment says
so and invites a new issue when there is one.

phacc: a run for PR 1 — only the in-process mode loads a real config entry against the
shipped `translations/` directory; hassfest on the PR validates the file shape.

Live checks: set the dev HA user's profile language to Deutsch; the config flow and the
options screen render German; the card and the panel render German end to end,
relative times included; switch back to English and confirm nothing English changed;
screenshots of both. Restore the profile language afterwards.

Handover hand-tests: `[desktop]` `[phone]` read the German UI as a German speaker — list
every wording you would change; the corrections ship as one follow-up PR (S9 takes it
if the list arrives before S9 starts, otherwise S11). `[HA settings]` the German options
screen reads naturally.

### 6.9 S9 — #441, #216: docs truth, the dev-residue purge — #216 owner merges

Two PRs, in order:

1. **"docs: state the invalid_format / validation_error split as a rule; count the
   sortable fields right"** — closes #441. The rule with its exceptions named rather
   than 63 fields enumerated; the README count follows `SORT_FIELDS`; a sweep of the
   surrounding claims in both files while they are open — the issue says these two were
   found by spot-check, so read both end to end. If S8's German wording list has
   arrived, ship it here as a third, small PR first.
2. **"docs: purge development residue and trim CLAUDE.md"** — closes #216, **left open
   for the owner.** The notes were written against a `dev/` that no longer exists; the
   inventory today is `ha_config_for_dev.yaml`, `item70_toolchain_retirement_plan.md`,
   `open-items.md`, `release_review.md`, `release_testing_plan.md`,
   `schema_collapse_plan.md`, `v1_prompts.md`, and this plan. Dispositions:
   - Delete `v1_prompts.md`, `open-items.md`, `item70_toolchain_retirement_plan.md`
     (last, being the plan executed).
   - Delete `schema_collapse_plan.md` after pasting whatever #229 does not already
     carry into #229 as a comment (#226 is closed; nothing goes there).
   - **Delete `release_review.md`** — plan decision, answering the 2026-08-10 comment:
     every issue it spawned cites it by name, and a comment on #230 and #231 linking
     the archived file at its last SHA serves those citations better than a document
     that reads as pending work.
   - Keep `release_testing_plan.md` (until #276), `ha_config_for_dev.yaml`, and this
     plan (S11 deletes it).
   - `CLAUDE.md` to roughly 85 lines by *moves*: the comment doctrine and the
     floor-raising judgment to `CONTRIBUTING.md` "Conventions"; the `dev/` inventory
     lists survivors only. Every fact a session cannot rediscover (the offline stub has
     no service registry; integration mode must not set
     `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`; the phacc Docker recipe on this host) stays.
   - New `tests/test_docs_links_offline.py`: every relative Markdown link in
     `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` and `docs/*.md` resolves; the edge case
     proves the resolver reports a missing target.
   - The plain-text sweep: `grep -rn "dev/" README.md CONTRIBUTING.md CLAUDE.md docs/
     tests/ scripts/ .github/ .claude/` names no deleted path.

phacc: not required.

Live checks: none.

Handover hand-tests: `[desktop]` read the trimmed `CLAUDE.md` and the grown
`CONTRIBUTING.md` as the person who will paste S10's prompt — is anything a session
needs now missing from both? **Owner merges the #216 PR**; S10 starts after.

### 6.10 S10 — #217: the README — owner merges

One PR, left open: **"docs: user-first README with screenshots"** — closes #217. The
notes' eleven-section outline at roughly 150 lines; `docs/developing.md` receives the
developer material (rewording the surviving WP references in transit and fixing the
`--examples-config` claim that names a directory that does not exist);
`docs/installing.md` receives the long-form install mechanics; the two my.home-assistant
redirect badges; the known-limitations list kept almost verbatim; troubleshooting
written for HA OS. Absorb the one-line edits S3, S5 and S8 made to the old structure.

**Screenshots are taken in this session** (the notes deferred them to "the owner runs the
harness"; that is now an in-session step): the full view on desktop in the light theme
as the hero; the card with the item editor open; the phone layout — captured on the dev
HA with realistic, English, tidy seed data (no `hvstress_` fixtures, no dangling
attachments — the `run-haventory` skill's seeding recipe), committed under
`docs/assets/screenshots/`, referenced by absolute `raw.githubusercontent.com` URL so
GitHub and the HACS info panel resolve the same string. The image-resolution test from
the notes (extend `tests/test_docs_links_offline.py`) proves each reference names a
committed file. The PR does not reach "evidence complete" with an empty image slot.

Hard constraint: `tests/test_min_ha_version.py` pins the README to exactly two spellings
of the floor. Keep both, or move a `DECLARATION_SITES` entry with the text. The number
itself is never edited — `hacs.json` is the source.

phacc: not required.

Live checks: the three screenshots exist and look like the product; both redirect
badges land where they claim (the HACS repository dialog; the HAventory config flow).

Handover hand-tests: `[desktop]` read the README as a stranger who has never seen
HAventory — can you install it, add the card and write one automation from this page
alone? `[HA settings]` after 0.7.0 is released: the HACS info panel renders the images.
**Owner merges the #217 PR**; S11 starts after.

### 6.11 S11 — the online regression, jank and usability pass (Fable 5)

Start condition: S10's PR is merged and every V0.7.0 issue is closed; release-please's
0.7.0 PR may be open but **is not merged** — this session's fixes ship in 0.7.0.

The session deploys `main` to a clean dev HA and spends its whole budget trying to find
what is wrong with it. It is not a feature session. Its order:

1. **A clean, realistic instance.** Wipe the store (the volume route), reseed through
   `import/execute` with a household-shaped inventory: a nested location tree under the
   existing areas, several hundred items with German and English names, real photo
   attachments (no dangling references), custom statuses, check-outs with due dates,
   inspection dates, reminders with month-end anchors, low-stock thresholds that put a
   few items on the to-do bridge. Record the seed script in the scratchpad, not the repo.
2. **Every automated regimen the repo has**, in this order, stopping to file on the
   first red: the offline gates; the `test-haventory` stress regimen (fuzz, bulk, races,
   rate-limit, restart); the live-update smoke in Chromium *and* Firefox; the online WS
   pytest smokes; the visual pass (desktop, mobile, panel) in light and dark; the
   lifecycle probe (restart, the above-range refusal, the corrupt-row repair).
3. **The product, driven the way a household uses it**, through Playwright against the
   real frontend at desktop width and at 375px, in English and in German, light and
   dark: first run and the config flow; add an item with a photo; search, filter, sort,
   quick filters; the organize dialog's four tabs; bulk operations; check-out and
   return; reminders (create, read, mark done, the month-end series); import/export
   round trip with a conflict under each policy; every `haventory.*` service from
   Developer Tools → Actions with its response; the to-do bridge; the calendar entity
   on a calendar card; the four sensors; Settings → Repairs with a hand-broken store;
   keyboard-only navigation of the table and the dialogs; a throttled network and a
   dropped WebSocket with a reconnect; two tabs with a forced `conflict`. Adapt the
   scenarios of `dev/release_testing_plan.md` (A–J) wherever they fit a single dev
   instance — that document is the fuller list.
4. **What to look for**, in this order of importance: a regression against 0.6.0 (the
   0.6.0 container image or a `git worktree` at the tag is the control); a new bug; jank
   — layout shifts, flashes of wrong state, interactions that take longer than they
   should, scroll jumps, focus lost after a dialog; usability — a label that misleads, a
   dead end, an action with no feedback, German that reads like a translation.
5. **Outputs.** Every finding is an issue with the bug template, a reproduction and a
   screenshot; milestoned **V0.7.0** if it should ship in 0.7.0, otherwise V0.8.0 or
   unmilestoned — and not filed at all if it does not clear CLAUDE.md's bar (say so in
   the handover instead). A fix that is small, obvious and test-covered ships as its own
   PR, squash-merged under §4; anything larger is an issue only. A closing comment on
   #236's V0.7.0 line summarises what was run and what was found. The last PR deletes
   `dev/V0_7_0_implementation.md`.

Model: Fable 5, effort `xhigh`. Session budget is the constraint, not the list: go deep
on the flows a household hits daily before going wide.

Handover hand-tests — the things this session structurally cannot do: `[phone]` the
companion app on a real phone against the dev HA (owner pre-flight item 3) or the
owner's own instance — swipe, long-press, the photo picker, the keyboard covering the
editor; `[HA settings]` the production store's upgrade to 0.7.0 after the release is
merged (take a JSON export first, as always); `[desktop]` German wording that only a
native reader catches.

## 7. The prompts

One prompt per session, paste-ready. Each assumes this plan is merged to `main`, names
its model on the first line, and restates its own start condition.

### 7.1 S1 — start when this plan is on `main`

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S1
of the V0.7.0 plan; start only when dev/V0_7_0_implementation.md is on main. Read that
file's §4 (rules, including the handover format and the phacc Docker recipe) and §6.1
(your session), then issues #285, #196 (the brands half only), #482 and #466 — their
bodies and implementation notes are the design. Where a note has drifted from the
code, decide against the code and record the decision in the PR body; do not edit the
issue. §6.1 already takes two decisions for you: no schema bump for the _generation
cut, and the stored form stays exactly today's.

Deliver four PRs, in this order:
1. "test(brand): bind the card's mark and the social preview to one geometry" —
   closes #285, and carries the brands prep: the raster assets rendered from the
   TypeScript constant under docs/assets/brand/, plus the brands PR body and the gh
   commands written into the handover. Do NOT open the external brands PR.
2. "refactor(storage): stop persisting the write-only `_generation`" — refs #482.
3. "refactor(models): one `to_dict()` per model" — closes #482.
4. "fix(storage): count a stored row with no name as unreadable" — closes #466.

Both gates before every commit; scripts/test_integration.sh (Docker recipe) before
merging PRs 2–4; then the live checks in §6.1 against the dev HA (run-haventory skill),
evidence in the PR body. Restore the dev store after the corrupt-row check.
Squash-merge each PR yourself once gates, phacc, CI and live checks are green; delete
the branch. Branch names claude/v0-7-0-s1-<topic>. Never touch a release-please PR.
End with the ## Handover block from §4, in the last PR body and in your final message.
```

### 7.2 S2 — start when S1 has merged all four PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S2
of the V0.7.0 plan; start only when S1's four PRs are merged and #285, #482 and #466
are closed. Read dev/V0_7_0_implementation.md §4 (rules, handover format, phacc Docker
recipe) and §6.2 (your session), then issues #493, #450, #280 and #430 — #493's body
and the others' notes are the design. #280's notes say to land after #230; the plan
inverts that on purpose (§5). Decide drifted details against the code and record
decisions in the PR body; do not edit the issues. The stored payload is settled: if
anything here would change what serialize_state writes, stop and report.

Deliver four PRs, in this order:
1. "feat(sensor): checked-out, locations and inspection-due counts" — closes #493.
2. "fix(services): broadcast service mutations to WebSocket subscribers" — closes #450.
3. "refactor: move the runtime onto `entry.runtime_data`" — closes #280.
4. "fix(logging): put the context a bug report needs into the message text" — closes #430.

Both gates before every commit; scripts/test_integration.sh (Docker recipe) before
every merge — all four PRs ship something only the phacc suite can see. Then the live
checks in §6.2 (two tabs, reload + options change, the log grep), evidence in the PR
body. Squash-merge each PR yourself once gates, phacc, CI and live checks are green;
delete the branch. Branch names claude/v0-7-0-s2-<topic>. Never touch a release-please
PR. End with the ## Handover block from §4, in the last PR body and in your final
message.
```

### 7.3 S3 — start when S2 has merged all four PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S3
of the V0.7.0 plan; start only when S2's four PRs are merged. Read
dev/V0_7_0_implementation.md §2 item 2 (the Codecov rule), §4 (rules, handover format,
phacc Docker recipe) and §6.3 (your session), then issues #433, #235 and #210 — their
bodies and implementation notes are the design; #433 takes its option 1 and #235 its
notes' recommendation. Decide drifted details against the code and record decisions in
the PR body; do not edit the issues.

Deliver three PRs, in this order:
1. "build: raise the Python floor to the one Home Assistant requires" — closes #433.
2. "docs: one declared floor, and a guard against a second README version" — closes #235.
3. "ci: Dependabot pip block, wider tsc gate, frontend pre-commit hooks, moderate audit
   level, coverage upload, digest-pinned actionlint" — closes #210. Check
   `gh secret list` for CODECOV_TOKEN first: present → implement coverage; absent →
   drop that bullet and say so. Do not ask.

Both gates before every commit; scripts/test_integration.sh (Docker recipe) before
merging PR 1. Live checks per §6.3. Squash-merge each PR yourself once gates, CI and
checks are green; delete the branch. Branch names claude/v0-7-0-s3-<topic>. Never touch
a release-please PR. End with the ## Handover block from §4, in the last PR body and in
your final message.
```

### 7.4 S4 — start when S3 has merged all three PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S4
of the V0.7.0 plan; start only when S3's three PRs are merged. Read
dev/V0_7_0_implementation.md §4 (rules, handover format) and §6.4 (your session), then
issues #432, #212 and #209 — their bodies and implementation notes are the design and
leave no decision open; §6.4 fixes the one precedence choice in #432 (.env wins).
Where a note's file or line has moved, grep for the symbol and record the drift in the
PR body; do not edit the issues.

Deliver three PRs, in this order:
1. "fix(skills): make stress.py honour the worktree's .env and name its target" —
   closes #432.
2. "test(skills): branch-discriminating desktop surfaces and `--dashboard` selection" —
   closes #212.
3. "test(card): fake-timer the remaining wall-clock waits; sweep pending timeouts in
   teardown" — closes #209.

Both gates before every commit (plus `node --test` in .claude/skills/run-haventory/ for
PR 2); no phacc run needed. Live checks per §6.4 against the dev HA (run-haventory
skill), evidence in the PR body. Squash-merge each PR yourself once gates, CI and
checks are green; delete the branch. Branch names claude/v0-7-0-s4-<topic>. Never touch
a release-please PR. End with the ## Handover block from §4, in the last PR body and in
your final message.
```

### 7.5 S5 — start when S4 has merged all three PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S5
of the V0.7.0 plan; start only when S4's three PRs are merged. Read
dev/V0_7_0_implementation.md §4 (rules, handover format, phacc Docker recipe) and §6.5
(your session), then issues #208, #227 and #366 (item 4 only) — their bodies and
implementation notes are the design. Decide drifted details against the code and
record decisions in the PR body; do not edit the issues, except the one #366 comment
§6.5 describes if the cut line is taken.

Deliver three PRs, in this order:
1. "test(integration): cover the debounced persist, the downgrade refusal, the error
   envelope and the retired-files sweep against real HA" — closes #208.
2. "ci: run the integration suite against the newest Home Assistant monthly" —
   closes #227. Dispatch it once after merge.
3. "ci: drive the card's live smoke against Home Assistant stable and beta on a
   schedule" — refs #366 item 4. The cut line in §6.5 applies: one honest attempt,
   then either green or a comment on #366 and a re-filed V0.8.0 issue.

Both gates before every commit; scripts/test_integration.sh (Docker recipe) before
merging PRs 1 and 2. Live checks per §6.5 (both workflows dispatched, step summaries in
the handover). Squash-merge each PR yourself once gates, phacc, CI and checks are
green; delete the branch. Branch names claude/v0-7-0-s5-<topic>. Never touch a
release-please PR. End with the ## Handover block from §4, in the last PR body and in
your final message.
```

### 7.6 S6 — start when S5 has merged its PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S6
of the V0.7.0 plan; start only when S5's PRs are merged. Read
dev/V0_7_0_implementation.md §4 (rules, handover format, phacc Docker recipe) and §6.6
(your session), then issue #353 top to bottom — its findings are the design, its "what
must not be purged" list is the boundary, and its counts are stale: re-run findings 6,
7 and 8 as queries against the current tree and purge what they find.

Deliver two PRs, in this order:
1. "test: purge backend tests that pin no real-world behaviour" — refs #353.
2. "test(card): purge stylesheet-regex, negative-CSS and duplicated guard-matrix
   tests" — closes #353.

Both gates before every commit; a scripts/test_integration.sh run (Docker recipe) for
PR 1 proving tests/integration/ is untouched. Per-deletion accounting and the
must-not-purge check go in each PR body. Branch names claude/v0-7-0-s6-<topic>.

DO NOT MERGE EITHER PR. Your end state is: both PRs open, everything green, accounting
complete, the ## Handover block from §4 in both PR bodies and in your final message.
The owner's merge is the go. Report and stop.
```

### 7.7 S7 — start when the owner has merged S6's two PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S7
of the V0.7.0 plan; start only when S6's two PRs are merged and #353 is closed. Read
dev/V0_7_0_implementation.md §4 (rules, handover format) and §6.7 (your session), then
issues #426, #490 and #366 (items 1 and 3; item 4 was S5's — check #366's comments for
whether it landed or was re-filed). Their bodies and implementation notes are the
design. Where a file or line has moved, grep for the symbol and record the drift in the
PR body; do not edit the issues.

Deliver three PRs, in this order:
1. "fix(card): keep the location tree's tally whole when an area name is long" —
   closes #426. Before/after screenshots in the PR body.
2. "feat(card): show the row thumbnail in the full view and the sidebar panel" —
   closes #490. Measure the name column at the docked-sidebar width and at 375px
   before and after; screenshots in the PR body.
3. "refactor(card): name the Home Assistant contact surface in one module and hold
   `ha-*` at zero" — closes #366 (or refs it, per its comments).

Both gates before every commit; no phacc run needed. Live checks per §6.7 against the
dev HA (run-haventory skill) — registration is checked in Firefox, not Chromium —
evidence in the PR body. Squash-merge each PR yourself once gates, CI and checks are
green; delete the branch. Branch names claude/v0-7-0-s7-<topic>. Never touch a
release-please PR. End with the ## Handover block from §4, in the last PR body and in
your final message.
```

### 7.8 S8 — start when S7 has merged both PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S8
of the V0.7.0 plan; start only when S7's two PRs are merged. Read
dev/V0_7_0_implementation.md §4 (rules, handover format, phacc Docker recipe) and §6.8
(your session), then issue #190 — the owner's decision comment scopes it to German and
the implementation notes are the design, option by option. Match Home Assistant's own
German register and terms (read the installed core's translations in the dev
container). Decide drifted details against the code and record decisions in the PR
body; do not edit the issue beyond the closing comment §6.8 describes.

Deliver three PRs, in this order:
1. "feat(i18n): translation mechanism, German backend translations and the shared copy
   modules" — refs #190. An EN/DE table of every key goes in the PR body.
2. "feat(i18n): translate the card components (1/2)" — refs #190.
3. "feat(i18n): translate the card components (2/2)" — closes #190, with the docs,
   CONTRIBUTING recipe and README line.

Both gates before every commit; scripts/test_integration.sh (Docker recipe) before
merging PR 1. Live checks per §6.8 (the dev HA profile set to Deutsch, then restored),
screenshots in the PR body. Squash-merge each PR yourself once gates, phacc, CI and
checks are green; delete the branch. Branch names claude/v0-7-0-s8-<topic>. Never
touch a release-please PR. End with the ## Handover block from §4 — the owner's
hand-test is reading the German — in the last PR body and in your final message.
```

### 7.9 S9 — start when S8 has merged all three PRs

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S9
of the V0.7.0 plan; start only when S8's three PRs are merged and #190 is closed. Read
dev/V0_7_0_implementation.md §4 (rules, handover format) and §6.9 (your session), then
issues #441 and #216 — their bodies, comments and implementation notes are the design,
and §6.9 lists the dev/ inventory as it is today with a disposition per file (the
notes' list is stale). If the owner's German wording list from S8's handover exists,
ship it first as a small "fix(i18n): …" PR.

Deliver two PRs, in this order:
1. "docs: state the invalid_format / validation_error split as a rule; count the
   sortable fields right" — closes #441. Read both files end to end while they are open.
2. "docs: purge development residue and trim CLAUDE.md" — closes #216. Keep
   dev/release_testing_plan.md, dev/ha_config_for_dev.yaml and
   dev/V0_7_0_implementation.md; everything a session cannot rediscover stays in
   CLAUDE.md or moves to CONTRIBUTING.md, never disappears.

Both gates before every commit; no phacc run needed. Squash-merge PR 1 yourself once
gates and CI are green. Branch names claude/v0-7-0-s9-<topic>. Never touch a
release-please PR.

DO NOT MERGE PR 2. Its end state is: open, everything green, the link test and the
grep sweep clean, the ## Handover block from §4 in its body and in your final message.
The owner's merge is the go. Report and stop.
```

### 7.10 S10 — start when the owner has merged S9's #216 PR

```
Model for this session: Opus 5, effort xhigh.

Work in the HAventory repo, branching off the current origin/main. You are session S10
of the V0.7.0 plan; start only when S9's #216 PR is merged. CLAUDE.md is now short —
read CONTRIBUTING.md in full as well. Read dev/V0_7_0_implementation.md §4 (rules,
handover format) and §6.10 (your session), then issue #217 — its body and
implementation notes are the design. The screenshots are yours to take in this session
on the dev HA (run-haventory skill), with tidy English seed data; the notes' "owner
runs the harness" is stale. Decide drifted details against the code and record
decisions in the PR body; do not edit the issue.

Deliver one PR: "docs: user-first README with screenshots" — closes #217. Absorb the
one-line README edits earlier sessions made into the new structure. Keep the two
minimum-version spellings tests/test_min_ha_version.py pins, or move a
DECLARATION_SITES entry with the text; never edit the number.

Both gates before every commit; no phacc run needed. Live checks per §6.10 (the three
images exist and look right; both redirect badges land). Branch name
claude/v0-7-0-s10-readme. Never touch a release-please PR.

DO NOT MERGE THIS PR. Its end state is: open, everything green, no empty image slot,
the ## Handover block from §4 in its body and in your final message. The owner's merge
is the go. Report and stop.
```

### 7.11 S11 — start when the owner has merged S10's #217 PR

```
Model for this session: Fable 5, effort xhigh. This session does not run on any other
model.

Work in the HAventory repo. You are session S11 of the V0.7.0 plan — the closing online
regression, jank and usability pass; start only when S10's #217 PR is merged and every
V0.7.0 issue is closed. Release-please's 0.7.0 PR may be open: never merge, edit or
close it — your fixes ship in it. Read dev/V0_7_0_implementation.md §4 (rules, handover
format) and §6.11 (your session) in full, CONTRIBUTING.md in full, and skim
dev/release_testing_plan.md's scenarios A–J for the fuller checklist. The
run-haventory and test-haventory skills are how you drive the dev HA.

Do, in order: (1) deploy main to a clean dev HA and reseed it household-shaped per
§6.11; (2) run every automated regimen the repo has, filing on the first red;
(3) drive the product as a household would — desktop and 375px, English and German,
light and dark, two tabs, throttled network — through the flows §6.11 lists, against
0.6.0 as the control; (4) look for regressions first, then new bugs, then jank, then
usability. Go deep on daily flows before going wide.

Outputs: an issue per finding (bug template, repro, screenshot; milestone V0.7.0 only
if it should ship in 0.7.0; not filed if it fails CLAUDE.md's real-world bar — say so in
the handover instead); small, obvious, test-covered fixes as their own PRs, both gates
and CI green, squash-merged by you, branch names claude/v0-7-0-s11-<topic>; a closing
comment on #236's V0.7.0 line summarising what ran and what was found; and a last PR
"chore(dev): retire the V0.7.0 plan" deleting dev/V0_7_0_implementation.md.

Restore the dev HA's profile language and anything else you changed. End with the
## Handover block from §4 — its hand-test list is the real phone, the production
upgrade and the German a native reader catches — in your final message.
```

## 8. Milestone exit

V0.7.0 closes when:

- All 23 issues in the milestone are closed — implemented, or closed as not-planned with
  the reason in the issue — plus whatever S11 filed into it.
- The stored payload has stopped moving: `_generation` is gone, one `to_dict()` per
  model, and nothing after S1 changed `serialize_state`'s output (#482's condition for
  the V0.8.0 collapse).
- The brands PR is filed under the owner's name (external timeline; it need not be
  merged for 0.7.0 to ship).
- `CLAUDE.md` is trimmed, `dev/` holds only `release_testing_plan.md`,
  `ha_config_for_dev.yaml` and (until S11's last PR) this file, and the README is the
  user-first one with its three screenshots.
- Both gates green on `main`, one clean phacc run, both scheduled workflows dispatched
  once by hand with their step summaries on record.
- S11's handover is written, its findings are issues or merged fixes, and this file is
  deleted.
- The owner has merged release-please's 0.7.0 PR and run the hand-tests S11 left.

Per #236, V0.8.0 (subtraction, then the collapse) then opens on a shape that has stopped
moving.

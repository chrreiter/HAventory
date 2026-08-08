# v0.4.0 frontend completeness plan

Execution plan for the issues in the v0.4.0 milestone (frontend feature completeness):
[#241](https://github.com/chrreiter/HAventory/issues/241),
[#242](https://github.com/chrreiter/HAventory/issues/242),
[#296](https://github.com/chrreiter/HAventory/issues/296),
[#328](https://github.com/chrreiter/HAventory/issues/328),
[#332](https://github.com/chrreiter/HAventory/issues/332), plus the design question
[#205](https://github.com/chrreiter/HAventory/issues/205), which resolves without code.

Four work packages in two waves — **P1** (editor survival), **P2** (full view),
**P3** (editor drop target) run in parallel; **P4** (configurable quick filters) runs
after P1 and P2 merge. Each package is one PR, implemented by a fresh **Opus 5 (xhigh)
cloud session**; the package sections below are that session's working brief, and each
session also reads the GitHub issues its package closes. Opus 5 at xhigh is expected to
carry every package; P1 is the only one where, if the regression matrix fights back, a
higher tier would pay for itself.

All `file:line` anchors are taken at `main` @ `1e6c7e4`. **Anchors drift: locate by
symbol/testid first, treat the line number as a hint, and re-read every touched region
before editing.**

Per the `dev/` lifecycle rule in `CLAUDE.md`, this file does not outlive the work: P4's
PR (the last package) deletes it. If the schedule changes, whichever PR merges last takes
the deletion with it.

## Decisions already made with the repository owner

Sessions treat these as settled — do not relitigate them. The owner can veto any of them
before launching the sessions; after that they are the spec.

1. **#332 — what the list shows during a filtered refetch:** the rows already loaded,
   with the loading state signalled on top of them. The skeleton renders only when
   nothing is loaded yet (first paint, cleared store). Blanking the list on every filter
   keystroke is what tears the open editor down; keeping the previous rows is the fix
   and is also the honest display — they are labelled as loading.
2. **#332 — an open editor whose row stops matching the filter:** the editor stays
   mounted, pinned, with a quiet hint on the pinned row ("No longer matches the current
   filters"), until the user saves or cancels. Typed edits are never discarded silently —
   that is the bug, not an option.
3. **#328 — scope of the full view's error surfacing:** bind `.errorMessage` (the mirror
   of what PR #327 did for the shell) and move the shared sentence-builder
   `editorErrorText` to `src/ui/editor-error.ts`. The full view does **not** gain the
   shell's banner list now: a save conflict there shows its message without the
   "View latest" / "Re-apply my change" actions. If real use misses those actions, that
   is a new issue then — it has to clear `CLAUDE.md`'s real-world-impact bar.
4. **#242 — where column order lives and how it is changed:** order becomes part of the
   existing per-browser localStorage selection (the full view's setting alone — not card
   YAML). Reordering uses up/down buttons in the column picker, the same idiom as the
   organize dialog's status rows and the photo strip. Pointer drag stays #297's later
   one-answer decision and is additive when it comes.
5. **#241 — config shape:** one new optional card-config key, `quick_filters`, a list
   drawn from `total`, `low_stock`, `overdue`, `inspection_due`, `checked_out`. Omitted
   key = all pills (today's behavior); unknown entries are ignored, per `setConfig`'s
   stated philosophy of never breaking a dashboard on a key the card does not read. The
   config governs which pills are *allowed*; the existing count-gating still decides
   which allowed pills actually show. It applies to the shell's app-bar badges and the
   full view's count pills alike — one vocabulary, both surfaces.
6. **#205 — resolved without code:** keep both controls. Rationale and close text in
   §"#205" below; the owner closes the issue directly.

## Session model

Implementation sessions run **in the cloud** — no Docker dev HA, no screenshot tooling. A
cloud session must not attempt live verification itself. The flow per package:

1. **Cloud session**: implement → run both offline gates → commit → push → **open the PR**.
2. The cloud session's final message is a **handover prompt** for a local session
   (template below), and the PR body states plainly which checks are delegated to that
   local pass.
3. **Local session** (has the Docker dev container + the `run-haventory` skill): executes
   the checklist, and on any defect fixes it, re-runs the gates, and pushes to the same PR
   branch.
4. The **user** merges. Nobody else merges; auto-merge is never enabled.

### Kickoff prompt (per package, for a fresh cloud session)

> Read `dev/v040_frontend_completeness_plan.md` in full, then the GitHub issues work
> package **Pn** closes. Implement Pn exactly as scoped, on a new branch from the latest
> `main`. Follow the campaign rules and the "Decisions already made" section — settled
> decisions are the spec, not a starting point. Your final message is the handover
> prompt for a local verification session (template in the plan).

### Handover prompt template

The handover prompt must work for a cold local session with zero context:

> Check out branch `<branch>` (PR #NNN) of chrreiter/HAventory. Use the `run-haventory`
> skill to deploy the integration + card to the dev HA container. Then: `<the package's
> checklist from §Verification, expanded into concrete steps with expected outcomes>`.
> If a check fails, fix it on this branch, re-run the offline gates (backend:
> `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`, `uv run ruff check .`,
> `uv run ruff format --check .`, `uv run mypy`; frontend, in `cards/haventory-card`:
> `npx eslint .`, `npm run typecheck`, `npx vitest run`, `npm run build`), and push.
> Report each check's outcome; do not merge the PR.

## Campaign rules (every package)

- **Gates before every commit** — backend: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`,
  `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`. Frontend (in
  `cards/haventory-card`): `npx eslint .`, `npm run typecheck`, `npx vitest run`,
  `npm run build`. Both must be green even though these packages touch only the card.
- **TDD**: every change ships with tests — happy path plus at least one edge/error case.
  Where a package deliberately breaks an existing pin, rewrite the pin to assert the new
  behavior; never delete an assertion without a replacement.
- **Conventional Commits**; the PR title is the squash commit and is lint-enforced.
- **Comments explain constraints, not history**, and **no stock AI-review vocabulary**
  anywhere — code, PR bodies, handover prompts (`CLAUDE.md` § Conventions has both rules).
  If a touched region carries an existing occurrence, rewrite it in passing.
- **Docs sync**: #241 adds a config key and #242 changes what the column picker does —
  both update the README (config table / full-view description) in the same PR. Grep
  `docs/frontend_architecture.md` for statements the change falsifies.
- **Out-of-scope findings** become issues only when they clear the real-world-impact bar
  in `CLAUDE.md`; below that bar, a sentence in the PR's "Follow-ups" note is the ceiling.
- Nothing inside `custom_components/haventory/` is deleted or renamed here, so no
  `RETIRED_PATHS` entry is needed anywhere.
- Issue wiring: P1's PR body carries `Closes #332`; P2's carries `Closes #328` and
  `Closes #242`; P3's carries `Closes #296`; P4's carries `Closes #241`.

## Sequencing

```
Wave 1 (parallel, disjoint files up to one declared seam):
  P1 — store/store.ts · hv-list.ts · hv-card-shell.ts · their tests
  P2 — hv-full-view.ts · hv-data-table.ts · hv-column-picker.ts · store/columns.ts
       · new ui/editor-error.ts · their tests
  P3 — hv-item-editor.ts · its tests

Wave 2 (after P1 AND P2 merge):
  P4 — index.ts · hv-card-shell.ts · hv-full-view.ts · README · their tests
```

**The one seam:** P2 moves `editorErrorText` out of `hv-card-shell.ts` (`:1316`) into
`src/ui/editor-error.ts`, so P2 makes a three-line edit in a file P1 owns. P1 must not
touch that function or its import block; the regions are far apart, and whichever PR
merges second rebases trivially. Everything else in Wave 1 is file-disjoint.

P3 is independent of both: `hv-item-editor.ts` belongs to no other package. (P1's fix
keeps the editor *element* alive from the outside; it must not edit the editor itself.)

## P1 — #332: an open editor survives filter, search, and sort changes  `size M`

### Objective

Typing in the search box, toggling any filter, or changing the sort while an inline
editor is open never discards typed edits. The editor element survives; the list shows
its loaded rows (marked loading) instead of a skeleton during the refetch; a row edited
out of the filter stays pinned until save/cancel.

### Scope

1. **Stop blanking the list on filter changes.** `Store.setFilters`
   (`cards/haventory-card/src/store/store.ts:1007`) sets `items: [], total: null,
   loading: true` on every call — that is what sends `hv-list.render()` into its skeleton
   branch (`hv-list.ts:178`, `loading && !items.length`) and replaces the scroller,
   destroying the open `hv-item-editor`. Keep `cursor: null` and `loading: true`; stop
   clearing `items`/`total`. The refetch (`listItems(true)`) already replaces the array
   when it lands. Keep the selection clearing (a row no longer listed cannot stay
   selected) and the location-change subscription teardown — both are deliberate.
2. **Signal the in-flight state over the kept rows.** The skeleton now appears only when
   nothing is loaded yet. While `loading` is true with rows present, the scroller carries
   `aria-busy="true"` and a visible but quiet signal (dimming or equivalent). Pick the
   smallest honest signal; no spinner rows, no layout shift.
3. **Pin the edited row when it stops matching.** With `editingItemId` set and the
   refetched `items` no longer containing that id, the editing row stays rendered (the
   shell retains what it needs to keep rendering it) with a hint reading
   "No longer matches the current filters". The pin releases on save or cancel. The
   mechanics (where the retained item snapshot lives) are the session's call; the
   requirement is that the open editor is never unmounted by a data refetch.
4. **The regression matrix is the issue's own measurements**: search typing, a filter
   toggle (low-stock), and a **sort** change — the `setFilters` path that skips
   `scheduleTreeRefresh` and moved no `editorEpoch` input, which is how the issue proved
   this is independent of #322/#327.
5. **Check `hv-full-view` for the same class of bug** — it hosts the editor directly
   (not through `hv-list`), but it has its own search box over the same store. Verify
   whether a filtered refetch can unmount its `_editing` editor; if it can, the same
   invariant applies there. Investigate and report; only fix if broken, and without
   touching P2's regions (coordinate via rebase if it comes to that).

### Tests

- Store: `setFilters` keeps `items`/`total`; `loading` flips true then false when the
  fetch lands; selection still clears; location change still resubscribes.
- `hv-list`: skeleton renders only with no items; with rows + `loading`, rows stay and
  `aria-busy` is set. Rewrite the existing skeleton pins deliberately.
- Shell (the regression the issue demands, failing on `main` first): mount, open the
  inline editor, type into Name, call `setFilters` — same editor element, typed value
  intact. One case per matrix row (search / filter / sort).
- Pinned row: filter the edited item out — editor still mounted, hint rendered; save or
  cancel releases the pin.

### Verification & closing

Both gates. PR (suggested `fix(card): keep the open editor and its edits across filter,
search and sort changes`). **Handover required** — checklist in §Verification: P1.

## P2 — #328 + #242: full view — rejected saves surface; column order is the user's  `size M`

### Objective

A rejected save in the full view names its failure inside the open editor (busy state
clearing beside it), and the full view's column picker can reorder columns, with the
order persisting per browser like the selection already does.

### Scope — #328

1. **Move the helper.** `editorErrorText` (`hv-card-shell.ts:1316`) moves verbatim to
   `src/ui/editor-error.ts`; the shell imports it — that import swap is the only shell
   edit (see §Sequencing, the seam).
2. **Mirror the shell's mechanism in `hv-full-view.ts`.** `_onEditorSave` (`:945-963`)
   already detects failure by comparing `errorQueue` length before/after and keeps
   `_editing` open — set an `_editorError` state from the queue's newest entry there,
   bind `.errorMessage` on the editor (`:1779` — today only `.busy` is bound), and clear
   it when an editor opens, cancels, or saves clean. `hv-card-shell.ts:359/:624` is the
   pattern to mirror, not to import.

### Scope — #242

3. **Ordered selection.** `normalizeColumns` (`store/columns.ts`) currently forces the
   canonical `COLUMN_ORDER`; its meaning changes to validate + dedupe while preserving
   the given order. Canonical order remains the default and the picker's reset. Legacy
   stored arrays are already valid orders — they parse unchanged; keep the guarded
   localStorage access (`:114-117`) as is.
4. **Reorder controls in `hv-column-picker.ts`** — up/down buttons per row (the
   organize-dialog idiom), emitting the full new order through the existing `change`
   event; the container keeps owning persistence. A "Reset order" affordance restores
   canonical. Buttons meet the same touch sizing the rest of the card honours.
5. **`hv-data-table.ts` renders the given order** — the `_columns` getter (`:370`) and
   the grid template it feeds must follow the stored order. The sticky name column and
   the trailing actions are outside the optional set and must not move.

### Tests

- `normalizeColumns`: preserves order, dedupes, drops unknown keys, defaults to
  canonical; legacy stored value round-trips.
- Picker: up/down emits the permuted order; first/last rows disable the impossible
  direction; reset emits canonical.
- Data table: header order follows the prop; sort bindings still attach to the right
  columns after a permutation.
- Full view: reject `ws.updateItem` → open editor renders `editor-error` with the
  helper's sentence, busy clears; a clean save closes as before. Conflict entry produces
  the conflict sentence. Shell tests stay green across the helper move.

### Verification & closing

Both gates. PR (suggested `feat(card): adjustable column order; surface rejected saves
in the full view`). **Handover (short smoke)** — checklist in §Verification: P2.

## P3 — #296: drop files onto the editor to attach them (desktop)  `size S`

### Objective

Dropping one or several files on the open editor attaches them exactly as picking them
would — desktop only, kind decided by file type, through the existing upload queue.

### Scope

The issue's own scope/acceptance section is the spec; anchors:
`hv-item-editor.ts:2091` (photo picker label with `capture="environment"`), `:2136`
(picker change → `_uploadFiles(files, kind)`), `:1893` (`_uploadFiles` sequential
queue), `:1915` (`_sendOne`). In short:

1. Drop targets on the Photos and Documents cells with a visible over-state.
2. Kind by dropped file's type, not by cell: a PDF dropped on the photo strip attaches
   as a manual; an image dropped on Documents attaches as a photo; anything else is
   refused the way the pickers refuse it.
3. Everything routes through `_uploadFiles` — same preflight, downscale, per-file retry.
   Nothing new on the upload path.
4. `dragover` calls `preventDefault()`, and the editor root carries a guard so a missed
   drop does not navigate the page away from the form (HA's frontend does not block file
   drops).
5. `:host([mobile])` renders no drop target at all.

### Tests

jsdom constructs `DragEvent` without a real `DataTransfer` — stub a plain-object
`dataTransfer`. Assert the routing (which kind each dropped file becomes, including the
PDF-on-photos case), the multi-file case, `preventDefault` on `dragover`, and the
mobile no-op. The browser's real drag machinery is the handover's job.

### Verification & closing

Both gates. PR (suggested `feat(card): attach files by dropping them on the editor`).
**Handover required** — real drag and drop cannot be proven in jsdom.

## P4 — #241: configurable quick-filter pills  `size S/M`

Runs **after P1 and P2 merge** — it edits the shell's badge region and the full view's
count pills, both of which Wave 1 touches.

### Objective

A dashboard can choose which quick-filter pills the card offers, in YAML, without
breaking any existing dashboard.

### Scope

1. **Config.** `setConfig` (`index.ts:30`) currently reads `{ title }` and deliberately
   ignores everything else. Add `quick_filters` per decision 5: optional list of
   `total | low_stock | overdue | inspection_due | checked_out`; omitted = all; unknown
   entries dropped silently; a non-list value is treated as omitted. Plumb it to the
   shell the same way `title` travels.
2. **Shell.** `_renderBadges` (`hv-card-shell.ts:738-815`) renders `badge-total`,
   `badge-low`, `badge-overdue`, `badge-inspection`, `badge-out`, each count-gated. A
   pill renders only if allowed by config **and** its count clears today's gate. The
   mobile `anyBadge` collapse logic counts only allowed pills.
3. **Full view.** The app bar's count pills follow the same config — one vocabulary,
   both surfaces (decision 5). Locate them via the appbar comment (`hv-full-view.ts:104`
   region) and their testids.
4. **README**: config table row + a YAML example. Note in the PR body (not in code) that
   the future visual config editor (#222, staged later) picks this key up when built —
   nothing is built for it here.

### Tests

- `setConfig`: omitted / subset / unknown entries / non-list garbage — never throws,
  never breaks rendering.
- Shell: subset config renders only allowed pills (counts present); default renders all;
  mobile empty-band logic honours the subset.
- Full view: same subset assertions on its pills.

### Verification & closing

Both gates. PR (suggested `feat(card): configurable quick-filter pills`). **Handover
(short smoke)**. This PR also deletes `dev/v040_frontend_completeness_plan.md`.

## #205 — filter panel's area select vs the sidebar's area headers (no session)

**Decision: keep both controls; close the issue.** The panel's select is the only area
control on the mobile filter sheet — retiring it strands phones; hiding it only in the
desktop full view adds a mode to `hv-filter-panel` for the benefit of removing one row
from a panel that is not cramped. Both controls write the same `filters.areaId` and
cannot disagree. Revisit only if real use shows the sidebar is the control everyone uses.

Suggested close comment:

> Decided: both stay. The panel select is the mobile filter sheet's only area control,
> the two controls share `filters.areaId` and cannot disagree, and a desktop-only hide
> would add a mode to the panel for one saved row. Re-open if sidebar usage ever makes
> the select dead weight in practice.

## Verification — per-package handover checklists

Every PR runs both offline gates regardless. The checklists below are what the **local**
session (Docker dev HA + `run-haventory` skill) executes after the cloud session opens
the PR. The user merges only after this pass.

| Pkg | Handover | Checklist |
|---|---|---|
| P1 | **Required** | Wide/panel view, two items (one matching a filter, one not). Open the inline editor, type into Name, then: type in the search box; toggle low-stock; change the sort. After each: same form, typed text intact (the issue's DOM-stamping technique proves element identity). Filter the edited item out — row pinned with the "No longer matches" hint; save and cancel both release it. Fresh reload still shows the skeleton on first paint. Repeat the search-box case in the full view. Mobile sheet unaffected. |
| P2 | Short smoke | Full view: bump an item's version from a second surface, then save from the open editor — the error sentence renders inside the form and busy clears; fix and save clean — closes as before. Column picker: reorder via the buttons, close, reload the page — order kept (per browser); reset restores canonical; sticky name column and actions untouched at phone width. |
| P3 | **Required** | Desktop: drag an image and a PDF from the OS file manager onto each cell — four combinations, kind follows the file type every time; multi-file drop queues sequentially; a drop missed beside the target does **not** navigate the tab away; over-state appears and clears. 390px: no drop target rendered. |
| P4 | Short smoke | Edit the card YAML in the dev dashboard: no `quick_filters` → all pills (counts permitting); a two-entry list → exactly those; an unknown entry → ignored without console errors. Check the shell and the full view both follow it. Screenshot (light + dark) of a subset config. |

## Traceability

| Issue | Substance | Package |
|---|---|---|
| #332 | filter/search/sort changes discard an open editor's edits | P1 |
| #328 | full view says nothing when a save is rejected | P2 |
| #242 | column order fixed to canonical; picker can't reorder | P2 |
| #296 | desktop file-drop attach | P3 |
| #241 | quick-filter pills not configurable | P4 |
| #205 | duplicate area controls — design question | closed by owner, no code |

## Annex — candidates the owner may re-file into v0.4.x

Out of scope for the packages above; listed so a re-filing decision can slot them as
follow-on packages (each would be its own brief) without reopening this plan:

- **#222** — card picker statics, visual config editor, `getGridOptions` (currently
  V0.5.0; it is card work, on #236's mandatory list, and its config editor would cover
  #241's new key).
- **#314** — table name cell: inline chips take the name's width (currently V0.5.0).
- **#326** — detail sheet document rows clipped at phone width (currently V0.5.0).
- **#203** — area marker on phone rows; "No area" band label (currently V0.7.0).

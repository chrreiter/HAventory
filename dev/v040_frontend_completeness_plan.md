# v0.4.0 frontend completeness & consistency plan

Execution plan for the v0.4.0 milestone (frontend feature completeness), covering the
open issues
[#241](https://github.com/chrreiter/HAventory/issues/241),
[#242](https://github.com/chrreiter/HAventory/issues/242),
[#296](https://github.com/chrreiter/HAventory/issues/296),
[#328](https://github.com/chrreiter/HAventory/issues/328),
[#332](https://github.com/chrreiter/HAventory/issues/332), the design question
[#205](https://github.com/chrreiter/HAventory/issues/205) (resolves without code), and
the twenty-eight findings of the 2026-08-08 frontend UX triage, folded in below as the
**findings register** and packages **P5–P11**.

Eleven work packages, four implementation sessions, then a **final verification gate**
in real Home Assistant. The sessions run **strictly one at a time**, in order —
**Session A** (P1 → P2 → P3 → P4), **Session B** (P5 → P6 → P7), **Session C**
(P8 → P9 → P10), **Session D** (P11) — each a fresh **Opus 5 (xhigh) cloud session**
carrying its packages serially, **one PR per package**. The package sections below are
the working brief; each session also reads the GitHub issues its packages close. Opus 5
at xhigh is expected to carry every session; A and C are the two where, if the work
fights back, a higher tier would pay for itself. The final gate is different: it runs
**locally against the Docker dev HA and must use Fable 5** — see §Final gate.

All `file:line` anchors are taken at `main` @ `1e6c7e4`. **Anchors drift: locate by
symbol/testid first, treat the line number as a hint, and re-read every touched region
before editing.**

Per the `dev/` lifecycle rule in `CLAUDE.md`, this file does not outlive the work: the
**final gate's wrap-up PR deletes it** once the gate is green. If the campaign is cut
short, whichever PR merges last takes the deletion with it.

## Findings register (2026-08-08 UX triage)

What the owner reported plus what a code sweep confirmed, each verified in source. The
owner triages this register into GitHub issues at their own pace; **packages do not wait
for that**. When an issue exists by the time a package's PR opens, the PR body carries
its `Closes` line; add issue numbers to this table as they are filed.

| ID | Finding (user-visible symptom) | Where | Pkg |
|---|---|---|---|
| F1 | Organize is reachable only through the ⋮ menu; no top-level button on any surface | `host-surfaces.ts:181` | P6 |
| F2 | Organize renders full-bleed on a desktop monitor when opened from the card or expanded view; popup only from the panel | `hv-card-shell.ts:375` | P5 |
| F3 | Statuses tab: reorder arrows are 24px with a 15px glyph; rows ~71px tall vs ~48px on sibling tabs — the gap *is* the stacked arrow column | `hv-organize-dialog.ts:242-267` | P6 |
| F4 | Item rows show the arrow cursor although chips/pills/menus all show the hand — rows are `<div role="row">`, and only `button` gets `cursor: pointer` | `tokens.ts:191-193`, `hv-list-row.ts:467`, `hv-data-table.ts:546` | P11 |
| F5 | Expanded view: Save/Delete/Cancel sit below the fold; the sticky-footer rule is gated on `:host([mobile])` and the expanded host passes `mobile=false` | `hv-item-editor.ts:643`, `hv-full-view.ts:672-697` | P7 |
| F6 | Quantity and Low-stock inputs are ~400px wide for 1–3 digits — uncapped `2fr 1fr 1fr` tracks authored for card width | `hv-item-editor.ts:163-168` | P7 |
| F7 | Status select is taller than an input, shorter than the textarea beside it — nested-grid default stretch lands it at exactly the midpoint | `hv-item-editor.ts:163-168`, `:184-188` | P7 |
| F8 | Section labels split into two recipes (weight 500 vs 600); small print spans 11/11.5/12/12.5px; Checkout vs Next-inspection boxes differ in width, alignment and dead air | `hv-item-editor.ts:209-218`, `tokens.ts:277-283`, `hv-item-editor.ts:192-197`, `:228-231` | P7 |
| F9 | "0 of 2 keys in use" reads as a quota; the denominator is inventory-wide distinct keys and no quota exists anywhere | `hv-item-editor.ts:1739-1741`, `repository.py:1767` | P7 |
| F10 | Editor: Esc asks before discarding a dirty form; the Cancel button and ✕ discard instantly | `hv-item-editor.ts:1152-1166` vs `:2437`, `:2371` | P8 |
| F11 | Phone sheets: scrim tap / swipe-down discard a dirty form; the sheet's `dirty` getter is consulted by nothing | `hv-detail-sheet.ts:506-509`, `hv-card-shell.ts:1211-1214`, `:1252-1255` | P8 |
| F12 | Full view/panel: switching rows, the backdrop, and Esc all wipe a dirty form without asking (the card's row switch asks) | `hv-full-view.ts:938-942`, `:1525`, `:1534` | P8 |
| F13 | Connection loss, paused live updates and failed operations show a banner on the card and **nothing at all** on the full view and panel | `hv-card-shell.ts:812-955`, `haventory-panel.ts:131-147` | P9 |
| F14 | Panel at phone width has no read view: tapping a row opens the edit form; the card opens the detail sheet | `hv-full-view.ts:928-942` | P10 |
| F15 | Photos open full-size on one surface only (detail-sheet lightbox); editor thumbnails are inert `<img>`s everywhere else | `hv-detail-sheet.ts:647-718`, `hv-item-editor.ts:2065-2077` | P10 |
| F16 | Table rows have no row menu — Check out/in, Set due date, Delete exist on card rows only; the table's Delete-key shortcut has no visible equivalent | `hv-data-table.ts:585-618`, `:426-429` | P9 |
| F17 | Bulk check-out fires immediately with no due date, while single check-out always asks — so overdue highlighting never fires for bulk | `hv-bulk-bar.ts:50`, `:447-452` | P11 |
| F18 | Deleting a status **in use** skips the modal the zero-count case gets; same button, two ceremonies, the consequential path has the weaker one | `hv-organize-dialog.ts:1815-1817` | P6 |
| F19 | On phones: filters/detail/add/⋮ rise as bottom sheets, but Columns, Import, Diagnostics and every confirm stay small centered boxes | `host-surfaces.ts:228-315` | P5 |
| F20 | Three independent "mobile" signals (card element ≤600 / viewport ≤600 / viewport ≤700) produce mixed-mode UI for a narrow card in a wide window | `ui/responsive.ts:7`, `hv-overflow-menu.ts:147`, `hv-full-view.ts:55` | P5 |
| F21 | The filled primary button exists in ~6 hand-rolled sizes; only two of seven sites use the shared `.hv-pill` | `tokens.ts:205` + five local rules | P11 |
| F22 | "Clear all" renders three ways (grey 12px / blue 12.5px / blue 13px padded); two visible at once on a filtered card | `hv-filter-chips.ts:165-174`, `hv-filter-panel.ts:311-317`, `hv-full-view.ts:1407-1409` | P11 |
| F23 | Close verbs: Done / Close / Cancel / Dismiss — and Diagnostics draws its Close as the filled primary, the shape that means "commit" everywhere else | `hv-diagnostics-panel.ts:397`, `hv-bulk-bar.ts:408-414` | P11 |
| F24 | "Checkout" heading above a "Check out…" button; the organize surface is named "Organize…" / "Organize inventory" / "Organize" in three places | `hv-item-editor.ts:1571` vs `:1582`; `hv-organize-dialog.ts:2163` | P7, P6 |
| F25 | Import preview prints the raw policy id ("policy **merge**") instead of the card label the user picked ("Merge") | `hv-import-sheet.ts:546`, `:19-35` | P11 |
| F26 | Location tree rows highlight full-width but only the name text is clickable; the facet rows below (and the tree's own All-items/No-location rows) are full-row buttons | `hv-location-tree.ts:511-524` vs `:789`, `:813` | P11 |
| F27 | The bulk-run Cancel is an unstyled native button, and the bulk bar hardcodes `#263238`/`#ef9a9a` — the only surface ignoring the tokens and the HA theme | `hv-bulk-bar.ts:361-367`, `:110-144` | P11 |
| F28 | The two "Showing N of M" footers phrase the same fact differently and neither names the noun | `hv-card-shell.ts:1119-1138`, `hv-full-view.ts:1851-1855` | P11 |

Verified consistent during the same sweep (no work needed): search debounce (200ms both
surfaces), date rendering (all through `ui/relative-time.ts`), pluralization (`counted()`
at every count site), shared empty states, optimistic single-item writes with rollback.

## Decisions already made with the repository owner

Sessions treat these as settled — do not relitigate them. Decisions 7–17 come from the
2026-08-08 triage and were **ratified by the owner on 2026-08-08**; they are the spec.
Decisions 1–6 date from this plan's first draft and stand unless the owner vetoes one
before Session A launches.

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
   shell's banner list *in P2* — a save conflict there shows its message without the
   "View latest" / "Re-apply my change" actions. Decision 13 supersedes the deferral:
   P9 brings the banner list to the full view and panel later in the campaign. P2 stays
   minimal so Wave 1 stays parallel.
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
7. **F1 — where Organize lives:** promoted to an app-bar icon button in the full view
   (one edit covers the expanded view and the panel, since they share the app bar; the
   columns button at `hv-full-view.ts:1502-1513` is the exact pattern). The ⋮ entry
   stays — the plain card keeps menu-only, its header has no room. The Statuses sidebar
   section gains the head action the other three facet sections already have, opening
   Organize on the Statuses tab.
8. **F2/F19/F20 — a dialog matches the viewport, not the card:** the shell's host
   dialogs switch on a viewport media query, exactly as the panel already does; the
   card-element measurement stays for in-card layout only (list, steppers, sheets), which
   is what `ui/responsive.ts` argues for. On phone viewports, Columns, Import,
   Diagnostics and confirm become bottom sheets like every other phone surface; the
   full-bleed organize page stays for true phone viewports.
9. **F3 — status reordering stays buttons** (pointer drag remains #297's later
   one-answer decision, additive when it comes): a horizontal pair at ≥28px on desktop,
   the 44px vertical stack stays on phones where a horizontal pair does not fit the row.
   Row padding tightens so status rows match the sibling tabs' height — and the
   Categories, Tags and Locations tabs tighten with them (owner, 2026-08-08): the
   density pass covers all four tabs, not only Statuses.
10. **F18 — status delete asks in both branches, one idiom:** the inline disclosure the
    in-use branch already uses (it scrolls into view since #329). The zero-count branch
    moves off `hv-confirm` into the same disclosure, minus the reassign select.
11. **F5 — the editor footer is sticky on every host**, not only `:host([mobile])`. The
    editor solves it once itself; hosts do not each grow a pinned footer.
12. **F10/F11/F12 — one dirty rule:** no path discards typed edits without asking.
    Escape, Cancel, ✕, scrim tap, sheet swipe, row switch, backdrop, view close — all
    consult the editor's `dirty` and route through the same confirm with the same
    wording. (P1's pinned-row invariant is the same rule applied to data refetches.)
    Draft autosave — the feature that would make most of these questions unnecessary —
    is filed as [#334](https://github.com/chrreiter/HAventory/issues/334) and stays
    outside this campaign: the guards land first.
13. **F13 — failures are visible on every surface:** the full view (and through it the
    panel) gains the shell's degraded banners and error queue, actions included. Builds
    on P2's minimal `.errorMessage` binding; the inline sentence stays the save-failure
    surface, the banner queue carries everything else — the split is stated in one
    comment where the two meet.
14. **F17 — bulk check-out asks like single check-out:** it opens the same checkout
    popover once; the picked date (or an explicit "No due date") applies to every
    selected item. It loses `immediate`. Bulk check-in stays immediate — there is
    nothing to ask.
15. **F23 — close-verb vocabulary:** "Cancel" only where typed input is abandoned;
    "Done" only where changes were applied live while the dialog was open (the column
    picker); "Close" everywhere else. A button that merely dismisses is never drawn as
    the filled primary.
16. **F14 — the detail sheet is the shared read view:** on narrow viewports the full
    view and panel open it exactly as the card does, with Edit one tap deeper. The
    desktop full view keeps the inline editor — the table is its own read surface.
17. **F21 — one primary-button recipe:** `.hv-pill` (plus a size modifier where touch
    sizing demands one). The per-dialog variants are deleted, not deprecated.

## Session model

Four implementation sessions, each carrying its packages **serially, one PR per
package**:

| Session | Packages, in order | Substance |
|---|---|---|
| A | P1 → P2 → P3 → P4 | the issue-closing four |
| B | P5 → P6 → P7 | dialog surfaces, organize, editor reconciliation |
| C | P8 → P9 → P10 | dirty guards, surface parity, shared read view |
| D | P11 | the consistency sweep |

Sessions run **one at a time, in order** — every session builds on the merged result of
the one before, and serial execution also keeps the owner's usage limits out of the
schedule: a single Opus 5 (xhigh) session is heavy on its own, and two running at once
would race each other into the cap and stall both mid-implementation.

Implementation sessions run **in the cloud** — no Docker dev HA, no screenshot tooling.
A cloud session must not attempt live verification itself. The flow:

1. **Cloud session**: for each package in its list — implement → run both offline
   gates → commit → push → **open the PR** — then start the next package on a branch
   cut from the previous package's branch. The repo squash-merges, so a session's PRs
   are **stacked**: each PR body names its base PR and says "merge in order", and after
   a parent squash-merges, the child is rebased onto `main`
   (`git rebase --onto origin/main <parent-branch>`) before it merges — the local
   verification session does that rebase as part of its pass.
2. The cloud session's final message is a **handover prompt** for a local session
   (template below) covering every package it shipped, and each PR body states plainly
   which checks are delegated to that local pass.
3. **Local session** (has the Docker dev container + the `run-haventory` skill): works
   through the session's per-package checklists in merge order, and on any defect fixes
   it, re-runs the gates, and pushes to that package's PR branch.
4. The **user** merges. Nobody else merges; auto-merge is never enabled.

The **final gate** (§Final gate) is not a per-package handover: it is one whole-campaign
verification session, run locally, after all eleven packages have merged — and it
**must use Fable 5**.

### Kickoff prompt (per session, for a fresh cloud session)

> Read `dev/v040_frontend_completeness_plan.md` in full, then the GitHub issues your
> session's packages close (if any — P5–P11 may carry register findings instead).
> Implement Session **X**'s packages in their listed order, exactly as scoped — one
> branch and one PR per package, stacked per the session model, the first branch cut
> from the latest `main`. Follow the campaign rules and the "Decisions already made"
> section — settled decisions are the spec, not a starting point. Your final message is
> the handover prompt for a local verification session (template in the plan), covering
> every package you shipped.

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
  both update the README (config table / full-view description) in the same PR. P5–P11
  likewise: grep `docs/frontend_architecture.md` and the README for statements a change
  falsifies (the ⋮-menu description, the dialog inventory, the detail-sheet ownership),
  and fix them in the same PR.
- **Out-of-scope findings** become issues only when they clear the real-world-impact bar
  in `CLAUDE.md`; below that bar, a sentence in the PR's "Follow-ups" note is the ceiling.
- Nothing inside `custom_components/haventory/` is deleted or renamed here, so no
  `RETIRED_PATHS` entry is needed anywhere.
- Issue wiring: P1's PR body carries `Closes #332`; P2's carries `Closes #328` and
  `Closes #242`; P3's carries `Closes #296`; P4's carries `Closes #241`. P5–P11 name
  their register IDs in the PR body ("Fixes F2, F19, F20 from the register in
  `dev/v040_frontend_completeness_plan.md`") and add `Closes` lines for any register
  finding the owner has filed as an issue by then.

## Sequencing

```
Session A: P1 → P2 → P3 → P4    then merge all four, in order
Session B: P5 → P6 → P7         then merge all three, in order
Session C: P8 → P9 → P10        then merge all three, in order
Session D: P11                  last on purpose: many small edits everywhere
Final gate: whole-campaign verification, local Docker HA, Fable 5
```

Files per package — the dependency map. Under the serial session model no cross-session
coordination is needed, and within a session the stack order resolves every overlap:

```
P1  — store/store.ts · hv-list.ts · hv-card-shell.ts
P2  — hv-full-view.ts · hv-data-table.ts · hv-column-picker.ts · store/columns.ts
      · new ui/editor-error.ts
P3  — hv-item-editor.ts
P4  — index.ts · hv-card-shell.ts · hv-full-view.ts · README
P5  — hv-card-shell.ts · host-surfaces.ts · hv-column-picker.ts · hv-import-sheet.ts
      · hv-diagnostics-panel.ts · hv-confirm.ts · hv-overflow-menu.ts · ui/responsive.ts
P6  — hv-organize-dialog.ts · hv-location-tree.ts (organize density only)
      · hv-full-view.ts (app bar + statuses section)
P7  — hv-item-editor.ts · ui/tokens.ts · hv-chip-input.ts
P8  — hv-item-editor.ts · hv-detail-sheet.ts · hv-card-shell.ts · hv-full-view.ts
P9  — hv-full-view.ts · hv-data-table.ts · hv-card-shell.ts · new shared banner piece
P10 — hv-detail-sheet.ts · hv-item-editor.ts · hv-full-view.ts · new shared lightbox
P11 — many files, each edit small
```

(each package also owns its tests)

If the owner ever re-parallelizes into per-package sessions, the grouping that keeps
files disjoint is {P1, P2, P3} · {P4} · {P5, P6, P7} · {P8, P9} · {P10} · {P11}, with
three declared seams: P2 moves `editorErrorText` (`hv-card-shell.ts:1316`) into
`ui/editor-error.ts` inside a P1 file; P5 moves `NARROW_QUERY` (`hv-full-view.ts:55`)
into `ui/responsive.ts` inside a P6 file; P8/P9 split `hv-full-view.ts` and
`hv-card-shell.ts` between editor-close handlers (P8) and the render/banner regions
(P9). Under the serial model these need no coordination.

One rule holds regardless of packing: P1's fix keeps the editor *element* alive from
the outside; it must not edit the editor itself — `hv-item-editor.ts` first changes in
P3.

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
   edit (see §Sequencing, the P2 seam).
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
(short smoke)**.

## P5 — F2/F19/F20: host dialogs follow the viewport; phone sheets for the small four  `size M`

### Objective

On a desktop viewport, Organize (and every other host dialog) is a centered popup no
matter how narrow the card is. On a phone viewport, every host dialog rises as a bottom
sheet, like the filter panel, the detail sheet and the ⋮ menu already do.

### Scope

1. **One viewport predicate (F2, F20).** `hv-card-shell.ts:375` feeds `HostSurfaces`
   `isMobile: () => this.mobile` — the card-element measurement
   (`ui/responsive.ts:7`, 600px against the element's own width). A card in a dashboard
   column is 300–500px wide, so the organize dialog takes its full-bleed branch
   (`hv-organize-dialog.ts:124-131`) on a desktop monitor; opening the expanded view
   changes nothing because the measured element is still the card underneath. The panel
   already does it right: a viewport query (`haventory-panel.ts:65-69`, `NARROW_QUERY`
   `'(max-width: 700px)'` from `hv-full-view.ts:55`). Move that query into
   `ui/responsive.ts` (seam A), let `HostSurfaces` own the `matchMedia` subscription,
   and have both hosts use it — the panel drops its private copy
   (`haventory-panel.ts:100-111`). The card's own list/steppers/sheets keep the
   element-based signal; the distinction (element width for in-card layout, viewport for
   overlays) gets one comment where the predicate lives. `hv-full-view.ts:41-54` already
   explains why the element flag must not drive viewport-filling surfaces — this package
   applies the same reasoning to the dialogs. No change to `hv-organize-dialog.ts`
   itself: only the input changes, and true phone viewports keep full-bleed.
2. **Phone sheets for the small four (F19).** `host-surfaces.ts:228-315` passes
   `?mobile` to the organize dialog only. Pass it to all five, and give
   `hv-column-picker.ts:38-55`, `hv-import-sheet.ts:59-79`,
   `hv-diagnostics-panel.ts:49-71` and `hv-confirm.ts:32-49` a bottom-sheet
   presentation under the flag — `hv-overflow-menu.ts:147-191` already converts itself
   and is the visual reference. Whether to wrap `hv-bottom-sheet` or mirror the menu's
   lighter conversion is the session's call; the four must end up alike, and the confirm
   keeps working when stacked over another sheet (z-order via `nextZBase()` as today).
3. **Breakpoint alignment (F20).** `hv-overflow-menu`'s own `@media (max-width: 600px)`
   moves to the shared 700px query so one viewport width flips everything hosted. The
   card-element breakpoint in `ui/responsive.ts` is out of scope — it governs in-card
   layout and stays.

### Tests

- The regression this package exists for: narrow card + wide viewport (jsdom
  `matchMedia` stub) → organize dialog rendered **without** `mobile`; narrow viewport →
  with it. Note `hv-card-shell.test.ts` mounts with `forceMobile`, which pins the
  element-based controller — dialog assertions need the `matchMedia` stub as a second
  lever, not `forceMobile`.
- Each of the four dialogs: `mobile` attribute renders the sheet presentation; without
  it, the centered panel (pin the discriminating CSS the way
  `hv-organize-dialog.test.ts:127-131` does).
- `host-surfaces` passes `mobile` to all five dialogs; panel behavior unchanged.

### Verification & closing

Both gates. PR (suggested `fix(card): host dialogs switch on the viewport, not the card
width; phone-sheet parity for the small dialogs`). **Handover required** — checklist in
§Verification: P5.

## P6 — F1/F3/F18: Organize — one click away, dense statuses, one delete idiom  `size M`

### Objective

Organize opens from a visible app-bar button on the big surfaces. The Statuses tab's
rows are as tight as the other tabs', with reorder buttons a pointer can hit without
aiming. Deleting a status asks the same way whether or not items carry it. The surface
has one name.

### Scope

1. **App-bar button (F1, decision 7).** Copy the columns-button pattern
   (`hv-full-view.ts:1502-1513` — an icon button dispatching the same `menu-action`
   event the ⋮ uses) into `_renderAppBar` immediately before the `hv-overflow-menu`
   (`hv-full-view.ts:1700`), with `{ id: 'organize' }`, `aria-label`/`title`
   "Organize". One edit covers the expanded view and the panel. The ⋮ entry stays
   (`host-surfaces.ts:181`), so the menu-order pins in `hv-card-shell.test.ts:151-158`
   and `haventory-panel.test.ts:362-368` stay green.
2. **Statuses head action (F1).** The Statuses sidebar section is the one facet section
   without a head action (`hv-full-view.ts:1164-1174`). Give it the one the other three
   have, dispatching organize at the `statuses` tab — `hv-full-view.ts:1226-1241` shows
   the tab-parameterised dispatch.
3. **Dense reorder controls (F3, decision 9).** `.move` (`hv-organize-dialog.ts:242-247`)
   flips to `flex-direction: row` with a 2–4px gap; the buttons (`:252-263`) grow
   24 → 28–32px and the chevron glyph 15 → 18 (`:1777`, `:1786`); `.value-row` padding
   (`:229-235`) drops so the status row lands at the sibling tabs' ~48px. The
   `:host([mobile])` stack stays vertical at 44px (`:264-267`) — a horizontal 88px pair
   does not fit a phone row beside chip, slug, count and two 44px actions.
   `hv-organize-dialog.test.ts:1373-1395` pins the exact geometry **and** the rule that
   sizing is not `.status-row`-scoped ("one dialog cannot offer two target sizes for one
   control") — rewrite those pins deliberately, keeping the principle: the new sizes
   apply to every tab's row controls alike. Per decision 9 the density pass covers
   **all four tabs**: the `.value-row` padding cut lands unscoped, so Categories and
   Tags rows come down with Statuses, and the Locations tab hands the same vertical
   rhythm to its `hv-location-tree` rows — scoped to the organize dialog's hosting (a
   host attribute or CSS custom property on the tree), so the full-view sidebar tree
   keeps its current spacing.
4. **One delete idiom (F18, decision 10).** The zero-count branch
   (`hv-organize-dialog.ts:1815-1817`) moves off `hv-confirm` (`:2200-2215`) into the
   inline disclosure the in-use branch uses (`:1730-1735`), minus the reassign select.
   Both branches ask; the disclosure scrolls into view (shipped in #329), which is what
   made the modal unnecessary for reach.
5. **One name (F24, organize half).** Menu entry "Organize…" (menu convention keeps the
   ellipsis); the dialog titles itself "Organize" at every width — today it is
   "Organize inventory" on desktop and "Organize" on mobile (`hv-organize-dialog.ts:2163`).

### Tests

- App bar renders the organize button on modal and embedded variants; clicking it opens
  the dialog on the Locations tab; the statuses head action opens the Statuses tab.
- Geometry pins rewritten per scope 3 (desktop row/button/glyph sizes, mobile stack),
  plus a parity pin: one row rhythm across all four tabs.
- Tree density is scoped: the organize hosting carries the tighter rhythm, the
  full-view sidebar tree's spacing is untouched (pin the discriminating selector).
- Delete: zero-count status opens the disclosure (not `hv-confirm`); confirm deletes;
  in-use path unchanged apart from sharing the markup.
- Title pin updated to "Organize" at both widths.

### Verification & closing

Both gates. PR (suggested `feat(card): organize is one click away; dense status rows;
one delete confirmation`). **Handover (short smoke)** — checklist in §Verification: P6.

## P7 — F5–F9: item editor — geometry, typography, honest copy  `size M`

### Objective

The editor's Save/Delete/Cancel bar is always visible. Field widths match their
content. Labels share one type recipe, the two state boxes read as siblings, and the
custom-fields tally states a fact instead of implying a quota.

### Scope

1. **Sticky footer everywhere (F5, decision 11).** Drop the `:host([mobile])` gate on
   the sticky rule (`hv-item-editor.ts:643-650`) — the sticky mechanics already work on
   any host: the cell's containing block is the tall form grid, the nearest scrollport
   is the host's box (`hv-full-view.ts:672-697` caps it at 70dvh; `hv-list.ts:38-46` at
   `min(80dvh, 760px)`). Fix the gutter the comment at `:636-642` never had to face on
   phones: `.grid`'s 18px side padding leaves the bar's opaque background short of the
   edges — bleed the bar full-width (negative side margins + matching padding).
   `hv-item-editor.test.ts:826-845` asserts the rule *is* mobile-scoped — rewrite it to
   assert the opposite.
2. **Numeric tracks (F6).** `.grid`'s `2fr 1fr 1fr` (`hv-item-editor.ts:163-168`) was
   authored for a 600–900px card, where `1fr` ≈ 180px; in the expanded view it hands a
   two-digit number ~400px. Change row 1 to `minmax(0, 1fr)` for Name plus fixed
   ~140px/160px tracks for Quantity and Low-stock. The `:host([mobile])` override
   (`:169-173`) already collapses to one column and is untouched. Nothing currently
   pins the tracks — add the pin.
3. **Stop the stretch cascade (F7).** `.cell` (`:184-188`) gains
   `align-content: start`, so a cell's label/control pair stops absorbing the row
   surplus the Description textarea creates — today the status select lands at exactly
   the midpoint of an input and the textarea because the surplus is split across the
   cell's two auto rows. The same hazard was already guarded one level down
   (`.state { align-items: start }`, `:192-197`); this closes it at the top. Check
   `.checkout-body`'s `align-items: end` (`:228-231`), which leans on the current
   stretch and changes in scope 5 anyway.
4. **One label recipe (F8, typography).** `.group-caption` (`:209-218`) differs from the
   shared `.hv-label` (`tokens.ts:277-283`) only in weight (600 vs 500) — fold it into
   `.hv-label` and delete it. Small print consolidates on two sizes, stated where they
   live: 11px for labels, one note size (~12px) for everything else — today the band
   spans 11/11.5/12/12.5px (`.photos .picker` `:793`, `.doc-size` `:829`,
   `.upload-list` `:867`, `.key-hints` `:583`, `.attach-hint` `:951`, `.doc-picker`
   `:858`). `hv-chip-input`'s input font rises 12.5 → 13.5px to match `.hv-input`
   (`tokens.ts:294`). The Tags suffix loses the file's only inline `style=` (`:2400`)
   for a class. The redundant `margin-top`s on `.photos` (`:701`) and `.documents`
   (`:807`) go, so every section's label-to-content gap is the `.cell` gap.
   `hv-item-editor.test.ts:2214-2230` constrains where hoisted `.hv-tally` styling may
   live — respect it when moving rules into `tokens.ts`.
5. **Sibling state boxes (F8, whitespace).** The Checkout box drops
   `align-items: end` — no more dead air above a label-less button bottom-aligned
   against a labelled date field. Rebalance `.state`'s `2fr 1fr` (`:192-197`) so the
   Next-inspection offset chips (`:255-268`) stop wrapping to three rows; the session
   picks the exact split, the requirement is: neither box carries dead air above its
   first control, and the chips wrap at most once at the card's default width. The
   checked-in hint (`:1599-1601`) either gets a mirrored inspection hint or moves so
   both boxes have the same row structure.
6. **Honest tally (F9).** `hv-item-editor.ts:1739-1741` becomes
   `${counted(used, 'field')} set` — the denominator (inventory-wide distinct keys) and
   the self-referential `|| used` fallback both go. The inventory-wide keys already
   appear correctly framed as "Key suggestions" (`:1803-1817`). No test pins the old
   string; add one for the new.
7. **One verb (F24, editor half).** The section heading "Checkout" (`:1571`) becomes
   "Check out", matching its own button (`:1582`) and the rest of the card.

### Tests

- Sticky pin rewritten (rule applies unscoped; bar full-bleed).
- Track pin (fixed numeric columns; mobile collapse untouched).
- `align-content: start` pin on `.cell`.
- Label sweep: no `.group-caption` rule remains; one note size; no inline `style=` in
  the template; chip-input font matches `.hv-input`.
- Tally copy pin ("2 fields set" for a two-field model; "0 fields set" empty).

### Verification & closing

Both gates. PR (suggested `fix(card): editor geometry and type reconciliation;
always-visible actions; honest custom-fields tally`). **Handover required** — checklist
in §Verification: P7.

## P8 — F10/F11/F12: typed edits are never discarded without asking  `size M`

### Objective

Every path that would throw away a dirty form asks first — the same question, the same
wording, everywhere (decision 12).

### Scope

1. **Inside the editor (F10).** Escape already routes through the dirty check
   (`hv-item-editor.ts:1152-1166`); the Cancel button (`:2437`) and the ✕ (`:2371`)
   bind `this._cancel` directly and discard instantly. Route all three through the same
   guard. The footer hint (`:2435`, "Esc discards") updates to match the new truth.
2. **The phone sheets (F11).** The detail/add sheets expose `dirty`
   (`hv-detail-sheet.ts:506-509`) and nothing reads it: scrim tap and swipe-down close
   unconditionally, and the shell's `@cancel` handlers (`hv-card-shell.ts:1211-1214`,
   `:1252-1255`) just null the state. The sheet answers for its own editor (the shell's
   `_editor` getter, `:551-562`, cannot see into it — do not extend its reach): before
   closing on scrim/swipe/cancel, a dirty sheet asks via the same confirm the shell's
   inline path already uses (`hv-card-shell.ts:569-586` is the wording reference).
3. **The full view and panel (F12).** Row switch (`hv-full-view.ts:938-942`), backdrop
   (`:1525`), Escape (`:1534`) and the app-bar close all consult the open editor's
   `dirty` before tearing it down, reusing the editor's own discard confirm so the
   question reads identically. P1's pinned-row behavior (scope 3 there) is the data
   side of the same rule and must still hold — do not regress it.

### Tests

One case per path — editor Cancel, editor ✕, Escape, sheet scrim, sheet swipe, full-view
row switch, full-view backdrop, full-view Escape: dirty asks (confirm-discard proceeds,
confirm-keep retains the typed text), clean closes silently. `hv-bottom-sheet`'s tests
already simulate the swipe gesture — reuse that harness.

Out of scope: draft autosave
([#334](https://github.com/chrreiter/HAventory/issues/334)) — the follow-on that makes
most of these questions unnecessary. The guards land first; do not start it here.

### Verification & closing

Both gates. PR (suggested `fix(card): a dirty editor always asks before discarding, on
every close path`). **Handover required** — checklist in §Verification: P8.

## P9 — F13/F16: failures and row actions reach the full view and panel  `size M`

### Objective

Connection loss, paused live updates and failed operations are visible on every surface,
not only the card. A table row offers the same actions a card row does.

### Scope

1. **Banners everywhere (F13, decision 13).** The shell's degraded/error banner
   rendering (`hv-card-shell.ts:812-955`, `_renderDegradedBanners` + `_renderBanners`
   over `state.errorQueue`) becomes a shared piece — component or render helper, the
   session's call — rendered by `hv-full-view` in both its modal and embedded variants.
   The panel gets it for free (`haventory-panel.ts:131-147` renders only
   `<hv-full-view embedded>`). Banner actions ("View latest" / "Re-apply my change")
   come along. P2's `.errorMessage` binding stays: the inline sentence is the
   save-failure surface, the banner queue carries everything else — state that split in
   one comment where the two meet.
2. **Table row menu (F16).** The table's actions cell (`hv-data-table.ts:585-618`,
   today decrement/increment/edit) gains the row overflow menu the card row has
   (`hv-list-row.ts:344-364`: Check out / Check in / Set due date… / Delete item) —
   same `hv-overflow-menu` component, same item ids, same events, so the full view's
   existing handlers pick them up. The Delete-key shortcut (`:426-429`) stays and now
   has a visible equivalent. While in the file, the Edit affordance stops differing
   between the two surfaces (26px outlined circle, `hv-data-table.ts:273-283`, vs 30px
   borderless, `hv-list-row.ts:201-215`) — pick one and use it in both.

### Tests

- Full view: an `errorQueue` entry renders a banner; a degraded/paused state renders its
  banner; actions dispatch. Panel smoke through the embedded variant.
- Table: the row menu renders the four items and each emits its event; Delete key still
  works; hover/focus reveal behavior matches the existing actions cell.

### Verification & closing

Both gates. PR (suggested `feat(card): banners and row actions reach the full view and
panel`). **Handover (short smoke)** — checklist in §Verification: P9.

## P10 — F14/F15: the detail sheet becomes every surface's read view  `size L`

### Objective

Tapping a row on a narrow panel shows the item — photos, documents, facts, check-out —
not a form. Photos open full-size from every surface that shows them.

### Scope

1. **Extract the lightbox.** It lives inside `hv-detail-sheet` (`hv-detail-sheet.ts:647-718`)
   and nothing else can use it. Extract it into a shared component; the sheet consumes
   it unchanged (its navigation, counter and Escape handling move with it).
2. **Editor thumbnails open it (F15).** The editor's photo strip renders bare `<img>`s
   (`hv-item-editor.ts:2065-2077`); they become buttons opening the shared lightbox.
   Documents already open (`:2202-2211`) — photos reach parity, on every editor host at
   once.
3. **The narrow full view hosts the sheet (F14, decision 16).** At the narrow
   breakpoint, `open-item` (`hv-full-view.ts:928-942`) opens `hv-detail-sheet` instead
   of setting `_editing`; Edit inside the sheet routes to the editor the way the card
   wires it (`hv-card-shell.ts:1252-1255` region is the reference). The desktop full
   view keeps the inline editor — the table is its own read surface. The sheet stops
   being shell-only: its host contract (events emitted, store slices read) gets stated
   in its component JSDoc so both hosts can hold it.

### Tests

- Narrow full view: `open-item` renders the sheet; Edit inside it opens the editor;
  save returns to fresh data; wide renders the inline editor as today.
- Lightbox: opens from an editor thumbnail; arrows navigate; Escape closes and returns
  focus to the thumbnail. Existing detail-sheet tests keep passing across the
  extraction.

### Verification & closing

Both gates. PR (suggested `feat(card): shared read view and lightbox on every
surface`). **Handover required** — checklist in §Verification: P10.

## P11 — consistency sweep: cursors, buttons, copy, bulk check-out  `size M`

Runs **last** — it makes small edits across files every earlier package owns, so running
it last keeps every earlier rebase trivial.

### Objective

The remaining register items — each small, none needing design work beyond the decisions
above.

### Scope

1. **F4 — rows get the hand.** `cursor: pointer` on the row in `hv-list-row.ts` and
   `hv-data-table.ts` — the rows are `<div role="row">`, and the shared
   `button { cursor: pointer }` (`tokens.ts:191-193`) cannot reach them. Sweep for any
   other clickable non-button while there.
2. **F26 — tree rows become full-row targets.** The location tree row highlights
   full-width but only the inner `button.name` (`hv-location-tree.ts:511-524`) is
   clickable; the count span is inert. Make the row a full-width button like the facet
   rows (`hv-full-view.ts:496-514`) and the tree's own All-items/No-location rows
   (`:789`, `:813`); the expander stays its own control.
3. **F17 — bulk check-out asks (decision 14).** `check-out` loses `immediate`
   (`hv-bulk-bar.ts:50`); the hosts open `hv-checkout-popover` once and apply the
   picked date — or the explicit no-date choice — to every selected item
   (`hv-bulk-bar.ts:447-452`, `hv-full-view.ts:1022-1028` are the run paths). Bulk
   check-in stays immediate.
4. **F21 — one primary recipe (decision 17).** The local variants —
   `hv-confirm.ts:72-79`, `hv-import-sheet.ts:281-288`,
   `hv-diagnostics-panel.ts:200-207` (a verbatim duplicate),
   `hv-detail-sheet.ts:234-245`, `hv-card-shell.ts:304-312`,
   `hv-location-tree.ts:272-282` — become `.hv-pill` (plus a size modifier where touch
   sizing demands one), and the dead rules are deleted.
5. **F22 — one "Clear all".** `hv-filter-chips.ts:165-174`,
   `hv-filter-panel.ts:311-317`, `hv-card-shell.ts:325-334` and
   `hv-full-view.ts:1407-1409` converge on `.hv-text-button`.
6. **F23 — close verbs (decision 15).** Diagnostics' Close (`hv-diagnostics-panel.ts:397`)
   stops being the filled primary; the bulk result's "Dismiss" (`hv-bulk-bar.ts:408-414`)
   becomes "Close"; the column picker's "Done" stays (its changes apply live).
7. **F25 — the label the user picked.** The import preview renders the policy's title
   from `POLICIES` (`hv-import-sheet.ts:19-35`), not the enum value (`:546`).
8. **F27 — the bulk bar joins the theme.** The progress row's Cancel gets a class and a
   style (`hv-bulk-bar.ts:361-367`); the bar's hardcoded `#263238`/`#ef9a9a`
   (`:110-144`) move to the token palette so the one surface that ignores the HA theme
   stops ignoring it.
9. **F28 — one footer sentence.** `hv-card-shell.ts:1119-1138` and
   `hv-full-view.ts:1851-1855` converge on one `counted()`-based sentence (same words,
   same noun; the full view may append its scroll affordance).

### Tests

Each scope lands at least one assertion: cursor pins, the tree row as a button, the bulk
check-out popover flow (date applied to all, explicit no-date honoured), the retired
button rules absent, copy pins for 6/7/9.

### Verification & closing

Both gates. PR (suggested `fix(card): consistency sweep — cursors, buttons, copy, bulk
check-out date`). **Handover (short smoke)** — checklist in §Verification: P11.

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
| P5 | **Required** | Desktop browser, dashboard with the card in a normal (narrow) column: open Organize from the card ⋮ — centered popup, not a full-bleed page; expand the card, open Organize — still a popup; same from the panel. 390px emulation: Organize full-bleed with the back arrow; Columns, Import, Diagnostics and a delete confirm each rise as bottom sheets; the ⋮ menu still does; a confirm stacked over a sheet stays on top and works. |
| P6 | Short smoke | Expanded view and panel: the app bar shows the Organize button; it opens on Locations; the Statuses section's head action opens on Statuses. All four tabs sit at the same tightened row rhythm — status rows match category rows, and the Locations tab is visibly denser while the full-view sidebar tree is unchanged. The reorder pair is side-by-side and comfortably clickable; a reorder persists across a reload. Deleting an unused status asks inline; deleting an in-use status asks inline with the reassign select. 390px: arrows stacked at 44px. |
| P7 | **Required** | Expanded view at 1080p, an item with photos, documents and custom fields: Save/Delete/Cancel visible without scrolling; scroll the form — the bar stays pinned, opaque edge to edge. Quantity/Low-stock at fixed width; the status select is input-height beside the taller Description. One label size across TAGS/PHOTOS/DOCUMENTS/CHECK OUT/NEXT INSPECTION, one note size below them; the tag input's text matches the other fields. The two state boxes: no dead air above the first control, offset chips wrap at most once at card width. Tally reads "N fields set". Screenshots light + dark, desktop + 390px. |
| P8 | **Required** | The eight-path matrix with a dirty form — editor Cancel, editor ✕, Escape, sheet scrim tap, sheet swipe-down (390px), full-view row switch, full-view backdrop, full-view Escape: every path asks; "Discard" proceeds, keeping asks nothing twice; the same paths with a clean form close silently. Wording identical everywhere. |
| P9 | Short smoke | Full view open, stop the HA container: banner appears; restart: it clears and data recovers. Reject a save (bump the version from a second tab): inline sentence in the form **and** the queue banner behave per the stated split. Table rows: ⋮ offers Check out / Check in / Set due date / Delete and each works; the Delete key still deletes with its confirm. Panel shows the same banners. |
| P10 | **Required** | Panel at 390px: tap a row — detail sheet with photos, documents, facts, check-out; Edit opens the editor; save lands back on fresh data. Desktop full view: row click opens the inline editor as before. Lightbox: open a photo from the editor on the card, the expanded view and the panel — arrows navigate, counter counts, Escape returns focus. Card behavior byte-identical to before. |
| P11 | Short smoke | Hover an item row: hand cursor, both views. Location tree rows respond across their full width. Select 3 items, bulk Check out: the popover asks once; all 3 carry the chosen date; the explicit no-date path also works. Import preview says "Merge", not "merge". Bulk-run Cancel looks like a button; the bar follows the theme in light and dark. Both footers read the same sentence. Primary buttons look alike in confirm, import, diagnostics, detail sheet, tree. |

## Final gate — whole-campaign verification in real HA  `Fable 5, mandatory`

Runs once, **after all eleven packages have merged**, before the v0.4.0 release is cut.
Per-package handovers verify packages in isolation; this gate exists to catch what they
cannot — interactions *between* packages (the sticky footer inside the new dirty-guard
flows; the viewport predicate under the new sheet presentations; banners over an open
editor), and drift between what this plan promised and what `main` actually does.

**This session MUST run on Fable 5.** Not Opus, not Sonnet — no exceptions, including
retries. The gate spans every package, exercises three surfaces at two widths in two
themes, and its verdict is what the release decision rests on; it gets the strongest
model available. A session that cannot run Fable 5 does not run the gate.

It is a **local** session: Docker dev HA, the `run-haventory` and `test-haventory`
skills, a real browser. On all-green, this session's wrap-up PR deletes this plan file
(the `dev/` lifecycle rule).

### Kickoff prompt (verbatim, for the final-gate session)

> You are the final verification gate for the v0.4.0 frontend campaign of
> chrreiter/HAventory. You are running on Fable 5; if you are not, stop and say so —
> the gate may not run on another model.
>
> Setup: check out the latest `main`. Read `dev/v040_frontend_completeness_plan.md` in
> full — its findings register (F1–F28) and decisions section are the spec you are
> verifying against. Run the full offline gates first (backend:
> `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`, `uv run ruff check .`,
> `uv run ruff format --check .`, `uv run mypy`; frontend, in `cards/haventory-card`:
> `npx eslint .`, `npm run typecheck`, `npx vitest run`, `npm run build`); a red gate on
> `main` stops everything — report it and go no further. Then use the `run-haventory`
> skill to deploy the integration and card to the dev HA container, and seed a
> realistic inventory (`uv run python scripts/create_test_items.py`; ~1000 items,
> nested locations, statuses beyond the defaults, tags, custom fields, some items
> checked out with and without due dates, some with photos and documents).
>
> Then execute, in order, in a real browser:
>
> 1. **The original complaints, re-verified as a user.** Walk each of the five reported
>    symptoms and confirm the fix reads as fixed, not merely implemented: (a) Organize
>    reachable in one click from the expanded view and panel; (b) Organize is a centered
>    popup on a desktop viewport from every surface, full-bleed only on a phone;
>    (c) status rows tight, reorder buttons comfortably clickable; (d) the hand cursor
>    on every item row; (e) the editor: action bar visible without scrolling, sane
>    field widths, status select at input height, one label system, "N fields set".
> 2. **Every package's checklist** from §Verification (P1–P11), executed in full — the
>    Required ones and the short smokes alike. Where a checklist names widths, use
>    desktop (~1920px) and 390px emulation; where it names themes, run light and dark.
> 3. **Cross-package interactions**, at minimum: a dirty editor + every close path on
>    every surface (P7's sticky bar must not cover the discard confirm; P8's guards must
>    fire inside P10's sheet on the panel); Organize opened from the new app-bar button
>    on a narrow-card dashboard (P5's predicate with P6's button); a banner arriving
>    while an editor is open in the full view (P9 over P2); bulk check-out from the
>    table with rows selected via the new row menu (P11 with P9); a column reorder
>    followed by a sort on the reordered table (P2 under P9's row menu).
> 4. **A regression sample of the core flows** untouched by the campaign: create an
>    item, edit it, delete it with confirm; search, filter by every facet type, clear
>    all; import preview and a merge import; export; check out with a due date and
>    check back in; a location move rebuilding paths. Nothing may have gotten worse.
> 5. **The browser smoke and online WS smokes** via the `test-haventory` skill, against
>    the running container.
>
> Rules: fix forward — a defect found here is fixed on a branch from `main`, gated
> offline, pushed, and opened as a PR (one PR per defect cluster, `Closes`/register
> references included); then re-run the checklist items the fix touches. Never merge
> anything; never cut the release; the owner does both. If a defect is outside the
> campaign's scope, file it per `CLAUDE.md`'s real-world-impact bar instead of fixing
> it here.
>
> Report: one table per program section — item, PASS/FAIL, evidence (screenshot paths
> for every visual claim, light + dark where themes matter) — plus a plain-words
> verdict: releasable or not, and what stands in the way if not. On all-green, open the
> wrap-up PR deleting `dev/v040_frontend_completeness_plan.md`, and note in its body
> that the gate passed.

## Traceability

| Issue / finding | Substance | Package |
|---|---|---|
| #332 | filter/search/sort changes discard an open editor's edits | P1 |
| #328 | full view says nothing when a save is rejected | P2 |
| #242 | column order fixed to canonical; picker can't reorder | P2 |
| #296 | desktop file-drop attach | P3 |
| #241 | quick-filter pills not configurable | P4 |
| #205 | duplicate area controls — design question | closed by owner, no code |
| F2, F19, F20 | dialogs follow the card width; phone-sheet gaps; three breakpoints | P5 |
| F1, F3, F18, F24 | organize reachability, status density, delete idiom, naming | P6 |
| F5–F9, F24 | editor fold, widths, stretch, typography, tally, heading | P7 |
| F10–F12 | dirty edits discarded without asking | P8 |
| F13, F16 | invisible failures; missing table row actions | P9 |
| F14, F15 | no read view on the narrow panel; single-surface lightbox | P10 |
| F4, F17, F21–F23, F25–F28 | cursors, bulk check-out date, buttons, copy | P11 |

## Annex — candidates the owner may re-file into v0.4.x

Out of scope for the packages above; listed so a re-filing decision can slot them as
follow-on packages (each would be its own brief) without reopening this plan:

- **#222** — card picker statics, visual config editor, `getGridOptions` (currently
  V0.5.0; it is card work, on #236's mandatory list, and its config editor would cover
  #241's new key).
- **#314** — table name cell: inline chips take the name's width (currently V0.5.0).
- **#326** — detail sheet document rows clipped at phone width (currently V0.5.0).
- **#203** — area marker on phone rows; "No area" band label (currently V0.7.0).
- **#297** — pointer drag as the one reordering idiom (P2 and P6 add button-reorder
  sites; drag replaces none of them until #297 decides once, for all ordered lists).

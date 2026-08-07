# v0.4.0 UI-audit remediation plan

The execution plan for every finding in `dev/ui_audit_v040.md` (3 blockers, 17 should-fix,
7 polish) plus the three open v0.4.0-milestone issues
[#300](https://github.com/chrreiter/HAventory/issues/300),
[#301](https://github.com/chrreiter/HAventory/issues/301) and
[#303](https://github.com/chrreiter/HAventory/issues/303). Thirty items, eight work
packages, three waves. Each package is one PR, implemented by a fresh **Opus 5 (xhigh)
session**; the package sections below are written to be that session's working brief.

All `file:line` anchors are taken at `main` @ `1798946` — the commit the audit ran
against and the base of wave 1. **Anchors drift as waves land: locate by symbol/testid
first, treat the line number as a hint, and re-read every touched region before editing.**

Per the `dev/` lifecycle rule in `CLAUDE.md`, the PR that lands the **last** package
deletes this file *and* `dev/ui_audit_v040.md`.

## How to launch a package session

Kickoff prompt for a fresh remote session:

> Read `dev/ui_audit_v040_fix_plan.md` in full, then `dev/ui_audit_v040.md` for the
> findings your package cites. Implement work package **Pn** exactly as scoped, on a new
> branch from the latest `main`. Follow the campaign rules and the closing protocol at the
> top of the plan.

Check the package's wave preconditions first (§Sequencing): a wave-3 session must confirm
its prerequisite PRs are merged (`git log origin/main`) before starting.

## Session model

Implementation sessions run **remotely** — no Docker dev HA, no screenshot tooling. A
remote session must not attempt live verification itself. The flow per package:

1. **Remote session**: implement → run both offline gates → commit → push → **open the PR**.
2. If the package's row in §Verification lists a handover checklist, the remote session's
   final message is a **handover prompt** for a local session (see template below), and the
   PR body states plainly which checks are delegated to that local pass.
3. **Local session** (has the Docker dev container + the `run-haventory` skill): executes
   the checklist, and on any defect fixes it, re-runs the gates, and pushes to the same PR
   branch.
4. The **user** merges. Nobody else merges; auto-merge is never enabled.

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
  `npm run build`. Both must be green even when the package touches only one side.
- **TDD**: every fix ships with tests — happy path plus at least one edge/error case.
  Where a package deliberately breaks an existing pin, rewrite the pin to assert the new
  behavior; never delete an assertion without a replacement.
- **Conventional Commits**; the PR title is the squash commit and is lint-enforced.
  release-please owns all six version files (`manifest.json`, `package.json`,
  `package-lock.json` ×2, `const.py`, `uv.lock`) — never hand-edit a version number.
- **Comments explain constraints, not history.** No references to what code "used to" do,
  no audit-finding numbers in code comments, no `TODO`/`FIXME`. When a package invalidates
  an existing comment (several below do), rewrite it to state the current constraint.
- **Docs sync**: anything visible in the WS contract updates
  `docs/backend_api_contract.md` and `docs/data_shapes.md` in the same PR.
- **Out-of-scope findings** go to GitHub issues (🔧 Task template), not into the diff.
- No file inside `custom_components/haventory/` is deleted or renamed in this campaign,
  so no `RETIRED_PATHS` entry is needed anywhere.
- Issue wiring: P8's PR body carries `Closes #300` and `Closes #303`; P5's carries
  `Closes #301` (P3 lands the contrast half first; P5 completes the issue).

## Sequencing

```
Wave 1 (parallel, disjoint files):   P1  P2
Wave 2 (parallel, independent):      P3  P7  P8
Wave 3:                              P4 (requires P1 merged; prefer after P3)
                                     P5 (requires P2 merged; prefer after P3)
                                     P6 (requires P2 merged)
```

Hard edges: P1→P4 (both rewrite the organize dialog's Statuses tab — sequential or they
merge-conflict a blocker), P2→P5 and P2→P6 (both build on the settled `willUpdate`
semantics in the same two files). Soft edges: P3 before P4/P5 only so screenshots show
final colors and #301's closure lands in order — not blocking.

## Traceability

| Item | Finding (audit rank) | Package |
|---|---|---|
| A1 | 1 — upload discards unsaved edits / mobile sheet closes | P2 |
| A2 | 2 — reassign-delete crashes items-event handler | P1 |
| A3 | 3 — sidebar facet claims 998 for every custom status | P1 |
| B4 | 4 — refused file's error vanishes on sibling success | P2 |
| B5 | 5 — delete guard doesn't stack on mobile | P4 |
| B6 | 6 — status count link doesn't apply the filter | P1 |
| B7 | 7 — one-tap permanent attachment delete | P5 |
| B8 | 8 — Escape with open dropdown discards the form | P5 |
| B9 | 9 — location picker dead end on empty install | P5 |
| B10 | 10 — 15×15 reorder chevrons, under-size tab controls | P4 |
| B11 | 11 — colour swatches are bare tint circles | P4 |
| B12 | 12 — default status not editable from the UI | P4 |
| B13 | 13 — duplicate status labels accepted silently | P4 |
| B14 | 14 — upload progress is a bare word | P5 |
| B15 | 15 — lightbox cannot navigate | P6 |
| B16 | 16 — mobile table: name column scrolls away | P7 |
| B17 | 17 — name column collapses while tags keep width | P7 |
| B18 | 18 — filter status chips priced only for legacy two | P1 |
| B19 | 19 — app bar pins missing/needs-repair vocabulary | P3 |
| B20 | 20 — blue tone pixel-identical to "Checked out" chip | P3 |
| C21 | 21 — slug preview truncates | P4 |
| C22 | 22 — untitled documents render filename twice | P6 |
| C23 | 23 — photo-only indent; document marker floats | P7 |
| C24 | 24 — no hint that photos need a saved item | P5 |
| C25 | 25 — sort buried below the tag cloud | P1 |
| C26 | 26 — applied status chip renders chore amber | P3 |
| C27 | 27 — strong-blue chip identical to primary action | P3 |
| I300 | #300 — Content-Disposition on the media view | P8 |
| I301 | #301 — state-chip contrast + 24px targets | P3 + P5 |
| I303 | #303 — attachment probes as scripts/ helpers | P8 |

Decisions already made with the repository owner — do not relitigate in a session:
- B19: **drop** the two app-bar status pills (do not re-render them with live definitions).
- C23: **anchor the document marker to the name only**; the no-placeholder-thumbnail
  decision documented in `hv-list-row.ts` stands.
- B15: prev/next buttons + counter + arrow keys; **no swipe gestures**.
- A2: fixed **frontend-side**; the backend's payload-less broadcast is correct and stays.
- Attachment removal (B7) gets a **confirm dialog**, not an undo window.
- Pillow arrives as a **non-default uv dependency group**; `scripts/` stays out of mypy's
  `files` (new probes are checked manually).

---

## P1 — Status counts & event correctness  `wave 1 · size M/L`

**Items: A2 (blocker), A3 (blocker), B18, B6, C25.**

### Objective

After this PR, a status reassign-delete leaves no card stale and no console error; every
surface that prices a status (sidebar facet, filter chips, organize tab) reads the same
`status_counts` payload through one shared helper; the organize tab's count link actually
applies the filter; and the sort controls sit above the tag cloud.

### Scope

1. **A2 — `Store.onItemsEvent`** (`cards/haventory-card/src/store/store.ts:632-675`).
   An `items/updated` event without an `item` (the backend broadcasts `payload=None` after
   a bulk reassign, `custom_components/haventory/ws.py:2210`) currently hits
   `items.findIndex((x) => x.id === item.id)` and throws. Treat any items event without an
   `item` as a refetch signal, mirroring the `reloaded` branch three lines up (`:634-645`)
   including the `reloading` degraded flag — the semantics are identical: the dataset moved
   wholesale, merge is impossible. `ItemsEventPayload.item` is already optional
   (`store/types.ts:453-468`) — make the handler honor the type instead of casting past it.
   Optionally add `'statuses'` to `BaseEventPayload.topic` while in the file (`ws.subscribe`
   already accepts it).
2. **A3 + B18 — one `statusCount` helper.** Extract into `ui/status.ts`:
   `statusCount(counts: StatsCounts | null | undefined, slug: string): number | null` —
   `status_counts[slug]` when the map is present; on older backends without it, fall back
   to `missing_count` / `needs_repair_count` for exactly those two slugs and `null` for
   everything else; `null` renders no tally. Replace the three divergent implementations:
   `hv-full-view.ts:1168-1173` (`tallyFor` — the "everything else = items_total − missing −
   needs_repair" math behind the 998s), `hv-filter-panel.ts:724-725` (legacy-only, chips
   unpriced), `hv-organize-dialog.ts:1414-1417` (`_statusCount`, already correct — keep its
   `?? 0` behavior at that call site). Rewrite the stale comments that encode the
   three-status world: `hv-full-view.ts:1163-1165` and the HTML comment `:1177-1178`
   ("this one always holds three"), `hv-filter-panel.ts:713-720` and the `counts` property
   docstring `:347-356`.
3. **B6 — `_showStatus`** (`hv-organize-dialog.ts:1614-1619`). It dispatches `browse` with
   a detail nobody reads and never sets the filter or closes the dialog. Align it with its
   siblings `_showValue`/`_showLocation` (`:847-858`):
   `this.store?.setFilters({ status: slug }); this._browse();`. Leave
   `host-surfaces.ts:271` untouched.
4. **C25** — in `hv-filter-panel.ts` `render()` (`:867-869`), move `_renderSortGroup()`
   above `_renderTagGroup()`. Tag clouds grow with the household; sort does not.
5. **Docs + backend shape pins (no backend behavior change).**
   `docs/backend_api_contract.md:129-135` and `docs/data_shapes.md:355-363` claim `updated`
   always carries `{item}` and `reloaded` is the only payload-less items action — ws.py:2210
   contradicts them. Correct both: an items event **may omit `item`; absence is a refetch
   signal** (name `status/delete` with `reassign_to` as the case; extend `:302-305`
   accordingly). Pin the shape in tests so a future backend change fails loudly: extend
   `_record_broadcasts` (`tests/test_ws_statuses_offline.py:38-48`) to capture the payload
   and assert the reassign-delete broadcast carries none (`:214-231` is the test); in
   `tests/test_ws_subscriptions_offline.py`, assert a payload-less items event reaches
   subscriptions regardless of their location filter (`_collect_event_deliveries`,
   `ws.py:649-682`, skips filters when there is no item — correct for a refetch signal,
   and worth pinning as such).
6. **Consolidation** — introduce a shared `.hv-tally` rule for the count badges and adopt
   it at the sites this package touches (`hv-filter-panel.ts:114-116`, `:281-285`,
   `hv-full-view.ts:523-530`); today they disagree on size and dimming strategy.
   `hv-item-editor.ts:497` adopts it in P5, not here.
7. **File the follow-up issue** (🔧 Task) for the test-harness dedupe: `mount()`/`q`/`all`/
   cssText readers are re-implemented across ~18 component test files; consolidating is
   mechanical churn that belongs in its own chore PR, not in this campaign.

### Tests

- New: payload-less `items/updated` triggers refetch + flips `degraded.reloading` — model
  on `store.revamp.test.ts:1236-1252` (the `items/reloaded` test); the `hass.__emit`
  harness (`src/test.utils.ts:648`) delivers inner payloads exactly as HA does.
- New: `statusCount` unit tests in `ui/status.test.ts` — map present (incl. slug absent
  from map → 0 vs null: decide and document; the map includes every *defined* slug, so an
  absent slug means an undefined status → null is right), map absent w/ legacy fields,
  both absent.
- New: clicking `status-count` sets `filters.status`, dispatches `browse`, closes the
  dialog (no test covers the click today).
- Facet/filter-chip pricing assertions against a `status_counts` stub
  (`test.utils.ts:194`).
- Watch: filter-panel tests that assert section DOM order (staged mobile footer) will need
  the reorder reflected.

### Verification & closing

Both gates. PR (suggested title `fix(card): price statuses from status_counts and survive
payload-less item events`). **Handover required** — checklist in §Verification: P1.

---

## P2 — Editor/sheet state preservation  `wave 1 · size M`

**Items: A1 (blocker), B4.**

### Objective

An upload finishing — or any same-item broadcast — no longer destroys what the user is
doing: typed-but-unsaved edits survive in `hv-item-editor`, the mobile detail sheet stays
in edit mode, and a refused file's error row (with Retry) outlives its siblings' successes.

### Scope

1. **`hv-item-editor.willUpdate`** (`cards/haventory-card/src/components/hv-item-editor.ts:934-947`).
   The guard is `changed.has('item')` — object identity — and every host re-binds `.item`
   from a fresh `items.find(...)` on each store broadcast (`hv-full-view.ts:1791`,
   `hv-card-shell.ts:591`, `hv-detail-sheet.ts:789`), so any same-item update rebuilds
   `_model` and wipes `_uploads`/`_uploaded`. Re-key the reset on **item id change**
   (null↔id transitions included — create→saved must still reset, and that keeps the
   existing different-id test green). On a same-id change (version bump from an upload,
   retitle, external edit): keep `_model`, `_errors`, popover state and `_uploads`; the
   incoming item is the fresh attachment/version source. Do **not** touch the save path:
   `_current = _uploaded ?? item` (`:920-922`) supplying `expectedVersion` is the
   version-conflict mechanism, and preserving `_model` across an external same-id edit is
   exactly what routes that edit into the conflict path instead of a silent rebuild.
   Mind `_uploaded`: after this change decide explicitly what it means when the same-id
   `item` prop has caught up with it (it can be dropped once `item.version >=
   _uploaded.version`); leave a comment stating the invariant, not the history.
2. **`hv-detail-sheet.willUpdate`** (`hv-detail-sheet.ts:410-418`) forces `_mode = 'read'`
   and drops `_lightbox` on any `item` identity change — on a phone every attachment
   mutation closes the edit form. Same re-key: reset only on id change or on `open`
   flipping true; a same-id update while open leaves `_mode` and `_lightbox` alone.
3. **B4** — with the reset gone, error-state `UploadEntry`s survive sibling successes.
   Because `willUpdate` was the **only** place the queue was ever cleared (`:943`), an
   error row would now live forever: add a dismiss (×) control on error rows (it clears
   that entry only; Retry stays as-is, `:1663-1667`). This is a required part of the
   package, not polish.

### Tests

- Existing reset pins all swap **different** ids and stay green as written:
  `hv-item-editor.test.ts:963-970`, `hv-detail-sheet.test.ts:315-323`, `:433-446`.
- New (the actual regression): same-id refresh — type into `editor-description`, re-assign
  `.item` with a higher-version copy of the same item (fresh object), assert the typed text
  and `el.dirty` survive and the new attachment list is adopted. Sheet: enter edit mode,
  re-assign a same-id item, assert `_mode` stays `'edit'`; same for `_lightbox`.
- New: a batch where one entry errors and a later sibling succeeds (same-id item refresh
  mid-queue) keeps the error row + Retry; dismissing clears exactly that row.
- Closest existing same-id coverage for reference: `hv-full-view.test.ts:1020-1033`.

Keep this package minimal — it is the highest-semantic-risk change in the campaign; no
opportunistic refactors in these two files (P5/P6 return to them).

### Verification & closing

Both gates. PR (suggested `fix(card): keep unsaved edits and upload errors across
same-item refreshes`). **Handover required** — checklist in §Verification: P2.

---

## P3 — Chip vocabulary & tone tokens  `wave 2 · size M`

**Items: B19, B20, C26, C27, I301 (contrast half).**

### Objective

The chip colour system tells the truth again: `.hv-chip.state` text clears 4.5:1 AA (the
#301 measurement), the user-pickable blue tones are visibly distinct from the fixed
state-blue and from the primary action colour, the applied status-filter chip carries the
status's own tone instead of chore amber, the app bar stops speaking the status vocabulary
— and `tone-contrast.test.ts` guards all of it offline.

### Scope

1. **I301 contrast** — `.hv-chip.state` (`src/ui/chip.ts:84-88`) and `.hv-chip.toggle.on`
   (`:122-126`) paint `--hv-primary-darker` on `--hv-primary-tint`: 4.26:1, documented as
   failing in `tokens.ts:85-87`. Mint `--hv-on-primary-tint` in `ui/tokens.ts` (naming
   precedent: `--hv-on-amber`, `:57-60`), light half from the blue-900 family already
   proven by `--hv-tone-blue-fg` (`#01579b`, 6.56:1), dark half unchanged in effect
   (`--hv-primary-dark` and `--hv-primary-darker` are already the same value in dark).
   Consume it at `chip.ts:86`, `chip.ts:124`, and the sidebar's active row
   (`hv-full-view.ts:290`, `:512` — the same failing pair). Do **not** move
   `--hv-primary-darker` itself: it has ~18 users including `.hv-pill.outline`
   (`tokens.ts:213`) and inverted app-bar uses (`hv-full-view.ts:143`, `.appbar .add`).
   #301's issue text asks for exactly this audit-then-scope outcome; the remaining
   `--hv-primary-darker` text sites sit on white/raised surfaces where the ratio passes —
   state that conclusion in the PR body.
2. **B20 + C27 — one coordinated blue-family shift** in `tokens.ts:68-104`.
   `--hv-tone-blue-bg` is literally `var(--hv-primary-tint)` (`:84`) and
   `--hv-tone-blue-strong-bg` (`#0277bd`, `:98`) is byte-identical to
   `--hv-primary-darker`'s light half (`:44`). Shift the user-pickable blue pair a visible
   step away from the fixed vocabulary (indigo-leaning tint+ink for the light tone; the
   strong fill a step darker/greener than `--hv-primary-darker`) with both halves still
   ≥4.5:1 over their inks in both themes — the extended test (below) is the arbiter.
   Amend the `chip.ts` vocabulary comments (`:3-27`, `:141-152`): they argue the status
   chip opts out of the fixed hue vocabulary, which B20 shows was only half-true; make the
   comment state the constraint that now holds (tone blues deliberately offset from the
   state/primary blues so the vocabularies cannot collide).
3. **B19** — delete `_renderStatusPill` (`hv-full-view.ts:1614-1638`) and its two call
   sites (`:1712-1713`). The facet (fixed in P1) and the filter chips own status
   navigation; the app bar keeps only genuine chore/derived counts. Remove the associated
   `full-badge-status` tests (`hv-full-view.test.ts:1278-1318`), replacing the "no ok
   pill" pin with a "no status pills at all" assertion. This also removes any need for
   opaque `.appbar .hv-status-chip` tone overrides in the app-bar repaint block
   (`:226-250`) — do not add any.
4. **C26** — `hv-filter-chips.ts`: the applied "Status: X" chip is `tone: 'warning'`
   (amber = chore) for every non-ok status (`:84-90`, hard-coded `'ok'` → use
   `DEFAULT_STATUS`). Render the status entry with its own tone classes
   (`statusToneClass`) on the existing `<button>` (`:186-201`) — `renderStatusChip` emits
   a `<span>` and cannot be dropped in; carrying the tone class through the chip's `tone`
   field (widened union or a `toneClass` member) is the clean shape. The `hv-status-chip`
   metrics classes are already shared via the `chip` fragment.
5. **Guard — extend `ui/tone-contrast.test.ts` in the same commit as the token changes**
   (the extension fails at 4.26:1 against the unfixed ink, which is the point). Add a
   chip-variant table — `state`, `warning`, `error`, `neutral`, `quiet` — resolved
   bg/fg pairs asserted ≥4.5:1 across both themes alongside the existing tone matrix.
   The harness's `parseColor` throws on anything but hex/rgb, and `.hv-chip.quiet` has
   `background: none` — give the harness an explicit "no fill = surface" case. Add
   distinctness pins for the vocabulary split: resolved `--hv-tone-blue-bg` ≠ resolved
   `--hv-primary-tint`, and resolved `--hv-tone-blue-strong-bg` ≠ resolved
   `--hv-primary-darker` (today both pairs are equal — the exact bug).

### Traps

- `--hv-tap-min` is deliberately **not** declared in `tokens` (docstring
  `tokens.ts:154-168`; `hv-card-shell.test.ts:707-718` fails if it appears). This package
  edits `tokens.ts` — leave that mechanism alone.
- All dark-mode variants are `light-dark()` second arguments; `prefers-color-scheme` is
  forbidden (`ui/theme.test.ts`).
- `ui/chip.test.ts` forbids components restating chip metrics; new styling goes through
  the shared fragments.

### Verification & closing

Both gates (`tone-contrast.test.ts` is the merge gate for the colour work). PR (suggested
`fix(card): AA state-chip ink, distinct blue tones, status-toned filter chips`).
**Handover (visual confirmation)** — checklist in §Verification: P3.

---

## P7 — Table & list presentation  `wave 2 · size M/L`

**Items: B16, B17, C23.**

### Objective

The data table stays scannable: at phone width the name column holds while the rest
scrolls (with a visible affordance that it scrolls); at desktop the name column wins free
space over tags; status chips ellipsize instead of hard-clipping; and the list's document
marker sits with the name it belongs to.

### Scope

1. **B17 — column priority** (`cards/haventory-card/src/store/columns.ts`). The name track
   is hardcoded `'minmax(180px, 2fr)'` inside `tableTemplateFor` (`:83-89`); tags is
   `minmax(120px, 1.4fr)` (`:42`) and category/location take `1fr` each — name gets only
   2/5.4 of free space and its inline Low/Checked-out chips (flex: none) eat its share
   first. Raise the name column's min and grow so it demonstrably wins (the audit frame:
   "Kärc…" beside two full tag chips), and let tags yield. The `tableSize` comment on the
   status column (`:37-39`) explains its 112px — keep the chip readable, but…
2. **B17 — chip ellipsis** (`hv-data-table.ts`). `.cell` (`:137-143`) has
   `text-overflow: ellipsis`, but the status chip is a nested inline-flex `<span>` — the
   cell's ellipsis cannot reach into it, so long labels hard-cut mid-word. Give the chip's
   label a real ellipsis inside cells (the label is a bare text node beside the glyph in
   `renderStatusChip` — it may need a span wrapper in `ui/status.ts`, which every chip
   surface then inherits; check `hv-list-row`/`hv-detail-sheet` renderings still pass).
3. **B16 — sticky name column + scroll affordance at phone width.**
   **The trap is real and verified**: `:host` is the horizontal scroll container
   (`hv-data-table.ts:43-44`), but `.body` declares `overflow-y: auto` (`:91-93`) which
   makes it a scroll container on both axes — `position: sticky; left: 0` on a cell inside
   `.row` resolves against `.body` and does nothing, and the head row lives outside
   `.body` entirely. The fix requires restructuring so head and body share one horizontal
   scroll context (or sticky is applied consistently within each) — read the long
   overflow-rationale comment (`:94-110`) first; it is load-bearing and constrains the
   restructure (it exists so wheel/overscroll behaves). Requirements for the result:
   sticky name cell **and** name header with opaque backgrounds plus hover/selected
   variants (`--hv-row-hover` rules `:115-121` currently show through transparent cells);
   in selecting mode the checkbox column is sticky at `left: 0` and name offset by the
   checkbox track (40px + gap); an edge fade/gradient on the scroll container signals the
   overflow. Apply at the same narrow breakpoint the full view already uses.
4. **C23** — `hv-list-row.ts`: the document marker (`:509-517`) is a `.row` child after
   `.names` (flex: 1), so it floats to wherever the name stops. Move it inside `.names`,
   anchored to the name; the comment at `:114-120` (blockified flex items vs ellipsis)
   constrains how — the name must keep truncating. Do **not** add a thumbnail placeholder;
   the `.thumb` comment (`:88-103`) documents that decision and it stands.

### Traps

- The touch-target `::after` literal in `hv-data-table.ts:216-225` is regex-pinned by
  `hv-data-table.test.ts:90-93` (and its twin in `hv-list-row.ts:272-277` by
  `hv-list-row.test.ts:417-420`) — don't reformat them away.
- jsdom computes no layout: every sticky/overflow assertion offline is necessarily a
  cssText assertion, and a sticky rule that resolves against the wrong container passes
  every offline test while doing nothing. The live handover is the real acceptance.

### Tests

cssText pins for the sticky rules, opaque backgrounds, and edge fade; column-template
assertions for the new track sizes (`tableTemplateFor` is a pure function — test it
directly); marker-anchoring DOM assertion in `hv-list-row.test.ts`; chip-ellipsis DOM
shape in whichever file gains the label span.

### Verification & closing

Both gates. PR (suggested `fix(card): sticky name column, name-first table layout,
anchored document marker`). **Handover required** — checklist in §Verification: P7.

---

## P8 — Backend: Content-Disposition + attachment probes  `wave 2 · size M`

**Items: I300, I303 — one PR, `Closes #300, Closes #303` (the probes are the live
verification for the header).**

### Objective

Saving a manual produces the title the user chose (or the original filename), not a UUID;
and the attachment verification method from the #299 pass lives in `scripts/` where #276
inherits it.

### Scope — I300

`custom_components/haventory/media.py`, `HaventoryMediaView.get` (`:306-349`): add a
`Content-Disposition` header to the response dict (`:338-349`). Constraints from the
issue, all mandatory:

- **`inline`, never `attachment`** — clicking must keep opening in a tab.
- Filename precedence mirrors the card's `attachmentTitle()`
  (`cards/haventory-card/src/ui/media.ts:119-121`): `meta.title.strip() || meta.filename`.
  `meta` is in scope from `:328` (`AttachmentMeta`, `models.py:112-134`).
- **The value is untrusted text.** `title` (≤200 chars) and `filename` carry **no charset
  restrictions** — CR/LF/quotes are storable (`models.py:505-551`), and `filename` may
  itself be the attachment UUID (`ws.py:1541-1548`). Build a `_content_disposition(...)`
  helper: RFC 5987 `filename*=UTF-8''<percent-encoded>` for the real value plus a
  sanitized ASCII `filename="..."` fallback (strip CR/LF, escape or drop `"` and `\`);
  `urllib.parse.quote` with a tight `safe` set does the encoding. There is no existing
  header helper anywhere in the repo — this is greenfield; give it focused offline unit
  tests (pure function, no HTTP needed) covering non-ASCII, quotes, CR/LF injection
  attempts, and the UUID-filename fallback.
- Must not disturb the `Range: bytes=0-0` → `206` presence probe the card issues
  (`media.ts:219-236`) — `web.FileResponse` handles Range; the header rides along.
- **HTTP-level assertions live in integration mode only** (the offline stub has no HTTP
  layer — `tests/test_media_offline.py` never touches the view, by design). Extend
  `tests/integration/test_attachments.py`: the PNG header block (`:108-114`) asserts
  `Content-Disposition` starts `inline` and carries the filename; the PDF retitle flow
  (`:286-340`) asserts the header follows the title after retitling, including a
  non-ASCII title surviving the round trip (RFC 5987 decode and compare).
- Docs: `docs/backend_api_contract.md`'s media/attachment section gains the header
  behavior (one line — precedence and `inline`).

### Scope — I303

New probe helpers in `scripts/`, matching the house genre (`ws_probe.py` is the archetype:
raw-string docstring opening with `Usage:` + environment variables, env-var config,
stdlib+aiohttp, `async def run_*() -> int`, `main()` with `sys.exit(asyncio.run(...))`,
exit codes 0 ok / 2 missing config / 3 timeout; `stress_test.py` is the multi-scenario
precedent with `@dataclass` results and argparse). Name them `probe_*.py` — **never**
`test_*`, or a bare `pytest` invocation could collect them.

What they must do (from #303's acceptance):

- **Generate fixtures, never commit them** (~20 MB): a 4032×3024 photographic JPEG, the
  same frame with EXIF `Orientation=6`, a >2 MiB transparent PNG, a 24-frame animated
  GIF, and a sub-2 MiB JPEG that must round-trip byte-identical. The EXIF tag is set
  explicitly in code — that case is the one defect that looks correct in every automated
  test and wrong on every phone.
- Upload through the real flow and assert the **stored bytes on HA's disk** (the dev
  container mounts the config dir) against what the card's re-encode should have
  produced — the constants live in `cards/haventory-card/src/ui/downscale.ts`: 2 MiB
  threshold (`:22`), max edge 2048 (`:25`), quality 0.85 (`:28`), `RECODABLE`
  jpeg/png/webp with GIF excluded (`:30-35`), JPEG→JPEG else→WebP (`:44-54`), EXIF
  `from-image` (`:94-97`). Compare dimensions, mode/alpha, frame count.
- Assert the presence-probe semantics: `206` + `Content-Length: 1` on a live file, `404`
  on a deleted one, neither on an unreachable host.
- Assert the new `Content-Disposition` header end-to-end (this is I300's live check).
- Opt-in and online-only: gate on `RUN_ONLINE=1`, `HA_BASE_URL`, `HA_TOKEN` exactly like
  the `tests/*_online.py` smokes; never collected by the offline suite.

Plumbing decisions (already made): **Pillow via a new non-default uv dependency group**
(e.g. `probes`) so `uv sync` stays lean and the backend's documented Pillow-free stance
(`const.py:82`, README) holds — say so where the group is declared. **mypy**: `scripts/`
stays out of `[tool.mypy].files`; the new probes must pass
`uv run mypy scripts/<name>.py` manually (note the command in each docstring). **ruff**
runs on `scripts/` in CI — expect `S311`/`PLR2004` friction from fixture generation; the
house remedy is a file-level `# ruff: noqa:` pragma with a comment naming each code
(`create_test_items.py:1-9` is the precedent; do not copy its `sys.path`/pip hacks).

Wiring: add attachment rows (A6+) to `dev/release_testing_plan.md` group A (`:120-128` —
it has **no** attachment scenario today) pointing at the probes so #276 inherits the
method; list the new helpers in `README.md` ("Dev helper scripts", `:691-725`) and in
`CLAUDE.md`'s helper enumeration (`:180-184`).

### Verification & closing

Backend gate + frontend gate (untouched but required). Attempt
`scripts/test_integration.sh` remotely — the Content-Disposition assertions only run
there; if the remote network policy blocks provisioning the HA install, say so in the PR
and move the integration run into the handover. PR (suggested `feat(backend): serve
attachments with Content-Disposition; land attachment verification probes`).
**Handover required** — checklist in §Verification: P8.

---

## P4 — Organize dialog, Statuses tab  `wave 3 · after P1 (hard), P3 (soft) · size L`

**Items: B5, B10, B11, B12, B13, C21.**

### Objective

The Statuses tab works on a phone: the delete guard stacks and its select is readable,
every control is a real touch target, swatches show the tone they stand for (both
halves, both themes), the default status can be renamed/recoloured, a colliding label
warns before Create, and the slug preview shows the slug it exists to show.

All in `cards/haventory-card/src/components/hv-organize-dialog.ts` unless noted. The file
has **no** `@media` queries — every narrow-width rule rides the reflected `mobile`
property (`:host([mobile])`, fed by `ResponsiveController`, container-width breakpoint
600). Stay inside that idiom.

### Scope

1. **B5 — the delete guard** (`_renderStatusGuard`, `:1706-1748`). The element carries
   both `.expander` (grid, `:356-364`) and `.guard` (flex, `:432-443`, declared later —
   flex wins) with no wrap: message, label+select and actions fight over one row. Let the
   guard stack under `:host([mobile])` — message, then "Move those items to" + select,
   then actions — and give `select.control` a sane min-width at every width (it renders
   ~44px today). Delete the dead `.guard .glyph` rule (`:444-447` — nothing renders it).
2. **B10 — touch targets.** DOM-measured on mobile: `status-up`/`status-down` **15×15**
   (`.move button`, `:245-259`, no size at all), `status-edit`/`status-remove` 26×26
   (`:339-355`), swatches 26×22, `status-count` 53×14. Size them from
   `var(--hv-tap-min, …)` on coarse/mobile the way `base`'s `.hv-icon-button` does
   (`tokens.ts:241-259`) — the token reaches components by inheritance and must **not**
   be declared in `tokens` itself. Let `.swatches` wrap like the icon row already does.
3. **B11 — swatches as miniature chips.** Each swatch (`:1644-1660`) currently borrows
   only the tone's background — the half carrying the least identity, and near-invisible
   in dark. Paint each as a tiny chip: tint background **with** its ink (the currently
   selected glyph, or "Aa"), so light/strong separate at a glance and dark-mode tints
   are backed by their legible ink. The tone classes from `ui/chip.ts` carry both halves
   already.
4. **B12 — default status editable.** `:1575-1598` renders the "Default" pill *instead
   of* the edit/delete buttons for `ok`. Render edit alongside the pill; only delete
   stays withheld. The backend accepts label/colour/icon updates for any slug, and
   `ui/status.ts:23-32` documents that built-ins may be renamed/recoloured — the UI is
   the only blocker. Rewrite the pin at `hv-organize-dialog.test.ts:1038-1044`
   deliberately (pill *and* edit, no delete).
5. **B13 — duplicate-label hint.** `_slugFrom` (`:1427-1442`) silently mints `sold_2`
   when the label collides. Before Create, when the trimmed label case-insensitively
   equals an existing status label, show an inline hint in the editor ("A status called
   'Sold' already exists"). Warn, don't block; keep the slug dedupe as backstop — the
   backend raises on slug collision (`repository.py:279-281`), so removing the dedupe
   would turn a silent suffix into an error.
6. **C21 — slug preview.** `status-slug-preview` (`:1639-1641`) truncates at ~19 chars
   with free row width available. Let it take the free width / wrap under the input on
   narrow, and add `title` with the full slug (row `status-slug` too).
7. **Consolidation** — move `_slugFrom` into `ui/status.ts` as a pure function taking the
   defs (it is untestable in isolation today; `ui/status.test.ts` has room), and unit-test
   it: NFKD accent stripping, the 64-char cap, the `_2` suffix walk, the `'status'`
   fallback.

### Tests

Beyond the pins above: guard stacking cssText under `:host([mobile])`; tap-min cssText
for the resized controls; duplicate-label hint appears/absent cases; default-row edit
opens the editor for `ok`; slug preview shows the full derived slug. P1 already added the
count-link test — don't collide with it (this file changed in P1; re-read before editing).

### Verification & closing

Both gates. PR (suggested `fix(card): make the Statuses tab usable on touch — stacking
guard, real targets, legible swatches, editable default`). **Handover required** —
checklist in §Verification: P4.

---

## P5 — Editor attachment & form UX  `wave 3 · after P2 (hard), P3 (soft) · size L`

**Items: B7, B8, B9, B14, C24, I301 (tap-target half) — PR carries `Closes #301`.**

### Objective

The editor stops being booby-trapped: removing an attachment asks first, Escape closes
the open popover before it may discard anything (and a dirty discard asks), the empty
location picker offers a way forward, uploads visibly progress where the user is looking,
create mode says why photos come later, and every interactive control is ≥24px.

All in `cards/haventory-card/src/components/hv-item-editor.ts` unless noted. P2 changed
this file's `willUpdate` — re-read the current state before editing.

### Scope

1. **B7 — confirm on remove.** `editor-photo-remove`/`editor-document-remove` call
   `_removeAttachment` (`:1703-1722`) directly — the only destructive action on the card
   without a guard, destroying the only copy of the file. Gate both through `hv-confirm`
   (`components/hv-confirm.ts` — heading/message/destructive/confirm events, own Esc and
   z-stacking) with a `_confirmRemove: { id: string; kind: AttachmentKind } | null` state,
   following the empty-status confirm template (`hv-organize-dialog.ts:1967-1982`).
   Message names the consequence: "Remove this photo? The file is deleted." The pin at
   `hv-item-editor.test.ts:1126-1139` (remove fires WS immediately) breaks by design —
   insert the confirm-accept step; add a cancel case.
2. **B8 — Escape discipline.** The editor root keydown (`:986-995`) cancels on Escape;
   the location tree (`hv-location-tree`) has **no** Esc handling, and the checkout
   popover's `onEscape` (`ui/keyboard.ts:52-59`) doesn't stop propagation — so Esc with
   either open discards the whole form. Make open popovers consume the first Escape
   (close the popover, stop propagation — the category popover at `:1166-1173` already
   does it right and is the model). Then: Escape on a **dirty** form (`get dirty()`,
   `:950-952`) routes through the same `hv-confirm` before `_cancel()`; a clean form
   still closes immediately.
3. **B9 — location picker dead end.** `hv-location-tree.ts:652-656` renders "No locations
   yet" with no way forward on an empty install. Add an inline "New location…" affordance
   in that empty state: a small name input/prompt that calls `store.createLocation`
   (`store/store.ts:1301`) at the root and selects the result. The tree already receives
   the store's data through its host — check what the editor passes down and extend
   minimally (an event up to the editor, which owns the store reference, is the cleanest
   shape). Keep it to the empty state; the organize dialog remains the full management
   surface.
4. **B14 — visible upload progress.** The queue renders states as bare words
   (`_renderUploadList`, `:1955-1981`) two sections below the photo grid. Add an
   indeterminate spinner/bar to active rows (`queued`/`preparing`/`uploading`) and a
   photo/document glyph per row; render the pictures queue under the PHOTOS section and
   the documents queue under DOCUMENTS instead of one combined list under both. No byte
   progress exists on the WS path — indeterminate is honest. Respect
   `prefers-reduced-motion` (the motion tokens in `tokens.ts:145-152` already zero
   themselves).
5. **C24 — create-mode hint.** One line in create mode ("Save the item first to add
   photos and manuals") where the PHOTOS section will appear. The pinned test
   (`:1016-1021`, no pictures section while creating) stays green — a hint, not a
   section.
6. **I301 tap targets** — `editor-photo-remove` is 22×22 (`:733-748`); bring it and every
   interactive editor control to ≥24×24 (tile controls `:707-724`, doc buttons
   `:797-809`, combo arrow `:386-398`, upload Retry/dismiss). Where P4 sized the organize
   dialog's reorder buttons, align the editor's `.tile-controls` with them — the comment
   at `:1727-1728` claims parity with the dialog; make the claim true or fix the comment.
7. **Consolidation** — collapse the three copy-pasted error-entry pushes
   (`:1689-1699`, `:1710-1720`, `:1852-1862`) into a `_pushUploadError` helper; adopt
   the shared `.hv-tally` from P1 at `:497`.

### Tests

Confirm accept/cancel for both kinds; first-Esc-closes-popover / second-Esc-asks-if-dirty
/ clean-Esc-closes sequences (location tree and checkout popover both); empty-tree create
affordance (event or store call observed via `makeMediaBindings`-style recording);
spinner presence per queue state (cssText + DOM); create-mode hint. `keyboard.test.ts`
and `hv-location-tree.test.ts` cover the helpers.

### Verification & closing

Both gates. PR (suggested `feat(card): guarded attachment removal, escape discipline,
first-run location create, visible upload progress` — carries `Closes #301`).
**Handover (short smoke)** — checklist in §Verification: P5.

---

## P6 — Detail-sheet gallery & documents  `wave 3 · after P2 (hard) · size S`

**Items: B15, C22.**

### Objective

The lightbox navigates a multi-photo item (buttons, counter, arrow keys — no swipe, per
the locked decision), and untitled documents stop printing their filename twice.

### Scope

1. **B15** — `_renderLightbox` (`cards/haventory-card/src/components/hv-detail-sheet.ts:552-583`)
   shows one `<img>` and a close button. `shots` (ordered) and the index are already in
   scope, and `pictureAlt(name, index, shots.length)` already computes "photo n of m".
   Add prev/next tap-edge buttons (hidden/disabled at the ends or wrapping — pick one and
   test it), an "n of m" counter, and ArrowLeft/ArrowRight in the existing local keydown.
   **Keep** the local Escape handler's `stopPropagation` (`:568-575`) — its comment
   explains the bottom sheet underneath takes the same Escape; the focus-contract tests
   (`:376-430`) must stay green, and the new buttons join the `DialogFocus` trap. P2 made
   `_lightbox` survive same-id item refreshes — clamp the index if the photo list shrank
   underneath it.
2. **C22** — the document meta line (`:523-531`) prints `doc.filename` under a title that
   is `attachmentTitle(doc)` — identical when untitled (the common case). Omit the
   filename from the meta line when it equals the rendered title. The editor's document
   rows show an input with the filename as placeholder rather than a title line — verify,
   and leave them alone if no duplication exists there.
3. **Optional, only if it falls out naturally**: the document-row CSS is near-identical
   between editor (`hv-item-editor.ts:770-809`) and sheet (`:275-347`) — a shared
   fragment is welcome but not required; if skipped, no action (the follow-up issue from
   P1 already covers harness/CSS dedupe territory).

### Tests

Prev/next move the image and counter; boundary behavior; arrow keys; Escape still closes
only the lightbox with focus restored (existing pins); untitled meta line omits the
filename, titled meta line keeps it.

### Verification & closing

Both gates. PR (suggested `feat(card): lightbox navigation; deduplicated document rows`).
**No handover** — offline coverage suffices; the user can merge directly.

---

## Verification — per-package handover checklists

Every PR runs both offline gates regardless. The checklists below are what the **local**
session (Docker dev HA + `run-haventory` skill) executes after the remote session opens
the PR. "Required" means the user merges only after this pass.

| Pkg | Handover | Checklist |
|---|---|---|
| P1 | **Required** | Seed a status with items; delete it with reassignment while a second card/panel is open. Expect: no console error, both surfaces' rows and counts settle without manual refresh, sidebar facet shows true per-status counts (including a 0), filter-panel STATUS chips all priced, organize count-link opens the full view **with** the filter applied and the dialog closed. |
| P2 | **Required** | Audit repro: open an item's editor, type into description, add a photo; after the upload lands the text must survive and the form stay open. Mobile: enter edit in the detail sheet, tap "make cover" — sheet stays in edit mode. Batch upload with one refused file (`broken.jpg`-style bytes): error row + Retry survive the siblings' success; dismiss clears it. |
| P3 | Visual confirm | Light + dark screenshots: a tone-blue status chip beside a "Checked out" state chip (distinct), a strong-blue chip beside a primary button (distinct), applied status-filter chip in its own tone, app bar without the missing/needs-repair pills. |
| P4 | **Required** | 390 px + dark screenshots: delete guard stacks and the reassign select is readable; chevrons/edit/delete/swatches measure ≥24 px (DOM-measure, don't eyeball); swatches legible in dark; default `ok` row shows an edit affordance; duplicate label shows the hint; slug preview shows a long slug in full. |
| P5 | Short smoke | Esc with the location tree open closes only the tree; second Esc on a dirty form asks. Remove a photo → confirm dialog appears, cancel preserves, confirm deletes. Throttled multi-MB upload shows a moving indicator under PHOTOS. Empty install: location picker offers "New location…" and it works. |
| P6 | None | — |
| P7 | **Required** | Phone width: swipe the table left — the name column holds with an opaque background and an edge fade is visible; status chips ellipsize with `…`. Desktop with default columns: name column readable on the audit's long-name fixtures while tags yield. Selecting mode: checkbox + name both pinned. |
| P8 | **Required** | Run `scripts/test_integration.sh` if the remote session could not. Run the new probes against the dev HA from a clean checkout per their docstrings (fixtures generated, stored-bytes assertions pass, presence semantics 206/404/unreachable, EXIF orientation case). Browser: save a titled manual → file saves under the title; untitled → original filename; still opens in a tab. |

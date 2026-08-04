# Item 38 — Areas in the card: implementation plan

**Status:** planned, not implemented. **Scope owner:** item 38 of
[`open-items.md`](open-items.md) plus the owner's 2026-08-01 extension (this document).
**Branch policy:** each stage is an ordinary pre-v1.0 PR-sized change; nothing here
touches the backend or the WS contract.

## 1. What is being built

Item 38 records that an item's area is nowhere in the card even though the backend
computes and ships `Item.effective_area_id` on every item. The owner extended the scope
with three requirements:

- **R1 — Locations are sorted by area.** Every location tree the card renders groups
  top-level locations under their HA area, areas ordered by name, locations without an
  area after them.
- **R2 — The area appears in the location path.** Every surface that prints an item's
  location path shows the item's effective area with it.
- **R3 — Area vs. plain location is directly discernible.** Looking at the top level of
  a location tree (or at a rendered path), it must be immediately visible whether the
  leading element is an HA area or a normal HAventory location.

## 2. Current state (verified against source, 2026-08-01)

Facts the design leans on — each one checked in the code, not assumed:

- **`Item.effective_area_id` is already shipped** on every `Item`
  (`ws.py:_effective_area_id_for_item`, declared in `cards/haventory-card/src/store/types.ts:40`)
  and read by nothing.
- **A tree's area lives on its root.** `Repository._propagate_area_to_root`
  (`repository.py:535`) moves any area assignment to the tree root and clears it from
  every other node; `_resolve_effective_area_id_for_location` walks upward to the first
  non-null `area_id`. Consequence for the frontend: for any root node of
  `locationTreeCache`, `root.area_id` **is** the effective area of the whole tree, and
  non-root nodes have `area_id === null`. No contract change is needed to group or
  label by area.
- **`areasCache`** (`{id, name}[]`) is fetched once at startup (`store.ts:516`) and
  already reaches `hv-organize-dialog`, `hv-filter-panel`, `hv-filter-chips`, and the
  full-view sidebar tree — but not `hv-list-row`, `hv-data-table`, `hv-detail-sheet`,
  `hv-item-editor`'s tree, `hv-bulk-bar`'s tree, or the filter panel's tree.
- **Path rendering is centralized**: `ui/location-path.ts` (`prettyPath`,
  `locationLabel`) and `hv-list-row.ts` (`displayPath`, `elidePath`). Consumers:
  list-row secondary line, data-table Location column, detail-sheet crumb, filter
  chips, filter panel's selected-location label, item editor's location field label,
  and the full-view context-bar breadcrumb.
- **Tree ordering is centralized**: `store/location-tree.ts:sortLocationTree` (name
  collation, applied once in `store.ts:629`). `hv-location-tree` renders the nodes it
  is given; it has six call sites (full-view sidebar, filter panel picker, item editor
  picker, bulk-bar move picker, organize dialog: manage tree + parent picker + merge
  picker).
- **An area filter already exists end-to-end**: `filters.areaId` →
  `ItemFilter.area_id` (`store.ts:137`), with a select in the filter panel. R1's
  grouped sidebar can therefore make area rows *do* something for free.
- The organize dialog's tree shows an `Area: <Name>` chip per node (`showAreas` +
  `_areaName`), which is today the only place an area is visible at all.

## 3. Design

### 3.1 Effective-area resolution stays client-side, no backend change

Two resolution paths, both from data already cached:

- **Per item:** `item.effective_area_id` + `areasCache` → name. Zero computation.
- **Per location** (filter chips, editor labels, tree grouping): a helper that mirrors
  the backend's walk — first non-null `area_id` from the node upward — over
  `locationsFlatCache`. Walking (rather than "read the root") keeps the helper correct
  even if the root-only invariant ever loosens, and matches
  `_resolve_effective_area_id_for_location` exactly.

New shared helpers (stage 1):

```ts
// ui/area.ts (new)
areaNameById(areas, id): string | null          // null id → null; unknown id → id (backend behavior)
effectiveAreaIdForLocation(locations, id): string | null   // ancestor walk, cycle-guarded

// ui/location-path.ts (extended)
pathParts(item | location …): { areaName: string | null; path: string }
pathTitle(parts): string                        // "Area: Kitchen · Garage › Shelf A" for title= attrs
renderAreaChip(areaName): TemplateResult        // the one visual treatment every surface reuses
```

### 3.2 R3 — one visual treatment for "this is an area"

A single, reused rendering: a compact chip — `home` icon + area name — visually
distinct from path text (reuses the existing `.area-chip` treatment from
`hv-location-tree`, promoted into the shared style layer `ui/tokens.ts` so every shadow
root can use it). Wherever a path is shown, the chip precedes the path:

> `[⌂ Kitchen] Fridge › Top Shelf`

The chip *is* the discernibility signal: an area is never rendered as a plain path
segment, and a plain path segment is never an area. Tooltips/`title` attributes carry
the text form `Area: Kitchen · Fridge › Top Shelf` (same wording as the organize tree's
chip, so the vocabulary stays consistent). Items or locations with no effective area
render exactly as today — no placeholder chip.

### 3.3 R1 + R3 — the tree groups top-level locations by area

`hv-location-tree` gains grouped rendering, enabled by all six call sites:

- Roots are partitioned by `root.area_id`. Each area with at least one root renders an
  **area header row**: `home` icon + area name, styled distinctly (the same chip
  vocabulary as 3.2), collapsible like any node, default-expanded. Member roots render
  beneath it at depth +1.
- Area groups are ordered by area name (`Intl.Collator`, `numeric`, base sensitivity —
  same collator as `sortLocationTree`); roots without an area follow the last group
  under a small **"No area"** divider header (rendered only when at least one area
  group exists — an inventory that uses no areas at all sees today's tree unchanged).
  Within a group, existing `sortLocationTree` order applies untouched.
- Grouping is computed in a pure helper `groupRootsByArea(nodes, areas)` in
  `store/location-tree.ts` (testable without DOM), consumed by the component at render
  time. `store.ts` keeps caching the sorted-by-name tree; grouping is presentation.
- **Behavior per caller:**
  - *Sidebar (full view):* area header rows are clickable and set `filters.areaId`
    (the filter already exists); selected-state renders like a selected location row.
    A new `select-area` event carries `{areaId}`.
  - *Pickers (item editor, bulk move, organize parent/merge):* area headers are
    inert labels (not selectable — an area is not a `location_id` and cannot be
    assigned), but still collapsible. Controlled by a `areaSelectable` boolean prop;
    default false.
  - *Organize manage tree:* headers are inert; the per-node `Area: X` chip
    (`showAreas`) is **retired** — with the header above the root it duplicates the
    same fact in the same words. The `showAreas`/`areas`-chip code path is removed;
    `areas` stays as the name-lookup input.
- Mechanics that must keep working, with area headers keyed `area:<id>` in the
  expansion set: `revealPathTo` (also expands the target root's group header), text
  filtering (a header stays visible while any member root is visible; headers
  themselves do not match text), `excludeSubtreeOf`, counts (`showCounts` sums the
  member roots' `subtree_item_count` / `matching_subtree_count` onto the header row),
  a11y (`role="treeitem"`, `aria-expanded`, `aria-level` shifted +1 for grouped rows).

### 3.4 R2 — item-facing surfaces (item 38 proper)

Thread `areas` (the `areasCache.areas` array) into the three gap surfaces and render
the shared chip + path:

| Surface | Change |
|---|---|
| `hv-list-row` secondary line (desktop) | chip before path: `[⌂ Kitchen] Garage › Shelf A · Tools`; `title` uses `pathTitle` |
| `hv-list-row` secondary line (mobile) | no room for a chip: the area name is prepended as the first *text* segment before eliding — `Kitchen › … › Small Bin` — so the room survives the elision; the full form incl. `Area:` wording lives in the `title` and the detail sheet |
| `hv-data-table` Location column | chip + path; `title` via `pathTitle`; column stays sortable by `location_path.sort_key` exactly as today (sort semantics unchanged — see 3.6) |
| `hv-detail-sheet` crumb | chip + full path; `No location` fallback unchanged |

Threading: `hv-card-shell` / `hv-full-view` already hold `st.areasCache` — pass
`.areas` down through `hv-list` → `hv-list-row`, and to `hv-data-table` /
`hv-detail-sheet` directly, the same way the sidebar tree already receives it. Rows
resolve `item.effective_area_id` themselves via `areaNameById` (a find over a handful
of areas per render is fine at card scale; no memoization until measured).

`effective_area_id` is derived from the item's location, so "no location" implies "no
area" — the existing `No location` fallbacks need no area-awareness.

### 3.5 R2 — location-facing labels

The remaining path printers switch to the same helpers, resolving the area with
`effectiveAreaIdForLocation` over `locationsFlatCache`:

- `hv-filter-chips` location chip and `hv-filter-panel` selected-location label.
- `hv-item-editor` location field label.
- Full-view context-bar breadcrumb (`hv-full-view`): chip before the segment spans.

### 3.6 Explicitly out of scope

- **Item sort order by area** (the table's Location column keeps sorting by
  `location_path.sort_key`): R1 says *locations* sorted by areas, and changing item
  sort semantics is a contract question (`sort_key` is server-computed). If wanted
  later it is a separate item.
- **Item 46** (effective-area *preview* in the location editor — the propagation
  surprise) stays its own item; this work neither fixes nor blocks it. Stage 1's
  `effectiveAreaIdForLocation` is deliberately the client-side walk item 46's preview
  needs, so 46 gets cheaper afterwards.
- **Backend/contract changes**: none. `docs/backend_api_contract.md` and
  `docs/data_shapes.md` stay untouched.

## 4. Stages

Four stages, each independently green (backend gate + frontend gate + build), each a
conventional commit. Stage order is dependency order: helpers → tree → item surfaces →
label surfaces + docs.

| # | Stage | Files (primary) | Tests |
|---|---|---|---|
| 1 | Shared helpers + shared chip style | `ui/area.ts` (new), `ui/location-path.ts`, `ui/tokens.ts`, `store/location-tree.ts` (`groupRootsByArea`) | pure-function vitest: resolution walk (direct, inherited, orphan, cycle guard, unknown-id), grouping (order, no-area tail, empty-areas no-op), title/parts composition |
| 2 | Grouped tree + all six call sites | `hv-location-tree.ts`, `hv-full-view.ts`, `hv-filter-panel.ts`, `hv-item-editor.ts`, `hv-bulk-bar.ts`, `hv-organize-dialog.ts` | component vitest: header render/order, collapse, inert vs. selectable headers, `select-area` → `filters.areaId`, filter-text visibility, `revealPathTo` through a group, counts on headers, chip retirement in organize |
| 3 | Item surfaces (closes item 38) | `hv-list-row.ts`, `hv-data-table.ts`, `hv-detail-sheet.ts`, `hv-list.ts`, `hv-card-shell.ts`, `hv-full-view.ts` | row chip + mobile elision with area segment, table cell + title, sheet crumb, null-area fallback on all three |
| 4 | Location labels, docs, ledger | `hv-filter-chips.ts`, `hv-filter-panel.ts`, `hv-item-editor.ts`, `hv-full-view.ts` (breadcrumb), `docs/frontend_architecture.md`, `dev/open-items.md` | chip/label with inherited area, breadcrumb chip; live verification pass (see 5) |

## 5. Verification

Per stage: the standard gates from `CLAUDE.md` (offline pytest — untouched by this work
but part of the gate —, ruff, mypy; eslint, `npm run typecheck`, `vitest run`,
`npm run build`).

After stage 4, a live pass against the dev HA container (the `run-haventory` skill):
seed inventory with areas assigned to some location trees and not others, then verify
by screenshot: (a) sidebar groups and orders by area with "No area" tail, (b) clicking
an area header filters items, (c) list row / table / detail sheet show the area chip,
(d) an item in an arealess tree shows no chip, (e) pickers show inert headers and still
assign only real locations.

## 6. Ledger updates (stage 4)

- Item 38's row: mark fixed, note the surfaces now reading `effective_area_id`.
- Record follow-ups surfaced during the work under a "Follow-ups" note per the repo
  convention — known candidates: the item-sort-by-area question (3.6), and whether the
  filter panel's area *select* should retire in favor of the sidebar's area headers.

---

## 7. Implementation prompts (Opus 5, xhigh reasoning)

One prompt per stage. Each is written to be pasted verbatim into a fresh Opus 5
session with xhigh reasoning effort, working tree at repo root. They assume the
previous stages are merged; each ends green on both gates.

### Prompt — Stage 1: shared area/path helpers

```text
You are working in the HAventory repo (Home Assistant custom integration + Lit card).
Read CLAUDE.md first and follow it exactly — especially the comments policy (constraints
only, no history), TDD, and the pre-commit gates. This stage is frontend-only, in
cards/haventory-card.

Context you can rely on (verified): the backend ships Item.effective_area_id on every
item (types.ts:40, unused so far); Repository._propagate_area_to_root keeps a location
tree's area on its ROOT node and resolves it downward by walking ancestors to the first
non-null area_id; the card caches areasCache ({id,name}[]), locationsFlatCache
(flat Location[] with parent_id/area_id), and locationTreeCache. Read
dev/item38_area_display_plan.md (sections 2–3) for the full design; you are building
its stage 1.

Deliverables, all in cards/haventory-card/src, all pure and DOM-free except the one lit
helper:
1. ui/area.ts (new):
   - areaNameById(areas: {id,name}[], id: string|null|undefined): string|null —
     null/undefined → null; unknown id → the id itself (mirrors hv-location-tree's
     existing _areaName fallback).
   - effectiveAreaIdForLocation(locations: Location[], id: string|null): string|null —
     first non-null area_id walking self → parents, mirroring the backend's
     _resolve_effective_area_id_for_location, with a step guard against parent cycles
     (return null on guard trip).
2. ui/location-path.ts (extend, keep existing exports working):
   - a parts-producing helper returning { areaName: string|null, path: string } given
     (a) an Item + areas, or (b) a Location + locations + areas — pick a clean signature
     (two functions beat one overloaded one);
   - pathTitle(parts): string → "Area: Kitchen · Garage › Shelf A" (omit the area half
     when areaName is null; path half falls back like today's locationLabel);
   - renderAreaChip(areaName): lit TemplateResult — home icon (ui/icons.ts 'home') +
     name, class "area-chip".
3. ui/tokens.ts: promote the .area-chip css treatment (currently local to
   hv-location-tree) into the shared style layer so every shadow root renders the chip
   identically. Leave hv-location-tree itself untouched this stage.
4. store/location-tree.ts: groupRootsByArea(nodes: LocationTreeNode[], areas):
   { areaGroups: {id, name, roots: LocationTreeNode[]}[], ungrouped: LocationTreeNode[] }
   — group roots by root.area_id (roots carry the tree's area; do NOT walk here),
   groups ordered by area name with the module's existing collator, unknown-id groups
   ordered by their id fallback name, ungrouped = roots with null area_id in their
   incoming order. Pure; does not mutate input.

TDD: write vitest specs first (ui/area.test.ts, extend location-path/location-tree
specs): direct area, inherited-from-ancestor, no area anywhere, unknown area id, parent
cycle guard, grouping order incl. numeric collation ("Room 2" < "Room 10"), no-area-only
inventory → empty areaGroups, title composition with and without area.

Nothing may change visibly in the card yet — no component edits beyond tokens.ts.
Gate before committing (both must be green):
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q && uv run ruff check . && uv run mypy
  (cd cards/haventory-card && npx eslint . && npm run typecheck && npx vitest run && npm run build)
Commit as: feat(card): shared area resolution and path helpers (item 38, stage 1)
```

### Prompt — Stage 2: location trees grouped by area

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly
(comments policy, TDD, gates). Frontend-only. Read dev/item38_area_display_plan.md —
you are building stage 2 (section 3.3); stage 1's helpers (ui/area.ts,
groupRootsByArea in store/location-tree.ts, shared .area-chip style in ui/tokens.ts)
are already merged — use them, do not reimplement.

Goal: every location tree the card renders groups top-level locations under their HA
area (R1), with area rows visually distinct from location rows (R3).

Changes:
1. cards/haventory-card/src/components/hv-location-tree.ts:
   - Partition this.nodes via groupRootsByArea(this.nodes, this.areas) at render time.
   - Render one header row per area group: home icon + area name, distinct styling
     (shared area-chip vocabulary), collapsible with the existing twisty mechanics —
     key headers "area:<id>" in the _expanded set, DEFAULT EXPANDED (i.e. treat
     absence from the set as open for header keys, or seed them — pick the simpler
     mechanism and say why in one constraint comment if non-obvious).
   - Member roots render beneath their header at depth+1; ungrouped roots render after
     the last group under a "No area" divider header, rendered ONLY when at least one
     area group exists. An inventory with no areas renders byte-identically to today.
   - New prop areaSelectable (boolean, default false): when true, clicking a header
     emits "select-area" {areaId}; when false headers are inert labels (but still
     collapse). Headers are never selectable as locations and never disabled-styled by
     excludeSubtreeOf.
   - showCounts on a header row: sum of member roots' subtree_item_count, and of
     matching_subtree_count when present, in the existing "4 / 37" pairing.
   - Text filtering: a header stays while any member root is _visible; header text
     itself never matches. revealPathTo also expands the target root's group header.
   - a11y: headers are role="treeitem" with aria-expanded; grouped location rows sit
     one aria-level deeper than today.
   - RETIRE the per-node "Area: X" chip (showAreas prop, _areaName, .area-chip local
     css, tree-area testid) — the group header now states the same fact. Keep the
     areas prop (it feeds grouping). Update every caller and test that referenced
     showAreas.
2. Call sites — thread .areas=${st?.areasCache?.areas ?? []} into the tree instances
   that lack it (hv-filter-panel picker, hv-item-editor picker, hv-bulk-bar move
   picker, organize parent + merge pickers) and set areaSelectable ONLY on the
   full-view sidebar tree; wire its select-area to this._setFilters({ areaId }) —
   filters.areaId → ItemFilter.area_id already exists end-to-end (store.ts:137). Area
   header selected-state: render selected when filters.areaId matches and no location
   is selected (pass the current areaId in as a prop, mirroring selectedId).
3. hv-bulk-bar / hv-item-editor / organize pickers: verify assignment still only ever
   emits real location ids (headers inert).

TDD (vitest, component-level like the existing hv-location-tree.test.ts):
header rendering + area order + "No area" tail; no-areas inventory unchanged; collapse
hides members; inert vs areaSelectable headers; select-area wiring to areaId filter in
hv-full-view; counts summing; filter-text keeps header while a member matches;
revealPathTo through a group; showAreas chip fully gone (grep the repo for showAreas /
tree-area — zero hits outside git history).

Gate before committing (backend + frontend, per CLAUDE.md), then commit as:
feat(card): group location trees by area (item 38, stage 2)
Record any out-of-scope finding under a Follow-ups note in the commit/PR body rather
than fixing it.
```

### Prompt — Stage 3: show the area on item surfaces

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly
(comments policy, TDD, gates). Frontend-only. Read dev/item38_area_display_plan.md —
you are building stage 3 (section 3.4), the part that closes open-items item 38:
the three item-facing surfaces never show an item's area even though
Item.effective_area_id is on every item. Stages 1–2 are merged: use
areaNameById (ui/area.ts), the parts/pathTitle/renderAreaChip helpers
(ui/location-path.ts), and the shared .area-chip style (ui/tokens.ts).

Changes (cards/haventory-card/src):
1. hv-list-row.ts: new areas prop (attribute: false). Desktop secondary line becomes
   [⌂ Area] chip + "Garage › Shelf A · Category"; the title attribute uses pathTitle
   ("Area: Kitchen · Garage › Shelf A · Tools"). Mobile: no chip — prepend the area
   name as the first TEXT segment before elidePath runs, so a deep path elides to
   "Kitchen › … › Small Bin" (the room survives; the elision comment in the file
   explains why first+last are the segments worth keeping — preserve that reasoning).
   Mobile checked-out / inspection-due lines are untouched. Null effective_area_id →
   exactly today's output.
2. hv-data-table.ts: Location cell renders chip + path; title via pathTitle. Column
   sorting is NOT touched (stays location_path.sort_key server-side semantics).
3. hv-detail-sheet.ts: crumb renders chip + full path; "No location" fallback
   unchanged (no location implies no effective area — the field is location-derived).
4. Threading: pass areas from state down every route that renders these components —
   hv-card-shell and hv-full-view both render hv-list / hv-data-table /
   hv-detail-sheet; hv-list forwards to hv-list-row. Follow the existing
   .areas=${st?.areasCache?.areas ?? []} pattern.

TDD (vitest, alongside the existing specs for these components): chip renders with
resolved name; unknown area id falls back to the id; null → no chip and byte-identical
secondary text; mobile elision includes the area as leading segment; table cell title
contains the "Area: …" prefix; sheet crumb chip; areas prop absent (older host) →
renders like today.

Gate before committing (backend + frontend, per CLAUDE.md), then commit as:
feat(card): show item area on list, table and detail surfaces (item 38, stage 3)
```

### Prompt — Stage 4: location labels, docs, ledger, live verification

```text
You are working in the HAventory repo. Read CLAUDE.md first and follow it exactly
(comments policy, TDD, gates). Read dev/item38_area_display_plan.md — you are building
stage 4 (sections 3.5, 5, 6). Stages 1–3 are merged.

Changes:
1. Remaining path printers adopt the shared area treatment, resolving via
   effectiveAreaIdForLocation over st.locationsFlatCache + areaNameById:
   - hv-filter-chips.ts: the location chip shows the area (chip-in-chip is noise —
     use the pathTitle text form "Area: Kitchen · Garage › Shelf A" inside the chip's
     label, or the ⌂ icon + name prefix; pick the one that reads better at chip size
     and keep it consistent with hv-filter-panel below).
   - hv-filter-panel.ts: the selected-location label under the tree picker.
   - hv-item-editor.ts: the location field's label (locationLabel call).
   - hv-full-view.ts: the context-bar breadcrumb — renderAreaChip before the segment
     spans when the selected location has an effective area.
   All four: null area → today's output, unchanged.
2. Docs: update docs/frontend_architecture.md — the area display/threading pattern
   (which components receive areas, where resolution happens) and the grouped tree.
   Do NOT touch backend_api_contract.md / data_shapes.md (no contract change).
3. Ledger: in dev/open-items.md, move item 38 to the closed section per the file's
   existing conventions, noting the surfaces now reading effective_area_id and that
   R1–R3 (grouped trees, area-in-path, distinct area rendering) landed with it. Add a
   Follow-ups note for anything you surfaced but did not fix — two known candidates
   from the plan: whether the table should offer sorting by area (contract question:
   sort_key is server-computed), and whether the filter panel's area select is
   redundant next to the sidebar's selectable area headers.
4. TDD for (1) (vitest), then run both full gates per CLAUDE.md.
5. Live verification (the run-haventory skill): deploy to the dev HA container, seed
   locations where some trees have areas and some do not, and screenshot-verify:
   sidebar grouped + ordered by area with a "No area" tail; clicking an area header
   filters the item list; list row, table and detail sheet show the area; an arealess
   tree's items show no chip; item-editor/bulk-move pickers show inert headers and
   still assign only real locations. Fix what the live pass contradicts before
   committing.

Commit as: feat(card): area in location labels + close item 38 (stage 4)
```

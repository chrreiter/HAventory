# Item 46 — effective-area preview in the location editor

Status: **planned** (pre-v1.0, ships in v0.2.0). Tracker row: `open-items.md` item 46.
Paste-ready prompt: [`v1_prompts.md`](v1_prompts.md#item-46).

## The gap

The location editor's area `<select>` (in `hv-organize-dialog`) does more than it says:

- Picking the **default option** on a *nested* location is not "stop inheriting" — the
  backend runs `_propagate_area_to_root(key, None)` and clears the area from the **whole
  tree**.
- Picking an **explicit area** moves the assignment to the **tree root** and clears every
  node below it.

Nothing in the dialog warns about either. The mechanics for a preview already exist:
item 38 built `effectiveAreaIdForLocation` (`ui/area.ts`) — the cycle-guarded client-side
walk over `locationsFlatCache` — so no contract change and no new plumbing is needed.
What is left is the design decision this plan makes.

## The design

One preview line directly under the select, restating the selected option as its real
whole-tree consequence *before* Save. Pure function first, render second.

**Stage 1 — `areaChangePreview` (pure, TDD-first).** In `ui/area.ts` (or a sibling):

```
areaChangePreview(locations, editedLocationId, selectedAreaId | null)
  → { kind: 'none' | 'clear-tree' | 'assign-root',
      rootId, rootName, treeSize,           // locations in the affected tree
      currentEffectiveAreaId }
```

- `none` — selection equals the current stored state (no change on save): no preview.
- `clear-tree` — default option picked while the tree has an effective area: "Removes
  the area from the whole ⟨root name⟩ tree (N locations)."
- `assign-root` — explicit area picked: "Assigns ⟨area⟩ to the whole ⟨root name⟩ tree
  (N locations)" — and when the edited location is not the root, say so: "the area is
  stored on ⟨root name⟩".
- A single-node tree (`treeSize === 1`) drops the tree phrasing — the plain reading is
  correct there and a warning would be noise.

**Stage 2 — render in `hv-organize-dialog`.** Muted helper-text line under the select,
using the shared `.hv-area-chip` treatment for the area name so the vocabulary matches
every other surface (item 38's R3). Updates live on select change. Wire copy exactly to
the preview `kind`s; no new dialogs, no confirmation step — the preview informs, Save
still saves.

**Cosmetic (same PR):** with no HA areas defined the select today renders a one-entry
dropdown. Hide the field (or render the hint "No HA areas defined" in its place) when
`areasCache` is empty — an inventory without areas should not see area UI.

## Tests

Stage 1 pure-function specs: nested location + inherited area → `clear-tree` with correct
root and count; explicit pick from a child → `assign-root` naming the root; root-level
edits; single-node tree; no-change selection → `none`; cycle-guard input (helper already
guards; preview must not loop). Stage 2 component specs: preview text renders and updates
on select change; absent with no areas; select hidden when the registry is empty.

## Out of scope

- Any backend/contract change — `location/tree` keeps its shape.
- Item 37's history: the relabeled default option's wording (#126) stands; this adds the
  consequence line, it does not rename options again.

# Item 46 — effective-area preview in the location editor

Status: **delivered**, in `v0.2.0`. Tracker row: `open-items.md` item 46 (removed; the
resolution note carries the outcome; the prompt is retired from `v1_prompts.md`).

## The gap

The location editor's area `<select>` (in `hv-organize-dialog`) does more than it says:

- Picking an **explicit area** moves the assignment to the **tree root** and clears every
  node below it.
- Picking the **default option** clears the area from the **whole tree** — but only on a
  location that stores one. `Repository.update_location` compares the request against
  `loc.area_id`, so on a nested location, which stores nothing, the same pick is a no-op
  and the tree keeps its area. (This plan originally claimed the nested case cleared the
  tree; implementation found otherwise, and the shipped copy follows the code.)

Nothing in the dialog warns about either. The mechanics for a preview already exist:
item 38 built `effectiveAreaIdForLocation` (`ui/area.ts`) — the cycle-guarded client-side
walk over `locationsFlatCache` — so no contract change and no new plumbing is needed.
What is left is the design decision this plan makes.

## The design

One preview line directly under the select, restating the selected option as its real
whole-tree consequence *before* Save. Pure function first, render second.

**Stage 1 — `areaChangePreview` (pure, TDD-first).** In `ui/area.ts` (or a sibling):

```
areaChangePreview(locations, { id, parentId }, selectedAreaId | null)
  → { kind: 'none' | 'clear-tree' | 'assign-root',
      rootId, rootName, treeSize,           // locations in the affected tree
      effectiveAreaId, editsRoot }
```

`id` is null while a location is being created, and `parentId` is the parent **as picked
in the dialog**: the editor sends the re-parent and the area in one `location/update` and
the backend propagates after the move, so the area lands on the tree the save produces,
not the one on record.

- `none` — the selection equals the location's own stored area, so the backend does
  nothing. No consequence to state, but a nested location that inherits gets the one line
  the select cannot give it: "Inherits ⟨area⟩ from its location tree."
- `clear-tree` — a stored area given up: "Removes the area from the whole ⟨root name⟩
  tree, N locations."
- `assign-root` — explicit area picked: "Assigns ⟨area⟩ to the whole ⟨root name⟩ tree, N
  locations" — and when the edited location is not the root, "The area is stored on ⟨root
  name⟩, not on this one."
- A single-node tree (`treeSize === 1`) drops the tree phrasing — the plain reading is
  correct there and a warning would be noise.

**Stage 2 — render in `hv-organize-dialog`.** Muted helper-text line under the select,
using the shared `.hv-area-chip` treatment for the area name so the vocabulary matches
every other surface (item 38's R3). Updates live on select change. Wire copy exactly to
the preview `kind`s; no new dialogs, no confirmation step — the preview informs, Save
still saves.

**Cosmetic (same PR):** with no HA areas defined the select today renders a one-entry
dropdown. Hide the field when `areasCache` is empty — an inventory without areas should
not see area UI — and let the name field take the row it leaves.

## Tests

Stage 1 pure-function specs: explicit pick from a child → `assign-root` naming the root
with the tree counted; a root giving its area up → `clear-tree`; the inherit option on a
nested location → `none`; a selection equal to the stored area → `none`; a single-node
tree; a nested location that still stores an area after a re-parent → the true root; a
location being created, both under a parent and at the top level; a pending re-parent →
the new tree's root; cycle-guard input (the helper already guards; the preview must not
loop). Stage 2 component specs: preview text renders and updates on select change; silent
for a selection that changes nothing; the inherited area named; select and preview both
absent when the registry is empty.

## Out of scope

- Any backend/contract change — `location/tree` keeps its shape.
- Item 37's history: the relabeled default option's wording (#126) stands; this adds the
  consequence line, it does not rename options again.

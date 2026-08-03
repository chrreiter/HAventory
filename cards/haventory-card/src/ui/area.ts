import type { AreaRef, Location } from '../store/types';

/**
 * Resolving the HA area behind a location, the way the backend does.
 *
 * Items arrive with `effective_area_id` already resolved, so item-facing
 * surfaces only need the id-to-name half. Location-facing ones (pickers, filter
 * chips, tree grouping) have a location and must resolve the area themselves.
 */

/**
 * An area's display name, or the raw id when the area cache has no entry for it.
 *
 * A stale id still names something: HA can drop an area from its registry while
 * locations continue to reference it, and a blank there would read as "no area"
 * — the one thing it is not.
 */
export function areaNameById(
  areas: readonly AreaRef[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return areas.find((a) => a.id === id)?.name ?? id;
}

/**
 * The area a location belongs to: the first non-null `area_id` from the location
 * up through its ancestors.
 *
 * Mirrors the backend's own resolution. Assigning an area moves it to the root
 * of the location's tree and clears it from every node below, so a nested
 * location's area is never stored on the location itself.
 */
export function effectiveAreaIdForLocation(
  locations: readonly Location[],
  id: string | null,
): string | null {
  if (!id) return null;
  const byId = new Map(locations.map((l) => [l.id, l]));
  let cursor: string | null = id;
  // No honest walk visits more nodes than exist, so a longer one is a parent
  // cycle: bail out with no area rather than spinning.
  for (let step = 0; cursor !== null && step <= byId.size; step += 1) {
    const loc: Location | undefined = byId.get(cursor);
    if (!loc) return null;
    const area = loc.area_id ?? null;
    if (area !== null) return area;
    cursor = loc.parent_id;
  }
  return null;
}

/** What saving the location editor's area select would actually do. */
export interface AreaChangePreview {
  /**
   * `none` — the backend compares the selection against the location's own
   * stored area and does nothing when they match. `clear-tree` and
   * `assign-root` both rewrite every location in the tree.
   */
  kind: 'none' | 'clear-tree' | 'assign-root';
  /** Where the area is stored afterwards; null for a tree with no resolvable root. */
  rootId: string | null;
  rootName: string | null;
  /** Locations the save touches, the one being created included. */
  treeSize: number;
  /** The area the edited location resolves to once saved. */
  effectiveAreaId: string | null;
  /** Whether the edited location is itself the root holding the area. */
  editsRoot: boolean;
}

/** The location the editor is about to save, as its fields stand in the dialog. */
export interface EditedLocation {
  /** null while creating one, which stores no area yet. */
  id: string | null;
  /** The parent as picked, not as recorded: the editor saves both halves in one call. */
  parentId: string | null;
}

/**
 * The root of `start`'s tree, or null when the chain cannot be walked.
 *
 * Same reasoning as the area walk above: more steps than there are locations
 * means the parent chain cycles.
 */
function rootIdFor(parentOf: ReadonlyMap<string, string | null>, start: string): string | null {
  let cursor: string | null = start;
  let root: string | null = null;
  for (let step = 0; cursor !== null && step <= parentOf.size; step += 1) {
    if (!parentOf.has(cursor)) return null;
    root = cursor;
    cursor = parentOf.get(cursor) ?? null;
  }
  return cursor === null ? root : null;
}

/**
 * Locations under `rootId`, itself included. Walks down behind a visited set, so
 * a cycle in the data cannot make it count a node twice or loop.
 */
function subtreeSize(childrenOf: ReadonlyMap<string | null, string[]>, rootId: string): number {
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  for (let i = 0; i < queue.length; i += 1) {
    for (const child of childrenOf.get(queue[i]) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return seen.size;
}

/**
 * What the location editor's area select does on save.
 *
 * The select reads like a per-location field and is not one: an area belongs to
 * a whole location tree. Assigning one moves it to the tree's root and clears it
 * from every node below; clearing one empties the tree. Both consequences reach
 * locations that are nowhere on screen, which is what this describes.
 */
export function areaChangePreview(
  locations: readonly Location[],
  edited: EditedLocation,
  selectedAreaId: string | null,
): AreaChangePreview {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const parentOf = new Map<string, string | null>(locations.map((l) => [l.id, l.parent_id]));
  if (edited.id !== null) parentOf.set(edited.id, edited.parentId);

  const storedAreaId = edited.id !== null ? (byId.get(edited.id)?.area_id ?? null) : null;
  const kind =
    selectedAreaId === storedAreaId ? 'none' : selectedAreaId === null ? 'clear-tree' : 'assign-root';

  const childrenOf = new Map<string | null, string[]>();
  for (const [id, parentId] of parentOf) {
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(id);
    else childrenOf.set(parentId, [id]);
  }

  // A location being created has no id to walk from, so its parent anchors the
  // tree — and a top-level one anchors nothing, standing alone until it is saved.
  const anchor = edited.id ?? edited.parentId;
  const rootId = anchor === null ? null : rootIdFor(parentOf, anchor);
  const pending = edited.id === null ? 1 : 0;

  return {
    kind,
    rootId,
    rootName: rootId === null ? null : (byId.get(rootId)?.name ?? null),
    treeSize: rootId === null ? 1 : subtreeSize(childrenOf, rootId) + pending,
    // Clearing empties the tree; anything else leaves the location resolving to
    // the selection, or — with nothing selected and nothing to change — to
    // whatever the tree it is saved into already has.
    effectiveAreaId:
      kind === 'clear-tree'
        ? null
        : (selectedAreaId ?? effectiveAreaIdForLocation(locations, edited.parentId)),
    editsRoot: edited.id !== null && rootId === edited.id,
  };
}

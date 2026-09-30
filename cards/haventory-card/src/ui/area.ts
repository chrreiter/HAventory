import type { AreaRef, Location } from '../store/types';

/** Resolving the HA area behind a location, the way the backend does. */

/** An area's name, or the raw id for one HA dropped: a blank would read as "no area". */
export function areaNameById(
  areas: readonly AreaRef[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return areas.find((a) => a.id === id)?.name ?? id;
}

/** The first non-null `area_id` from the location up through its ancestors. */
export function effectiveAreaIdForLocation(
  locations: readonly Location[],
  id: string | null,
): string | null {
  if (!id) return null;
  const byId = new Map(locations.map((l) => [l.id, l]));
  let cursor: string | null = id;
  // A walk longer than the node count is a parent cycle.
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
  /** `none`: the selection matches the stored area. The others rewrite the whole tree. */
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

/** The root of `start`'s tree, or null when the chain is broken or cycles. */
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

/** Locations under `rootId`, itself included, each counted once. */
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
 * What the location editor's area select does on save. An area belongs to a
 * whole tree: assigning one moves it to the root, clearing one empties the tree.
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

  // A new location is anchored by its parent; a new top-level one stands alone.
  const anchor = edited.id ?? edited.parentId;
  const rootId = anchor === null ? null : rootIdFor(parentOf, anchor);
  const pending = edited.id === null ? 1 : 0;

  return {
    kind,
    rootId,
    rootName: rootId === null ? null : (byId.get(rootId)?.name ?? null),
    treeSize: rootId === null ? 1 : subtreeSize(childrenOf, rootId) + pending,
    // With nothing selected and nothing to change, the tree's existing area.
    effectiveAreaId:
      kind === 'clear-tree'
        ? null
        : (selectedAreaId ?? effectiveAreaIdForLocation(locations, edited.parentId)),
    editsRoot: edited.id !== null && rootId === edited.id,
  };
}

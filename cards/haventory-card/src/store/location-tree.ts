import { areaNameById } from '../ui/area';
import type { AreaRef, LocationTreeNode } from './types';

/**
 * `location/tree` returns nodes in the repository's own order, which is
 * effectively insertion order — a sidebar of 29 locations reads as
 * "Office, Basement, Garage, Workshop, Kitchen" and nothing can be found by
 * eye. The API makes no ordering promise, so presentation order is the card's
 * job.
 *
 * Sorted by name with `numeric` collation, so "Shelf 2" precedes "Shelf 10",
 * and tie-broken on id so equally-named siblings keep a stable order across
 * re-renders. Returns a new tree; the caller's nodes are untouched.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortLocationTree(nodes: readonly LocationTreeNode[]): LocationTreeNode[] {
  return [...nodes]
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id))
    .map((n) => (n.children?.length ? { ...n, children: sortLocationTree(n.children) } : n));
}

/**
 * Does this location match the substring filter the trees offer? Its name or
 * its display path, case-insensitively; an empty needle matches everything.
 *
 * Shared with `countLocations` so a "13 locations" tally can never disagree with
 * the rows the tree beneath it actually kept.
 */
export function locationMatches(node: LocationTreeNode, filterText: string): boolean {
  const needle = filterText.trim().toLowerCase();
  if (!needle) return true;
  return (
    node.name.toLowerCase().includes(needle) ||
    (node.path?.display_path ?? '').toLowerCase().includes(needle)
  );
}

/**
 * How many locations a tree holds, counting every depth, and only those matching
 * `filterText` when one is given.
 *
 * The sidebar and the organize dialog both put this number beside the word
 * "Locations", next to a count of categories and a count of tags — so it has to
 * mean the same thing they do: how many of that thing there is. Nested locations
 * are locations, so the roots alone would undercount.
 */
export function countLocations(nodes: readonly LocationTreeNode[], filterText = ''): number {
  return nodes.reduce(
    (sum, n) =>
      sum + (locationMatches(n, filterText) ? 1 : 0) + countLocations(n.children ?? [], filterText),
    0,
  );
}

/** Top-level locations that share one HA area, in the order they should render. */
export interface AreaGroup {
  id: string;
  /** The area's name, or its raw id when the area cache has no entry for it. */
  name: string;
  roots: LocationTreeNode[];
}

export interface GroupedRoots {
  areaGroups: AreaGroup[];
  /** Roots belonging to no area, in their incoming order. */
  ungrouped: LocationTreeNode[];
}

/**
 * Partition top-level locations by the area they belong to.
 *
 * Only roots are read: the backend keeps a tree's area on its root node and
 * resolves it downwards for every descendant, so a root's `area_id` is the whole
 * tree's area — and a nested node never holds one to disagree with.
 *
 * Groups are ordered by area name on the collator the rows themselves use, tied
 * on id so equally-named areas cannot swap places between renders. Returns new
 * arrays over the caller's nodes; nothing is mutated.
 */
export function groupRootsByArea(
  nodes: readonly LocationTreeNode[],
  areas: readonly AreaRef[],
): GroupedRoots {
  const byArea = new Map<string, LocationTreeNode[]>();
  const ungrouped: LocationTreeNode[] = [];

  for (const node of nodes) {
    const areaId = node.area_id ?? null;
    if (areaId === null) {
      ungrouped.push(node);
      continue;
    }
    const roots = byArea.get(areaId);
    if (roots) roots.push(node);
    else byArea.set(areaId, [node]);
  }

  const areaGroups = [...byArea.entries()]
    .map(([id, roots]) => ({ id, name: areaNameById(areas, id) ?? id, roots }))
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));

  return { areaGroups, ungrouped };
}

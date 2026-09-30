import { areaNameById } from '../ui/area';
import type { AreaRef, LocationTreeNode } from './types';

/**
 * `location/tree` promises no order, so the card sorts by name with numeric
 * collation ("Shelf 2" before "Shelf 10"), tie-broken on id for a stable order.
 * Returns a new tree.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortLocationTree(nodes: readonly LocationTreeNode[]): LocationTreeNode[] {
  return [...nodes]
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id))
    .map((n) => (n.children?.length ? { ...n, children: sortLocationTree(n.children) } : n));
}

/**
 * Whether a location's name or display path contains the filter text,
 * case-insensitively. Shared with `countLocations` so the tally matches the rows.
 */
export function locationMatches(node: LocationTreeNode, filterText: string): boolean {
  const needle = filterText.trim().toLowerCase();
  if (!needle) return true;
  return (
    node.name.toLowerCase().includes(needle) ||
    (node.path?.display_path ?? '').toLowerCase().includes(needle)
  );
}

/** How many locations a tree holds at every depth, matching `filterText` when given. */
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
 * Partition top-level locations by area, which only a root carries. Groups are
 * ordered by area name, tied on id.
 */
export function groupRootsByArea(
  nodes: readonly LocationTreeNode[],
  areas: readonly AreaRef[],
  opts: { includeEmptyAreas?: boolean } = {},
): GroupedRoots {
  const byArea = new Map<string, LocationTreeNode[]>();
  const ungrouped: LocationTreeNode[] = [];

  // A picker must offer areas holding nothing yet; browsing bands only those in use.
  if (opts.includeEmptyAreas) for (const area of areas) byArea.set(area.id, []);

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

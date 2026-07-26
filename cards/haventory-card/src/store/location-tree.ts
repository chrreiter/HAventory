import type { LocationTreeNode } from './types';

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
 * How many locations a tree holds, counting every depth.
 *
 * The sidebar and the organize dialog both put this number beside the word
 * "Locations", next to a count of categories and a count of tags — so it has to
 * mean the same thing they do: how many of that thing exists. Nested locations
 * are locations, so the roots alone would undercount.
 */
export function countLocations(nodes: readonly LocationTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countLocations(n.children ?? []), 0);
}

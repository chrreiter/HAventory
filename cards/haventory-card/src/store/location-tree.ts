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

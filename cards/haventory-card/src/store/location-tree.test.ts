import { countLocations, groupRootsByArea, locationMatches, sortLocationTree } from './location-tree';
import type { LocationTreeNode } from './types';

function node(name: string, children: LocationTreeNode[] = []): LocationTreeNode {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    parent_id: null,
    area_id: null,
    path: { id_path: [], name_path: [name], display_path: name, sort_key: name.toLowerCase() },
    direct_item_count: 0,
    subtree_item_count: 0,
    children,
  };
}

const names = (nodes: LocationTreeNode[]) => nodes.map((n) => n.name);

describe('sortLocationTree', () => {
  it('orders roots by name', () => {
    // The backend returns nodes in insertion order, which reads as random in a
    // sidebar: "Office, Basement, Garage, Workshop, Kitchen".
    const sorted = sortLocationTree([node('Office'), node('Basement'), node('Garage'), node('Kitchen')]);
    expect(names(sorted)).toEqual(['Basement', 'Garage', 'Kitchen', 'Office']);
  });

  it('orders children at every depth', () => {
    const sorted = sortLocationTree([
      node('Garage', [node('Shelf B'), node('Shelf A', [node('Bin 2'), node('Bin 1')])]),
    ]);
    expect(names(sorted[0].children)).toEqual(['Shelf A', 'Shelf B']);
    expect(names(sorted[0].children[0].children)).toEqual(['Bin 1', 'Bin 2']);
  });

  it('compares case-insensitively and keeps digits in human order', () => {
    expect(names(sortLocationTree([node('shelf 10'), node('Shelf 2'), node('SHELF 1')]))).toEqual([
      'SHELF 1',
      'Shelf 2',
      'shelf 10',
    ]);
  });

  it('breaks ties on id so the order never flickers between renders', () => {
    const a = { ...node('Garage'), id: 'b' };
    const b = { ...node('Garage'), id: 'a' };
    expect(sortLocationTree([a, b]).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const input = [node('Office'), node('Basement', [node('Z'), node('A')])];
    const before = JSON.stringify(input);
    sortLocationTree(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('handles an empty tree', () => {
    expect(sortLocationTree([])).toEqual([]);
  });
});

describe('countLocations', () => {
  it('counts every depth, not just the roots', () => {
    // The sidebar heading says "Locations 6" beside "Categories 11" — a number
    // that stopped at the roots would claim two.
    const tree = [node('Garage', [node('Shelf A', [node('Bin 1'), node('Bin 2')]), node('Shelf B')]), node('Kitchen')];
    expect(countLocations(tree)).toBe(6);
  });

  it('is zero for an empty inventory', () => {
    expect(countLocations([])).toBe(0);
  });

  it('counts only what a filter keeps, at any depth', () => {
    const tree = [node('Garage', [node('Shelf A'), node('Bin')]), node('Shelf B')];
    expect(countLocations(tree, 'shelf')).toBe(2);
    expect(countLocations(tree, '  ')).toBe(4);
    expect(countLocations(tree, 'nothing')).toBe(0);
  });

  it('matches the display path too, so a filter can name the parent', () => {
    const shelf: LocationTreeNode = {
      ...node('Shelf A'),
      path: { id_path: [], name_path: ['Garage', 'Shelf A'], display_path: 'Garage / Shelf A', sort_key: '' },
    };
    expect(locationMatches(shelf, 'garage')).toBe(true);
    expect(locationMatches(shelf, 'kitchen')).toBe(false);
  });

  it('survives nodes the backend sent without a children array', () => {
    const bare = { ...node('Garage') } as Partial<LocationTreeNode>;
    delete bare.children;
    expect(countLocations([bare as LocationTreeNode])).toBe(1);
  });
});

describe('groupRootsByArea', () => {
  const inArea = (name: string, areaId: string | null, children: LocationTreeNode[] = []) => ({
    ...node(name, children),
    area_id: areaId,
  });
  const AREAS = [
    { id: 'area-kitchen', name: 'Kitchen' },
    { id: 'area-garage', name: 'Garage' },
    { id: 'area-r10', name: 'Room 10' },
    { id: 'area-r2', name: 'Room 2' },
  ];

  it('collects the roots of each area and names the group', () => {
    const { areaGroups, ungrouped } = groupRootsByArea(
      [inArea('Fridge', 'area-kitchen'), inArea('Pantry', 'area-kitchen'), inArea('Workbench', 'area-garage')],
      AREAS,
    );
    expect(areaGroups.map((g) => [g.name, names(g.roots)])).toEqual([
      ['Garage', ['Workbench']],
      ['Kitchen', ['Fridge', 'Pantry']],
    ]);
    expect(ungrouped).toEqual([]);
  });

  it('orders groups by area name, digits in human order', () => {
    const grouped = groupRootsByArea([inArea('A', 'area-r10'), inArea('B', 'area-r2')], AREAS);
    expect(grouped.areaGroups.map((g) => g.name)).toEqual(['Room 2', 'Room 10']);
  });

  it('keeps roots with no area out of the groups, in the order they arrived', () => {
    const grouped = groupRootsByArea(
      [inArea('Attic', null), inArea('Fridge', 'area-kitchen'), inArea('Shed', null)],
      AREAS,
    );
    expect(names(grouped.areaGroups[0].roots)).toEqual(['Fridge']);
    expect(names(grouped.ungrouped)).toEqual(['Attic', 'Shed']);
  });

  it('has no groups at all for an inventory that assigns no areas', () => {
    const roots = [inArea('Office', null), inArea('Basement', null)];
    const grouped = groupRootsByArea(roots, AREAS);
    expect(grouped.areaGroups).toEqual([]);
    expect(grouped.ungrouped).toEqual(roots);
  });

  it('groups an area the cache does not know under its raw id', () => {
    const grouped = groupRootsByArea([inArea('Fridge', 'area-gone')], AREAS);
    expect(grouped.areaGroups.map((g) => [g.id, g.name])).toEqual([['area-gone', 'area-gone']]);
  });

  it('breaks ties on the area id so equally-named areas keep a stable order', () => {
    const dupes = [
      { id: 'area-b', name: 'Loft' },
      { id: 'area-a', name: 'Loft' },
    ];
    const grouped = groupRootsByArea([inArea('X', 'area-b'), inArea('Y', 'area-a')], dupes);
    expect(grouped.areaGroups.map((g) => g.id)).toEqual(['area-a', 'area-b']);
  });

  it('reads the area off the root only, since that is where the backend keeps it', () => {
    // A tree's area lives on its root and every descendant inherits it, so a
    // child carrying one would mean two groups for one tree.
    const child = inArea('Shelf', 'area-garage');
    const grouped = groupRootsByArea([inArea('Attic', null, [child])], AREAS);
    expect(grouped.areaGroups).toEqual([]);
    expect(names(grouped.ungrouped)).toEqual(['Attic']);
  });

  it('does not mutate the input', () => {
    const input = [inArea('Fridge', 'area-kitchen'), inArea('Attic', null)];
    const before = JSON.stringify(input);
    groupRootsByArea(input, AREAS);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('handles an empty tree', () => {
    expect(groupRootsByArea([], AREAS)).toEqual({ areaGroups: [], ungrouped: [] });
  });
});

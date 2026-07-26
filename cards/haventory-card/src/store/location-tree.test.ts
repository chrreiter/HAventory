import { countLocations, sortLocationTree } from './location-tree';
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

  it('survives nodes the backend sent without a children array', () => {
    const bare = { ...node('Garage') } as Partial<LocationTreeNode>;
    delete bare.children;
    expect(countLocations([bare as LocationTreeNode])).toBe(1);
  });
});

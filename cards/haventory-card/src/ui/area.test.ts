import { areaChangePreview, areaNameById, effectiveAreaIdForLocation } from './area';
import type { Location } from '../store/types';

function loc(id: string, parentId: string | null, areaId: string | null): Location {
  return {
    id,
    parent_id: parentId,
    name: id,
    area_id: areaId,
    path: { id_path: [], name_path: [id], display_path: id, sort_key: id },
  };
}

const AREAS = [
  { id: 'area-kitchen', name: 'Kitchen' },
  { id: 'area-garage', name: 'Garage' },
];

describe('areaNameById', () => {
  it('resolves a known area to its name', () => {
    expect(areaNameById(AREAS, 'area-kitchen')).toBe('Kitchen');
  });

  it('has no name to give when there is no area', () => {
    expect(areaNameById(AREAS, null)).toBe(null);
    expect(areaNameById(AREAS, undefined)).toBe(null);
    expect(areaNameById(AREAS, '')).toBe(null);
  });

  it('falls back to the raw id when the cache does not know it', () => {
    // HA can drop an area from its registry while locations still reference it;
    // the id says more than a blank does.
    expect(areaNameById(AREAS, 'area-removed')).toBe('area-removed');
    expect(areaNameById([], 'area-kitchen')).toBe('area-kitchen');
  });
});

describe('effectiveAreaIdForLocation', () => {
  it('takes the area off the location itself when it has one', () => {
    const locations = [loc('garage', null, 'area-garage')];
    expect(effectiveAreaIdForLocation(locations, 'garage')).toBe('area-garage');
  });

  it('inherits from the root, where the backend keeps a tree its area', () => {
    const locations = [
      loc('garage', null, 'area-garage'),
      loc('shelf', 'garage', null),
      loc('bin', 'shelf', null),
    ];
    expect(effectiveAreaIdForLocation(locations, 'bin')).toBe('area-garage');
  });

  it('stops at the nearest ancestor that names an area', () => {
    const locations = [
      loc('house', null, 'area-garage'),
      loc('kitchen', 'house', 'area-kitchen'),
      loc('drawer', 'kitchen', null),
    ];
    expect(effectiveAreaIdForLocation(locations, 'drawer')).toBe('area-kitchen');
  });

  it('resolves to nothing when no ancestor names an area', () => {
    const locations = [loc('garage', null, null), loc('shelf', 'garage', null)];
    expect(effectiveAreaIdForLocation(locations, 'shelf')).toBe(null);
  });

  it('resolves to nothing for no location at all', () => {
    expect(effectiveAreaIdForLocation([loc('garage', null, 'area-garage')], null)).toBe(null);
  });

  it('resolves to nothing for an id the location cache does not hold', () => {
    expect(effectiveAreaIdForLocation([loc('garage', null, 'area-garage')], 'ghost')).toBe(null);
  });

  it('gives up rather than looping when a parent chain cycles', () => {
    const locations = [loc('a', 'b', null), loc('b', 'a', null)];
    expect(effectiveAreaIdForLocation(locations, 'a')).toBe(null);
  });

  it('gives up when the chain leaves the cache part way up', () => {
    const locations = [loc('shelf', 'missing-parent', null)];
    expect(effectiveAreaIdForLocation(locations, 'shelf')).toBe(null);
  });
});

describe('areaChangePreview', () => {
  // Garage is the root and the only node storing an area; Shelf and Bin inherit it.
  const TREE = [
    loc('garage', null, 'area-garage'),
    loc('shelf', 'garage', null),
    loc('bin', 'shelf', null),
    loc('attic', null, null),
  ];

  it('assigns to the tree root when an area is picked on a nested location', () => {
    const preview = areaChangePreview(TREE, { id: 'bin', parentId: 'shelf' }, 'area-kitchen');
    expect(preview.kind).toBe('assign-root');
    expect(preview.rootId).toBe('garage');
    expect(preview.rootName).toBe('garage');
    expect(preview.treeSize).toBe(3);
    expect(preview.editsRoot).toBe(false);
    expect(preview.effectiveAreaId).toBe('area-kitchen');
  });

  it('knows the edited location is itself the root the area lands on', () => {
    const preview = areaChangePreview(TREE, { id: 'garage', parentId: null }, 'area-kitchen');
    expect(preview.kind).toBe('assign-root');
    expect(preview.editsRoot).toBe(true);
    expect(preview.treeSize).toBe(3);
  });

  it('clears the whole tree when the root gives its area up', () => {
    const preview = areaChangePreview(TREE, { id: 'garage', parentId: null }, null);
    expect(preview.kind).toBe('clear-tree');
    expect(preview.rootId).toBe('garage');
    expect(preview.treeSize).toBe(3);
    expect(preview.effectiveAreaId).toBe(null);
  });

  it('changes nothing when a nested location picks the inherit option', () => {
    // The backend compares against the location's own stored area, which is null
    // all the way down a tree, so this save is a no-op rather than a tree-wide clear.
    const preview = areaChangePreview(TREE, { id: 'bin', parentId: 'shelf' }, null);
    expect(preview.kind).toBe('none');
    expect(preview.effectiveAreaId).toBe('area-garage');
  });

  it('changes nothing when the selection is the area already stored', () => {
    const preview = areaChangePreview(TREE, { id: 'garage', parentId: null }, 'area-garage');
    expect(preview.kind).toBe('none');
    expect(preview.effectiveAreaId).toBe('area-garage');
  });

  it('reports a one-location tree as one location', () => {
    const preview = areaChangePreview(TREE, { id: 'attic', parentId: null }, 'area-kitchen');
    expect(preview.kind).toBe('assign-root');
    expect(preview.rootId).toBe('attic');
    expect(preview.treeSize).toBe(1);
    expect(preview.editsRoot).toBe(true);
  });

  it('names the true root when a nested location still stores an area of its own', () => {
    // Re-parenting a root leaves its stored area on a node that is no longer one,
    // so the root has to be walked to rather than assumed to be the edited node.
    const moved = [
      loc('house', null, null),
      loc('garage', 'house', 'area-garage'),
      loc('shelf', 'garage', null),
    ];
    const preview = areaChangePreview(moved, { id: 'garage', parentId: 'house' }, null);
    expect(preview.kind).toBe('clear-tree');
    expect(preview.rootId).toBe('house');
    expect(preview.treeSize).toBe(3);
  });

  it('counts the location being created into the tree it joins', () => {
    const preview = areaChangePreview(TREE, { id: null, parentId: 'shelf' }, 'area-kitchen');
    expect(preview.kind).toBe('assign-root');
    expect(preview.rootId).toBe('garage');
    expect(preview.treeSize).toBe(4);
    expect(preview.editsRoot).toBe(false);
  });

  it('treats a location created at the top level as a tree of its own', () => {
    const preview = areaChangePreview(TREE, { id: null, parentId: null }, 'area-kitchen');
    expect(preview.kind).toBe('assign-root');
    expect(preview.rootId).toBe(null);
    expect(preview.treeSize).toBe(1);
  });

  it('creating without an area changes nothing and inherits from the new parent', () => {
    const preview = areaChangePreview(TREE, { id: null, parentId: 'shelf' }, null);
    expect(preview.kind).toBe('none');
    expect(preview.effectiveAreaId).toBe('area-garage');
  });

  it('follows the parent the editor is about to save, not the one on record', () => {
    // Both halves of the edit go out in one `location/update`, and the backend
    // propagates the area after the move — so the preview belongs to the new tree.
    const preview = areaChangePreview(TREE, { id: 'shelf', parentId: 'attic' }, 'area-kitchen');
    expect(preview.rootId).toBe('attic');
    // Shelf brings Bin with it, and Attic was alone.
    expect(preview.treeSize).toBe(3);
  });

  it('gives up rather than looping when a parent chain cycles', () => {
    const cyclic = [loc('a', 'b', null), loc('b', 'a', null)];
    const preview = areaChangePreview(cyclic, { id: 'a', parentId: 'b' }, 'area-kitchen');
    expect(preview.rootId).toBe(null);
    expect(preview.rootName).toBe(null);
    expect(preview.treeSize).toBe(1);
  });

  it('gives up when the edited location is not in the cache at all', () => {
    const preview = areaChangePreview(TREE, { id: 'ghost', parentId: 'nowhere' }, 'area-kitchen');
    expect(preview.kind).toBe('assign-root');
    expect(preview.rootId).toBe(null);
    expect(preview.treeSize).toBe(1);
  });
});

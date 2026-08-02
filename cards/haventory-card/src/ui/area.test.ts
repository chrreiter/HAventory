import { areaNameById, effectiveAreaIdForLocation } from './area';
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

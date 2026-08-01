import { render } from 'lit';
import {
  itemPathParts,
  locationLabel,
  locationPathParts,
  pathTitle,
  prettyPath,
  renderAreaChip,
} from './location-path';
import { makeItem } from '../test.utils';
import type { Location } from '../store/types';

const AREAS = [
  { id: 'area-kitchen', name: 'Kitchen' },
  { id: 'area-garage', name: 'Garage' },
];

function loc(id: string, parentId: string | null, areaId: string | null, displayPath = id): Location {
  return {
    id,
    parent_id: parentId,
    name: id,
    area_id: areaId,
    path: { id_path: [], name_path: [], display_path: displayPath, sort_key: displayPath.toLowerCase() },
  };
}

describe('prettyPath / locationLabel', () => {
  it('renders the stored separator the way every surface writes it', () => {
    expect(prettyPath('Garage / Shelf A')).toBe('Garage › Shelf A');
  });

  it('names a location by its full path, and falls back when there is none', () => {
    expect(locationLabel(loc('shelf', 'garage', null, 'Garage / Shelf A'), 'Any location')).toBe(
      'Garage › Shelf A',
    );
    expect(locationLabel(null, 'Any location')).toBe('Any location');
  });
});

describe('itemPathParts', () => {
  it('reads the area the backend already resolved for the item', () => {
    const parts = itemPathParts(
      makeItem({
        effective_area_id: 'area-kitchen',
        location_path: { id_path: [], name_path: [], display_path: 'Fridge / Top Shelf', sort_key: '' },
      }),
      AREAS,
    );
    expect(parts).toEqual({ areaName: 'Kitchen', path: 'Fridge › Top Shelf' });
  });

  it('has no area for an item whose tree names none', () => {
    expect(itemPathParts(makeItem({ effective_area_id: null }), AREAS).areaName).toBe(null);
  });

  it('has no area when the payload omits the field entirely', () => {
    expect(itemPathParts(makeItem({}), AREAS).areaName).toBe(null);
  });

  it('shows an unknown area id rather than dropping it', () => {
    expect(itemPathParts(makeItem({ effective_area_id: 'area-gone' }), AREAS).areaName).toBe('area-gone');
  });

  it('leaves the path empty for an item filed nowhere, so callers keep their own wording', () => {
    const parts = itemPathParts(makeItem({ location_id: null }), AREAS);
    expect(parts).toEqual({ areaName: null, path: '' });
  });
});

describe('locationPathParts', () => {
  const locations = [
    loc('garage', null, 'area-garage', 'Garage'),
    loc('shelf', 'garage', null, 'Garage / Shelf A'),
  ];

  it('walks up to the area the location inherits', () => {
    expect(locationPathParts(locations[1], locations, AREAS, 'Any location')).toEqual({
      areaName: 'Garage',
      path: 'Garage › Shelf A',
    });
  });

  it('falls back like a bare label when no location is selected', () => {
    expect(locationPathParts(null, locations, AREAS, 'Any location')).toEqual({
      areaName: null,
      path: 'Any location',
    });
  });

  it('has no area when nothing in the tree names one', () => {
    const arealess = [loc('office', null, null, 'Office')];
    expect(locationPathParts(arealess[0], arealess, AREAS, 'Any location').areaName).toBe(null);
  });
});

describe('pathTitle', () => {
  it('names the area ahead of the path', () => {
    expect(pathTitle({ areaName: 'Kitchen', path: 'Fridge › Top Shelf' })).toBe(
      'Area: Kitchen · Fridge › Top Shelf',
    );
  });

  it('is just the path when there is no area', () => {
    expect(pathTitle({ areaName: null, path: 'Fridge › Top Shelf' })).toBe('Fridge › Top Shelf');
  });

  it('is just the area when there is no path', () => {
    expect(pathTitle({ areaName: 'Kitchen', path: '' })).toBe('Area: Kitchen');
  });

  it('is empty when there is neither', () => {
    expect(pathTitle({ areaName: null, path: '' })).toBe('');
  });
});

describe('renderAreaChip', () => {
  function chipOf(areaName: string | null) {
    const host = document.createElement('div');
    render(renderAreaChip(areaName), host);
    return host.querySelector('.hv-area-chip');
  }

  it('marks the area with the shared chip treatment and the home glyph', () => {
    const chip = chipOf('Kitchen');
    expect(chip).not.toBe(null);
    expect(chip?.querySelector('svg')?.getAttribute('data-icon')).toBe('home');
    expect(chip?.textContent).toContain('Kitchen');
  });

  it('says "Area" to a screen reader, which cannot see the glyph', () => {
    expect(chipOf('Kitchen')?.querySelector('.hv-sr-only')?.textContent).toContain('Area');
  });

  it('renders nothing when the location resolves to no area', () => {
    expect(chipOf(null)).toBe(null);
  });
});

import { render } from 'lit';
import {
  areaMarkName,
  elideMobilePath,
  elidePath,
  itemPathParts,
  locationLabel,
  locationPathParts,
  pathLabel,
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

// The pair a surface picks between: the title keeps the pairing whole because
// it is the fallback for everything the label elides, and the label drops the
// area once the path has opened with it.
describe('pathLabel', () => {
  it('drops an area the path opens with, where the title keeps it', () => {
    const parts = { areaName: 'Kitchen', path: 'Kitchen › Pantry' };
    expect(pathLabel(parts)).toBe('Kitchen › Pantry');
    expect(pathTitle(parts)).toBe('Area: Kitchen · Kitchen › Pantry');
  });

  it('reads exactly as the title when the two names differ', () => {
    const parts = { areaName: 'Kitchen', path: 'Fridge › Top Shelf' };
    expect(pathLabel(parts)).toBe(pathTitle(parts));
  });

  it('is just the path when there is no area', () => {
    expect(pathLabel({ areaName: null, path: 'Fridge' })).toBe('Fridge');
  });
});

describe('elidePath', () => {
  it('leaves a path that already fits alone', () => {
    expect(elidePath('Garage')).toBe('Garage');
    expect(elidePath('Garage › Shelf A')).toBe('Garage › Shelf A');
  });

  // The leaf is the whole point: it is the segment that says where the item
  // actually is, and right-clipping was dropping exactly that.
  it('drops the middle rather than the leaf', () => {
    expect(elidePath('Workshop › Parts Cabinet › Drawer A › Small Bin')).toBe('Workshop › … › Small Bin');
  });

  // A phone row has ~200px for this line, and three real segments plus a
  // category needs well over that, so three has to elide as well.
  it('elides at three segments, not just at four', () => {
    expect(elidePath('Workshop › Parts Cabinet › Drawer A')).toBe('Workshop › … › Drawer A');
  });

  it('keeps both ends however deep the tree gets', () => {
    expect(elidePath('A › B › C › D › E › F')).toBe('A › … › F');
  });

  it('handles an item with no location at all', () => {
    expect(elidePath('')).toBe('');
  });
});

describe('elideMobilePath', () => {
  // The area still has to travel through the elision as the leading segment, or
  // a deep path would drop it; what comes back is the same line with the area
  // separated out for the row to mark instead of punctuate.
  it('keeps the room and the bin, and hands the room back on its own', () => {
    expect(elideMobilePath('Garage', 'Workshop › Parts Cabinet › Drawer A › Small Bin')).toEqual({
      area: 'Garage',
      rest: '… › Small Bin',
    });
  });

  it('leaves a path that fits alone, area and all', () => {
    expect(elideMobilePath('Garage', 'Shelf A')).toEqual({ area: 'Garage', rest: 'Shelf A' });
  });

  it('gives back exactly what elidePath does when there is no area', () => {
    const path = 'Workshop › Parts Cabinet › Drawer A › Small Bin';
    expect(elideMobilePath(null, path)).toEqual({ area: null, rest: elidePath(path) });
  });

  // An area name carrying the separator lands as two segments, so the elided
  // string no longer starts with it and there is nothing safe to mark. The line
  // then reads as it always did — the wrong words marked would be worse.
  it('marks nothing when the area name is itself split by the separator', () => {
    const result = elideMobilePath('Kitchen › Pantry', 'Shelf A › Box 2');
    expect(result.area).toBe(null);
    expect(result.rest).toBe(elidePath('Kitchen › Pantry › Shelf A › Box 2'));
  });

  it('marks an area that has no path under it', () => {
    expect(elideMobilePath('Garage', '')).toEqual({ area: 'Garage', rest: '' });
  });
});

describe('areaMarkName', () => {
  it('keeps an area the path does not already name', () => {
    expect(areaMarkName('Garage', 'Workshop › Drawer A')).toBe('Garage');
  });

  it('drops an area the path opens with', () => {
    expect(areaMarkName('Küche', 'Küche')).toBe(null);
    expect(areaMarkName('Küche', 'Küche › Oberstes Fach')).toBe(null);
  });

  // Only the first segment counts: a deeper segment of the same name is a
  // different place inside the area, and the mark still says which area.
  it('only compares the first segment', () => {
    expect(areaMarkName('Küche', 'Keller › Küche')).toBe('Küche');
  });

  it('has nothing to drop when there is no area', () => {
    expect(areaMarkName(null, 'Küche')).toBe(null);
  });

  // The rule reads the path as the surfaces write it, so it has to split on the
  // separator `prettyPath` produces rather than on the stored one.
  it('compares against the path as it is written for display', () => {
    expect(areaMarkName('Küche', prettyPath('Küche / Oberstes Fach'))).toBe(null);
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

  // A household names its areas in Home Assistant, so the name can outrun the
  // box the chip lands in. The wrapper is what the shared rule in ui/chip.ts
  // elides — without it text-overflow has nothing to act on inside an
  // inline-flex chip, and the name paints over whatever sits to its right.
  it('wraps the name so it can elide inside a narrow box', () => {
    const label = chipOf('Ground Floor Utility Room')?.querySelector('.hv-chip-text');
    expect(label?.textContent).toBe('Ground Floor Utility Room');
    // The glyph and the screen-reader word stay outside it: eliding those
    // would drop the half of the chip that costs nothing to keep.
    expect(label?.querySelector('svg')).toBe(null);
    expect(label?.querySelector('.hv-sr-only')).toBe(null);
  });

  it('renders nothing when the location resolves to no area', () => {
    expect(chipOf(null)).toBe(null);
  });
});

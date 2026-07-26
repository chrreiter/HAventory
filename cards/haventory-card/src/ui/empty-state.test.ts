import { emptyStateCopy } from './empty-state';
import type { EmptyKind } from './empty-state';

const KINDS: EmptyKind[] = ['no-items', 'no-matches', 'empty-location', 'connection-lost'];

describe('emptyStateCopy', () => {
  it('always offers a way out', () => {
    // The expanded view's table used to answer "No items match these filters."
    // with nothing to press, on the one surface where over-filtering is easiest.
    for (const kind of KINDS) {
      expect(emptyStateCopy(kind).offers.length, kind).toBeGreaterThan(0);
    }
  });

  it('keeps headlines as fragments and detail lines as sentences', () => {
    for (const kind of KINDS) {
      const copy = emptyStateCopy(kind);
      expect(copy.headline.endsWith('.'), `${kind} headline`).toBe(false);
      if (copy.detail) expect(copy.detail.endsWith('.'), `${kind} detail`).toBe(true);
    }
  });

  it('names the location it found empty', () => {
    expect(emptyStateCopy('empty-location', 'Garage').headline).toBe('Nothing in Garage');
    expect(emptyStateCopy('empty-location', null).headline).toBe('Nothing in this location');
  });

  it('leads with clearing the filters when nothing matched', () => {
    expect(emptyStateCopy('no-matches').offers[0]).toEqual({ id: 'clear-filters', label: 'Clear all' });
  });

  it('offers a restore beside the first item on an untouched inventory', () => {
    expect(emptyStateCopy('no-items').offers.map((o) => o.id)).toEqual(['add-item', 'import']);
  });
});

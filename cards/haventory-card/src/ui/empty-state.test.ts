import { emptyKindFor, emptyStateCopy } from './empty-state';
import { defaultFilters } from '../store/store';
import type { EmptyKind } from './empty-state';
import type { StoreFilters } from '../store/types';

/** The kinds that say the list has settled with nothing in it. */
const ANSWERS: EmptyKind[] = ['no-items', 'no-matches', 'empty-location', 'connection-lost'];
const KINDS: EmptyKind[] = ['loading', ...ANSWERS];

function state(patch: { connectionLost?: boolean; loading?: boolean; filters?: Partial<StoreFilters> }) {
  return {
    degraded: { connectionLost: patch.connectionLost ?? false },
    loading: patch.loading ?? false,
    filters: { ...defaultFilters(), ...patch.filters },
  };
}

describe('emptyStateCopy', () => {
  it('always offers a way out', () => {
    // "No items match these filters." with nothing to press is not an answer,
    // least of all on the surface where over-filtering is easiest.
    for (const kind of ANSWERS) {
      expect(emptyStateCopy(kind).offers.length, kind).toBeGreaterThan(0);
    }
  });

  it('offers nothing while the rows are still coming', () => {
    // Every offer answers a question this one has not asked yet: clearing the
    // filters would undo a fetch that has not reported, and "add your first
    // item" claims a count nobody has.
    expect(emptyStateCopy('loading').offers).toEqual([]);
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

describe('emptyKindFor', () => {
  it('names the filter-derived reasons once the list has settled', () => {
    expect(emptyKindFor(state({}))).toBe('no-items');
    expect(emptyKindFor(state({ filters: { q: 'glue' } }))).toBe('no-matches');
    expect(emptyKindFor(state({ filters: { locationIds: ['loc-1'] } }))).toBe('empty-location');
  });

  it('says the rows are on their way rather than blaming the filters', () => {
    // Changing a filter empties the list and refills it when the answer
    // arrives. Naming the filters during that gap accuses one of matching
    // nothing before anything has been counted.
    expect(emptyKindFor(state({ loading: true, filters: { q: 'glue' } }))).toBe('loading');
    expect(emptyKindFor(state({ loading: true, filters: { locationIds: ['loc-1'] } }))).toBe('loading');
    expect(emptyKindFor(state({ loading: true }))).toBe('loading');
  });

  it('still leads with the outage, which no fetch is going to survive', () => {
    expect(emptyKindFor(state({ connectionLost: true, loading: true }))).toBe('connection-lost');
    expect(emptyKindFor(state({ connectionLost: true, loading: true, filters: { q: 'glue' } }))).toBe(
      'connection-lost',
    );
  });

  it('reads a store that has not answered at all as no items', () => {
    expect(emptyKindFor(null)).toBe('no-items');
    expect(emptyKindFor(undefined)).toBe('no-items');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { Store } from './store';
import { makeMockHass, makeItem } from '../test.utils';

/**
 * The facet lists and the per-location counts beside them: what the card asks
 * for, what it prices against the active filter, and which answer is allowed to
 * land when two requests overlap. A value the user names before any item
 * carries it is a draft, and rides the same lists.
 */

/** Stores under test never wait on real backoff. */
const fast = { retryBaseMs: 0 };

describe('Store', () => {
  it('caches distinct categories and tags with counts on init', async () => {
    const items = [
      makeItem({ id: '1', category: 'Tools', tags: ['red'] }),
      makeItem({ id: '2', category: 'Tools', tags: ['red', 'blue'] }),
      makeItem({ id: '3', category: 'Books', tags: ['blue'] }),
    ];
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();

    const distinct = store.state.value.distinctValuesCache;
    expect(distinct).toBeTruthy();
    expect(distinct!.categories).toEqual([
      { value: 'Books', count: 1 },
      { value: 'Tools', count: 2 },
    ]);
    expect(distinct!.tags).toEqual([
      { value: 'blue', count: 2 },
      { value: 'red', count: 2 },
    ]);
  });

  it('refreshes distinct values after an item is created', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();
    expect(store.state.value.distinctValuesCache?.categories).toEqual([]);

    await store.createItem({ name: 'Drill', category: 'Tools' });
    // The items subscription event triggers a distinct-values refresh.
    hass.__emit('items', 'created', {
      item: makeItem({ id: '99', name: 'Drill', category: 'Tools' }),
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Tools', count: 1 },
    ]);
  });

  // A category or tag exists only through the items carrying it — the backend
  // has no registry to create an empty one in. A value the user names up front
  // is therefore kept on the card until an item adopts it.
  it('lists a newly named category alongside the ones in use, at zero', async () => {
    const store = new Store(makeMockHass({ items: [makeItem({ id: '1', category: 'Tools' })] }), fast);
    await store.init();

    expect(store.addDraftValue('category', 'Consumables')).toBe(true);
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Consumables', count: 0 },
      { value: 'Tools', count: 1 },
    ]);
  });

  it('normalizes a new tag the way the backend would', async () => {
    const store = new Store(makeMockHass({ items: [] }), fast);
    await store.init();

    store.addDraftValue('tag', '  Power Tools  ');
    expect(store.state.value.distinctValuesCache?.tags).toEqual([{ value: 'power tools', count: 0 }]);
  });

  it('refuses a name that already exists, whatever its casing', async () => {
    const store = new Store(makeMockHass({ items: [makeItem({ id: '1', category: 'Tools' })] }), fast);
    await store.init();

    expect(store.addDraftValue('category', 'tools')).toBe(false);
    expect(store.addDraftValue('category', '   ')).toBe(false);
    expect(store.state.value.distinctValuesCache?.categories).toEqual([{ value: 'Tools', count: 1 }]);
  });

  it('stops carrying the draft once an item actually uses it', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();
    store.addDraftValue('category', 'Consumables');

    await store.createItem({ name: 'Sponges', category: 'Consumables' });
    hass.__emit('items', 'created', {
      item: makeItem({ id: '99', name: 'Sponges', category: 'Consumables' }),
    });
    await new Promise((r) => setTimeout(r, 0));

    // One entry, with the server's count — not a duplicate sitting at zero.
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Consumables', count: 1 },
    ]);
  });

  it('discards a draft again', async () => {
    const store = new Store(makeMockHass({ items: [] }), fast);
    await store.init();
    store.addDraftValue('tag', 'seasonal');
    store.removeDraftValue('tag', 'seasonal');

    expect(store.state.value.distinctValuesCache?.tags).toEqual([]);
  });

  it('asks for unpriced facets while nothing is filtering', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', category: 'Tools', tags: ['red'] })] });
    const store = new Store(hass, fast);
    await store.init();

    const sent = hass.__messages.filter((m) => m.type === 'haventory/distinct_values');
    expect(sent).toHaveLength(1);
    expect(sent[0].filter).toBeUndefined();
    // No key at all rather than a matching_count equal to count: the two say
    // different things, and only one of them is a report.
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Tools', count: 1 },
    ]);
  });

  it('prices the facets against the active filter, minus category and tags', async () => {
    const items = [
      makeItem({ id: '1', category: 'Tools', tags: ['red'], checked_out: true }),
      makeItem({ id: '2', category: 'Tools', tags: ['red'] }),
      makeItem({ id: '3', category: 'Books', tags: ['blue'] }),
    ];
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();

    // A category and a tag are picked alongside the narrowing filter; neither
    // may reach the wire, or every other row would be priced at zero.
    store.setFilters({ checkedOutOnly: true, categories: ['Tools'], tags: ['red'] });
    await vi.waitUntil(
      () => hass.__messages.filter((m) => m.type === 'haventory/distinct_values').length > 1,
    );

    const sent = hass.__messages.filter((m) => m.type === 'haventory/distinct_values');
    const filter = sent[sent.length - 1].filter as Record<string, unknown>;
    expect(filter.checked_out).toBe(true);
    expect(filter.category).toBeUndefined();
    expect(filter.tags_any).toBeUndefined();

    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Books', count: 1, matching_count: 0 },
      { value: 'Tools', count: 2, matching_count: 1 },
    ]);
  });

  // The commonest filter of all is a category or a tag on its own. Gating the
  // pair on what survives `facetCountFilters` left exactly that case mixed:
  // location rows reading "8 / 37" beside category rows reading "43".
  it('prices every list when the only filter is one the facets drop', async () => {
    const items = [
      makeItem({ id: '1', category: 'Tools', tags: ['red'] }),
      makeItem({ id: '2', category: 'Books', tags: ['blue'] }),
    ];
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();

    store.setFilters({ categories: ['Tools'] });
    await vi.waitUntil(
      () => store.state.value.distinctValuesCache?.categories[0]?.matching_count !== undefined,
    );

    // Nothing else is narrowing, so every row prices at n / n — true, and the
    // same shape the location rows are showing at that moment.
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Books', count: 1, matching_count: 1 },
      { value: 'Tools', count: 1, matching_count: 1 },
    ]);

    const sent = hass.__messages.filter((m) => m.type === 'haventory/distinct_values');
    expect(sent[sent.length - 1].filter).toBeDefined();
  });

  // The same asymmetry the other way round: a lone location filter must not
  // leave the tree bare while the facet lists beside it carry a pair.
  it('prices the tree when the only filter is the one it drops', async () => {
    const hass = makeMockHass({
      items: [makeItem({ id: '1', location_id: 'garage' })],
      locations: [
        {
          id: 'garage',
          name: 'Garage',
          parent_id: null,
          area_id: null,
          path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
        },
      ],
    });
    const store = new Store(hass, fast);
    await store.init();

    store.setFilters({ locationIds: ['garage'] });
    await vi.waitUntil(() => store.state.value.locationTreeCache?.[0]?.matching_subtree_count !== undefined);

    expect(store.state.value.locationTreeCache?.[0].matching_subtree_count).toBe(1);
    expect(store.state.value.locationMatchTotal).toBe(1);
  });

  it('coalesces the facet refetch across a burst of filter patches', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', category: 'Tools' })] });
    const store = new Store(hass, fast);
    await store.init();
    const before = hass.__messages.filter((m) => m.type === 'haventory/distinct_values').length;

    // What a filter panel does: several keys in a row, one answer wanted.
    // The coalescing window is a 250 ms debounce, so the test drives that clock
    // rather than out-waiting it: installed here, after init, so the setup above
    // keeps running on real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      store.setFilters({ checkedOutOnly: true });
      store.setFilters({ lowStockOnly: true });
      store.setFilters({ q: 'drill' });

      // Nothing has been asked yet on the last millisecond of the window...
      await vi.advanceTimersByTimeAsync(249);
      const facetCalls = () =>
        hass.__messages.filter((m) => m.type === 'haventory/distinct_values').length;
      expect(facetCalls()).toBe(before);

      // ...and the three patches then produce exactly one answer, with nothing
      // trailing behind it.
      await vi.advanceTimersByTimeAsync(1);
      expect(facetCalls()).toBe(before + 1);
      await vi.advanceTimersByTimeAsync(300);
      expect(facetCalls()).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Not every facet refetch is debounced — an item event lands
  // beside a filter change — so two can be in flight at once, and the response
  // that lands last is not the one that was issued last. The newest request is
  // the only one allowed to assign.
  it('drops a facet response from a superseded request', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', category: 'Fresh' })] });
    const store = new Store(hass, fast);
    await store.init();

    const original = hass.callWS.bind(hass);
    let release: (() => void) | null = null;
    let intercepted = false;
    hass.callWS = (async (msg: Record<string, unknown>) => {
      if (String(msg.type) === 'haventory/distinct_values' && !intercepted) {
        intercepted = true;
        // The older request: answer late, with data the inventory no longer holds.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { categories: [{ value: 'Stale', count: 9 }], tags: [], custom_field_keys: [] };
      }
      return original(msg);
    }) as typeof hass.callWS;

    const first = store.refreshDistinctValues();
    const second = store.refreshDistinctValues();
    await second;
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Fresh', count: 1 },
    ]);

    await vi.waitUntil(() => release !== null);
    release!();
    await first;
    // The late answer belongs to a superseded request and must not land.
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Fresh', count: 1 },
    ]);
  });

  // The per-location counts ride the tree, so it has the same overlap and gets
  // the same guard.
  it('drops a tree response from a superseded refetch', async () => {
    const garage = {
      id: 'garage',
      name: 'Garage',
      parent_id: null,
      area_id: null,
      path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
    };
    const hass = makeMockHass({ items: [], locations: [garage] });
    const store = new Store(hass, fast);
    await store.init();

    const original = hass.callWS.bind(hass);
    let release: (() => void) | null = null;
    let intercepted = false;
    hass.callWS = (async (msg: Record<string, unknown>) => {
      if (String(msg.type) === 'haventory/location/tree' && !intercepted) {
        intercepted = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [
          {
            id: 'stale',
            name: 'Stale',
            parent_id: null,
            area_id: null,
            path: { id_path: ['stale'], name_path: ['Stale'], display_path: 'Stale', sort_key: 'stale' },
            direct_item_count: 0,
            subtree_item_count: 0,
            children: [],
          },
        ];
      }
      return original(msg);
    }) as typeof hass.callWS;

    const first = store.refreshLocationTree();
    const second = store.refreshLocationTree();
    await second;
    expect(store.state.value.locationTreeCache?.map((n) => n.name)).toEqual(['Garage']);

    await vi.waitUntil(() => release !== null);
    release!();
    await first;
    expect(store.state.value.locationTreeCache?.map((n) => n.name)).toEqual(['Garage']);
  });

  it('gives a draft the priced shape once the server priced the rest', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', category: 'Tools', checked_out: true })] });
    const store = new Store(hass, fast);
    await store.init();

    store.setFilters({ checkedOutOnly: true });
    await vi.waitUntil(
      () => hass.__messages.filter((m) => m.type === 'haventory/distinct_values').length > 1,
    );
    store.addDraftValue('category', 'Consumables');

    // A draft has no items, so it matches nothing — said in the same shape the
    // priced rows use, rather than reading as an unpriced row among them.
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Consumables', count: 0, matching_count: 0 },
      { value: 'Tools', count: 1, matching_count: 1 },
    ]);
  });
});

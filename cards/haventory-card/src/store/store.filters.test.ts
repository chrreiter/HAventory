import { describe, it, expect, vi } from 'vitest';
import { makeMockHass, makeItem } from '../test.utils';
import { Store, activeFilterCount, defaultFilters, toWireFilter } from './store';

/**
 * What a filter is on the wire, what it counts as active, and what changing one
 * does to the loaded page: the list restarts, the rows already on screen stay
 * until the answer lands, and the order the backend sorted by holds end to end.
 */

/** Stores under test never wait on real backoff. */
const fast = { retryBaseMs: 0 };

/** Let queued microtasks and any zero-delay timers run. */
async function flush(rounds = 1): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('toWireFilter', () => {
  it('sends include_subtree explicitly', () => {
    // The list filter defaults it to false server-side while subscribe defaults
    // it to true, so it must never be left off.
    expect(toWireFilter(defaultFilters()).include_subtree).toBe(true);
    expect(toWireFilter({ ...defaultFilters(), includeSubtree: false }).include_subtree).toBe(false);
  });

  it('maps the complete filter set', () => {
    const wire = toWireFilter({
      ...defaultFilters(),
      q: 'screws',
      areaId: 'area-1',
      locationIds: ['loc-1'],
      checkedOutOnly: true,
      lowStockOnly: true,
      lowStockFirst: true,
      orphansOnly: true,
      overdueOnly: true,
      inspectionDueOnly: true,
      status: 'missing',
      categories: ['Hardware'],
      updatedAfter: '2026-07-01T00:00:00Z',
      createdAfter: '2026-01-01T00:00:00Z',
      updatedBefore: '2026-08-01T00:00:00Z',
      createdBefore: '2026-02-01T00:00:00Z',
    });
    expect(wire).toMatchObject({
      q: 'screws',
      area_id: 'area-1',
      location_ids: ['loc-1'],
      checked_out: true,
      low_stock_only: true,
      low_stock_first: true,
      orphaned_only: true,
      overdue_only: true,
      inspection_due_only: true,
      status: 'missing',
      categories: ['Hardware'],
      updated_after: '2026-07-01T00:00:00Z',
      created_after: '2026-01-01T00:00:00Z',
      updated_before: '2026-08-01T00:00:00Z',
      created_before: '2026-02-01T00:00:00Z',
    });
  });

  // The plural keys only: sending both spellings would let the two disagree,
  // and the backend unions them rather than intersecting.
  it('sends the multi-select keys and never their scalars', () => {
    const wire = toWireFilter({
      ...defaultFilters(),
      categories: ['Tools', 'Books'],
      locationIds: ['loc-1', 'loc-2'],
    });
    expect(wire.categories).toEqual(['Tools', 'Books']);
    expect(wire.location_ids).toEqual(['loc-1', 'loc-2']);
    expect(wire.category).toBeUndefined();
    expect(wire.location_id).toBeUndefined();

    // An empty selection is not a filter, so neither key goes on the wire.
    const clean = toWireFilter(defaultFilters());
    expect(clean.categories).toBeUndefined();
    expect(clean.location_ids).toBeUndefined();
  });

  it('leaves the before-bounds off when they are unset', () => {
    const wire = toWireFilter(defaultFilters());
    expect(wire.updated_before).toBeUndefined();
    expect(wire.created_before).toBeUndefined();
    expect(wire.overdue_only).toBeUndefined();
    expect(wire.inspection_overdue_only).toBeUndefined();
    expect(wire.status).toBeUndefined();
  });

  it('keeps low-stock-only and low-stock-first independent', () => {
    const onlyFilter = toWireFilter({ ...defaultFilters(), lowStockOnly: true });
    expect(onlyFilter.low_stock_only).toBe(true);
    expect(onlyFilter.low_stock_first).toBeUndefined();

    const onlyOrder = toWireFilter({ ...defaultFilters(), lowStockFirst: true });
    expect(onlyOrder.low_stock_only).toBeUndefined();
    expect(onlyOrder.low_stock_first).toBe(true);
  });

  it('routes tags through any/all per the mode toggle', () => {
    const any = toWireFilter({ ...defaultFilters(), tags: ['metric', 'm4'], tagsMode: 'any' });
    expect(any.tags_any).toEqual(['metric', 'm4']);
    expect(any.tags_all).toBeUndefined();

    const all = toWireFilter({ ...defaultFilters(), tags: ['metric', 'm4'], tagsMode: 'all' });
    expect(all.tags_all).toEqual(['metric', 'm4']);
    expect(all.tags_any).toBeUndefined();

    expect(toWireFilter(defaultFilters()).tags_any).toBeUndefined();
  });
});

describe('activeFilterCount', () => {
  it('counts nothing for a clean slate and one per narrowing control', () => {
    expect(activeFilterCount(defaultFilters())).toBe(0);
    expect(activeFilterCount({ ...defaultFilters(), q: 'x', categories: ['Tools'] })).toBe(2);
    // A multi-select counts once however many values it names, the way tags do.
    expect(activeFilterCount({ ...defaultFilters(), categories: ['a', 'b'] })).toBe(1);
    expect(activeFilterCount({ ...defaultFilters(), locationIds: ['x', 'y', 'z'] })).toBe(1);
    // Tags count once regardless of how many are selected.
    expect(activeFilterCount({ ...defaultFilters(), tags: ['a', 'b', 'c'] })).toBe(1);
  });

  it('ignores sort, which is not a filter', () => {
    expect(activeFilterCount({ ...defaultFilters(), sort: { field: 'name', order: 'asc' } })).toBe(0);
  });

  it('counts a status selection as one filter', () => {
    expect(activeFilterCount({ ...defaultFilters(), status: 'needs_repair' })).toBe(1);
    // OK narrows too — most of the inventory is ok, but not all of it need be.
    expect(activeFilterCount({ ...defaultFilters(), status: 'ok' })).toBe(1);
  });

  it('counts each date bound and the overdue toggle', () => {
    expect(activeFilterCount({ ...defaultFilters(), overdueOnly: true })).toBe(1);
    // The two date filters answer different questions, so they narrow twice.
    expect(
      activeFilterCount({ ...defaultFilters(), overdueOnly: true, inspectionDueOnly: true }),
    ).toBe(2);
    // A window is two separate bounds, each separately clearable.
    expect(
      activeFilterCount({
        ...defaultFilters(),
        updatedAfter: '2026-07-01T00:00:00Z',
        updatedBefore: '2026-08-01T00:00:00Z',
      }),
    ).toBe(2);
  });
});

describe('Store: filtered total and loading', () => {
  it('keeps the filtered total from the list response', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}`, name: `Item ${i}` }));
    const store = new Store(makeMockHass({ items }), fast);
    await store.init();

    // 50 loaded of 60 matching.
    expect(store.state.value.items).toHaveLength(50);
    expect(store.state.value.total).toBe(60);
    expect(store.state.value.loading).toBe(false);
  });

  it('starts in a loading state so the card can show skeletons', () => {
    const store = new Store(makeMockHass({ items: [] }), fast);
    expect(store.state.value.loading).toBe(true);
    expect(store.state.value.total).toBe(null);
  });

  it('prices a filter without applying it', async () => {
    const items = [
      makeItem({ id: '1', name: 'Wood Glue', category: 'Adhesives' }),
      makeItem({ id: '2', name: 'M4 Screws', category: 'Hardware' }),
      makeItem({ id: '3', name: 'Cable Ties', category: 'Hardware' }),
    ];
    const store = new Store(makeMockHass({ items }), fast);
    await store.init();

    const count = await store.countMatching({ ...defaultFilters(), categories: ['Hardware'] });
    expect(count).toBe(2);
    // The staged filter must not have touched the applied one.
    expect(store.state.value.filters.categories).toEqual([]);
    expect(store.state.value.items).toHaveLength(3);
  });

  it('reports null rather than throwing when the count probe fails', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();
    hass.__failNext(1);
    expect(await store.countMatching(defaultFilters())).toBe(null);
  });
});

describe('Store', () => {
  it('debounces search and lists items; prefetch at ~70%', async () => {
    const items = Array.from({ length: 80 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();
    expect(store.state.value.items.length).toBeGreaterThan(0);
    // First page default 50
    expect(store.state.value.items.length).toBe(50);
    await store.prefetchIfNeeded(0.69);
    expect(store.state.value.items.length).toBe(50);
    await store.prefetchIfNeeded(0.71);
    expect(store.state.value.items.length).toBe(80);
  });

  it('handles filter changes and restarts paging', async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();

    const initialCount = store.state.value.items.length;
    expect(initialCount).toBe(30);

    store.setFilters({ q: 'search term' });
    expect(store.state.value.filters.q).toBe('search term');
    expect(store.state.value.cursor).toBe(null);
  });

  // Blanking the list here is what tore the card's scroller down mid-edit and
  // took the open editor with it. The refetch replaces the rows when it lands.
  it('keeps the loaded rows and the total while a filter refetch is in flight', async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();
    const before = store.state.value.items;
    const total = store.state.value.total;
    expect(total).toBe(3);

    store.setFilters({ q: 'Item 1' });
    expect(store.state.value.items).toBe(before);
    expect(store.state.value.total).toBe(total);
    expect(store.state.value.loading).toBe(true);

    await flush(2);
    expect(store.state.value.loading).toBe(false);
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Item 1']);
  });

  it('sends orphaned_only to the backend when the orphans filter is on', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    const listFilters: any[] = [];
    const origCallWS = hass.callWS.bind(hass);
    hass.callWS = async <T,>(msg: Record<string, unknown>): Promise<T> => {
      if (msg.type === 'haventory/item/list') listFilters.push(msg.filter);
      return origCallWS<T>(msg);
    };

    store.setFilters({ orphansOnly: true });
    await flush(2);
    expect(listFilters.length).toBeGreaterThan(0);
    expect(listFilters[listFilters.length - 1]?.orphaned_only).toBe(true);

    store.setFilters({ orphansOnly: false });
    await flush(2);
    expect(listFilters[listFilters.length - 1]?.orphaned_only).toBeUndefined();
  });

  it('orphans filter narrows the visible items end-to-end through the mock', async () => {
    const placed = makeItem({
      id: 'p1', name: 'Placed', location_id: 'loc1',
      location_path: { id_path: ['loc1'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
    });
    const orphan = makeItem({ id: 'o1', name: 'Orphan' });
    const hass = makeMockHass({ items: [placed, orphan] });
    const store = new Store(hass, fast);
    await store.init();
    expect(store.state.value.items.length).toBe(2);

    store.setFilters({ orphansOnly: true });
    await flush(2);
    expect(store.state.value.items.map((i) => i.id)).toEqual(['o1']);

    store.setFilters({ orphansOnly: false });
    await flush(2);
    expect(store.state.value.items.length).toBe(2);
  });

  it('q filter narrows the visible items end-to-end through the mock', async () => {
    const a = makeItem({ id: 'a', name: 'Electric Saw' });
    const b = makeItem({ id: 'b', name: 'Glue', tags: ['adhesive'] });
    const hass = makeMockHass({ items: [a, b] });
    const store = new Store(hass, fast);
    await store.init();

    store.setFilters({ q: 'saw' });
    await flush(2);
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Electric Saw']);

    // Tags are searchable too
    store.setFilters({ q: 'adhesive' });
    await flush(2);
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Glue']);
  });

  it('due_date sort orders items through the mock, undated last in both orders', async () => {
    const early = makeItem({ id: 'e', name: 'Early', checked_out: true, due_date: '2024-01-01' });
    const late = makeItem({ id: 'l', name: 'Late', checked_out: true, due_date: '2024-03-01' });
    const undated = makeItem({ id: 'u', name: 'Undated' });
    const hass = makeMockHass({ items: [undated, late, early] });
    const store = new Store(hass, fast);
    await store.init();

    store.setFilters({ sort: { field: 'due_date', order: 'asc' } });
    await flush(2);
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Early', 'Late', 'Undated']);

    store.setFilters({ sort: { field: 'due_date', order: 'desc' } });
    await flush(2);
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Late', 'Early', 'Undated']);
  });

  // The Location column's header is a sort control now, so the whole round trip
  // — field on the wire, ordered page back — has to hold end to end.
  it('lists items ordered by their location path, unlocated last', async () => {
    const path = (display: string, ids: string[]) => ({
      id_path: ids,
      name_path: display.split(' / '),
      display_path: display,
      sort_key: display.toLowerCase(),
    });
    const items = [
      makeItem({ id: '1', name: 'Deep', location_id: 'shelf', location_path: path('Garage / Shelf A', ['garage', 'shelf']) }),
      makeItem({ id: '2', name: 'Loose' }),
      makeItem({ id: '3', name: 'Elsewhere', location_id: 'cellar', location_path: path('Cellar', ['cellar']) }),
      makeItem({ id: '4', name: 'Shallow', location_id: 'garage', location_path: path('Garage', ['garage']) }),
    ];
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();

    store.setFilters({ sort: { field: 'location', order: 'asc' } });
    await vi.waitUntil(() => store.state.value.items[0]?.name === 'Elsewhere');
    expect(store.state.value.items.map((i) => i.name)).toEqual([
      'Elsewhere',
      'Shallow',
      'Deep',
      'Loose',
    ]);

    // Reversed, the located items flip and the unlocated one stays at the end.
    store.setFilters({ sort: { field: 'location', order: 'desc' } });
    await vi.waitUntil(() => store.state.value.items[0]?.name === 'Deep');
    expect(store.state.value.items.map((i) => i.name)).toEqual([
      'Deep',
      'Shallow',
      'Elsewhere',
      'Loose',
    ]);

    const sent = hass.__messages.filter((m) => m.type === 'haventory/item/list');
    expect(sent[sent.length - 1].sort).toEqual({ field: 'location', order: 'desc' });
  });
});

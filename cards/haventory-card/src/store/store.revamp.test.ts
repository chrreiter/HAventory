import { makeMockHass, makeItem } from '../test.utils';
import {
  BULK_CHUNK_SIZE,
  Store,
  activeFilterCount,
  defaultFilters,
  makeBulkOp,
  toWireFilter,
} from './store';
import type { Location } from './types';

function loc(id: string, name: string, parentId: string | null = null): Location {
  const displayPath = parentId ? `${parentId} / ${name}` : name;
  return {
    id,
    name,
    parent_id: parentId,
    area_id: null,
    path: {
      id_path: parentId ? [parentId, id] : [id],
      name_path: parentId ? [parentId, name] : [name],
      display_path: displayPath,
      sort_key: displayPath.toLowerCase(),
    },
  };
}

/** Stores under test never wait on real backoff. */
const fast = { retryBaseMs: 0 };

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
      locationId: 'loc-1',
      checkedOutOnly: true,
      lowStockOnly: true,
      lowStockFirst: true,
      orphansOnly: true,
      category: 'Hardware',
      updatedAfter: '2026-07-01T00:00:00Z',
      createdAfter: '2026-01-01T00:00:00Z',
    });
    expect(wire).toMatchObject({
      q: 'screws',
      area_id: 'area-1',
      location_id: 'loc-1',
      checked_out: true,
      low_stock_only: true,
      low_stock_first: true,
      orphaned_only: true,
      category: 'Hardware',
      updated_after: '2026-07-01T00:00:00Z',
      created_after: '2026-01-01T00:00:00Z',
    });
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
    expect(activeFilterCount({ ...defaultFilters(), q: 'x', category: 'Tools' })).toBe(2);
    // Tags count once regardless of how many are selected.
    expect(activeFilterCount({ ...defaultFilters(), tags: ['a', 'b', 'c'] })).toBe(1);
  });

  it('ignores sort, which is not a filter', () => {
    expect(activeFilterCount({ ...defaultFilters(), sort: { field: 'name', order: 'asc' } })).toBe(0);
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

    const count = await store.countMatching({ ...defaultFilters(), category: 'Hardware' });
    expect(count).toBe(2);
    // The staged filter must not have touched the applied one.
    expect(store.state.value.filters.category).toBe(null);
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

describe('Store: selection', () => {
  const items = [makeItem({ id: '1' }), makeItem({ id: '2' }), makeItem({ id: '3' })];

  it('toggles, replaces and clears', async () => {
    const store = new Store(makeMockHass({ items }), fast);
    await store.init();

    store.toggleSelected('1');
    store.toggleSelected('2');
    expect([...store.state.value.selection].sort()).toEqual(['1', '2']);

    store.toggleSelected('1');
    expect([...store.state.value.selection]).toEqual(['2']);

    store.setSelected(['3']);
    expect([...store.state.value.selection]).toEqual(['3']);

    store.clearSelection();
    expect(store.state.value.selection.size).toBe(0);
  });

  it('publishes a new Set so subscribers see the change', async () => {
    const store = new Store(makeMockHass({ items }), fast);
    await store.init();
    const before = store.state.value.selection;
    store.toggleSelected('1');
    expect(store.state.value.selection).not.toBe(before);
  });

  it('select-all covers loaded rows only, and load-all extends it', async () => {
    const many = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const store = new Store(makeMockHass({ items: many }), fast);
    await store.init();

    store.selectAllLoaded();
    expect(store.state.value.selection.size).toBe(50);
    expect(store.state.value.total).toBe(60);

    await store.loadAllThenSelectAll();
    expect(store.state.value.selection.size).toBe(60);
  });

  it('drops the selection when the filter changes', async () => {
    const store = new Store(makeMockHass({ items }), fast);
    await store.init();
    store.selectAllLoaded();
    expect(store.state.value.selection.size).toBe(3);

    store.setFilters({ q: 'nothing' });
    expect(store.state.value.selection.size).toBe(0);
  });
});

describe('Store: bulk operations', () => {
  const three = [
    makeItem({ id: '1', name: 'A', quantity: 5 }),
    makeItem({ id: '2', name: 'B', quantity: 5 }),
    makeItem({ id: '3', name: 'C', quantity: 5 }),
  ];

  it('applies every successful op and reports the items back', async () => {
    const store = new Store(makeMockHass({ items: three }), fast);
    await store.init();

    const outcome = await store.bulkExecute(
      three.map((i) => makeBulkOp('item_adjust_quantity', { item_id: i.id, delta: 2 })),
    );

    expect(outcome.failed).toEqual([]);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.succeeded.map((i) => i.quantity)).toEqual([7, 7, 7]);
    // The list reflects the batch without waiting for events.
    expect(store.state.value.items.map((i) => i.quantity)).toEqual([7, 7, 7]);
  });

  it('separates the failures and names the row each belongs to', async () => {
    const store = new Store(makeMockHass({ items: three }), fast);
    await store.init();

    const outcome = await store.bulkExecute([
      makeBulkOp('item_adjust_quantity', { item_id: '1', delta: 1 }),
      makeBulkOp('item_adjust_quantity', { item_id: 'ghost', delta: 1 }),
      makeBulkOp('item_adjust_quantity', { item_id: '3', delta: 1 }),
    ]);

    expect(outcome.succeeded).toHaveLength(2);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].itemId).toBe('ghost');
    expect(outcome.failed[0].error.code).toBe('not_found');
  });

  it('gives every operation a unique op_id so results cannot collapse', () => {
    const a = makeBulkOp('item_check_in', { item_id: '1' });
    const b = makeBulkOp('item_check_in', { item_id: '1' });
    expect(a.op_id).not.toBe(b.op_id);
  });

  it('chunks the work and reports determinate progress', async () => {
    const many = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}`, quantity: 1 }));
    const hass = makeMockHass({ items: many });
    const store = new Store(hass, fast);
    await store.init();
    await store.loadAllPages();

    const progress: [number, number][] = [];
    await store.bulkExecute(
      many.map((i) => makeBulkOp('item_adjust_quantity', { item_id: i.id, delta: 1 })),
      { chunkSize: 25, onProgress: (done, total) => progress.push([done, total]) },
    );

    expect(progress).toEqual([
      [25, 60],
      [50, 60],
      [60, 60],
    ]);
    expect(hass.__calls.filter((c) => c === 'haventory/items/bulk')).toHaveLength(3);
  });

  it('defaults to the documented chunk size', async () => {
    const many = Array.from({ length: BULK_CHUNK_SIZE + 1 }, (_, i) => makeItem({ id: `i${i}` }));
    const hass = makeMockHass({ items: many });
    const store = new Store(hass, fast);
    await store.init();

    await store.bulkExecute(many.map((i) => makeBulkOp('item_check_in', { item_id: i.id })));
    expect(hass.__calls.filter((c) => c === 'haventory/items/bulk')).toHaveLength(2);
  });

  it('stops between chunks when cancelled, keeping what already ran', async () => {
    const many = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}`, quantity: 1 }));
    const store = new Store(makeMockHass({ items: many }), fast);
    await store.init();
    await store.loadAllPages();

    let chunks = 0;
    const outcome = await store.bulkExecute(
      many.map((i) => makeBulkOp('item_adjust_quantity', { item_id: i.id, delta: 1 })),
      {
        chunkSize: 25,
        onProgress: () => {
          chunks += 1;
        },
        isCancelled: () => chunks >= 1,
      },
    );

    expect(outcome.cancelled).toBe(true);
    // The first chunk completed and is not rolled back — this is not a transaction.
    expect(outcome.succeeded).toHaveLength(25);
  });

  it('attributes a whole-call failure to every op in the chunk', async () => {
    const hass = makeMockHass({ items: three });
    const store = new Store(hass, fast);
    await store.init();
    hass.__failNext(1, { code: 'storage_error', message: 'disk full' });

    const outcome = await store.bulkExecute(
      three.map((i) => makeBulkOp('item_check_in', { item_id: i.id })),
    );

    expect(outcome.succeeded).toEqual([]);
    expect(outcome.failed).toHaveLength(3);
    expect(outcome.failed.every((f) => f.error.code === 'storage_error')).toBe(true);
  });

  it('removes successfully deleted rows from the list', async () => {
    const store = new Store(makeMockHass({ items: three }), fast);
    await store.init();

    await store.bulkExecute([
      makeBulkOp('item_delete', { item_id: '1' }),
      makeBulkOp('item_delete', { item_id: '2' }),
    ]);

    expect(store.state.value.items.map((i) => i.id)).toEqual(['3']);
  });
});

describe('Store: rate limiting and degraded state', () => {
  it('absorbs a rate_limited command by retrying', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', quantity: 5 })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__rateLimitNext(2);
    await store.adjustQuantity('1', 1);

    // Third attempt succeeded, so no error reached the user.
    expect(store.state.value.errorQueue).toEqual([]);
    expect(store.state.value.items[0].quantity).toBe(6);
    // ...but the card knows it is being throttled.
    expect(store.state.value.degraded.rateLimited).toBe(true);
  });

  it('gives up and reports after exhausting the retries', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', quantity: 5 })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__rateLimitNext(99);
    await store.adjustQuantity('1', 1);

    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['rate_limited']);
    // Optimistic value rolled back.
    expect(store.state.value.items[0].quantity).toBe(5);
  });

  it('goes degraded when the subscription itself is refused', async () => {
    const hass = makeMockHass({ items: [] });
    hass.__failSubscribe({ code: 'rate_limited', message: 'rate limit exceeded; retry later' });
    const store = new Store(hass, fast);

    await store.init();
    await Promise.resolve();
    await Promise.resolve();

    // Live updates are gone; the card must stop claiming it is connected.
    expect(store.state.value.degraded.rateLimited).toBe(true);
    expect(store.state.value.connected.items).toBe(false);
  });

  it('declares the connection lost after consecutive transport failures', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(2, new Error('socket closed'));
    await store.refreshStats().catch(() => undefined);
    expect(store.state.value.degraded.connectionLost).toBe(false); // one failure is not an outage
    await store.refreshStats().catch(() => undefined);
    expect(store.state.value.degraded.connectionLost).toBe(true);
  });

  it('does not treat a domain error as an outage', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(3, { code: 'validation_error', message: 'nope' });
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);

    expect(store.state.value.degraded.connectionLost).toBe(false);
  });

  it('clears the degraded flags on an explicit refresh', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(2, new Error('socket closed'));
    await store.refreshStats().catch(() => undefined);
    await store.refreshStats().catch(() => undefined);
    expect(store.state.value.degraded.connectionLost).toBe(true);

    await store.refreshAll();
    expect(store.state.value.degraded.connectionLost).toBe(false);
    expect(store.state.value.degraded.rateLimited).toBe(false);
  });
});

describe('Store: location tree and diagnostics data', () => {
  it('exposes tree nodes with per-location counts', async () => {
    const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage')];
    const items = [
      makeItem({ id: '1', location_id: 'garage' }),
      makeItem({ id: '2', location_id: 'shelf-a' }),
      makeItem({ id: '3', location_id: 'shelf-a' }),
    ];
    const store = new Store(makeMockHass({ items, locations }), fast);
    await store.init();

    const tree = store.state.value.locationTreeCache!;
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('garage');
    expect(tree[0].direct_item_count).toBe(1);
    expect(tree[0].subtree_item_count).toBe(3);
    expect(tree[0].children[0].id).toBe('shelf-a');
    expect(tree[0].children[0].subtree_item_count).toBe(2);
  });

  it('caches the rate-limit block and the integration version for diagnostics', async () => {
    const hass = makeMockHass({ items: [] });
    hass.__setHealth({ rate_limit: { enabled: true, dropped_commands: 7, dropped_events: 23 } });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.healthCache?.rate_limit).toEqual({
      enabled: true,
      dropped_commands: 7,
      dropped_events: 23,
    });
    expect(store.state.value.versionInfo?.integration_version).toBe('0.0.1');
  });
});

describe('Store: export scopes', () => {
  it('exports everything by default and the active filter on request', async () => {
    const items = [
      makeItem({ id: '1', name: 'Wood Glue', category: 'Adhesives' }),
      makeItem({ id: '2', name: 'M4 Screws', category: 'Hardware' }),
    ];
    const hass = makeMockHass({ items });
    const calls: unknown[] = [];
    const originalCallWS = hass.callWS.bind(hass);
    hass.callWS = async <T,>(msg: Record<string, unknown>): Promise<T> => {
      if (msg.type === 'haventory/export') calls.push(msg.filter ?? null);
      return originalCallWS<T>(msg);
    };

    const store = new Store(hass, fast);
    await store.init();
    store.setFilters({ category: 'Hardware' });

    await store.exportDocument();
    await store.exportDocument('view');

    expect(calls[0]).toBe(null);
    expect((calls[1] as { category?: string }).category).toBe('Hardware');
  });
});

describe('Store: import reload signalling', () => {
  it('flags a reload while re-listing after an import replaced the dataset', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    const seen: boolean[] = [];
    store.state.onChange(() => seen.push(store.state.value.degraded.reloading));

    hass.__emit('items', 'reloaded', {});
    await new Promise((r) => setTimeout(r, 5));

    // It went up and came back down; nothing is left stuck.
    expect(seen).toContain(true);
    expect(store.state.value.degraded.reloading).toBe(false);
  });
});

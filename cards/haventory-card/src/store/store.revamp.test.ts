import { makeMockHass, makeItem } from '../test.utils';
import {
  BULK_CHUNK_SIZE,
  Store,
  activeFilterCount,
  defaultFilters,
  makeBulkOp,
  subscribeRetryDelayMs,
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


/** Let queued microtasks and any zero-delay timers run. */
async function flush(rounds = 1): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Drain the microtasks a rejected `subscribeMessage` promise takes to reach the
 * store, without letting a scheduled re-subscribe fire.
 */
async function settleSubscribes(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

describe('Store: the backend going away and coming back', () => {
  const UNAVAILABLE = { code: 'storage_error', message: 'repository not initialized; run integration setup' };

  /** What a config-entry teardown puts on every open subscription. */
  function tearDown(hass: ReturnType<typeof makeMockHass>) {
    hass.__emit('items', 'unavailable', {});
    hass.__emit('locations', 'unavailable', {});
    hass.__emit('stats', 'unavailable', {});
  }

  it('re-opens the subscriptions a reload took away', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();
    expect(hass.__subscribeCalls).toHaveLength(4);

    tearDown(hass);
    await flush(3);

    // One more round, and live updates are back without the user touching
    // anything — a reload must not cost a manual refresh.
    expect(hass.__subscribeCalls).toHaveLength(8);
    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.degraded.liveUpdatesReason).toBeNull();
    expect(store.state.value.connected.items).toBe(true);
    expect(store.state.value.errorQueue).toEqual([]);
    hass.__emit('items', 'created', { item: makeItem({ id: '9' }) });
    expect(store.state.value.items.map((i) => i.id)).toContain('9');
  });

  it('waits out the window in which the backend is still refusing', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    // Setup has not finished, so the first two re-subscribe rounds are refused
    // exactly the way a command is during a reload.
    hass.__failSubscribeNext(6, UNAVAILABLE);
    tearDown(hass);
    await settleSubscribes();
    expect(store.state.value.degraded.liveUpdates).toBe('retrying');
    expect(store.state.value.degraded.liveUpdatesReason).toBe('unavailable');

    await flush(6);

    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.degraded.liveUpdatesReason).toBeNull();
    // Nothing reached the user: waiting out a reload is not an error.
    expect(store.state.value.errorQueue).toEqual([]);
  });

  it('re-reads the inventory once the backend answers again', async () => {
    // A backend that went away and came back re-read its store, and every event
    // in between went to a subscription that no longer existed.
    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'Before' })] });
    const store = new Store(hass, fast);
    await store.init();
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Before']);

    hass.__setItems([makeItem({ id: '2', name: 'After' })]);
    tearDown(hass);
    await flush(4);

    expect(store.state.value.items.map((i) => i.name)).toEqual(['After']);
  });

  it('gives up once the budget is spent, and says what stopped', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    // Disabled or removed rather than reloading: nothing is coming back.
    hass.__failSubscribe(UNAVAILABLE);
    tearDown(hass);
    await flush(20);

    expect(store.state.value.degraded.liveUpdates).toBe('paused');
    expect(store.state.value.degraded.liveUpdatesReason).toBe('unavailable');
    expect(store.state.value.degraded.nextLiveRetryAt).toBeNull();
    expect(store.state.value.connected.items).toBe(false);
    // Reported once, when retrying is over — not on every attempt.
    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['storage_error']);
    // The first round from init plus a bounded seven, four topics each.
    expect(hass.__subscribeCalls).toHaveLength(32);

    // The budget stays spent until something restarts it.
    await flush(6);
    expect(hass.__subscribeCalls).toHaveLength(32);
  });

  it('treats one teardown as one outage, however many topics report it', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    // All four topics carry the same signal; four re-subscribe rounds for one
    // reload would triple the load on a backend that is still starting up.
    tearDown(hass);
    await flush(3);

    expect(hass.__subscribeCalls).toHaveLength(8);
  });

  it('starts a fresh budget for a second teardown', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    tearDown(hass);
    await flush(3);
    expect(store.state.value.degraded.liveUpdates).toBe('live');

    // A dashboard open for days sees more than one reload; the second must not
    // inherit an exhausted budget from the first.
    hass.__failSubscribeNext(3, UNAVAILABLE);
    tearDown(hass);
    await flush(4);

    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.errorQueue).toEqual([]);
  });
});

describe('subscribeRetryDelayMs', () => {
  it('prefers the envelope hint over the backoff, in either unit', () => {
    expect(subscribeRetryDelayMs({ data: { retry_after_ms: 250 } }, 0, 400)).toBe(250);
    // Seconds, the HTTP Retry-After convention.
    expect(subscribeRetryDelayMs({ data: { retry_after: 2 } }, 0, 400)).toBe(2000);
    // The card's own error entries name the bag `context`.
    expect(subscribeRetryDelayMs({ context: { retry_after_ms: 30 } }, 3, 400)).toBe(30);
  });

  it('backs off exponentially when the envelope carries no hint', () => {
    const delays = [0, 1, 2, 3].map((attempt) => subscribeRetryDelayMs({}, attempt, 400));
    expect(delays).toEqual([400, 800, 1600, 3200]);
  });

  it('clamps a hint that would park live updates for hours', () => {
    expect(subscribeRetryDelayMs({ data: { retry_after: 86_400 } }, 0, 400)).toBe(30_000);
  });

  it('ignores a hint that is not a usable number', () => {
    expect(subscribeRetryDelayMs({ data: { retry_after_ms: 'soon' } }, 0, 400)).toBe(400);
    expect(subscribeRetryDelayMs({ data: { retry_after: -5 } }, 0, 400)).toBe(400);
    expect(subscribeRetryDelayMs({ data: { retry_after: Number.NaN } }, 1, 400)).toBe(800);
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
  });

  it('does not count the taxonomy catch-all toward an outage', async () => {
    // `unknown_error` is the backend's own answer to a command it could not
    // carry out. It travelled the socket to get here, so it proves the transport
    // works — reporting it as an outage would blame the connection for a fault
    // that is entirely server-side.
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(3, { code: 'unknown_error', message: 'boom' });
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);

    expect(store.state.value.degraded.connectionLost).toBe(false);
    expect(store.state.value.errorQueue.map((e) => e.message)).toEqual(['boom', 'boom', 'boom']);
  });

  it('names a transport failure rather than borrowing the catch-all', async () => {
    // Home Assistant rejects a call the socket never carried with a wrapper of
    // its own: no top-level code, no message a person could read. Reported
    // verbatim it says "Unknown error", which reads as a fault in what the user
    // just did rather than in the connection.
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(1, { type: 'result', success: false, error: { code: 3, message: 'Connection lost' } });
    await store.adjustQuantity('1', 1);

    expect(store.state.value.errorQueue).toHaveLength(1);
    expect(store.state.value.errorQueue[0].code).toBe('connection_lost');
    expect(store.state.value.errorQueue[0].message).toContain('Could not reach Home Assistant');
  });

  it('queues one entry for an outage however many calls fail', async () => {
    // An outage fails everything in flight and everything tried next. Stacking
    // one banner per call buries the rest of the queue under copies of a
    // sentence the user has already read.
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(4, new Error('socket closed'));
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);
    await store.refreshStats().catch(() => undefined);
    await store.refreshHealth().catch(() => undefined);

    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['connection_lost']);
    expect(store.state.value.degraded.connectionLost).toBe(true);

    // Dismissing it is not a permanent silence: the next failure says so again.
    store.dismissError(store.state.value.errorQueue[0].id);
    hass.__failNext(1, new Error('socket closed'));
    await store.adjustQuantity('1', 1);
    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['connection_lost']);
  });
});

describe('Store: subscription lifecycle', () => {
  it('replaces subscriptions rather than stacking them', async () => {
    // subscribeTopics runs again on a location filter change and on refreshAll.
    // A leaked handle would apply every live event twice.
    const hass = makeMockHass({ items: [makeItem({ id: '1', quantity: 5 })] });
    const store = new Store(hass, fast);
    await store.init();

    store.subscribeTopics();
    store.subscribeTopics();

    hass.__emit('items', 'updated', { item: makeItem({ id: '1', quantity: 9, version: 2 }) });

    const matching = store.state.value.items.filter((i) => i.id === '1');
    expect(matching).toHaveLength(1);
    expect(matching[0].quantity).toBe(9);
  });

  it('stops applying live events once disposed', async () => {
    // `dispose()` has no caller in the card today; this pins what it does so the
    // decision to wire it up (or drop it) is made deliberately.
    const hass = makeMockHass({ items: [makeItem({ id: '1', quantity: 5 })] });
    const store = new Store(hass, fast);
    await store.init();
    expect(store.state.value.connected).toEqual({ items: true, stats: true });

    store.dispose();
    expect(store.state.value.connected).toEqual({ items: false, stats: false });

    hass.__emit('items', 'updated', { item: makeItem({ id: '1', quantity: 42, version: 2 }) });
    expect(store.state.value.items[0].quantity).toBe(5);
  });
});

// Areas are Home Assistant's, and the card prints their names beside every
// location path. A dashboard stays open for days, so a boot-time snapshot would
// keep naming an area the registry has since renamed or dropped.
describe('Store: HA area registry watch', () => {
  const AREA_EVENT = 'area_registry_updated';

  it('refetches the areas when the registry changes', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const store = new Store(hass, fast);
      await store.init();
      expect(store.state.value.areasCache?.areas[0].name).toBe('Kitchen');

      hass.__setAreas([{ id: 'kitchen', name: 'Scullery' }]);
      hass.__emitHaEvent(AREA_EVENT, { action: 'update', area_id: 'kitchen' });
      await vi.advanceTimersByTimeAsync(300);

      expect(store.state.value.areasCache?.areas[0].name).toBe('Scullery');
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces a burst of registry events into one refetch', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const store = new Store(hass, fast);
      await store.init();
      const before = hass.__calls.filter((c) => c === 'haventory/areas/list').length;

      hass.__emitHaEvent(AREA_EVENT, { action: 'create', area_id: 'a' });
      hass.__emitHaEvent(AREA_EVENT, { action: 'create', area_id: 'b' });
      hass.__emitHaEvent(AREA_EVENT, { action: 'remove', area_id: 'c' });
      await vi.advanceTimersByTimeAsync(300);

      const after = hass.__calls.filter((c) => c === 'haventory/areas/list').length;
      expect(after - before).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops watching the registry once disposed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const store = new Store(hass, fast);
      await store.init();
      expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(1);

      hass.__setAreas([{ id: 'kitchen', name: 'Scullery' }]);
      hass.__emitHaEvent(AREA_EVENT, { action: 'update', area_id: 'kitchen' });
      store.dispose();
      await vi.advanceTimersByTimeAsync(300);

      // Both halves: the pending refetch is cancelled, and a later event finds
      // nobody listening.
      expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(0);
      expect(store.state.value.areasCache?.areas[0].name).toBe('Kitchen');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps working when Home Assistant refuses the registry subscription', async () => {
    const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
    const failing = {
      ...hass,
      connection: {
        subscribeMessage(cb: (event: never) => void, msg: Record<string, unknown>) {
          if (msg.type === 'subscribe_events') return Promise.reject(new Error('nope'));
          return hass.connection.subscribeMessage(cb as never, msg);
        },
      },
    };
    const store = new Store(failing, fast);

    await store.init();

    // No throw, no degraded state: the card keeps the areas it fetched, which
    // is everything it had before it listened at all.
    expect(store.state.value.areasCache?.areas[0].name).toBe('Kitchen');
    expect(store.state.value.connected).toEqual({ items: true, stats: true });
  });

  /**
   * A hass that refuses the first `refusals` `subscribe_events` calls and then
   * delegates to the mock, counting every attempt — the point of the retry is
   * that a second attempt happens at all.
   */
  function refusingRegistry(hass: ReturnType<typeof makeMockHass>, refusals: number) {
    let attempts = 0;
    const wrapped = {
      ...hass,
      connection: {
        subscribeMessage(cb: (event: never) => void, msg: Record<string, unknown>) {
          if (msg.type !== 'subscribe_events') {
            return hass.connection.subscribeMessage(cb as never, msg);
          }
          attempts += 1;
          if (attempts <= refusals) return Promise.reject({ code: 'unknown_error' });
          return hass.connection.subscribeMessage(cb as never, msg);
        },
      },
    };
    return { hass: wrapped, attempts: () => attempts };
  }

  // Backoff off a base the card can actually wait on, so "it retried" is
  // distinguishable from "it never stopped trying".
  const backoff = { retryBaseMs: 100 };

  it('retries a refused registry subscribe and watches once it is accepted', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const refusing = refusingRegistry(hass, 1);
      const store = new Store(refusing.hass, backoff);
      await store.init();
      expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(0);

      await vi.advanceTimersByTimeAsync(200);
      expect(refusing.attempts()).toBe(2);
      expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(1);

      // The watch is live, not merely open: a later rename still lands.
      hass.__setAreas([{ id: 'kitchen', name: 'Scullery' }]);
      hass.__emitHaEvent(AREA_EVENT, { action: 'update', area_id: 'kitchen' });
      await vi.advanceTimersByTimeAsync(300);
      expect(store.state.value.areasCache?.areas[0].name).toBe('Scullery');
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the areas after a gap nothing was listening through', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const refusing = refusingRegistry(hass, 1);
      const store = new Store(refusing.hass, backoff);
      await store.init();

      // The rename lands while the watch is refused, so no event reports it.
      // Re-opening the watch alone would leave the card naming a stale area.
      hass.__setAreas([{ id: 'kitchen', name: 'Scullery' }]);
      await vi.advanceTimersByTimeAsync(500);

      expect(store.state.value.areasCache?.areas[0].name).toBe('Scullery');
    } finally {
      vi.useRealTimers();
    }
  });

  // A dropped socket is the gap the watch itself cannot report: Home Assistant
  // re-issues the subscriptions it held before it says `ready`, so nothing is
  // refused and nothing re-opens, while the events fired meanwhile are gone.
  it('re-reads the areas after a reconnect the watch never noticed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const store = new Store(hass, backoff);
      await store.init();

      // The registry moves while the socket is down: no event is delivered.
      hass.__setAreas([{ id: 'kitchen', name: 'Scullery' }]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(store.state.value.areasCache?.areas[0].name).toBe('Kitchen');

      hass.__reconnect();
      await vi.advanceTimersByTimeAsync(300);

      expect(store.state.value.areasCache?.areas[0].name).toBe('Scullery');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the watch it already holds across a reconnect', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__reconnect();
      await vi.advanceTimersByTimeAsync(300);

      // Home Assistant restored the subscription itself. Opening a second one
      // would leave two watches refetching for every registry edit, and the
      // first one unreferenced and unstoppable.
      expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops re-reading the areas once the store is disposed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const store = new Store(hass, backoff);
      await store.init();

      store.dispose();
      const before = hass.__calls.filter((c) => c === 'haventory/areas/list').length;
      hass.__reconnect();
      await vi.advanceTimersByTimeAsync(1000);

      // The connection outlives the card, so a listener left attached would
      // refetch for a dead store on every reconnect for as long as the page is
      // open.
      expect(hass.__calls.filter((c) => c === 'haventory/areas/list').length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('works against a connection that exposes no lifecycle events', async () => {
    const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
    // `HassLike.connection` is structural, so `addEventListener` may be absent.
    const bare = {
      ...hass,
      connection: {
        subscribeMessage: (cb: (event: never) => void, msg: Record<string, unknown>) =>
          hass.connection.subscribeMessage(cb as never, msg),
      },
    };
    const store = new Store(bare, backoff);

    await store.init();
    expect(store.state.value.areasCache?.areas[0].name).toBe('Kitchen');
    expect(() => store.dispose()).not.toThrow();
  });

  it('gives up on the registry watch quietly once the budget is spent', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const refusing = refusingRegistry(hass, Number.POSITIVE_INFINITY);
      const store = new Store(refusing.hass, backoff);
      await store.init();

      await vi.advanceTimersByTimeAsync(60_000);
      const spent = refusing.attempts();
      await vi.advanceTimersByTimeAsync(60_000);

      // Bounded — and it stays bounded, rather than knocking forever.
      expect(spent).toBeGreaterThan(1);
      expect(refusing.attempts()).toBe(spent);
      // Silent: a refused area watch costs freshness, not function, so it
      // raises no banner and queues no error for the user to dismiss.
      expect(store.state.value.errorQueue).toEqual([]);
      expect(store.state.value.degraded.liveUpdates).toBe('live');
      expect(store.state.value.areasCache?.areas[0].name).toBe('Kitchen');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-open the registry watch after dispose', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ areas: [{ id: 'kitchen', name: 'Kitchen' }] });
      const refusing = refusingRegistry(hass, 1);
      const store = new Store(refusing.hass, backoff);
      await store.init();
      expect(refusing.attempts()).toBe(1);

      store.dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refusing.attempts()).toBe(1);
      expect(hass.__haEventSubscriberCount(AREA_EVENT)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Store: an idle surface going offline', () => {
  const backoff = { retryBaseMs: 10 };

  it('says the connection is lost when the socket closes and stays closed', async () => {
    // Nobody is touching this surface, so no call can report the outage. Without
    // the socket's own event the list would sit there showing pre-outage data
    // until someone tried something and got a failure.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.state.value.degraded.connectionLost).toBe(true);
      // The degraded stack carries this one; nothing was refused, so nothing
      // belongs in the queue of refused operations.
      expect(store.state.value.errorQueue).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sits out a reconnect that lands inside the grace period', async () => {
    // Home Assistant reconnects by itself and a blip is over before anyone could
    // act on it. Announcing it at once would flash a banner and withdraw it.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(500);
      expect(store.state.value.degraded.connectionLost).toBe(false);

      hass.__connectionReady();
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sits out a reconnect that lands on the three-second retry rung', async () => {
    // Home Assistant's client retries on a ladder — at once, then +1 s, +3 s,
    // +6 s — so a socket dropped while the network is briefly away misses the
    // first two rungs and returns on the third. That is an ordinary Wi-Fi roam
    // and the grace period exists to sit it out; a shorter one would put a
    // banner up and take it down again a second later.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(3_100);
      expect(store.state.value.degraded.connectionLost).toBe(false);

      hass.__connectionReady();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the banner back down when the socket returns', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(5000);
      expect(store.state.value.degraded.connectionLost).toBe(true);

      hass.__connectionReady();
      await vi.advanceTimersByTimeAsync(300);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops watching the socket once the store is disposed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      store.dispose();
      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Store: a card built while the backend cannot answer', () => {
  const backoff = { retryBaseMs: 10 };
  // Home Assistant rebuilds the Lovelace view when its socket reconnects, and a
  // restarting instance serves that rebuild before the integration is set up
  // again. Every command the fresh card makes is refused, so its first load
  // fails outright — the one case where the routes back into the data must
  // still be opened.
  const REFUSED = { code: 'unknown_command', message: 'Unknown command.' };

  it('still watches the socket after a first load that failed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      hass.__failNext(50, REFUSED);
      const store = new Store(hass, backoff);
      await store.init().catch(() => undefined);

      // Driving the watch is the only honest proof it was attached.
      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(6_000);

      expect(store.state.value.degraded.connectionLost).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still opens the subscriptions after a first load that failed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      hass.__failNext(50, REFUSED);
      const store = new Store(hass, backoff);
      await store.init().catch(() => undefined);

      expect(hass.__subscribeCalls).toContain('items');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits out a subscribe refused because the command is not registered yet', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      hass.__failSubscribeNext(4, REFUSED);
      const store = new Store(hass, backoff);
      await store.init();

      // Retrying, not paused: an unregistered command says the backend is early,
      // and pausing would ask the user to act on something that fixes itself.
      expect(store.state.value.degraded.liveUpdates).toBe('retrying');
      expect(store.state.value.degraded.liveUpdatesReason).toBe('unavailable');
      expect(store.state.value.errorQueue).toEqual([]);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(store.state.value.degraded.liveUpdates).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the inventory once the backend starts answering', async () => {
    // Nothing the user does is involved: the refused subscribe retries on its
    // own backoff, and landing it re-reads everything the failed load missed.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      // Exactly the loads `init` starts in parallel, so the refusal window
      // closes with it and the recovery that follows is answered normally. The
      // empty-list assertion below is what catches this count going stale.
      hass.__failNext(8, REFUSED);
      // The subscribe is refused the same way the commands were: a restarting
      // instance has no `haventory/subscribe` registered yet either.
      hass.__failSubscribeNext(4, REFUSED);
      const store = new Store(hass, backoff);
      await store.init().catch(() => undefined);
      expect(store.state.value.items).toEqual([]);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(store.state.value.items.map((i) => i.id)).toEqual(['1']);
      expect(store.state.value.degraded.liveUpdates).toBe('live');
    } finally {
      vi.useRealTimers();
    }
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

  // Unfiltered, the tree is asked plainly — no filter key on the wire at all,
  // so nodes come back without the matching pair.
  it('leaves the tree unfiltered until something is actually narrowing', async () => {
    const locations = [loc('garage', 'Garage')];
    const store = new Store(makeMockHass({ items: [makeItem({ id: '1', location_id: 'garage' })], locations }), fast);
    await store.init();

    expect(store.state.value.locationTreeCache![0].matching_subtree_count).toBeUndefined();
    expect(store.state.value.locationMatchTotal).toBe(null);
  });

  it('counts each location against the filter, ignoring the location filter itself', async () => {
    const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage'), loc('kitchen', 'Kitchen')];
    const items = [
      makeItem({ id: '1', location_id: 'garage', category: 'Tools' }),
      makeItem({ id: '2', location_id: 'shelf-a', category: 'Tools' }),
      makeItem({ id: '3', location_id: 'shelf-a', category: 'Cables' }),
      makeItem({ id: '4', location_id: 'kitchen', category: 'Tools' }),
      makeItem({ id: '5', category: 'Tools' }),
    ];
    const hass = makeMockHass({ items, locations });
    const store = new Store(hass, fast);
    await store.init();
    const treeCalls = () => hass.__calls.filter((c) => c === 'haventory/location/tree').length;
    const before = treeCalls();

    // The refresh rides a 250 ms debounce, so the test drives that clock rather
    // than out-waiting it: installed here, after init, so the setup above keeps
    // running on real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // Narrow by category *and* location: the sidebar still has to show where
      // the other matches are, or picking a different branch becomes guesswork.
      store.setFilters({ categories: ['Tools'], locationIds: ['kitchen'] });

      // Nothing on the last millisecond before the window closes...
      await vi.advanceTimersByTimeAsync(249);
      expect(treeCalls()).toBe(before);

      // ...and exactly one walk when it does.
      await vi.advanceTimersByTimeAsync(1);
      expect(treeCalls()).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }

    const tree = store.state.value.locationTreeCache!;
    const garage = tree.find((n) => n.id === 'garage')!;
    const kitchen = tree.find((n) => n.id === 'kitchen')!;
    expect(garage.subtree_item_count).toBe(3);
    expect(garage.matching_subtree_count).toBe(2);
    expect(kitchen.matching_subtree_count).toBe(1);
    // Four Tools items in total; the fourth has no location, and the sidebar
    // derives that row from this number.
    expect(store.state.value.locationMatchTotal).toBe(4);
  });

  it('does not re-walk the tree for a re-order, which changes no count', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })], locations: [loc('garage', 'Garage')] });
    const store = new Store(hass, fast);
    await store.init();

    const before = hass.__calls.filter((c) => c === 'haventory/location/tree').length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      store.setFilters({ sort: { field: 'name', order: 'asc' } });
      // Well past the 250 ms debounce: the claim is that nothing was scheduled
      // at all, not that it had not fired yet.
      await vi.advanceTimersByTimeAsync(400);
    } finally {
      vi.useRealTimers();
    }
    expect(hass.__calls.filter((c) => c === 'haventory/location/tree').length).toBe(before);
  });

  it('caches the integration version for diagnostics', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.versionInfo?.integration_version).toBe('0.0.1');
  });

  it('reads the card heading configured in the integration', async () => {
    const hass = makeMockHass({ items: [], cardTitle: 'Pantry' });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.cardTitle).toBe('Pantry');
  });

  it('reads the quick-filter pills configured in the integration', async () => {
    const hass = makeMockHass({ items: [], quickFilters: ['low_stock', 'overdue'] });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.quickFilters).toEqual(['low_stock', 'overdue']);
  });

  // `null` and `[]` are different answers, and the store is where the two
  // could most easily collapse into one falsy value.
  it('keeps an explicit "no pills" apart from "no choice made"', async () => {
    const none = new Store(makeMockHass({ items: [], quickFilters: [] }), fast);
    await none.init();
    expect(none.state.value.quickFilters).toEqual([]);

    const unset = new Store(makeMockHass({ items: [], quickFilters: null }), fast);
    await unset.init();
    expect(unset.state.value.quickFilters).toBeNull();
  });

  it('drops a pill name this bundle does not know', async () => {
    const hass = makeMockHass({ items: [], quickFilters: ['low_stock', 'sideways'] });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.quickFilters).toEqual(['low_stock']);
  });

  it('leaves the pills unset against a backend that does not report them', async () => {
    const store = new Store(makeMockHass({ items: [] }), fast);
    await store.init();

    expect(store.state.value.quickFilters).toBeNull();
  });

  // The card bundle is served by the integration, so this only happens with a
  // stale cached bundle — and a missing heading must not cost the user their
  // items, which init loads after this call.
  it('still loads when the backend does not know haventory/config', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const realCallWS = hass.callWS.bind(hass);
    hass.callWS = (async (msg: Record<string, unknown>) => {
      if (msg.type === 'haventory/config') throw { code: 'unknown_command', message: 'nope' };
      return realCallWS(msg);
    }) as typeof hass.callWS;

    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.cardTitle).toBeNull();
    expect(store.state.value.items).toHaveLength(1);
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
    store.setFilters({ categories: ['Hardware'] });

    await store.exportDocument();
    await store.exportDocument('view');

    expect(calls[0]).toBe(null);
    expect((calls[1] as { categories?: string[] }).categories).toEqual(['Hardware']);
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
    // The re-list is a promise chain, not a debounce: draining the queue is the
    // whole wait, and 5 ms of real time was only ever a hedge on the scheduler.
    await flush(2);

    // It went up and came back down; nothing is left stuck.
    expect(seen).toContain(true);
    expect(store.state.value.degraded.reloading).toBe(false);
  });

  // Deleting a status with a reassignment target moves every item carrying it
  // in one call, so the backend announces the move with no item to merge. Read
  // as a per-item event this threw and the card kept showing the old rows.
  it('refetches on an item event that carries no item', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'Ladder' })] });
    const store = new Store(hass, fast);
    await store.init();
    hass.__setItems([makeItem({ id: '1', name: 'Ladder', status: 'ok' }), makeItem({ id: '2' })]);

    const seen: boolean[] = [];
    store.state.onChange(() => seen.push(store.state.value.degraded.reloading));

    hass.__emit('items', 'updated', {});
    await flush(2);

    expect(seen).toContain(true);
    expect(store.state.value.degraded.reloading).toBe(false);
    expect(store.state.value.items.map((i) => i.id)).toEqual(['1', '2']);
  });
});

/**
 * The number under the list has to survive a row nobody in this browser asked
 * for. `total` comes off the last `item/list` reply and the event path patches
 * `items`, so with a filter on, the two used to drift apart and the footer read
 * "Showing 1 of 0 matching items".
 */
describe('Store: the filtered total after an event-inserted row', () => {
  const spanner = makeItem({ id: 'sp', name: 'Spanner' });
  const hammer = makeItem({ id: 'ha', name: 'Hammer' });

  /** A store with `q` applied and its first filtered page loaded. */
  async function searched(q: string, items = [spanner]) {
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();
    store.setFilters({ q });
    await vi.advanceTimersByTimeAsync(300);
    return { hass, store };
  }

  it('counts a row an event inserts, with no round trip to wait for', async () => {
    vi.useFakeTimers();
    try {
      const { hass, store } = await searched('spanner', []);
      expect(store.state.value.total).toBe(0);

      // The mock's own list is what a recount reads, so the item exists there
      // too — this is the other browser having created it.
      hass.__setItems([spanner]);
      const listsBefore = hass.__calls.filter((c) => c === 'haventory/item/list').length;
      hass.__emit('items', 'created', { item: spanner });

      // Straight away, before the recount is even scheduled to fire.
      expect(store.state.value.items).toHaveLength(1);
      expect(store.state.value.total).toBe(1);
      expect(hass.__calls.filter((c) => c === 'haventory/item/list').length).toBe(listsBefore);

      await vi.advanceTimersByTimeAsync(300);
      expect(store.state.value.total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // The subscription is filtered by location, not by the search text, so a row
  // that does not match the typed query arrives all the same. The card cannot
  // tell — the server can.
  it('takes the total back off the server when the row does not match', async () => {
    vi.useFakeTimers();
    try {
      const { hass, store } = await searched('spanner');
      expect(store.state.value.total).toBe(1);

      hass.__setItems([spanner, hammer]);
      hass.__emit('items', 'created', { item: hammer });
      expect(store.state.value.total).toBe(2);

      await vi.advanceTimersByTimeAsync(300);
      // One spanner matches "spanner"; the loaded list holds two rows, and
      // `showingCount` is what stops that pair printing an impossible line.
      expect(store.state.value.total).toBe(1);
      expect(store.state.value.items).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows a delete down, and never below zero', async () => {
    vi.useFakeTimers();
    try {
      const { hass, store } = await searched('spanner');
      hass.__setItems([]);
      hass.__emit('items', 'deleted', { item: spanner });

      expect(store.state.value.total).toBe(0);
      await vi.advanceTimersByTimeAsync(300);
      expect(store.state.value.total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // An item on a page nobody has scrolled to leaves the match set without
  // touching the loaded rows, so there is no delta to apply — only the server
  // knows the set got smaller.
  it('re-prices a change the loaded list cannot see', async () => {
    vi.useFakeTimers();
    try {
      const other = makeItem({ id: 'sp2', name: 'Spanner, small' });
      const { hass, store } = await searched('spanner', [spanner, other]);
      expect(store.state.value.total).toBe(2);

      hass.__setItems([spanner]);
      hass.__emit('items', 'deleted', { item: makeItem({ id: 'gone', name: 'Never loaded' }) });
      expect(store.state.value.total).toBe(2);

      await vi.advanceTimersByTimeAsync(300);
      expect(store.state.value.total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // `updated` rather than `created`, so the number below counts one thing: a
  // create also books a tree refetch, which prices its own filtered count
  // through the same command and cannot be told apart from this one.
  it('asks once for a burst, and not at all with no filter on', async () => {
    vi.useFakeTimers();
    try {
      const { hass, store } = await searched('spanner');
      const before = hass.__calls.filter((c) => c === 'haventory/item/list').length;
      for (const quantity of [1, 2, 3]) {
        hass.__emit('items', 'updated', { item: { ...spanner, quantity } });
      }
      await vi.advanceTimersByTimeAsync(300);
      expect(hass.__calls.filter((c) => c === 'haventory/item/list').length - before).toBe(1);

      store.clearFilters();
      await vi.advanceTimersByTimeAsync(300);
      const unfiltered = hass.__calls.filter((c) => c === 'haventory/item/list').length;
      hass.__emit('items', 'created', { item: makeItem({ id: 'd', name: 'Chisel' }) });
      await vi.advanceTimersByTimeAsync(300);
      expect(hass.__calls.filter((c) => c === 'haventory/item/list').length).toBe(unfiltered);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a recount the dispose leaves pending', async () => {
    vi.useFakeTimers();
    try {
      const { hass, store } = await searched('spanner', [spanner, hammer]);
      hass.__emit('items', 'created', { item: hammer });
      const listed = hass.__calls.filter((c) => c === 'haventory/item/list').length;
      store.dispose();
      await vi.advanceTimersByTimeAsync(300);
      expect(hass.__calls.filter((c) => c === 'haventory/item/list').length).toBe(listed);
    } finally {
      vi.useRealTimers();
    }
  });

  // The filter can change while the count for the previous one is on the wire.
  // `listItems` has already answered for the new filter by then, so the late
  // answer would replace a right number with a stale one — held open here so
  // the two really do overlap.
  it('drops a recount whose filter moved while it was in flight', async () => {
    const small = makeItem({ id: 'ha2', name: 'Hammer, small' });
    const hass = makeMockHass({ items: [spanner, hammer, small] });
    const store = new Store(hass, fast);
    await store.init();
    store.setFilters({ q: 'spanner' });
    await vi.waitUntil(() => store.state.value.total === 1);

    // Every count-shaped list is held, because the tree refetch an event also
    // books prices its own through the same command: holding "the first one"
    // would be holding whichever won the race.
    const original = hass.callWS.bind(hass);
    const held: (() => void)[] = [];
    hass.callWS = (async (msg: Record<string, unknown>) => {
      if (String(msg.type) === 'haventory/item/list' && msg.limit === 1) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return original(msg);
    }) as typeof hass.callWS;

    hass.__emit('items', 'created', { item: hammer });
    await vi.waitUntil(() => held.length > 0);

    store.setFilters({ q: 'hammer' });
    await vi.waitUntil(() => store.state.value.total === 2);
    held.forEach((release) => release());
    // The full page load setFilters started is unheld and has already landed;
    // this is the held answers finishing their chains behind it.
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(store.state.value.total).toBe(2);
  });
});

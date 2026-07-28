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

const RATE_LIMITED = { code: 'rate_limited', message: 'rate limit exceeded; retry later' };

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
      locationId: 'loc-1',
      checkedOutOnly: true,
      lowStockOnly: true,
      lowStockFirst: true,
      orphansOnly: true,
      overdueOnly: true,
      inspectionDueOnly: true,
      category: 'Hardware',
      updatedAfter: '2026-07-01T00:00:00Z',
      createdAfter: '2026-01-01T00:00:00Z',
      updatedBefore: '2026-08-01T00:00:00Z',
      createdBefore: '2026-02-01T00:00:00Z',
    });
    expect(wire).toMatchObject({
      q: 'screws',
      area_id: 'area-1',
      location_id: 'loc-1',
      checked_out: true,
      low_stock_only: true,
      low_stock_first: true,
      orphaned_only: true,
      overdue_only: true,
      inspection_overdue_only: true,
      category: 'Hardware',
      updated_after: '2026-07-01T00:00:00Z',
      created_after: '2026-01-01T00:00:00Z',
      updated_before: '2026-08-01T00:00:00Z',
      created_before: '2026-02-01T00:00:00Z',
    });
  });

  it('leaves the before-bounds off when they are unset', () => {
    const wire = toWireFilter(defaultFilters());
    expect(wire.updated_before).toBeUndefined();
    expect(wire.created_before).toBeUndefined();
    expect(wire.overdue_only).toBeUndefined();
    expect(wire.inspection_overdue_only).toBeUndefined();
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
    await settleSubscribes();

    // Live updates are gone; the card must stop claiming it is connected.
    expect(store.state.value.degraded.rateLimited).toBe(true);
    expect(store.state.value.connected.items).toBe(false);
    // ...and it says so as a state the UI can render, not just a log line.
    expect(store.state.value.degraded.liveUpdates).toBe('retrying');
  });

  it('retries a rate-limited subscribe and goes live again', async () => {
    const hass = makeMockHass({ items: [] });
    // One whole round refused — three topics — then the limiter lets us back in.
    hass.__failSubscribeNext(3, RATE_LIMITED);
    const store = new Store(hass, fast);

    await store.init();
    await settleSubscribes();
    expect(store.state.value.degraded.liveUpdates).toBe('retrying');
    expect(store.state.value.degraded.nextLiveRetryAt).not.toBeNull();

    await flush(3);

    // The indicator is cleared by the retry succeeding, not by the user acting.
    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.degraded.nextLiveRetryAt).toBeNull();
    expect(store.state.value.connected.items).toBe(true);
    expect(store.state.value.errorQueue).toEqual([]);
    // Two rounds of three, so the retry really did re-open every topic...
    expect(hass.__subscribeCalls).toHaveLength(6);
    // ...and events flow again, which is the whole point of retrying.
    hass.__emit('items', 'created', { item: makeItem({ id: '9' }) });
    expect(store.state.value.items.map((i) => i.id)).toContain('9');
  });

  it('gives up after a bounded number of retries and surfaces the pause', async () => {
    const hass = makeMockHass({ items: [] });
    hass.__failSubscribe(RATE_LIMITED);
    const store = new Store(hass, fast);

    await store.init();
    await flush(12);

    expect(store.state.value.degraded.liveUpdates).toBe('paused');
    expect(store.state.value.degraded.rateLimited).toBe(true);
    // Nothing further is scheduled: only the user can restart this.
    expect(store.state.value.degraded.nextLiveRetryAt).toBeNull();
    expect(store.state.value.connected.items).toBe(false);
    // The refusal reaches the user exactly once — when retrying is over, not on
    // every attempt.
    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['rate_limited']);
    // The first round plus four retries, three topics each. The cap is the point:
    // a card that kept knocking would be indistinguishable from the load that
    // tripped the limiter.
    expect(hass.__subscribeCalls).toHaveLength(15);

    // The budget stays spent until something restarts it.
    await flush(6);
    expect(hass.__subscribeCalls).toHaveLength(15);
  });

  it('clears the paused indicator when a manual refresh gets back in', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    hass.__failSubscribe(RATE_LIMITED);
    const store = new Store(hass, fast);
    await store.init();
    await flush(12);
    expect(store.state.value.degraded.liveUpdates).toBe('paused');

    hass.__failSubscribe(null);
    await store.refreshAll();
    await flush();

    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.degraded.rateLimited).toBe(false);
    expect(store.state.value.connected.items).toBe(true);
    hass.__emit('items', 'created', { item: makeItem({ id: '2' }) });
    expect(store.state.value.items.map((i) => i.id)).toContain('2');
  });

  it('waits out the retry-after hint the envelope carries', async () => {
    // `nextLiveRetryAt` is `Date.now() + delay` and the retry itself rides
    // `setTimeout`, so both have to move on one clock for the wait to be exact
    // instead of a race against the scheduler. `settleSubscribes()` keeps
    // working across the switch — it is pure microtasks, which fake timers
    // leave alone.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const hass = makeMockHass({ items: [] });
      hass.__failSubscribeNext(3, { ...RATE_LIMITED, data: { op: 'subscribe', retry_after_ms: 40 } });
      const store = new Store(hass, fast);

      await store.init();
      await settleSubscribes();

      // The hint wins over the store's own (zero, in tests) backoff.
      const wait = (store.state.value.degraded.nextLiveRetryAt ?? 0) - Date.now();
      expect(wait).toBe(40);
      expect(store.state.value.degraded.liveUpdates).toBe('retrying');

      // Not retried before the hint elapses...
      await vi.advanceTimersByTimeAsync(39);
      expect(hass.__subscribeCalls).toHaveLength(3);

      // ...and retried on the very millisecond it does.
      await vi.advanceTimersByTimeAsync(1);
      await settleSubscribes();
      expect(hass.__subscribeCalls).toHaveLength(6);
      expect(store.state.value.degraded.liveUpdates).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a non-rate-limit subscribe refusal instead of retrying it', async () => {
    // Only `rate_limited` says "try again later"; anything else is an outage the
    // user needs to see, and quietly re-knocking would hide it.
    const hass = makeMockHass({ items: [] });
    hass.__failSubscribe({ code: 'unknown_error', message: 'unexpected error; see Home Assistant logs' });
    const store = new Store(hass, fast);

    await store.init();
    await flush(3);

    expect(store.state.value.degraded.connectionLost).toBe(true);
    expect(store.state.value.degraded.liveUpdates).toBe('paused');
    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['unknown_error']);
    expect(hass.__subscribeCalls).toHaveLength(3);
  });
});

describe('subscribeRetryDelayMs', () => {
  it('prefers the envelope hint over the backoff, in either unit', () => {
    expect(subscribeRetryDelayMs({ code: 'rate_limited', data: { retry_after_ms: 250 } }, 0, 400)).toBe(250);
    // Seconds, the HTTP Retry-After convention.
    expect(subscribeRetryDelayMs({ code: 'rate_limited', data: { retry_after: 2 } }, 0, 400)).toBe(2000);
    // The card's own error entries name the bag `context`.
    expect(subscribeRetryDelayMs({ code: 'rate_limited', context: { retry_after_ms: 30 } }, 3, 400)).toBe(30);
  });

  it('backs off exponentially when the envelope carries no hint', () => {
    const delays = [0, 1, 2, 3].map((attempt) => subscribeRetryDelayMs({ code: 'rate_limited' }, attempt, 400));
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
    expect(store.state.value.degraded.rateLimited).toBe(false);
  });

  it('counts unknown_error toward an outage even though it is a taxonomy code', async () => {
    // `unknown_error` is in DOMAIN_ERROR_CODES so it renders as a real message,
    // but it is deliberately excluded from the "socket is fine" reset: it is the
    // backend's catch-all and says nothing about the transport.
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(2, { code: 'unknown_error', message: 'boom' });
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);

    expect(store.state.value.degraded.connectionLost).toBe(true);
  });

  it('counts the queued retries and schedules the next one', async () => {
    // Nothing renders `nextRetryAt` today, so only this pins the backoff
    // arithmetic and the retry counter to their observable behaviour. The
    // counter only rises inside the retry window, so sample it from the
    // subscription rather than racing the awaits.
    const hass = makeMockHass({ items: [makeItem({ id: '1', quantity: 5 })] });
    const store = new Store(hass, { retryBaseMs: 5 });
    await store.init();

    const retrying: number[] = [];
    const scheduled: (number | null)[] = [];
    const off = store.state.onChange(() => {
      retrying.push(store.state.value.degraded.retrying);
      scheduled.push(store.state.value.degraded.nextRetryAt);
    });

    hass.__rateLimitNext(1);
    await store.adjustQuantity('1', 1);
    off();

    // One refusal, so exactly one retry was queued and a wait was published...
    expect(Math.max(...retrying)).toBe(1);
    expect(scheduled.some((t) => typeof t === 'number')).toBe(true);
    // ...and both are cleared once the call finally settles.
    expect(store.state.value.degraded.retrying).toBe(0);
    expect(store.state.value.degraded.nextRetryAt).toBeNull();
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
    const store = new Store(makeMockHass({ items, locations }), fast);
    await store.init();

    // Narrow by category *and* location: the sidebar still has to show where the
    // other matches are, or picking a different branch becomes guesswork.
    store.setFilters({ category: 'Tools', locationId: 'kitchen' });
    await new Promise((r) => setTimeout(r, 400));

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
    store.setFilters({ sort: { field: 'name', order: 'asc' } });
    await new Promise((r) => setTimeout(r, 400));
    expect(hass.__calls.filter((c) => c === 'haventory/location/tree').length).toBe(before);
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

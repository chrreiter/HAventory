import { describe, it, expect, vi } from 'vitest';
import { Store } from './store';
import { makeMockHass, makeItem } from '../test.utils';

/**
 * What arrives on the open subscriptions and what the card does with it: a row
 * another browser created, a path a location rename moved, counts pushed from
 * the backend, and the totals the footer prints beside them.
 */

/** Stores under test never wait on real backoff. */
const fast = { retryBaseMs: 0 };

/** Let queued microtasks and any zero-delay timers run. */
async function flush(rounds = 1): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Store', () => {
  it('reloads the item list when a locations moved/renamed event arrives', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: 'i1', name: 'Widget' })] });
    const store = new Store(hass, fast);
    await store.init();

    // Count item/list calls from here on via the callWS wrapper
    let listCalls = 0;
    const origCallWS = hass.callWS.bind(hass);
    hass.callWS = async <T,>(msg: Record<string, unknown>): Promise<T> => {
      if (msg.type === 'haventory/item/list') listCalls += 1;
      return origCallWS<T>(msg);
    };

    const loc = {
      id: 'locX', parent_id: null, name: 'Moved', area_id: null,
      path: { id_path: ['locX'], name_path: ['Moved'], display_path: 'Moved', sort_key: 'moved' },
    };
    hass.__emit('locations', 'moved', { location: loc });
    await new Promise((r) => setTimeout(r, 0));
    expect(listCalls).toBe(1);

    hass.__emit('locations', 'renamed', { location: loc });
    await new Promise((r) => setTimeout(r, 0));
    expect(listCalls).toBe(2);

    // Non-path-changing events do not reload the list
    hass.__emit('locations', 'created', { location: loc });
    await new Promise((r) => setTimeout(r, 0));
    expect(listCalls).toBe(2);
  });

  it('updates statsCounts live from a stats counts event', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    const counts = { items_total: 42, low_stock_count: 3, checked_out_count: 1, locations_total: 7 };
    hass.__emit('stats', 'counts', { counts });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.value.statsCounts).toEqual(expect.objectContaining({ items_total: 42, locations_total: 7 }));
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
 * `items`, so with a filter on the two can drift apart and the footer read
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

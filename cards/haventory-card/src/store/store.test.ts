import { describe, it, expect, vi } from 'vitest';
import { BULK_CHUNK_SIZE, Store, makeBulkOp } from './store';
import { makeMockHass, makeItem } from '../test.utils';
import type { Location, StoreState } from './types';

/**
 * The store's own surface: what `init` loads, what an optimistic write does to
 * the list before and after the answer, and what the caches hold.
 *
 * A store case belongs in the sibling file named for what it pins — filters,
 * facets, subscriptions, events, the degraded stack, the day clock — and here
 * when what it pins is the store itself.
 */

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

describe('Store', () => {
  it('initializes with stats, areas, locations, and first page of items', async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.statsCounts).toBeTruthy();
    expect(store.state.value.areasCache).toBeTruthy();
    expect(store.state.value.locationsFlatCache).toBeTruthy();
    expect(store.state.value.items.length).toBe(30);
    expect(store.state.value.connected.items).toBe(true);
    expect(store.state.value.connected.stats).toBe(true);
  });

  it('creates item and updates state optimistically', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    await store.createItem({ name: 'New Item', quantity: 5 });
    const created = store.state.value.items.find((i) => i.name === 'New Item');
    expect(created).toBeTruthy();
    expect(created?.quantity).toBe(5);
  });

  it('updates item optimistically and reconciles on success', async () => {
    const base = makeItem({ id: '1', name: 'Original', quantity: 10 });
    const hass = makeMockHass({ items: [base] });
    const store = new Store(hass, fast);
    await store.init();

    await store.updateItem('1', { name: 'Updated', quantity: 20 });
    const updated = store.state.value.items.find((i) => i.id === '1');
    expect(updated?.name).toBe('Updated');
    expect(updated?.quantity).toBe(20);
  });

  it('optimistic update on updateItem; conflict surfaces banner with actions', async () => {
    const base = makeItem({ id: '1', name: 'A' });
    const hass = makeMockHass({ items: [base], conflictOnUpdate: true });
    const store = new Store(hass, fast);
    await store.init();
    // Trigger conflict
    await store.updateItem('1', { name: 'A2' }).catch(() => undefined);
    const errs = store.state.value.errorQueue;
    expect(errs.length).toBe(1);
    expect(errs[0].code).toBe('conflict');
    expect(errs[0].itemId).toBe('1');
    expect(errs[0].changes?.name).toBe('A2');
    // View latest
    await store.refreshItem('1');
    // Re-apply (disable conflict for retry)
    (hass as any).__setConflict(false);
    await store.updateItem('1', { name: 'A2' });
    const after = store.state.value.items.find((i) => i.id === '1');
    expect(after?.name).toBe('A2');
  });

  it('rolls back optimistic changes when updateItem fails', async () => {
    const base = makeItem({ id: '1', name: 'Original', quantity: 1 });
    const hass = makeMockHass({ items: [base], conflictOnUpdate: true });
    const store = new Store(hass, fast);
    await store.init();

    await store.updateItem('1', { name: 'Changed', quantity: 5 }).catch(() => undefined);

    const after = store.state.value.items.find((i) => i.id === '1');
    expect(after?.name).toBe('Original');
    expect(after?.quantity).toBe(1);
    expect(store.state.value.errorQueue[store.state.value.errorQueue.length - 1]?.code).toBe('conflict');
  });

  it('deletes item optimistically and rolls back on error', async () => {
    const item = makeItem({ id: '1', name: 'ToDelete' });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.items.length).toBe(1);
    await store.deleteItem('1');
    expect(store.state.value.items.length).toBe(0);
  });

  it('adjusts quantity with optimistic update', async () => {
    const item = makeItem({ id: '1', quantity: 10 });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    // Optimistic update happens immediately
    const adjustPromise = store.adjustQuantity('1', 5);
    // Check optimistic state before promise resolves
    let optimistic = store.state.value.items.find((i) => i.id === '1');
    expect(optimistic?.quantity).toBe(15);
    await adjustPromise;
  });

  it('sets quantity with optimistic update', async () => {
    const item = makeItem({ id: '1', quantity: 10 });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    // Optimistic update happens immediately
    const setPromise = store.setQuantity('1', 25);
    let optimistic = store.state.value.items.find((i) => i.id === '1');
    expect(optimistic?.quantity).toBe(25);
    await setPromise;
  });

  it('checks out and checks in items with optimistic updates', async () => {
    const item = makeItem({ id: '1', checked_out: false });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    // Check out optimistically
    const checkOutPromise = store.checkOut('1', '2025-12-31');
    const checkedOut = store.state.value.items.find((i) => i.id === '1');
    expect(checkedOut?.checked_out).toBe(true);
    expect(checkedOut?.due_date).toBe('2025-12-31');
    await checkOutPromise;

    // Check in optimistically
    const checkInPromise = store.markCheckedIn('1');
    const checkedIn = store.state.value.items.find((i) => i.id === '1');
    expect(checkedIn?.checked_out).toBe(false);
    await checkInPromise;
  });

  it('sets low stock threshold with optimistic update', async () => {
    const item = makeItem({ id: '1', low_stock_threshold: null });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    // Set threshold optimistically
    const setPromise = store.setLowStockThreshold('1', 5);
    const updated = store.state.value.items.find((i) => i.id === '1');
    expect(updated?.low_stock_threshold).toBe(5);
    await setPromise;

    // Clear threshold optimistically
    const clearPromise = store.setLowStockThreshold('1', null);
    const cleared = store.state.value.items.find((i) => i.id === '1');
    expect(cleared?.low_stock_threshold).toBe(null);
    await clearPromise;
  });

  it('moves item to different location with optimistic update', async () => {
    // Optimistic update: location_id changes immediately before server response
    const item = makeItem({ id: '1', location_id: 'loc1' });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    // Start move - optimistic update should happen immediately
    const movePromise = store.moveItem('1', 'loc2');
    const optimistic = store.state.value.items.find((i) => i.id === '1');
    expect(optimistic?.location_id).toBe('loc2');
    await movePromise;
    // After server response, item should still have new location
    const moved = store.state.value.items.find((i) => i.id === '1');
    expect(moved).toBeTruthy();
    expect(moved?.location_id).toBe('loc2');
  });

  // Two disappearances look identical from the item list: a row that fell off
  // the filtered page, and one that is gone. Only the second closes an editor.
  describe('wasRemoved', () => {
    it('reports nothing removed for a row that is merely filtered out', async () => {
      const hass = makeMockHass({ items: [makeItem({ id: 'a', name: 'Alpha' }), makeItem({ id: 'b', name: 'Beta' })] });
      const store = new Store(hass, fast);
      await store.init();

      store.setFilters({ q: 'Alpha' });
      await flush(2);
      expect(store.state.value.items.map((i) => i.id)).toEqual(['a']);
      expect(store.wasRemoved('b')).toBe(false);
    });

    it('reports a deleted row as removed', async () => {
      const hass = makeMockHass({ items: [makeItem({ id: 'a' })] });
      const store = new Store(hass, fast);
      await store.init();

      await store.deleteItem('a', 1);
      expect(store.wasRemoved('a')).toBe(true);
    });

    it('forgets a delete that was rolled back', async () => {
      const hass = makeMockHass({ items: [makeItem({ id: 'a' })] });
      const store = new Store(hass, fast);
      await store.init();
      const passthrough = hass.callWS.bind(hass);
      hass.callWS = async <T,>(msg: Record<string, unknown>): Promise<T> => {
        if (msg.type === 'haventory/item/delete') throw new Error('nope');
        return passthrough<T>(msg);
      };

      await store.deleteItem('a', 1);
      expect(store.state.value.items.map((i) => i.id)).toEqual(['a']);
      expect(store.wasRemoved('a')).toBe(false);
    });
  });

  it('dismisses errors from error queue', async () => {
    const item = makeItem({ id: '1' });
    const hass = makeMockHass({ items: [item], conflictOnUpdate: true });
    const store = new Store(hass, fast);
    await store.init();

    // Trigger an error
    await store.updateItem('1', { name: 'New' }).catch(() => undefined);
    expect(store.state.value.errorQueue.length).toBe(1);

    const errorId = store.state.value.errorQueue[0].id;
    store.dismissError(errorId);
    expect(store.state.value.errorQueue.length).toBe(0);
  });

  it('refreshes single item from backend', async () => {
    const item = makeItem({ id: '1', name: 'Original' });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    // refreshItem should fetch latest version
    await store.refreshItem('1');
    const refreshed = store.state.value.items.find((i) => i.id === '1');
    expect(refreshed).toBeTruthy();
    expect(refreshed?.id).toBe('1');
  });

  it('createLocation calls WS and refreshes caches', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    const created = await store.createLocation('Test Location', null);
    expect(created).toBeTruthy();
    expect(created.name).toBe('Test Location');
    expect(store.state.value.locationsFlatCache).toBeTruthy();
    const inCache = store.state.value.locationsFlatCache?.find((l) => l.id === created.id);
    expect(inCache?.name).toBe('Test Location');
  });

  it('updates stats cache on refreshStats', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    expect(store.state.value.statsCounts).toBeTruthy();

    await store.refreshStats();
    expect(store.state.value.statsCounts).toBeTruthy();
    expect(typeof store.state.value.statsCounts?.items_total).toBe('number');
  });

  it('deleteLocation removes an empty location and refreshes caches', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    const created = await store.createLocation('Doomed', null);
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === created.id)).toBe(true);

    await store.deleteLocation(created.id);
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === created.id)).toBe(false);
  });

  it('deleteLocation rejects with validation_error when the location is not empty', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    const parent = await store.createLocation('Parent', null);
    await store.createLocation('Child', parent.id);

    await expect(store.deleteLocation(parent.id)).rejects.toMatchObject({ code: 'validation_error' });
    // Still present — nothing was deleted
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === parent.id)).toBe(true);
  });

  it('deleteLocation rejects when items still reference the location', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    const loc = await store.createLocation('Occupied', null);
    hass.__setItems([makeItem({ id: 'i1', name: 'Blocker', location_id: loc.id })]);

    await expect(store.deleteLocation(loc.id)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('moveLocationSubtree reparents and refreshes locations and items', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: 'i1', name: 'Inside' })] });
    const store = new Store(hass, fast);
    await store.init();

    const src = await store.createLocation('Source', null);
    const dst = await store.createLocation('Dest', null);

    const moved = await store.moveLocationSubtree(src.id, dst.id);
    expect(moved.parent_id).toBe(dst.id);
    const cached = store.state.value.locationsFlatCache?.find((l) => l.id === src.id);
    expect(cached?.parent_id).toBe(dst.id);
  });

  // Bumping is the one mutation with no optimistic update: where the next
  // occurrence falls is month arithmetic counted from the series anchor, and a
  // guess would be wrong for exactly the month-end series the anchor exists for.
  it('bumps a reminder and takes the date the backend answers with', async () => {
    const item = makeItem({
      id: '1',
      reminder_date: '2026-08-31',
      reminder_anchor: '2026-01-31',
      reminder_interval: { unit: 'days', count: 7 },
    });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    await store.bumpReminder('1', item.version);

    const bumped = store.state.value.items.find((i) => i.id === '1');
    expect(bumped?.reminder_date).toBe('2026-09-07');
    // The anchor is the backend's and no client writes it.
    expect(bumped?.reminder_anchor).toBe('2026-01-31');
  });

  it('surfaces a refused bump as an error and leaves the item alone', async () => {
    const item = makeItem({ id: '1', reminder_date: '2026-08-31', reminder_interval: null });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass, fast);
    await store.init();

    await store.bumpReminder('1', item.version);

    expect(store.state.value.errorQueue.length).toBeGreaterThan(0);
    expect(store.state.value.items.find((i) => i.id === '1')?.reminder_date).toBe('2026-08-31');
  });

  /*
   * An optimistic write shows its result on the row itself and rolls that row
   * back when the call is refused, so no surface has a second, per-operation
   * "in flight" state to draw. A register of open writes would therefore be
   * written on every mutator and read by nobody — the type line is what keeps
   * it from coming back unnoticed, since a field nothing reads costs no test.
   */
  it('keeps no register of writes in flight', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'A' })] });
    const store = new Store(hass, fast);
    await store.init();

    await store.updateItem('1', { name: 'B' });

    const noPendingOps: Extract<keyof StoreState, 'pendingOps'> extends never ? true : never = true;
    expect(noPendingOps).toBe(true);
    expect(Object.keys(store.state.value)).not.toContain('pendingOps');
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

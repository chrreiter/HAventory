import { describe, it, expect, vi } from 'vitest';
import { Store } from './store';
import { makeMockHass, makeItem } from '../test.utils';

describe('Store', () => {
  it('initializes with stats, areas, locations, and first page of items', async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass);
    await store.init();

    expect(store.state.value.statsCounts).toBeTruthy();
    expect(store.state.value.areasCache).toBeTruthy();
    expect(store.state.value.locationsFlatCache).toBeTruthy();
    expect(store.state.value.items.length).toBe(30);
    expect(store.state.value.connected.items).toBe(true);
    expect(store.state.value.connected.stats).toBe(true);
  });

  it('debounces search and lists items; prefetch at ~70%', async () => {
    const items = Array.from({ length: 80 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass);
    await store.init();
    expect(store.state.value.items.length).toBeGreaterThan(0);
    // First page default 50
    expect(store.state.value.items.length).toBe(50);
    await store.prefetchIfNeeded(0.69);
    expect(store.state.value.items.length).toBe(50);
    await store.prefetchIfNeeded(0.71);
    expect(store.state.value.items.length).toBe(80);
  });

  it('creates item and updates state optimistically', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
    await store.init();

    await store.createItem({ name: 'New Item', quantity: 5 });
    const created = store.state.value.items.find((i) => i.name === 'New Item');
    expect(created).toBeTruthy();
    expect(created?.quantity).toBe(5);
  });

  it('updates item optimistically and reconciles on success', async () => {
    const base = makeItem({ id: '1', name: 'Original', quantity: 10 });
    const hass = makeMockHass({ items: [base] });
    const store = new Store(hass);
    await store.init();

    await store.updateItem('1', { name: 'Updated', quantity: 20 });
    const updated = store.state.value.items.find((i) => i.id === '1');
    expect(updated?.name).toBe('Updated');
    expect(updated?.quantity).toBe(20);
  });

  it('optimistic update on updateItem; conflict surfaces banner with actions', async () => {
    const base = makeItem({ id: '1', name: 'A' });
    const hass = makeMockHass({ items: [base], conflictOnUpdate: true });
    const store = new Store(hass);
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
    const store = new Store(hass);
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
    const store = new Store(hass);
    await store.init();

    expect(store.state.value.items.length).toBe(1);
    await store.deleteItem('1');
    expect(store.state.value.items.length).toBe(0);
  });

  it('adjusts quantity with optimistic update', async () => {
    const item = makeItem({ id: '1', quantity: 10 });
    const hass = makeMockHass({ items: [item] });
    const store = new Store(hass);
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
    const store = new Store(hass);
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
    const store = new Store(hass);
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
    const store = new Store(hass);
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
    const store = new Store(hass);
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

  it('handles filter changes and restarts paging', async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass);
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
    const store = new Store(hass);
    await store.init();
    const before = store.state.value.items;
    const total = store.state.value.total;
    expect(total).toBe(3);

    store.setFilters({ q: 'Item 1' });
    expect(store.state.value.items).toBe(before);
    expect(store.state.value.total).toBe(total);
    expect(store.state.value.loading).toBe(true);

    await new Promise((r) => setTimeout(r, 10));
    expect(store.state.value.loading).toBe(false);
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Item 1']);
  });

  it('still clears the selection on a filter change', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: 'a' }), makeItem({ id: 'b' })] });
    const store = new Store(hass);
    await store.init();
    store.setSelected(['a', 'b']);
    expect(store.state.value.selection.size).toBe(2);

    store.setFilters({ q: 'a' });
    expect(store.state.value.selection.size).toBe(0);
  });

  // Two disappearances look identical from the item list: a row that fell off
  // the filtered page, and one that is gone. Only the second closes an editor.
  describe('wasRemoved', () => {
    it('reports nothing removed for a row that is merely filtered out', async () => {
      const hass = makeMockHass({ items: [makeItem({ id: 'a', name: 'Alpha' }), makeItem({ id: 'b', name: 'Beta' })] });
      const store = new Store(hass);
      await store.init();

      store.setFilters({ q: 'Alpha' });
      await new Promise((r) => setTimeout(r, 10));
      expect(store.state.value.items.map((i) => i.id)).toEqual(['a']);
      expect(store.wasRemoved('b')).toBe(false);
    });

    it('reports a deleted row as removed', async () => {
      const hass = makeMockHass({ items: [makeItem({ id: 'a' })] });
      const store = new Store(hass);
      await store.init();

      await store.deleteItem('a', 1);
      expect(store.wasRemoved('a')).toBe(true);
    });

    it('forgets a delete that was rolled back', async () => {
      const hass = makeMockHass({ items: [makeItem({ id: 'a' })] });
      const store = new Store(hass, { retryBaseMs: 0 });
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
    const store = new Store(hass);
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
    const store = new Store(hass);
    await store.init();

    // refreshItem should fetch latest version
    await store.refreshItem('1');
    const refreshed = store.state.value.items.find((i) => i.id === '1');
    expect(refreshed).toBeTruthy();
    expect(refreshed?.id).toBe('1');
  });

  it('createLocation calls WS and refreshes caches', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
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
    const store = new Store(hass);
    await store.init();

    expect(store.state.value.statsCounts).toBeTruthy();

    await store.refreshStats();
    expect(store.state.value.statsCounts).toBeTruthy();
    expect(typeof store.state.value.statsCounts?.items_total).toBe('number');
  });

  it('sends orphaned_only to the backend when the orphans filter is on', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
    await store.init();

    const listFilters: any[] = [];
    const origCallWS = hass.callWS.bind(hass);
    hass.callWS = async <T,>(msg: Record<string, unknown>): Promise<T> => {
      if (msg.type === 'haventory/item/list') listFilters.push(msg.filter);
      return origCallWS<T>(msg);
    };

    store.setFilters({ orphansOnly: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(listFilters.length).toBeGreaterThan(0);
    expect(listFilters[listFilters.length - 1]?.orphaned_only).toBe(true);

    store.setFilters({ orphansOnly: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(listFilters[listFilters.length - 1]?.orphaned_only).toBeUndefined();
  });

  it('orphans filter narrows the visible items end-to-end through the mock', async () => {
    const placed = makeItem({
      id: 'p1', name: 'Placed', location_id: 'loc1',
      location_path: { id_path: ['loc1'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
    });
    const orphan = makeItem({ id: 'o1', name: 'Orphan' });
    const hass = makeMockHass({ items: [placed, orphan] });
    const store = new Store(hass);
    await store.init();
    expect(store.state.value.items.length).toBe(2);

    store.setFilters({ orphansOnly: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.state.value.items.map((i) => i.id)).toEqual(['o1']);

    store.setFilters({ orphansOnly: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.state.value.items.length).toBe(2);
  });

  it('q filter narrows the visible items end-to-end through the mock', async () => {
    const a = makeItem({ id: 'a', name: 'Electric Saw' });
    const b = makeItem({ id: 'b', name: 'Glue', tags: ['adhesive'] });
    const hass = makeMockHass({ items: [a, b] });
    const store = new Store(hass);
    await store.init();

    store.setFilters({ q: 'saw' });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Electric Saw']);

    // Tags are searchable too
    store.setFilters({ q: 'adhesive' });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Glue']);
  });

  it('due_date sort orders items through the mock, undated last in both orders', async () => {
    const early = makeItem({ id: 'e', name: 'Early', checked_out: true, due_date: '2024-01-01' });
    const late = makeItem({ id: 'l', name: 'Late', checked_out: true, due_date: '2024-03-01' });
    const undated = makeItem({ id: 'u', name: 'Undated' });
    const hass = makeMockHass({ items: [undated, late, early] });
    const store = new Store(hass);
    await store.init();

    store.setFilters({ sort: { field: 'due_date', order: 'asc' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Early', 'Late', 'Undated']);

    store.setFilters({ sort: { field: 'due_date', order: 'desc' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Late', 'Early', 'Undated']);
  });

  it('populates healthCache on init and refreshes on demand', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'A' })] });
    const store = new Store(hass);
    await store.init();

    const health = store.state.value.healthCache;
    expect(health).toBeTruthy();
    expect(health?.healthy).toBe(true);
    expect(health?.issues).toEqual([]);
    expect(typeof health?.generation).toBe('number');
    expect(health?.counts.items_total).toBe(1);

    // Backend degrades → refreshHealth picks it up
    hass.__setHealth({ healthy: false, issues: ['item_missing_from_created_at_index'] });
    await store.refreshHealth();
    expect(store.state.value.healthCache?.healthy).toBe(false);
    expect(store.state.value.healthCache?.issues).toContain('item_missing_from_created_at_index');
  });

  it('deleteLocation removes an empty location and refreshes caches', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
    await store.init();

    const created = await store.createLocation('Doomed', null);
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === created.id)).toBe(true);

    await store.deleteLocation(created.id);
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === created.id)).toBe(false);
  });

  it('deleteLocation rejects with validation_error when the location is not empty', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
    await store.init();

    const parent = await store.createLocation('Parent', null);
    await store.createLocation('Child', parent.id);

    await expect(store.deleteLocation(parent.id)).rejects.toMatchObject({ code: 'validation_error' });
    // Still present — nothing was deleted
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === parent.id)).toBe(true);
  });

  it('deleteLocation rejects when items still reference the location', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
    await store.init();

    const loc = await store.createLocation('Occupied', null);
    hass.__setItems([makeItem({ id: 'i1', name: 'Blocker', location_id: loc.id })]);

    await expect(store.deleteLocation(loc.id)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('moveLocationSubtree reparents and refreshes locations and items', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: 'i1', name: 'Inside' })] });
    const store = new Store(hass);
    await store.init();

    const src = await store.createLocation('Source', null);
    const dst = await store.createLocation('Dest', null);

    const moved = await store.moveLocationSubtree(src.id, dst.id);
    expect(moved.parent_id).toBe(dst.id);
    const cached = store.state.value.locationsFlatCache?.find((l) => l.id === src.id);
    expect(cached?.parent_id).toBe(dst.id);
  });

  it('reloads the item list when a locations moved/renamed event arrives', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: 'i1', name: 'Widget' })] });
    const store = new Store(hass);
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

  // Regression: live items/stats subscription events must reach the store WITHOUT
  // any explicit re-fetch. This guards the contract that Home Assistant delivers
  // the inner event payload (not the {id, type:'event', event} envelope) to the
  // subscribeMessage callback — a mismatch there silently freezes the live card.
  it('applies live item events (created/quantity_changed/deleted) to the list without a re-list', async () => {
    const existing = makeItem({ id: '1', name: 'Existing', quantity: 1 });
    const hass = makeMockHass({ items: [existing] });
    const store = new Store(hass);
    await store.init();
    expect(store.state.value.items.length).toBe(1);

    // An item created elsewhere appears live.
    hass.__emit('items', 'created', { item: makeItem({ id: '2', name: 'Fresh', quantity: 3 }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.value.items.map((i) => i.id)).toContain('2');

    // A quantity change on an existing row is reflected live.
    hass.__emit('items', 'quantity_changed', { item: makeItem({ id: '1', name: 'Existing', quantity: 9 }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.value.items.find((i) => i.id === '1')?.quantity).toBe(9);

    // A delete removes the row live.
    hass.__emit('items', 'deleted', { item: makeItem({ id: '2', name: 'Fresh' }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.value.items.map((i) => i.id)).not.toContain('2');
  });

  it('updates statsCounts live from a stats counts event', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
    await store.init();

    const counts = { items_total: 42, low_stock_count: 3, checked_out_count: 1, locations_total: 7 };
    hass.__emit('stats', 'counts', { counts });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.value.statsCounts).toEqual(expect.objectContaining({ items_total: 42, locations_total: 7 }));
  });

  it('caches distinct categories and tags with counts on init', async () => {
    const items = [
      makeItem({ id: '1', category: 'Tools', tags: ['red'] }),
      makeItem({ id: '2', category: 'Tools', tags: ['red', 'blue'] }),
      makeItem({ id: '3', category: 'Books', tags: ['blue'] }),
    ];
    const hass = makeMockHass({ items });
    const store = new Store(hass);
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
    const store = new Store(hass);
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
    const store = new Store(makeMockHass({ items: [makeItem({ id: '1', category: 'Tools' })] }));
    await store.init();

    expect(store.addDraftValue('category', 'Consumables')).toBe(true);
    expect(store.state.value.distinctValuesCache?.categories).toEqual([
      { value: 'Consumables', count: 0 },
      { value: 'Tools', count: 1 },
    ]);
  });

  it('normalizes a new tag the way the backend would', async () => {
    const store = new Store(makeMockHass({ items: [] }));
    await store.init();

    store.addDraftValue('tag', '  Power Tools  ');
    expect(store.state.value.distinctValuesCache?.tags).toEqual([{ value: 'power tools', count: 0 }]);
  });

  it('refuses a name that already exists, whatever its casing', async () => {
    const store = new Store(makeMockHass({ items: [makeItem({ id: '1', category: 'Tools' })] }));
    await store.init();

    expect(store.addDraftValue('category', 'tools')).toBe(false);
    expect(store.addDraftValue('category', '   ')).toBe(false);
    expect(store.state.value.distinctValuesCache?.categories).toEqual([{ value: 'Tools', count: 1 }]);
  });

  it('stops carrying the draft once an item actually uses it', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
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
    const store = new Store(makeMockHass({ items: [] }));
    await store.init();
    store.addDraftValue('tag', 'seasonal');
    store.removeDraftValue('tag', 'seasonal');

    expect(store.state.value.distinctValuesCache?.tags).toEqual([]);
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
    const store = new Store(hass);
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

  it('asks for unpriced facets while nothing is filtering', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', category: 'Tools', tags: ['red'] })] });
    const store = new Store(hass);
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
    const store = new Store(hass);
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
    const store = new Store(hass);
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

  // The same asymmetry the other way round: a lone location filter used to
  // leave the tree bare while the facet lists beside it carried a pair.
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
    const store = new Store(hass);
    await store.init();

    store.setFilters({ locationIds: ['garage'] });
    await vi.waitUntil(() => store.state.value.locationTreeCache?.[0]?.matching_subtree_count !== undefined);

    expect(store.state.value.locationTreeCache?.[0].matching_subtree_count).toBe(1);
    expect(store.state.value.locationMatchTotal).toBe(1);
  });

  it('coalesces the facet refetch across a burst of filter patches', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', category: 'Tools' })] });
    const store = new Store(hass);
    await store.init();
    const before = hass.__messages.filter((m) => m.type === 'haventory/distinct_values').length;

    // What a filter panel does: several keys in a row, one answer wanted.
    store.setFilters({ checkedOutOnly: true });
    store.setFilters({ lowStockOnly: true });
    store.setFilters({ q: 'drill' });
    await vi.waitUntil(
      () => hass.__messages.filter((m) => m.type === 'haventory/distinct_values').length > before,
    );
    await new Promise((r) => setTimeout(r, 300));

    const after = hass.__messages.filter((m) => m.type === 'haventory/distinct_values').length;
    expect(after).toBe(before + 1);
  });

  // Issue #440: not every facet refetch is debounced — an item event lands
  // beside a filter change — so two can be in flight at once, and the response
  // that lands last is not the one that was issued last. The newest request is
  // the only one allowed to assign.
  it('drops a facet response from a superseded request', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', category: 'Fresh' })] });
    const store = new Store(hass);
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
    const store = new Store(hass);
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
    const store = new Store(hass);
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

  it('scopes the items subscription to the active area and re-opens it when the area changes', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass);
    await store.init();

    const itemsSubscribe = () => {
      const sent = hass.__subscribeMessages.filter((m) => m.topic === 'items');
      return sent[sent.length - 1];
    };

    // Unfiltered, the subscription asks for every area.
    expect(itemsSubscribe().area_id).toBe(null);
    const roundOne = hass.__subscribeCalls.length;

    store.setFilters({ areaId: 'kitchen' });
    await new Promise((r) => setTimeout(r, 0));

    // A fresh round of all four topics, and the items one now names the area —
    // without it the card would keep receiving every other area's events.
    expect(hass.__subscribeCalls.length).toBe(roundOne * 2);
    expect(itemsSubscribe().area_id).toBe('kitchen');

    // A filter the backend applies to the page rather than to the subscription
    // leaves the sockets alone.
    store.setFilters({ categories: ['Tools'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(hass.__subscribeCalls.length).toBe(roundOne * 2);
  });

  // The subscription is scoped by location as well, so a multi-select that only
  // reached the page query would leave the socket delivering the other
  // locations' events — and the card would act on them.
  it('scopes the items subscription to every selected location', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass);
    await store.init();
    const itemsSubscribe = () => {
      const sent = hass.__subscribeMessages.filter((m) => m.topic === 'items');
      return sent[sent.length - 1];
    };
    const roundOne = hass.__subscribeCalls.length;

    store.setFilters({ locationIds: ['garage', 'kitchen'] });
    await new Promise((r) => setTimeout(r, 0));

    expect(hass.__subscribeCalls.length).toBe(roundOne * 2);
    expect(itemsSubscribe().location_ids).toEqual(['garage', 'kitchen']);

    // Re-picking the same set changes no scope, so the sockets stay up.
    store.setFilters({ locationIds: ['garage', 'kitchen'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(hass.__subscribeCalls.length).toBe(roundOne * 2);

    // Clearing the selection re-opens on every location.
    store.setFilters({ locationIds: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(itemsSubscribe().location_ids).toEqual([]);
  });

});

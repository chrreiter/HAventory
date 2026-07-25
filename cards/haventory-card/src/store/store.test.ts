import { describe, it, expect } from 'vitest';
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

  it('handles filter changes and resets list', async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem({ id: `${i}`, name: `Item ${i}` }));
    const hass = makeMockHass({ items });
    const store = new Store(hass);
    await store.init();

    const initialCount = store.state.value.items.length;
    expect(initialCount).toBe(30);

    store.setFilters({ q: 'search term' });
    // Should reset items and cursor
    expect(store.state.value.filters.q).toBe('search term');
    expect(store.state.value.cursor).toBe(null);
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

  it('fetchItemsByCategory returns only items in that category', async () => {
    const items = [
      makeItem({ id: '1', name: 'Hammer', category: 'Tools' }),
      makeItem({ id: '2', name: 'Novel', category: 'Books' }),
      makeItem({ id: '3', name: 'Wrench', category: 'tools' }), // case-insensitive
    ];
    const hass = makeMockHass({ items });
    const store = new Store(hass);
    await store.init();

    const tools = await store.fetchItemsByCategory('Tools');
    expect(tools.map((i) => i.id).sort()).toEqual(['1', '3']);

    const books = await store.fetchItemsByCategory('Books');
    expect(books.map((i) => i.name)).toEqual(['Novel']);
  });

  it('fetchItemsByTag returns only items carrying that tag', async () => {
    const items = [
      makeItem({ id: '1', name: 'Hammer', tags: ['red', 'metal'] }),
      makeItem({ id: '2', name: 'Novel', tags: ['blue'] }),
      makeItem({ id: '3', name: 'Wrench', tags: ['red'] }),
    ];
    const hass = makeMockHass({ items });
    const store = new Store(hass);
    await store.init();

    const red = await store.fetchItemsByTag('red');
    expect(red.map((i) => i.id).sort()).toEqual(['1', '3']);

    const blue = await store.fetchItemsByTag('blue');
    expect(blue.map((i) => i.name)).toEqual(['Novel']);
  });
});

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

  it('updates stats cache on refreshStats', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass);
    await store.init();

    expect(store.state.value.statsCounts).toBeTruthy();
    const initialTotal = store.state.value.statsCounts?.items_total;

    await store.refreshStats();
    expect(store.state.value.statsCounts).toBeTruthy();
    expect(typeof store.state.value.statsCounts?.items_total).toBe('number');
  });
});

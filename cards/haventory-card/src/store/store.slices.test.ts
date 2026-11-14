import { describe, it, expect, vi } from 'vitest';
import { Store } from './store';
import { Slice, combineSlices } from './slice';
import { makeMockHass, makeItem } from '../test.utils';

/**
 * The store's state is held in slices, each notified on its own: a banner or a
 * count changing must not wake a surface that reads only the location tree.
 * `state` still reads every slice as one flat object.
 */

const fast = { retryBaseMs: 0 };

describe('Slice', () => {
  it('notifies on a change and stays quiet on a patch that changes nothing', () => {
    const slice = new Slice({ count: 0, label: 'a' });
    const seen = vi.fn();
    slice.onChange(seen);

    slice.set({ count: 0 });
    expect(seen).not.toHaveBeenCalled();
    slice.set({ count: 1, label: 'a' });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(slice.value).toEqual({ count: 1, label: 'a' });
  });

  it('reads through a combined view that a caller can hold across changes', () => {
    const a = new Slice({ x: 1 });
    const b = new Slice({ y: 'one' });
    const view = combineSlices({ a, b });
    const held = view.value;
    const seen = vi.fn();
    const off = view.onChange(seen);

    b.set({ y: 'two' });
    expect(held.y).toBe('two');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    a.set({ x: 2 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect({ ...held }).toEqual({ x: 2, y: 'two' });
  });
});

describe('Store: slice notifications', () => {
  it('does not wake a location-only watcher for an item event', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1', quantity: 1 })] });
    const store = new Store(hass, fast);
    await store.init();

    const locations = vi.fn();
    const list = vi.fn();
    const any = vi.fn();
    store.watch(['locations'], locations);
    store.watch(['list'], list);
    store.state.onChange(any);

    hass.__emit('items', 'quantity_changed', { item: makeItem({ id: '1', quantity: 2, version: 2 }) });

    expect(store.state.value.items[0]?.quantity).toBe(2);
    expect(list).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(1);
    expect(locations).not.toHaveBeenCalled();
    store.dispose();
  });

  it('does not wake a list watcher when only the error queue moves', async () => {
    const store = new Store(makeMockHass({ items: [] }), fast);
    await store.init();
    const list = vi.fn();
    const errors = vi.fn();
    store.watch(['list'], list);
    store.watch(['errors'], errors);

    store['pushError']({ code: 'validation_error', message: 'nope' });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();

    const id = store.state.value.errorQueue[0]!.id;
    store.dismissError(id);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(list).not.toHaveBeenCalled();
    store.dispose();
  });

  it('stops calling a watcher once it unsubscribes', async () => {
    const store = new Store(makeMockHass({ items: [] }), fast);
    await store.init();
    const seen = vi.fn();
    const off = store.watch(['list', 'errors'], seen);
    off();
    store.setSelected(['x']);
    store['pushError']({ code: 'validation_error', message: 'nope' });
    expect(seen).not.toHaveBeenCalled();
    store.dispose();
  });
});

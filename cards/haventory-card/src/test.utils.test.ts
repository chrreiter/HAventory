import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeItem, makeMockHass } from './test.utils';
import type { Item } from './store/types';

// Fixtures must not order themselves off the wall clock: the default sort is
// `updated_at` descending with an id-ascending tie-break, so a stamp that moves
// between two constructions silently reverses the list a spec asserts on.
describe('makeItem fixtures', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps every default fixture identically however much time passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
    const first = makeItem({ id: '1' });
    vi.setSystemTime(new Date('2026-08-02T10:00:00.001Z'));
    const second = makeItem({ id: '2' });

    expect(second.updated_at).toBe(first.updated_at);
    expect(second.created_at).toBe(first.created_at);
  });

  it('gives anonymous fixtures distinct ids in construction order', () => {
    const first = makeItem();
    const second = makeItem();

    expect(first.id).not.toBe(second.id);
    expect(first.id < second.id).toBe(true);
  });

  it('takes an explicit stamp when a spec needs one', () => {
    const pinned = makeItem({ id: '1', updated_at: '2026-07-04T00:00:00.000Z' });

    expect(pinned.updated_at).toBe('2026-07-04T00:00:00.000Z');
  });

  it('lists two default fixtures in id order across a clock tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
    const one = makeItem({ id: '1', name: 'Wood Glue' });
    vi.setSystemTime(new Date('2026-08-02T10:00:00.001Z'));
    const two = makeItem({ id: '2', name: 'Clamps' });
    vi.useRealTimers();

    const hass = makeMockHass({ items: [two, one] });
    const page = await hass.callWS<{ items: Item[] }>({
      type: 'haventory/item/list',
      sort: { field: 'updated_at', order: 'desc' },
    });

    expect(page.items.map((i) => i.id)).toEqual(['1', '2']);
  });
});

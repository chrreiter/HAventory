import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Store } from './store';
import { makeMockHass, makeItem, callCount } from '../test.utils';

/**
 * A file of its own, because the day clock is module state: it arms on its
 * first subscriber and every later one joins the deadline already set. A store
 * built by another spec in the same file would therefore have armed it against
 * the real midnight, and the fake clock here would never reach it.
 *
 * What is under test is the backstop for a device that slept through the
 * backend's own midnight broadcast of the counts.
 */
const TOMORROW = '2026-08-23';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 22, 23, 59, 58));
});

afterEach(() => {
  vi.useRealTimers();
});

/** One item due tomorrow, and a count of the `haventory/stats` reads so far. */
async function mountClock() {
  const hass = makeMockHass({ items: [makeItem({ id: '1', inspection_date: TOMORROW })] });
  const store = new Store(hass);
  await store.init();
  const statsCalls = () => callCount(hass, 'haventory/stats');
  return { store, statsCalls };
}

describe('Store and the day clock', () => {
  it('re-reads the counts when the day turns over', async () => {
    const { store, statsCalls } = await mountClock();
    expect(store.state.value.statsCounts?.inspection_due_count).toBe(0);
    const before = statsCalls();

    await vi.advanceTimersByTimeAsync(3_000);

    expect(statsCalls()).toBe(before + 1);
    expect(store.state.value.statsCounts?.inspection_due_count).toBe(1);
    store.dispose();
  });

  it('stops reading once the store is disposed', async () => {
    const { store, statsCalls } = await mountClock();
    const before = statsCalls();

    store.dispose();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(statsCalls()).toBe(before);
  });

  it('leaves the counts alone until the day actually turns', async () => {
    const { store, statsCalls } = await mountClock();
    const before = statsCalls();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(statsCalls()).toBe(before);
    expect(store.state.value.statsCounts?.inspection_due_count).toBe(0);
    store.dispose();
  });
});

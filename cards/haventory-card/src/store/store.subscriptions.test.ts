import { describe, it, expect, vi } from 'vitest';
import { Store } from './store';
import { makeMockHass, makeItem } from '../test.utils';

/**
 * Opening, scoping and closing the sockets: the four topics the card subscribes
 * to, the area and location scope it asks them for, and the Home Assistant area
 * registry it watches beside them.
 */

/** Stores under test never wait on real backoff. */
const fast = { retryBaseMs: 0 };

describe('Store', () => {
  it('scopes the items subscription to the active area and re-opens it when the area changes', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
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
    const store = new Store(hass, fast);
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

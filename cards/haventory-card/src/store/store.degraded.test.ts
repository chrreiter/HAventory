import { describe, it, expect, vi } from 'vitest';
import { makeMockHass, makeItem } from '../test.utils';
import { Store, subscribeRetryDelayMs } from './store';

/**
 * A backend that goes away, comes back, or was never up yet, and a socket that
 * drops under an idle surface: what the card retries, how long it waits, what it
 * tells the user, and when it stops.
 */

/** Stores under test never wait on real backoff. */
const fast = { retryBaseMs: 0 };

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

describe('Store: the backend going away and coming back', () => {
  const UNAVAILABLE = { code: 'storage_error', message: 'repository not initialized; run integration setup' };

  /** What a config-entry teardown puts on every open subscription. */
  function tearDown(hass: ReturnType<typeof makeMockHass>) {
    hass.__emit('items', 'unavailable', {});
    hass.__emit('locations', 'unavailable', {});
    hass.__emit('stats', 'unavailable', {});
  }

  it('re-opens the subscriptions a reload took away', async () => {
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();
    expect(hass.__subscribeCalls).toHaveLength(4);

    tearDown(hass);
    await flush(3);

    // One more round, and live updates are back without the user touching
    // anything — a reload must not cost a manual refresh.
    expect(hass.__subscribeCalls).toHaveLength(8);
    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.degraded.liveUpdatesReason).toBeNull();
    expect(store.state.value.connected.items).toBe(true);
    expect(store.state.value.errorQueue).toEqual([]);
    hass.__emit('items', 'created', { item: makeItem({ id: '9' }) });
    expect(store.state.value.items.map((i) => i.id)).toContain('9');
  });

  it('waits out the window in which the backend is still refusing', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    // Setup has not finished, so the first two re-subscribe rounds are refused
    // exactly the way a command is during a reload.
    hass.__failSubscribeNext(6, UNAVAILABLE);
    tearDown(hass);
    await settleSubscribes();
    expect(store.state.value.degraded.liveUpdates).toBe('retrying');
    expect(store.state.value.degraded.liveUpdatesReason).toBe('unavailable');

    await flush(6);

    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.degraded.liveUpdatesReason).toBeNull();
    // Nothing reached the user: waiting out a reload is not an error.
    expect(store.state.value.errorQueue).toEqual([]);
  });

  it('re-reads the inventory once the backend answers again', async () => {
    // A backend that went away and came back re-read its store, and every event
    // in between went to a subscription that no longer existed.
    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'Before' })] });
    const store = new Store(hass, fast);
    await store.init();
    expect(store.state.value.items.map((i) => i.name)).toEqual(['Before']);

    hass.__setItems([makeItem({ id: '2', name: 'After' })]);
    tearDown(hass);
    await flush(4);

    expect(store.state.value.items.map((i) => i.name)).toEqual(['After']);
  });

  it('gives up once the budget is spent, and says what stopped', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    // Disabled or removed rather than reloading: nothing is coming back.
    hass.__failSubscribe(UNAVAILABLE);
    tearDown(hass);
    await flush(20);

    expect(store.state.value.degraded.liveUpdates).toBe('paused');
    expect(store.state.value.degraded.liveUpdatesReason).toBe('unavailable');
    expect(store.state.value.degraded.nextLiveRetryAt).toBeNull();
    expect(store.state.value.connected.items).toBe(false);
    // Reported once, when retrying is over — not on every attempt.
    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['storage_error']);
    // The first round from init plus a bounded seven, four topics each.
    expect(hass.__subscribeCalls).toHaveLength(32);

    // The budget stays spent until something restarts it.
    await flush(6);
    expect(hass.__subscribeCalls).toHaveLength(32);
  });

  it('treats one teardown as one outage, however many topics report it', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    // All four topics carry the same signal; four re-subscribe rounds for one
    // reload would triple the load on a backend that is still starting up.
    tearDown(hass);
    await flush(3);

    expect(hass.__subscribeCalls).toHaveLength(8);
  });

  it('starts a fresh budget for a second teardown', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, fast);
    await store.init();

    tearDown(hass);
    await flush(3);
    expect(store.state.value.degraded.liveUpdates).toBe('live');

    // A dashboard open for days sees more than one reload; the second must not
    // inherit an exhausted budget from the first.
    hass.__failSubscribeNext(3, UNAVAILABLE);
    tearDown(hass);
    await flush(4);

    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(store.state.value.errorQueue).toEqual([]);
  });
});

describe('subscribeRetryDelayMs', () => {
  it('prefers the envelope hint over the backoff, in either unit', () => {
    expect(subscribeRetryDelayMs({ data: { retry_after_ms: 250 } }, 0, 400)).toBe(250);
    // Seconds, the HTTP Retry-After convention.
    expect(subscribeRetryDelayMs({ data: { retry_after: 2 } }, 0, 400)).toBe(2000);
    // The card's own error entries name the bag `context`.
    expect(subscribeRetryDelayMs({ context: { retry_after_ms: 30 } }, 3, 400)).toBe(30);
  });

  it('backs off exponentially when the envelope carries no hint', () => {
    const delays = [0, 1, 2, 3].map((attempt) => subscribeRetryDelayMs({}, attempt, 400));
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
  });

  it('does not count the taxonomy catch-all toward an outage', async () => {
    // `unknown_error` is the backend's own answer to a command it could not
    // carry out. It travelled the socket to get here, so it proves the transport
    // works — reporting it as an outage would blame the connection for a fault
    // that is entirely server-side.
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(3, { code: 'unknown_error', message: 'boom' });
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);

    expect(store.state.value.degraded.connectionLost).toBe(false);
    expect(store.state.value.errorQueue.map((e) => e.message)).toEqual(['boom', 'boom', 'boom']);
  });

  it('names a transport failure rather than borrowing the catch-all', async () => {
    // Home Assistant rejects a call the socket never carried with a wrapper of
    // its own: no top-level code, no message a person could read. Reported
    // verbatim it says "Unknown error", which reads as a fault in what the user
    // just did rather than in the connection.
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(1, { type: 'result', success: false, error: { code: 3, message: 'Connection lost' } });
    await store.adjustQuantity('1', 1);

    expect(store.state.value.errorQueue).toHaveLength(1);
    expect(store.state.value.errorQueue[0].code).toBe('connection_lost');
    expect(store.state.value.errorQueue[0].message).toContain('Could not reach Home Assistant');
  });

  it('queues one entry for an outage however many calls fail', async () => {
    // An outage fails everything in flight and everything tried next. Stacking
    // one banner per call buries the rest of the queue under copies of a
    // sentence the user has already read.
    const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
    const store = new Store(hass, fast);
    await store.init();

    hass.__failNext(4, new Error('socket closed'));
    await store.adjustQuantity('1', 1);
    await store.adjustQuantity('1', 1);
    await store.refreshStats().catch(() => undefined);
    await store.refreshHealth().catch(() => undefined);

    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['connection_lost']);
    expect(store.state.value.degraded.connectionLost).toBe(true);

    // Dismissing it is not a permanent silence: the next failure says so again.
    store.dismissError(store.state.value.errorQueue[0].id);
    hass.__failNext(1, new Error('socket closed'));
    await store.adjustQuantity('1', 1);
    expect(store.state.value.errorQueue.map((e) => e.code)).toEqual(['connection_lost']);
  });
});

describe('Store: an idle surface going offline', () => {
  const backoff = { retryBaseMs: 10 };

  it('says the connection is lost when the socket closes and stays closed', async () => {
    // Nobody is touching this surface, so no call can report the outage. Without
    // the socket's own event the list would sit there showing pre-outage data
    // until someone tried something and got a failure.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.state.value.degraded.connectionLost).toBe(true);
      // The degraded stack carries this one; nothing was refused, so nothing
      // belongs in the queue of refused operations.
      expect(store.state.value.errorQueue).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sits out a reconnect that lands inside the grace period', async () => {
    // Home Assistant reconnects by itself and a blip is over before anyone could
    // act on it. Announcing it at once would flash a banner and withdraw it.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(500);
      expect(store.state.value.degraded.connectionLost).toBe(false);

      hass.__connectionReady();
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sits out a reconnect that lands on the three-second retry rung', async () => {
    // Home Assistant's client retries on a ladder — at once, then +1 s, +3 s,
    // +6 s — so a socket dropped while the network is briefly away misses the
    // first two rungs and returns on the third. That is an ordinary Wi-Fi roam
    // and the grace period exists to sit it out; a shorter one would put a
    // banner up and take it down again a second later.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(3_100);
      expect(store.state.value.degraded.connectionLost).toBe(false);

      hass.__connectionReady();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the banner back down when the socket returns', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(5000);
      expect(store.state.value.degraded.connectionLost).toBe(true);

      hass.__connectionReady();
      await vi.advanceTimersByTimeAsync(300);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops watching the socket once the store is disposed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      const store = new Store(hass, backoff);
      await store.init();

      store.dispose();
      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.state.value.degraded.connectionLost).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Store: a card built while the backend cannot answer', () => {
  const backoff = { retryBaseMs: 10 };
  // Home Assistant rebuilds the Lovelace view when its socket reconnects, and a
  // restarting instance serves that rebuild before the integration is set up
  // again. Every command the fresh card makes is refused, so its first load
  // fails outright — the one case where the routes back into the data must
  // still be opened.
  const REFUSED = { code: 'unknown_command', message: 'Unknown command.' };

  it('still watches the socket after a first load that failed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      hass.__failNext(50, REFUSED);
      const store = new Store(hass, backoff);
      await store.init().catch(() => undefined);

      // Driving the watch is the only honest proof it was attached.
      hass.__disconnect();
      await vi.advanceTimersByTimeAsync(6_000);

      expect(store.state.value.degraded.connectionLost).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still opens the subscriptions after a first load that failed', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      hass.__failNext(50, REFUSED);
      const store = new Store(hass, backoff);
      await store.init().catch(() => undefined);

      expect(hass.__subscribeCalls).toContain('items');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits out a subscribe refused because the command is not registered yet', async () => {
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      hass.__failSubscribeNext(4, REFUSED);
      const store = new Store(hass, backoff);
      await store.init();

      // Retrying, not paused: an unregistered command says the backend is early,
      // and pausing would ask the user to act on something that fixes itself.
      expect(store.state.value.degraded.liveUpdates).toBe('retrying');
      expect(store.state.value.degraded.liveUpdatesReason).toBe('unavailable');
      expect(store.state.value.errorQueue).toEqual([]);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(store.state.value.degraded.liveUpdates).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the inventory once the backend starts answering', async () => {
    // Nothing the user does is involved: the refused subscribe retries on its
    // own backoff, and landing it re-reads everything the failed load missed.
    vi.useFakeTimers();
    try {
      const hass = makeMockHass({ items: [makeItem({ id: '1' })] });
      // Exactly the loads `init` starts in parallel, so the refusal window
      // closes with it and the recovery that follows is answered normally. The
      // empty-list assertion below is what catches this count going stale.
      hass.__failNext(8, REFUSED);
      // The subscribe is refused the same way the commands were: a restarting
      // instance has no `haventory/subscribe` registered yet either.
      hass.__failSubscribeNext(4, REFUSED);
      const store = new Store(hass, backoff);
      await store.init().catch(() => undefined);
      expect(store.state.value.items).toEqual([]);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(store.state.value.items.map((i) => i.id)).toEqual(['1']);
      expect(store.state.value.degraded.liveUpdates).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });
});

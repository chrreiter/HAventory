import { WSClient } from './ws';
import type { AnyEventPayload, HassLike } from './types';

/**
 * `WSClient` is the only place the card decides what actually goes on the wire,
 * and `makeMockHass` is deliberately lenient about it: `item/update` strips
 * `expected_version` before applying, and `subscribeMessage` hands back a plain
 * function. Both leniencies are useful for the store tests and both hide code
 * here, so this file drives `WSClient` against purpose-built doubles instead.
 */

/** Records every message and returns whatever the test queues up. */
function makeSpyHass(): HassLike & { sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    callWS<T>(msg: Record<string, unknown>): Promise<T> {
      sent.push(msg);
      return Promise.resolve(undefined as T);
    },
    connection: {
      subscribeMessage() {
        return () => undefined;
      },
    },
  } as unknown as HassLike & { sent: Record<string, unknown>[] };
}

describe('WSClient payload shaping', () => {
  it('sends expected_version only when one was supplied', async () => {
    // Optimistic concurrency is invisible to every other test in the suite: the
    // mock backend discards `expected_version` before applying an update, so the
    // whole argument chain could be dropped with the suite still green.
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.updateItem('i1', { name: 'x' }, 7);
    await ws.updateItem('i2', { name: 'y' });

    expect(hass.sent[0]).toMatchObject({ type: 'haventory/item/update', item_id: 'i1', name: 'x', expected_version: 7 });
    expect(hass.sent[1]).not.toHaveProperty('expected_version');
  });

  it('carries expected_version on every mutation that accepts one', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.deleteItem('i1', 3);
    await ws.adjustQuantity('i1', -1, 4);
    await ws.setQuantity('i1', 9, 5);
    await ws.markCheckedIn('i1', 6);
    await ws.setLowStockThreshold('i1', 2, 7);
    await ws.moveItem('i1', 'loc-1', 8);

    expect(hass.sent.map((m) => m.expected_version)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('treats version 0 as a real version rather than as absent', () => {
    // The guard is `typeof v === 'number'`, not a truthiness check — a falsy-but-
    // valid 0 must still reach the wire.
    const hass = makeSpyHass();
    void new WSClient(hass).updateItem('i1', { name: 'x' }, 0);
    expect(hass.sent[0]).toHaveProperty('expected_version', 0);
  });

  it('distinguishes an explicit null due date from an omitted one', async () => {
    // `check_out` with `due_date: null` clears the date; omitting the key leaves
    // the server's own default in place. `!== undefined` is what separates them.
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.checkOut('i1', null, 3);
    await ws.checkOut('i2');

    expect(hass.sent[0]).toHaveProperty('due_date', null);
    expect(hass.sent[1]).not.toHaveProperty('due_date');
  });

  it('omits every optional list key when it was not asked for', async () => {
    const hass = makeSpyHass();
    await new WSClient(hass).listItems();
    expect(hass.sent[0]).toEqual({ type: 'haventory/item/list' });
  });

  it('includes only the list keys it was given', async () => {
    const hass = makeSpyHass();
    await new WSClient(hass).listItems({ q: 'drill' }, undefined, 50);
    expect(hass.sent[0]).toEqual({ type: 'haventory/item/list', filter: { q: 'drill' }, limit: 50 });
  });

  it('sends only the custom-field halves that were provided', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.updateCustomFields('i1', { a: 1 }, undefined);
    await ws.updateCustomFields('i2', undefined, ['b']);

    expect(hass.sent[0]).toHaveProperty('set', { a: 1 });
    expect(hass.sent[0]).not.toHaveProperty('unset');
    expect(hass.sent[1]).toHaveProperty('unset', ['b']);
    expect(hass.sent[1]).not.toHaveProperty('set');
  });

  it('omits parent_id and area_id on create unless they were passed', async () => {
    // `undefined` means "not asked"; an explicit null means "top level" / "no
    // area", so the two cannot collapse into one check.
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.createLocation('Shed');
    await ws.createLocation('Bin', null, null);

    expect(hass.sent[0]).toEqual({ type: 'haventory/location/create', name: 'Shed' });
    expect(hass.sent[1]).toMatchObject({ parent_id: null, area_id: null });
  });

  it('sends only the location fields the caller changed', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.updateLocation('l1', { name: 'Attic' });
    await ws.updateLocation('l2', { newParentId: null });

    expect(hass.sent[0]).toEqual({ type: 'haventory/location/update', location_id: 'l1', name: 'Attic' });
    expect(hass.sent[1]).toHaveProperty('new_parent_id', null);
    expect(hass.sent[1]).not.toHaveProperty('name');
  });
});

/** A `subscribeMessage` that resolves later, the way real Home Assistant does. */
function makeDeferredSubHass() {
  let resolveSub!: (fn: () => void) => void;
  const unsub = vi.fn();
  const hass = {
    callWS: () => Promise.resolve(undefined),
    connection: {
      subscribeMessage(_cb: (e: AnyEventPayload) => void, _msg: Record<string, unknown>) {
        return new Promise<() => void>((res) => {
          resolveSub = res;
        });
      },
    },
  } as unknown as HassLike;
  return { hass, unsub, settle: () => resolveSub(unsub) };
}

describe('WSClient.subscribe when Home Assistant returns a promise', () => {
  // The shared mock returns a plain function, so this whole branch — the one that
  // runs against a real HA — is otherwise never executed.

  it('unsubscribes through the function the promise resolved to', async () => {
    const { hass, unsub, settle } = makeDeferredSubHass();
    const stop = new WSClient(hass).subscribe('items', () => undefined);

    settle();
    await Promise.resolve();

    stop();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('honours an unsubscribe issued before the promise settles', async () => {
    // Tearing a card down inside the subscribe round trip must not leak the
    // subscription: the cancel is remembered and applied on resolve.
    const { hass, unsub, settle } = makeDeferredSubHass();
    const stop = new WSClient(hass).subscribe('items', () => undefined);

    stop();
    expect(unsub).not.toHaveBeenCalled();

    settle();
    await Promise.resolve();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected subscribe through onError', async () => {
    const err = { code: 'rate_limited', message: 'slow down' };
    const hass = {
      callWS: () => Promise.resolve(undefined),
      connection: { subscribeMessage: () => Promise.reject(err) },
    } as unknown as HassLike;
    const onError = vi.fn();

    new WSClient(hass).subscribe('items', () => undefined, { onError });
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('passes the inner event payload straight to the callback', () => {
    // HA delivers the `event` field of the wire frame, not the envelope, so the
    // client must not unwrap a second time.
    let cb!: (e: unknown) => void;
    const hass = {
      callWS: () => Promise.resolve(undefined),
      connection: {
        subscribeMessage(fn: (e: unknown) => void) {
          cb = fn;
          return () => undefined;
        },
      },
    } as unknown as HassLike;
    const seen: unknown[] = [];

    new WSClient(hass).subscribe('items', (p) => seen.push(p));
    cb({ topic: 'items', action: 'created', item: { id: 'i1' } });
    cb(null);

    expect(seen).toEqual([{ topic: 'items', action: 'created', item: { id: 'i1' } }]);
  });

  it('scopes an items subscription by location only when asked', () => {
    const sent: Record<string, unknown>[] = [];
    const hass = {
      callWS: () => Promise.resolve(undefined),
      connection: {
        subscribeMessage(_cb: unknown, msg: Record<string, unknown>) {
          sent.push(msg);
          return () => undefined;
        },
      },
    } as unknown as HassLike;
    const ws = new WSClient(hass);

    ws.subscribe('items', () => undefined, { location_id: 'l1', include_subtree: true });
    ws.subscribe('stats', () => undefined);

    expect(sent[0]).toMatchObject({ topic: 'items', location_id: 'l1', include_subtree: true });
    expect(sent[1]).not.toHaveProperty('location_id');
  });
});

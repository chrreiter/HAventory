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

describe('WSClient attachments', () => {
  /** A hass that records the upload POST and the WS frames that follow it. */
  function makeUploadHass(response?: Partial<Response>) {
    const sent: Record<string, unknown>[] = [];
    const posts: { path: string; init?: RequestInit }[] = [];
    const hass = {
      sent,
      posts,
      callWS<T>(msg: Record<string, unknown>): Promise<T> {
        sent.push(msg);
        return Promise.resolve(undefined as T);
      },
      fetchWithAuth(path: string, init?: RequestInit) {
        posts.push({ path, init });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ file_id: 'upload-1' }),
          ...response,
        } as Response);
      },
      connection: { subscribeMessage: () => () => undefined },
    };
    return hass as unknown as HassLike & { sent: Record<string, unknown>[]; posts: typeof posts };
  }

  it('POSTs the bytes to core and then names the handle over the socket', async () => {
    // The WebSocket carries JSON frames; an 8 MB photo base64'd into one would
    // be both slower and larger, so the bytes go over HTTP instead.
    const hass = makeUploadHass();
    const ws = new WSClient(hass);

    await ws.uploadAttachment('i-1', new File(['x'], 'drill.png', { type: 'image/png' }));

    expect(hass.posts[0].path).toBe('/api/file_upload');
    expect(hass.posts[0].init?.method).toBe('POST');
    expect(hass.posts[0].init?.body).toBeInstanceOf(FormData);
    expect(hass.sent[0]).toEqual({
      type: 'haventory/item/attachment/add',
      item_id: 'i-1',
      file_id: 'upload-1',
      kind: 'picture',
      filename: 'drill.png',
    });
  });

  it('sends expected_version only when one was supplied', async () => {
    const hass = makeUploadHass();
    const ws = new WSClient(hass);

    await ws.uploadAttachment('i-1', new File(['x'], 'a.png'), 'picture', 4);
    await ws.uploadAttachment('i-1', new File(['x'], 'b.png'));

    expect(hass.sent[0]).toMatchObject({ expected_version: 4 });
    expect(hass.sent[1]).not.toHaveProperty('expected_version');
  });

  it('never reaches the socket when the upload itself failed', async () => {
    const hass = makeUploadHass({ ok: false, status: 413 });
    const ws = new WSClient(hass);

    await expect(
      ws.uploadAttachment('i-1', new File(['x'], 'huge.png')),
    ).rejects.toThrow(/413/);
    expect(hass.sent).toEqual([]);
  });

  it('says so plainly when the connection cannot upload at all', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await expect(ws.uploadAttachment('i-1', new File(['x'], 'a.png'))).rejects.toThrow(
      /cannot upload files/,
    );
  });

  it('names the kind the file is being attached as', async () => {
    const hass = makeUploadHass();
    const ws = new WSClient(hass);

    await ws.uploadAttachment('i-1', new File(['x'], 'manual.pdf'), 'manual');

    expect(hass.sent[0]).toMatchObject({ kind: 'manual', filename: 'manual.pdf' });
  });

  it('retitles an attachment without touching its filename', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.updateAttachment('i-1', 'att-1', 'Dishwasher manual', 6);

    expect(hass.sent[0]).toEqual({
      type: 'haventory/item/attachment/update',
      item_id: 'i-1',
      attachment_id: 'att-1',
      title: 'Dishwasher manual',
      expected_version: 6,
    });
  });

  it('clears a title with an empty string rather than omitting the field', async () => {
    // Omitting it would read as "leave the title alone", so a user who clears
    // the field would keep the old title.
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.updateAttachment('i-1', 'att-1', '');

    expect(hass.sent[0]).toMatchObject({ title: '' });
    expect(hass.sent[0]).not.toHaveProperty('expected_version');
  });

  it('reorders one kind by naming its whole order', async () => {
    // Position 0 is what makes a picture the cover, so "make cover" is this
    // command rather than a flag of its own.
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.reorderAttachments('i-1', 'picture', ['c', 'a', 'b']);

    expect(hass.sent[0]).toEqual({
      type: 'haventory/item/attachment/reorder',
      item_id: 'i-1',
      kind: 'picture',
      attachment_ids: ['c', 'a', 'b'],
    });
  });

  it('removes an attachment by both ids', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.removeAttachment('i-1', 'att-1', 6);

    expect(hass.sent[0]).toEqual({
      type: 'haventory/item/attachment/remove',
      item_id: 'i-1',
      attachment_id: 'att-1',
      expected_version: 6,
    });
  });

  it('signs a media path through core, and hands back the signed one', async () => {
    const sent: Record<string, unknown>[] = [];
    const hass = {
      callWS<T>(msg: Record<string, unknown>): Promise<T> {
        sent.push(msg);
        return Promise.resolve({ path: '/api/haventory/media/i-1/att-1?authSig=abc' } as T);
      },
      connection: { subscribeMessage: () => () => undefined },
    } as unknown as HassLike;
    const ws = new WSClient(hass);

    const signed = await ws.signPath('/api/haventory/media/i-1/att-1', 300);

    expect(sent[0]).toEqual({
      type: 'auth/sign_path',
      path: '/api/haventory/media/i-1/att-1',
      expires: 300,
    });
    expect(signed).toBe('/api/haventory/media/i-1/att-1?authSig=abc');
  });
});

describe('WSClient: status definitions', () => {
  it('sends the CRUD commands the backend registers', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.listStatuses();
    await ws.createStatus({ slug: 'lent_out', label: 'Lent out', color: 'blue' });
    await ws.updateStatus('lent_out', { label: 'On loan' });
    await ws.reorderStatuses(['ok', 'lent_out']);

    expect(hass.sent.map((c) => c.type)).toEqual([
      'haventory/status/list',
      'haventory/status/create',
      'haventory/status/update',
      'haventory/status/reorder',
    ]);
    expect(hass.sent[1]).toMatchObject({ slug: 'lent_out', label: 'Lent out', color: 'blue' });
    expect(hass.sent[2]).toMatchObject({ slug: 'lent_out', label: 'On loan' });
  });

  // The backend refuses a delete that would orphan items, so the target is what
  // turns a refusal into a completed move — but it must not be sent when absent,
  // or an unused status could not be deleted at all.
  it('omits reassign_to unless a target was chosen', async () => {
    const hass = makeSpyHass();
    const ws = new WSClient(hass);

    await ws.deleteStatus('lent_out');
    await ws.deleteStatus('lent_out', 'ok');

    expect(hass.sent[0]).toEqual({ type: 'haventory/status/delete', slug: 'lent_out' });
    expect(hass.sent[1]).toEqual({
      type: 'haventory/status/delete',
      slug: 'lent_out',
      reassign_to: 'ok',
    });
  });
});

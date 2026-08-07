import { describe, it, expect, vi } from 'vitest';
import {
  MEDIA_NAME_TOKEN_PARAM,
  MEDIA_URL_TEMPLATE,
  MediaUrls,
  SIGNED_URL_TTL_SECONDS,
  attachmentNameToken,
  attachmentTitle,
  formatBytes,
  manuals,
  mediaPath,
  pictureAlt,
  pictures,
} from './media';
import type { Attachment } from '../store/types';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att-1',
    kind: 'picture',
    filename: 'photo.png',
    mime: 'image/png',
    size: 1234,
    uploaded_at: '2026-08-05T10:00:00Z',
    ...overrides,
  };
}

/** A host that records how many times the component was asked to re-render. */
function host() {
  return { renders: 0, requestUpdate() { this.renders += 1; } };
}

/** Lets a test resolve or reject each signing call in its own time. */
function deferredSigner() {
  const calls: string[] = [];
  let settle: ((value: string) => void) | null = null;
  let fail: ((reason: unknown) => void) | null = null;
  const sign = vi.fn((path: string) => {
    calls.push(path);
    return new Promise<string>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
  });
  return {
    sign,
    calls,
    resolve: (value: string) => settle?.(value),
    reject: (reason: unknown) => fail?.(reason),
  };
}

describe('mediaPath', () => {
  it('fills both segments of the route', () => {
    expect(mediaPath('item-1', 'att-1')).toBe('/api/haventory/media/item-1/att-1');
  });

  it('encodes ids rather than pasting them into the path', () => {
    expect(mediaPath('a/b', 'c d')).toBe('/api/haventory/media/a%2Fb/c%20d');
  });

  it('uses the route the backend serves', () => {
    expect(MEDIA_URL_TEMPLATE).toBe('/api/haventory/media/{item_id}/{attachment_id}');
  });

  it('carries the name token as the parameter the backend reads', () => {
    expect(mediaPath('item-1', 'att-1', 'abc123')).toBe(
      `/api/haventory/media/item-1/att-1?${MEDIA_NAME_TOKEN_PARAM}=abc123`,
    );
  });

  it('leaves the path alone when there is no token to carry', () => {
    expect(mediaPath('item-1', 'att-1')).not.toContain('?');
  });
});

describe('attachmentNameToken', () => {
  it('changes when the served name changes', () => {
    const untitled = attachment({ filename: 'scan_0142.pdf' });
    const titled = attachment({ filename: 'scan_0142.pdf', title: 'Dishwasher manual (EN)' });

    expect(attachmentNameToken(titled)).not.toBe(attachmentNameToken(untitled));
  });

  it('is stable for the same served name', () => {
    expect(attachmentNameToken(attachment({ title: 'Manual' }))).toBe(
      attachmentNameToken(attachment({ title: 'Manual' })),
    );
  });

  it('follows the same title-then-filename precedence the header does', () => {
    // A title of only whitespace is not a title, so the filename is the name
    // served — and the token has to agree, or the URL would change for a name
    // that did not.
    expect(attachmentNameToken(attachment({ title: '   ' }))).toBe(
      attachmentNameToken(attachment({ title: '' })),
    );
  });

  it('survives a name outside US-ASCII', () => {
    expect(attachmentNameToken(attachment({ title: 'Spülmaschine - Anleitung' }))).toMatch(
      /^[0-9a-z]+$/,
    );
  });
});

function manual(overrides: Partial<Attachment> = {}): Attachment {
  return attachment({
    kind: 'manual',
    filename: 'scan_0142.pdf',
    mime: 'application/pdf',
    ...overrides,
  });
}

describe('pictures', () => {
  it('keeps only the picture kind', () => {
    const list = [attachment({ id: 'a' }), manual({ id: 'b' }), attachment({ id: 'c' })];

    expect(pictures(list).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('sorts by the stored order, so the cover leads whatever the list order is', () => {
    const list = [
      attachment({ id: 'a', order: 2 }),
      attachment({ id: 'b', order: 0 }),
      attachment({ id: 'c', order: 1 }),
    ];

    expect(pictures(list).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('numbers each kind from zero rather than sharing one sequence', () => {
    // A manual at order 0 must not pull the picture at order 1 into second
    // place: the two kinds are separate lists on separate surfaces.
    const list = [manual({ id: 'm', order: 0 }), attachment({ id: 'p', order: 1 })];

    expect(pictures(list).map((p) => p.id)).toEqual(['p']);
    expect(manuals(list).map((m) => m.id)).toEqual(['m']);
  });

  it('falls back to list order for a payload written before order existed', () => {
    const list = [attachment({ id: 'a' }), attachment({ id: 'b' }), attachment({ id: 'c' })];

    expect(pictures(list).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats an item with no attachments field as having none', () => {
    expect(pictures(undefined)).toEqual([]);
    expect(manuals(undefined)).toEqual([]);
  });
});

describe('manuals', () => {
  it('keeps only the manual kind, in stored order', () => {
    const list = [
      manual({ id: 'm2', order: 1 }),
      attachment({ id: 'p', order: 0 }),
      manual({ id: 'm1', order: 0 }),
    ];

    expect(manuals(list).map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('attachmentTitle', () => {
  it('prefers what the user called it', () => {
    expect(attachmentTitle(manual({ title: 'Dishwasher manual (EN)' }))).toBe(
      'Dishwasher manual (EN)',
    );
  });

  it('falls back to the filename when there is no title', () => {
    expect(attachmentTitle(manual())).toBe('scan_0142.pdf');
    expect(attachmentTitle(manual({ title: '' }))).toBe('scan_0142.pdf');
    // Whitespace is not a title: it would render as an empty row.
    expect(attachmentTitle(manual({ title: '   ' }))).toBe('scan_0142.pdf');
  });
});

describe('pictureAlt', () => {
  it('names the item when there is one photo', () => {
    expect(pictureAlt('Drill', 0, 1)).toBe('Photo of Drill');
  });

  it('distinguishes photos when there is more than one', () => {
    expect(pictureAlt('Drill', 1, 3)).toBe('Drill — photo 2 of 3');
  });
});

describe('formatBytes', () => {
  it('scales to the unit that reads', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(8 * 1024 * 1024)).toBe('8.0 MB');
  });
});

describe('MediaUrls', () => {
  it('requests a signed URL once per attachment and reuses it', async () => {
    const h = host();
    const signer = deferredSigner();
    const urls = new MediaUrls(h);
    urls.configure(signer.sign);

    expect(urls.get('item-1', 'att-1')).toBeNull();
    // A second read while the first is in flight must not sign again.
    expect(urls.get('item-1', 'att-1')).toBeNull();
    signer.resolve('/api/haventory/media/item-1/att-1?authSig=abc');
    await Promise.resolve();

    expect(urls.get('item-1', 'att-1')).toBe('/api/haventory/media/item-1/att-1?authSig=abc');
    expect(urls.get('item-1', 'att-1')).toBe('/api/haventory/media/item-1/att-1?authSig=abc');
    expect(signer.sign).toHaveBeenCalledTimes(1);
    expect(signer.calls[0]).toBe('/api/haventory/media/item-1/att-1');
    expect(h.renders).toBe(1);
  });

  it('re-signs under a new name token so a retitled file stops saving under the old name', async () => {
    const h = host();
    const signer = deferredSigner();
    const urls = new MediaUrls(h);
    urls.configure(signer.sign);

    urls.get('item-1', 'att-1', 'old');
    signer.resolve('/api/haventory/media/item-1/att-1?v=old&authSig=abc');
    await Promise.resolve();
    expect(urls.get('item-1', 'att-1', 'old')).toBe(
      '/api/haventory/media/item-1/att-1?v=old&authSig=abc',
    );
    expect(signer.sign).toHaveBeenCalledTimes(1);

    // The retitle: the held URL was signed for a name that is no longer the one
    // the row shows, and its cached response still carries that name.
    urls.get('item-1', 'att-1', 'new');

    expect(signer.sign).toHaveBeenCalledTimes(2);
    expect(signer.calls[1]).toBe('/api/haventory/media/item-1/att-1?v=new');
  });

  it('does not re-sign for a reader that expressed no opinion about the name', async () => {
    // Every row calls `get` with a token and `presence` without one, and
    // `presence` reads the URL through `get`. Treating "no token" as a mismatch
    // makes the two re-sign over each other on every render, and because each
    // answer asks the host to render again, the component never settles.
    const signer = deferredSigner();
    const urls = new MediaUrls(host());
    urls.configure(signer.sign);

    urls.get('item-1', 'att-1', 'tok');
    signer.resolve('/signed?v=tok');
    await Promise.resolve();
    expect(signer.sign).toHaveBeenCalledTimes(1);

    expect(urls.get('item-1', 'att-1')).toBe('/signed?v=tok');
    expect(urls.get('item-1', 'att-1', 'tok')).toBe('/signed?v=tok');

    expect(signer.sign).toHaveBeenCalledTimes(1);
  });

  it('keeps what it learned about the bytes across a retitle', async () => {
    const signer = deferredSigner();
    const probe = vi.fn(async (_url: string, _init: { headers: Record<string, string> }) =>
      Promise.resolve(new Response(null, { status: 206 })),
    );
    const urls = new MediaUrls(host(), { fetch: probe });
    urls.configure(signer.sign);

    urls.get('item-1', 'att-1', 'old');
    signer.resolve('/signed-old');
    await Promise.resolve();
    urls.presence('item-1', 'att-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(urls.presence('item-1', 'att-1')).toBe('present');

    // A new name is not new bytes: the entry is keyed on the two ids, so the
    // presence answer must not be thrown away with the URL.
    urls.get('item-1', 'att-1', 'new');

    expect(urls.presence('item-1', 'att-1')).toBe('present');
  });

  it('asks for the lifetime it then respects', async () => {
    const signer = deferredSigner();
    const urls = new MediaUrls(host());
    urls.configure(signer.sign);

    urls.get('item-1', 'att-1');

    expect(signer.sign).toHaveBeenCalledWith(
      '/api/haventory/media/item-1/att-1',
      SIGNED_URL_TTL_SECONDS,
    );
  });

  it('re-signs a URL that is about to expire', async () => {
    let now = 0;
    const h = host();
    const signer = deferredSigner();
    const urls = new MediaUrls(h, { now: () => now });
    urls.configure(signer.sign);

    urls.get('item-1', 'att-1');
    signer.resolve('/first');
    await Promise.resolve();
    expect(urls.get('item-1', 'att-1')).toBe('/first');

    // Past the refresh margin: the old URL is still shown while the
    // replacement is in flight, rather than the image blanking mid-view.
    now = SIGNED_URL_TTL_SECONDS * 1000;
    expect(urls.get('item-1', 'att-1')).toBe('/first');
    expect(signer.sign).toHaveBeenCalledTimes(2);

    signer.resolve('/second');
    await Promise.resolve();
    expect(urls.get('item-1', 'att-1')).toBe('/second');
  });

  it('surfaces a failed signing as a fallback state, not a broken image', async () => {
    const h = host();
    const signer = deferredSigner();
    const urls = new MediaUrls(h, { now: () => 0 });
    urls.configure(signer.sign);

    urls.get('item-1', 'att-1');
    signer.reject(new Error('nope'));
    await Promise.resolve();
    await Promise.resolve();

    expect(urls.get('item-1', 'att-1')).toBeNull();
    expect(urls.failed('item-1', 'att-1')).toBe(true);
    // And it does not keep retrying on every render.
    urls.get('item-1', 'att-1');
    expect(signer.sign).toHaveBeenCalledTimes(1);
  });

  it('keeps a working URL when a refresh fails', async () => {
    let now = 0;
    const signer = deferredSigner();
    const urls = new MediaUrls(host(), { now: () => now });
    urls.configure(signer.sign);

    urls.get('item-1', 'att-1');
    signer.resolve('/first');
    await Promise.resolve();

    now = SIGNED_URL_TTL_SECONDS * 1000;
    urls.get('item-1', 'att-1');
    signer.reject(new Error('offline'));
    await Promise.resolve();
    await Promise.resolve();

    expect(urls.get('item-1', 'att-1')).toBe('/first');
    expect(urls.failed('item-1', 'att-1')).toBe(false);
  });

  it('signs nothing at all without a signer', () => {
    const urls = new MediaUrls(host());

    expect(urls.get('item-1', 'att-1')).toBeNull();
    expect(urls.failed('item-1', 'att-1')).toBe(false);
  });

  it('reports a reference whose file is gone, so nothing offers a dead link', async () => {
    const h = host();
    const signer = deferredSigner();
    const probe = vi.fn(async (_url: string, _init: { headers: Record<string, string> }) =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    const urls = new MediaUrls(h, { fetch: probe });
    urls.configure(signer.sign);

    // Nothing can be probed before there is a URL to probe.
    expect(urls.presence('item-1', 'att-1')).toBe('unknown');
    signer.resolve('/api/haventory/media/item-1/att-1?authSig=abc');
    await Promise.resolve();

    expect(urls.presence('item-1', 'att-1')).toBe('unknown');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(urls.presence('item-1', 'att-1')).toBe('missing');
    // One byte asked for, not the whole file: this is a liveness check.
    expect(probe.mock.calls[0][1]).toMatchObject({ headers: { Range: 'bytes=0-0' } });
  });

  it('probes each reference once and does not re-ask on every render', async () => {
    const signer = deferredSigner();
    const probe = vi.fn(async () => new Response(null, { status: 206 }));
    const urls = new MediaUrls(host(), { fetch: probe });
    urls.configure(signer.sign);

    urls.presence('item-1', 'att-1');
    signer.resolve('/signed');
    await Promise.resolve();
    urls.presence('item-1', 'att-1');
    urls.presence('item-1', 'att-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(urls.presence('item-1', 'att-1')).toBe('present');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('stays undecided when the probe itself fails, rather than crying missing', async () => {
    // Offline, or a 500: the file may well be there. Saying "missing" would
    // hide a working document behind a warning the user cannot act on.
    const signer = deferredSigner();
    const probe = vi.fn(async () => {
      throw new Error('offline');
    });
    const urls = new MediaUrls(host(), { fetch: probe });
    urls.configure(signer.sign);

    urls.presence('item-1', 'att-1');
    signer.resolve('/signed');
    await Promise.resolve();
    urls.presence('item-1', 'att-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(urls.presence('item-1', 'att-1')).toBe('unknown');
  });

  it('drops what it cached when the signer changes', async () => {
    const first = deferredSigner();
    const second = deferredSigner();
    const urls = new MediaUrls(host());

    urls.configure(first.sign);
    urls.get('item-1', 'att-1');
    first.resolve('/first');
    await Promise.resolve();
    expect(urls.get('item-1', 'att-1')).toBe('/first');

    urls.configure(second.sign);

    expect(urls.get('item-1', 'att-1')).toBeNull();
    expect(second.sign).toHaveBeenCalledTimes(1);
  });
});

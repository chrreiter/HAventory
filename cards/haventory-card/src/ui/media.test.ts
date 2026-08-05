import { describe, it, expect, vi } from 'vitest';
import {
  MEDIA_URL_TEMPLATE,
  MediaUrls,
  SIGNED_URL_TTL_SECONDS,
  formatBytes,
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
});

describe('pictures', () => {
  it('keeps only the picture kind, in stored order', () => {
    const list = [
      attachment({ id: 'a' }),
      attachment({ id: 'b', kind: 'manual', mime: 'application/pdf' }),
      attachment({ id: 'c' }),
    ];

    expect(pictures(list).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('treats an item with no attachments field as having none', () => {
    expect(pictures(undefined)).toEqual([]);
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

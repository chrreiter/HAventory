import { describe, expect, it, vi } from 'vitest';
import {
  DOWNSCALE_THRESHOLD_BYTES,
  MAX_IMAGE_EDGE,
  prepareForUpload,
  renameFor,
  scaledSize,
  shouldDownscale,
  targetType,
} from './downscale';
import type { DownscaleDeps } from './downscale';

/** A file of a given size without allocating the bytes twice over. */
function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const big = (type = 'image/jpeg') => file('IMG_0042.jpg', type, DOWNSCALE_THRESHOLD_BYTES + 1);

/** A stand-in bitmap: `prepareForUpload` only reads the two dimensions. */
function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => undefined } as unknown as ImageBitmap;
}

function deps(overrides: Partial<DownscaleDeps> = {}): DownscaleDeps {
  return {
    decode: async () => bitmap(4032, 3024),
    encode: async () => new Blob(['tiny'], { type: 'image/jpeg' }),
    ...overrides,
  };
}

describe('shouldDownscale', () => {
  it('takes on a photo over the threshold', () => {
    expect(shouldDownscale(big(), 'picture')).toBe(true);
  });

  it('leaves a small photo alone, because re-encoding is lossy', () => {
    expect(shouldDownscale(file('small.jpg', 'image/jpeg', 1024), 'picture')).toBe(false);
  });

  // A canvas holds one frame, so re-encoding an animated GIF would silently
  // keep the first and throw the rest away.
  it('never re-encodes a GIF', () => {
    expect(shouldDownscale(big('image/gif'), 'picture')).toBe(false);
  });

  it('never touches a document', () => {
    expect(shouldDownscale(file('manual.pdf', 'application/pdf', 9e6), 'manual')).toBe(false);
    // Nor a PDF mislabelled as a picture: the type is what decides.
    expect(shouldDownscale(file('manual.pdf', 'application/pdf', 9e6), 'picture')).toBe(false);
  });
});

describe('targetType', () => {
  it('keeps a JPEG a JPEG', () => {
    expect(targetType('image/jpeg')).toBe('image/jpeg');
  });

  // Flattening transparency onto an opaque canvas changes the picture, not
  // just its size — and both types are in the backend's allow-list.
  it('encodes anything that can carry transparency as WebP', () => {
    expect(targetType('image/png')).toBe('image/webp');
    expect(targetType('image/webp')).toBe('image/webp');
  });
});

describe('scaledSize', () => {
  it('fits the longest edge to the cap and keeps the aspect ratio', () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: MAX_IMAGE_EDGE, height: 1536 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1536, height: MAX_IMAGE_EDGE });
  });

  it('leaves an image already inside the cap at its own size', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('never rounds an edge away to nothing', () => {
    // A 8192x1 panorama scales its height to 0.25, which rounds to zero — and
    // an image zero pixels tall encodes as nothing at all.
    expect(scaledSize(8192, 1)).toEqual({ width: MAX_IMAGE_EDGE, height: 1 });
  });
});

describe('renameFor', () => {
  it('swaps the extension for what was actually encoded', () => {
    expect(renameFor('IMG_0042.HEIC', 'image/jpeg')).toBe('IMG_0042.jpg');
    expect(renameFor('shelf.png', 'image/webp')).toBe('shelf.webp');
  });

  it('keeps a dotted name intact and only replaces the last part', () => {
    expect(renameFor('shelf.v2.png', 'image/webp')).toBe('shelf.v2.webp');
  });

  it('still produces a name for a file that had none', () => {
    expect(renameFor('', 'image/jpeg')).toBe('photo.jpg');
  });
});

describe('prepareForUpload', () => {
  it('hands back a smaller file, renamed for what it now is', async () => {
    const out = await prepareForUpload(big('image/png'), 'picture', deps());

    expect(out.size).toBeLessThan(DOWNSCALE_THRESHOLD_BYTES);
    expect(out.type).toBe('image/webp');
    expect(out.name).toBe('IMG_0042.webp');
  });

  it('asks for the image at the capped size', async () => {
    const encode = vi.fn(async () => new Blob(['tiny']));
    await prepareForUpload(big(), 'picture', deps({ decode: async () => bitmap(4032, 3024), encode }));

    expect(encode.mock.calls[0].slice(1, 4)).toEqual([MAX_IMAGE_EDGE, 1536, 'image/jpeg']);
  });

  it('uploads the original when the re-encode comes out larger', async () => {
    // Readily happens with a flat-colour PNG: fidelity is only worth giving up
    // for size, so a bigger result is not a trade at all.
    const original = big('image/png');
    const bloated = new Blob([new Uint8Array(original.size + 1)]);

    const out = await prepareForUpload(original, 'picture', deps({ encode: async () => bloated }));

    expect(out).toBe(original);
  });

  it('uploads the original when decoding fails', async () => {
    const original = big();
    const out = await prepareForUpload(
      original,
      'picture',
      deps({
        decode: async () => {
          throw new Error('not an image after all');
        },
      }),
    );

    expect(out).toBe(original);
  });

  it('uploads the original when the canvas produces nothing', async () => {
    const original = big();

    const out = await prepareForUpload(original, 'picture', deps({ encode: async () => null }));

    expect(out).toBe(original);
  });

  it('releases the decoded bitmap even when encoding throws', async () => {
    const close = vi.fn();
    const decoded = { width: 4032, height: 3024, close } as unknown as ImageBitmap;

    await prepareForUpload(
      big(),
      'picture',
      deps({
        decode: async () => decoded,
        encode: async () => {
          throw new Error('out of memory');
        },
      }),
    );

    expect(close).toHaveBeenCalled();
  });

  it('does not decode a file it was never going to re-encode', async () => {
    const decode = vi.fn(async () => bitmap(10, 10));
    const original = file('manual.pdf', 'application/pdf', 9e6);

    const out = await prepareForUpload(original, 'manual', deps({ decode }));

    expect(out).toBe(original);
    expect(decode).not.toHaveBeenCalled();
  });
});

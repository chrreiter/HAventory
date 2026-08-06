/**
 * Shrink an oversized photo in the browser, before it is uploaded.
 *
 * A current phone camera writes 4–12 MB per frame, which is over the backend's
 * 8 MB per-file cap outright — so without this the most ordinary way to add a
 * photo is also the one that fails. Re-encoding turns that refusal into a
 * success, and cuts the wire time on the mobile connection the photo was taken
 * on.
 *
 * Everything here fails *open*: any step that does not work hands the original
 * file back, and the backend re-derives the type and the size from the bytes it
 * actually receives. A photo that could not be shrunk is still worth trying to
 * upload.
 */

import type { AttachmentKind } from '../store/types';

/**
 * Above this, a picture is re-encoded. Below it, the original is uploaded
 * untouched: re-encoding is lossy, and a file this size costs little to send.
 */
export const DOWNSCALE_THRESHOLD_BYTES = 2 * 1024 * 1024;

/** Longest edge of the re-encoded image — still more than any card surface shows. */
export const MAX_IMAGE_EDGE = 2048;

/** JPEG/WebP quality for the re-encode. */
export const DOWNSCALE_QUALITY = 0.85;

/**
 * Types worth re-encoding.
 *
 * GIF is deliberately absent: a canvas holds one frame, so re-encoding an
 * animated GIF would silently keep the first and throw the rest away.
 */
const RECODABLE: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Whether this file is a candidate at all. Pure, so the rule is testable. */
export function shouldDownscale(file: File, kind: AttachmentKind): boolean {
  if (kind !== 'picture') return false;
  if (!RECODABLE.includes(file.type)) return false;
  return file.size > DOWNSCALE_THRESHOLD_BYTES;
}

/**
 * What to encode as.
 *
 * A JPEG stays a JPEG. Anything else becomes WebP rather than JPEG, because
 * PNG and WebP can carry transparency and flattening it onto an opaque canvas
 * would change the picture, not just its size. Both are in the backend's
 * allow-list.
 */
export function targetType(sourceType: string): string {
  return sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
}

/** The box `width`×`height` fits into, capped at `maxEdge`, aspect preserved. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  // Never round to zero: a 4096×3 panorama would otherwise encode as no image.
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Same base name, extension swapped to match what was actually encoded. */
export function renameFor(filename: string, type: string): string {
  const extension = type === 'image/jpeg' ? '.jpg' : '.webp';
  const base = filename.replace(/\.[^./\\]+$/, '');
  return `${base || 'photo'}${extension}`;
}

/** The two impure steps, injectable so the decision logic can be tested alone. */
export interface DownscaleDeps {
  decode(file: File): Promise<ImageBitmap>;
  encode(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    type: string,
    quality: number,
  ): Promise<Blob | null>;
}

const browserDeps: DownscaleDeps = {
  decode: (file) =>
    // `from-image` is load-bearing: re-encoding drops the source's EXIF, so a
    // bitmap decoded without applying the orientation tag first would upload a
    // portrait photo permanently on its side.
    createImageBitmap(file, { imageOrientation: 'from-image' }),
  encode: (bitmap, width, height, type, quality) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return Promise.resolve(null);
    context.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  },
};

/**
 * The file to actually upload: a smaller re-encode, or the original.
 *
 * The original is kept whenever the re-encode is not clearly better — it
 * failed, it produced nothing, or it came out *larger*, which re-encoding a
 * flat-colour PNG readily does. Fidelity is only worth giving up for size.
 */
export async function prepareForUpload(
  file: File,
  kind: AttachmentKind,
  deps: DownscaleDeps = browserDeps,
): Promise<File> {
  if (!shouldDownscale(file, kind)) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await deps.decode(file);
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const type = targetType(file.type);
    const blob = await deps.encode(bitmap, width, height, type, DOWNSCALE_QUALITY);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], renameFor(file.name, type), {
      type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

/**
 * Shrink an oversized photo before upload: a phone camera writes 4–12 MB per
 * frame, over the backend's 8 MB cap. Every step fails open to the original
 * file, which the backend checks against its own bytes anyway.
 */

import type { AttachmentKind } from '../store/types';

/** Below this the original is uploaded untouched, since re-encoding is lossy. */
export const DOWNSCALE_THRESHOLD_BYTES = 2 * 1024 * 1024;

/** Longest edge of the re-encoded image — still more than any card surface shows. */
export const MAX_IMAGE_EDGE = 2048;

export const DOWNSCALE_QUALITY = 0.85;

/** No GIF: a canvas holds one frame, so an animation would lose the rest. */
const RECODABLE: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export function shouldDownscale(file: File, kind: AttachmentKind): boolean {
  return kind === 'picture' && RECODABLE.includes(file.type) && file.size > DOWNSCALE_THRESHOLD_BYTES;
}

/** A JPEG stays a JPEG; anything else becomes WebP, which keeps transparency. */
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
    // Re-encoding drops EXIF, so the orientation must be applied while decoding.
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

/** A smaller re-encode, or the original when it failed or came out larger (a flat PNG can). */
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

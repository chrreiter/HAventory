/**
 * Signed URLs for item attachments, so an `<img>` can load one.
 *
 * The media view requires authentication and an `<img src>` carries no header,
 * so every URL is signed by core's `auth/sign_path` before it is rendered.
 * Signatures expire; a component that keeps a view open for longer than the
 * lifetime asks again rather than showing a broken image.
 *
 * No component talks to `auth/sign_path` itself: they hold a `MediaUrls` and
 * read a URL out of it synchronously, which is what a Lit template needs.
 */

import type { Attachment, Item } from '../store/types';

/**
 * The route the backend serves attachments on.
 *
 * A constant on both sides of the language boundary, pinned to the backend's
 * `MEDIA_URL_TEMPLATE` by `tests/test_frontend_registration.py` — neither side
 * can check the other on its own.
 */
export const MEDIA_URL_TEMPLATE = '/api/haventory/media/{item_id}/{attachment_id}';

/**
 * How long a signature is asked for, and how long before it lapses a URL is
 * replaced. Five minutes is long enough that scrolling a list never re-signs
 * and short enough that a URL copied out of the DOM is not a lasting handle.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

/** Re-sign this long before expiry, so an in-flight request never lands late. */
const REFRESH_MARGIN_MS = 30_000;

/** Signs one path and hands back the signed one. */
export type SignPath = (path: string, expires: number) => Promise<string>;

/**
 * Everything a component needs to show or change an item's pictures.
 *
 * One object rather than three properties, and one instance per host rather
 * than a closure per render: a fresh function each render reads as a changed
 * property and re-renders every row that holds it.
 */
export interface MediaBindings {
  sign: SignPath;
  /** Upload one file; resolves to the item as the backend now holds it. */
  upload(itemId: string, file: File): Promise<Item>;
  /** Detach one picture; the backend deletes the bytes with it. */
  remove(itemId: string, attachmentId: string): Promise<Item>;
}

/** All `MediaUrls` needs from the element holding it. */
interface MediaHost {
  requestUpdate(): void;
}

/** Build the unsigned media path for one attachment. */
export function mediaPath(itemId: string, attachmentId: string): string {
  return MEDIA_URL_TEMPLATE.replace('{item_id}', encodeURIComponent(itemId)).replace(
    '{attachment_id}',
    encodeURIComponent(attachmentId),
  );
}

/** A human-readable file size, for the caption under a picture. */
export function formatBytes(size: number): string {
  const KB = 1024;
  const MB = KB * KB;
  if (size >= MB) return `${(size / MB).toFixed(1)} MB`;
  if (size >= KB) return `${Math.round(size / KB)} KB`;
  return `${size} B`;
}

/** Alt text for one picture: the item names it, the index distinguishes it. */
export function pictureAlt(itemName: string, index: number, total: number): string {
  return total > 1 ? `${itemName} — photo ${index + 1} of ${total}` : `Photo of ${itemName}`;
}

/** The pictures on an item, in stored order. */
export function pictures(attachments: Attachment[] | undefined): Attachment[] {
  return (attachments ?? []).filter((a) => a.kind === 'picture');
}

interface Entry {
  url: string | null;
  expiresAt: number;
  failed: boolean;
  pending: boolean;
}

/**
 * A component's view of the signed URLs it needs.
 *
 * `get` is synchronous because that is what a template can use: it returns the
 * URL when there is a live one, and otherwise starts the signing request and
 * returns null, asking the host to re-render once the answer lands. `failed`
 * separates "not yet" from "will not" so the caller can draw a placeholder
 * rather than an image element that can only break.
 */
export class MediaUrls {
  private readonly host: MediaHost;
  private readonly entries = new Map<string, Entry>();
  private sign: SignPath | null = null;
  private readonly now: () => number;

  constructor(host: MediaHost, options: { now?: () => number } = {}) {
    this.host = host;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Point this at a signer.
   *
   * Called from the host's `willUpdate`, so a component that has not been given
   * one yet simply renders no images. A changed signer drops the cache: the old
   * signatures were issued for a connection that is no longer the one being
   * rendered.
   */
  configure(sign: SignPath | null): void {
    if (this.sign === sign) return;
    this.sign = sign;
    this.entries.clear();
  }

  /** The signed URL for one attachment, or null while there is not one yet. */
  get(itemId: string, attachmentId: string): string | null {
    const key = `${itemId}/${attachmentId}`;
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.failed || entry.pending) return entry.url;
      if (entry.url && entry.expiresAt - REFRESH_MARGIN_MS > this.now()) return entry.url;
    }
    this.request(key, itemId, attachmentId);
    // A lapsed URL is still shown while its replacement is in flight: the
    // browser has the image cached and swapping to a placeholder mid-view would
    // be a worse answer than a URL that is briefly stale.
    return entry?.url ?? null;
  }

  /** True when signing this attachment failed, so no URL is coming. */
  failed(itemId: string, attachmentId: string): boolean {
    return this.entries.get(`${itemId}/${attachmentId}`)?.failed === true;
  }

  private request(key: string, itemId: string, attachmentId: string): void {
    const sign = this.sign;
    if (!sign) return;
    const existing = this.entries.get(key);
    if (existing?.pending) return;

    const entry: Entry = {
      url: existing?.url ?? null,
      expiresAt: 0,
      failed: false,
      pending: true,
    };
    this.entries.set(key, entry);

    void sign(mediaPath(itemId, attachmentId), SIGNED_URL_TTL_SECONDS).then(
      (signed) => {
        this.entries.set(key, {
          url: signed,
          expiresAt: this.now() + SIGNED_URL_TTL_SECONDS * 1000,
          failed: false,
          pending: false,
        });
        this.host.requestUpdate();
      },
      () => {
        // Keep whatever URL was already working: a failed refresh is not a
        // reason to blank an image the browser is still showing.
        this.entries.set(key, {
          url: entry.url,
          expiresAt: 0,
          failed: entry.url === null,
          pending: false,
        });
        this.host.requestUpdate();
      },
    );
  }
}

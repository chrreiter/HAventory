/**
 * Signed URLs for item attachments: an `<img src>` carries no auth header, so
 * core's `auth/sign_path` signs each one, and an expiring signature is renewed.
 * Components read URLs synchronously out of a `MediaUrls`.
 */

import { t } from '../i18n';
import type { Attachment, AttachmentKind, Item } from '../store/types';

/** Pinned to the backend's `MEDIA_URL_TEMPLATE` by `tests/test_frontend_registration.py`. */
export const MEDIA_URL_TEMPLATE = '/api/haventory/media/{item_id}/{attachment_id}';

/**
 * Versions a URL by the name the file is served under, since a retitle changes
 * `Content-Disposition` and the backend caches only a URL that names it. Pinned
 * to the backend by `tests/test_frontend_registration.py`.
 */
export const MEDIA_NAME_TOKEN_PARAM = 'v';

/**
 * A row tile asks for the `thumb` variant rather than an up-to-8 MB original;
 * the backend falls back to the original. Pinned to the backend's
 * `MEDIA_SIZE_PARAM` / `MEDIA_SIZE_THUMB` by `tests/test_frontend_registration.py`.
 */
export const MEDIA_SIZE_PARAM = 'size';
export type MediaVariant = 'thumb';
export const MEDIA_VARIANT_THUMB: MediaVariant = 'thumb';

/** Half an hour: a re-signed URL is a fresh download, since browsers cache by full URL. */
export const SIGNED_URL_TTL_SECONDS = 1800;

/** A row thumbnail's box; the table reserves this much inside its name column. */
export const ROW_THUMB_SIZE = 34;

/** The same box where a finger is the pointer. */
export const ROW_THUMB_SIZE_TOUCH = 40;

/** Re-sign this long before expiry, so an in-flight request never lands late. */
const REFRESH_MARGIN_MS = 60_000;

/** Signs one path and hands back the signed one. */
export type SignPath = (path: string, expires: number) => Promise<string>;

/** Everything a component needs to show or change an item's attachments; one instance per host. */
export interface MediaBindings {
  sign: SignPath;
  /** Upload one file; resolves to the item as the backend now holds it. */
  upload(itemId: string, file: File, kind?: AttachmentKind): Promise<Item>;
  /** Detach one file; the backend deletes the bytes with it. */
  remove(itemId: string, attachmentId: string): Promise<Item>;
  /** Rename one attachment for display; the stored filename is untouched. */
  retitle(itemId: string, attachmentId: string, title: string): Promise<Item>;
  /** Renumber one kind; the first id named becomes position 0, the cover. */
  reorder(itemId: string, kind: AttachmentKind, attachmentIds: string[]): Promise<Item>;
}

/** All `MediaUrls` needs from the element holding it. */
interface MediaHost {
  requestUpdate(): void;
}

/** The unsigned media path; HA signs the query with the path, so the parameters go here. */
export function mediaPath(
  itemId: string,
  attachmentId: string,
  nameToken?: string,
  variant?: MediaVariant,
): string {
  const path = MEDIA_URL_TEMPLATE.replace('{item_id}', encodeURIComponent(itemId)).replace(
    '{attachment_id}',
    encodeURIComponent(attachmentId),
  );
  const query = [
    nameToken === undefined
      ? null
      : `${MEDIA_NAME_TOKEN_PARAM}=${encodeURIComponent(nameToken)}`,
    variant === undefined ? null : `${MEDIA_SIZE_PARAM}=${encodeURIComponent(variant)}`,
  ].filter((part): part is string => part !== null);
  return query.length ? `${path}?${query.join('&')}` : path;
}

/** The key one variant's signed URL is cached under. */
function urlKey(itemId: string, attachmentId: string, variant?: MediaVariant): string {
  const base = `${itemId}/${attachmentId}`;
  return variant === undefined ? base : `${base}#${variant}`;
}

/**
 * A short token that changes exactly when the served filename would: an
 * FNV-1a hash of `attachmentTitle`, the backend's `Content-Disposition` source.
 */
export function attachmentNameToken(attachment: Attachment): string {
  const name = attachmentTitle(attachment);
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
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
  return total > 1
    ? t('hv.media.photoAlt', { name: itemName, index: index + 1, total })
    : t('hv.media.photoAltOnly', { name: itemName });
}

/** One kind of attachment by its per-kind `order`, list position standing in when absent. */
function ofKind(attachments: Attachment[] | undefined, kind: AttachmentKind): Attachment[] {
  return (attachments ?? [])
    .filter((a) => a.kind === kind)
    .map((a, index) => ({ a, index }))
    .sort((x, y) => (x.a.order ?? x.index) - (y.a.order ?? y.index) || x.index - y.index)
    .map((e) => e.a);
}

/** The pictures on an item, cover first. */
export function pictures(attachments: Attachment[] | undefined): Attachment[] {
  return ofKind(attachments, 'picture');
}

/** The manuals on an item, in stored order. */
export function manuals(attachments: Attachment[] | undefined): Attachment[] {
  return ofKind(attachments, 'manual');
}

/** An attachment's title, or its filename when untitled. */
export function attachmentTitle(attachment: Attachment): string {
  return attachment.title?.trim() || attachment.filename;
}

/** Whether a reference's bytes are on disk; only a 404 proves `missing`. */
export type Presence = 'unknown' | 'present' | 'missing';

/** Enough of a `Response` for a liveness check; `Response` itself in the browser. */
interface ProbeResponse {
  ok: boolean;
  status: number;
}

type ProbeFetch = (url: string, init: { headers: Record<string, string> }) => Promise<ProbeResponse>;

interface Entry {
  url: string | null;
  expiresAt: number;
  failed: boolean;
  pending: boolean;
  presence: Presence;
  probing: boolean;
  /** The name token this entry's URL was signed for; see `MEDIA_NAME_TOKEN_PARAM`. */
  nameToken: string | undefined;
}

/**
 * A component's signed URLs. `get` is synchronous for a template: a live URL,
 * or null while signing, with a re-render when it lands. A failure is remembered.
 */
export class MediaUrls {
  private readonly host: MediaHost;
  private readonly entries = new Map<string, Entry>();
  private sign: SignPath | null = null;
  private readonly now: () => number;
  private readonly fetch: ProbeFetch;

  constructor(host: MediaHost, options: { now?: () => number; fetch?: ProbeFetch } = {}) {
    this.host = host;
    this.now = options.now ?? (() => Date.now());
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  }

  /** Point this at a signer, from `willUpdate`; a changed signer drops the cache. */
  configure(sign: SignPath | null): void {
    if (this.sign === sign) return;
    this.sign = sign;
    this.entries.clear();
  }

  /**
   * The signed URL for one attachment, or null while there is not one yet. A
   * `nameToken` the held URL was not signed for re-signs it. Entries are keyed
   * by ids and variant, so what is known about the bytes survives a re-sign.
   */
  get(
    itemId: string,
    attachmentId: string,
    nameToken?: string,
    variant?: MediaVariant,
  ): string | null {
    const key = urlKey(itemId, attachmentId, variant);
    const entry = this.entries.get(key);
    // No token means no opinion about the name (the presence probe), not a mismatch.
    if (entry && (nameToken === undefined || entry.nameToken === nameToken)) {
      if (entry.failed || entry.pending) return entry.url;
      if (entry.url && entry.expiresAt - REFRESH_MARGIN_MS > this.now()) return entry.url;
    }
    this.request(key, itemId, attachmentId, nameToken, variant);
    // A lapsed URL stays on screen while its replacement is signed.
    return entry?.url ?? null;
  }

  /**
   * Whether one attachment's file is really there, starting the check if not
   * yet asked. The probe asks for one byte; a missing file answers 404.
   */
  presence(itemId: string, attachmentId: string): Presence {
    const key = `${itemId}/${attachmentId}`;
    const url = this.get(itemId, attachmentId);
    const entry = this.entries.get(key);
    if (!entry || !url) return entry?.presence ?? 'unknown';
    if (entry.presence !== 'unknown' || entry.probing) return entry.presence;

    entry.probing = true;
    void this.fetch(url, { headers: { Range: 'bytes=0-0' } }).then(
      (response) => {
        this.settlePresence(key, response.ok ? 'present' : response.status === 404 ? 'missing' : 'unknown');
      },
      () => {
        this.settlePresence(key, 'unknown');
      },
    );
    return 'unknown';
  }

  private settlePresence(key: string, presence: Presence): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    // `probing` stays set, so an inconclusive answer is not re-asked every render.
    this.entries.set(key, { ...entry, presence });
    this.host.requestUpdate();
  }

  private request(
    key: string,
    itemId: string,
    attachmentId: string,
    nameToken?: string,
    variant?: MediaVariant,
  ): void {
    const sign = this.sign;
    if (!sign) return;
    const existing = this.entries.get(key);
    const token = nameToken ?? existing?.nameToken;
    // Wait for an in-flight request for this name; a retitle mid-flight re-signs.
    if (existing?.pending && existing.nameToken === token) return;

    const entry: Entry = {
      url: existing?.url ?? null,
      expiresAt: 0,
      failed: false,
      pending: true,
      presence: existing?.presence ?? 'unknown',
      probing: existing?.probing ?? false,
      nameToken: token,
    };
    this.entries.set(key, entry);

    // A later retitle's request supersedes this one's answer.
    const superseded = () => this.entries.get(key)?.nameToken !== token;

    void sign(mediaPath(itemId, attachmentId, token, variant), SIGNED_URL_TTL_SECONDS).then(
      (signed) => {
        if (superseded()) return;
        this.entries.set(key, {
          url: signed,
          expiresAt: this.now() + SIGNED_URL_TTL_SECONDS * 1000,
          failed: false,
          pending: false,
          presence: this.entries.get(key)?.presence ?? entry.presence,
          probing: this.entries.get(key)?.probing ?? entry.probing,
          nameToken: token,
        });
        this.host.requestUpdate();
      },
      () => {
        if (superseded()) return;
        // A failed refresh keeps the URL that was already working.
        this.entries.set(key, {
          url: entry.url,
          expiresAt: 0,
          failed: entry.url === null,
          pending: false,
          presence: this.entries.get(key)?.presence ?? entry.presence,
          probing: this.entries.get(key)?.probing ?? entry.probing,
          nameToken: token,
        });
        this.host.requestUpdate();
      },
    );
  }
}

/** `errored`: the `<img>` failed and the probe has not proven the file missing. */
export type PictureState = 'ok' | 'errored' | 'missing';

/**
 * The missing-file state for rows, which probe only after an `<img>` fails:
 * one probe per broken tile rather than one per row.
 */
export class PictureFallback {
  private readonly host: MediaHost;
  private readonly urls: MediaUrls;
  private readonly errored = new Set<string>();

  constructor(host: MediaHost, urls: MediaUrls) {
    this.host = host;
    this.urls = urls;
  }

  /** What to draw for one picture, without asking anything of a tile that loads. */
  state(itemId: string, attachmentId: string): PictureState {
    if (!this.errored.has(`${itemId}/${attachmentId}`)) return 'ok';
    return this.urls.presence(itemId, attachmentId) === 'missing' ? 'missing' : 'errored';
  }

  /** One tile's image failed to load; find out whether its file is there. */
  noteError(itemId: string, attachmentId: string): void {
    this.errored.add(`${itemId}/${attachmentId}`);
    this.urls.presence(itemId, attachmentId);
    this.host.requestUpdate();
  }

  /** One tile's image loaded after all, e.g. on a re-signed URL: clear the error. */
  noteLoad(itemId: string, attachmentId: string): void {
    if (!this.errored.delete(`${itemId}/${attachmentId}`)) return;
    this.host.requestUpdate();
  }
}

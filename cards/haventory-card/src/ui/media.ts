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

import { t } from '../i18n';
import type { Attachment, AttachmentKind, Item } from '../store/types';

/**
 * The route the backend serves attachments on.
 *
 * A constant on both sides of the language boundary, pinned to the backend's
 * `MEDIA_URL_TEMPLATE` by `tests/test_frontend_registration.py` — neither side
 * can check the other on its own.
 */
export const MEDIA_URL_TEMPLATE = '/api/haventory/media/{item_id}/{attachment_id}';

/**
 * Query parameter that versions a media URL by the name the file is served
 * under.
 *
 * The bytes behind an attachment id never change, but the name in the
 * response's `Content-Disposition` does — a retitle rewrites it for that same
 * id — and the backend will only let a client hold the response indefinitely
 * when the URL says which name it was fetched for. Without it a retitled file
 * would keep being saved under its old name for as long as the browser's cache
 * entry lived, which a signature outlasts by half an hour.
 *
 * Pinned to the backend's `MEDIA_NAME_TOKEN_PARAM` by
 * `tests/test_frontend_registration.py`.
 */
export const MEDIA_NAME_TOKEN_PARAM = 'v';

/**
 * Which form of a picture to ask the backend for.
 *
 * Only `thumb` exists, and only for a row tile: a 34–72px tile served the
 * original was up to 8 MB of download for a few hundred pixels, which is
 * invisible on Wi-Fi and the difference between usable and not on a phone in a
 * shop. The lightbox and the detail sheet's large picture ask for neither and
 * get the stored file. The backend falls back to the original whenever it
 * cannot make a tile, so this is a request, not a requirement.
 *
 * Pinned to the backend's `MEDIA_SIZE_PARAM` / `MEDIA_SIZE_THUMB` by
 * `tests/test_frontend_registration.py`.
 */
export const MEDIA_SIZE_PARAM = 'size';
export type MediaVariant = 'thumb';
export const MEDIA_VARIANT_THUMB: MediaVariant = 'thumb';

/**
 * How long a signature is asked for.
 *
 * A browser caches by full URL, signature included, so a re-signed URL is a
 * fresh download of bytes it already holds. Half an hour outlasts an ordinary
 * session with a list open — no photo is fetched twice — while still being far
 * too short for a URL copied out of the DOM to be a lasting handle.
 */
export const SIGNED_URL_TTL_SECONDS = 1800;

/**
 * The box a row's leading thumbnail draws in, on every surface that shows one.
 *
 * One number rather than one per component: the full view's table has to
 * reserve this much inside its name column, and a box that outgrew the reserve
 * would take the width back out of the name.
 */
export const ROW_THUMB_SIZE = 34;

/**
 * The same box where a finger is the pointer. A phone shows one column of rows
 * and can spend the extra six pixels on making the picture legible.
 */
export const ROW_THUMB_SIZE_TOUCH = 40;

/** Re-sign this long before expiry, so an in-flight request never lands late. */
const REFRESH_MARGIN_MS = 60_000;

/** Signs one path and hands back the signed one. */
export type SignPath = (path: string, expires: number) => Promise<string>;

/**
 * Everything a component needs to show or change an item's attachments.
 *
 * One object rather than four properties, and one instance per host rather
 * than a closure per render: a fresh function each render reads as a changed
 * property and re-renders every row that holds it.
 */
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

/**
 * Build the unsigned media path for one attachment.
 *
 * A name token makes the URL change when the served filename does, which is
 * what lets the response be cached — see `MEDIA_NAME_TOKEN_PARAM`. Home
 * Assistant signs query parameters together with the path, so the token has to
 * be here before signing rather than appended to a signed URL.
 */
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
 * A short stable token for the name one attachment is served under.
 *
 * A hash rather than the name itself: the name is user-supplied text of any
 * length in any script, and this only has to *differ* when the name does. The
 * input is `attachmentTitle`, which is the same precedence the backend builds
 * `Content-Disposition` from, so the token changes exactly when the saved
 * filename would.
 */
export function attachmentNameToken(attachment: Attachment): string {
  const name = attachmentTitle(attachment);
  // FNV-1a, 32-bit. Not a checksum and not a secret — a cache key.
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

/**
 * One kind of attachment, in the order the item stores them in.
 *
 * `order` is per kind and counts from zero within it, so the two lists are
 * sorted separately — a manual at 0 does not push a picture at 1 down the
 * strip. It is absent on a payload written before the field existed, where the
 * stored list order *is* the order, so position stands in for it.
 */
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

/**
 * What to call an attachment on screen.
 *
 * The title the user gave it, or its filename — `scan_0142.pdf` is a poor name
 * for a document list but it beats a blank row, and an untitled attachment is
 * the normal state right after an upload.
 */
export function attachmentTitle(attachment: Attachment): string {
  return attachment.title?.trim() || attachment.filename;
}

/**
 * Whether the bytes a reference names are actually on disk.
 *
 * `unknown` is the honest answer both before the check has run and when it
 * could not be made — only a 404 from the media route proves absence, and a
 * failed probe must not disable a document that opens perfectly well.
 */
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
 * A component's view of the signed URLs it needs.
 *
 * `get` is synchronous because that is what a template can use: it returns the
 * URL when there is a live one, and otherwise starts the signing request and
 * returns null, asking the host to re-render once the answer lands. A signing
 * that failed is remembered on the entry, so the next render is answered from
 * it rather than asking again for a URL that is not coming.
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

  /**
   * The signed URL for one attachment, or null while there is not one yet.
   *
   * Passing the attachment's `attachmentNameToken` keeps the URL in step with a
   * retitle: a token the held URL was not signed for re-signs rather than
   * serving a URL whose cached response still carries the old filename. The
   * entry is keyed on the two ids and the variant, so what `failed` and
   * `presence` know about these bytes survives the re-sign.
   *
   * A `variant` is a different URL and therefore a different signature, so it
   * gets its own entry. `presence` deliberately does not take one: whether the
   * file is there is a question about the attachment, not about the size it is
   * being asked for, and the backend answers 404 for both together.
   */
  get(
    itemId: string,
    attachmentId: string,
    nameToken?: string,
    variant?: MediaVariant,
  ): string | null {
    const key = urlKey(itemId, attachmentId, variant);
    const entry = this.entries.get(key);
    // No token means no opinion about the name, not "the untitled URL". The
    // presence probe reads whatever URL is current without caring what it is
    // called, and counting that as a mismatch would have the two callers
    // re-sign over each other on every render.
    if (entry && (nameToken === undefined || entry.nameToken === nameToken)) {
      if (entry.failed || entry.pending) return entry.url;
      if (entry.url && entry.expiresAt - REFRESH_MARGIN_MS > this.now()) return entry.url;
    }
    this.request(key, itemId, attachmentId, nameToken, variant);
    // A lapsed URL is still shown while its replacement is in flight: the
    // browser has the image cached and swapping to a placeholder mid-view would
    // be a worse answer than a URL that is briefly stale.
    return entry?.url ?? null;
  }

  /**
   * Whether one attachment's file is really there, starting the check if not
   * yet asked.
   *
   * Synchronous like `get`, and for the same reason: a template needs an answer
   * now. A caller that draws a link uses this to decide whether the link can
   * lead anywhere — metadata outlives its bytes, because a JSON export carries
   * the references and not the files, so a fresh install can hold a document
   * whose PDF was never uploaded to it.
   *
   * The probe asks for one byte. The media route rejects a missing file with
   * 404 before it opens anything, so a range that small settles the question
   * without pulling the document down to answer it.
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
    // `probing` stays set on an inconclusive answer: re-asking on every render
    // would put one request per frame on a connection that has already failed.
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
    // A caller with no opinion about the name keeps the one this entry was
    // already signed for, rather than dropping it back to the untitled URL.
    const token = nameToken ?? existing?.nameToken;
    // A request already in flight for this same name is the one to wait for; a
    // retitle mid-flight is not, because that URL would arrive naming the file
    // the row no longer shows.
    if (existing?.pending && existing.nameToken === token) return;

    // A re-sign is a new URL for the same bytes, so whatever was learned about
    // whether those bytes exist carries across it.
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

    // A second retitle can start another sign before this one lands. The token
    // on the entry is the name last asked for, so an answer that no longer
    // matches it is a late one and is dropped rather than overwriting it.
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
        // Keep whatever URL was already working: a failed refresh is not a
        // reason to blank an image the browser is still showing.
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

/**
 * What a tile should draw once the browser has had its try at the URL.
 *
 * `errored` is the gap between the failure and the answer: the picture may be
 * gone, or the signature may have lapsed under a connection that dropped, and
 * the two look identical from inside an `<img>`.
 */
export type PictureState = 'ok' | 'errored' | 'missing';

/**
 * The missing-file state for surfaces that let the browser try the URL first.
 *
 * A row cannot probe up front the way a document list does: a table of two
 * hundred items would ask the backend two hundred extra questions to draw tiles
 * that are almost always fine. It waits for the `<img>` to fail instead and
 * only then asks whether the file is missing or the request merely failed — one
 * probe per broken tile, none at all for a healthy list.
 *
 * Only a 404 turns into `missing`: an inconclusive probe leaves the tile in
 * `errored`, where the caller hides the browser's glyph without claiming the
 * picture is gone.
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
    // Starts the probe. Its answer arrives outside a render, which is what the
    // re-render below and `MediaUrls`' own host call are for.
    this.urls.presence(itemId, attachmentId);
    this.host.requestUpdate();
  }

  /**
   * One tile's image loaded after all.
   *
   * The failure a probe could not explain sticks to the attachment, and the
   * next URL for those same bytes — a re-signed one, half an hour later — is
   * the first chance to find out it was the request and not the file. Without
   * this the tile would stay in the state a single dropped connection left it
   * in, holding a picture the browser is now showing.
   */
  noteLoad(itemId: string, attachmentId: string): void {
    if (!this.errored.delete(`${itemId}/${attachmentId}`)) return;
    this.host.requestUpdate();
  }
}

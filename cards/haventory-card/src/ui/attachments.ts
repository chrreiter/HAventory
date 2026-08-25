import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { icon } from './icons';
import type { MediaBindings } from './media';
import type { Item } from '../store/types';
import '../components/hv-lightbox';

/**
 * The photo tile and the document row, as the editor and the detail sheet both
 * draw them.
 *
 * The two surfaces show the same attachments for two different jobs — one
 * manages them, one reads them — so their strips differ in size, in what sits
 * beside each entry and in the words on the link. What they must never differ
 * in is what happens when the backend has no file behind a reference: an export
 * carries the metadata and not the bytes, so a fresh install genuinely holds
 * pictures and documents whose files were never uploaded to it, and both
 * surfaces answer that with the same amber mark rather than handing an `<img>`
 * or a link a URL that can only 404. That rule, and the branch it hangs on,
 * are written here once.
 *
 * The sizes, the tile classes and the test-ids stay parameters: a browser
 * harness locates the editor's and the sheet's strips separately, and one
 * renderer is what keeps them byte-identical.
 */

/** Two classes into one attribute, without the gap an absent one would leave. */
const classes = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

/** What the backend can say about one attachment's file. */
export interface AttachmentFile {
  /** The signed URL, or null while it is being signed or when signing failed. */
  src: string | null;
  /** The backend has the reference and not the file. */
  missing: boolean;
}

/** How a surface dresses its picture strip. */
export interface PhotoFigureStyle {
  /** `editor-photo` / `sheet-photo`; the tiles and the button take suffixes. */
  testid: string;
  /** The camera glyph's size, which follows the tile size the strip draws. */
  glyph: number;
  /** Classes on the tiles drawn in place of a photo. */
  tileClass?: string;
  /** Classes on the button that opens the lightbox. */
  openClass?: string;
  /**
   * Draw a tile while there is no URL yet. Without it the figure is left out
   * of the strip entirely until there is something in it to show.
   */
  pendingTile?: boolean;
}

/** One picture: what it is called, and what opens it. */
export interface PhotoFigure extends AttachmentFile {
  /** The image's alt text, which is also what the open button announces. */
  alt: string;
  openLabel: string;
  onOpen: () => void;
}

/**
 * One tile of a picture strip, or nothing when there is neither a picture to
 * show nor a state to report.
 *
 * `extra` is whatever the surface hangs on the tile — the editor's remove
 * button and its reorder row — and it is drawn for every state, including the
 * missing one: a reference the backend cannot resolve is still the item's to
 * clear.
 */
export function renderPhotoFigure(
  photo: PhotoFigure,
  style: PhotoFigureStyle,
  extra?: unknown,
): TemplateResult | null {
  if (!photo.missing && !photo.src && !style.pendingTile) return null;
  const glyph = icon('camera', style.glyph);
  const tile = photo.missing
    ? html`<span
        class=${classes(style.tileClass, 'missing')}
        data-testid=${`${style.testid}-missing`}
      >
        ${glyph}
        <span class="hv-chip warning">${t('hv.term.fileMissing')}</span>
      </span>`
    : photo.src
      ? html`<button
          class=${ifDefined(style.openClass)}
          data-testid=${`${style.testid}-open`}
          aria-label=${photo.openLabel}
          @click=${photo.onOpen}
        >
          <img src=${photo.src} alt=${photo.alt} loading="lazy" decoding="async" />
        </button>`
      : html`<span class=${ifDefined(style.tileClass)} data-testid=${`${style.testid}-placeholder`}
          >${glyph}</span
        >`;
  return html`<figure data-testid=${style.testid}>${tile}${extra}</figure>`;
}

/** How a surface dresses its document rows. */
export interface DocumentRowStyle {
  /** `editor-document` / `sheet-document`; the chip and the link take suffixes. */
  testid: string;
  /** The file glyph's size, which follows the row height the surface draws. */
  glyph: number;
  /** What the link says beside its glyph, where the row has the width for words. */
  openText?: string;
  /** The link's accessible name and tooltip, where the row's own text is not it. */
  openLabel?: string;
  openTitle?: string;
}

/**
 * One row of a document list: the file glyph, whatever the surface puts in the
 * middle, the way in or the reason there is none, and whatever the surface
 * hangs on the end.
 *
 * The link is an anchor to the signed URL rather than a button that fetches
 * one: the URL has to be on the element before the tap, or a popup blocker
 * eats the tab a handler would open after awaiting a signature.
 */
export function renderDocumentRow(
  doc: AttachmentFile,
  style: DocumentRowStyle,
  body: unknown,
  tail?: unknown,
): TemplateResult {
  return html`<li class=${doc.missing ? 'missing' : ''} data-testid=${style.testid}>
    <span class="doc-icon">${icon('fileDocument', style.glyph)}</span>
    ${body}
    ${doc.missing
      ? html`<span class="hv-chip warning" data-testid=${`${style.testid}-missing`}
          >${t('hv.term.fileMissing')}</span
        >`
      : doc.src
        ? html`<a
            class="doc-open"
            data-testid=${`${style.testid}-open`}
            href=${doc.src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label=${ifDefined(style.openLabel)}
            title=${ifDefined(style.openTitle)}
            >${icon('openInNew', 15)}${style.openText}</a
          >`
        : null}
    ${tail}
  </li>`;
}

/** Where a surface's lightbox hangs, and what it does when it closes. */
export interface LightboxHost {
  /** `editor-lightbox-host` / `sheet-lightbox-host`. */
  testid: string;
  item: Item | null;
  media: MediaBindings | null;
  /** Which picture to open at, null for closed. */
  index: number | null;
  /**
   * Where focus belongs when the photo that opened it has been removed from
   * under it. Only the surface still on screen knows.
   */
  onOpenerGone: () => void;
  onClose: () => void;
}

/**
 * The lightbox, hung outside the surface that opens it.
 *
 * Its `close` is stopped here: a host listening to the surface for "the user is
 * done" must not read a photo being shut as the surface being shut.
 */
export function renderLightboxHost(opts: LightboxHost): TemplateResult {
  return html`<hv-lightbox
    data-testid=${opts.testid}
    .item=${opts.item}
    .media=${opts.media}
    .index=${opts.index}
    .onOpenerGone=${opts.onOpenerGone}
    @close=${(e: Event) => {
      e.stopPropagation();
      opts.onClose();
    }}
  ></hv-lightbox>`;
}

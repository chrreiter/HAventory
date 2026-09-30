import { css, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { icon } from './icons';
import type { MediaBindings } from './media';
import type { Item } from '../store/types';
import '../components/hv-lightbox';

/**
 * The photo tile and the document row, shared by the editor and the detail
 * sheet. An import can carry references whose files this install never got, so
 * both mark a missing file the same way rather than handing out a URL that 404s.
 */

const classes = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * The document row's leading glyph, which must not give up width to the name.
 * Usage: `static styles = [tokens, base, docIcon, css\`...\`]` on a `documents` list.
 */
export const docIcon = css`
  .documents .doc-icon {
    display: inline-grid;
    place-items: center;
    flex: none;
    color: var(--hv-text-secondary);
  }
`;

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
  /** Draw a tile while there is no URL yet, rather than leaving the figure out. */
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
 * One tile of a picture strip, or nothing to show. `extra` (the editor's remove
 * and reorder controls) is drawn in every state: a missing file is still clearable.
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
 * One row of a document list. The link is an anchor to the already-signed URL,
 * since a popup blocker eats a tab opened after awaiting a signature.
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
  /** Where focus goes when the photo that opened it was removed. */
  onOpenerGone: () => void;
  onClose: () => void;
}

/** The lightbox; its `close` is stopped here so a host does not read it as its own. */
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

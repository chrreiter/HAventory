import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { DialogFocus } from '../ui/dialog-focus';
import { MediaUrls, PictureFallback, attachmentNameToken, pictureAlt, pictures } from '../ui/media';
import type { MediaBindings } from '../ui/media';
import type { Item } from '../store/types';
import { nextZBase } from '../utils/zindex';

/**
 * An item's photos at full size, with the arrows, the counter and Escape. The
 * host sets the index to open at and nulls it on `close`. Focus returns to the
 * opener, or to `onOpenerGone` once that control has left the document.
 */
@customElement('hv-lightbox')
export class HVLightbox extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: contents;
      }
      .lightbox {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        background: #000;
        /* The controls' own backing: over a white photo it still gives the
           13px counter 4.5:1 under white ink. */
        --hv-lightbox-scrim: rgba(0, 0, 0, 0.58);
      }
      .lightbox img {
        max-width: 100vw;
        max-height: 100vh;
        object-fit: contain;
      }
      /* White ink on the opaque black frame, not a themed surface. */
      .lightbox .missing {
        display: grid;
        place-items: center;
        gap: 12px;
        padding: 24px;
        color: #fff;
        font: 500 15px var(--hv-font);
      }
      .lightbox .close {
        position: absolute;
        top: 8px;
        right: 8px;
        min-width: 44px;
        min-height: 44px;
        display: inline-grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: var(--hv-lightbox-scrim);
        color: #fff;
      }
      .lightbox .nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        min-width: 44px;
        min-height: 44px;
        display: inline-grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: var(--hv-lightbox-scrim);
        color: #fff;
      }
      .lightbox .nav.prev {
        left: 8px;
      }
      .lightbox .nav.next {
        right: 8px;
      }
      .lightbox .counter {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 12px;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-lightbox-scrim);
        color: #fff;
        font: 500 13px var(--hv-font);
      }
    `,
  ];

  /** The item whose pictures these are. */
  @property({ attribute: false }) item: Item | null = null;
  /** Signing, for the attachment URLs. */
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** Which picture to open at, or null for closed; `close` is the cue to null it. */
  @property({ type: Number }) index: number | null = null;
  /** Where focus belongs when the opener has left the document. */
  @property({ attribute: false }) onOpenerGone: (() => void) | null = null;

  /** The picture actually shown, which the arrows move and `index` seeds. */
  @state() private _at: number | null = null;
  @state() private _zBase: number | null = null;

  private readonly _urls = new MediaUrls(this);
  private readonly _pictures = new PictureFallback(this, this._urls);
  private readonly _focus = new DialogFocus();

  protected willUpdate(changed: Map<string, unknown>) {
    this._urls.configure(this.media?.sign ?? null);
    if (changed.has('index')) {
      if (this.index !== null && this._at === null) this._zBase = nextZBase();
      this._at = this.index;
    }
    if (this._at === null) return;
    // A photo removed from under this must not leave an index past the end.
    const count = pictures(this.item?.attachments).length;
    this._at = count === 0 ? null : Math.min(this._at, count - 1);
  }

  protected updated() {
    const open = this._at !== null;
    this._focus.sync(
      open,
      () => this.renderRoot.querySelector<HTMLElement>('[data-testid="lightbox"]'),
      () => this.onOpenerGone?.(),
    );
    // Announced here whether the user closed it or the last photo went away.
    if (!open && this.index !== null) {
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    }
  }

  private _close = () => {
    this._at = null;
  };

  /** Wraps at the ends, so no arrow disables itself under the finger and drops focus. */
  private _step(delta: number, count: number) {
    if (this._at === null) return;
    this._at = (this._at + delta + count) % count;
  }

  render() {
    const item = this.item;
    const index = this._at;
    if (!item || index === null) return null;
    const shots = pictures(item.attachments);
    const shot = shots[index];
    if (!shot) return null;
    // An unsigned URL leaves the frame empty for a moment rather than
    // unmounting the overlay, which would drop focus and Escape with it.
    const src = this._urls.get(item.id, shot.id, attachmentNameToken(shot));
    // Answered from a load failure rather than probed on every arrow press.
    const missing = this._pictures.state(item.id, shot.id) === 'missing';

    const many = shots.length > 1;
    const nav = (delta: number) => (e: Event) => {
      // The backdrop closes on click and these sit on top of it.
      e.stopPropagation();
      this._step(delta, shots.length);
    };

    return html`<div
      class="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label=${pictureAlt(item.name, index, shots.length)}
      data-testid="lightbox"
      tabindex="-1"
      style="z-index: ${this._zBase ?? 9998};"
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          // Stopped, or the surface underneath closes too.
          e.preventDefault();
          e.stopPropagation();
          this._close();
          return;
        }
        if (!many) return;
        if (e.key === 'ArrowLeft') this._step(-1, shots.length);
        else if (e.key === 'ArrowRight') this._step(1, shots.length);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      @click=${this._close}
    >
      ${missing
        ? html`<div class="missing" data-testid="lightbox-missing">
            ${icon('camera', 48)}
            <span>${t('hv.term.fileMissing')}</span>
          </div>`
        : src
        ? html`<img
            src=${src}
            alt=${pictureAlt(item.name, index, shots.length)}
            @error=${() => this._pictures.noteError(item.id, shot.id)}
          />`
        : null}
      <button class="close" data-testid="lightbox-close" aria-label=${t('hv.lightbox.close')} @click=${this._close}>
        ${icon('close', 22)}
      </button>
      ${many
        ? html`<button class="nav prev" data-testid="lightbox-prev" aria-label=${t('hv.lightbox.previous')} @click=${nav(-1)}>
              ${icon('chevronLeft', 26)}
            </button>
            <button class="nav next" data-testid="lightbox-next" aria-label=${t('hv.lightbox.next')} @click=${nav(1)}>
              ${icon('chevronRight', 26)}
            </button>
            <!-- Announced rather than only drawn: the dialog's own label
                 changes with the photo, and a changed label is not re-read. -->
            <span class="counter" data-testid="lightbox-counter" aria-live="polite"
              >${t('hv.lightbox.counter', { index: index + 1, total: shots.length })}</span
            >`
        : null}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-lightbox': HVLightbox;
  }
}

import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { DialogFocus } from '../ui/dialog-focus';
import { MediaUrls, attachmentNameToken, pictureAlt, pictures } from '../ui/media';
import type { MediaBindings } from '../ui/media';
import type { Item } from '../store/types';
import { nextZBase } from '../utils/zindex';

/**
 * An item's photos at full size, with the arrows, the counter and Escape.
 *
 * The only way to see a photo at a useful size, so every surface that shows a
 * thumbnail can open it: the phone's detail sheet and the edit form on each of
 * its three hosts.
 *
 * The host says which photo to open at and nulls that back on `close`; where
 * the index goes after that is this component's own business. Focus returns to
 * whatever opened it, and `onOpenerGone` is the host's answer for the case where
 * that control has been taken out of the document — which is exactly what a
 * photo removed from under the lightbox does.
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
        /* Opaque rather than a scrim: a photo is what the surface is for, and
           whatever is behind it competes at any transparency. */
        background: #000;
        /* Every control here floats on the photo, so its own backing is the
           only contrast it is guaranteed. The worst case is a white frame,
           where this resolves to #6B6B6B — 5.3:1 under the white ink, enough
           for the counter, which is 13px text and therefore wants 4.5:1 rather
           than the 3:1 the chevrons would settle for. One value for all three,
           set by the strictest thing sitting on it. */
        --hv-lightbox-scrim: rgba(0, 0, 0, 0.58);
      }
      .lightbox img {
        max-width: 100vw;
        max-height: 100vh;
        object-fit: contain;
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
      /* Both controls sit on the photo, which is any colour at all — hence the
         scrim behind them rather than bare white glyphs. */
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
  /**
   * Which picture to open at, or null for closed. Set it to open; the `close`
   * event is the host's cue to set it back to null.
   */
  @property({ type: Number }) index: number | null = null;
  /**
   * Where focus belongs when the control that opened this is no longer in the
   * document. Only the host knows what is still on screen around it.
   */
  @property({ attribute: false }) onOpenerGone: (() => void) | null = null;

  /** The picture actually shown, which the arrows move and `index` seeds. */
  @state() private _at: number | null = null;
  @state() private _zBase: number | null = null;

  private readonly _urls = new MediaUrls(this);
  private readonly _focus = new DialogFocus();

  protected willUpdate(changed: Map<string, unknown>) {
    this._urls.configure(this.media?.sign ?? null);
    if (changed.has('index')) {
      if (this.index !== null && this._at === null) this._zBase = nextZBase();
      this._at = this.index;
    }
    if (this._at === null) return;
    // The strip survives a same-item refresh, and one of those refreshes is a
    // photo being removed from under this. An index past the end renders
    // nothing while still counting as open, which strands focus on a panel that
    // is no longer there.
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
    // One place announces the close, whether the user asked for it or the last
    // photo went away underneath.
    if (!open && this.index !== null) {
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    }
  }

  private _close = () => {
    this._at = null;
  };

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
    // A URL that is not signed yet leaves the frame empty for a moment; it does
    // not take the surface down. Every arrow press moves to a photo this
    // component has not shown before, and an overlay that unmounted while the
    // signature was in flight would flash the page underneath, drop focus on
    // `<body>` — taking Escape with it — and come back a stranger.
    const src = this._urls.get(item.id, shot.id, attachmentNameToken(shot));

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
          // Stopped here, or the surface under it takes the same Escape and
          // closes the whole item rather than the photo on top of it.
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
      ${src ? html`<img src=${src} alt=${pictureAlt(item.name, index, shots.length)} />` : null}
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

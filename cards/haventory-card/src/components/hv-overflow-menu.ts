import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { onEscape } from '../ui/keyboard';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { nextZBase } from '../utils/zindex';
import { DialogFocus } from '../ui/dialog-focus';

export interface OverflowMenuItem {
  id: string;
  label: string;
  glyph?: IconName;
  /** Right-aligned muted text, e.g. "Locations · Tags · Categories". */
  meta?: string;
  /** Second line under the label, e.g. "38 filtered items · keeps location paths". */
  sub?: string;
  /** Right-aligned pill, e.g. "2 issues". Only shown when there is something to say. */
  badge?: string;
  disabled?: boolean;
}

export type OverflowMenuEntry =
  | OverflowMenuItem
  | { divider: true }
  | { caption: string };

function isItem(entry: OverflowMenuEntry): entry is OverflowMenuItem {
  return 'id' in entry;
}

/**
 * The ⋮ menu for the card and full-view headers, and for each list row.
 *
 * Self-contained: it renders its own trigger and an anchored popover. HA's
 * `ha-button-menu`/`mwc-list-item` are not used because they only exist inside
 * the HA frontend — see the note in ui/icons.ts.
 */
@customElement('hv-overflow-menu')
export class HVOverflowMenu extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      .trigger.on-primary {
        color: #fff;
      }
      .trigger.on-primary:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .trigger[aria-expanded='true'] {
        background: var(--hv-primary-tint);
        color: var(--hv-on-primary-tint);
      }
      .menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: 250px;
        max-width: 80vw;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: 10px;
        box-shadow: var(--hv-shadow-menu);
        overflow: hidden;
        padding: 6px 0;
      }
      .entry {
        display: flex;
        align-items: center;
        gap: 11px;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 14px;
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .entry:hover:not([disabled]) {
        background: var(--hv-hover-overlay);
      }
      .entry[disabled] {
        opacity: 0.45;
        cursor: default;
      }
      .entry .glyph {
        color: var(--hv-text-secondary);
        flex: none;
        display: inline-flex;
      }
      .labels {
        flex: 1;
        min-width: 0;
        /* A label with no break opportunity ("Organize…") would otherwise spill
           out of its shrunken box and paint over whatever sits beside it. */
        overflow-wrap: anywhere;
      }
      .sub,
      .meta {
        display: block;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        margin-top: 1px;
      }
      .badge {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .divider {
        height: 1px;
        background: var(--hv-row-divider);
        margin: 5px 0;
      }
      .caption {
        padding: 6px 14px 3px;
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: var(--hv-text-tertiary);
      }

      /* An anchored 250px dropdown is a desktop shape. At 375px it covered most
         of the list it was supposed to be acting on and "Export current view"
         wrapped onto two lines, while the rest of the card answers exactly this
         need with a bottom sheet. The menu becomes one here.

         A media query rather than the card's mobile flag: once the panel is
         position: fixed it is placed against the viewport, so the viewport is
         what decides whether there is room — and it keeps the component free
         of a mobile property that all three of its callers would have to
         thread through.

         The width is NARROW_QUERY from ui/responsive.ts, which CSS cannot
         read; a test pins the two spellings together. Every overlay the card
         hosts flips at that one width, so a viewport never shows a sheet menu
         over a centred dialog. */
      /* The dropdown form needs no scrim; only the sheet dims the page. */
      .scrim {
        display: none;
      }
      @media (max-width: 700px) {
        .menu {
          position: fixed;
          inset: auto 0 0 0;
          width: auto;
          max-width: none;
          border-radius: var(--hv-radius-sheet) var(--hv-radius-sheet) 0 0;
          box-shadow: var(--hv-shadow-sheet);
          padding: 8px 0 max(8px, env(safe-area-inset-bottom));
          animation: rise var(--hv-motion-sheet) var(--hv-ease-out);
        }
        /*
         * Dims the page behind the sheet.
         *
         * This was a ::before on the menu, which put the wash on top of the
         * menu's own background rather than behind it: the menu carries a
         * z-index, so it establishes a stacking context, and inside one the
         * element's background paints first and negative-z-index children
         * paint next — above that background, below the content. The white
         * sheet came out washed 50% black under fully opaque text, which read
         * as a menu with no surface of its own. A sibling with its own z-index
         * paints where a backdrop belongs.
         *
         * pointer-events: none is what keeps the menu closable: it closes on any
         * outside pointerdown, and that check asks whether the event's composed
         * path includes this element — a scrim that swallowed the tap would be
         * inside the path and would stop the menu closing when you tapped away
         * from it.
         */
        .scrim {
          display: block;
          position: fixed;
          inset: 0;
          background: var(--hv-scrim);
          pointer-events: none;
        }
        .entry {
          min-height: 48px;
          padding: 10px 18px;
          font-size: 15px;
        }
        .caption {
          padding: 8px 18px 4px;
        }
      }
      @keyframes rise {
        from {
          transform: translateY(16px);
          opacity: 0;
        }
        to {
          transform: none;
          opacity: 1;
        }
      }
    `,
  ];

  @property({ attribute: false }) entries: OverflowMenuEntry[] = [];
  @property({ type: String }) label = 'More actions';
  /** Use the white-on-primary treatment for the full view's app bar. */
  @property({ type: Boolean }) onPrimary = false;

  @state() private _open = false;
  @state() private _zBase = 0;

  /** Opening the menu must put focus in it, or Escape never reaches it. */
  private _dialogFocus = new DialogFocus();

  private _onDocPointerDown = (e: Event) => {
    // composedPath sees through the shadow root, so clicks on our own menu don't close it.
    if (e.composedPath().includes(this)) return;
    this.close();
  };

  protected updated() {
    this._dialogFocus.sync(this._open, () =>
      this.renderRoot.querySelector<HTMLElement>('[data-testid="overflow-menu"]'),
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
  }

  close() {
    if (!this._open) return;
    this._open = false;
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
  }

  private _toggle = () => {
    if (this._open) {
      this.close();
      return;
    }
    this._zBase = nextZBase();
    this._open = true;
    document.addEventListener('pointerdown', this._onDocPointerDown, true);
  };

  private _choose(item: OverflowMenuItem) {
    if (item.disabled) return;
    this.close();
    this.dispatchEvent(
      new CustomEvent('select', { detail: { id: item.id }, bubbles: true, composed: true }),
    );
  }

  render() {
    // nextZBase() allocates the pair: the backdrop takes the base, the surface
    // over it takes base + 1.
    const z = this._zBase || 10000;
    return html`
      <button
        class="hv-icon-button trigger ${this.onPrimary ? 'on-primary' : ''}"
        data-testid="overflow-trigger"
        aria-haspopup="menu"
        aria-expanded=${String(this._open)}
        aria-label=${this.label}
        title=${this.label}
        @click=${this._toggle}
      >
        ${icon('dotsVertical', 20)}
      </button>
      ${this._open
        ? html`<div class="scrim" role="presentation" data-testid="overflow-scrim" style="z-index: ${z};"></div>
          <div
            class="menu"
            role="menu"
            data-testid="overflow-menu"
            style="z-index: ${z + 1};"
            @keydown=${onEscape(() => this.close())}
          >
            ${this.entries.map((entry) => {
              if ('divider' in entry) return html`<div class="divider" role="separator"></div>`;
              if ('caption' in entry) return html`<div class="caption">${entry.caption}</div>`;
              if (!isItem(entry)) return null;
              return html`<button
                class="entry"
                role="menuitem"
                data-testid="overflow-item"
                data-id=${entry.id}
                ?disabled=${entry.disabled}
                @click=${() => this._choose(entry)}
              >
                ${entry.glyph ? html`<span class="glyph">${icon(entry.glyph, 18)}</span>` : null}
                <span class="labels">
                  ${entry.label}${entry.sub ? html`<span class="sub">${entry.sub}</span>` : null}${
                    // Beside the label this had one line to share with it inside a
                    // 250px menu, so "Locations · Tags · Categories" ran straight
                    // over "Organize…". It is the same kind of hint as `sub`.
                    entry.meta ? html`<span class="meta">${entry.meta}</span>` : null
                  }
                </span>
                ${entry.badge ? html`<span class="badge">${entry.badge}</span>` : null}
              </button>`;
            })}
          </div>`
        : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-overflow-menu': HVOverflowMenu;
  }
}

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
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
 * The ⋮ menu that replaces the POC header's row of five buttons.
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
        color: var(--hv-primary-darker);
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
        ? html`<div
            class="menu"
            role="menu"
            data-testid="overflow-menu"
            style="z-index: ${this._zBase || 10000};"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
              }
            }}
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

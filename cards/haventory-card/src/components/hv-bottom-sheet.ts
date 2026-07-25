import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { nextZBase } from '../utils/zindex';

/**
 * The mobile surface for everything that would be a popup on desktop: the item
 * detail sheet, the filter sheet and the organize action sheet. The design's
 * central rule is "one surface, no popup chain" — nested content expands inside
 * this sheet rather than opening a second dialog.
 *
 * Content goes in the default slot; an optional `slot="footer"` sticks to the
 * bottom and does not scroll.
 */
@customElement('hv-bottom-sheet')
export class HVBottomSheet extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .scrim {
        position: fixed;
        inset: 0;
        background: var(--hv-scrim);
      }
      .sheet {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        /* The sheet is fixed to the viewport, not to the card that opened it,
           so on a desktop dashboard it would run the full screen width — 48px
           fact rows with the value flung to the far edge, and action buttons a
           metre wide. Cap it and let the auto margins centre it; on a phone
           min() resolves to 100% and this is a no-op. */
        width: min(100%, var(--hv-sheet-max-width, 640px));
        margin-inline: auto;
        max-height: 92vh;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-top: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-sheet) var(--hv-radius-sheet) 0 0;
        box-shadow: var(--hv-shadow-sheet);
        animation: rise var(--hv-motion-sheet) var(--hv-ease-out);
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
      .handle {
        width: 36px;
        height: 4px;
        border-radius: 2px;
        background: var(--hv-divider);
        margin: 8px auto 4px;
        flex: none;
      }
      .body {
        overflow-y: auto;
        overscroll-behavior: contain;
        flex: 1;
        min-height: 0;
      }
      slot[name='footer'] {
        display: block;
        flex: none;
        border-top: 1px solid var(--hv-row-divider);
        background: var(--hv-surface);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /** Accessible name for the dialog. */
  @property({ type: String }) label = 'Details';
  /** Hide the drag handle when the sheet has its own header affordance. */
  @property({ type: Boolean }) noHandle = false;

  @state() private _zBase: number | null = null;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
    }
  }

  private _cancel = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  render() {
    if (!this.open) return null;
    const z = this._zBase ?? 9998;
    return html`
      <div class="scrim" role="presentation" style="z-index: ${z};" @click=${this._cancel}></div>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label=${this.label}
        data-testid="bottom-sheet"
        style="z-index: ${z + 1};"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            this._cancel();
          }
        }}
      >
        ${this.noHandle ? null : html`<div class="handle" data-testid="sheet-handle"></div>`}
        <div class="body"><slot></slot></div>
        <slot name="footer"></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-bottom-sheet': HVBottomSheet;
  }
}

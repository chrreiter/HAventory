import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { onEscape } from '../ui/keyboard';
import { nextZBase } from '../utils/zindex';

/**
 * The mobile surface for everything that would be a popup on desktop. Nested
 * content expands inside it rather than opening a second dialog. An optional
 * `slot="footer"` sticks to the bottom and does not scroll.
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
        /* Fixed to the viewport, so capped and centred on a desktop. */
        width: min(100%, var(--hv-sheet-max-width, 640px));
        margin-inline: auto;
        /* dvh, not vh, or the sticky footer can land under a phone's URL bar. */
        max-height: 92dvh;
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
      /* A grab area bigger than the bar; without touch-action: none the browser
         claims the gesture as a scroll and no pointermove arrives. */
      .grip {
        flex: none;
        display: grid;
        place-items: center;
        padding: 8px 0 4px;
        touch-action: none;
        cursor: grab;
      }
      .grip:active {
        cursor: grabbing;
      }
      .handle {
        width: 36px;
        height: 4px;
        border-radius: 2px;
        background: var(--hv-divider);
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
  @property({ type: String }) label = t('hv.bottomSheet.label');
  /** Hide the drag handle when the sheet has its own header affordance. */
  @property({ type: Boolean }) noHandle = false;

  @state() private _zBase: number | null = null;
  /** How far the sheet has been dragged down, in px. 0 when not dragging. */
  @state() private _dragY = 0;

  /** Pointer Y where the current drag began, or null when none is in flight. */
  private _dragFrom: number | null = null;
  private _dragStartedAt = 0;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) this._zBase = nextZBase();
      this._dragFrom = null;
      this._dragY = 0;
    }
  }

  /**
   * Report the dismissal and leave the closing to the host. A sheet that closed
   * itself would fall out of step with the host's `open` binding, which Lit
   * then never sets back, so a host that asks first could not keep it up.
   */
  private _cancel = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  // ---------- Drag to dismiss ----------
  private _onGripDown = (e: PointerEvent) => {
    this._dragFrom = e.clientY;
    this._dragStartedAt = e.timeStamp;
    // Keeps the move/up events coming even if the finger leaves the grip.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  private _onGripMove = (e: PointerEvent) => {
    if (this._dragFrom === null) return;
    // Only downward travel moves the sheet.
    this._dragY = Math.max(0, e.clientY - this._dragFrom);
  };

  private _onGripUp = (e: PointerEvent) => {
    if (this._dragFrom === null) return;
    const travelled = this._dragY;
    const elapsed = Math.max(1, e.timeStamp - this._dragStartedAt);
    this._dragFrom = null;
    this._dragY = 0;

    const height = (this.renderRoot.querySelector('.sheet') as HTMLElement | null)?.offsetHeight ?? 0;
    // Dragged far enough, or flicked: a short fast throw dismisses too.
    const farEnough = travelled > Math.max(80, height * 0.25);
    const flicked = travelled > 24 && travelled / elapsed > 0.5;
    if (farEnough || flicked) this._cancel();
  };

  /** Put focus on the dialog panel, where Escape is bound, rather than the host. */
  focusPanel(): void {
    const panel = this.renderRoot.querySelector<HTMLElement>('.sheet');
    if (!panel) return;
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
    panel.focus({ preventScroll: true });
  }

  render() {
    if (!this.open) return null;
    const z = this._zBase ?? 9998;
    // Only while dragging, so the opening animation's transform runs untouched.
    const drag = this._dragY > 0 ? ` transform: translateY(${this._dragY}px); transition: none;` : '';
    return html`
      <div class="scrim" role="presentation" style="z-index: ${z};" @click=${this._cancel}></div>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label=${this.label}
        data-testid="bottom-sheet"
        style="z-index: ${z + 1};${drag}"
        @keydown=${onEscape(() => this._cancel())}
      >
        ${this.noHandle
          ? null
          : html`<div
              class="grip"
              data-testid="sheet-grip"
              aria-hidden="true"
              @pointerdown=${this._onGripDown}
              @pointermove=${this._onGripMove}
              @pointerup=${this._onGripUp}
              @pointercancel=${this._onGripUp}
            >
              <div class="handle" data-testid="sheet-handle"></div>
            </div>`}
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

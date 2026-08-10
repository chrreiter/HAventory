import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { dialogSheet } from '../ui/dialog-sheet';
import { onEscape } from '../ui/keyboard';
import { icon } from '../ui/icons';
import { nextZBase } from '../utils/zindex';
import './hv-banner';

/**
 * In-app confirmation dialog for destructive actions. The design is explicit
 * about this: destructive actions get a
 * styled dialog that can carry a warning strip ("6 of them are checked out"),
 * which a browser confirm cannot express.
 *
 * Presentational and self-contained: the caller opens it, supplies the copy, and
 * listens for `confirm` / `cancel`.
 */
@customElement('hv-confirm')
export class HVConfirm extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        box-sizing: border-box;
      }
      .panel {
        width: 330px;
        max-width: 100%;
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        overflow: hidden;
      }
      h2 {
        margin: 0;
        padding: 14px 18px 8px;
        font-size: 15px;
        font-weight: 500;
      }
      .message {
        padding: 0 18px 14px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--hv-text-secondary);
      }
      .warning {
        padding: 0 18px 14px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        padding: 0 14px 14px;
      }
    `,
    dialogSheet,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /** Phone viewport: rise from the bottom edge instead of centring. */
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ type: String }) heading = 'Are you sure?';
  @property({ type: String }) message = '';
  /** Optional warning strip rendered above the actions. */
  @property({ type: String }) warning: string | null = null;
  @property({ type: String }) confirmLabel = 'Confirm';
  @property({ type: String }) cancelLabel = 'Cancel';
  @property({ type: Boolean }) destructive = false;

  @state() private _zBase: number | null = null;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
    }
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      // Land focus on the confirm action so Enter completes and Esc aborts.
      const btn = this.shadowRoot?.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]');
      btn?.focus();
    }
  }

  private _cancel = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private _confirm = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('confirm', { bubbles: true, composed: true }));
  };

  render() {
    if (!this.open) return null;
    const z = this._zBase ?? 9998;
    return html`
      <div class="backdrop" role="presentation" style="z-index: ${z};" @click=${this._cancel}></div>
      <div class="wrap" role="none" style="z-index: ${z + 1};">
        <div
          class="panel"
          role="alertdialog"
          aria-modal="true"
          aria-label=${this.heading}
          data-testid="confirm-dialog"
          @keydown=${onEscape(() => this._cancel())}
        >
          <h2>${this.heading}</h2>
          ${this.message ? html`<div class="message" data-testid="confirm-message">${this.message}</div>` : null}
          ${this.warning
            ? html`<div class="warning">
                <hv-banner kind="error" .message=${this.warning} data-testid="confirm-warning"></hv-banner>
              </div>`
            : null}
          <div class="actions">
            <button class="hv-text-button" data-testid="confirm-cancel" @click=${this._cancel}>
              ${this.cancelLabel}
            </button>
            <button
              class="hv-pill ${this.destructive ? 'danger' : ''}"
              data-testid="confirm-accept"
              @click=${this._confirm}
            >
              ${this.destructive ? icon('del', 15) : null}${this.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-confirm': HVConfirm;
  }
}

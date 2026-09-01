import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { Modal, modalChrome, modalSheet } from '../ui/modal';
import { icon } from '../ui/icons';
import './hv-banner';

/**
 * In-app confirmation dialog for destructive actions. The design is explicit
 * about this: destructive actions get a
 * styled dialog that can carry a warning strip ("6 of them are checked out"),
 * which a browser confirm cannot express.
 *
 * Presentational and self-contained: the caller opens it, supplies the copy, and
 * listens for `confirm` / `cancel`. The caret lands on the accepting button so
 * Enter completes and Escape aborts, and goes back to whatever raised the
 * question once it is answered — the question is asked over work in progress.
 */
@customElement('hv-confirm')
export class HVConfirm extends LitElement {
  static styles = [
    tokens,
    base,
    modalChrome,
    css`
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
    modalSheet,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /** Phone viewport: rise from the bottom edge instead of centring. */
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ type: String }) heading = t('hv.confirm.heading');
  @property({ type: String }) message = '';
  /** Optional warning strip rendered above the actions. */
  @property({ type: String }) warning: string | null = null;
  @property({ type: String }) confirmLabel = t('hv.action.confirm');
  @property({ type: Boolean }) destructive = false;
  /**
   * The host's answer when focus cannot go back to what raised the question —
   * the opener the confirmed action removed, or a hover-revealed control the
   * browser is no longer drawing. Called only when focus would otherwise be
   * stranded on `<body>`.
   */
  @property({ attribute: false }) onOpenerGone: (() => void) | null = null;

  private _modal = new Modal(this, {
    open: () => this.open,
    // Land focus on the confirm action so Enter completes and Escape aborts.
    initialFocus: () => this.renderRoot.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]'),
    onOpenerGone: () => this.onOpenerGone?.(),
  });

  private _cancel = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private _confirm = () => {
    this.dispatchEvent(new CustomEvent('confirm', { bubbles: true, composed: true }));
  };

  render() {
    if (!this.open) return null;
    return this._modal.render(
      {
        label: this.heading,
        testid: 'confirm-dialog',
        role: 'alertdialog',
        onClose: this._cancel,
      },
      html`
        <h2>${this.heading}</h2>
        ${this.message ? html`<div class="message" data-testid="confirm-message">${this.message}</div>` : null}
        ${this.warning
          ? html`<div class="warning">
              <hv-banner kind="error" .message=${this.warning} data-testid="confirm-warning"></hv-banner>
            </div>`
          : null}
        <div class="actions">
          <button class="hv-text-button" data-testid="confirm-cancel" @click=${this._cancel}>
            ${t('hv.action.cancel')}
          </button>
          <button
            class="hv-pill ${this.destructive ? 'danger' : ''}"
            data-testid="confirm-accept"
            @click=${this._confirm}
          >
            ${this.destructive ? icon('del', 15) : null}${this.confirmLabel}
          </button>
        </div>
      `,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-confirm': HVConfirm;
  }
}

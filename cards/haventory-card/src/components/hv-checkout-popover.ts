import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { addDays, formatDate } from '../ui/relative-time';
import { nextZBase } from '../utils/zindex';
import { DialogFocus } from '../ui/dialog-focus';
import type { Item } from '../store/types';

const OFFSETS: { days: number; label: string }[] = [
  { days: 1, label: '+1 day' },
  { days: 7, label: '+7 days' },
  { days: 30, label: '+30 days' },
];

/** Default suggestion, matching the mock. */
const DEFAULT_OFFSET = 7;

/**
 * Check-out with an optional due date (mock 4g).
 *
 * The WS API takes `due_date` as optional — the POC card always checked out with
 * none — but the date is what makes overdue highlighting mean anything. So this
 * invites one with a sensible default instead of demanding it, and keeps "No due
 * date" as a first-class path rather than a cancel.
 *
 * Desktop anchors to the control that opened it; mobile fills the width as an
 * inline step.
 */
@customElement('hv-checkout-popover')
export class HVCheckoutPopover extends LitElement {
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
      }
      .card {
        position: fixed;
        width: 300px;
        max-width: calc(100vw - 16px);
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-panel);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
        overflow: hidden;
      }
      :host([mobile]) .card {
        position: static;
        width: auto;
        border: 1px solid var(--hv-primary);
        border-radius: var(--hv-radius-panel);
        box-shadow: none;
        background: var(--hv-surface-raised);
      }
      .head {
        padding: 14px 16px 10px;
      }
      .head .title {
        font: 500 15px var(--hv-font);
      }
      .head .sub {
        font-size: 12.5px;
        color: var(--hv-text-secondary);
        margin-top: 3px;
        line-height: 1.45;
      }
      .body {
        padding: 0 16px 12px;
        display: grid;
        gap: 8px;
      }
      .offsets {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
      }
      .offset {
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        padding: 6px 13px;
        font: 400 12.5px var(--hv-font);
      }
      :host([mobile]) .offset {
        min-height: 40px;
        padding: 0 15px;
        font-size: 13.5px;
      }
      .offset.on {
        background: var(--hv-primary-dark);
        border-color: var(--hv-primary-dark);
        color: #fff;
        font-weight: 500;
      }
      .date {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid var(--hv-primary);
        border-radius: var(--hv-radius-input);
        font-size: 13.5px;
      }
      :host([mobile]) .date {
        min-height: 48px;
      }
      .date input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        font: inherit;
        color: inherit;
      }
      .date.none {
        border-color: var(--hv-divider);
        color: var(--hv-text-tertiary);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px 14px;
      }
      :host([mobile]) .actions {
        display: grid;
        gap: 9px;
        padding: 0 12px 14px;
      }
      .actions .spacer {
        margin-left: auto;
      }
      .confirm {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 8px 16px;
        font: 500 13px var(--hv-font);
      }
      :host([mobile]) .confirm {
        min-height: 50px;
        font-size: 15px;
      }
      :host([mobile]) .none-button {
        min-height: 48px;
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        font: 400 14px var(--hv-font);
      }
    `,
  ];

  @property({ attribute: false }) item: Item | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean, reflect: true }) mobile = false;
  /** Rectangle of the control that opened it; desktop anchors to this. */
  @property({ attribute: false }) anchor: DOMRect | null = null;
  /**
   * `check-out` starts a new check-out; `set-due-date` only changes the date on
   * an item that is already out.
   */
  @property({ type: String }) mode: 'check-out' | 'set-due-date' = 'check-out';

  @state() private _due: string | null = null;
  @state() private _zBase = 0;


  /** Opening a surface must put focus in it, or Escape never reaches it. */
  private _dialogFocus = new DialogFocus();

  protected updated() {
    this._dialogFocus.sync(this.open, () =>
      this.renderRoot.querySelector<HTMLElement>('[data-testid="checkout-popover"]'),
    );
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
      this._due = this.item?.due_date || addDays(DEFAULT_OFFSET);
    }
  }

  private _commit(dueDate: string | null) {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent(this.mode === 'set-due-date' ? 'set-due-date' : 'check-out', {
        detail: { itemId: this.item?.id, dueDate },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _cancel = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private get _position(): string {
    if (this.mobile || !this.anchor) return 'top: 20vh; left: 50%; transform: translateX(-50%);';
    const width = 300;
    const gap = 6;
    const viewportWidth = typeof window === 'undefined' ? width : window.innerWidth;
    const left = Math.max(8, Math.min(this.anchor.left, viewportWidth - width - 8));
    return `top: ${this.anchor.bottom + gap}px; left: ${left}px;`;
  }

  render() {
    if (!this.open || !this.item) return null;
    const z = this._zBase || 9998;
    const settingOnly = this.mode === 'set-due-date';

    const card = html`
      <div
        class="card"
        role="dialog"
        aria-modal="true"
        aria-label=${settingOnly ? 'Set due date' : `Check out ${this.item.name}`}
        data-testid="checkout-popover"
        style=${this.mobile ? '' : `z-index:${z + 1}; ${this._position}`}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            this._cancel();
          }
        }}
      >
        <div class="head">
          <div class="title" data-testid="checkout-title">
            ${settingOnly ? 'Set a due date' : `Check out ${this.item.name}`}
          </div>
          <div class="sub">A due date is optional — it's what makes overdue highlighting work.</div>
        </div>
        <div class="body">
          <div class="offsets">
            ${OFFSETS.map((offset) => {
              const value = addDays(offset.days);
              return html`<button
                class="offset ${this._due === value ? 'on' : ''}"
                data-testid="checkout-offset"
                data-days=${offset.days}
                @click=${() => {
                  this._due = value;
                }}
              >
                ${offset.label}
              </button>`;
            })}
          </div>
          <label class="date ${this._due ? '' : 'none'}" data-testid="checkout-date">
            ${icon('calendar', 17)}
            <span class="hv-sr-only">Due date</span>
            <input
              type="date"
              .value=${this._due ?? ''}
              @input=${(e: Event) => {
                this._due = (e.target as HTMLInputElement).value || null;
              }}
            />
            <span data-testid="checkout-date-label">${this._due ? formatDate(this._due) : 'No due date'}</span>
          </label>
        </div>
        <div class="actions">
          <button
            class="hv-text-button ${this.mobile ? 'none-button' : ''}"
            data-testid="checkout-no-date"
            @click=${() => this._commit(null)}
          >
            ${settingOnly ? 'Clear due date' : 'Check out with no due date'}
          </button>
          ${this.mobile ? null : html`<span class="spacer"></span>`}
          <button class="hv-text-button" data-testid="checkout-cancel" @click=${this._cancel}>Cancel</button>
          <button
            class="confirm"
            data-testid="checkout-confirm"
            ?disabled=${!this._due}
            @click=${() => this._commit(this._due)}
          >
            ${settingOnly ? 'Set' : 'Check out'}${this._due ? ` · due ${formatDate(this._due)}` : ''}
          </button>
        </div>
      </div>
    `;

    if (this.mobile) return card;
    return html`
      <div class="scrim" role="presentation" style="z-index:${z}" @click=${this._cancel}></div>
      ${card}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-checkout-popover': HVCheckoutPopover;
  }
}

import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { onEscape } from '../ui/keyboard';
import { icon } from '../ui/icons';
import { DEFAULT_CUSTOM_DAYS, addDays, formatDate } from '../ui/relative-time';
import { dayOffsets, renderDayOffsets } from '../ui/day-offsets';
import { nextZBase } from '../utils/zindex';
import { DialogFocus } from '../ui/dialog-focus';
import type { Item } from '../store/types';

/** Offset the popover pre-selects when it opens. */
const DEFAULT_OFFSET = 7;

/**
 * Check-out with an optional due date. It invites a date with a default
 * rather than demanding one, and keeps "No due date" as a first-class path.
 *
 * `inline` draws it as a step inside the caller's body (no scrim, no placement)
 * and `touch` sizes its controls for a finger; the two are independent. With
 * neither it anchors to the control that opened it, or centres without one.
 */
@customElement('hv-checkout-popover')
export class HVCheckoutPopover extends LitElement {
  static styles = [
    tokens,
    base,
    dayOffsets,
    css`
      :host {
        display: block;
      }
      .scrim {
        position: fixed;
        inset: 0;
      }
      /* Anchored, the scrim only catches the dismissing click. Centred, it dims
         like the confirm dialog it stands beside. */
      .scrim.dim {
        background: rgba(0, 0, 0, 0.35);
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
      :host([inline]) .card {
        position: static;
        width: auto;
        border: 1px solid var(--hv-primary);
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
      :host([touch]) .offset {
        min-height: 40px;
        padding: 0 15px;
        font-size: 13.5px;
      }
      :host([touch]) .day-box input {
        min-height: 44px;
        width: 88px;
        font-size: var(--hv-input-font, 14.5px);
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
      :host([touch]) .date {
        min-height: 48px;
        font-size: var(--hv-input-font, 13.5px);
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
      /* Three buttons do not fit across 300px once the confirm label carries a
         date, so the no-date button takes a row of its own. */
      .actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 12px 14px;
      }
      .actions .none-button {
        flex-basis: 100%;
      }
      :host(:not([touch])) .actions .none-button {
        text-align: left;
      }
      :host([touch]) .actions {
        display: grid;
        gap: 9px;
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
      :host([touch]) .confirm {
        min-height: 50px;
        font-size: 15px;
      }
      :host([touch]) .none-button {
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
  /** Draw as a step inside the caller's body instead of placing itself. */
  @property({ type: Boolean, reflect: true }) inline = false;
  /** Size the controls for a finger. */
  @property({ type: Boolean, reflect: true }) touch = false;
  /** Rectangle of the control that opened it; anchors to this when given one. */
  @property({ attribute: false }) anchor: DOMRect | null = null;
  /**
   * `check-out` starts a new check-out; `set-due-date` only changes the date on
   * an item that is already out.
   */
  @property({ type: String }) mode: 'check-out' | 'set-due-date' = 'check-out';
  /** Heading name when there is no saved item, as for an item still being created. */
  @property({ type: String }) itemName = '';

  @state() private _due: string | null = null;
  @state() private _zBase = 0;
  /** The +X days field is showing, and owns the date instead of a preset. */
  @state() private _customOpen = false;
  @state() private _customDays = DEFAULT_CUSTOM_DAYS;

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
      this._customOpen = false;
      this._customDays = DEFAULT_CUSTOM_DAYS;
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
    if (!this.anchor) return 'top: 20dvh; left: 50%; transform: translateX(-50%);';
    const width = 300;
    const gap = 6;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, Math.min(this.anchor.left, window.innerWidth - width - 8));
    // Roughly the card's height; it hangs above the anchor when that much room
    // is not left below.
    const height = 300;
    const below = viewportHeight - this.anchor.bottom - gap;
    const above = this.anchor.top - gap;
    if (below < height && above > below) {
      return `bottom: ${Math.round(viewportHeight - this.anchor.top + gap)}px; left: ${left}px;`;
    }
    return `top: ${Math.round(this.anchor.bottom + gap)}px; left: ${left}px;`;
  }

  render() {
    const subject = this.item?.name || this.itemName;
    if (!this.open || !subject) return null;
    const z = this._zBase || 9998;
    const settingOnly = this.mode === 'set-due-date';
    const action = settingOnly ? t('hv.action.set') : t('hv.action.checkOut');

    const card = html`
      <div
        class="card"
        role="dialog"
        aria-modal="true"
        aria-label=${settingOnly
          ? t('hv.checkout.setDueDate')
          : t('hv.checkout.checkOutNamed', { name: subject })}
        data-testid="checkout-popover"
        style=${this.inline ? '' : `z-index:${z + 1}; ${this._position}`}
        @keydown=${onEscape(() => this._cancel())}
      >
        <div class="head">
          <div class="title" data-testid="checkout-title">
            ${settingOnly
              ? t('hv.checkout.setADueDate')
              : t('hv.checkout.checkOutNamed', { name: subject })}
          </div>
          <div class="sub">${t('hv.checkout.sub')}</div>
        </div>
        <div class="body">
          ${renderDayOffsets(
            { current: this._due, customOpen: this._customOpen, customDays: this._customDays },
            {
              prefix: 'checkout',
              onPick: (date) => {
                this._customOpen = false;
                this._due = date;
              },
              onCustom: (date) => {
                this._customOpen = true;
                this._due = date;
              },
              // A cleared box leaves no due date, and the confirm button
              // disables itself on one.
              onDays: (days, date) => {
                this._customDays = days;
                this._due = date;
              },
            },
          )}
          <label class="date ${this._due ? '' : 'none'}" data-testid="checkout-date">
            ${icon('calendar', 17)}
            <span class="hv-sr-only">${t('hv.field.due_date')}</span>
            <input
              type="date"
              .value=${this._due ?? ''}
              @input=${(e: Event) => {
                this._due = (e.target as HTMLInputElement).value || null;
              }}
            />
            <span data-testid="checkout-date-label"
              >${this._due ? formatDate(this._due) : t('hv.checkout.noDueDate')}</span
            >
          </label>
        </div>
        <div class="actions">
          <button
            class="hv-text-button none-button"
            data-testid="checkout-no-date"
            @click=${() => this._commit(null)}
          >
            ${settingOnly ? t('hv.checkout.clearDueDate') : t('hv.checkout.withoutDueDate')}
          </button>
          ${this.touch ? null : html`<span class="spacer"></span>`}
          <button class="hv-text-button" data-testid="checkout-cancel" @click=${this._cancel}>
            ${t('hv.action.cancel')}
          </button>
          <button
            class="confirm"
            data-testid="checkout-confirm"
            ?disabled=${!this._due}
            @click=${() => this._commit(this._due)}
          >
            ${this._due
              ? t('hv.checkout.confirmWithDate', { action, date: formatDate(this._due) })
              : action}
          </button>
        </div>
      </div>
    `;

    if (this.inline) return card;
    return html`
      <div
        class="scrim ${this.anchor ? '' : 'dim'}"
        role="presentation"
        style="z-index:${z}"
        @click=${this._cancel}
      ></div>
      ${card}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-checkout-popover': HVCheckoutPopover;
  }
}

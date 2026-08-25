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
 * Check-out with an optional due date.
 *
 * The WS API takes `due_date` as optional, but the date is what makes overdue
 * highlighting mean anything. So this invites one with a sensible default
 * instead of demanding it, and keeps "No due date" as a first-class path rather
 * than a cancel.
 *
 * Where it draws and how big its controls are are two separate questions, and a
 * caller answers them independently. `inline` makes it a step inside the body of
 * the surface that opened it — no scrim, no placement of its own — which only a
 * surface that has a body to hold it can ask for. `touch` grows the controls to
 * thumb size, which any caller on a narrow surface needs, including the ones
 * that draw it as a centred dialog. Left as one flag, the second was only
 * available to callers that could take the first.
 *
 * With neither, it anchors to the control that opened it; with `touch` alone it
 * is a centred dialog with finger-sized controls.
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
      /* Anchored, this layer exists only to catch the click that dismisses, and
         a popover hanging off the control that opened it dims nothing. With no
         anchor it is a centred dialog instead — asked by a bar that has no
         control to hang from, about a whole selection — so it dims like the
         confirm it stands beside, at the same strength. */
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
      /* The shape is ui/day-offsets; a thumb's worth of height on top of it is
         this popover's, and the editor that draws the same chips grows them by
         its own amount. */
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
      /* Three buttons never fit across 300px once the confirm label carries a
         date: every one of them wrapped onto three lines. The escape hatch
         takes a row of its own and the pair that ends the dialog keeps the
         bottom one. */
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
  /**
   * Name to head the dialog with when there is no saved item behind it — the
   * editor can check out an item it is still in the middle of creating, which
   * has no id and no row yet.
   */
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
    const viewportWidth = typeof window === 'undefined' ? width : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
    const left = Math.max(8, Math.min(this.anchor.left, viewportWidth - width - 8));

    // Roughly what the card measures with the offsets, the date row and three
    // actions. Hang it above the anchor when that much room is not left below:
    // opened from a control far down a long form, a below-only popover runs off
    // the bottom of the screen.
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
              ? t('hv.checkout.confirmWithDate', {
                  action: settingOnly ? t('hv.action.set') : t('hv.action.checkOut'),
                  date: formatDate(this._due),
                })
              : settingOnly
                ? t('hv.action.set')
                : t('hv.action.checkOut')}
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

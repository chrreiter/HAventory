import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { formatDate, isOverdue, relativeTime } from '../ui/relative-time';
import { inferType } from '../ui/item-form';
import { displayPath, isLowStock } from './hv-list-row';
import type { Item, Location, LocationTreeNode, ScalarValue } from '../store/types';
import './hv-bottom-sheet';
import './hv-checkout-popover';
import './hv-item-editor';
import type { HVItemEditor } from './hv-item-editor';

/**
 * The mobile item surface (mocks 1e / 4i): tap a row, get one sheet.
 *
 * It lands on a read view — chips summarise state, the quantity hero is the
 * primary action — and swaps in place to the edit form. Nothing here opens a
 * second dialog; that is the whole point of the sheet.
 */
@customElement('hv-detail-sheet')
export class HVDetailSheet extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px 6px 4px;
      }
      .bar.edit {
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .bar .crumb {
        flex: 1;
        min-width: 0;
        font-size: 12.5px;
        color: var(--hv-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bar .heading {
        flex: 1;
        font-size: 16px;
        font-weight: 500;
      }
      .bar button.tap {
        min-width: 44px;
        min-height: 44px;
        border: none;
        background: none;
        color: var(--hv-text-secondary);
        display: inline-grid;
        place-items: center;
        border-radius: 50%;
      }
      .bar .text-action {
        border: none;
        background: none;
        color: var(--hv-primary-dark);
        min-height: 44px;
        padding: 0 14px;
        font: 500 14px var(--hv-font);
      }
      .bar .save {
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border-radius: var(--hv-radius-chip);
        height: 40px;
        padding: 0 20px;
        margin-right: 8px;
        font: 500 14px var(--hv-font);
      }
      .title {
        padding: 2px 18px 10px;
      }
      .title h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 500;
        line-height: 1.25;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .chip {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-chip-bg);
        color: var(--hv-chip-text);
        padding: 3px 9px;
        font: 400 11.5px var(--hv-font);
      }
      .chip.state {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .chip.overdue {
        background: var(--hv-error);
        color: #fff;
      }
      .chip.low {
        background: var(--hv-warn-bg);
        color: var(--hv-warn);
        font-weight: 700;
        letter-spacing: 0.4px;
      }
      .hero {
        margin: 0 14px 14px;
        background: var(--hv-surface-raised);
        border-radius: 14px;
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
      }
      .hero button {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: inline-grid;
        place-items: center;
        flex: none;
        padding: 0;
      }
      .hero .minus {
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-text);
      }
      .hero .plus {
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
      }
      .hero button[disabled] {
        opacity: 0.4;
      }
      .hero .readout {
        text-align: center;
        min-width: 90px;
      }
      .hero .qty {
        font-size: 34px;
        font-weight: 500;
        line-height: 1;
      }
      .hero .qty.low {
        color: var(--hv-warn);
      }
      .hero .caption {
        font-size: 11.5px;
        color: var(--hv-text-secondary);
        margin-top: 6px;
      }
      .description {
        padding: 0 18px 12px;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--hv-text-secondary);
      }
      .facts {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
      }
      .fact {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 8px 18px;
        background: var(--hv-surface);
        font-size: 13.5px;
        color: var(--hv-text-secondary);
      }
      .fact .value {
        margin-left: auto;
        color: var(--hv-text);
        text-align: right;
      }
      .fact .value.unset {
        color: var(--hv-text-tertiary);
      }
      .fact .value.yes {
        color: var(--hv-success);
      }
      .actions {
        display: grid;
        gap: 9px;
        padding: 12px 14px 16px;
      }
      .actions .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .actions .outline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 50px;
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-text);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .actions .primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 50px;
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .actions .danger {
        min-height: 48px;
        border: none;
        background: none;
        color: var(--hv-error-soft);
        font: 400 14px var(--hv-font);
      }
    `,
  ];

  @property({ attribute: false }) item: Item | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  @property({ attribute: false }) categorySuggestions: string[] = [];
  @property({ attribute: false }) tagSuggestions: string[] = [];
  @property({ attribute: false }) customFieldKeys: string[] = [];
  @property({ type: Boolean }) busy = false;
  @property({ type: String }) errorMessage: string | null = null;

  @state() private _mode: 'read' | 'edit' = 'read';
  /** The check-out date step, shown inline in the sheet rather than as a popup. */
  @state() private _checkoutOpen = false;

  protected willUpdate(changed: Map<string, unknown>) {
    // A fresh item, or a re-open, always lands on the read view.
    if (changed.has('item') || (changed.has('open') && this.open)) {
      this._mode = 'read';
      this._checkoutOpen = false;
    }
  }

  /** True when the edit form is open with unsaved changes. */
  get dirty(): boolean {
    if (this._mode !== 'edit') return false;
    return this._editor?.dirty ?? false;
  }

  private get _editor(): HVItemEditor | null {
    return this.shadowRoot?.querySelector('hv-item-editor') ?? null;
  }

  private _emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail: { itemId: this.item?.id, ...detail },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private _renderCustomFact(key: string, value: ScalarValue) {
    const type = inferType(value);
    if (type === 'boolean') {
      const on = value === true;
      return html`<div class="fact" data-testid="sheet-fact" data-key=${key}>
        <span>${key}</span>
        <span class="value ${on ? 'yes' : 'unset'}">
          ${on ? html`${icon('check', 15)} Yes` : 'No'}
        </span>
      </div>`;
    }
    return html`<div class="fact" data-testid="sheet-fact" data-key=${key}>
      <span>${key}</span>
      <span class="value">${type === 'date' ? formatDate(String(value)) : String(value)}</span>
    </div>`;
  }

  private _renderRead(item: Item) {
    const low = isLowStock(item);
    const overdue = isOverdue(item.due_date);
    const path = displayPath(item);
    const customEntries = Object.entries(item.custom_fields ?? {});

    return html`
      <div class="bar">
        <button class="tap" data-testid="sheet-close" aria-label="Close" @click=${this._close}>
          ${icon('close', 22)}
        </button>
        <span class="crumb" data-testid="sheet-path">${path || 'No location'}</span>
        <button
          class="text-action"
          data-testid="sheet-edit"
          @click=${() => {
            this._mode = 'edit';
          }}
        >
          Edit
        </button>
      </div>

      <div class="title">
        <h2 data-testid="sheet-name">${item.name}</h2>
        <div class="chips">
          ${low ? html`<span class="chip low" data-testid="sheet-low">LOW</span>` : null}
          ${item.checked_out
            ? html`<span class="chip state ${overdue ? 'overdue' : ''}" data-testid="sheet-out">
                ${overdue ? 'Overdue' : 'Out'}${item.due_date ? ` · due ${formatDate(item.due_date)}` : ''}
              </span>`
            : null}
          ${item.category ? html`<span class="chip" data-testid="sheet-category">${item.category}</span>` : null}
          ${item.tags.map((t) => html`<span class="chip" data-testid="sheet-tag">${t}</span>`)}
        </div>
      </div>

      <div class="hero">
        <button
          class="minus"
          data-testid="sheet-decrement"
          aria-label="Decrease quantity"
          ?disabled=${item.checked_out || item.quantity <= 0}
          @click=${() => this._emit('decrement')}
        >
          ${icon('minus', 22)}
        </button>
        <span class="readout">
          <span class="qty ${low ? 'low' : ''}" data-testid="sheet-qty">${item.quantity}</span>
          ${item.low_stock_threshold !== null
            ? html`<span class="caption" data-testid="sheet-threshold"
                >low-stock at ${item.low_stock_threshold}</span
              >`
            : null}
        </span>
        <button
          class="plus"
          data-testid="sheet-increment"
          aria-label="Increase quantity"
          ?disabled=${item.checked_out}
          @click=${() => this._emit('increment')}
        >
          ${icon('plus', 22)}
        </button>
      </div>

      ${item.description
        ? html`<div class="description" data-testid="sheet-description">${item.description}</div>`
        : null}

      <div class="facts">
        <div class="fact" data-testid="sheet-fact" data-key="due">
          <span>Due</span>
          <span class="value ${item.due_date ? '' : 'unset'}">${item.due_date ? formatDate(item.due_date) : 'Not set'}</span>
        </div>
        <div class="fact" data-testid="sheet-fact" data-key="inspection">
          <span>Last inspected</span>
          <span class="value ${item.inspection_date ? '' : 'unset'}"
            >${item.inspection_date ? formatDate(item.inspection_date) : 'Not set'}</span
          >
        </div>
        ${customEntries.map(([key, value]) => this._renderCustomFact(key, value))}
        <div class="fact" data-testid="sheet-fact" data-key="updated">
          <span>Updated</span>
          <span class="value" data-testid="sheet-updated"
            >${relativeTime(item.updated_at)} · v${item.version}</span
          >
        </div>
      </div>

      ${this._checkoutOpen
        ? html`<div style="padding: 0 14px 14px">
            <hv-checkout-popover
              mobile
              open
              data-testid="sheet-checkout"
              .item=${item}
              .mode=${item.checked_out ? 'set-due-date' : 'check-out'}
              @check-out=${(e: CustomEvent) => {
                this._checkoutOpen = false;
                this._emit('check-out-confirmed', {
                  dueDate: (e.detail as { dueDate: string | null }).dueDate,
                });
              }}
              @set-due-date=${(e: CustomEvent) => {
                this._checkoutOpen = false;
                this._emit('set-due-date', { dueDate: (e.detail as { dueDate: string | null }).dueDate });
              }}
              @cancel=${() => {
                this._checkoutOpen = false;
              }}
            ></hv-checkout-popover>
          </div>`
        : null}

      <div class="actions">
        <div class="pair">
          ${item.checked_out
            ? html`<button class="outline" data-testid="sheet-check-in" @click=${() => this._emit('check-in')}>
                ${icon('account', 18)}Check in
              </button>`
            : html`<button
                class="outline"
                data-testid="sheet-check-out"
                @click=${() => {
                  this._checkoutOpen = true;
                }}
              >
                ${icon('account', 18)}Check out
              </button>`}
          <button
            class="primary"
            data-testid="sheet-edit-details"
            @click=${() => {
              this._mode = 'edit';
            }}
          >
            ${icon('pencil', 18)}Edit details
          </button>
        </div>
        <button class="danger" data-testid="sheet-delete" @click=${() => this._emit('request-delete')}>
          Delete item
        </button>
      </div>
    `;
  }

  private _renderEdit(item: Item) {
    return html`
      <div class="bar edit">
        <button
          class="tap"
          data-testid="sheet-back"
          aria-label="Back"
          @click=${() => {
            this._mode = 'read';
          }}
        >
          ${icon('arrowLeft', 21)}
        </button>
        <span class="heading">Edit item</span>
        <button
          class="save"
          data-testid="sheet-save"
          ?disabled=${this.busy}
          @click=${() => this._editor?.shadowRoot?.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.click()}
        >
          ${this.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <hv-item-editor
        data-testid="sheet-editor"
        mobile
        noHeader
        .item=${item}
        .locations=${this.locations}
        .locationTree=${this.locationTree}
        .categorySuggestions=${this.categorySuggestions}
        .tagSuggestions=${this.tagSuggestions}
        .customFieldKeys=${this.customFieldKeys}
        .busy=${this.busy}
        .errorMessage=${this.errorMessage}
        @cancel=${() => {
          this._mode = 'read';
        }}
        @delete-item=${(e: Event) => {
          // The form has a Delete of its own, and this sheet is the only host
          // that never forwarded it — so the button sat there doing nothing.
          // Re-emitted as `request-delete`, the same event the read view's
          // Delete sends, so the host confirms it exactly once either way.
          e.stopPropagation();
          this._emit('request-delete');
        }}
      ></hv-item-editor>
    `;
  }

  render() {
    const item = this.item;
    return html`<hv-bottom-sheet
      data-testid="detail-sheet"
      ?open=${this.open && !!item}
      ?noHandle=${this._mode === 'edit'}
      label=${item?.name ?? 'Item'}
      @cancel=${this._close}
    >
      ${item ? (this._mode === 'edit' ? this._renderEdit(item) : this._renderRead(item)) : null}
    </hv-bottom-sheet>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-detail-sheet': HVDetailSheet;
  }
}

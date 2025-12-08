import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Item } from '../store/types';

@customElement('hv-item-row')
export class HVItemRow extends LitElement {
  static styles = css`
    :host { display: contents; }
    .row {
      display: grid;
      /* Use inherited grid columns from hv-inventory-list for alignment */
      grid-template-columns: var(--hv-grid-columns, minmax(120px, 2fr) 50px minmax(80px, 1fr) minmax(100px, 2fr) 160px);
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      box-sizing: border-box;
    }
    .name { display: inline-flex; align-items: center; gap: 8px; overflow: hidden; }
    .name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: #c62828; color: white; flex-shrink: 0; }
    .area { font-size: 12px; color: #666; flex-shrink: 0; }
    .cell-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; flex-wrap: nowrap; gap: 4px; justify-content: flex-end; }
    .actions button {
      margin: 0;
      padding: 4px 8px;
      white-space: nowrap;
      min-width: 32px;
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .actions button:hover { opacity: 0.9; }
    .actions button.btn-danger {
      background: var(--error-color, #db4437);
    }
    .actions button.btn-checkout {
      min-width: 40px;
      text-align: center;
    }
  `;

  @property({ attribute: false }) item!: Item;
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];
  @property({ attribute: false }) locations: Array<{ id: string; area_id: string | null }> = [];
  @property({ type: Boolean }) compact: boolean = false;

  private resolveAreaName(): string | null {
    // First try item's effective_area_id (inherited from location hierarchy)
    if (this.item.effective_area_id) {
      const area = this.areas.find((a) => a.id === this.item.effective_area_id);
      if (area) return area.name;
    }
    // Fallback to location's direct area_id
    if (!this.item.location_id) return null;
    const loc = this.locations.find((l) => l.id === this.item.location_id);
    if (!loc?.area_id) return null;
    const area = this.areas.find((a) => a.id === loc.area_id);
    return area?.name ?? null;
  }

  /** Get full location display with area prefix if available */
  private getFullLocationPath(): string {
    const locationPath = this.item.location_path?.display_path ?? '';
    if (!locationPath) return '';
    const areaName = this.resolveAreaName();
    if (areaName) {
      return `${areaName} > ${locationPath}`;
    }
    return locationPath;
  }

  private onDecrement() {
    this.dispatchEvent(new CustomEvent('decrement', { detail: { itemId: this.item.id }, bubbles: true, composed: true }));
  }
  private onIncrement() {
    this.dispatchEvent(new CustomEvent('increment', { detail: { itemId: this.item.id }, bubbles: true, composed: true }));
  }
  private onToggleCheckout() {
    this.dispatchEvent(new CustomEvent('toggle-checkout', { detail: { itemId: this.item.id }, bubbles: true, composed: true }));
  }
  private onEdit() {
    this.dispatchEvent(new CustomEvent('edit', { detail: { itemId: this.item.id }, bubbles: true, composed: true }));
  }

  private onKeyDown(e: KeyboardEvent) {
    const key = e.key;
    if (key === 'Enter') {
      e.preventDefault();
      this.onEdit();
      return;
    }
    if (key === 'Delete') {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('request-delete', { detail: { itemId: this.item.id }, bubbles: true, composed: true }));
      return;
    }
    if (key === '+' || key === '=' || key === 'Add') {
      e.preventDefault();
      this.onIncrement();
      return;
    }
    if (key === '-' || key === 'Subtract') {
      e.preventDefault();
      this.onDecrement();
      return;
    }
  }

  private get isLow(): boolean {
    const thr = this.item.low_stock_threshold;
    return typeof thr === 'number' && this.item.quantity <= thr;
  }

  render() {
    const item = this.item;
    const areaName = this.compact ? null : this.resolveAreaName();

    // Compact mode: Name, Qty, and essential buttons only
    if (this.compact) {
      return html`
        <div class="row" role="row" tabindex="0" @keydown=${this.onKeyDown} aria-label=${`Item ${item.name}`}>
        <div class="name" role="cell">
          <span>${item.name}</span>
          ${this.isLow ? html`<span class="badge" aria-label="Low stock">LOW</span>` : null}
        </div>
          <div role="cell">${item.quantity}</div>
          <div class="actions" role="cell">
            <button @click=${this.onDecrement} aria-label="Decrease quantity">−</button>
            <button @click=${this.onIncrement} aria-label="Increase quantity">+</button>
            <button @click=${this.onEdit} aria-label="Edit item">Edit</button>
          </div>
        </div>
      `;
    }

    // Full mode: All columns and buttons
    return html`
      <div class="row" role="row" tabindex="0" @keydown=${this.onKeyDown} aria-label=${`Item ${item.name}`}>
        <div class="name" role="cell">
          <span>${item.name}</span>
          ${this.isLow ? html`<span class="badge" aria-label="Low stock">LOW</span>` : null}
          ${areaName ? html`<span class="area">[${areaName}]</span>` : null}
        </div>
        <div role="cell">${item.quantity}</div>
        <div role="cell" class="cell-text" title=${item.category ?? ''}>${item.category ?? ''}</div>
        <div role="cell" class="cell-text" title=${this.getFullLocationPath()}>${this.getFullLocationPath()}</div>
        <div class="actions" role="cell">
          <button @click=${this.onDecrement} aria-label="Decrease quantity">−</button>
          <button @click=${this.onIncrement} aria-label="Increase quantity">+</button>
          <button
            class=${`btn-checkout${item.checked_out ? ' btn-danger' : ''}`}
            @click=${this.onToggleCheckout}
            aria-label="Toggle check out/in"
          >
            ${item.checked_out ? 'In' : 'Out'}
          </button>
          <button @click=${this.onEdit} aria-label="Edit item">Edit</button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-item-row': HVItemRow;
  }
}

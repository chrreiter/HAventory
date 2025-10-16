import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Item } from '../store/types';

@customElement('hv-item-row')
export class HVItemRow extends LitElement {
  static styles = css`
    :host { display: contents; }
    .row { display: grid; grid-template-columns: 1fr 60px 160px 1fr auto; gap: 8px; align-items: center; padding: 6px 0; }
    .name { display: inline-flex; align-items: center; gap: 8px; }
    .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: #c62828; color: white; }
    .area { font-size: 12px; color: #666; }
    .actions button { margin-left: 6px; }
  `;

  @property({ attribute: false }) item!: Item;

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
    return html`
      <div class="row" role="row" tabindex="0" @keydown=${this.onKeyDown} aria-label=${`Item ${item.name}`}>
        <div class="name" role="cell">
          <span>${item.name}</span>
          ${this.isLow ? html`<span class="badge" aria-label="Low stock">LOW</span>` : null}
          ${item.location_path ? html`<span class="area">[Area: ${item.location_path.name_path[1] ?? ''}]</span>` : null}
        </div>
        <div role="cell">${item.quantity}</div>
        <div role="cell">${item.category ?? ''}</div>
        <div role="cell">${item.location_path?.display_path ?? ''}</div>
        <div class="actions" role="cell">
          <button @click=${this.onDecrement} aria-label="Decrease quantity">−</button>
          <button @click=${this.onIncrement} aria-label="Increase quantity">+</button>
          <button @click=${this.onToggleCheckout} aria-label="Toggle check out/in">${item.checked_out ? 'In' : 'Out'}</button>
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

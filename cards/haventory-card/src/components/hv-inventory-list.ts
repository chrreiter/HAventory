import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Item } from '../store/types';

@customElement('hv-inventory-list')
export class HVInventoryList extends LitElement {
  static styles = css`
    :host {
      display: block;
      /* Define grid columns as CSS custom property for header/row alignment */
      /* Full mode: Name, Qty, Category, Location, Actions (4 buttons ~160px) */
      --hv-col-name: minmax(120px, 2fr);
      --hv-col-qty: 50px;
      --hv-col-category: minmax(80px, 1fr);
      --hv-col-location: minmax(100px, 2fr);
      --hv-col-actions: 160px;
      --hv-grid-columns: var(--hv-col-name) var(--hv-col-qty) var(--hv-col-category) var(--hv-col-location) var(--hv-col-actions);
      /* Compact mode: Name (flex), Qty (fixed), Actions (3 buttons ~120px) */
      --hv-col-actions-compact: 120px;
      --hv-grid-columns-compact: 1fr 50px var(--hv-col-actions-compact);
    }
    :host([compact]) {
      --hv-grid-columns: var(--hv-grid-columns-compact);
    }
    /* Fill mode: stretch to fill parent container (expanded view) */
    :host([fill]) {
      display: flex;
      flex-direction: column;
      height: 100%;
      align-items: stretch;
    }
    .header {
      display: grid;
      grid-template-columns: var(--hv-grid-columns);
      gap: 8px;
      align-items: center;
      font-weight: 600;
      border-bottom: 1px solid var(--divider-color, #ddd);
      padding: 6px 8px;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .header .hide-compact { display: block; }
    :host([compact]) .header .hide-compact { display: none; }

    .empty-state { padding: 32px 16px; text-align: center; color: #666; }
    .empty-state p { margin: 8px 0; }
    .empty-state .hint { font-size: 0.9em; opacity: 0.8; }
    /* Compact (card) mode: single scroll container with capped height */
    .plain-list {
      display: block;
      max-height: 500px;
      overflow-y: auto;
      overscroll-behavior: contain;
      touch-action: pan-y;
    }
    .plain-list hv-item-row {
      display: block;
    }
    /* Expanded (fill) mode: full-height scroll container */
    .fill-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      touch-action: pan-y;
    }
  `;

  @property({ attribute: false }) items: Item[] = [];
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];
  @property({ attribute: false }) locations: Array<{ id: string; area_id: string | null }> = [];
  @property({ type: Boolean, reflect: true }) compact: boolean = false;
  @property({ type: Boolean, reflect: true }) fill: boolean = false;

  private onRowEvent(type: string, e: CustomEvent) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail: e.detail, bubbles: true, composed: true }));
  }

  private onScroll(e: Event) {
    const el = e.currentTarget as HTMLElement;
    const { scrollTop, clientHeight, scrollHeight } = el;
    if (!scrollHeight || clientHeight >= scrollHeight) return;
    const ratio = (scrollTop + clientHeight) / scrollHeight;
    this.dispatchEvent(new CustomEvent('near-end', { detail: { ratio }, bubbles: true, composed: true }));
  }

  private renderRow(it: Item) {
    return html`
      <hv-item-row
        .item=${it}
        .areas=${this.areas}
        .locations=${this.locations}
        ?compact=${this.compact}
        @decrement=${(e: CustomEvent) => this.onRowEvent('decrement', e)}
        @increment=${(e: CustomEvent) => this.onRowEvent('increment', e)}
        @toggle-checkout=${(e: CustomEvent) => this.onRowEvent('toggle-checkout', e)}
        @edit=${(e: CustomEvent) => this.onRowEvent('edit', e)}
      ></hv-item-row>
    `;
  }

  private renderHeader() {
    return html`
      <div class="header" role="row">
        <div role="columnheader">Name</div>
        <div role="columnheader">Qty</div>
        <div role="columnheader" class="hide-compact">Category</div>
        <div role="columnheader" class="hide-compact">Location</div>
        <div role="columnheader" aria-hidden="true"></div>
      </div>
    `;
  }

  render() {
    if (this.items.length === 0) {
      return html`
        <div class="empty-state" role="status" aria-live="polite">
          <p>No items found</p>
          <p class="hint">Try adjusting your filters or add a new item.</p>
        </div>
      `;
    }

    // Expanded view (fill mode): plain list with full-height scroll container
    if (this.fill) {
      return html`
        ${this.renderHeader()}
        <div class="fill-list" role="rowgroup" @scroll=${this.onScroll}>
          ${repeat(this.items, (it) => it.id, (it) => this.renderRow(it))}
        </div>
      `;
    }

    // Compact card view: plain list with capped height
    return html`
      ${this.renderHeader()}
      <div class="plain-list" role="rowgroup" @scroll=${this.onScroll}>
        ${repeat(this.items, (it) => it.id, (it) => this.renderRow(it))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-inventory-list': HVInventoryList;
  }
}

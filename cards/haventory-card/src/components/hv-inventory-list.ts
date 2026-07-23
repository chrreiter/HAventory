import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Item } from '../store/types';
import type { ColumnKey } from '../store/columns';
import { COLUMN_DEFS, DEFAULT_COLUMN_PREFS, gridTemplateFor, normalizeColumns } from '../store/columns';

@customElement('hv-inventory-list')
export class HVInventoryList extends LitElement {
  static styles = css`
    :host {
      display: block;
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
      gap: 8px;
      align-items: center;
      font-weight: 600;
      border-bottom: 1px solid var(--divider-color, #ddd);
      padding: 6px 8px;
      flex-shrink: 0;
      box-sizing: border-box;
    }
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
  /** Optional middle columns to display (Name + Actions are always shown). */
  @property({ attribute: false }) columns: ColumnKey[] = [...DEFAULT_COLUMN_PREFS.expanded];

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
        .columns=${this._cols()}
        ?compact=${this.compact}
        @decrement=${(e: CustomEvent) => this.onRowEvent('decrement', e)}
        @increment=${(e: CustomEvent) => this.onRowEvent('increment', e)}
        @toggle-checkout=${(e: CustomEvent) => this.onRowEvent('toggle-checkout', e)}
        @edit=${(e: CustomEvent) => this.onRowEvent('edit', e)}
      ></hv-item-row>
    `;
  }

  private _cols(): ColumnKey[] {
    return normalizeColumns(this.columns);
  }

  private renderHeader() {
    const cols = this._cols();
    const template = gridTemplateFor(cols, { compact: this.compact });
    const labelFor = (k: ColumnKey) => COLUMN_DEFS.find((c) => c.key === k)?.label ?? k;
    return html`
      <div class="header" role="row" style="grid-template-columns: ${template};">
        <div role="columnheader">Name</div>
        ${cols.map((k) => html`<div role="columnheader">${labelFor(k)}</div>`)}
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

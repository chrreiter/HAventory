import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Item } from '../store/types';
import '@lit-labs/virtualizer';

@customElement('hv-inventory-list')
export class HVInventoryList extends LitElement {
  static styles = css`
    :host { display: block; }
    .header, .row { display: grid; grid-template-columns: 1fr 60px 160px 1fr auto; gap: 8px; align-items: center; }
    .header { font-weight: 600; border-bottom: 1px solid #ddd; padding: 6px 0; }
    lit-virtualizer { display: block; height: 420px; overflow: auto; }
  `;

  @property({ attribute: false }) items: Item[] = [];

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

  render() {
    return html`
      <div class="header" role="row">
        <div role="columnheader">Name</div>
        <div role="columnheader">Qty</div>
        <div role="columnheader">Category</div>
        <div role="columnheader">Location path</div>
        <div role="columnheader" aria-hidden="true"></div>
      </div>
      <lit-virtualizer
        role="rowgroup"
        @scroll=${this.onScroll}
        .items=${this.items}
        .renderItem=${(it: Item) => html`
          <hv-item-row
            .item=${it}
            @decrement=${(e: CustomEvent) => this.onRowEvent('decrement', e)}
            @increment=${(e: CustomEvent) => this.onRowEvent('increment', e)}
            @toggle-checkout=${(e: CustomEvent) => this.onRowEvent('toggle-checkout', e)}
            @edit=${(e: CustomEvent) => this.onRowEvent('edit', e)}
          ></hv-item-row>
        `}
      ></lit-virtualizer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-inventory-list': HVInventoryList;
  }
}

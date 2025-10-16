import { LitElement, css, html } from 'lit';
import type { HassLike } from './store/types';
import { Store } from './store/store';
import './components/hv-search-bar';
import './components/hv-inventory-list';
import './components/hv-item-row';
import './components/hv-item-dialog';
import './components/hv-location-selector';

export class HAventoryCard extends LitElement {
  static styles = css`
    :host { display: block; }
  `;

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;

  get hass(): HassLike | undefined {
    return this._hass;
  }

  set hass(h: HassLike | undefined) {
    this._hass = h;
    if (h && !this.store) {
      this.store = new Store(h);
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
      void this.store.init().catch(() => undefined);
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    // If hass was already set before connectedCallback ran, ensure subscription exists
    if (this.store && !this._storeUnsub) {
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._storeUnsub) {
      this._storeUnsub();
      this._storeUnsub = undefined;
    }
  }

  render() {
    const st = this.store?.state.value;
    const filters = st?.filters;
    return html`
      <div part="header">
        <strong>HAventory</strong>
      </div>
      <hv-search-bar
        .q=${filters?.q ?? ''}
        .areaId=${filters?.areaId ?? null}
        .locationId=${filters?.locationId ?? null}
        .includeSubtree=${filters?.includeSubtree ?? true}
        .checkedOutOnly=${filters?.checkedOutOnly ?? false}
        .lowStockFirst=${filters?.lowStockFirst ?? false}
        .sort=${filters?.sort}
        @change=${(e: CustomEvent) => this.store?.setFilters(e.detail)}
      ></hv-search-bar>

      <hv-inventory-list
        .items=${st?.items ?? []}
        @decrement=${(e: CustomEvent) => this.store?.adjustQuantity(e.detail.itemId, -1)}
        @increment=${(e: CustomEvent) => this.store?.adjustQuantity(e.detail.itemId, +1)}
        @toggle-checkout=${(e: CustomEvent) => {
          const item = st?.items.find((i) => i.id === e.detail.itemId);
          if (!item) return;
          if (item.checked_out) this.store?.markCheckedIn(item.id);
          else this.store?.checkOut(item.id, null);
        }}
        @edit=${(e: CustomEvent) => {
          const dialog = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: unknown };
          const item = st?.items.find((i) => i.id === e.detail.itemId);
          if (dialog && item) {
            // @ts-expect-error: assigning cross-component property
            dialog.item = item;
            // @ts-expect-error: assigning cross-component property
            dialog.open = true;
          }
        }}
        @request-delete=${(e: CustomEvent) => {
          const item = st?.items.find((i) => i.id === e.detail.itemId);
          if (!item) return;
          const confirmed = window.confirm(`Delete item '${item.name}'?`);
          if (confirmed) this.store?.deleteItem(item.id);
        }}
      ></hv-inventory-list>

      <hv-item-dialog
        @save=${(e: CustomEvent) => {
          const data = e.detail as Record<string, unknown>;
          // For MVP, treat as create
          // @ts-expect-error: ItemCreate shape
          this.store?.createItem(data);
        }}
        @cancel=${() => {}}
      ></hv-item-dialog>
    `;
  }
}

customElements.define('haventory-card', HAventoryCard);

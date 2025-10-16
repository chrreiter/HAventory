import { LitElement, css, html } from 'lit';
import { render as litRender } from 'lit/html.js';
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
  private expanded: boolean = false;
  private _overlayEl: HTMLDivElement | null = null;
  private _prevFocusEl: HTMLElement | null = null;

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
        <button data-testid="expand-toggle" @click=${() => this._toggleExpanded()} aria-expanded=${String(this.expanded)} aria-label=${this.expanded ? 'Collapse' : 'Expand'} style="float:right;">
          ${this.expanded ? '⤢ Collapse' : '⇱ Expand'}
        </button>
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
        @near-end=${(e: CustomEvent) => {
          const ratio = e.detail?.ratio ?? 0;
          void this.store?.prefetchIfNeeded(ratio);
        }}
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

  private _toggleExpanded() {
    const toggle = this.shadowRoot?.querySelector('[data-testid="expand-toggle"]') as HTMLElement | null;
    this._prevFocusEl = toggle ?? null;
    this.expanded = !this.expanded;
    if (this.expanded) this._renderOverlay(); else this._teardownOverlay();
    this.requestUpdate();
  }

  private _ensureOverlayRoot(): HTMLDivElement {
    let root = document.getElementById('haventory-overlay-root') as HTMLDivElement | null;
    if (!root) {
      root = document.createElement('div');
      root.id = 'haventory-overlay-root';
      document.body.appendChild(root);
    }
    return root;
  }

  private _renderOverlay() {
    const st = this.store?.state.value;
    const filters = st?.filters;
    const root = this._ensureOverlayRoot();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.expanded = false;
        this._teardownOverlay();
        this.requestUpdate();
        if (this._prevFocusEl) this._prevFocusEl.focus();
      }
    };
    const onFilterPatch = (patch: Partial<Store['state']['value']['filters']>) => {
      this.store?.setFilters(patch as unknown as Partial<import('./store/types').StoreFilters>);
    };
    const overlayTemplate = html`
      <style>
        .overlay-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 9998; }
        .overlay { position: fixed; inset: 0; z-index: 9999; display: grid; grid-template-rows: auto 1fr; }
        .ov-header { display:flex; align-items:center; justify-content: space-between; background: var(--card-background-color, #fff); padding: 10px 12px; }
        .ov-body { display: grid; grid-template-columns: 300px 1fr; gap: 12px; padding: 12px; height: calc(100vh - 48px); box-sizing: border-box; }
        .sidebar { background: var(--card-background-color, #fff); padding: 10px; border-right: 1px solid rgba(0,0,0,0.1); }
        .main { background: var(--card-background-color, #fff); padding: 10px; overflow: hidden; display: grid; grid-template-rows: auto 1fr; gap: 8px; }
        .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .sentinel { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      </style>
      <div class="overlay-backdrop" role="presentation"></div>
      <div class="overlay" role="dialog" aria-modal="true" @keydown=${onKeydown}>
        <span class="sentinel" tabindex="0" @focus=${() => this._focusLast(root!)}></span>
        <div class="ov-header">
          <div><strong>HAventory</strong></div>
          <div>
            <button data-testid="expand-toggle" @click=${() => this._toggleExpanded()} aria-label="Collapse">⤢ Collapse</button>
          </div>
        </div>
        <div class="ov-body">
          <div class="sidebar" data-testid="filters-panel" aria-label="Filters">
            <div class="row">
              <label>Area
                <select @change=${(e: Event) => onFilterPatch({ areaId: (e.target as HTMLSelectElement).value || null })}>
                  <option value="">All</option>
                </select>
              </label>
            </div>
            <div class="row">
              <label>Location
                <select @change=${(e: Event) => onFilterPatch({ locationId: (e.target as HTMLSelectElement).value || null })}>
                  <option value="">Root</option>
                </select>
              </label>
            </div>
            <div class="row">
              <label><input type="checkbox" .checked=${filters?.includeSubtree ?? true} @change=${(e: Event) => onFilterPatch({ includeSubtree: (e.target as HTMLInputElement).checked })} /> Include sublocations</label>
            </div>
            <div class="row">
              <label><input type="checkbox" .checked=${filters?.checkedOutOnly ?? false} @change=${(e: Event) => onFilterPatch({ checkedOutOnly: (e.target as HTMLInputElement).checked })} /> Checked-out only</label>
            </div>
            <div class="row">
              <label><input type="checkbox" .checked=${filters?.lowStockFirst ?? false} @change=${(e: Event) => onFilterPatch({ lowStockFirst: (e.target as HTMLInputElement).checked })} /> Low-stock first</label>
            </div>
            <div class="row">
              <label>Sort
                <select @change=${(e: Event) => onFilterPatch({ sort: { field: (e.target as HTMLSelectElement).value as import('./store/types').Sort['field'], order: filters?.sort?.order ?? 'desc' } })}>
                  <option value="name" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'name'}>Name</option>
                  <option value="updated_at" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'updated_at'}>Updated</option>
                  <option value="created_at" ?selected=${filters?.sort?.field === 'created_at'}>Created</option>
                  <option value="quantity" ?selected=${filters?.sort?.field === 'quantity'}>Quantity</option>
                </select>
              </label>
            </div>
            <details data-testid="diagnostics-panel" style="margin-top: 12px;">
              <summary>Diagnostics</summary>
              <div>WS: items ${st?.connected.items ? 'connected' : 'disconnected'}, stats ${st?.connected.stats ? 'connected' : 'disconnected'}</div>
              <div>Counts: ${st?.statsCounts ? JSON.stringify(st.statsCounts) : '—'}</div>
              <div>Cursor: ${st?.cursor ?? '—'}</div>
            </details>
          </div>
          <div class="main">
            <div class="row">
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
              <button @click=${() => {
                const dialog = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { open: boolean } | null;
                if (dialog) dialog.open = true as unknown as boolean;
              }}>Add</button>
            </div>
            <div style="min-height:0; overflow:hidden;">
              ${html`
                <hv-inventory-list
                  .items=${st?.items ?? []}
                  @near-end=${(e: CustomEvent) => { const ratio = e.detail?.ratio ?? 0; void this.store?.prefetchIfNeeded(ratio); }}
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
              `}
            </div>
          </div>
        </div>
        <span class="sentinel" tabindex="0" @focus=${() => this._focusFirst(root!)}></span>
      </div>`;

    litRender(overlayTemplate, root);
    this._overlayEl = root.querySelector('.overlay');
    // Focus first interactive in overlay
    this._focusFirst(root);
  }

  private _teardownOverlay() {
    const root = document.getElementById('haventory-overlay-root');
    if (root) {
      root.innerHTML = '';
    }
    this._overlayEl = null;
  }

  private _focusFirst(root: HTMLElement) {
    const focusables = this._getFocusables(root);
    if (focusables.length) focusables[0].focus();
  }

  private _focusLast(root: HTMLElement) {
    const focusables = this._getFocusables(root);
    if (focusables.length) focusables[focusables.length - 1].focus();
  }

  private _getFocusables(root: HTMLElement): HTMLElement[] {
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const list = Array.from(root.querySelectorAll<HTMLElement>(selector));
    return list.filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
  }
}

customElements.define('haventory-card', HAventoryCard);

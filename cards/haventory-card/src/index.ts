import { LitElement, css, html } from 'lit';
import { render as litRender } from 'lit/html.js';
import type { HassLike } from './store/types';
import { getDefaultOrderFor } from './store/sort';
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

  // Lovelace config (e.g., title)
  private config?: { title?: string };

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;
  private expanded: boolean = false;
  private _overlayEl: HTMLDivElement | null = null;
  private _prevFocusEl: HTMLElement | null = null;
  private _locationSelectorOpen = false;

  // Lovelace interface: called by HA when the card is created/configured
  public setConfig(cfg: unknown): void {
    if (cfg !== null && typeof cfg !== 'object') {
      throw new Error('Invalid config');
    }
    const obj = (cfg || {}) as { title?: unknown };
    this.config = {
      title: typeof obj.title === 'string' ? obj.title : undefined
    };
  }

  // Lovelace interface: approximate rows occupied to help layout
  public getCardSize(): number {
    // Approximate: header + search + list viewport
    return 6;
  }

  get hass(): HassLike | undefined {
    return this._hass;
  }

  set hass(h: HassLike | undefined) {
    this._hass = h;
    if (h && !this.store) {
      this.store = new Store(h);
      this._storeUnsub = this.store.state.onChange(() => {
        this.requestUpdate();
        if (this.expanded) this._renderOverlay();
      });
      void this.store.init().catch(() => undefined);
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    // If hass was already set before connectedCallback ran, ensure subscription exists
    if (this.store && !this._storeUnsub) {
      this._storeUnsub = this.store.state.onChange(() => {
        this.requestUpdate();
        if (this.expanded) this._renderOverlay();
      });
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
      <div part="header" style="display: flex; align-items: center; justify-content: space-between; padding: 8px;">
        <strong>${this.config?.title ?? 'HAventory'}</strong>
        <div style="display: flex; gap: 8px;">
          <button @click=${() => {
            const dialog = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: unknown } | null;
            if (dialog) {
              dialog.item = null;
              dialog.open = true;
            }
          }} aria-label="Add item" title="Add item">+</button>
          <button data-testid="expand-toggle" @click=${() => this._toggleExpanded()} aria-expanded=${String(this.expanded)} aria-label=${this.expanded ? 'Collapse' : 'Expand'}>
            ${this.expanded ? '⤢ Collapse' : '⇱ Expand'}
          </button>
        </div>
      </div>
      ${this._renderBanners()}
      <hv-search-bar
        .q=${filters?.q ?? ''}
        .areaId=${filters?.areaId ?? null}
        .locationId=${filters?.locationId ?? null}
        .includeSubtree=${filters?.includeSubtree ?? true}
        .checkedOutOnly=${filters?.checkedOutOnly ?? false}
        .lowStockFirst=${filters?.lowStockFirst ?? false}
        .sort=${filters?.sort}
        .areas=${st?.areasCache?.areas ?? []}
        .locations=${st?.locationsFlatCache ?? []}
        @change=${(e: CustomEvent) => this.store?.setFilters(e.detail)}
      ></hv-search-bar>

      <hv-inventory-list
        .items=${st?.items ?? []}
        .areas=${st?.areasCache?.areas ?? []}
        .locations=${st?.locationsFlatCache ?? []}
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
            dialog.item = item;
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
        @open-location-selector=${() => { this._locationSelectorOpen = true; this.requestUpdate(); }}
        @delete-item=${(e: CustomEvent) => {
          const { itemId, name } = e.detail as { itemId: string; name: string };
          const confirmed = window.confirm(`Delete item '${name}'?`);
          if (confirmed) this.store?.deleteItem(itemId);
        }}
        @save=${(e: CustomEvent) => {
          const data = e.detail as Record<string, unknown>;
          const dlg = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { item?: { id?: string } | null; open?: boolean };
          const currentItem = dlg?.item ?? null;
          if (currentItem && currentItem.id) {
            // Update flow
            void this.store?.updateItem(currentItem.id, data as unknown as import('./store/types').ItemUpdate);
          } else {
            // Create flow
            void this.store?.createItem(data as unknown as import('./store/types').ItemCreate);
          }
          if (dlg) dlg.open = false;
        }}
        @cancel=${() => {
          const dlg = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { open?: boolean };
          if (dlg) dlg.open = false;
        }}
      ></hv-item-dialog>

      <hv-location-selector
        .open=${this._locationSelectorOpen}
        .locations=${this.store?.state.value.locationsFlatCache ?? null}
        @cancel=${() => { this._locationSelectorOpen = false; this.requestUpdate(); }}
        @select=${(e: CustomEvent) => {
          const { locationId, includeSubtree } = e.detail as { locationId: string | null; includeSubtree: boolean };
          // Patch dialog's location and update filters includeSubtree preference (non-destructive for list)
          const dlg = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { setLocation: (id: string | null) => void } | null;
          if (dlg) dlg.setLocation(locationId);
          this._locationSelectorOpen = false;
          // Also reflect includeSubtree in filters for later searches
          this.store?.setFilters({ includeSubtree });
          this.requestUpdate();
        }}
      ></hv-location-selector>
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
        .banners { display: grid; gap: 6px; margin: 8px 0; }
        .banner { padding: 8px 10px; border-radius: 6px; background: #fff3cd; color: #664d03; border: 1px solid #ffecb5; display: flex; justify-content: space-between; align-items: center; }
        .banner.error { background: #fdecea; color: #611a15; border-color: #f5c6cb; }
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
                <select @change=${(e: Event) => onFilterPatch({ areaId: (e.target as HTMLSelectElement).value || null })} .value=${filters?.areaId ?? ''}>
                  <option value="">All</option>
                  ${(st?.areasCache?.areas ?? []).map((a) => html`<option value=${a.id} ?selected=${filters?.areaId === a.id}>${a.name}</option>`)}
                </select>
              </label>
            </div>
            <div class="row">
              <label>Location
                <select @change=${(e: Event) => onFilterPatch({ locationId: (e.target as HTMLSelectElement).value || null })} .value=${filters?.locationId ?? ''}>
                  <option value="">All</option>
                  ${(st?.locationsFlatCache ?? []).map((l) => html`<option value=${l.id} ?selected=${filters?.locationId === l.id}>${l.path?.display_path || l.name}</option>`)}
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
                <span style="display:inline-flex; align-items:center; gap:6px;">
                  <select @change=${(e: Event) => {
                    const field = (e.target as HTMLSelectElement).value as import('./store/types').Sort['field'];
                    const order = getDefaultOrderFor(field);
                    onFilterPatch({ sort: { field, order } });
                  }}>
                    <option value="name" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'name'}>Name</option>
                    <option value="updated_at" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'updated_at'}>Updated</option>
                    <option value="created_at" ?selected=${filters?.sort?.field === 'created_at'}>Created</option>
                    <option value="quantity" ?selected=${filters?.sort?.field === 'quantity'}>Quantity</option>
                  </select>
                  <button
                    type="button"
                    data-testid="sort-order-toggle"
                    @click=${() => {
                      const currentField = filters?.sort?.field ?? 'updated_at';
                      const currentOrder = filters?.sort?.order ?? getDefaultOrderFor(currentField);
                      const nextOrder = currentOrder === 'asc' ? 'desc' : 'asc';
                      onFilterPatch({ sort: { field: currentField, order: nextOrder } });
                    }}
                    aria-label=${(filters?.sort?.order ?? 'desc') === 'asc' ? 'Ascending' : 'Descending'}
                    title=${(filters?.sort?.order ?? 'desc') === 'asc' ? 'Ascending' : 'Descending'}
                  >${(filters?.sort?.order ?? 'desc') === 'asc' ? 'A→Z' : 'Z→A'}</button>
                </span>
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
            <div class="banners">${this._renderBanners()}</div>
            <div class="row">
              <hv-search-bar
                .q=${filters?.q ?? ''}
                .areaId=${filters?.areaId ?? null}
                .locationId=${filters?.locationId ?? null}
                .includeSubtree=${filters?.includeSubtree ?? true}
                .checkedOutOnly=${filters?.checkedOutOnly ?? false}
                .lowStockFirst=${filters?.lowStockFirst ?? false}
                .sort=${filters?.sort}
                .areas=${st?.areasCache?.areas ?? []}
                .locations=${st?.locationsFlatCache ?? []}
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
                  .areas=${st?.areasCache?.areas ?? []}
                  .locations=${st?.locationsFlatCache ?? []}
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
                      dialog.item = item;
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
    const focusables = this._getFocusables(root).filter((el) => !el.classList.contains('sentinel'));
    if (focusables.length) focusables[0].focus();
  }

  private _focusLast(root: HTMLElement) {
    const focusables = this._getFocusables(root).filter((el) => !el.classList.contains('sentinel'));
    if (focusables.length) focusables[focusables.length - 1].focus();
  }

  private _getFocusables(root: HTMLElement): HTMLElement[] {
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const list = Array.from(root.querySelectorAll<HTMLElement>(selector));
    return list.filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
  }

  private _renderBanners() {
    const errs = this.store?.state.value.errorQueue ?? [];
    if (!errs.length) return null;
    return html`
      <div class="banners">
        ${errs.map((e) => html`
          <div class="banner ${e.kind === 'error' ? 'error' : ''}">
            <span>${e.message}</span>
            <span>
              ${e.kind === 'conflict' && e.itemId ? html`
                <button @click=${() => { void this.store?.refreshItem(e.itemId!); this.store?.dismissError(e.id); }}>View latest</button>
                ${e.changes ? html`<button @click=${() => { void this.store?.updateItem(e.itemId!, e.changes!); this.store?.dismissError(e.id); }}>Re-apply</button>` : null}
              ` : null}
              <button @click=${() => this.store?.dismissError(e.id)}>Dismiss</button>
            </span>
          </div>
        `)}
      </div>
    `;
  }
}

customElements.define('haventory-card', HAventoryCard);

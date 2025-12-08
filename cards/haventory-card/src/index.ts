import { LitElement, css, html } from 'lit';
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
    :host {
      display: block;
      font-family: var(--paper-font-body1_-_font-family, var(--ha-card-font-family, Arial, sans-serif));
      font-size: var(--mdc-typography-body2-font-size, 14px);
      line-height: var(--mdc-typography-body2-line-height, 20px);
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px;
    }
    .btn-add {
      font-weight: 700;
      padding: 8px 14px;
      min-width: 110px;
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }
    .header-actions button {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
    }
    .header-actions button:hover {
      opacity: 0.9;
    }
    .card-list-container {
      /* Let the inner list manage its own scrolling in compact view */
      overflow: visible;
    }
    .banners {
      display: grid;
      gap: 6px;
      margin: 8px 0;
    }
    .banner {
      padding: 8px 10px;
      border-radius: 6px;
      background: #fff3cd;
      color: #664d03;
      border: 1px solid #ffecb5;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .banner.error {
      background: #fdecea;
      color: #611a15;
      border-color: #f5c6cb;
    }
  `;

  // Lovelace config (e.g., title)
  private config?: { title?: string };

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;
  private expanded: boolean = false;
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
      <div class="card-header" part="header">
        <strong>${this.config?.title ?? 'HAventory'}</strong>
        <div class="header-actions">
          <button class="btn-add" @click=${() => {
            const dialog = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: unknown } | null;
            if (dialog) {
              dialog.item = null;
              dialog.open = true;
            }
          }} aria-label="Add item" title="Add item">Add item</button>
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

      <div class="card-list-container">
        <hv-inventory-list
          compact
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
      </div>

      <hv-item-dialog
        .locations=${st?.locationsFlatCache ?? null}
        .areas=${st?.areasCache?.areas ?? []}
        @open-location-selector=${() => { this._locationSelectorOpen = true; this.requestUpdate(); }}
        @delete-item=${(e: CustomEvent) => {
          const { itemId, name } = e.detail as { itemId: string; name: string };
          const confirmed = window.confirm(`Delete item '${name}'?`);
          if (confirmed) {
            void this.store?.deleteItem(itemId);
            const dlg = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & {
              open?: boolean;
            } | null;
            if (dlg) dlg.open = false;
          }
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

      ${this.expanded ? this._renderOverlayTemplate() : null}
    `;
  }

  private async _toggleExpanded() {
    const toggle = this.shadowRoot?.querySelector('[data-testid="expand-toggle"]') as HTMLElement | null;
    if (!this.expanded) {
      this._prevFocusEl = toggle ?? null;
    }
    this.expanded = !this.expanded;
    this.requestUpdate();
    await this.updateComplete;
    if (this.expanded) {
      this._focusFirst();
    } else if (this._prevFocusEl?.isConnected) {
      this._prevFocusEl.focus();
    }
  }

  private async _closeOverlay() {
    if (!this.expanded) return;
    this.expanded = false;
    this.requestUpdate();
    await this.updateComplete;
    if (this._prevFocusEl?.isConnected) {
      this._prevFocusEl.focus();
    }
  }

  private _renderOverlayTemplate() {
    const st = this.store?.state.value;
    const filters = st?.filters;
    return html`
      <style>
        .overlay-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 9998; }
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          grid-template-rows: auto 1fr;
          overflow: hidden;
          overscroll-behavior: contain;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
        }
        .ov-header { display: flex; align-items: center; justify-content: space-between; background: var(--card-background-color, #fff); padding: 10px 12px; }
        .ov-header button { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: inherit; }
        .ov-header button:hover { opacity: 0.9; }
        .ov-header-actions { display: inline-flex; align-items: center; gap: 8px; }
        .ov-body { display: grid; grid-template-columns: 300px 1fr; gap: 12px; padding: 12px; height: calc(100vh - 48px); box-sizing: border-box; overflow: hidden; }
        .sidebar { background: var(--card-background-color, #fff); padding: 10px; border-right: 1px solid rgba(0,0,0,0.1); overflow: auto; overscroll-behavior: contain; }
        .sidebar .row label { display: inline-flex; align-items: center; gap: 6px; }
        .sidebar select {
          background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
          color: var(--primary-text-color, #212121);
          border: 1px solid var(--divider-color, #ddd);
          border-radius: 4px;
          padding: 6px 8px;
          font-size: inherit;
          box-sizing: border-box;
          min-width: 140px;
        }
        .sidebar select:focus {
          outline: 2px solid var(--primary-color, #03a9f4);
          outline-offset: -1px;
        }
        .sidebar input[type=\"checkbox\"] {
          accent-color: var(--primary-color, #03a9f4);
        }
        .main { background: var(--card-background-color, #fff); padding: 10px; overflow: hidden; display: flex; flex-direction: column; gap: 8px; }
        .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .btn-add { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); border: none; border-radius: 4px; cursor: pointer; font-size: inherit; font-weight: 700; padding: 8px 14px; min-width: 110px; }
        .btn-add:hover { opacity: 0.9; }
        .sort-controls { display: inline-flex; align-items: center; gap: 6px; }
        .sort-controls button {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #fff);
          border: none;
          border-radius: 4px;
          padding: 6px 10px;
          cursor: pointer;
          font-size: inherit;
        }
        .sort-controls button:hover {
          opacity: 0.9;
        }
        .diagnostics { margin-top: 12px; }
        .list-container { min-height: 0; flex: 1; overflow: hidden; }
        .sentinel { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
        .banners { display: grid; gap: 6px; margin: 8px 0; }
        .banner { padding: 8px 10px; border-radius: 6px; background: #fff3cd; color: #664d03; border: 1px solid #ffecb5; display: flex; justify-content: space-between; align-items: center; }
        .banner.error { background: #fdecea; color: #611a15; border-color: #f5c6cb; }
      </style>
      <div class="overlay-backdrop" role="presentation" @click=${this._onOverlayBackdropClick}></div>
      <div class="overlay" role="dialog" aria-modal="true" @keydown=${this._onOverlayKeydown}>
        <span class="sentinel" tabindex="0" @focus=${() => this._focusLast()}></span>
        <div class="ov-header">
          <div><strong>HAventory</strong></div>
          <div class="ov-header-actions">
            <button
              class="btn-add"
              aria-label="Add item"
              @click=${() => {
                const dialog = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { open: boolean; item: unknown } | null;
                if (dialog) {
                  dialog.item = null;
                  dialog.open = true;
                }
              }}
            >Add item</button>
            <button data-testid="expand-toggle" @click=${this._onOverlayCollapseClick} aria-label="Collapse">⤢ Collapse</button>
          </div>
        </div>
        <div class="ov-body">
          <div class="sidebar" data-testid="filters-panel" aria-label="Filters">
            <div class="row">
              <label>Area
                <select @change=${(e: Event) => this.store?.setFilters({ areaId: (e.target as HTMLSelectElement).value || null } as Partial<import('./store/types').StoreFilters>)} .value=${filters?.areaId ?? ''}>
                  <option value=\"\">All</option>
                  ${(st?.areasCache?.areas ?? []).map((a) => html`<option value=${a.id} ?selected=${filters?.areaId === a.id}>${a.name}</option>`)}
                </select>
              </label>
            </div>
            <div class="row">
              <label>Location
                <select @change=${(e: Event) => this.store?.setFilters({ locationId: (e.target as HTMLSelectElement).value || null } as Partial<import('./store/types').StoreFilters>)} .value=${filters?.locationId ?? ''}>
                  <option value=\"\">All</option>
                  ${(st?.locationsFlatCache ?? []).map((l) => html`<option value=${l.id} ?selected=${filters?.locationId === l.id}>${l.path?.display_path || l.name}</option>`)}
                </select>
              </label>
            </div>
            <div class="row">
              <label><input type=\"checkbox\" .checked=${filters?.includeSubtree ?? true} @change=${(e: Event) => this.store?.setFilters({ includeSubtree: (e.target as HTMLInputElement).checked })} /> Include sublocations</label>
            </div>
            <div class="row">
              <label><input type=\"checkbox\" .checked=${filters?.checkedOutOnly ?? false} @change=${(e: Event) => this.store?.setFilters({ checkedOutOnly: (e.target as HTMLInputElement).checked })} /> Checked-out only</label>
            </div>
            <div class="row">
              <label><input type=\"checkbox\" .checked=${filters?.lowStockFirst ?? false} @change=${(e: Event) => this.store?.setFilters({ lowStockFirst: (e.target as HTMLInputElement).checked })} /> Low-stock first</label>
            </div>
            <div class="row">
              <label>Sort
                <span class="sort-controls">
                  <select @change=${this._onOverlaySortFieldChange}>
                    <option value="name" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'name'}>Name</option>
                    <option value="updated_at" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'updated_at'}>Updated</option>
                    <option value="created_at" ?selected=${filters?.sort?.field === 'created_at'}>Created</option>
                    <option value="quantity" ?selected=${filters?.sort?.field === 'quantity'}>Quantity</option>
                  </select>
                  <button
                    type="button"
                    data-testid="sort-order-toggle"
                    @click=${this._onOverlaySortOrderToggle}
                    aria-label=${(filters?.sort?.order ?? 'desc') === 'asc' ? 'Ascending' : 'Descending'}
                    title=${(filters?.sort?.order ?? 'desc') === 'asc' ? 'Ascending' : 'Descending'}
                  >${(filters?.sort?.order ?? 'desc') === 'asc' ? 'A→Z' : 'Z→A'}</button>
                </span>
              </label>
            </div>
            <details class="diagnostics" data-testid="diagnostics-panel">
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
            </div>
            <div class="list-container">
              ${html`
                <hv-inventory-list
                  fill
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
        <span class="sentinel" tabindex="0" @focus=${() => this._focusFirst()}></span>
      </div>`;
  }

  private _onOverlayBackdropClick = () => {
    void this._closeOverlay();
  };

  private _onOverlayCollapseClick = () => {
    void this._closeOverlay();
  };

  private _onOverlayKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void this._closeOverlay();
    }
  };

  private _onOverlaySortFieldChange = (e: Event) => {
    const field = (e.target as HTMLSelectElement | null)?.value as import('./store/types').Sort['field'] | undefined;
    if (!field) return;
    const order = getDefaultOrderFor(field);
    this.store?.setFilters({ sort: { field, order } } as Partial<import('./store/types').StoreFilters>);
  };

  private _onOverlaySortOrderToggle = () => {
    const filters = this.store?.state.value.filters;
    const currentField = filters?.sort?.field ?? 'updated_at';
    const currentOrder = filters?.sort?.order ?? getDefaultOrderFor(currentField);
    const nextOrder = currentOrder === 'asc' ? 'desc' : 'asc';
    this.store?.setFilters({ sort: { field: currentField, order: nextOrder } } as Partial<import('./store/types').StoreFilters>);
  };

  private _focusFirst(root: HTMLElement | ShadowRoot | null = this.shadowRoot) {
    if (!root) return;
    const focusables = this._getFocusables(root).filter((el) => !el.classList.contains('sentinel'));
    if (focusables.length) focusables[0].focus();
  }

  private _focusLast(root: HTMLElement | ShadowRoot | null = this.shadowRoot) {
    if (!root) return;
    const focusables = this._getFocusables(root).filter((el) => !el.classList.contains('sentinel'));
    if (focusables.length) focusables[focusables.length - 1].focus();
  }

  private _getFocusables(root: HTMLElement | ShadowRoot): HTMLElement[] {
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

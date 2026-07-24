import { LitElement, css, html } from 'lit';
import type { HassLike, Item } from './store/types';
import type { HVLocationSelector } from './components/hv-location-selector';
import { getDefaultOrderFor } from './store/sort';
import { Store } from './store/store';
import type { ColumnKey, ColumnPrefs } from './store/columns';
import { loadColumnPrefs, saveColumnPrefs } from './store/columns';
import './components/hv-search-bar';
import './components/hv-inventory-list';
import './components/hv-item-row';
import './components/hv-item-dialog';
import './components/hv-location-selector';
import './components/hv-category-browser';
import './components/hv-tag-browser';
import './components/hv-column-picker';
import './components/hv-import-dialog';
import './components/hv-card-shell';
import type { ImportPolicy, ImportPreview, ImportSummary } from './store/types';

/** Which UI the card renders. `legacy` is the pre-WP4.1 proof-of-concept. */
export type CardUiMode = 'revamp' | 'legacy';

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
  private config?: { title?: string; ui?: CardUiMode };

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;
  private expanded: boolean = false;
  private _prevFocusEl: HTMLElement | null = null;
  private _locationSelectorOpen = false;
  private _locationSelectorCreateMode = false;
  private _categoryBrowserOpen = false;
  private _browseCategory: string | null = null;
  private _browseItems: Item[] = [];
  private _browseLoading = false;
  private _tagBrowserOpen = false;
  private _browseTag: string | null = null;
  private _browseTagItems: Item[] = [];
  private _browseTagLoading = false;
  private _columnPrefs: ColumnPrefs = loadColumnPrefs();
  private _columnPickerOpen = false;
  private _columnPickerScope: 'standard' | 'expanded' = 'standard';
  private _importDialogOpen = false;
  private _importPreview: ImportPreview | null = null;
  private _importSummary: ImportSummary | null = null;
  private _importBusy = false;
  private _importError: string | null = null;

  // Lovelace interface: called by HA when the card is created/configured
  public setConfig(cfg: unknown): void {
    if (cfg !== null && typeof cfg !== 'object') {
      throw new Error('Invalid config');
    }
    const obj = (cfg || {}) as { title?: unknown; ui?: unknown };
    this.config = {
      title: typeof obj.title === 'string' ? obj.title : undefined,
      // `ui: legacy` keeps the pre-WP4.1 proof-of-concept UI reachable while the
      // revamp is experimental. Anything else (including nothing) gets the new UI.
      ui: obj.ui === 'legacy' ? 'legacy' : 'revamp',
    };
    this.requestUpdate();
  }

  /** The UI mode in force; defaults to the revamped card. */
  private get uiMode(): CardUiMode {
    return this.config?.ui ?? 'revamp';
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
    return this.uiMode === 'legacy' ? this._renderLegacy() : this._renderRevamp();
  }

  /**
   * The revamped card (WP4.1). `haventory-card` stays the custom element HA
   * knows about and becomes a thin host: `hv-card-shell` owns the store, the
   * layout and item editing, while the two surfaces that are still modal (the
   * column picker and the import dialog) live here until their redesigns land.
   */
  private _renderRevamp() {
    return html`
      <hv-card-shell
        data-testid="card-shell"
        .store=${this.store}
        .heading=${this.config?.title ?? 'Inventory'}
        .columns=${this._columnPrefs.expanded}
        @menu-action=${(e: CustomEvent) => this._onShellAction((e.detail as { id: string }).id)}
      ></hv-card-shell>

      ${this._renderSharedDialogs()}
    `;
  }

  /** Dialogs the revamped shell delegates to the host card. */
  private _renderSharedDialogs() {
    return html`
      <hv-column-picker
        .open=${this._columnPickerOpen}
        .columns=${this._columnPrefs.expanded}
        heading="Full view columns"
        @change=${(e: CustomEvent) => this._setColumns('expanded', e.detail.columns as ColumnKey[])}
        @cancel=${() => { this._columnPickerOpen = false; this.requestUpdate(); }}
      ></hv-column-picker>

    `;
  }

  /** Actions the shell hands up because they open a host-owned surface. */
  private _onShellAction(id: string) {
    switch (id) {
      case 'columns':
        this._openColumnPicker('expanded');
        break;
      case 'export-all':
        void this._exportDownload('all');
        break;
      case 'export-view':
        void this._exportDownload('view');
        break;
    }
  }

  private _renderLegacy() {
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
          <button data-testid="browse-categories" @click=${() => this._openCategoryBrowser()} aria-label="Browse categories" title="Browse categories">Categories</button>
          <button data-testid="browse-tags" @click=${() => this._openTagBrowser()} aria-label="Browse tags" title="Browse tags">Tags</button>
          <button data-testid="columns-standard" @click=${() => this._openColumnPicker('standard')} aria-label="Choose columns" title="Choose columns">Columns</button>
          <button data-testid="export-btn" @click=${() => { void this._exportDownload(); }} aria-label="Export inventory" title="Download a JSON backup">Export</button>
          <button data-testid="import-btn" @click=${() => this._openImportDialog()} aria-label="Import inventory" title="Restore from a JSON backup">Import</button>
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
        .orphansOnly=${filters?.orphansOnly ?? false}
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
          .columns=${this._columnPrefs.standard}
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
        .categorySuggestions=${(st?.distinctValuesCache?.categories ?? []).map((c) => c.value)}
        .tagSuggestions=${(st?.distinctValuesCache?.tags ?? []).map((t) => t.value)}
        .customFieldKeys=${st?.distinctValuesCache?.custom_field_keys ?? []}
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
        .createMode=${this._locationSelectorCreateMode}
        .locations=${this.store?.state.value.locationsFlatCache ?? null}
        .areas=${st?.areasCache?.areas ?? []}
        @cancel=${() => { this._locationSelectorOpen = false; this._locationSelectorCreateMode = false; this.requestUpdate(); }}
        @select=${(e: CustomEvent) => {
          const { locationId } = e.detail as { locationId: string | null };
          // Patch dialog's location
          const dlg = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { setLocation: (id: string | null) => void } | null;
          if (dlg) dlg.setLocation(locationId);
          this._locationSelectorOpen = false;
          this._locationSelectorCreateMode = false;
          this.requestUpdate();
        }}
        @create-location=${async (e: CustomEvent) => {
          const { name, parentId, areaId } = e.detail as { name: string; parentId: string | null; areaId: string | null };
          const selector = this.shadowRoot?.querySelector('hv-location-selector') as HVLocationSelector | null;
          try {
            const created = await this.store?.createLocation(name, parentId, areaId);
            if (selector && created) {
              selector.setCreatedLocation(created.id);
            }
            const dlg = this.shadowRoot?.querySelector('hv-item-dialog') as HTMLElement & { setLocation: (id: string | null) => void } | null;
            if (dlg && created) {
              dlg.setLocation(created.id);
            }
            this._locationSelectorOpen = false;
            this._locationSelectorCreateMode = false;
            this.requestUpdate();
          } catch (err: unknown) {
            const msg = (err as { message?: string })?.message ?? 'Failed to create location';
            if (selector) selector.setCreateError(msg);
          }
        }}
        @update-location=${async (e: CustomEvent) => {
          const { locationId, name, areaId, newParentId } = e.detail as {
            locationId: string; name: string; areaId: string | null; newParentId?: string | null;
          };
          const selector = this.shadowRoot?.querySelector('hv-location-selector') as HVLocationSelector | null;
          try {
            await this.store?.updateLocation(locationId, { name, areaId });
            // A changed parent moves the whole subtree; descendant paths update live.
            if (newParentId !== undefined) {
              await this.store?.moveLocationSubtree(locationId, newParentId);
            }
            if (selector) {
              selector.setEditSuccess();
            }
            this.requestUpdate();
          } catch (err: unknown) {
            const msg = (err as { message?: string })?.message ?? 'Failed to update location';
            if (selector) selector.setEditError(msg);
          }
        }}
        @delete-location=${async (e: CustomEvent) => {
          const { locationId, name } = e.detail as { locationId: string; name: string };
          const selector = this.shadowRoot?.querySelector('hv-location-selector') as HVLocationSelector | null;
          const confirmed = window.confirm(`Delete location '${name}'?`);
          if (!confirmed) return;
          try {
            await this.store?.deleteLocation(locationId);
            this.requestUpdate();
          } catch (err: unknown) {
            const anyErr = err as { code?: string; message?: string };
            const msg = anyErr?.code === 'validation_error'
              ? `'${name}' can't be deleted yet: it still contains items or sub-locations. ` +
                'Move or delete its contents first, then try again.'
              : (anyErr?.message ?? 'Failed to delete location');
            if (selector) selector.setActionError(msg);
          }
        }}
      ></hv-location-selector>

      <hv-category-browser
        .open=${this._categoryBrowserOpen}
        .categories=${st?.distinctValuesCache?.categories ?? []}
        .selectedCategory=${this._browseCategory}
        .items=${this._browseItems}
        .loading=${this._browseLoading}
        @select-category=${(e: CustomEvent) => { void this._openCategory(e.detail.category as string); }}
        @clear-category=${() => { this._browseCategory = null; this._browseItems = []; this._browseLoading = false; this.requestUpdate(); }}
        @open-item=${(e: CustomEvent) => this._openBrowseItem(e.detail.itemId as string)}
        @cancel=${() => { this._categoryBrowserOpen = false; this._browseCategory = null; this._browseItems = []; this.requestUpdate(); }}
      ></hv-category-browser>

      <hv-tag-browser
        .open=${this._tagBrowserOpen}
        .tags=${st?.distinctValuesCache?.tags ?? []}
        .selectedTag=${this._browseTag}
        .items=${this._browseTagItems}
        .loading=${this._browseTagLoading}
        @select-tag=${(e: CustomEvent) => { void this._openTag(e.detail.tag as string); }}
        @clear-tag=${() => { this._browseTag = null; this._browseTagItems = []; this._browseTagLoading = false; this.requestUpdate(); }}
        @open-item=${(e: CustomEvent) => this._openBrowseItem(e.detail.itemId as string)}
        @cancel=${() => { this._tagBrowserOpen = false; this._browseTag = null; this._browseTagItems = []; this.requestUpdate(); }}
      ></hv-tag-browser>

      <hv-column-picker
        .open=${this._columnPickerOpen}
        .columns=${this._columnPrefs[this._columnPickerScope]}
        .heading=${this._columnPickerScope === 'standard' ? 'Standard view columns' : 'Expanded view columns'}
        @change=${(e: CustomEvent) => this._setColumns(this._columnPickerScope, e.detail.columns as ColumnKey[])}
        @cancel=${() => { this._columnPickerOpen = false; this.requestUpdate(); }}
      ></hv-column-picker>

      <hv-import-dialog
        .open=${this._importDialogOpen}
        .preview=${this._importPreview}
        .summary=${this._importSummary}
        .busy=${this._importBusy}
        .errorMessage=${this._importError}
        @preview=${(e: CustomEvent) => this._onImportPreview(e)}
        @execute=${(e: CustomEvent) => this._onImportExecute(e)}
        @cancel=${() => { this._importDialogOpen = false; this._resetImportState(); this.requestUpdate(); }}
      ></hv-import-dialog>

      ${this.expanded ? this._renderOverlayTemplate() : null}
    `;
  }

  private async _exportDownload(scope: 'all' | 'view' = 'all') {
    try {
      const doc = await this.store?.exportDocument(scope);
      if (!doc) return;
      const json = JSON.stringify(doc, null, 2);
      const stamp = (doc.exported_at ?? '').replace(/[:]/g, '-') || 'backup';
      this._triggerDownload(`haventory-export-${stamp}.json`, json);
    } catch (err: unknown) {
      // Surfacing this via the import dialog is overkill for export; log for diagnostics.
      console.error('HAventory export failed', err);
    }
  }

  /** Trigger a browser download of the given text as a JSON file. Isolated for testing. */
  protected _triggerDownload(filename: string, text: string) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private _openImportDialog() {
    this._resetImportState();
    this._importDialogOpen = true;
    this.requestUpdate();
  }

  private _resetImportState() {
    this._importPreview = null;
    this._importSummary = null;
    this._importBusy = false;
    this._importError = null;
  }

  private async _onImportPreview(e: CustomEvent) {
    const { document, policy } = e.detail as { document: unknown; policy: ImportPolicy };
    this._importBusy = true;
    this._importError = null;
    this._importSummary = null;
    this.requestUpdate();
    try {
      this._importPreview = (await this.store?.previewImport(document, policy)) ?? null;
    } catch (err: unknown) {
      this._importPreview = null;
      this._importError = (err as { message?: string })?.message ?? 'Preview failed';
    } finally {
      this._importBusy = false;
      this.requestUpdate();
    }
  }

  private async _onImportExecute(e: CustomEvent) {
    const { document, policy } = e.detail as { document: unknown; policy: ImportPolicy };
    this._importBusy = true;
    this._importError = null;
    this.requestUpdate();
    try {
      this._importSummary = (await this.store?.executeImport(document, policy)) ?? null;
    } catch (err: unknown) {
      const anyErr = err as { code?: string; message?: string; data?: { errors?: { path: string; message: string }[] } };
      if (anyErr?.code === 'validation_error' && anyErr.data?.errors?.length) {
        this._importError = `Import rejected: ${anyErr.data.errors.length} problem(s) in the document.`;
      } else {
        this._importError = anyErr?.message ?? 'Import failed';
      }
    } finally {
      this._importBusy = false;
      this.requestUpdate();
    }
  }

  private _openColumnPicker(scope: 'standard' | 'expanded') {
    this._columnPickerScope = scope;
    this._columnPickerOpen = true;
    this.requestUpdate();
  }

  private _setColumns(scope: 'standard' | 'expanded', columns: ColumnKey[]) {
    this._columnPrefs = { ...this._columnPrefs, [scope]: columns };
    saveColumnPrefs(this._columnPrefs);
    this.requestUpdate();
  }

  private _openCategoryBrowser() {
    this._categoryBrowserOpen = true;
    this._browseCategory = null;
    this._browseItems = [];
    this._browseLoading = false;
    this.requestUpdate();
  }

  private async _openCategory(category: string) {
    this._browseCategory = category;
    this._browseItems = [];
    this._browseLoading = true;
    this.requestUpdate();
    try {
      this._browseItems = (await this.store?.fetchItemsByCategory(category)) ?? [];
    } catch {
      this._browseItems = [];
    } finally {
      this._browseLoading = false;
      this.requestUpdate();
    }
  }

  private _openTagBrowser() {
    this._tagBrowserOpen = true;
    this._browseTag = null;
    this._browseTagItems = [];
    this._browseTagLoading = false;
    this.requestUpdate();
  }

  private async _openTag(tag: string) {
    this._browseTag = tag;
    this._browseTagItems = [];
    this._browseTagLoading = true;
    this.requestUpdate();
    try {
      this._browseTagItems = (await this.store?.fetchItemsByTag(tag)) ?? [];
    } catch {
      this._browseTagItems = [];
    } finally {
      this._browseTagLoading = false;
      this.requestUpdate();
    }
  }

  private _openBrowseItem(itemId: string) {
    const item = [...this._browseItems, ...this._browseTagItems].find((i) => i.id === itemId);
    if (!item) return;
    const dialog = this.shadowRoot?.querySelector('hv-item-dialog') as
      (HTMLElement & { open: boolean; item: unknown }) | null;
    if (dialog) {
      dialog.item = item;
      dialog.open = true;
    }
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
        .health-status.ok { color: var(--success-color, #0f9d58); }
        .health-status.bad { color: var(--error-color, #db4437); font-weight: 600; }
        .health-issues { margin: 4px 0; padding-left: 18px; color: var(--error-color, #db4437); }
        [data-testid="health-refresh"] { margin-top: 4px; padding: 4px 8px; }
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
            <button
              class="btn-add"
              aria-label="Add location"
              @click=${() => {
                this._locationSelectorOpen = true;
                this._locationSelectorCreateMode = true;
                this.requestUpdate();
              }}
            >Add location</button>
            <button class="btn-add" data-testid="columns-expanded" @click=${() => this._openColumnPicker('expanded')} aria-label="Choose columns">Columns</button>
            <button data-testid="expand-toggle" @click=${this._onOverlayCollapseClick} aria-label="Collapse">⤢ Collapse</button>
          </div>
        </div>
        <div class="ov-body">
          <div class="sidebar" data-testid="filters-panel" aria-label="Filters">
            <div class="row">
              <label>Area
                <select @change=${(e: Event) => this.store?.setFilters({ areaId: (e.target as HTMLSelectElement).value || null } as Partial<import('./store/types').StoreFilters>)} .value=${filters?.areaId ?? ''}>
                  <option value="">All</option>
                  ${(st?.areasCache?.areas ?? []).map((a) => html`<option value=${a.id} ?selected=${filters?.areaId === a.id}>${a.name}</option>`)}
                </select>
              </label>
            </div>
            <div class="row">
              <label>Location
                <select @change=${(e: Event) => this.store?.setFilters({ locationId: (e.target as HTMLSelectElement).value || null } as Partial<import('./store/types').StoreFilters>)} .value=${filters?.locationId ?? ''}>
                  <option value="">All</option>
                  ${(st?.locationsFlatCache ?? []).map((l) => html`<option value=${l.id} ?selected=${filters?.locationId === l.id}>${l.path?.display_path || l.name}</option>`)}
                </select>
              </label>
            </div>
            <div class="row">
              <label><input type="checkbox" .checked=${filters?.checkedOutOnly ?? false} @change=${(e: Event) => this.store?.setFilters({ checkedOutOnly: (e.target as HTMLInputElement).checked })} /> Checked-out only</label>
            </div>
            <div class="row">
              <label><input type="checkbox" .checked=${filters?.lowStockFirst ?? false} @change=${(e: Event) => this.store?.setFilters({ lowStockFirst: (e.target as HTMLInputElement).checked })} /> Low-stock first</label>
            </div>
            <div class="row">
              <label title="Only items without a location"><input type="checkbox" .checked=${filters?.orphansOnly ?? false} @change=${(e: Event) => this.store?.setFilters({ orphansOnly: (e.target as HTMLInputElement).checked })} /> No location</label>
            </div>
            <div class="row">
              <label>Sort
                <span class="sort-controls">
                  <select @change=${this._onOverlaySortFieldChange}>
                    <option value="name" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'name'}>Name</option>
                    <option value="updated_at" ?selected=${(filters?.sort?.field ?? 'updated_at') === 'updated_at'}>Updated</option>
                    <option value="created_at" ?selected=${filters?.sort?.field === 'created_at'}>Created</option>
                    <option value="quantity" ?selected=${filters?.sort?.field === 'quantity'}>Quantity</option>
                    <option value="due_date" ?selected=${filters?.sort?.field === 'due_date'}>Due date</option>
                    <option value="inspection_date" ?selected=${filters?.sort?.field === 'inspection_date'}>Inspection</option>
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
              <div data-testid="storage-health">
                ${st?.healthCache ? html`
                  <div class="health-status ${st.healthCache.healthy ? 'ok' : 'bad'}">
                    Storage: ${st.healthCache.healthy
                      ? html`✓ Healthy`
                      : html`⚠ ${st.healthCache.issues.length} issue${st.healthCache.issues.length === 1 ? '' : 's'}`}
                    (generation ${st.healthCache.generation})
                  </div>
                  ${!st.healthCache.healthy ? html`
                    <ul class="health-issues">
                      ${st.healthCache.issues.map((issue) => html`<li>${issue}</li>`)}
                    </ul>
                  ` : null}
                ` : html`<div>Storage: —</div>`}
                <button
                  type="button"
                  data-testid="health-refresh"
                  @click=${() => { void this.store?.refreshHealth(); }}
                >Refresh health</button>
              </div>
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
                .orphansOnly=${filters?.orphansOnly ?? false}
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
                  .columns=${this._columnPrefs.expanded}
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

// Lovelace card picker metadata
export function getStubConfig() {
  return {
    type: 'custom:haventory-card',
    title: 'HAventory',
  };
}

// Auto-register with Lovelace card picker when loaded via /local
interface CustomCardMeta {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
}

declare global {
  interface Window {
    customCards?: CustomCardMeta[];
  }
}

if (typeof window !== 'undefined') {
  window.customCards = window.customCards || [];
  const already = window.customCards.some((c) => c?.type === 'haventory-card');
  if (!already) {
    window.customCards.push({
      type: 'haventory-card',
      name: 'HAventory',
      description: 'HAventory inventory card',
      preview: true,
    });
  }
}

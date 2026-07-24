import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { nextZBase } from '../utils/zindex';
import { debounce } from '../utils/debounce';
import { activeFilterCount, defaultFilters } from '../store/store';
import type { Store } from '../store/store';
import type { ColumnKey } from '../store/columns';
import type { Item, LocationTreeNode, Sort, StoreFilters, StoreState } from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import './hv-data-table';
import './hv-filter-chips';
import './hv-filter-panel';
import './hv-item-editor';
import './hv-location-tree';
import './hv-overflow-menu';
import type { HVLocationTree } from './hv-location-tree';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * The expanded workspace (mock 1c).
 *
 * The coloured app bar is the mode signal — the standard card never has one, so
 * there is no doubt which surface you are looking at. The sidebar renders the
 * real location tree with the backend's own counts, replacing the flat location
 * dropdown the POC card offered.
 */
@customElement('hv-full-view')
export class HVFullView extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: contents;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
      }
      .shell {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-rows: auto 1fr;
        background: var(--hv-surface);
        color: var(--hv-text);
        overflow: hidden;
        overscroll-behavior: contain;
        box-shadow: var(--hv-shadow-overlay);
      }
      .appbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: var(--hv-primary);
        color: #fff;
      }
      .appbar h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        white-space: nowrap;
      }
      .appbar .tap {
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 50%;
        background: none;
        color: #fff;
        display: inline-grid;
        place-items: center;
        padding: 0;
        flex: none;
      }
      .appbar .tap:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .appbar .search {
        flex: 1;
        max-width: 420px;
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.22);
        border-radius: var(--hv-radius-chip);
        padding: 7px 14px;
      }
      .appbar .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        color: #fff;
        font: 400 13.5px var(--hv-font);
      }
      .appbar .search input::placeholder {
        color: rgba(255, 255, 255, 0.8);
      }
      .appbar .pill {
        flex: none;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: rgba(255, 255, 255, 0.22);
        color: #fff;
        padding: 4px 11px;
        font: 500 11.5px var(--hv-font);
      }
      .appbar .pill.on {
        outline: 2px solid #fff;
      }
      .appbar .add {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: #fff;
        color: var(--hv-primary-darker);
        padding: 7px 15px;
        font: 500 13px var(--hv-font);
      }
      .spacer {
        margin-left: auto;
      }
      .body {
        display: grid;
        grid-template-columns: 264px 1fr;
        min-height: 0;
      }
      .sidebar {
        background: var(--hv-page);
        border-right: 1px solid var(--hv-divider);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 16px;
      }
      .sidebar-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 16px 6px;
      }
      .main {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }
      .context {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 20px;
        flex-wrap: wrap;
      }
      .crumb {
        font-size: 13px;
        color: var(--hv-text-secondary);
        min-width: 0;
      }
      .crumb .current {
        font-weight: 500;
        color: var(--hv-text);
      }
      .filters-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-text-secondary);
        border-radius: var(--hv-radius-chip);
        padding: 6px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .filters-button.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .panel-holder {
        padding: 0 20px 12px;
      }
      .footer {
        padding: 10px 20px;
        border-top: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .inline-error {
        margin: 0 16px 8px;
        padding: 8px 10px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12px;
      }
      .sentinel {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .editor-holder {
        border-bottom: 1px solid var(--hv-divider);
        max-height: 60vh;
        overflow-y: auto;
      }
      .new-location {
        display: flex;
        gap: 6px;
        padding: 6px 16px 10px;
      }
      .new-location input {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 7px 10px;
        font: 400 13px var(--hv-font);
        color: var(--hv-text);
      }
    `,
  ];

  @property({ attribute: false }) store!: Store;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) heading = 'Inventory';
  @property({ attribute: false }) columns: ColumnKey[] = [];
  /** Extra entries the host adds to the app bar's ⋮ menu. */
  @property({ attribute: false }) menuEntries: OverflowMenuEntry[] = [];

  @state() private _zBase = 0;
  @state() private _filtersOpen = false;
  @state() private _searchDraft = '';
  @state() private _editing: string | 'new' | null = null;
  @state() private _editorBusy = false;
  @state() private _creatingLocation = false;
  @state() private _locationError: string | null = null;

  private storeUnsub?: () => void;
  private _prevFocus: HTMLElement | null = null;

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.store && !this.storeUnsub) {
      this.storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.storeUnsub?.();
    this.storeUnsub = undefined;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('store') && this.store) {
      this.storeUnsub?.();
      this.storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
    if (changed.has('open')) {
      if (this.open) {
        this._zBase = nextZBase();
        this._searchDraft = this.st?.filters.q ?? '';
        this._prevFocus = (document.activeElement as HTMLElement) ?? null;
      } else {
        this._filtersOpen = false;
        this._editing = null;
        this._creatingLocation = false;
        this._locationError = null;
      }
    }
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) {
        this._focusFirst();
        // Reveal the selected branch so the sidebar isn't showing roots only.
        this._tree?.revealPathTo(this.st?.filters.locationId ?? null);
      } else if (this._prevFocus?.isConnected) {
        this._prevFocus.focus();
      }
    }
  }

  private get _tree(): HVLocationTree | null {
    return this.shadowRoot?.querySelector('hv-location-tree') ?? null;
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  };

  // ---------- Focus trap ----------
  private _focusables(): HTMLElement[] {
    const root = this.shadowRoot?.querySelector('.shell');
    if (!root) return [];
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return [...root.querySelectorAll<HTMLElement>(sel)].filter(
      (el) => !el.hasAttribute('disabled') && !el.classList.contains('sentinel'),
    );
  }

  private _focusFirst() {
    this._focusables()[0]?.focus();
  }

  private _focusLast() {
    const list = this._focusables();
    list[list.length - 1]?.focus();
  }

  private emitSearch = debounce((q: string) => this.store?.setFilters({ q }), SEARCH_DEBOUNCE_MS);

  private _setFilters(patch: Partial<StoreFilters>) {
    this.store?.setFilters(patch);
  }

  private _onRowEvent(name: string, detail: { itemId?: string }) {
    const item = this.st?.items.find((i) => i.id === detail.itemId);
    if (!item) return;
    switch (name) {
      case 'increment':
        void this.store?.adjustQuantity(item.id, +1);
        break;
      case 'decrement':
        if (item.quantity > 0) void this.store?.adjustQuantity(item.id, -1);
        break;
      case 'edit':
      case 'open-item':
        this._editing = item.id;
        break;
    }
  }

  private _onEditorSave = async (e: CustomEvent) => {
    const detail = e.detail as {
      itemId: string | null;
      expectedVersion?: number;
      changes?: Parameters<Store['updateItem']>[1];
      create?: Parameters<Store['createItem']>[0];
    };
    this._editorBusy = true;
    const before = this.st?.errorQueue.length ?? 0;
    try {
      if (detail.itemId && detail.changes) {
        await this.store?.updateItem(detail.itemId, detail.changes, detail.expectedVersion);
      } else if (detail.create) {
        await this.store?.createItem(detail.create);
      }
    } finally {
      this._editorBusy = false;
    }
    if ((this.st?.errorQueue.length ?? 0) === before) this._editing = null;
  };

  private async _createLocation(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._locationError = null;
    try {
      // New locations land under whatever the sidebar currently has selected,
      // which is what "add here" means in a tree.
      await this.store?.createLocation(trimmed, this.st?.filters.locationId ?? null, null);
      this._creatingLocation = false;
    } catch (err) {
      this._locationError = (err as { message?: string })?.message ?? 'Could not create that location.';
    }
  }

  // ---------- Sections ----------
  private _renderSidebar() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    return html`
      <div class="sidebar" data-testid="full-sidebar">
        <div class="sidebar-head">
          <span class="hv-label">Locations</span>
          <button
            class="hv-icon-button"
            style="margin-left:auto"
            data-testid="sidebar-new-location"
            aria-label="New location"
            title="New location"
            @click=${() => {
              this._creatingLocation = !this._creatingLocation;
              this._locationError = null;
            }}
          >
            ${icon('plus', 20)}
          </button>
        </div>
        ${this._creatingLocation
          ? html`<div class="new-location">
              <input
                data-testid="sidebar-new-location-name"
                placeholder="New location name"
                aria-label="New location name"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') void this._createLocation((e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') this._creatingLocation = false;
                }}
              />
              <button
                class="hv-pill"
                data-testid="sidebar-new-location-save"
                @click=${() => {
                  const input = this.shadowRoot?.querySelector<HTMLInputElement>(
                    '[data-testid="sidebar-new-location-name"]',
                  );
                  void this._createLocation(input?.value ?? '');
                }}
              >
                Add
              </button>
            </div>`
          : null}
        ${this._locationError
          ? html`<div class="inline-error" role="alert" data-testid="sidebar-location-error">
              ${this._locationError}
            </div>`
          : null}
        <hv-location-tree
          data-testid="sidebar-tree"
          .nodes=${(st?.locationTreeCache ?? []) as LocationTreeNode[]}
          .selectedId=${filters.locationId}
          .orphansSelected=${filters.orphansOnly}
          .areas=${st?.areasCache?.areas ?? []}
          showAll
          showOrphans
          showCounts
          .totalCount=${st?.statsCounts?.items_total ?? null}
          .orphanCount=${st?.statsCounts?.no_location_count ?? null}
          @select=${(e: CustomEvent) =>
            this._setFilters({
              locationId: (e.detail as { locationId: string | null }).locationId,
              orphansOnly: false,
            })}
          @select-orphans=${() => this._setFilters({ locationId: null, orphansOnly: true })}
        ></hv-location-tree>
      </div>
    `;
  }

  private _renderContextBar() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const loc = (st?.locationsFlatCache ?? []).find((l) => l.id === filters.locationId);
    const segments = loc ? (loc.path?.display_path ?? loc.name).split('/').map((s) => s.trim()) : [];
    const filterCount = activeFilterCount(filters);

    return html`
      <div class="context">
        <span class="crumb" data-testid="full-breadcrumb">
          ${filters.orphansOnly
            ? html`<span class="current">No location</span>`
            : segments.length
              ? segments.map((seg, i) =>
                  i === segments.length - 1
                    ? html`<span class="current">${seg}</span>`
                    : html`<span>${seg} › </span>`,
                )
              : html`<span class="current">All items</span>`}
          ${st?.total !== null && st?.total !== undefined ? html` · ${st.total} items` : null}
        </span>
        <span class="spacer"></span>
        ${filterCount > 0
          ? html`<hv-filter-chips
              .filters=${filters}
              .locations=${st?.locationsFlatCache ?? null}
              .areas=${st?.areasCache?.areas ?? []}
              @remove-filter=${(e: CustomEvent) =>
                this._setFilters((e.detail as { patch: Partial<StoreFilters> }).patch)}
              @clear-filters=${() => this.store?.clearFilters()}
            ></hv-filter-chips>`
          : null}
        <button
          class="filters-button ${this._filtersOpen ? 'on' : ''}"
          data-testid="full-filters-toggle"
          aria-expanded=${String(this._filtersOpen)}
          @click=${() => {
            this._filtersOpen = !this._filtersOpen;
          }}
        >
          ${icon('tune', 16)}Filters
        </button>
        <button
          class="hv-icon-button"
          data-testid="columns-expanded"
          aria-label="Choose columns"
          title="Choose columns"
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent('menu-action', { detail: { id: 'columns' }, bubbles: true, composed: true }),
            )}
        >
          ${icon('viewColumn', 20)}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const counts = st?.statsCounts;
    const z = this._zBase || 9998;
    const loaded = st?.items.length ?? 0;

    return html`
      <div class="backdrop" role="presentation" style="z-index: ${z};" @click=${this._close}></div>
      <div
        class="shell"
        role="dialog"
        aria-modal="true"
        aria-label=${this.heading}
        data-testid="full-view"
        style="z-index: ${z + 1};"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            this._close();
          }
        }}
      >
        <span class="sentinel" tabindex="0" @focus=${() => this._focusLast()}></span>
        <div class="appbar">
          <button class="tap" data-testid="expand-toggle" aria-label="Close full view" @click=${this._close}>
            ${icon('close', 20)}
          </button>
          <h2>${this.heading}</h2>
          <label class="search">
            ${icon('magnify', 18)}
            <span class="hv-sr-only">Search items</span>
            <input
              type="search"
              data-testid="full-search"
              placeholder=${counts ? `Search all ${counts.items_total} items…` : 'Search items…'}
              .value=${this._searchDraft}
              @input=${(e: Event) => {
                this._searchDraft = (e.target as HTMLInputElement).value;
                this.emitSearch(this._searchDraft);
              }}
            />
          </label>
          <span class="spacer"></span>
          ${counts && counts.low_stock_count > 0
            ? html`<button
                class="pill ${filters.lowStockOnly ? 'on' : ''}"
                data-testid="full-badge-low"
                @click=${() => this._setFilters({ lowStockOnly: !filters.lowStockOnly })}
              >
                ${counts.low_stock_count} low
              </button>`
            : null}
          ${counts && counts.checked_out_count > 0
            ? html`<button
                class="pill ${filters.checkedOutOnly ? 'on' : ''}"
                data-testid="full-badge-out"
                @click=${() => this._setFilters({ checkedOutOnly: !filters.checkedOutOnly })}
              >
                ${counts.checked_out_count} out
              </button>`
            : null}
          <button
            class="add"
            data-testid="full-add-item"
            @click=${() => {
              this._editing = 'new';
            }}
          >
            ${icon('plus', 16)}Add item
          </button>
          <hv-overflow-menu
            onPrimary
            data-testid="full-overflow"
            .entries=${this.menuEntries}
            @select=${(e: CustomEvent) =>
              this.dispatchEvent(
                new CustomEvent('menu-action', { detail: e.detail, bubbles: true, composed: true }),
              )}
          ></hv-overflow-menu>
        </div>

        <div class="body">
          ${this._renderSidebar()}
          <div class="main">
            ${this._renderContextBar()}
            ${this._filtersOpen
              ? html`<div class="panel-holder">
                  <hv-filter-panel
                    .filters=${filters}
                    .distinct=${st?.distinctValuesCache ?? null}
                    .areas=${st?.areasCache?.areas ?? []}
                    .locations=${st?.locationsFlatCache ?? null}
                    .locationTree=${st?.locationTreeCache ?? []}
                    .total=${st?.total ?? null}
                    .grandTotal=${counts?.items_total ?? null}
                    @change=${(e: CustomEvent) => this._setFilters(e.detail as Partial<StoreFilters>)}
                    @clear-filters=${() => this.store?.clearFilters()}
                  ></hv-filter-panel>
                </div>`
              : null}
            ${this._editing !== null
              ? html`<div class="editor-holder">
                  <hv-item-editor
                    data-testid="full-editor"
                    .item=${this._editing === 'new'
                      ? null
                      : (st?.items.find((i) => i.id === this._editing) ?? null)}
                    .locations=${st?.locationsFlatCache ?? null}
                    .locationTree=${st?.locationTreeCache ?? []}
                    .categorySuggestions=${(st?.distinctValuesCache?.categories ?? []).map((c) => c.value)}
                    .tagSuggestions=${(st?.distinctValuesCache?.tags ?? []).map((t) => t.value)}
                    .customFieldKeys=${st?.distinctValuesCache?.custom_field_keys ?? []}
                    .busy=${this._editorBusy}
                    @save=${this._onEditorSave}
                    @cancel=${() => {
                      this._editing = null;
                    }}
                    @delete-item=${(e: CustomEvent) =>
                      this.dispatchEvent(
                        new CustomEvent('request-delete', { detail: e.detail, bubbles: true, composed: true }),
                      )}
                  ></hv-item-editor>
                </div>`
              : null}

            <hv-data-table
              data-testid="full-table"
              .items=${(st?.items ?? []) as Item[]}
              .columns=${this.columns}
              .sort=${filters.sort as Sort}
              @sort-change=${(e: CustomEvent) => this._setFilters({ sort: (e.detail as { sort: Sort }).sort })}
              @near-end=${(e: CustomEvent) =>
                void this.store?.prefetchIfNeeded((e.detail as { ratio: number }).ratio)}
              @increment=${(e: CustomEvent) => this._onRowEvent('increment', e.detail)}
              @decrement=${(e: CustomEvent) => this._onRowEvent('decrement', e.detail)}
              @edit=${(e: CustomEvent) => this._onRowEvent('edit', e.detail)}
              @open-item=${(e: CustomEvent) => this._onRowEvent('open-item', e.detail)}
            >
              <span slot="empty"
                >${activeFilterCount(filters) > 0
                  ? 'No items match these filters.'
                  : 'Nothing here yet.'}</span
              >
            </hv-data-table>

            <div class="footer" data-testid="full-footer">
              ${st?.total !== null && st?.total !== undefined
                ? `Showing ${loaded} of ${st.total}${st.cursor ? ' · scroll to load more' : ''}`
                : `Showing ${loaded}`}
            </div>
          </div>
        </div>
        <span class="sentinel" tabindex="0" @focus=${() => this._focusFirst()}></span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-full-view': HVFullView;
  }
}

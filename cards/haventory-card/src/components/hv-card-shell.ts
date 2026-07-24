import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { ResponsiveController } from '../ui/responsive';
import { debounce } from '../utils/debounce';
import { activeFilterCount, defaultFilters } from '../store/store';
import type { Store } from '../store/store';
import type { Item, StoreFilters, StoreState } from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import './hv-banner';
import './hv-bottom-sheet';
import './hv-confirm';
import './hv-filter-chips';
import './hv-filter-panel';
import './hv-list';
import './hv-item-editor';
import './hv-detail-sheet';
import './hv-overflow-menu';
import type { HVFilterPanel } from './hv-filter-panel';
import type { HVItemEditor } from './hv-item-editor';
import type { ListEmptyKind } from './hv-list';
import type { ItemCreate, ItemUpdate } from '../store/types';

const SEARCH_DEBOUNCE_MS = 200;
const FILTER_PANEL_STORAGE_KEY = 'haventory:filter-panel-open:v1';

/**
 * The revamped standard card (mocks 1a / 1b / 1d).
 *
 * Unlike the POC's dumb-components-plus-container split, this is a container:
 * it holds the `Store` and drives it directly. The design nests interactions
 * several levels deep (row → editor → location tree), and threading every one
 * of those through re-dispatched events was the main source of the POC's
 * plumbing. Presentation stays in the leaf components.
 */
@customElement('hv-card-shell')
export class HVCardShell extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        background: var(--hv-surface);
        color: var(--hv-text);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-card);
        overflow: hidden;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 10px;
      }
      .title {
        font-size: 20px;
        font-weight: 400;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      :host([mobile]) .title {
        font-size: 19px;
      }
      .badges {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }
      .badge {
        border: 1px solid var(--hv-divider);
        background: none;
        border-radius: var(--hv-radius-chip);
        padding: 3px 9px;
        font: 500 11px var(--hv-font);
        color: var(--hv-text-secondary);
        white-space: nowrap;
      }
      .badge.low {
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-color: transparent;
      }
      .badge.out {
        color: var(--hv-primary-darker);
        background: var(--hv-primary-tint);
        border-color: transparent;
      }
      .badge.on {
        outline: 2px solid var(--hv-primary);
        outline-offset: 1px;
      }
      .add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 7px 14px 7px 10px;
        font: 500 13px var(--hv-font);
      }
      .add:hover {
        opacity: 0.9;
      }
      .add.round {
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 50%;
        justify-content: center;
      }
      .search-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 16px 10px;
      }
      .search {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--hv-input-bg);
        border-radius: var(--hv-radius-chip);
        padding: 8px 14px;
        color: var(--hv-text-secondary);
      }
      .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .icon-toggle {
        position: relative;
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      :host([mobile]) .icon-toggle {
        width: 40px;
        height: 40px;
      }
      .icon-toggle:hover {
        background: var(--hv-hover-overlay);
      }
      .icon-toggle.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .icon-toggle .dot {
        position: absolute;
        top: 0;
        right: 0;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--hv-primary);
        border: 1.5px solid var(--hv-surface);
      }
      .chips-row {
        padding: 0 16px 10px;
      }
      .panel-holder {
        margin: 0 16px 12px;
      }
      .banners {
        display: grid;
        gap: 6px;
        padding: 0 16px 10px;
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 9px 16px;
        border-top: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .sheet-footer {
        display: flex;
        gap: 10px;
        padding: 12px 16px 18px;
      }
      .sheet-footer .cancel {
        flex: none;
        min-height: 46px;
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        padding: 0 20px;
        font: 500 14px var(--hv-font);
      }
      .sheet-footer .apply {
        flex: 1;
        min-height: 46px;
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .sheet-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 16px 10px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .sheet-head .heading {
        font-size: 16px;
        font-weight: 500;
        color: var(--hv-text);
      }
      .link {
        border: none;
        background: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font: 500 12.5px var(--hv-font);
        color: var(--hv-primary-dark);
        padding: 0;
      }
    `,
  ];

  /** Required. The shell subscribes to it itself — see `connectedCallback`. */
  @property({ attribute: false }) store!: Store;
  @property({ type: String }) heading = 'Inventory';
  /** Force a layout instead of measuring; `null` measures. */
  @property({ attribute: false }) forceMobile: boolean | null = null;

  @state() private _filterPanelOpen = false;
  @state() private _filterSheetOpen = false;
  @state() private _stagedCount: number | null = null;
  @state() private _confirm: {
    heading: string;
    message: string;
    confirmLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
  } | null = null;
  @state() private _searchDraft = '';
  /** Row expanded into the inline editor, or `'new'` for the add-item expander. */
  @state() private _editing: string | 'new' | null = null;
  @state() private _editorBusy = false;
  @state() private _editorError: string | null = null;
  /** Item shown in the mobile detail sheet. */
  @state() private _detailItemId: string | null = null;

  private readonly responsive = new ResponsiveController(this);
  private storeUnsub?: () => void;

  get mobile(): boolean {
    return this.responsive.mobile;
  }

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._filterPanelOpen = readPanelPref();
    if (this.store && !this.storeUnsub) {
      // The parent passes a stable `store` object, so a property binding would
      // never re-render this element — it has to watch the store itself.
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
      this._searchDraft = this.store.state.value.filters.q;
    }
    if (changed.has('forceMobile')) this.responsive.setForced(this.forceMobile);
    // Reflect the mode so child selectors and :host([mobile]) rules apply.
    this.toggleAttribute('mobile', this.mobile);
  }

  protected updated() {
    this.toggleAttribute('mobile', this.mobile);
  }

  // ---------- Filters ----------
  private emitSearch = debounce((q: string) => this.store?.setFilters({ q }), SEARCH_DEBOUNCE_MS);

  private _setFilters(patch: Partial<StoreFilters>) {
    this.store?.setFilters(patch);
  }

  private _toggleFilterSurface = () => {
    if (this.mobile) {
      this._filterSheetOpen = !this._filterSheetOpen;
      if (this._filterSheetOpen) void this._priceStaged(this.st?.filters ?? defaultFilters());
      return;
    }
    this._filterPanelOpen = !this._filterPanelOpen;
    writePanelPref(this._filterPanelOpen);
  };

  /** Price a staged (not yet applied) filter so the sheet's button can be honest. */
  private _priceStaged = debounce((filters: StoreFilters) => {
    void this.store?.countMatching(filters).then((count) => {
      this._stagedCount = count;
    });
  }, 150);

  // ---------- Item actions ----------
  private _adjust(itemId: string, delta: number) {
    void this.store?.adjustQuantity(itemId, delta);
  }

  private _requestDelete(item: Item) {
    this._confirm = {
      heading: `Delete "${item.name}"?`,
      message: 'This cannot be undone. The item is removed for every connected client.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        if (this._editing === item.id) this._editing = null;
        if (this._detailItemId === item.id) this._detailItemId = null;
        void this.store?.deleteItem(item.id, item.version);
      },
    };
  }

  private _itemById(itemId: string): Item | undefined {
    return this.st?.items.find((i) => i.id === itemId);
  }

  // ---------- Inline editing ----------
  private get _editor(): HVItemEditor | null {
    // The expander is rendered by hv-list (inside the row order), so it lives in
    // that component's shadow root rather than this one's.
    const list = this.shadowRoot?.querySelector('hv-list');
    return list?.shadowRoot?.querySelector('hv-item-editor') ?? null;
  }

  /**
   * Open an expander, closing whichever one is open. Only one row edits at a
   * time; if the open one has unsaved changes the user is asked first, rather
   * than silently losing them.
   */
  private _startEdit(next: string | 'new' | null) {
    if (this._editing === next) return;
    if (this._editing !== null && this._editor?.dirty) {
      this._confirm = {
        heading: 'Discard your changes?',
        message: 'The item you are editing has unsaved changes.',
        confirmLabel: 'Discard',
        destructive: true,
        onConfirm: () => {
          this._editorError = null;
          this._editing = next;
        },
      };
      return;
    }
    this._editorError = null;
    this._editing = next;
  }

  private _onEditorSave = async (e: CustomEvent) => {
    const detail = e.detail as {
      itemId: string | null;
      expectedVersion?: number;
      changes?: ItemUpdate;
      create?: ItemCreate;
    };
    this._editorBusy = true;
    this._editorError = null;
    const errorsBefore = this.st?.errorQueue.length ?? 0;
    try {
      if (detail.itemId && detail.changes) {
        await this.store?.updateItem(detail.itemId, detail.changes, detail.expectedVersion);
      } else if (detail.create) {
        await this.store?.createItem(detail.create);
      }
    } finally {
      this._editorBusy = false;
    }
    // The store reports failures through its error queue rather than throwing,
    // so a new entry is how we know the save did not land. Keep the expander
    // open in that case so the user's edits are still there to retry.
    const failed = (this.st?.errorQueue.length ?? 0) > errorsBefore;
    if (!failed) this._editing = null;
  };

  private _onEditorDelete = (e: CustomEvent) => {
    const { itemId } = e.detail as { itemId: string };
    const item = this._itemById(itemId);
    if (!item) return;
    this._requestDelete(item);
  };

  private _renderEditor = (itemId: string | null) => {
    const st = this.st;
    return html`<hv-item-editor
      data-testid="inline-editor"
      .item=${itemId ? (this._itemById(itemId) ?? null) : null}
      .locations=${st?.locationsFlatCache ?? null}
      .locationTree=${st?.locationTreeCache ?? []}
      .categorySuggestions=${(st?.distinctValuesCache?.categories ?? []).map((c) => c.value)}
      .tagSuggestions=${(st?.distinctValuesCache?.tags ?? []).map((t) => t.value)}
      .customFieldKeys=${st?.distinctValuesCache?.custom_field_keys ?? []}
      ?mobile=${this.mobile}
      .busy=${this._editorBusy}
      .errorMessage=${this._editorError}
      @save=${this._onEditorSave}
      @delete-item=${this._onEditorDelete}
      @cancel=${() => {
        this._editing = null;
        this._editorError = null;
      }}
    ></hv-item-editor>`;
  };

  private _onRowEvent = (name: string, detail: { itemId: string }) => {
    const item = this._itemById(detail.itemId);
    if (!item) return;
    switch (name) {
      case 'increment':
        this._adjust(item.id, +1);
        break;
      case 'decrement':
        if (item.quantity > 0) this._adjust(item.id, -1);
        break;
      case 'check-in':
        void this.store?.markCheckedIn(item.id, item.version);
        break;
      case 'check-out':
        // A due date is optional over the WS API; the date step lands with the
        // check-out popover.
        void this.store?.checkOut(item.id, null, item.version);
        break;
      case 'request-delete':
        this._requestDelete(item);
        break;
      case 'edit':
      case 'open-item':
        // Touch has no hover: tapping a row opens the detail sheet, which is the
        // single mobile surface. Desktop expands the row in place instead.
        if (this.mobile) this._detailItemId = item.id;
        else this._startEdit(item.id);
        break;
      default:
        this.dispatchEvent(
          new CustomEvent(name, { detail: { itemId: item.id }, bubbles: true, composed: true }),
        );
    }
  };

  // ---------- Overflow menu ----------
  private get menuEntries(): OverflowMenuEntry[] {
    const st = this.st;
    const total = st?.statsCounts?.items_total ?? null;
    const filtered = st?.total ?? null;
    const filtersOn = activeFilterCount(st?.filters ?? defaultFilters()) > 0;
    return [
      { id: 'columns', label: 'Columns…', glyph: 'viewColumn' },
      { divider: true },
      { id: 'refresh', label: 'Refresh data', glyph: 'refresh', meta: 'Items · locations · stats' },
      { divider: true },
      { caption: 'Data' },
      {
        id: 'export-all',
        label: 'Export backup',
        glyph: 'download',
        sub: total === null ? 'Everything' : `All ${total} items · all locations`,
      },
      {
        id: 'export-view',
        label: 'Export current view',
        glyph: 'download',
        sub:
          filtered === null
            ? 'Active filter · keeps location paths'
            : `${filtered} filtered item${filtered === 1 ? '' : 's'} · keeps location paths`,
        disabled: !filtersOn,
      },
      { id: 'import', label: 'Import backup…', glyph: 'upload' },
    ];
  }

  private _onMenuSelect = (e: CustomEvent) => {
    const { id } = e.detail as { id: string };
    if (id === 'refresh') {
      void this.store?.refreshAll();
      return;
    }
    // Everything else is owned by the host card, which knows about dialogs.
    this.dispatchEvent(new CustomEvent('menu-action', { detail: { id }, bubbles: true, composed: true }));
  };

  // ---------- Render helpers ----------
  private _renderBadges() {
    const st = this.st;
    const counts = st?.statsCounts;
    if (!counts) return null;
    const f = st?.filters;
    return html`
      <div class="badges">
        ${this.mobile
          ? null
          : html`<span class="badge" data-testid="badge-total">${counts.items_total} items</span>`}
        ${counts.low_stock_count > 0
          ? html`<button
              class="badge low ${f?.lowStockOnly ? 'on' : ''}"
              data-testid="badge-low"
              aria-pressed=${String(!!f?.lowStockOnly)}
              title="Show only low-stock items"
              @click=${() => this._setFilters({ lowStockOnly: !f?.lowStockOnly })}
            >
              ${counts.low_stock_count} low
            </button>`
          : null}
        ${!this.mobile && counts.checked_out_count > 0
          ? html`<button
              class="badge out ${f?.checkedOutOnly ? 'on' : ''}"
              data-testid="badge-out"
              aria-pressed=${String(!!f?.checkedOutOnly)}
              title="Show only checked-out items"
              @click=${() => this._setFilters({ checkedOutOnly: !f?.checkedOutOnly })}
            >
              ${counts.checked_out_count} out
            </button>`
          : null}
      </div>
    `;
  }

  private _renderBanners() {
    const errors = this.st?.errorQueue ?? [];
    if (!errors.length) return null;
    return html`
      <div class="banners" data-testid="banners">
        ${errors.map((e) => {
          const conflict = e.kind === 'conflict' && e.itemId;
          return html`<hv-banner
            kind=${conflict ? 'warning' : 'error'}
            .heading=${conflict ? 'Someone else changed this item.' : null}
            .message=${e.message}
            data-testid="banner-entry"
            data-code=${e.code}
          >
            ${conflict
              ? html`<span slot="below">
                  <button
                    class="hv-pill outline"
                    data-testid="banner-view-latest"
                    @click=${() => {
                      void this.store?.refreshItem(e.itemId!);
                      this.store?.dismissError(e.id);
                    }}
                  >
                    View latest
                  </button>
                  ${e.changes
                    ? html`<button
                        class="hv-pill"
                        data-testid="banner-reapply"
                        @click=${() => {
                          void this.store?.updateItem(e.itemId!, e.changes!);
                          this.store?.dismissError(e.id);
                        }}
                      >
                        Re-apply my change
                      </button>`
                    : null}
                </span>`
              : null}
            <button
              slot="actions"
              class="hv-icon-button"
              data-testid="banner-dismiss"
              aria-label="Dismiss"
              @click=${() => this.store?.dismissError(e.id)}
            >
              ${icon('close', 16)}
            </button>
          </hv-banner>`;
        })}
      </div>
    `;
  }

  private get emptyKind(): ListEmptyKind {
    const st = this.st;
    if (st?.degraded.connectionLost) return 'connection-lost';
    const filters = st?.filters ?? defaultFilters();
    if (filters.locationId && activeFilterCount(filters) === 1) return 'empty-location';
    if (activeFilterCount(filters) > 0) return 'no-matches';
    return 'no-items';
  }

  private _onEmptyAction = (e: CustomEvent) => {
    const { id } = e.detail as { id: string };
    if (id === 'clear-filters') this.store?.clearFilters();
    else if (id === 'refresh') void this.store?.refreshAll();
    else if (id === 'add-item') this._startEdit('new');
    else this.dispatchEvent(new CustomEvent('menu-action', { detail: { id }, bubbles: true, composed: true }));
  };

  private _renderFilterPanel(mobile: boolean) {
    const st = this.st;
    if (!st) return null;
    return html`<hv-filter-panel
      .filters=${st.filters}
      .distinct=${st.distinctValuesCache}
      .areas=${st.areasCache?.areas ?? []}
      .locations=${st.locationsFlatCache}
      .locationTree=${st.locationTreeCache ?? []}
      .total=${st.total}
      .grandTotal=${st.statsCounts?.items_total ?? null}
      .stagedCount=${this._stagedCount}
      ?mobile=${mobile}
      @change=${(e: CustomEvent) => this._setFilters(e.detail as Partial<StoreFilters>)}
      @stage=${(e: CustomEvent) => this._priceStaged((e.detail as { filters: StoreFilters }).filters)}
      @apply=${(e: CustomEvent) => {
        this._setFilters(e.detail as StoreFilters);
        this._filterSheetOpen = false;
      }}
      @clear-filters=${() => this.store?.clearFilters()}
    ></hv-filter-panel>`;
  }

  render() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const filterCount = activeFilterCount(filters);
    const loaded = st?.items.length ?? 0;
    const total = st?.total;
    const mobile = this.mobile;

    return html`
      <div class="header">
        <h2 class="title" data-testid="card-title">${this.heading}</h2>
        ${this._renderBadges()}
        <button
          class="add ${mobile ? 'round' : ''}"
          data-testid="add-item"
          aria-label="Add item"
          title="Add item"
          @click=${() => this._startEdit('new')}
        >
          ${icon('plus', 16)}${mobile ? null : 'Add'}
        </button>
        <hv-overflow-menu
          .entries=${this.menuEntries}
          data-testid="card-overflow"
          @select=${this._onMenuSelect}
        ></hv-overflow-menu>
      </div>

      <div class="search-row">
        <label class="search">
          ${icon('magnify', 18)}
          <span class="hv-sr-only">Search items</span>
          <input
            type="search"
            data-testid="search-input"
            placeholder=${total !== null && total !== undefined
              ? `Search ${total} matching item${total === 1 ? '' : 's'}…`
              : 'Search items…'}
            .value=${this._searchDraft}
            @input=${(e: Event) => {
              this._searchDraft = (e.target as HTMLInputElement).value;
              this.emitSearch(this._searchDraft);
            }}
          />
        </label>
        <button
          class="icon-toggle ${this._filterPanelOpen || this._filterSheetOpen ? 'on' : ''}"
          data-testid="filter-toggle"
          aria-label="Filters"
          aria-expanded=${String(this._filterPanelOpen || this._filterSheetOpen)}
          title="Filters"
          @click=${this._toggleFilterSurface}
        >
          ${icon('tune', 19)}
          ${filterCount > 0 ? html`<span class="dot" data-testid="filter-active-dot"></span>` : null}
        </button>
      </div>

      ${filterCount > 0
        ? html`<div class="chips-row">
            <hv-filter-chips
              .filters=${filters}
              .locations=${st?.locationsFlatCache ?? null}
              .areas=${st?.areasCache?.areas ?? []}
              @remove-filter=${(e: CustomEvent) =>
                this._setFilters((e.detail as { patch: Partial<StoreFilters> }).patch)}
              @clear-filters=${() => this.store?.clearFilters()}
            ></hv-filter-chips>
          </div>`
        : null}
      ${!mobile && this._filterPanelOpen
        ? html`<div class="panel-holder">${this._renderFilterPanel(false)}</div>`
        : null}
      ${this._renderBanners()}

      <hv-list
        data-testid="card-list"
        .items=${st?.items ?? []}
        .loading=${st?.loading ?? true}
        .mobile=${mobile}
        .editorTemplate=${this._renderEditor}
        .editingItemId=${this._editing === 'new' ? null : this._editing}
        .addingNew=${this._editing === 'new'}
        .emptyKind=${this.emptyKind}
        .emptyLocationName=${(st?.locationsFlatCache ?? []).find((l) => l.id === filters.locationId)?.name ??
        null}
        @near-end=${(e: CustomEvent) =>
          void this.store?.prefetchIfNeeded((e.detail as { ratio: number }).ratio)}
        @empty-action=${this._onEmptyAction}
        @increment=${(e: CustomEvent) => this._onRowEvent('increment', e.detail)}
        @decrement=${(e: CustomEvent) => this._onRowEvent('decrement', e.detail)}
        @check-in=${(e: CustomEvent) => this._onRowEvent('check-in', e.detail)}
        @request-delete=${(e: CustomEvent) => this._onRowEvent('request-delete', e.detail)}
        @edit=${(e: CustomEvent) => this._onRowEvent('edit', e.detail)}
        @open-item=${(e: CustomEvent) => this._onRowEvent('open-item', e.detail)}
      ></hv-list>

      ${loaded > 0
        ? html`<div class="footer">
            <span data-testid="showing-count">
              ${total !== null && total !== undefined
                ? `Showing ${loaded} of ${total}${filterCount > 0 ? ' filtered' : ''}`
                : `Showing ${loaded}`}
            </span>
          </div>`
        : null}
      ${mobile
        ? html`<hv-bottom-sheet
            label="Filters"
            ?open=${this._filterSheetOpen}
            data-testid="filter-sheet"
            @cancel=${() => {
              this._filterSheetOpen = false;
              this._filterPanel?.resetDraft();
            }}
          >
            <div class="sheet-head">
              <span class="heading">Filters</span>
              <span style="font-size:12.5px;color:var(--hv-text-secondary)">${filterCount} active</span>
              <button
                class="link"
                style="margin-left:auto"
                data-testid="sheet-clear-all"
                @click=${() => this.store?.clearFilters()}
              >
                Clear all
              </button>
            </div>
            ${this._renderFilterPanel(true)}
            <div class="sheet-footer" slot="footer">
              <button
                class="cancel"
                data-testid="sheet-cancel"
                @click=${() => {
                  this._filterSheetOpen = false;
                  this._filterPanel?.resetDraft();
                }}
              >
                Cancel
              </button>
              <button
                class="apply"
                data-testid="sheet-apply"
                @click=${() => this._filterPanel?.apply()}
              >
                ${this._stagedCount === null
                  ? 'Show items'
                  : `Show ${this._stagedCount} item${this._stagedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </hv-bottom-sheet>`
        : null}

      ${mobile
        ? html`<hv-detail-sheet
            data-testid="card-detail-sheet"
            ?open=${this._detailItemId !== null}
            .item=${this._detailItemId ? (this._itemById(this._detailItemId) ?? null) : null}
            .locations=${st?.locationsFlatCache ?? null}
            .locationTree=${st?.locationTreeCache ?? []}
            .categorySuggestions=${(st?.distinctValuesCache?.categories ?? []).map((c) => c.value)}
            .tagSuggestions=${(st?.distinctValuesCache?.tags ?? []).map((t) => t.value)}
            .customFieldKeys=${st?.distinctValuesCache?.custom_field_keys ?? []}
            .busy=${this._editorBusy}
            .errorMessage=${this._editorError}
            @cancel=${() => {
              this._detailItemId = null;
              this._editorError = null;
            }}
            @increment=${(e: CustomEvent) => this._onRowEvent('increment', e.detail)}
            @decrement=${(e: CustomEvent) => this._onRowEvent('decrement', e.detail)}
            @check-in=${(e: CustomEvent) => this._onRowEvent('check-in', e.detail)}
            @check-out=${(e: CustomEvent) => this._onRowEvent('check-out', e.detail)}
            @request-delete=${(e: CustomEvent) => this._onRowEvent('request-delete', e.detail)}
            @save=${this._onEditorSave}
          ></hv-detail-sheet>`
        : null}

      <hv-confirm
        data-testid="card-confirm"
        ?open=${this._confirm !== null}
        .heading=${this._confirm?.heading ?? ''}
        .message=${this._confirm?.message ?? ''}
        .confirmLabel=${this._confirm?.confirmLabel ?? 'Delete'}
        .destructive=${this._confirm?.destructive ?? true}
        @confirm=${() => {
          this._confirm?.onConfirm();
          this._confirm = null;
        }}
        @cancel=${() => {
          this._confirm = null;
        }}
      ></hv-confirm>
    `;
  }

  private get _filterPanel(): HVFilterPanel | null {
    return this.shadowRoot?.querySelector('hv-filter-panel') ?? null;
  }
}

function readPanelPref(): boolean {
  try {
    return window.localStorage.getItem(FILTER_PANEL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePanelPref(open: boolean): void {
  try {
    window.localStorage.setItem(FILTER_PANEL_STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* private mode / storage disabled — the panel just won't be remembered */
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-card-shell': HVCardShell;
  }
}

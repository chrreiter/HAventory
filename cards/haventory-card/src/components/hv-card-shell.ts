import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { t } from '../i18n';
import { showingCount } from '../ui/plural';
import { ResponsiveController } from '../ui/responsive';
import { activeFilterCount, defaultFilters, soleLocationId } from '../store/store';
import { emptyKindFor } from '../ui/empty-state';
import { DEFAULT_CARD_TITLE } from '../ui/card-title';
import type { QuickFilterKey } from '../ui/quick-filters';
import { bannerStack, renderDegradedBanners, renderErrorBanners } from '../ui/banners';
import type { BannerHooks } from '../ui/banners';
import {
  priceStaged,
  renderFilterChips,
  renderFilterHead,
  renderFilterPanel,
  renderSearch,
  renderStagedFooter,
  searchBox,
  searchDebounce,
  sheetHead,
} from '../ui/filter-chrome';
import { renderStatBadges } from '../ui/stat-badges';
import { HostSurfaces } from '../host-surfaces';
import { ItemWorkspace } from '../item-workspace';
import type { Store } from '../store/store';
import type { StoreFilters, StoreState } from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import './hv-bottom-sheet';
import './hv-list';
import './hv-full-view';
import type { OrganizeTab } from './hv-organize-dialog';
import './hv-overflow-menu';
import type { HVFilterPanel } from './hv-filter-panel';
import type { HVItemEditor } from './hv-item-editor';

const FILTER_PANEL_STORAGE_KEY = 'haventory:filter-panel-open:v1';

/** What the expand button discloses; the surface stays in the tree so `aria-controls` resolves. */
const FULL_VIEW_ID = 'card-full-view-surface';

/**
 * What the filter button discloses: the desktop panel or the phone sheet. Only
 * one is ever rendered, so both carry this id.
 */
const FILTER_SURFACE_ID = 'card-filter-surface';

/**
 * The standard card. A container that holds the `Store` and drives it
 * directly; presentation stays in the leaf components.
 */
@customElement('hv-card-shell')
export class HVCardShell extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    bannerStack,
    searchBox,
    sheetHead,
    css`
      :host {
        display: block;
        background: var(--hv-surface);
        color: var(--hv-text);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-card);
        overflow: hidden;
      }
      /* Inherited into every nested shadow tree, keyed off the card's measured width. */
      :host([mobile]) {
        --hv-tap-min: 44px;
        /* iOS Safari zooms the page when a field under 16px takes focus. */
        --hv-input-font: 16px;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 10px;
      }
      .title {
        /* Keeps the actions right-aligned before the badges load. */
        flex: 1;
        min-width: 0;
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
      /* On a phone the badges take a row of their own, or they leave the title
         no width at all. */
      :host([mobile]) .header {
        flex-wrap: wrap;
      }
      :host([mobile]) .badges {
        order: 1;
        flex-basis: 100%;
        margin-left: 0;
        /* Five badges with large counts will not fit one line of a 320px phone. */
        flex-wrap: wrap;
        row-gap: 6px;
      }
      /* Filter toggles on their own row, so a full tap-height target. */
      :host([mobile]) .badge {
        min-height: var(--hv-tap-min, auto);
        padding: 0 14px;
        font-size: 12.5px;
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
        width: var(--hv-tap-min, 36px);
        height: var(--hv-tap-min, 36px);
        padding: 0;
        border-radius: 50%;
        justify-content: center;
      }
      /* Outlined like the filter button, or it reads as decoration beside Add. */
      .header .expand {
        width: var(--hv-tap-min, 36px);
        height: var(--hv-tap-min, 36px);
        border: 1px solid var(--hv-divider);
        color: var(--hv-text-secondary);
      }
      .header .expand:hover {
        border-color: var(--hv-primary);
        color: var(--hv-primary-dark);
      }
      .search-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 16px 10px;
      }
      /* ui/filter-chrome gives the box its shape; this is the card's fill and ink. */
      .search {
        background: var(--hv-input-bg);
        padding: 8px 14px;
        color: var(--hv-text-secondary);
      }
      .search input {
        color: var(--hv-text);
      }
      /* The input takes the tap, so it owns the height. */
      :host([mobile]) .search {
        padding: 0 14px;
      }
      :host([mobile]) .search input {
        min-height: var(--hv-tap-min, auto);
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
        width: var(--hv-tap-min, 40px);
        height: var(--hv-tap-min, 40px);
      }
      .icon-toggle:hover {
        background: var(--hv-hover-overlay);
      }
      .icon-toggle.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
        color: var(--hv-on-primary-tint);
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
      }
      .sheet-head {
        padding: 6px 16px 10px;
      }
      /* Not .hv-text-button: sized to the 12px footer line it shares. */
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
  @property({ type: String }) heading = DEFAULT_CARD_TITLE;
  /** Which quick-filter pills this dashboard offers, or `null` for all; the full view shares it. */
  @property({ attribute: false }) quickFilters: QuickFilterKey[] | null = null;

  @state() private _filterPanelOpen = false;
  @state() private _filterSheetOpen = false;
  @state() private _stagedCount: number | null = null;
  /** The sheet's in-flight filter set, so its header counts what you staged. */
  @state() private _stagedFilters: StoreFilters | null = null;
  @state() private _searchDraft = '';
  /** Moves whenever anything `_renderEditor` reads changes identity (`_syncEditorEpoch`). */
  @state() private _editorEpoch = 0;
  @state() private _fullViewOpen = false;
  @state() private _startSelecting = false;

  /** The editor, the detail sheet and the check-out step, as the full view has them. */
  private readonly _workspace = new ItemWorkspace(this, () => this.store, {
    confirmDiscard: () => this.surfaces.confirmDiscard,
    editor: () => this._editor,
    // A phone opens the detail sheet; desktop, and Edit anywhere, the inline form.
    openItem: (itemId) => {
      if (this.mobile) this._workspace.openDetail(itemId);
      else this._workspace.startEdit(itemId);
    },
    editItem: (itemId) => this._workspace.startEdit(itemId),
    requestDelete: (detail) => this.surfaces.requestDeleteById(detail.itemId),
  });

  /** The dialogs both hosts share — confirm, organize, import, diagnostics. */
  readonly surfaces = new HostSurfaces(this, () => this.store, {
    onItemDeleted: (itemId) => this._workspace.forgetItem(itemId),
    // The filter Organize hands back belongs on the full-screen surface.
    onBrowse: () => this._openFullView(),
  });

  private readonly responsive = new ResponsiveController(this);
  /** Identities `_editorEpoch` was last bumped for; see `_syncEditorEpoch`. */
  private _editorInputs: unknown[] = [];

  get mobile(): boolean {
    return this.responsive.mobile;
  }

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._filterPanelOpen = readPanelPref();
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('store') && this.store) {
      this._searchDraft = this.store.state.value.filters.q;
    }
    // Reflect the mode so child selectors and :host([mobile]) rules apply. The
    // controller requests an update whenever the mode flips.
    this.toggleAttribute('mobile', this.mobile);
    this._workspace.syncPinnedItem();
    this._syncEditorEpoch();
  }

  /**
   * Move `_editorEpoch` on when the inline editor's inputs have.
   *
   * `hv-list` renders the editor from a template callback and re-runs it only
   * when its own properties change, so this is the signal for store state the
   * list does not bind. The store replaces each input wholesale, so identity is
   * enough, and comparing keeps unrelated re-renders from redrawing every row.
   */
  private _syncEditorEpoch() {
    const st = this.st;
    const next: unknown[] = [
      st?.areasCache,
      st?.mediaConfig,
      st?.locationsFlatCache,
      st?.locationTreeCache,
      st?.distinctValuesCache,
      this._workspace.media,
      this._workspace.editorBusy,
      this._workspace.editorError,
    ];
    if (next.some((value, i) => value !== this._editorInputs[i])) {
      this._editorInputs = next;
      this._editorEpoch += 1;
    }
  }

  // ---------- Filters ----------
  private _emitSearch = searchDebounce(() => this.store);

  private _toggleFilterSurface = () => {
    if (this.mobile) {
      this._filterSheetOpen = !this._filterSheetOpen;
      this._stagedFilters = this._filterSheetOpen ? (this.st?.filters ?? defaultFilters()) : null;
      if (this._filterSheetOpen) void this._priceStaged(this.st?.filters ?? defaultFilters());
      return;
    }
    this._filterPanelOpen = !this._filterPanelOpen;
    writePanelPref(this._filterPanelOpen);
  };

  /** Price a staged (not yet applied) filter so the sheet's button can be honest. */
  private _priceStaged = priceStaged(
    () => this.store,
    (count) => {
      this._stagedCount = count;
    },
  );

  private _closeFilterSheet = () => {
    this._filterSheetOpen = false;
    this._stagedFilters = null;
    this._filterPanel?.resetDraft();
  };

  private _openFullView = () => {
    this._fullViewOpen = true;
  };

  // ---------- Inline editing ----------
  private get _editor(): HVItemEditor | null {
    // The phone's add sheet holds it here; on desktop hv-list renders it in its
    // own shadow root. The unsaved-changes prompt needs both.
    const list = this.shadowRoot?.querySelector('hv-list');
    return (
      this.shadowRoot?.querySelector('hv-item-editor') ??
      list?.shadowRoot?.querySelector('hv-item-editor') ??
      null
    );
  }

  /** The expander `hv-list` draws in the row order, on the workspace's `editing` row. */
  private _renderEditor = () =>
    this._workspace.renderEditor({ testid: 'inline-editor', mobile: this.mobile });

  // ---------- Overflow menu ----------
  /** The card's own ⋮: the full-view menu minus "Columns…", which only the table uses. */
  private get cardMenuEntries(): OverflowMenuEntry[] {
    return this.surfaces.menuEntries().filter((entry) => !('id' in entry && entry.id === 'columns'));
  }

  private _onMenuSelect = (e: CustomEvent) => {
    // The full view re-dispatches its own menu selections through here; stop the
    // original so it does not leak out of the card as if it were public API.
    e.stopPropagation();
    const { id, tab } = e.detail as { id: string; tab?: OrganizeTab };
    this._runMenuAction(id, tab);
  };

  /** What an action id from a ⋮ menu or an empty-state offer means. */
  private _runMenuAction(id: string, tab?: OrganizeTab) {
    if (id === 'select-items') {
      // Selection lives in the full view, where there is room for the bulk bar.
      this._startSelecting = true;
      this._fullViewOpen = true;
      return;
    }
    this.surfaces.handleAction(id, tab);
  }

  // ---------- Render helpers ----------
  private _renderBadges() {
    const badges = renderStatBadges(this.st, this.quickFilters, {
      prefix: 'badge',
      chipClass: (tone) => `badge toggle ${tone}`,
      // On a phone the toggles need the row the total would take.
      total: this.mobile ? undefined : 'badge quiet',
      setFilters: (patch) => this.store?.setFilters(patch),
    });
    // On mobile an empty wrapper would still take a row of its own.
    if (!badges || (this.mobile && !badges.any)) return null;
    return html`<div class="badges">${badges.total}${badges.pills}</div>`;
  }

  private _onEmptyAction = (e: CustomEvent) => {
    const { id } = e.detail as { id: string };
    if (id === 'clear-filters') this.store?.clearFilters();
    else if (id === 'refresh') void this.store?.refreshAll();
    else if (id === 'add-item') this._workspace.startEdit('new');
    else this._runMenuAction(id);
  };

  private _renderFilterPanel(mobile: boolean) {
    if (!this.st) return null;
    return renderFilterPanel(this.st, {
      mobile,
      setFilters: (patch) => this.store?.setFilters(patch),
      clearFilters: () => this.store?.clearFilters(),
      onStage: (staged) => {
        this._stagedFilters = staged;
        this._priceStaged(staged);
      },
      onApply: (filters) => {
        this.store?.setFilters(filters);
        this._filterSheetOpen = false;
        this._stagedFilters = null;
      },
    });
  }

  render() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const filterCount = activeFilterCount(filters);
    const stagedFilterCount = activeFilterCount(this._stagedFilters ?? filters);
    const loaded = st?.items.length ?? 0;
    const total = st?.total;
    const searchTotal = st?.statsCounts?.items_total ?? null;
    const mobile = this.mobile;
    // The remembered desktop panel state says nothing about the phone sheet.
    const filterSurfaceOpen = mobile ? this._filterSheetOpen : this._filterPanelOpen;

    return html`
      <div class="header">
        <h2 class="title" data-testid="card-title">${this.heading}</h2>
        ${this._renderBadges()}
        <button
          class="hv-icon-button expand"
          data-testid="expand-toggle"
          aria-label=${t('hv.card.openFullView')}
          aria-expanded=${String(this._fullViewOpen)}
          aria-controls=${FULL_VIEW_ID}
          title=${t('hv.card.openFullView')}
          @click=${this._openFullView}
        >
          ${icon('arrowExpand', 19)}
        </button>
        <button
          class="add ${mobile ? 'round' : ''}"
          data-testid="add-item"
          aria-label=${t('hv.card.addItem')}
          title=${t('hv.card.addItem')}
          @click=${() => this._workspace.startEdit('new')}
        >
          ${icon('plus', 16)}${mobile ? null : t('hv.card.addShort')}
        </button>
        <hv-overflow-menu
          .entries=${this.cardMenuEntries}
          data-testid="card-overflow"
          @select=${this._onMenuSelect}
        ></hv-overflow-menu>
      </div>

      <div class="search-row">
        ${renderSearch({
          testid: 'search-input',
          draft: this._searchDraft,
          total: searchTotal,
          onInput: (q) => {
            this._searchDraft = q;
            this._emitSearch(q);
          },
        })}
        <button
          class="icon-toggle ${filterSurfaceOpen ? 'on' : ''}"
          data-testid="filter-toggle"
          aria-label=${t('hv.card.filters')}
          aria-expanded=${String(filterSurfaceOpen)}
          aria-controls=${FILTER_SURFACE_ID}
          title=${t('hv.card.filters')}
          @click=${this._toggleFilterSurface}
        >
          ${icon('tune', 19)}
          ${filterCount > 0 ? html`<span class="dot" data-testid="filter-active-dot"></span>` : null}
        </button>
      </div>

      ${filterCount > 0
        ? html`<div class="chips-row">
            ${renderFilterChips(st, {
              setFilters: (patch) => this.store?.setFilters(patch),
              clearFilters: () => this.store?.clearFilters(),
            })}
          </div>`
        : null}
      ${mobile
        ? null
        : html`<div class="panel-holder" id=${FILTER_SURFACE_ID} ?hidden=${!this._filterPanelOpen}>
            ${this._filterPanelOpen ? this._renderFilterPanel(false) : null}
          </div>`}
      ${renderDegradedBanners(st, this._bannerHooks)} ${renderErrorBanners(st, this._bannerHooks)}

      <hv-list
        .statuses=${st?.statuses ?? null}
        .areas=${st?.areasCache?.areas ?? []}
        .media=${this._workspace.media}
        data-testid="card-list"
        .items=${st?.items ?? []}
        .loading=${st?.loading ?? true}
        .mobile=${mobile}
        .editorTemplate=${this._renderEditor}
        .editorEpoch=${this._editorEpoch}
        .editingItemId=${this._workspace.editing === 'new' ? null : this._workspace.editing}
        .pinnedItem=${this._workspace.pinnedItem}
        .addingNew=${!mobile && this._workspace.editing === 'new'}
        .emptyKind=${emptyKindFor(this.st)}
        .emptyLocationName=${(st?.locationsFlatCache ?? []).find((l) => l.id === soleLocationId(filters))?.name ??
        null}
        @near-end=${(e: CustomEvent) =>
          void this.store?.prefetchIfNeeded((e.detail as { ratio: number }).ratio)}
        @empty-action=${this._onEmptyAction}
        @increment=${(e: CustomEvent) => this._workspace.onRowEvent('increment', e.detail)}
        @decrement=${(e: CustomEvent) => this._workspace.onRowEvent('decrement', e.detail)}
        @check-in=${(e: CustomEvent) => this._workspace.onRowEvent('check-in', e.detail)}
        @request-delete=${(e: CustomEvent) => this._workspace.onRowEvent('request-delete', e.detail)}
        @edit=${(e: CustomEvent) => this._workspace.onRowEvent('edit', e.detail)}
        @open-item=${(e: CustomEvent) => this._workspace.onRowEvent('open-item', e.detail)}
        @row-action=${(e: CustomEvent) => this._workspace.onRowEvent('row-action', e.detail)}
      ></hv-list>

      ${loaded > 0
        ? html`<div class="footer">
            <span data-testid="showing-count">${showingCount(loaded, total, filterCount > 0)}</span>
            ${mobile
              ? null
              : html`<button class="link" data-testid="open-full-view" @click=${this._openFullView}>
                  ${t('hv.card.openFullView')}${icon('openInNew', 15)}
                </button>`}
          </div>`
        : null}

      <hv-full-view
        id=${FULL_VIEW_ID}
        data-testid="card-full-view"
        ?open=${this._fullViewOpen}
        .store=${this.store}
        .heading=${this.heading}
        .columns=${this.surfaces.columns}
        .quickFilters=${this.quickFilters}
        .menuEntries=${this.surfaces.menuEntries()}
        .confirmDiscard=${this.surfaces.confirmDiscard}
        ?startSelecting=${this._startSelecting}
        @close=${() => {
          this._fullViewOpen = false;
          this._startSelecting = false;
        }}
        @menu-action=${this._onMenuSelect}
        @request-delete=${(e: CustomEvent) => this._workspace.onRowEvent('request-delete', e.detail)}
      ></hv-full-view>
      ${mobile
        ? html`<hv-bottom-sheet
            id=${FILTER_SURFACE_ID}
            label=${t('hv.card.filters')}
            ?open=${this._filterSheetOpen}
            data-testid="filter-sheet"
            @cancel=${this._closeFilterSheet}
          >
            ${renderFilterHead({
              rowClass: 'sheet-head',
              testids: { clear: 'sheet-clear-all' },
              staged: stagedFilterCount,
              onClear: () => this._filterPanel?.clearAll(),
            })}
            ${this._renderFilterPanel(true)}
            ${renderStagedFooter({
              prefix: 'sheet',
              rowClass: 'sheet-footer',
              slot: 'footer',
              cancelClass: 'cancel',
              applyClass: 'hv-pill large apply',
              stagedCount: this._stagedCount,
              panel: () => this._filterPanel,
              onCancel: this._closeFilterSheet,
            })}
          </hv-bottom-sheet>`
        : null}

      ${mobile
        ? html`<hv-bottom-sheet
            label=${t('hv.editor.heading.new')}
            ?open=${this._workspace.editing === 'new'}
            data-testid="add-sheet"
            @cancel=${() => this._workspace.startEdit(null)}
          >
            <div class="hv-sheet-head sheet-head">
              <span class="heading">${t('hv.editor.heading.new')}</span>
              <button
                class="hv-icon-button"
                style="margin-left:auto"
                data-testid="add-sheet-close"
                aria-label=${t('hv.action.close')}
                @click=${() => this._workspace.startEdit(null)}
              >
                ${icon('close', 18)}
              </button>
            </div>
            ${this._workspace.editing === 'new'
              ? this._workspace.renderEditor({ testid: 'inline-editor', mobile, noHeader: true })
              : null}
          </hv-bottom-sheet>`
        : null}

      ${mobile ? this._workspace.renderDetailSheet({ testid: 'card-detail-sheet' }) : null}
      ${this._workspace.renderCheckoutPopover({ testid: 'card-checkout', mobile })}

      ${this.surfaces.renderSurfaces()}
    `;
  }

  /** What the shared banner stacks act through; Reconnect and Refresh are ours. */
  private get _bannerHooks(): BannerHooks {
    return { store: this.store, onRefresh: () => void this.surfaces.refresh() };
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

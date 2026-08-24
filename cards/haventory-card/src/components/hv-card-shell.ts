import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { t, tn } from '../i18n';
import { counted, showingCount } from '../ui/plural';
import { ResponsiveController } from '../ui/responsive';
import { debounce } from '../utils/debounce';
import { activeFilterCount, defaultFilters, soleLocationId } from '../store/store';
import { emptyKindFor } from '../ui/empty-state';
import { DEFAULT_CARD_TITLE } from '../ui/card-title';
import { quickFilterAllowed } from '../ui/quick-filters';
import type { QuickFilterKey } from '../ui/quick-filters';
import { bannerStack, renderDegradedBanners, renderErrorBanners } from '../ui/banners';
import type { BannerHooks } from '../ui/banners';
import { HostSurfaces } from '../host-surfaces';
import { ItemWorkspace } from '../item-workspace';
import type { Store } from '../store/store';
import type { StoreFilters, StoreState } from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import './hv-bottom-sheet';
import './hv-filter-chips';
import './hv-filter-panel';
import './hv-list';
import './hv-full-view';
import type { OrganizeTab } from './hv-organize-dialog';
import './hv-overflow-menu';
import type { HVFilterPanel } from './hv-filter-panel';
import type { HVItemEditor } from './hv-item-editor';

const SEARCH_DEBOUNCE_MS = 200;
const FILTER_PANEL_STORAGE_KEY = 'haventory:filter-panel-open:v1';

/**
 * What the header's expand button discloses, named so `aria-controls` can point
 * at it. The surface is in the tree whether or not it is open — an
 * `aria-controls` that resolves to nothing announces the button as controlling
 * nothing — and `open` decides what it draws.
 */
const FULL_VIEW_ID = 'card-full-view-surface';

/**
 * What the filter button discloses. Which element that is depends on the width:
 * the panel under the search row on a desktop, the bottom sheet on a phone. Only
 * one of the two is ever rendered, so both carry the same id and the button can
 * name it without knowing which it got.
 */
const FILTER_SURFACE_ID = 'card-filter-surface';

/**
 * The standard card.
 *
 * A container: it holds the `Store` and drives it directly. Interactions nest
 * several levels deep (row → editor → location tree), and threading each one
 * back up through re-dispatched events is more plumbing than it is worth.
 * Presentation stays in the leaf components.
 */
@customElement('hv-card-shell')
export class HVCardShell extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    bannerStack,
    css`
      :host {
        display: block;
        background: var(--hv-surface);
        color: var(--hv-text);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-card);
        overflow: hidden;
      }
      /* Declared once here and inherited into every nested component's shadow
         DOM — the shared .hv-icon-button, the sheets, the row steppers and the
         editor all read it, so none of them needs its own copy of "is the card
         narrow?". It is keyed off the card's measured width rather than a
         pointer:coarse media query, to stay consistent with every other mobile
         affordance in this component. */
      :host([mobile]) {
        --hv-tap-min: 44px;
        /* iOS Safari zooms the whole page when a field smaller than 16px takes
           focus, and never zooms back out. Every field on the card was between
           12.5px and 14.5px, so tapping any of them left the user zoomed in. */
        --hv-input-font: 16px;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 10px;
      }
      .title {
        /* Takes the slack so the actions stay right-aligned even before the
           stats badges have loaded. */
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
      /* The title is the only thing in this row that can give, so every badge
         and button that will not shrink comes straight out of its width —
         below ~375px there is none of it left. The badges are filter toggles
         rather than decoration, so on a phone they take a row of their own and
         hand the width back. */
      :host([mobile]) .header {
        flex-wrap: wrap;
      }
      :host([mobile]) .badges {
        order: 1;
        flex-basis: 100%;
        margin-left: 0;
        /* Five of these — low, overdue, to inspect, to do, checked out — with
           five-digit counts will not make one line of a 320px phone. Wrapping
           costs a second 44px band in the worst case; not wrapping pushes the
           last one off the side of the card, where it cannot be pressed at
           all. */
        flex-wrap: wrap;
        row-gap: 6px;
      }
      /* These are filter toggles, not decoration, and on their own row there is
         height to spare — so they take a full tap-height target, which is also
         the one thing that makes them bigger than a chip anywhere else. */
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
      /* Sits with the other header actions rather than in the search row, where
         a third circle crowded the search box on a narrow card. Outlined like
         the filter button below it: a borderless glyph beside a filled primary
         button reads as decoration rather than something to press. */
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
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
      }
      /* The input inside the pill is what actually takes the tap, so the field
         owns the height rather than the pill around it. */
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
      /* The footer's way into the expanded view. Sized to the footer it sits in
         rather than to the card's other text buttons, which is why it is not
         .hv-text-button: the line it shares with the item count is 12px. */
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
  /**
   * Which quick-filter pills this dashboard offers, or `null` for all of them.
   * Passed on to the full view unchanged — one vocabulary on both surfaces.
   */
  @property({ attribute: false }) quickFilters: QuickFilterKey[] | null = null;

  @state() private _filterPanelOpen = false;
  @state() private _filterSheetOpen = false;
  @state() private _stagedCount: number | null = null;
  /** The sheet's in-flight filter set, so its header counts what you staged. */
  @state() private _stagedFilters: StoreFilters | null = null;
  @state() private _searchDraft = '';
  /**
   * Changes whenever anything `_renderEditor` reads has changed identity — see
   * `_syncEditorEpoch`, which is the list of what that is.
   */
  @state() private _editorEpoch = 0;
  @state() private _fullViewOpen = false;
  @state() private _startSelecting = false;

  /** The editor, the detail sheet and the check-out step, as the full view has them. */
  private readonly _workspace = new ItemWorkspace(this, () => this.store, {
    confirmDiscard: () => this.surfaces.confirmDiscard,
    editor: () => this._editor,
    // Touch has no hover: tapping a row opens the detail sheet, which is the
    // single mobile surface. Desktop expands the row in place instead — and so
    // does the row menu's Edit, which is a request for the form rather than
    // for whatever the width would have opened.
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
    onBrowse: () => {
      // Organizing is a full-screen job, so the filter it hands back belongs
      // on the full-screen surface too — dropping back to the small card
      // means immediately expanding again to see what you just picked.
      this._fullViewOpen = true;
    },
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
    // Reflect the mode so child selectors and :host([mobile]) rules apply.
    this.toggleAttribute('mobile', this.mobile);
    this._workspace.syncPinnedItem();
    this._syncEditorEpoch();
  }

  /**
   * Move `_editorEpoch` on when the inline editor's inputs have.
   *
   * On the desktop card the editor is not rendered here: `hv-list` gets it as a
   * template callback and re-runs it only when one of *its* properties changes.
   * Everything below is state `_renderEditor` reads that the list does not
   * bind, so without a signal of its own a store change reaches this element
   * and stops — leaving an open form showing what was true when it opened.
   *
   * Identity comparison is enough — the store replaces each of these wholesale
   * rather than mutating it. Comparing at all, rather than bumping on every
   * update, is what keeps a re-render that changed none of them — a dialog
   * opening, the filter panel expanding, a row being selected — from redrawing
   * the list and every row in it.
   *
   * Changing a filter is not one of those: `setFilters` refetches the location
   * tree, which the open form reads, so it moves the epoch and should.
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

  protected updated() {
    this.toggleAttribute('mobile', this.mobile);
  }

  // ---------- Filters ----------
  private _emitSearch = debounce((q: string) => this.store?.setFilters({ q }), SEARCH_DEBOUNCE_MS);

  private _setFilters(patch: Partial<StoreFilters>) {
    this.store?.setFilters(patch);
  }

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
  private _priceStaged = debounce((filters: StoreFilters) => {
    void this.store?.countMatching(filters).then((count) => {
      this._stagedCount = count;
    });
  }, 150);

  // ---------- Inline editing ----------
  private get _editor(): HVItemEditor | null {
    // Two homes: on a phone the add form is slotted into a sheet in this shadow
    // root, and on desktop it is an expander rendered by hv-list inside the row
    // order, so it lives in that component's shadow root instead. Both have to
    // be findable or the unsaved-changes prompt silently stops firing.
    const list = this.shadowRoot?.querySelector('hv-list');
    return (
      this.shadowRoot?.querySelector('hv-item-editor') ??
      list?.shadowRoot?.querySelector('hv-item-editor') ??
      null
    );
  }

  /**
   * The expander, drawn by `hv-list` inside the row order rather than here — so
   * it takes no arguments: which row it is on is the workspace's `editing`,
   * which is also what tells the list to call this.
   */
  private _renderEditor = () =>
    this._workspace.renderEditor({ testid: 'inline-editor', mobile: this.mobile });

  // ---------- Overflow menu ----------
  /**
   * The card's own ⋮, which is the full-view menu minus "Columns…".
   *
   * Column choices only drive the full view's table — the card list draws a
   * fixed compact row — so the card's own menu omits them.
   */
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

  /**
   * What an action id means, for every surface that can name one.
   *
   * The ⋮ menus and the empty state's offers share an id vocabulary. Almost all
   * of it is answered by the shared host surfaces; the one id that is about
   * this element rather than a dialog is handled here.
   */
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
    const st = this.st;
    const counts = st?.statsCounts;
    if (!counts) return null;
    const f = st?.filters;
    // A pill shows when the dashboard allows it *and* its count clears the gate
    // it always had — the config decides what is on offer, the count decides
    // whether there is anything to say.
    const allows = (key: QuickFilterKey) => quickFilterAllowed(this.quickFilters, key);
    const lowStock = allows('low_stock') && counts.low_stock_count > 0;
    const overdue = allows('overdue') && (counts.overdue_count ?? 0) > 0;
    const inspection = allows('inspection_due') && (counts.inspection_due_count ?? 0) > 0;
    const reminder = allows('reminder_due') && (counts.reminder_due_count ?? 0) > 0;
    const checkedOut = allows('checked_out') && counts.checked_out_count > 0;
    // On mobile the wrapper takes a row of its own, so an empty one would leave
    // a blank band under the title rather than nothing at all. The total is not
    // among them: it does not render on a phone at all.
    const anyBadge = !this.mobile || lowStock || overdue || inspection || reminder || checkedOut;
    if (!anyBadge) return null;
    return html`
      <div class="badges">
        ${this.mobile || !allows('total')
          ? null
          : html`<span class="hv-chip badge quiet" data-testid="badge-total">${counted(counts.items_total, 'item')}</span>`}
        ${lowStock
          ? html`<button
              class="hv-chip badge toggle warning ${f?.lowStockOnly ? 'on' : ''}"
              data-testid="badge-low"
              aria-pressed=${String(!!f?.lowStockOnly)}
              title=${t('hv.card.badge.lowTitle')}
              @click=${() => this._setFilters({ lowStockOnly: !f?.lowStockOnly })}
            >
              ${t('hv.card.badge.low', { count: counts.low_stock_count })}
            </button>`
          : null}
        ${overdue
          ? html`<button
              class="hv-chip badge toggle error ${f?.overdueOnly ? 'on' : ''}"
              data-testid="badge-overdue"
              aria-pressed=${String(!!f?.overdueOnly)}
              title=${t('hv.card.badge.overdueTitle')}
              @click=${() => this._setFilters({ overdueOnly: !f?.overdueOnly })}
            >
              ${t('hv.card.badge.overdue', { count: counts.overdue_count ?? 0 })}
            </button>`
          : null}
        ${inspection
          ? html`<button
              class="hv-chip badge toggle warning ${f?.inspectionDueOnly ? 'on' : ''}"
              data-testid="badge-inspection"
              aria-pressed=${String(!!f?.inspectionDueOnly)}
              title=${t('hv.card.badge.inspectionTitle')}
              @click=${() => this._setFilters({ inspectionDueOnly: !f?.inspectionDueOnly })}
            >
              ${t('hv.card.badge.inspection', { count: counts.inspection_due_count ?? 0 })}
            </button>`
          : null}
        ${reminder
          ? html`<button
              class="hv-chip badge toggle warning ${f?.reminderDueOnly ? 'on' : ''}"
              data-testid="badge-reminder"
              aria-pressed=${String(!!f?.reminderDueOnly)}
              title=${t('hv.card.badge.reminderTitle')}
              @click=${() => this._setFilters({ reminderDueOnly: !f?.reminderDueOnly })}
            >
              ${t('hv.card.badge.reminder', { count: counts.reminder_due_count ?? 0 })}
            </button>`
          : null}
        ${checkedOut
          ? html`<button
              class="hv-chip badge toggle state ${f?.checkedOutOnly ? 'on' : ''}"
              data-testid="badge-out"
              aria-pressed=${String(!!f?.checkedOutOnly)}
              title=${t('hv.card.badge.checkedOutTitle')}
              @click=${() => this._setFilters({ checkedOutOnly: !f?.checkedOutOnly })}
            >
              ${t('hv.card.badge.checkedOut', { count: counts.checked_out_count })}
            </button>`
          : null}
      </div>
    `;
  }

  private _onEmptyAction = (e: CustomEvent) => {
    const { id } = e.detail as { id: string };
    if (id === 'clear-filters') this.store?.clearFilters();
    else if (id === 'refresh') void this.store?.refreshAll();
    else if (id === 'add-item') this._workspace.startEdit('new');
    else this._runMenuAction(id);
  };

  private _renderFilterPanel(mobile: boolean) {
    const st = this.st;
    if (!st) return null;
    return html`<hv-filter-panel
      .statuses=${st?.statuses ?? null}
      .filters=${st.filters}
      .distinct=${st.distinctValuesCache}
      .areas=${st.areasCache?.areas ?? []}
      .locations=${st.locationsFlatCache}
      .locationTree=${st.locationTreeCache ?? []}
      .total=${st.total}
      .grandTotal=${st.statsCounts?.items_total ?? null}
      .counts=${st.statsCounts}
      ?mobile=${mobile}
      @change=${(e: CustomEvent) => this._setFilters(e.detail as Partial<StoreFilters>)}
      @stage=${(e: CustomEvent) => {
        const staged = (e.detail as { filters: StoreFilters }).filters;
        this._stagedFilters = staged;
        this._priceStaged(staged);
      }}
      @apply=${(e: CustomEvent) => {
        this._setFilters(e.detail as StoreFilters);
        this._filterSheetOpen = false;
        this._stagedFilters = null;
      }}
      @clear-filters=${() => this.store?.clearFilters()}
    ></hv-filter-panel>`;
  }

  render() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const filterCount = activeFilterCount(filters);
    const stagedFilterCount = activeFilterCount(this._stagedFilters ?? filters);
    const loaded = st?.items.length ?? 0;
    const total = st?.total;
    // The placeholder counts the whole inventory, not the filtered result: it is
    // the same sentence the full view and the panel show, so the search box does
    // not describe the same store two ways depending on which surface opened it.
    const searchTotal = st?.statsCounts?.items_total ?? null;
    const mobile = this.mobile;
    // The filter button reports the surface its own width uses. The desktop
    // panel's open state is remembered across sessions, so reading it on a
    // phone would announce a surface this width never shows.
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
          @click=${() => {
            this._fullViewOpen = true;
          }}
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
        <label class="search">
          ${icon('magnify', 18)}
          <span class="hv-sr-only">${t('hv.card.searchItems')}</span>
          <input
            type="search"
            data-testid="search-input"
            placeholder=${searchTotal === null
              ? t('hv.card.searchPlaceholder')
              : tn('hv.card.searchAllPlaceholder', searchTotal)}
            .value=${this._searchDraft}
            @input=${(e: Event) => {
              this._searchDraft = (e.target as HTMLInputElement).value;
              this._emitSearch(this._searchDraft);
            }}
          />
        </label>
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
            <hv-filter-chips
              .statuses=${st?.statuses ?? null}
              .filters=${filters}
              .locations=${st?.locationsFlatCache ?? null}
              .areas=${st?.areasCache?.areas ?? []}
              @remove-filter=${(e: CustomEvent) =>
                this._setFilters((e.detail as { patch: Partial<StoreFilters> }).patch)}
              @clear-filters=${() => this.store?.clearFilters()}
            ></hv-filter-chips>
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
              : html`<button
                  class="link"
                  data-testid="open-full-view"
                  @click=${() => {
                    this._fullViewOpen = true;
                  }}
                >
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
            @cancel=${() => {
              this._filterSheetOpen = false;
              this._stagedFilters = null;
              this._filterPanel?.resetDraft();
            }}
          >
            <div class="sheet-head">
              <span class="heading">${t('hv.card.filters')}</span>
              <span style="font-size:12.5px;color:var(--hv-text-secondary)"
                >${t('hv.card.filtersActive', { count: stagedFilterCount })}</span
              >
              <button
                class="hv-text-button"
                style="margin-left:auto"
                data-testid="sheet-clear-all"
                @click=${() => this._filterPanel?.clearAll()}
              >
                ${t('hv.action.clearAll')}
              </button>
            </div>
            ${this._renderFilterPanel(true)}
            <div class="sheet-footer" slot="footer">
              <button
                class="cancel"
                data-testid="sheet-cancel"
                @click=${() => {
                  this._filterSheetOpen = false;
                  this._stagedFilters = null;
                  this._filterPanel?.resetDraft();
                }}
              >
                ${t('hv.action.cancel')}
              </button>
              <button
                class="hv-pill large apply"
                data-testid="sheet-apply"
                @click=${() => this._filterPanel?.apply()}
              >
                ${this._stagedCount === null
                  ? t('hv.card.showItems')
                  : tn('hv.card.showCount', this._stagedCount)}
              </button>
            </div>
          </hv-bottom-sheet>`
        : null}

      ${mobile
        ? html`<hv-bottom-sheet
            label=${t('hv.card.newItem')}
            ?open=${this._workspace.editing === 'new'}
            data-testid="add-sheet"
            @cancel=${() => this._workspace.startEdit(null)}
          >
            <div class="sheet-head">
              <span class="heading">${t('hv.card.newItem')}</span>
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

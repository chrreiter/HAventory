import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { counted, plural } from '../ui/plural';
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
import './hv-full-view';
import './hv-organize-dialog';
import './hv-checkout-popover';
import './hv-diagnostics-panel';
import './hv-import-sheet';
import './hv-overflow-menu';
import type { ColumnKey } from '../store/columns';
import type { HVFilterPanel } from './hv-filter-panel';
import type { HVItemEditor } from './hv-item-editor';
import type { ListEmptyKind } from './hv-list';
import type { ImportPolicy, ImportPreview, ImportSummary, ItemCreate, ItemUpdate } from '../store/types';

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
         and button that will not shrink comes straight out of its width: at
         375px it had 40px for a 78px heading, at 360px 25px, and at 320px none
         at all. The badges are filter toggles rather than decoration, so on a
         phone they take a row of their own and hand the width back. */
      :host([mobile]) .header {
        flex-wrap: wrap;
      }
      :host([mobile]) .badges {
        order: 1;
        flex-basis: 100%;
        margin-left: 0;
        /* Three of these — low, overdue, checked out — with five-digit counts
           will not always make one line of a 320px phone. Wrapping costs a
           second 44px band in the worst case; not wrapping pushes the last one
           off the side of the card, where it cannot be pressed at all. */
        flex-wrap: wrap;
        row-gap: 6px;
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
      /* 21px tall was well under a thumb, and these are filter toggles. On
         their own row there is height to spare. */
      :host([mobile]) .badge {
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
        padding: 0 14px;
        font-size: 12.5px;
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
      .badge.overdue {
        color: var(--hv-error-deep);
        background: var(--hv-error-bg);
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
      /* The pill looked tappable at 38px, but the input inside it — the part
         that actually takes the tap — was 18px tall. Let the field own the
         height so the two agree. */
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
      /* 45x15 in the filter sheet's header — a text link, but still a control. */
      :host([mobile]) .link {
        min-height: var(--hv-tap-min, auto);
        padding: 0 6px;
      }
    `,
  ];

  /** Required. The shell subscribes to it itself — see `connectedCallback`. */
  @property({ attribute: false }) store!: Store;
  @property({ type: String }) heading = 'Inventory';
  /** Force a layout instead of measuring; `null` measures. */
  @property({ attribute: false }) forceMobile: boolean | null = null;
  /** Column selection for the full-view table (the card list has its own row). */
  @property({ attribute: false }) columns: ColumnKey[] = [];

  @state() private _filterPanelOpen = false;
  @state() private _filterSheetOpen = false;
  @state() private _stagedCount: number | null = null;
  /** The sheet's in-flight filter set, so its header counts what you staged. */
  @state() private _stagedFilters: StoreFilters | null = null;
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
  @state() private _fullViewOpen = false;
  @state() private _startSelecting = false;
  @state() private _organizeOpen = false;
  @state() private _diagnosticsOpen = false;
  @state() private _importOpen = false;
  @state() private _importPreview: ImportPreview | null = null;
  @state() private _importSummary: ImportSummary | null = null;
  @state() private _importBusy = false;
  @state() private _importError: string | null = null;
  @state() private _refreshBusy = false;
  /** When the caches were last known-good, for the diagnostics "since" tile. */
  @state() private _lastRefresh: string | null = null;
  /** Item whose check-out / due-date step is open, with where to anchor it. */
  @state() private _checkout: { itemId: string; mode: 'check-out' | 'set-due-date'; anchor: DOMRect | null } | null =
    null;

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

  private _onRowAction(item: Item, detail: { action?: string; anchor?: DOMRect }) {
    switch (detail.action) {
      case 'check-out':
        this._checkout = { itemId: item.id, mode: 'check-out', anchor: detail.anchor ?? null };
        break;
      case 'set-due-date':
        this._checkout = { itemId: item.id, mode: 'set-due-date', anchor: detail.anchor ?? null };
        break;
      case 'check-in':
        void this.store?.markCheckedIn(item.id, item.version);
        break;
      case 'edit':
        this._startEdit(item.id);
        break;
      case 'delete':
        this._requestDelete(item);
        break;
    }
  }

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

  /**
   * `opts.noHeader` is for the mobile add sheet, which draws its own title bar
   * — the editor's own header leads with an expander chevron that means
   * nothing once the form is not an expander.
   */
  private _renderEditor = (itemId: string | null, opts: { noHeader?: boolean } = {}) => {
    const st = this.st;
    return html`<hv-item-editor
      data-testid="inline-editor"
      ?noHeader=${opts.noHeader ?? false}
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
        // A due date is optional over the WS API, but it is what makes overdue
        // highlighting mean anything — so offer the step rather than skipping it.
        this._checkout = { itemId: item.id, mode: 'check-out', anchor: null };
        break;
      case 'request-delete':
        this._requestDelete(item);
        break;
      case 'row-action':
        this._onRowAction(item, detail as { action?: string; anchor?: DOMRect });
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
  /** Short badge for the Diagnostics menu row, or null when all is well. */
  private get diagnosticsBadge(): string | null {
    const st = this.st;
    if (!st) return null;
    const rate = st.healthCache?.rate_limit;
    const dropped = (rate?.dropped_commands ?? 0) + (rate?.dropped_events ?? 0);
    if (dropped > 0) return `${dropped} dropped`;
    const issues = st.healthCache?.issues.length ?? 0;
    if (issues > 0) return counted(issues, 'issue');
    if (st.degraded.connectionLost) return 'offline';
    return null;
  }

  private async _refresh() {
    this._refreshBusy = true;
    try {
      await this.store?.refreshAll();
      this._lastRefresh = new Date().toISOString();
    } finally {
      this._refreshBusy = false;
    }
  }

  private async _onImportPreview(e: CustomEvent) {
    const { document, policy } = e.detail as { document: unknown; policy: ImportPolicy };
    this._importBusy = true;
    this._importError = null;
    this._importSummary = null;
    try {
      this._importPreview = (await this.store?.previewImport(document, policy)) ?? null;
    } catch (err) {
      this._importPreview = null;
      this._importError = (err as { message?: string })?.message ?? 'Could not check that document.';
    } finally {
      this._importBusy = false;
    }
  }

  private async _onImportExecute(e: CustomEvent) {
    const { document, policy } = e.detail as { document: unknown; policy: ImportPolicy };
    this._importBusy = true;
    this._importError = null;
    try {
      this._importSummary = (await this.store?.executeImport(document, policy)) ?? null;
      this._lastRefresh = new Date().toISOString();
    } catch (err) {
      const anyErr = err as {
        code?: string;
        message?: string;
        data?: { errors?: { path: string; message: string }[] };
      };
      if (anyErr?.code === 'validation_error' && anyErr.data?.errors?.length) {
        // The backend rejected the document itself — show the structured list
        // rather than flattening it into one message.
        this._importPreview = {
          valid: false,
          errors: anyErr.data.errors,
          policy,
          document: {
            haventory_export_version: null,
            schema_version: null,
            exported_at: null,
            integration_version: null,
          },
          items: { add: [], update: [], conflict: [], unchanged: [] },
          locations: { add: [], update: [], conflict: [], unchanged: [] },
          counts: {},
        };
      } else {
        this._importError = anyErr?.message ?? 'The import failed.';
      }
    } finally {
      this._importBusy = false;
    }
  }

  private get menuEntries(): OverflowMenuEntry[] {
    const st = this.st;
    const total = st?.statsCounts?.items_total ?? null;
    const filtered = st?.total ?? null;
    const filtersOn = activeFilterCount(st?.filters ?? defaultFilters()) > 0;
    return [
      { id: 'select-items', label: 'Select items…', glyph: 'select' },
      { id: 'organize', label: 'Organize…', glyph: 'mapMarker', meta: 'Locations · Tags · Categories' },
      { id: 'columns', label: 'Columns…', glyph: 'viewColumn' },
      { divider: true },
      { id: 'refresh', label: 'Refresh data', glyph: 'refresh', meta: 'Items · locations · stats' },
      {
        id: 'diagnostics',
        label: 'Diagnostics',
        glyph: 'alertCircle',
        // Badge only when there is actually something wrong — otherwise it is a plain row.
        ...(this.diagnosticsBadge ? { badge: this.diagnosticsBadge } : {}),
      },
      { divider: true },
      { caption: 'Data' },
      {
        id: 'export-all',
        label: 'Export backup',
        glyph: 'download',
        sub: total === null ? 'Everything' : `All ${counted(total, 'item')} · all locations`,
      },
      {
        id: 'export-view',
        label: 'Export current view',
        glyph: 'download',
        sub:
          filtered === null
            ? 'Active filter · keeps location paths'
            : `${filtered} filtered ${plural(filtered, 'item')} · keeps location paths`,
        disabled: !filtersOn,
      },
      { id: 'import', label: 'Import backup…', glyph: 'upload' },
    ];
  }

  /**
   * The card's own ⋮, which is the full-view menu minus "Columns…".
   *
   * Column choices only drive the full view's table — the card list draws a
   * fixed compact row — so offering them here opened a picker that changed
   * nothing visible on this surface.
   */
  private get cardMenuEntries(): OverflowMenuEntry[] {
    return this.menuEntries.filter((entry) => !('id' in entry && entry.id === 'columns'));
  }

  private _onMenuSelect = (e: CustomEvent) => {
    // The full view re-dispatches its own menu selections through here; stop the
    // original so the host card does not also see it directly.
    e.stopPropagation();
    const { id } = e.detail as { id: string };
    if (id === 'refresh') {
      void this._refresh();
      return;
    }
    if (id === 'diagnostics') {
      this._diagnosticsOpen = true;
      return;
    }
    if (id === 'import') {
      this._importPreview = null;
      this._importSummary = null;
      this._importError = null;
      this._importOpen = true;
      return;
    }
    if (id === 'organize') {
      this._organizeOpen = true;
      return;
    }
    if (id === 'select-items') {
      // Selection lives in the full view, where there is room for the bulk bar.
      this._startSelecting = true;
      this._fullViewOpen = true;
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
    // On mobile the wrapper takes a row of its own, so an empty one would leave
    // a blank band under the title rather than nothing at all.
    const anyBadge =
      !this.mobile ||
      counts.low_stock_count > 0 ||
      (counts.overdue_count ?? 0) > 0 ||
      counts.checked_out_count > 0;
    if (!anyBadge) return null;
    return html`
      <div class="badges">
        ${this.mobile
          ? null
          : html`<span class="badge" data-testid="badge-total">${counted(counts.items_total, 'item')}</span>`}
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
        ${(counts.overdue_count ?? 0) > 0
          ? html`<button
              class="badge overdue ${f?.overdueOnly ? 'on' : ''}"
              data-testid="badge-overdue"
              aria-pressed=${String(!!f?.overdueOnly)}
              title="Show only overdue items"
              @click=${() => this._setFilters({ overdueOnly: !f?.overdueOnly })}
            >
              ${counts.overdue_count} overdue
            </button>`
          : null}
        ${counts.checked_out_count > 0
          ? html`<button
              class="badge out ${f?.checkedOutOnly ? 'on' : ''}"
              data-testid="badge-out"
              aria-pressed=${String(!!f?.checkedOutOnly)}
              title="Show only checked-out items"
              @click=${() => this._setFilters({ checkedOutOnly: !f?.checkedOutOnly })}
            >
              ${counts.checked_out_count} checked out
            </button>`
          : null}
      </div>
    `;
  }

  /**
   * Conditions that make the card untrustworthy, said out loud.
   *
   * Rate limiting can drop subscription events silently and events carry no
   * sequence number, so the card cannot detect a gap on its own — the honest
   * move is to say it might be stale and offer the re-read.
   */
  private _renderDegradedBanners() {
    const degraded = this.st?.degraded;
    if (!degraded) return null;
    const banners = [];

    if (degraded.connectionLost) {
      banners.push(html`<hv-banner
        kind="error"
        glyph="wifiOff"
        heading="Connection lost"
        message=" · showing the data already loaded. Changes may not save."
        data-testid="degraded-offline"
      >
        <button
          slot="actions"
          class="hv-pill outline"
          data-testid="degraded-reconnect"
          @click=${() => void this._refresh()}
        >
          Reconnect
        </button>
      </hv-banner>`);
    } else if (degraded.retrying > 0) {
      banners.push(html`<hv-banner
        kind="warning"
        glyph="clock"
        heading="Busy — retrying"
        message=${` · ${counted(degraded.retrying, 'change')} queued`}
        data-testid="degraded-retrying"
      ></hv-banner>`);
    } else if (degraded.rateLimited) {
      banners.push(html`<hv-banner
        kind="warning"
        glyph="clock"
        heading="Rate limited"
        message=" · some live updates may have been dropped, so this list can be out of date."
        data-testid="degraded-rate-limited"
      >
        <button
          slot="actions"
          class="hv-pill outline"
          data-testid="degraded-refresh"
          @click=${() => void this._refresh()}
        >
          Refresh
        </button>
      </hv-banner>`);
    }

    if (degraded.reloading) {
      banners.push(html`<hv-banner
        kind="info"
        glyph="refresh"
        heading="Inventory was replaced by an import"
        message=" · reloading…"
        data-testid="degraded-reloading"
      ></hv-banner>`);
    }

    return banners.length ? html`<div class="banners" data-testid="degraded-banners">${banners}</div>` : null;
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
      .counts=${st.statsCounts}
      .stagedCount=${this._stagedCount}
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
    const mobile = this.mobile;

    return html`
      <div class="header">
        <h2 class="title" data-testid="card-title">${this.heading}</h2>
        ${this._renderBadges()}
        <button
          class="hv-icon-button expand"
          data-testid="expand-toggle"
          aria-label="Open full view"
          aria-expanded=${String(this._fullViewOpen)}
          title="Open full view"
          @click=${() => {
            this._fullViewOpen = true;
          }}
        >
          ${icon('arrowExpand', 19)}
        </button>
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
          .entries=${this.cardMenuEntries}
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
              ? `Search ${total} matching ${plural(total, 'item')}…`
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
      ${this._renderDegradedBanners()} ${this._renderBanners()}

      <hv-list
        data-testid="card-list"
        .items=${st?.items ?? []}
        .loading=${st?.loading ?? true}
        .mobile=${mobile}
        .editorTemplate=${this._renderEditor}
        .editingItemId=${this._editing === 'new' ? null : this._editing}
        .addingNew=${!mobile && this._editing === 'new'}
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
        @row-action=${(e: CustomEvent) => this._onRowEvent('row-action', e.detail)}
      ></hv-list>

      ${loaded > 0
        ? html`<div class="footer">
            <span data-testid="showing-count">
              ${total !== null && total !== undefined
                ? `Showing ${loaded} of ${total}${filterCount > 0 ? ' filtered' : ''}`
                : `Showing ${loaded}`}
            </span>
            ${mobile
              ? null
              : html`<button
                  class="link"
                  data-testid="open-full-view"
                  @click=${() => {
                    this._fullViewOpen = true;
                  }}
                >
                  Open full view${icon('openInNew', 15)}
                </button>`}
          </div>`
        : null}

      <hv-full-view
        data-testid="card-full-view"
        ?open=${this._fullViewOpen}
        .store=${this.store}
        .heading=${this.heading}
        .columns=${this.columns}
        .menuEntries=${this.menuEntries}
        ?startSelecting=${this._startSelecting}
        @close=${() => {
          this._fullViewOpen = false;
          this._startSelecting = false;
        }}
        @menu-action=${this._onMenuSelect}
        @request-delete=${(e: CustomEvent) => this._onRowEvent('request-delete', e.detail)}
      ></hv-full-view>
      ${mobile
        ? html`<hv-bottom-sheet
            label="Filters"
            ?open=${this._filterSheetOpen}
            data-testid="filter-sheet"
            @cancel=${() => {
              this._filterSheetOpen = false;
              this._stagedFilters = null;
              this._filterPanel?.resetDraft();
            }}
          >
            <div class="sheet-head">
              <span class="heading">Filters</span>
              <span style="font-size:12.5px;color:var(--hv-text-secondary)">${stagedFilterCount} active</span>
              <button
                class="link"
                style="margin-left:auto"
                data-testid="sheet-clear-all"
                @click=${() => this._filterPanel?.clearAll()}
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
                  this._stagedFilters = null;
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
                  : `Show ${counted(this._stagedCount, 'item')}`}
              </button>
            </div>
          </hv-bottom-sheet>`
        : null}

      ${mobile
        ? html`<hv-bottom-sheet
            label="New item"
            ?open=${this._editing === 'new'}
            data-testid="add-sheet"
            @cancel=${() => {
              this._editing = null;
              this._editorError = null;
            }}
          >
            <div class="sheet-head">
              <span class="heading">New item</span>
              <button
                class="hv-icon-button"
                style="margin-left:auto"
                data-testid="add-sheet-close"
                aria-label="Close"
                @click=${() => {
                  this._editing = null;
                  this._editorError = null;
                }}
              >
                ${icon('close', 18)}
              </button>
            </div>
            ${this._editing === 'new' ? this._renderEditor(null, { noHeader: true }) : null}
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
            @check-out-confirmed=${(e: CustomEvent) => {
              const { itemId, dueDate } = e.detail as { itemId: string; dueDate: string | null };
              const item = this._itemById(itemId);
              if (item) void this.store?.checkOut(item.id, dueDate, item.version);
            }}
            @set-due-date=${(e: CustomEvent) => {
              const { itemId, dueDate } = e.detail as { itemId: string; dueDate: string | null };
              const item = this._itemById(itemId);
              if (item) void this.store?.updateItem(item.id, { due_date: dueDate }, item.version);
            }}
            @request-delete=${(e: CustomEvent) => this._onRowEvent('request-delete', e.detail)}
            @save=${this._onEditorSave}
          ></hv-detail-sheet>`
        : null}

      <hv-import-sheet
        data-testid="card-import"
        ?open=${this._importOpen}
        .preview=${this._importPreview}
        .summary=${this._importSummary}
        .busy=${this._importBusy}
        .errorMessage=${this._importError}
        @preview=${(e: CustomEvent) => void this._onImportPreview(e)}
        @execute=${(e: CustomEvent) => void this._onImportExecute(e)}
        @invalidate-preview=${() => {
          // A preview is only valid for the policy it was run with.
          this._importPreview = null;
          this._importError = null;
        }}
        @cancel=${() => {
          this._importOpen = false;
          this._importPreview = null;
          this._importSummary = null;
          this._importError = null;
        }}
      ></hv-import-sheet>

      <hv-diagnostics-panel
        data-testid="card-diagnostics"
        ?open=${this._diagnosticsOpen}
        .health=${st?.healthCache ?? null}
        .counts=${st?.statsCounts ?? null}
        .version=${st?.versionInfo ?? null}
        .degraded=${st?.degraded ?? null}
        .connected=${st?.connected ?? null}
        .loadedItems=${loaded}
        .lastRefresh=${this._lastRefresh}
        .busy=${this._refreshBusy}
        @refresh=${() => void this._refresh()}
        @cancel=${() => {
          this._diagnosticsOpen = false;
        }}
      ></hv-diagnostics-panel>

      <hv-checkout-popover
        data-testid="card-checkout"
        ?open=${this._checkout !== null}
        ?mobile=${mobile}
        .mode=${this._checkout?.mode ?? 'check-out'}
        .anchor=${this._checkout?.anchor ?? null}
        .item=${this._checkout ? (this._itemById(this._checkout.itemId) ?? null) : null}
        @check-out=${(e: CustomEvent) => {
          const { itemId, dueDate } = e.detail as { itemId: string; dueDate: string | null };
          const item = this._itemById(itemId);
          this._checkout = null;
          if (item) void this.store?.checkOut(item.id, dueDate, item.version);
        }}
        @set-due-date=${(e: CustomEvent) => {
          const { itemId, dueDate } = e.detail as { itemId: string; dueDate: string | null };
          const item = this._itemById(itemId);
          this._checkout = null;
          // A due date only exists while an item is out, so this is a plain update.
          if (item) void this.store?.updateItem(item.id, { due_date: dueDate }, item.version);
        }}
        @cancel=${() => {
          this._checkout = null;
        }}
      ></hv-checkout-popover>

      <hv-organize-dialog
        data-testid="card-organize"
        ?open=${this._organizeOpen}
        ?mobile=${mobile}
        .store=${this.store}
        @cancel=${() => {
          this._organizeOpen = false;
        }}
        @browse=${() => {
          // Organizing is a full-screen job, so the filter it hands back belongs
          // on the full-screen surface too — dropping back to the small card
          // means immediately expanding again to see what you just picked.
          this._fullViewOpen = true;
        }}
      ></hv-organize-dialog>

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

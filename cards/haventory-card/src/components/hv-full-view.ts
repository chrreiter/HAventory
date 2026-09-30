import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { browseRow } from '../ui/browse-row';
import { onEscape } from '../ui/keyboard';
import { rovingTarget, syncRovingTabindex } from '../ui/roving-list';
import { icon } from '../ui/icons';
import { t, tn } from '../i18n';
import type { TranslationKey } from '../i18n';
import { counted, showingCount } from '../ui/plural';
import { nextZBase } from '../utils/zindex';
import { activeFilterCount, defaultFilters, soleLocationId } from '../store/store';
import { countLocations } from '../store/location-tree';
import { emptyKindFor, renderEmptyState } from '../ui/empty-state';
import { deepFocusables } from '../ui/dialog-focus';
import {
  PATH_SEPARATOR,
  areaMarkName,
  locationPathParts,
  pathTitle,
  renderAreaChip,
} from '../ui/location-path';
import { DEFAULT_CARD_TITLE } from '../ui/card-title';
import type { QuickFilterKey } from '../ui/quick-filters';
import type { ConfirmDiscard } from '../ui/discard';
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
import { ViewportNarrow } from '../ui/responsive';
import { ItemWorkspace } from '../item-workspace';
import { statusCount, statusLabel, statusList } from '../ui/status';
import type { EmptyOffer } from '../ui/empty-state';
import type { Store } from '../store/store';
import type { ColumnKey } from '../store/columns';
import type {
  DistinctValue,
  Item,
  Location,
  LocationTreeNode,
  Sort,
  StoreFilters,
  StoreState,
} from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import { makeBulkOp } from '../store/store';
import type { BulkOperation, BulkOutcome } from '../store/types';
import type { BulkAction, BulkProgress, BulkResultView, BulkRunDetail } from './hv-bulk-bar';
import './hv-bulk-bar';
import './hv-checkout-popover';
import './hv-confirm';
import './hv-data-table';
import './hv-location-tree';
import './hv-overflow-menu';
import type { HVItemEditor } from './hv-item-editor';
import type { HVLocationTree } from './hv-location-tree';
import type { HVFilterPanel } from './hv-filter-panel';

/** The sidebar's collapsible sections, in the order they appear. */
type SidebarSection = 'locations' | 'status' | 'categories' | 'tags';

/** The sections whose rows the sidebar draws itself; `hv-location-tree` draws the locations. */
type FacetSection = Exclude<SidebarSection, 'locations'>;

const FACET_SECTIONS: FacetSection[] = ['status', 'categories', 'tags'];

/** Names a facet row by its value, so a tab stop survives a redraw that keeps the row. */
const facetRowKey = (section: FacetSection, value: string | undefined) =>
  `${section}:${value ?? ''}`;

/**
 * The element a section heading discloses. It stays in the tree while shut so
 * `aria-controls` always resolves; only its contents come and go.
 */
const sectionPanelId = (section: SidebarSection) => `sidebar-section-${section}`;

/** What the context bar's Filters button discloses, on the same terms. */
const FILTER_PANEL_ID = 'full-view-filter-panel';

/**
 * App-bar width at or below which *Add item* drops its label and the bar
 * tightens its gaps. German with all four counts showing needs 1024px, which is
 * what a 1280px window leaves beside Home Assistant's sidebar.
 */
const BAR_TIGHT = 1100;

/** At or below this the search box gives up 60px of its floor so the pill strip keeps a pill. */
const BAR_TIGHTER = 900;

/** The steps a bar of this width takes, as classes. 0 is unmeasured and gets the widest form. */
function barSteps(width: number): string {
  if (width <= 0) return '';
  if (width <= BAR_TIGHTER) return 'tight tighter';
  if (width <= BAR_TIGHT) return 'tight';
  return '';
}

/**
 * The expanded workspace: a coloured app bar, a sidebar of locations and
 * facets with the backend's counts, and the item table.
 */
@customElement('hv-full-view')
export class HVFullView extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    browseRow,
    bannerStack,
    searchBox,
    sheetHead,
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
        /*
         * hv-card-shell sets both on :host([mobile]) from the card's width,
         * which says nothing about a viewport-sized surface. The
         * guaranteed-invalid value lets each consumer fall back to its own
         * size; the narrow media query below sets touch sizing.
         */
        --hv-tap-min: initial;
        --hv-input-font: initial;
        /* The sidebar and the table set a width floor a sideways phone can be
           under, so the layout pans sideways rather than clipping the ⋮ and
           the editor's Save. The boxes inside scroll vertically themselves. */
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior: contain;
        box-shadow: var(--hv-shadow-overlay);
      }
      /* Embedded, the host sizes this surface as a page rather than an overlay. */
      :host([embedded]) {
        display: block;
        height: 100%;
      }
      :host([embedded]) .shell {
        position: relative;
        inset: auto;
        height: 100%;
        box-shadow: none;
      }
      .appbar {
        display: flex;
        align-items: center;
        /* A grid item's automatic minimum is its min-content, which for this
           nowrap row includes the unscrolled pills; zero lets the strip shrink. */
        min-width: 0;
        gap: 12px;
        padding: 10px 16px;
        background: var(--hv-primary);
        color: #fff;
      }
      .appbar.selecting {
        background: var(--hv-primary-darker);
      }
      .appbar .count {
        font: 500 18px var(--hv-font);
      }
      .appbar .subcount {
        font-size: 12.5px;
        opacity: 0.85;
      }
      .appbar .ghost {
        flex: none;
        border: 1px solid rgba(255, 255, 255, 0.45);
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        border-radius: var(--hv-radius-chip);
        padding: 5px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .appbar .ghost.plain {
        background: none;
        font-weight: 400;
      }
      .honesty {
        padding: 10px 20px;
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .appbar h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        white-space: nowrap;
      }
      .appbar .tap {
        width: var(--hv-tap-min, 36px);
        height: var(--hv-tap-min, 36px);
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
      /* ui/filter-chrome gives the box its shape; this is the bar's fill and ink. */
      .appbar .search {
        /* So the phone's full-width basis includes the padding. */
        box-sizing: border-box;
        max-width: 420px;
        background: rgba(255, 255, 255, 0.22);
        padding: 7px 14px;
      }
      .appbar .search input {
        color: #fff;
      }
      .appbar .search input::placeholder {
        color: rgba(255, 255, 255, 0.8);
      }
      /*
       * The card's chips with solid fills: its tints are pale or translucent
       * washes that turn muddy over a primary-coloured bar. The applied ring is
       * white because the bar itself is primary.
       */
      .appbar .hv-chip {
        background: rgba(255, 255, 255, 0.22);
        color: #fff;
      }
      .appbar .hv-chip:hover {
        background: rgba(255, 255, 255, 0.32);
      }
      .appbar .hv-chip.on {
        outline-color: #fff;
      }
      .appbar .hv-chip.warning {
        background: var(--hv-amber);
        color: var(--hv-on-amber);
      }
      .appbar .hv-chip.error {
        background: var(--hv-error);
        color: #fff;
      }
      /*
       * The strip is what shrinks when the bar runs out of room, scrolling its
       * own overflow. The 3px padding keeps the applied ring (2px outline at a
       * 1px offset) inside the scroll box; the negative margin gives it back.
       */
      .appbar .pills {
        display: flex;
        align-items: center;
        flex-wrap: nowrap;
        gap: 8px;
        flex: 0 1 auto;
        min-width: 0;
        overflow-x: auto;
        padding: 3px;
        margin: -3px;
        scrollbar-width: none;
      }
      .appbar .pills::-webkit-scrollbar {
        display: none;
      }
      /*
       * Above the phone breakpoint (the complement of NARROW_QUERY). The row
       * never wraps, and the search box keeps a floor; the pill strip and the
       * two width steps give instead.
       */
      @media (min-width: 701px) {
        .appbar .search {
          min-width: 260px;
        }
        /* Selection mode's sentence and buttons can wrap without stranding a glyph. */
        .appbar.selecting {
          flex-wrap: wrap;
        }
        /* The heading is the dashboard's title, of any length. Any shrink weight
           would take a slice of every overflowing pixel and elide it early, so
           it does not shrink and elides only past a cap that scales with the bar. */
        .appbar h2 {
          flex: none;
          max-width: 30%;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .appbar .pills {
          flex-shrink: 100;
        }
        /* The one auto margin on the row; a second would strand the pill strip mid-bar. */
        .appbar .add {
          margin-left: auto;
        }
        /* Below this breakpoint the count's flex:1 puts Clear at the far side. */
        .appbar.selecting .clear {
          margin-left: auto;
        }
        /* First step. The template moves the add button's label to hv-sr-only. */
        .appbar.tight {
          gap: 8px;
        }
        .appbar.tight .add {
          padding: 7px 10px;
        }
        /* Second step. */
        .appbar.tighter .search {
          min-width: 200px;
        }
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
      /* This surface is sized by the viewport, not the card, so a media query is
         the right signal. A phone has no room for the tree beside the table. */
      @media (max-width: 700px) {
        .body {
          grid-template-columns: 1fr;
        }
        .sidebar {
          display: none;
        }
        /* On the shell so the table and the context bar get touch sizing too. */
        .shell {
          --hv-tap-min: 44px;
          --hv-input-font: 16px;
        }
        .appbar {
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 12px;
        }
        /* Matches the table row (hv-data-table .row). The one control that opts
           out of the 16px iOS no-zoom size: a filter box, not a form field. */
        .appbar .search input {
          font-size: 13.5px;
          min-height: 34px;
        }
        .filters-button {
          min-height: var(--hv-tap-min, auto);
        }
        .appbar h2 {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 17px;
        }
        /* Second row: the search alone, so the pills stay together beneath it. */
        .appbar .search {
          order: 1;
          flex: 1 0 100%;
          max-width: none;
          padding: 5px 12px;
        }
        /* Third row, on a line of its own, so it wraps rather than scrolls. */
        .appbar .pills {
          order: 2;
          flex-wrap: wrap;
          overflow: visible;
        }
        /* Secondary toggles keep a compact height rather than the 44px target. */
        .appbar .pill {
          min-height: 30px;
          padding: 5px 11px;
        }
        .appbar .ghost,
        .appbar .add {
          min-height: var(--hv-tap-min, auto);
        }
        .appbar .add {
          padding: 0 14px;
        }

        /* The count is the one item that shrinks, which keeps Clear on the first
           row; the subtitle takes a line of its own. */
        .appbar.selecting .count {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .appbar.selecting .subcount {
          order: 1;
          flex-basis: 100%;
        }
        .appbar.selecting .load-all {
          order: 2;
        }
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
      /* The heading is the collapse button, so its "+" action is a sibling. */
      .section-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        /* Not flex:1, so the tags heading's Any/All sits right after the word. */
        flex: 0 1 auto;
        min-width: 0;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 0;
        margin-left: -4px;
        color: var(--hv-text-secondary);
        text-align: left;
      }
      .section-toggle:hover {
        color: var(--hv-text);
      }
      .section-toggle .hv-label {
        color: inherit;
      }
      .section-tally {
        flex: none;
        margin-left: auto;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      /* The filter panel's Any/All control, in this shadow root. */
      .segmented {
        display: inline-flex;
        flex: none;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
        overflow: hidden;
      }
      .segmented button {
        border: none;
        background: none;
        color: var(--hv-chip-text);
        padding: 4px 10px;
        font: 400 11.5px var(--hv-font);
        min-height: var(--hv-tap-min, auto);
      }
      .segmented button.on {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        font-weight: 500;
      }
      /* Reserves the action's room so the tallies line up as one column. */
      .head-action {
        flex: none;
        display: flex;
        justify-content: flex-end;
        width: var(--hv-tap-min, 34px);
      }
      /* Facet rows take their shape from ui/browse-row, as the tree's do; the
         empty note lines up with a row's name. */
      .section-empty {
        padding: 2px 16px 8px 38px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
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
      .context-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-left: auto;
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
      /* The segments and count wrap as one run; the chip sits outside it. */
      .crumb > .hv-chip-line-text {
        flex: 1;
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
        color: var(--hv-on-primary-tint);
      }
      /* Slotted into the table, so styled in this tree. */
      .empty {
        display: grid;
        justify-items: center;
        gap: 10px;
        padding: 12px 16px 24px;
        text-align: center;
        color: var(--hv-text-secondary);
        font-size: 13px;
      }
      .empty .headline {
        font-size: 14px;
        font-weight: 500;
        color: var(--hv-text);
      }
      .empty .offers {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      /*
       * The shell clips, so the panel needs a ceiling and a scroll box or its
       * foot is unreachable on a phone. The second min() term measures the
       * column, leaving the context bar and footer (116px) their room.
       */
      .panel-holder {
        padding: 0 20px 12px;
        display: flex;
        flex-direction: column;
        flex: none;
        min-height: 0;
        box-sizing: border-box;
        max-height: min(80dvh, calc(100% - 116px));
      }
      /* The display above would otherwise beat the browser's [hidden] rule. */
      .panel-holder[hidden] {
        display: none;
      }
      .panel-scroll {
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior-y: contain;
      }
      /* Phone only, where the panel stages its edits; ui/filter-chrome shapes them. */
      .panel-head {
        flex: none;
        padding: 2px 0 8px;
      }
      .panel-head .hv-text-button {
        flex: none;
      }
      .panel-foot {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        padding: 10px 0 2px;
      }
      /* The count sentence stays on one line; the row's auto margin gives instead. */
      .panel-foot .hv-pill {
        min-width: 130px;
        white-space: nowrap;
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
        /* A scroll box's automatic minimum is zero, so without this the table
           squeezes the form; the ceiling below is its size. */
        flex: none;
        /* As the panel's: the column minus the context bar and footer, so the
           sticky Save/Cancel stays on screen on a sideways phone. */
        max-height: min(70dvh, calc(100% - 116px));
        overflow-y: auto;
      }
      /* The form stays open on a row that no longer matches the filter. */
      .pinned-hint {
        margin: 0;
        padding: 6px 16px;
        font-size: 12px;
        color: var(--hv-text-secondary);
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
        font: 400 var(--hv-input-font, 13px) var(--hv-font);
        color: var(--hv-text);
      }
    `,
  ];

  @property({ attribute: false }) store!: Store;

  /**
   * The editor, the read sheet and the check-out step. Delete goes to the host,
   * since this surface owns no confirmation; a row click and Edit are the same.
   */
  private readonly _workspace = new ItemWorkspace(this, () => this.store, {
    confirmDiscard: () => this.confirmDiscard,
    editor: () => this._editor,
    openItem: (itemId) => this._openItem(itemId),
    editItem: (itemId) => this._openItem(itemId),
    requestDelete: (detail) =>
      this.dispatchEvent(new CustomEvent('request-delete', { detail, bubbles: true, composed: true })),
  });

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) heading = DEFAULT_CARD_TITLE;
  @property({ attribute: false }) columns: ColumnKey[] = [];
  /** Which quick-filter pills this dashboard offers, or `null` for all of them. */
  @property({ attribute: false }) quickFilters: QuickFilterKey[] | null = null;
  /** Extra entries the host adds to the app bar's ⋮ menu. */
  @property({ attribute: false }) menuEntries: OverflowMenuEntry[] = [];
  /** Open straight into selection mode (the card's "Select items…" entry). */
  @property({ type: Boolean }) startSelecting = false;
  /**
   * Fill the host (a Home Assistant panel) instead of taking over the viewport:
   * no backdrop, dialog role, focus sentinels, Escape-to-close or close button.
   */
  @property({ type: Boolean, reflect: true }) embedded = false;
  /** Home Assistant's narrow flag (sidebar collapsed, at any width), unlike `_viewport`. */
  @property({ type: Boolean }) narrow = false;
  /**
   * The host's discard question for this surface, its form and its sheet. It is
   * the host's because closing takes this surface down. Null asks nothing.
   */
  @property({ attribute: false }) confirmDiscard: ConfirmDiscard | null = null;

  @state() private _zBase = 0;
  @state() private _filtersOpen = false;
  @state() private _searchDraft = '';
  @state() private _creatingLocation = false;
  @state() private _locationError: string | null = null;
  /** Every section starts open; collapsing one sticks for the session. */
  @state() private _sections: Record<SidebarSection, boolean> = {
    locations: true,
    status: true,
    categories: true,
    tags: true,
  };
  /** Which row holds each facet list's one tab stop (`facetRowKey`); null until `updated` resolves it. */
  @state() private _facetStop: Record<FacetSection, string | null> = {
    status: null,
    categories: null,
    tags: null,
  };
  /**
   * True on a phone-width viewport (`NARROW_QUERY`), for the children that take
   * their layout from a `mobile` property. Leaving it drops the phone panel's draft.
   */
  private readonly _viewport = new ViewportNarrow(this, () => {
    this._stagedFilters = null;
  });
  /**
   * The app bar's width steps (`barSteps`), from the measured shell. No media
   * query sees the panel's width beside HA's sidebar, and a size container would
   * become the containing block for the `position: fixed` menus and sheets.
   */
  @state() private _barSteps = '';
  /** The staged filter set's match count, for the phone footer's button. */
  @state() private _stagedCount: number | null = null;
  /** The phone panel's staged filter set, which its head row counts. */
  @state() private _stagedFilters: StoreFilters | null = null;
  @state() private _selecting = false;
  @state() private _bulkProgress: BulkProgress | null = null;
  @state() private _bulkResult: BulkResultView | null = null;
  @state() private _pendingDelete = false;
  /** The whole selection's check-out is waiting on one due date. */
  @state() private _pendingBulkCheckout = false;
  @state() private _loadingAll = false;
  /** Set while a batch is running so Cancel can stop it between chunks. */
  private _bulkCancelled = false;
  /** The ops of the last run, so "Retry failed" can replay just the failures. */
  private _lastOps: { label: string; ops: BulkOperation[] } | null = null;

  private _prevFocus: HTMLElement | null = null;

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._barObserver?.disconnect();
    this._barTarget = null;
  }

  private _barObserver?: ResizeObserver;
  private _barTarget: Element | null = null;

  /** Watch the shell, which comes and goes with `open`, so called after every render. */
  private _syncBarMeasure() {
    const shell = this.shadowRoot?.querySelector('.shell') ?? null;
    if (shell === this._barTarget) return;
    this._barTarget = shell;
    this._barObserver?.disconnect();
    if (!shell) return this._setBarWidth(0);
    this._barObserver ??= new ResizeObserver(([entry]) => this._setBarWidth(entry.contentRect.width));
    this._barObserver.observe(shell);
  }

  /** The one way in for a measured width; a test with no layout calls it too. */
  private _setBarWidth(width: number) {
    const next = barSteps(width);
    if (next !== this._barSteps) this._barSteps = next;
  }

  /** Price a staged (not yet applied) filter set, so the footer can be honest. */
  private _priceStaged = priceStaged(
    () => this.store,
    (count) => {
      this._stagedCount = count;
    },
  );

  protected willUpdate(changed: Map<string, unknown>) {
    this._workspace.syncPinnedItem();
    if (changed.has('open')) {
      if (this.open) {
        this._zBase = nextZBase();
        this._searchDraft = this.st?.filters.q ?? '';
        this._prevFocus = (document.activeElement as HTMLElement) ?? null;
        this._selecting = this.startSelecting;
      } else {
        this._filtersOpen = false;
        this._stagedFilters = null;
        this._workspace.setEditing(null);
        this._workspace.closeDetail();
        this._creatingLocation = false;
        this._locationError = null;
        this._selecting = false;
        this._bulkResult = null;
        this._bulkProgress = null;
      }
    }
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) {
        // Embedded there is no trap, and focusing the search would raise a
        // phone's keyboard over the list on plain navigation.
        if (!this.embedded) this._focusFirst();
        this._tree?.revealPathTo(soleLocationId(this.st?.filters ?? defaultFilters()));
      } else if (this._prevFocus?.isConnected) {
        this._prevFocus.focus();
      }
    }
    for (const section of FACET_SECTIONS) this._syncFacetStop(section);
    this._syncBarMeasure();
  }

  /** The rows of one facet list, in the order they are drawn. */
  private _facetRows(section: FacetSection): HTMLElement[] {
    return [
      ...this.renderRoot.querySelectorAll<HTMLElement>(`[data-testid="sidebar-${section}-row"]`),
    ];
  }

  /** Leave one row of `section` in the tab order, read off the rendered rows. */
  private _syncFacetStop(section: FacetSection) {
    const held = syncRovingTabindex(this._facetRows(section), this._facetStop[section], (el) =>
      facetRowKey(section, el.dataset.value),
    );
    this._holdFacetStop(section, held);
  }

  /** Remember a list's stop; `updated` calls this, so an unchanged key must not redraw. */
  private _holdFacetStop(section: FacetSection, key: string | null) {
    if (this._facetStop[section] === key) return;
    this._facetStop = { ...this._facetStop, [section]: key };
  }

  /** The arrows reach the rows the single tab stop leaves out; the rows are buttons for Enter and Space. */
  private _onFacetKeydown(section: FacetSection, e: KeyboardEvent) {
    const next = rovingTarget(e, this._facetRows(section));
    if (!next) return;
    this._holdFacetStop(section, facetRowKey(section, next.dataset.value));
    this._syncFacetStop(section);
    next.focus();
  }

  private get _tree(): HVLocationTree | null {
    return this.shadowRoot?.querySelector('hv-location-tree') ?? null;
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  };

  private get _editor(): HVItemEditor | null {
    return this.shadowRoot?.querySelector('hv-item-editor') ?? null;
  }

  /** Hand an action to the host's `HostSurfaces`, as its ⋮ menu entries do. */
  private _menuAction(detail: Record<string, unknown>) {
    this.dispatchEvent(new CustomEvent('menu-action', { detail, bubbles: true, composed: true }));
  }

  /** What the shared banner stacks act through; Refresh is the host's menu action. */
  private get _bannerHooks(): BannerHooks {
    return { store: this.store, onRefresh: () => this._menuAction({ id: 'refresh' }) };
  }

  /** Leave the open form for another row, the create form, or by closing the surface. */
  private _leaveEditor(to: string | 'new' | 'close') {
    this._workspace.leave(() => {
      if (to === 'close') this._close();
      else this._workspace.setEditing(to);
    });
  }

  // ---------- Focus trap ----------
  /** Every control in the shell, through child shadow roots, minus the trap's own sentinels. */
  private _focusables(): HTMLElement[] {
    return deepFocusables(this.shadowRoot?.querySelector('.shell')).filter(
      (el) => !el.classList.contains('sentinel'),
    );
  }

  private _focusFirst() {
    this._focusables()[0]?.focus();
  }

  private _focusLast() {
    const list = this._focusables();
    list[list.length - 1]?.focus();
  }

  private _emitSearch = searchDebounce(() => this.store);

  /** Show an item: the read sheet on a phone, the inline form where the table already reads it. */
  private _openItem(id: string) {
    if (this._viewport.narrow) {
      this._workspace.openDetail(id);
      return;
    }
    this._leaveEditor(id);
  }

  // ---------- Bulk actions ----------
  private get _selectedItems(): Item[] {
    const selection = this.st?.selection ?? new Set<string>();
    return (this.st?.items ?? []).filter((i) => selection.has(i.id));
  }

  private _exitSelection() {
    this._selecting = false;
    this._bulkResult = null;
    this._lastOps = null;
    this._pendingBulkCheckout = false;
    this.store?.clearSelection();
  }

  /** Build the batch for an action over the current selection. */
  private _opsFor(detail: BulkRunDetail, items: Item[]): { label: string; ops: BulkOperation[] } {
    const tags = detail.tags ?? [];
    const version = (i: Item) => ({ expected_version: i.version });
    // add_tags/remove_tags are additive server-side, so they do not clobber a
    // concurrent edit the way a whole-array update would.
    const table: Record<BulkAction, [TranslationKey, (i: Item) => BulkOperation]> = {
      move: [
        'hv.bulk.label.move',
        (i) => makeBulkOp('item_move', { item_id: i.id, location_id: detail.locationId ?? null, ...version(i) }),
      ],
      'add-tags': ['hv.bulk.label.addTags', (i) => makeBulkOp('item_add_tags', { item_id: i.id, tags })],
      'remove-tags': ['hv.bulk.label.removeTags', (i) => makeBulkOp('item_remove_tags', { item_id: i.id, tags })],
      'set-category': [
        'hv.bulk.label.setCategory',
        (i) => makeBulkOp('item_update', { item_id: i.id, category: detail.category ?? null, ...version(i) }),
      ],
      'adjust-qty': [
        'hv.bulk.label.adjustQty',
        (i) => makeBulkOp('item_adjust_quantity', { item_id: i.id, delta: detail.delta ?? 0 }),
      ],
      'check-out': [
        'hv.bulk.label.checkOut',
        (i) => makeBulkOp('item_check_out', { item_id: i.id, due_date: detail.dueDate ?? null }),
      ],
      'check-in': ['hv.bulk.label.checkIn', (i) => makeBulkOp('item_check_in', { item_id: i.id })],
      delete: ['hv.bulk.label.delete', (i) => makeBulkOp('item_delete', { item_id: i.id, ...version(i) })],
    };
    const [label, op] = table[detail.action];
    return { label: t(label), ops: items.map(op) };
  }

  private _onBulkRun = (e: CustomEvent) => {
    const detail = e.detail as BulkRunDetail;
    if (detail.action === 'delete') {
      this._pendingDelete = true;
      return;
    }
    if (detail.action === 'check-out' && detail.dueDate === undefined) {
      // One due-date question covers the whole selection.
      this._pendingBulkCheckout = true;
      return;
    }
    void this._execute(this._opsFor(detail, this._selectedItems));
  };

  private async _execute(batch: { label: string; ops: BulkOperation[] }) {
    if (!batch.ops.length) return;
    this._lastOps = batch;
    this._bulkCancelled = false;
    this._bulkResult = null;
    this._bulkProgress = { done: 0, total: batch.ops.length, failed: 0, label: batch.label };

    // Count what ran: a cancel stops after the in-flight chunk, and deletes
    // come back with no item, so `outcome.succeeded` would undercount them.
    let ran = 0;
    const outcome: BulkOutcome | undefined = await this.store?.bulkExecute(batch.ops, {
      onProgress: (done, total, failed) => {
        ran = done;
        this._bulkProgress = { done, total, failed, label: batch.label };
      },
      isCancelled: () => this._bulkCancelled,
    });

    this._bulkProgress = null;
    if (!outcome) return;
    const { failed } = outcome;
    this._bulkResult = { label: batch.label, succeeded: Math.max(0, ran - failed.length), failed };
    // Narrow the selection to what still needs attention.
    this.store?.setSelected(outcome.failed.map((f) => f.itemId).filter((id): id is string => !!id));
  }

  private async _createLocation(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._locationError = null;
    try {
      // Under whatever the sidebar has selected, which is what "add here" means in a tree.
      await this.store?.createLocation(trimmed, soleLocationId(this.st?.filters ?? defaultFilters()), null);
      this._creatingLocation = false;
    } catch (err) {
      this._locationError =
        (err as { message?: string })?.message ?? t('hv.editor.locationCreateFailed');
    }
  }

  /**
   * The editor's way out of an empty location picker: a root location with no
   * area, handed back so the form can file the item in it.
   */
  private _createLocationForEditor = (name: string): Promise<Location> => {
    const store = this.store;
    if (!store) return Promise.reject(new Error(t('hv.card.notConnected')));
    return store.createLocation(name, null, null);
  };

  // ---------- Sections ----------
  /** One collapsible sidebar heading; the chevron and the words are one target. */
  private _renderSectionToggle(section: SidebarSection, label: string) {
    const open = this._sections[section];
    return html`<button
      class="section-toggle"
      data-testid=${`sidebar-toggle-${section}`}
      aria-expanded=${String(open)}
      aria-controls=${sectionPanelId(section)}
      @click=${() => {
        this._sections = { ...this._sections, [section]: !open };
      }}
    >
      ${icon(open ? 'chevronDown' : 'chevronRight', 18)}
      <span class="hv-label">${label}</span>
    </button>`;
  }

  /** The filter panel's any/all tag mode, shown here so it does not work unseen. */
  private _renderTagsMode(mode: 'any' | 'all') {
    return html`<span class="segmented" role="radiogroup" aria-label=${t('hv.filter.tagMatchMode')}>
      ${(['any', 'all'] as const).map(
        (m) => html`<button
          class=${mode === m ? 'on' : ''}
          role="radio"
          aria-checked=${String(mode === m)}
          data-testid="sidebar-tags-mode"
          data-mode=${m}
          title=${m === 'any' ? t('hv.fullView.tagsAnyTitle') : t('hv.fullView.tagsAllTitle')}
          @click=${() => this.store?.setFilters({ tagsMode: m })}
        >
          ${m === 'any' ? t('hv.term.any') : t('hv.term.all')}
        </button>`,
      )}
    </span>`;
  }

  /** A section heading's "+"; statuses, categories and tags are created in Organize. */
  private _renderNewButton(testid: string, label: string, onClick: () => void) {
    return html`<span class="head-action">
      <button class="hv-icon-button" data-testid=${testid} aria-label=${label} title=${label} @click=${onClick}>
        ${icon('plus', 20)}
      </button>
    </span>`;
  }

  /**
   * The household's statuses as a single-select facet (the backend filter takes
   * one); pressing the active row clears it. No tally, since the row count is
   * the vocabulary's size rather than anything about the inventory.
   */
  private _renderStatusSection() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const counts = st?.statsCounts;
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle('status', t('hv.field.status'))}
        ${this._renderNewButton('sidebar-new-status', t('hv.fullView.newStatus'), () =>
          this._menuAction({ id: 'organize', tab: 'statuses' }),
        )}
      </div>
      <div
        id=${sectionPanelId('status')}
        role="group"
        aria-label=${t('hv.field.status')}
        ?hidden=${!this._sections.status}
        @keydown=${(e: KeyboardEvent) => this._onFacetKeydown('status', e)}
      >
        ${this._sections.status
          ? statusList(this.st?.statuses).map(({ slug: s }) => {
              const on = filters.status === s;
              const tally = statusCount(counts, s);
              return html`<button
                class="value-row hv-browse-row ${on ? 'selected' : ''}"
                data-testid="sidebar-status-row"
                data-value=${s}
                aria-pressed=${String(on)}
                tabindex="-1"
                @click=${() => {
                  this._holdFacetStop('status', facetRowKey('status', s));
                  this.store?.setFilters({ status: on ? null : s });
                }}
              >
                <span class="hv-browse-row-lead ${on ? '' : 'placeholder'}">${icon('check', 15)}</span>
                <span class="label hv-browse-row-label">${statusLabel(s, this.st?.statuses)}</span>
                ${tally === null ? null : html`<span class="hv-tally">${tally}</span>`}
              </button>`;
            })
          : null}
      </div>
    `;
  }

  /** Categories and tags as multi-select sidebar rows; pressing a selected row takes it out. */
  private _renderFacetSection(
    section: 'categories' | 'tags',
    label: string,
    values: DistinctValue[],
    isOn: (value: string) => boolean,
    onPick: (value: string) => void,
    head?: unknown,
  ) {
    const open = this._sections[section];
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle(section, label)}
        ${head ?? null}
        <span class="section-tally" data-testid=${`sidebar-${section}-tally`}>${values.length}</span>
        ${this._renderNewButton(
          `sidebar-new-${section}`,
          section === 'tags' ? t('hv.fullView.newTag') : t('hv.fullView.newCategory'),
          () => this._menuAction({ id: 'organize', tab: section }),
        )}
      </div>
      <div
        id=${sectionPanelId(section)}
        role="group"
        aria-label=${label}
        ?hidden=${!open}
        @keydown=${(e: KeyboardEvent) => this._onFacetKeydown(section, e)}
      >
        ${open
          ? values.length
            ? values.map(
                (v) => html`<button
                  class="value-row hv-browse-row ${isOn(v.value) ? 'selected' : ''}"
                  data-testid=${`sidebar-${section}-row`}
                  data-value=${v.value}
                  aria-pressed=${String(isOn(v.value))}
                  tabindex="-1"
                  @click=${() => {
                    this._holdFacetStop(section, facetRowKey(section, v.value));
                    onPick(v.value);
                  }}
                >
                  <span class="hv-browse-row-lead ${isOn(v.value) ? '' : 'placeholder'}"
                    >${icon('check', 15)}</span
                  >
                  <!-- The title is the only place a clipped value reads in full. -->
                  <span class="label hv-browse-row-label" title=${v.value}>${v.value}</span>
                  <!-- With a filter on, matches over total, as the location rows read. -->
                  <span class="hv-tally"
                    >${v.matching_count === undefined
                      ? v.count
                      : `${v.matching_count} / ${v.count}`}</span
                  >
                </button>`,
              )
            : html`<div class="section-empty" data-testid=${`sidebar-${section}-empty`}>
                ${section === 'tags'
                  ? t('hv.fullView.noTagsYet')
                  : t('hv.fullView.noCategoriesYet')}
              </div>`
          : null}
      </div>
    `;
  }

  private _renderSidebar() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const distinct = st?.distinctValuesCache;
    const selectedTags = new Set(filters.tags);
    const selectedCategories = new Set(filters.categories);
    return html`
      <div class="sidebar" data-testid="full-sidebar">
        <div class="sidebar-head">
          ${this._renderSectionToggle('locations', t('hv.field.locations'))}
          <span class="section-tally" data-testid="sidebar-locations-tally">
            ${countLocations(st?.locationTreeCache ?? [])}
          </span>
          ${this._renderNewButton('sidebar-new-location', t('hv.fullView.newLocation'), () => {
            this._creatingLocation = !this._creatingLocation;
            this._locationError = null;
            // Nowhere to put the field if the section is shut.
            if (this._creatingLocation) this._sections = { ...this._sections, locations: true };
          })}
        </div>
        <div id=${sectionPanelId('locations')} ?hidden=${!this._sections.locations}>
          ${this._sections.locations ? this._renderLocationSection() : null}
        </div>
        ${this._renderStatusSection()}
        ${this._renderFacetSection(
          'categories',
          t('hv.field.categories'),
          distinct?.categories ?? [],
          (v) => selectedCategories.has(v),
          (v) =>
            this.store?.setFilters({
              categories: selectedCategories.has(v)
                ? filters.categories.filter((c) => c !== v)
                : [...filters.categories, v],
            }),
        )}
        ${this._renderFacetSection(
          'tags',
          t('hv.field.tags'),
          distinct?.tags ?? [],
          (v) => selectedTags.has(v),
          (v) =>
            this.store?.setFilters({
              tags: selectedTags.has(v) ? filters.tags.filter((t) => t !== v) : [...filters.tags, v],
            }),
          filters.tags.length > 1 ? this._renderTagsMode(filters.tagsMode) : null,
        )}
      </div>
    `;
  }

  /** The location selection after picking `id`, as a facet row toggles; "All items" (null) clears it. */
  private _toggledLocations(id: string | null): string[] {
    const current = this.st?.filters.locationIds ?? [];
    if (id === null) return [];
    return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  }

  private _renderLocationSection() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    return html`
        ${this._creatingLocation
          ? html`<div class="new-location">
              <input
                data-testid="sidebar-new-location-name"
                placeholder=${t('hv.fullView.newLocationName')}
                aria-label=${t('hv.fullView.newLocationName')}
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
                ${t('hv.card.addShort')}
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
          .selectedIds=${filters.locationIds}
          .orphansSelected=${filters.orphansOnly}
          .areas=${st?.areasCache?.areas ?? []}
          .selectedAreaId=${filters.areaId}
          areaSelectable
          showAll
          showOrphans
          showCounts
          .totalCount=${st?.statsCounts?.items_total ?? null}
          .orphanCount=${st?.statsCounts?.no_location_count ?? null}
          .matchingTotalCount=${st?.locationMatchTotal ?? null}
          @select=${(e: CustomEvent) =>
            this.store?.setFilters({
              locationIds: this._toggledLocations((e.detail as { locationId: string | null }).locationId),
              orphansOnly: false,
            })}
          @select-orphans=${() => this.store?.setFilters({ locationIds: [], orphansOnly: true })}
          @select-area=${(e: CustomEvent) =>
            this.store?.setFilters({
              areaId: (e.detail as { areaId: string }).areaId,
              locationIds: [],
              orphansOnly: false,
            })}
        ></hv-location-tree>
    `;
  }

  /** The phone panel's head row, as the card's filter sheet has. */
  private _renderPanelHead(filters: StoreFilters) {
    return renderFilterHead({
      rowClass: 'panel-head',
      testids: { row: 'full-panel-head', count: 'full-panel-count', clear: 'full-panel-clear' },
      staged: activeFilterCount(this._stagedFilters ?? filters),
      onClear: () => this._panel()?.clearAll(),
    });
  }

  // Resolved per click: on the render that first draws the panel it does not exist yet.
  private _panel() {
    return this.renderRoot?.querySelector<HVFilterPanel>('[data-testid="full-filter-panel"]');
  }

  /** The phone panel's commit row, without which its staged edits have no way out. */
  private _renderPanelFoot() {
    const panel = this._panel.bind(this);
    return renderStagedFooter({
      prefix: 'full-panel',
      rowClass: 'panel-foot',
      rowTestid: 'full-panel-foot',
      cancelClass: 'hv-text-button',
      applyClass: 'hv-pill',
      lead: html`<span class="spacer"></span>`,
      stagedCount: this._stagedCount,
      panel,
      onCancel: () => {
        panel()?.resetDraft();
        this._filtersOpen = false;
        this._stagedFilters = null;
      },
    });
  }

  private _renderEmpty() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    return renderEmptyState(emptyKindFor(this.st), {
      locationName: (st?.locationsFlatCache ?? []).find((l) => l.id === soleLocationId(filters))?.name ?? null,
      onAction: (id: EmptyOffer['id']) => {
        if (id === 'clear-filters') this.store?.clearFilters();
        else if (id === 'add-item') this._leaveEditor('new');
        else if (id === 'refresh') void this.store?.refreshAll();
        else this._menuAction({ id });
      },
    });
  }

  private _renderContextBar() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const locations = st?.locationsFlatCache ?? [];
    // "No location" is its own answer, so the crumb has no path to mark.
    const loc = filters.orphansOnly ? undefined : locations.find((l) => l.id === soleLocationId(filters));
    const parts = locationPathParts(loc, locations, st?.areasCache?.areas ?? [], '');
    const segments = parts.path ? parts.path.split(PATH_SEPARATOR) : [];
    const filterCount = activeFilterCount(filters);

    return html`
      <div class="context">
        <!-- The chip sits outside the text, or it would read as the first segment. -->
        <span class="crumb hv-chip-line" data-testid="full-breadcrumb" title=${pathTitle(parts)}>
          ${renderAreaChip(areaMarkName(parts.areaName, parts.path))}
          <span class="hv-chip-line-text">
            ${filters.orphansOnly
              ? html`<span class="current">${t('hv.term.noLocation')}</span>`
              : segments.length
                ? segments.map((seg, i) =>
                    i === segments.length - 1
                      ? html`<span class="current">${seg}</span>`
                      : html`<span>${seg} › </span>`,
                  )
                : html`<span class="current">${t('hv.tree.allItems')}</span>`}${st?.total !== null &&
            st?.total !== undefined
              ? html` · ${counted(st.total, 'item')}`
              : null}
          </span>
        </span>
        <!-- One flex item, so the chips and buttons wrap to the next line together. -->
        <span class="context-actions">
          ${filterCount > 0
            ? renderFilterChips(st, {
                setFilters: (patch) => this.store?.setFilters(patch),
                clearFilters: () => this.store?.clearFilters(),
              })
            : null}
          <button
            class="filters-button ${this._filtersOpen ? 'on' : ''}"
            data-testid="full-filters-toggle"
            aria-expanded=${String(this._filtersOpen)}
            aria-controls=${FILTER_PANEL_ID}
            @click=${() => {
              this._filtersOpen = !this._filtersOpen;
              // The phone panel stages its edits and counts them from the start.
              this._stagedFilters = this._filtersOpen && this._viewport.narrow ? filters : null;
              if (this._filtersOpen && this._viewport.narrow) this._priceStaged(filters);
            }}
          >
            ${icon('tune', 16)}${t('hv.card.filters')}
          </button>
          <!-- Not on a phone, where the row has no room and the ⋮ menu offers Columns. -->
          ${this._viewport.narrow
            ? null
            : html`<button
                class="hv-icon-button"
                data-testid="columns-expanded"
                aria-label=${t('hv.fullView.chooseColumns')}
                title=${t('hv.fullView.chooseColumns')}
                @click=${() => this._menuAction({ id: 'columns' })}
              >
                ${icon('viewColumn', 20)}
              </button>`}
        </span>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;
    const z = this._zBase || 9998;
    const modal = !this.embedded;

    return html`
      ${modal
        ? html`<div
            class="backdrop"
            role="presentation"
            style="z-index: ${z};"
            @click=${() => this._leaveEditor('close')}
          ></div>`
        : null}
      <div
        class="shell"
        role=${ifDefined(modal ? 'dialog' : undefined)}
        aria-modal=${ifDefined(modal ? 'true' : undefined)}
        aria-label=${this.heading}
        data-testid="full-view"
        style=${modal ? `z-index: ${z + 1};` : ''}
        @keydown=${modal ? onEscape(() => this._leaveEditor('close')) : nothing}
      >
        ${modal ? html`<span class="sentinel" tabindex="0" @focus=${() => this._focusLast()}></span>` : null}
        ${this._selecting ? this._renderSelectionBar() : this._renderAppBar()}
        ${this._renderBody()}
        ${modal ? html`<span class="sentinel" tabindex="0" @focus=${() => this._focusFirst()}></span>` : null}
      </div>
    `;
  }

  private _renderSelectionBar() {
    const st = this.st;
    const selected = st?.selection.size ?? 0;
    const total = st?.total ?? null;
    const loaded = st?.items.length ?? 0;
    const canLoadMore = total !== null && loaded < total;

    return html`
      <div class="appbar selecting" data-testid="selection-bar">
        <button
          class="tap"
          data-testid="exit-selection"
          aria-label=${t('hv.fullView.exitSelection')}
          @click=${() => this._exitSelection()}
        >
          ${icon('close', 20)}
        </button>
        <span class="count" data-testid="selection-count"
          >${t('hv.fullView.selectedCount', { count: selected })}</span
        >
        ${total !== null
          ? html`<span class="subcount" data-testid="selection-subcount"
              >${t('hv.fullView.ofMatching', { total })}</span
            >`
          : null}
        ${canLoadMore
          ? html`<button
              class="ghost load-all"
              data-testid="selection-load-all"
              ?disabled=${this._loadingAll}
              @click=${async () => {
                this._loadingAll = true;
                try {
                  await this.store?.loadAllThenSelectAll();
                } finally {
                  this._loadingAll = false;
                }
              }}
            >
              ${this._loadingAll
                ? t('hv.fullView.loading')
                : t('hv.fullView.loadAll', { total })}
            </button>`
          : null}
        <button
          class="ghost plain clear"
          data-testid="selection-clear"
          ?disabled=${selected === 0}
          @click=${() => this.store?.clearSelection()}
        >
          ${t('hv.fullView.clearSelection')}
        </button>
      </div>
    `;
  }

  /**
   * The way back to Home Assistant's collapsed sidebar, which a panel must offer
   * itself. `home-assistant-main` toggles the drawer on a composed `hass-toggle-menu`.
   */
  private _renderMenuButton() {
    if (!this.narrow) return null;
    return html`<button
      class="tap"
      data-testid="panel-menu"
      aria-label=${t('hv.fullView.openMenu')}
      title=${t('hv.fullView.menu')}
      @click=${() => this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true }))}
    >
      ${icon('menu', 20)}
    </button>`;
  }

  /**
   * The app bar prices only derived exceptions (low, overdue, inspection due,
   * checked out), which share its fixed hues. A household colours its own
   * statuses, so those live in the sidebar and the chips instead.
   */
  private _renderAppBar() {
    const st = this.st;
    const counts = st?.statsCounts;
    // The narrow branch dresses these same controls its own way, on its own
    // breakpoint, so the measured steps stand aside for it.
    const steps = this._viewport.narrow ? '' : this._barSteps;
    const addLabelClass = steps.includes('tight') ? 'add-label hv-sr-only' : 'add-label';
    const badges = renderStatBadges(st, this.quickFilters, {
      prefix: 'full-badge',
      // A blue bar has no blue to spare, so the checked-out pill takes no hue.
      chipClass: (tone) => (tone === 'state' ? 'pill' : `pill ${tone}`),
      setFilters: (patch) => this.store?.setFilters(patch),
    });
    return html`
        <div class="appbar ${steps}">
          ${this.embedded
            ? this._renderMenuButton()
            : html`<button
                class="tap"
                data-testid="expand-toggle"
                aria-label=${t('hv.fullView.close')}
                @click=${() => this._leaveEditor('close')}
              >
                ${icon('close', 20)}
              </button>`}
          <h2>${this.heading}</h2>
          ${renderSearch({
            testid: 'full-search',
            draft: this._searchDraft,
            total: counts?.items_total ?? null,
            onInput: (q) => {
              this._searchDraft = q;
              this._emitSearch(q);
            },
          })}
          <!-- No strip when nothing is flagged: an empty one still takes a gap. -->
          ${badges?.any
            ? html`<div class="pills" data-testid="full-pills">${badges.pills}</div>`
            : null}
          <!-- A phone's first row only fits the short label, and a tight bar
               draws the icon alone; the accessible name is always the full one. -->
          <button
            class="add"
            data-testid="full-add-item"
            aria-label=${t('hv.card.addItem')}
            title=${t('hv.card.addItem')}
            @click=${() => this._leaveEditor('new')}
          >
            ${icon('plus', 16)}<span class=${addLabelClass}
              >${t(this._viewport.narrow ? 'hv.card.addShort' : 'hv.card.addItem')}</span
            >
          </button>
          <button
            class="tap"
            data-testid="full-organize"
            aria-label=${t('hv.organize.title')}
            title=${t('hv.organize.title')}
            @click=${() => this._menuAction({ id: 'organize' })}
          >
            ${icon('mapMarker', 20)}
          </button>
          <hv-overflow-menu
            onPrimary
            data-testid="full-overflow"
            .entries=${this.menuEntries}
            @select=${(e: CustomEvent) => {
              if ((e.detail as { id: string }).id === 'select-items') this._selecting = true;
              else this._menuAction(e.detail);
            }}
          ></hv-overflow-menu>
        </div>
    `;
  }

  private _renderBody() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const loaded = st?.items.length ?? 0;
    const selection = st?.selection ?? new Set<string>();

    return html`
        <div class="body">
          ${this._renderSidebar()}
          <div class="main">
            ${this._renderContextBar()}
            <!-- A save failure is the open form's to say; everything else is this queue's. -->
            ${renderDegradedBanners(st, this._bannerHooks)} ${renderErrorBanners(st, this._bannerHooks)}
            <div class="panel-holder" id=${FILTER_PANEL_ID} ?hidden=${!this._filtersOpen}>
              ${this._filtersOpen
                ? html`
                  ${this._viewport.narrow ? this._renderPanelHead(filters) : null}
                  <div class="panel-scroll">
                  ${renderFilterPanel(st, {
                    testid: 'full-filter-panel',
                    mobile: this._viewport.narrow,
                    setFilters: (patch) => this.store?.setFilters(patch),
                    clearFilters: () => this.store?.clearFilters(),
                    onStage: (staged) => {
                      this._stagedFilters = staged;
                      this._priceStaged(staged);
                    },
                    onApply: (applied) => {
                      this.store?.setFilters(applied);
                      this._filtersOpen = false;
                      this._stagedFilters = null;
                    },
                  })}
                  </div>
                  ${this._viewport.narrow ? this._renderPanelFoot() : null}
                `
                : null}
            </div>
            ${this._workspace.editing !== null
              ? html`<div class="editor-holder">
                  ${this._workspace.editing !== 'new' &&
                  !st?.items.some((i) => i.id === this._workspace.editing)
                    ? html`<p class="pinned-hint" data-testid="pinned-editor-hint">
                        ${t('hv.list.noLongerMatches')}
                      </p>`
                    : null}
                  ${this._workspace.renderEditor({
                    testid: 'full-editor',
                    mobile: this._viewport.narrow,
                  })}
                </div>`
              : null}

            ${this._selecting && st?.total !== null && st?.total !== undefined && loaded < st.total
              ? html`<div class="honesty" data-testid="selection-honesty">
                  ${t('hv.fullView.selectionHonesty', { loaded, total: st.total })}
                </div>`
              : null}

            <hv-data-table
              .statuses=${this.st?.statuses ?? null}
              .areas=${st?.areasCache?.areas ?? []}
              .media=${this._workspace.media}
              data-testid="full-table"
              .items=${(st?.items ?? []) as Item[]}
              .columns=${this.columns}
              .sort=${filters.sort as Sort}
              ?selectable=${this._selecting}
              ?narrow=${this._viewport.narrow}
              .selection=${selection}
              @sort-change=${(e: CustomEvent) => this.store?.setFilters({ sort: (e.detail as { sort: Sort }).sort })}
              @near-end=${(e: CustomEvent) =>
                void this.store?.prefetchIfNeeded((e.detail as { ratio: number }).ratio)}
              @increment=${(e: CustomEvent) => this._workspace.onRowEvent('increment', e.detail)}
              @decrement=${(e: CustomEvent) => this._workspace.onRowEvent('decrement', e.detail)}
              @edit=${(e: CustomEvent) => this._workspace.onRowEvent('edit', e.detail)}
              @open-item=${(e: CustomEvent) => this._workspace.onRowEvent('open-item', e.detail)}
              @row-action=${(e: CustomEvent) => this._workspace.onRowAction(e.detail)}
              @toggle-select=${(e: CustomEvent) =>
                this.store?.toggleSelected((e.detail as { itemId: string }).itemId)}
              @select-all-loaded=${() => this.store?.selectAllLoaded()}
              @clear-selection=${() => this.store?.clearSelection()}
            >
              <div slot="empty">${this._renderEmpty()}</div>
            </hv-data-table>

            ${this._selecting
              ? html`<hv-bulk-bar
                  data-testid="full-bulk-bar"
                  .areas=${st?.areasCache?.areas ?? []}
                  .selectedCount=${selection.size}
                  .selectedItems=${this._selectedItems}
                  .locationTree=${st?.locationTreeCache ?? []}
                  .distinct=${st?.distinctValuesCache ?? null}
                  .progress=${this._bulkProgress}
                  .result=${this._bulkResult}
                  @run=${this._onBulkRun}
                  @cancel-run=${() => {
                    this._bulkCancelled = true;
                  }}
                  @dismiss-result=${() => {
                    this._bulkResult = null;
                  }}
                  @retry-failed=${() => {
                    const failed = this._bulkResult?.failed ?? [];
                    if (!this._lastOps || !failed.length) return;
                    // Rebuild rather than replay: an op_id must never be reused.
                    void this._execute({
                      label: this._lastOps.label,
                      ops: failed.map((f) => makeBulkOp(f.op.kind, { ...f.op.payload })),
                    });
                  }}
                ></hv-bulk-bar>`
              : null}

            <div class="footer" data-testid="full-footer">
              ${showingCount(loaded, st?.total, activeFilterCount(filters) > 0)}${st?.cursor
                ? t('hv.fullView.scrollToLoadMore')
                : ''}
            </div>
          </div>
        </div>

        <hv-confirm
          data-testid="bulk-confirm"
          ?open=${this._pendingDelete}
          ?mobile=${this._viewport.narrow}
          .heading=${t('hv.fullView.deleteHeading', {
            items: counted(selection.size, 'item'),
          })}
          .message=${t('hv.fullView.deleteMessage')}
          .warning=${this._checkedOutWarning}
          .confirmLabel=${t('hv.fullView.deleteConfirm', { count: selection.size })}
          destructive
          @confirm=${() => {
            this._pendingDelete = false;
            void this._execute(this._opsFor({ action: 'delete' }, this._selectedItems));
          }}
          @cancel=${() => {
            this._pendingDelete = false;
          }}
        ></hv-confirm>

        ${this._viewport.narrow
          ? this._workspace.renderDetailSheet({ testid: 'full-detail-sheet' })
          : null}

        ${this._workspace.renderCheckoutPopover({
          testid: 'full-checkout',
          mobile: this._viewport.narrow,
        })}

        <!-- Anchored to nothing, so centred and scrimmed like the bulk confirm. -->
        <hv-checkout-popover
          data-testid="full-bulk-checkout"
          ?open=${this._pendingBulkCheckout}
          ?touch=${this._viewport.narrow}
          .itemName=${counted(selection.size, 'item')}
          @check-out=${(e: CustomEvent) => {
            const { dueDate } = e.detail as { dueDate: string | null };
            this._pendingBulkCheckout = false;
            void this._execute(this._opsFor({ action: 'check-out', dueDate }, this._selectedItems));
          }}
          @cancel=${() => {
            this._pendingBulkCheckout = false;
          }}
        ></hv-checkout-popover>
    `;
  }

  /** Extra warning for a bulk delete that would remove checked-out items. */
  private get _checkedOutWarning(): string | null {
    const out = this._selectedItems.filter((i) => i.checked_out).length;
    if (!out) return null;
    return tn('hv.fullView.checkedOutWarning', out);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-full-view': HVFullView;
  }
}

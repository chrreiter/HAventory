import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { onEscape } from '../ui/keyboard';
import { icon } from '../ui/icons';
import { t } from '../i18n';
import { counted, showingCount } from '../ui/plural';
import { nextZBase } from '../utils/zindex';
import { activeFilterCount, defaultFilters, soleLocationId } from '../store/store';
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
  renderStagedFooter,
  sheetHead,
} from '../ui/filter-chrome';
import { ViewportNarrow } from '../ui/responsive';
import { ItemWorkspace } from '../item-workspace';
import { emitter } from '../events';
import type { HvEvent, MenuActionDetail } from '../events';
import type { EmptyOffer } from '../ui/empty-state';
import type { Store } from '../store/store';
import type { ColumnKey } from '../store/columns';
import type { StoreFilters, StoreState } from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import './hv-data-table';
import './hv-full-app-bar';
import './hv-full-bulk';
import './hv-full-sidebar';
import type { HVItemEditor } from './hv-item-editor';
import type { HVFullAppBar } from './hv-full-app-bar';
import type { SidebarSection } from './hv-full-sidebar';
import type { HVFilterPanel } from './hv-filter-panel';

/** What the context bar's Filters button discloses, on the same terms. */
const FILTER_PANEL_ID = 'full-view-filter-panel';

/**
 * The expanded workspace: a coloured app bar, a sidebar of locations and
 * facets with the backend's counts, and the item table.
 */
@customElement('hv-full-view')
export class HVFullView extends LitElement {
  static override styles = [
    tokens,
    base,
    chip,
    bannerStack,
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
      .honesty {
        padding: 10px 20px;
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
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
        /* The sidebar's own :host display loses to this outer rule. */
        .sidebar {
          display: none;
        }
        /* On the shell so the table and the context bar get touch sizing too. */
        .shell {
          --hv-tap-min: 44px;
          --hv-input-font: 16px;
        }
        .filters-button {
          min-height: var(--hv-tap-min, auto);
        }
        /*
         * The panel pads its own sides by 16px when mobile, on top of the
         * holder's 20px, which left its content 16px right of the heading and
         * the divider above it. The scroll box reaches back over that 16px, so
         * the content starts at the heading's edge and the applied chip's ring
         * (it draws 3px outside its box) still has room inside the box.
         */
        .panel-scroll {
          margin-inline: -16px;
        }
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
    requestDelete: (detail) => this._emit('request-delete', detail),
    drawsSheet: () => this._viewport.narrow,
  });

  private readonly _emit = emitter<'hv-full-view'>(this);

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
  /** Every section starts open; collapsing one sticks for the session. */
  @state() private _sections: Record<SidebarSection, boolean> = {
    locations: true,
    status: true,
    categories: true,
    tags: true,
  };
  /**
   * True on a phone-width viewport (`NARROW_QUERY`), for the children that take
   * their layout from a `mobile` property. Leaving it drops the phone panel's draft.
   */
  private readonly _viewport = new ViewportNarrow(this, () => {
    this._stagedFilters = null;
  });
  /** The staged filter set's match count, for the phone footer's button. */
  @state() private _stagedCount: number | null = null;
  /** The phone panel's staged filter set, which its head row counts. */
  @state() private _stagedFilters: StoreFilters | null = null;
  @state() private _selecting = false;

  private _prevFocus: HTMLElement | null = null;

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  /** Price a staged (not yet applied) filter set, so the footer can be honest. */
  private _priceStaged = priceStaged(
    () => this.store,
    (count) => {
      this._stagedCount = count;
    },
  );

  protected override willUpdate(changed: Map<string, unknown>) {
    this._workspace.syncPinnedItem();
    if (changed.has('open')) {
      if (this.open) {
        this._zBase = nextZBase();
        this._prevFocus = (document.activeElement as HTMLElement) ?? null;
        this._selecting = this.startSelecting;
      } else {
        this._filtersOpen = false;
        this._stagedFilters = null;
        this._workspace.setEditing(null);
        this._workspace.closeDetail();
        this._selecting = false;
      }
    }
  }

  protected override updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) {
        // Embedded there is no trap, and focusing the search would raise a
        // phone's keyboard over the list on plain navigation.
        // The first control is the bar's close button, in a shadow root that has
        // not drawn when this runs, so focus waits for the bar's render.
        if (!this.embedded) {
          void this._bar?.updateComplete.then(() => {
            if (this.open) this._focusFirst();
          });
        }
      } else if (this._prevFocus?.isConnected) {
        this._prevFocus.focus();
      }
    }
  }

  private _close = () => {
    this.open = false;
    this._emit('close');
  };

  private get _bar(): HVFullAppBar | null {
    return this.shadowRoot?.querySelector('hv-full-app-bar') ?? null;
  }

  private get _editor(): HVItemEditor | null {
    return this.shadowRoot?.querySelector('hv-item-editor') ?? null;
  }

  /** Hand an action to the host's `HostSurfaces`, as its ⋮ menu entries do. */
  private _menuAction(detail: MenuActionDetail) {
    this._emit('menu-action', detail);
  }

  /** What the shared banner stacks act through; Refresh is the host's menu action. */
  private get _bannerHooks(): BannerHooks {
    return {
      store: this.store,
      onRefresh: () => this._menuAction({ id: 'refresh' }),
      onLatestShown: (itemId) => this._workspace.showLatest(itemId),
      drawnElsewhere: (entry) => this._workspace.drawsInSheet(entry),
    };
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

  /** Show an item: the read sheet on a phone, the inline form where the table already reads it. */
  private _openItem(id: string) {
    if (this._viewport.narrow) {
      this._workspace.openDetail(id);
      return;
    }
    this._leaveEditor(id);
  }

  private _exitSelection() {
    this._selecting = false;
    this.store?.clearSelection();
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
    return this.renderRoot?.querySelector<HVFilterPanel>('hv-filter-panel');
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
            ${
              filters.orphansOnly
                ? html`<span class="current">${t('hv.term.noLocation')}</span>`
                : segments.length
                  ? segments.map((seg, i) =>
                      i === segments.length - 1
                        ? html`<span class="current">${seg}</span>`
                        : html`<span>${seg} › </span>`,
                    )
                  : html`<span class="current">${t('hv.tree.allItems')}</span>`
            }${st?.total !== null && st?.total !== undefined ? html` · ${counted(st.total, 'item')}` : null}
          </span>
        </span>
        <!-- One flex item, so the chips and buttons wrap to the next line together. -->
        <span class="context-actions">
          ${
            filterCount > 0
              ? renderFilterChips(st, {
                  setFilters: (patch) => this.store?.setFilters(patch),
                  clearFilters: () => this.store?.clearFilters(),
                })
              : null
          }
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
          ${
            this._viewport.narrow
              ? null
              : html`<button
                class="hv-icon-button"
                data-testid="columns-expanded"
                aria-label=${t('hv.fullView.chooseColumns')}
                title=${t('hv.fullView.chooseColumns')}
                @click=${() => this._menuAction({ id: 'columns' })}
              >
                ${icon('viewColumn', 20)}
              </button>`
          }
        </span>
      </div>
    `;
  }

  override render() {
    if (!this.open) return null;
    const z = this._zBase || 9998;
    const modal = !this.embedded;

    return html`
      ${
        modal
          ? html`<div
            class="backdrop"
            role="presentation"
            style="z-index: ${z};"
            @click=${() => this._leaveEditor('close')}
          ></div>`
          : null
      }
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
        <hv-full-app-bar
          .store=${this.store}
          .heading=${this.heading}
          .quickFilters=${this.quickFilters}
          .menuEntries=${this.menuEntries}
          .embedded=${this.embedded}
          .narrow=${this.narrow}
          .mobile=${this._viewport.narrow}
          .selecting=${this._selecting}
          @request-close=${(e: HvEvent<'hv-full-app-bar', 'request-close'>) => {
            e.stopPropagation();
            this._leaveEditor('close');
          }}
          @add-item=${(e: HvEvent<'hv-full-app-bar', 'add-item'>) => {
            e.stopPropagation();
            this._leaveEditor('new');
          }}
          @select-items=${(e: HvEvent<'hv-full-app-bar', 'select-items'>) => {
            e.stopPropagation();
            this._selecting = true;
          }}
          @exit-selection=${(e: HvEvent<'hv-full-app-bar', 'exit-selection'>) => {
            e.stopPropagation();
            this._exitSelection();
          }}
          @menu-action=${(e: HvEvent<'hv-full-app-bar', 'menu-action'>) => {
            e.stopPropagation();
            this._menuAction(e.detail);
          }}
        ></hv-full-app-bar>
        ${this._renderBody()}
        ${modal ? html`<span class="sentinel" tabindex="0" @focus=${() => this._focusFirst()}></span>` : null}
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
          <hv-full-sidebar
            class="sidebar"
            data-testid="full-sidebar"
            .store=${this.store}
            .sections=${this._sections}
            @organize=${(e: HvEvent<'hv-full-sidebar', 'organize'>) => {
              e.stopPropagation();
              this._menuAction({ id: 'organize', tab: e.detail.tab });
            }}
            @toggle-section=${(e: HvEvent<'hv-full-sidebar', 'toggle-section'>) => {
              e.stopPropagation();
              const { section, open } = e.detail;
              this._sections = { ...this._sections, [section]: open };
            }}
          ></hv-full-sidebar>
          <div class="main">
            ${this._renderContextBar()}
            <!-- A save failure is the open form's to say; everything else is this queue's. -->
            ${renderDegradedBanners(st, this._bannerHooks)} ${renderErrorBanners(st, this._bannerHooks)}
            ${this._workspace.renderDeletedNotice()}
            <div class="panel-holder" id=${FILTER_PANEL_ID} ?hidden=${!this._filtersOpen}>
              ${
                this._filtersOpen
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
                  : null
              }
            </div>
            ${
              this._workspace.editing !== null
                ? html`<div class="editor-holder">
                  ${
                    this._workspace.editing !== 'new' &&
                    !st?.items.some((i) => i.id === this._workspace.editing)
                      ? html`<p class="pinned-hint" data-testid="pinned-editor-hint">
                        ${t('hv.list.noLongerMatches')}
                      </p>`
                      : null
                  }
                  ${this._workspace.renderEditor({
                    testid: 'full-editor',
                    mobile: this._viewport.narrow,
                  })}
                </div>`
                : null
            }

            ${
              this._selecting && st?.total !== null && st?.total !== undefined && loaded < st.total
                ? html`<div class="honesty" data-testid="selection-honesty">
                  ${t('hv.fullView.selectionHonesty', { loaded, total: st.total })}
                </div>`
                : null
            }

            <hv-data-table
              .statuses=${this.st?.statuses ?? null}
              .areas=${st?.areasCache?.areas ?? []}
              .media=${this._workspace.media}
              data-testid="full-table"
              .items=${st?.items ?? []}
              .columns=${this.columns}
              .sort=${filters.sort}
              ?selectable=${this._selecting}
              ?narrow=${this._viewport.narrow}
              .selection=${selection}
              @sort-change=${(e: HvEvent<'hv-data-table', 'sort-change'>) => this.store?.setFilters({ sort: e.detail.sort })}
              @near-end=${(e: HvEvent<'hv-data-table', 'near-end'>) => void this.store?.prefetchIfNeeded(e.detail.ratio)}
              @increment=${(e: HvEvent<'hv-data-table', 'increment'>) => this._workspace.onRowEvent('increment', e.detail)}
              @decrement=${(e: HvEvent<'hv-data-table', 'decrement'>) => this._workspace.onRowEvent('decrement', e.detail)}
              @edit=${(e: HvEvent<'hv-data-table', 'edit'>) => this._workspace.onRowEvent('edit', e.detail)}
              @open-item=${(e: HvEvent<'hv-data-table', 'open-item'>) => this._workspace.onRowEvent('open-item', e.detail)}
              @row-action=${(e: HvEvent<'hv-data-table', 'row-action'>) => this._workspace.onRowAction(e.detail)}
              @toggle-select=${(e: HvEvent<'hv-data-table', 'toggle-select'>) => this.store?.toggleSelected(e.detail.itemId)}
              @select-all-loaded=${() => this.store?.selectAllLoaded()}
              @clear-selection=${() => this.store?.clearSelection()}
            >
              <div slot="empty">${this._renderEmpty()}</div>
            </hv-data-table>

            ${
              this._selecting
                ? html`<hv-full-bulk .store=${this.store} .mobile=${this._viewport.narrow}></hv-full-bulk>`
                : null
            }

            <div class="footer" data-testid="full-footer">
              ${showingCount(loaded, st?.total, activeFilterCount(filters) > 0)}${
                st?.cursor ? t('hv.fullView.scrollToLoadMore') : ''
              }
            </div>
          </div>
        </div>

        ${this._workspace.renderDetailSheet({ testid: 'full-detail-sheet', banners: this._bannerHooks })}

        ${this._workspace.renderCheckoutPopover({
          testid: 'full-checkout',
          mobile: this._viewport.narrow,
        })}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-full-view': HVFullView;
  }
}

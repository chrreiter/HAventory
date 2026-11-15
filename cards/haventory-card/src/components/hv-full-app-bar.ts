import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { t } from '../i18n';
import { renderSearch, searchBox, searchDebounce, searchDraftFor } from '../ui/filter-chrome';
import { renderStatBadges } from '../ui/stat-badges';
import { SliceWatch } from '../ui/slice-watch';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import type { QuickFilterKey } from '../ui/quick-filters';
import type { Store } from '../store/store';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import './hv-overflow-menu';

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
 * The full view's coloured bar: the app bar, or the selection bar in its place
 * while `selecting`. Both fill the same row and share their styles. It reads the
 * store for the counts and the search box and writes the pills, the search and
 * the selection to it directly; what the full view does for it (closing, adding,
 * entering and leaving selection, a menu action) is an event.
 */
@customElement('hv-full-app-bar')
export class HVFullAppBar extends LitElement {
  static override styles = [
    tokens,
    base,
    chip,
    searchBox,
    css`
      /* A grid item of the full view's shell, whose track can be wider than the
         shell when the sidebar and table floors exceed it. */
      :host {
        display: block;
        min-width: 0;
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
      /* The full view's own breakpoint: this surface is sized by the viewport,
         not the card, so a media query is the right signal. */
      @media (max-width: 700px) {
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
    `,
  ];

  @property({ attribute: false }) store!: Store;
  @property({ attribute: false }) heading = '';
  /** Which quick-filter pills this dashboard offers, or `null` for all of them. */
  @property({ attribute: false }) quickFilters: QuickFilterKey[] | null = null;
  /** Extra entries the host adds to the ⋮ menu. */
  @property({ attribute: false }) menuEntries: OverflowMenuEntry[] = [];
  /** Embedded, the bar leads with Home Assistant's menu button, not a close button. */
  @property({ attribute: false }) embedded = false;
  /** Home Assistant's narrow flag (sidebar collapsed, at any width), which draws the menu button. */
  @property({ attribute: false }) narrow = false;
  /**
   * A phone-width viewport (`NARROW_QUERY`). The phone branch dresses the add
   * button and the rows itself, so the measured steps stand aside for it.
   */
  @property({ attribute: false }) mobile = false;
  /** Draw the selection bar in place of the app bar. */
  @property({ attribute: false }) selecting = false;

  private readonly _slices = new SliceWatch(this, ['list', 'stats']);
  private readonly _emit = emitter<'hv-full-app-bar'>(this);

  @state() private _searchDraft = '';
  @state() private _loadingAll = false;
  /**
   * The width steps (`barSteps`), from the measured shell. No media query sees
   * the panel's width beside HA's sidebar, and a size container would become the
   * containing block for the `position: fixed` menus and sheets.
   */
  @state() private _barSteps = '';

  private _barObserver?: ResizeObserver;
  private readonly _emitSearch = searchDebounce(() => this.store);

  override connectedCallback(): void {
    super.connectedCallback();
    // The element the bar sits in, not the bar's own box: the shell pans sideways
    // when the sidebar and table floors exceed it, and the bar's grid track then
    // grows past what is visible.
    const shell = this.parentElement;
    if (!shell) return;
    this._barObserver = new ResizeObserver(([entry]) => {
      if (entry) this._setBarWidth(entry.contentRect.width);
    });
    this._barObserver.observe(shell);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._barObserver?.disconnect();
    this._barObserver = undefined;
  }

  private _setBarWidth(width: number) {
    const next = barSteps(width);
    if (next !== this._barSteps) this._barSteps = next;
  }

  protected override willUpdate() {
    this._searchDraft = searchDraftFor(this._searchDraft, this._slices.state?.filters.q, this._emitSearch);
  }

  override render() {
    return this.selecting ? this._renderSelectionBar() : this._renderAppBar();
  }

  private _renderSelectionBar() {
    const st = this._slices.state;
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
          @click=${() => this._emit('exit-selection')}
        >
          ${icon('close', 20)}
        </button>
        <span class="count" data-testid="selection-count"
          >${t('hv.fullView.selectedCount', { count: selected })}</span
        >
        ${
          total !== null
            ? html`<span class="subcount" data-testid="selection-subcount"
              >${t('hv.fullView.ofMatching', { total })}</span
            >`
            : null
        }
        ${
          canLoadMore
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
              ${this._loadingAll ? t('hv.fullView.loading') : t('hv.fullView.loadAll', { total })}
            </button>`
            : null
        }
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
    const st = this._slices.state;
    const counts = st?.statsCounts;
    // The narrow branch dresses these same controls its own way, on its own
    // breakpoint, so the measured steps stand aside for it.
    const steps = this.mobile ? '' : this._barSteps;
    const addLabelClass = steps.includes('tight') ? 'add-label hv-sr-only' : 'add-label';
    const badges = renderStatBadges(st, this.quickFilters, {
      prefix: 'full-badge',
      // A blue bar has no blue to spare, so the checked-out pill takes no hue.
      chipClass: (tone) => (tone === 'state' ? 'pill' : `pill ${tone}`),
      setFilters: (patch) => this.store?.setFilters(patch),
    });
    return html`
        <div class="appbar ${steps}">
          ${
            this.embedded
              ? this._renderMenuButton()
              : html`<button
                class="tap"
                data-testid="expand-toggle"
                aria-label=${t('hv.fullView.close')}
                @click=${() => this._emit('request-close')}
              >
                ${icon('close', 20)}
              </button>`
          }
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
          ${badges?.any ? html`<div class="pills" data-testid="full-pills">${badges.pills}</div>` : null}
          <!-- A phone's first row only fits the short label, and a tight bar
               draws the icon alone; the accessible name is always the full one. -->
          <button
            class="add"
            data-testid="full-add-item"
            aria-label=${t('hv.card.addItem')}
            title=${t('hv.card.addItem')}
            @click=${() => this._emit('add-item')}
          >
            ${icon('plus', 16)}<span class=${addLabelClass}
              >${t(this.mobile ? 'hv.card.addShort' : 'hv.card.addItem')}</span
            >
          </button>
          <button
            class="tap"
            data-testid="full-organize"
            aria-label=${t('hv.organize.title')}
            title=${t('hv.organize.title')}
            @click=${() => this._emit('menu-action', { id: 'organize' })}
          >
            ${icon('mapMarker', 20)}
          </button>
          <hv-overflow-menu
            onPrimary
            data-testid="full-overflow"
            .entries=${this.menuEntries}
            @select=${(e: HvEvent<'hv-overflow-menu', 'select'>) => {
              if (e.detail.id === 'select-items') this._emit('select-items');
              else this._emit('menu-action', { id: e.detail.id });
            }}
          ></hv-overflow-menu>
        </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-full-app-bar': HVFullAppBar;
  }
}

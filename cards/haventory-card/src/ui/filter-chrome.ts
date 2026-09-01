import { css, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import { t, tn } from '../i18n';
import { icon } from './icons';
import { debounce } from '../utils/debounce';
import { defaultFilters } from '../store/store';
import type { Store } from '../store/store';
import type { StoreFilters, StoreState } from '../store/types';
// Registers the elements this file emits. Kept here rather than left to each
// host, so a surface cannot render the chrome and get two unknown tags.
import '../components/hv-filter-chips';
import '../components/hv-filter-panel';
import type { HVFilterPanel } from '../components/hv-filter-panel';

/**
 * The controls that decide which items a surface is showing: the search box,
 * the applied-filter chips, the filter panel, and the head and commit rows a
 * staged panel needs around it.
 *
 * The compact card and the expanded view ask the same questions of the same
 * store, so the debounce windows, the placeholder's arithmetic and the panel's
 * four handlers are written once here. What each surface *calls* its controls
 * is a parameter — `search-input` against `full-search`, `sheet-*` against
 * `full-panel-*` — because those are what the browser harnesses locate, and one
 * renderer is what keeps them byte-identical.
 */

/** How long the search box waits for typing to stop before it filters. */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * How long a staged filter set waits before it is priced. Shorter than the
 * search window: nothing is fetched, and the number lands on a button the user
 * is already looking at.
 */
const STAGED_PRICE_MS = 150;

/**
 * Layout for the search pill and the field inside it. Hosts add this to their
 * styles and paint their own fill and gutter on it.
 */
export const searchBox = css`
  /* Takes the slack in the row it sits in, and can give it back: without the
     min-width a flex item will not shrink below its content width, and one
     that refuses to shrink pushes everything after it off the row's end. */
  .hv-search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: var(--hv-radius-chip);
  }
  /* The pill is what is drawn; the field inside it takes the same slack. */
  .hv-search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    outline: none;
    font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
  }
`;

/**
 * Layout for the head row of a sheet or a panel. Hosts add this to their styles
 * and keep their own padding on it — the card's sheet rows sit inside a 16px
 * gutter and the expanded view's panel head sits in a column that already has
 * one.
 */
export const sheetHead = css`
  .hv-sheet-head {
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--hv-row-divider);
  }
  .hv-sheet-head .heading {
    font-size: 16px;
    font-weight: 500;
    color: var(--hv-text);
  }
  .hv-sheet-head .staged {
    font-size: 12.5px;
    color: var(--hv-text-secondary);
  }
  /* The way out of the whole set sits at the far end of the row, past the two
     labels that describe it. */
  .hv-sheet-head .hv-text-button {
    margin-left: auto;
  }
`;

/**
 * The search box's write into the store, held back until typing stops.
 *
 * The store is read per call rather than captured: a host is handed one after
 * its fields are initialized.
 */
export function searchDebounce(getStore: () => Store | undefined): (q: string) => void {
  return debounce((q: string) => getStore()?.setFilters({ q }), SEARCH_DEBOUNCE_MS);
}

/**
 * Price a staged — not yet applied — filter set, so the button that commits it
 * can say what pressing it will show. Null is a store that could not answer,
 * which is what leaves the button on its uncounted wording.
 */
export function priceStaged(
  getStore: () => Store | undefined,
  set: (count: number | null) => void,
): (filters: StoreFilters) => void {
  return debounce((filters: StoreFilters) => {
    void getStore()
      ?.countMatching(filters)
      .then(set);
  }, STAGED_PRICE_MS);
}

/** What a filter control does to the store it is pointed at. */
export interface FilterActions {
  setFilters: (patch: Partial<StoreFilters>) => void;
  clearFilters: () => void;
}

export interface SearchOptions {
  /** `search-input` on the card, `full-search` in the expanded view. */
  testid: string;
  /** What the field shows; the host holds it so typing survives a redraw. */
  draft: string;
  /**
   * The whole inventory, for the placeholder — not the filtered result, and
   * null while there is no count yet. Both surfaces offer the same sentence, so
   * the box does not describe one store two ways depending on which opened it.
   */
  total: number | null;
  onInput: (q: string) => void;
}

export function renderSearch(opts: SearchOptions): TemplateResult {
  return html`<label class="hv-search search">
    ${icon('magnify', 18)}
    <span class="hv-sr-only">${t('hv.card.searchItems')}</span>
    <input
      type="search"
      data-testid=${opts.testid}
      placeholder=${opts.total === null
        ? t('hv.card.searchPlaceholder')
        : tn('hv.card.searchAllPlaceholder', opts.total)}
      .value=${opts.draft}
      @input=${(e: Event) => opts.onInput((e.target as HTMLInputElement).value)}
    />
  </label>`;
}

/** The applied filters, each with the way to take it back off. */
export function renderFilterChips(st: StoreState | null, opts: FilterActions): TemplateResult {
  return html`<hv-filter-chips
    .statuses=${st?.statuses ?? null}
    .filters=${st?.filters ?? defaultFilters()}
    .locations=${st?.locationsFlatCache ?? null}
    .areas=${st?.areasCache?.areas ?? []}
    @remove-filter=${(e: CustomEvent) =>
      opts.setFilters((e.detail as { patch: Partial<StoreFilters> }).patch)}
    @clear-filters=${opts.clearFilters}
  ></hv-filter-chips>`;
}

export interface FilterPanelOptions extends FilterActions {
  /** The expanded view names its panel; the card finds its own by tag. */
  testid?: string;
  /** Stage the edits and commit them on a button, instead of applying live. */
  mobile: boolean;
  /** A staged edit landed: the host holds it so its head row can count it. */
  onStage: (filters: StoreFilters) => void;
  /** The staged set was committed; the surface holding the panel closes. */
  onApply: (filters: StoreFilters) => void;
}

export function renderFilterPanel(st: StoreState | null, opts: FilterPanelOptions): TemplateResult {
  return html`<hv-filter-panel
    .statuses=${st?.statuses ?? null}
    data-testid=${ifDefined(opts.testid)}
    .filters=${st?.filters ?? defaultFilters()}
    .distinct=${st?.distinctValuesCache ?? null}
    .areas=${st?.areasCache?.areas ?? []}
    .locations=${st?.locationsFlatCache ?? null}
    .locationTree=${st?.locationTreeCache ?? []}
    .total=${st?.total ?? null}
    .grandTotal=${st?.statsCounts?.items_total ?? null}
    .counts=${st?.statsCounts ?? null}
    ?mobile=${opts.mobile}
    @change=${(e: CustomEvent) => opts.setFilters(e.detail as Partial<StoreFilters>)}
    @stage=${(e: CustomEvent) => opts.onStage((e.detail as { filters: StoreFilters }).filters)}
    @apply=${(e: CustomEvent) => opts.onApply(e.detail as StoreFilters)}
    @clear-filters=${opts.clearFilters}
  ></hv-filter-panel>`;
}

export interface FilterHeadOptions {
  /** The row's own class, beside the shared one. */
  rowClass: string;
  /** Per-surface test ids; the card's sheet names only its clear button. */
  testids: { row?: string; count?: string; clear: string };
  /** How many filters the staged set carries. */
  staged: number;
  onClear: () => void;
}

/**
 * The head row of a staged filter surface: what it is, how much of it is
 * staged, and the way out of all of it.
 *
 * Clear all sits here rather than beside the commit buttons because three
 * controls do not fit a 375px row in every language: German's
 * `hv.action.clearAll` takes two lines there, and the count sentence beside it
 * stacks over three.
 */
export function renderFilterHead(opts: FilterHeadOptions): TemplateResult {
  return html`<div class="hv-sheet-head ${opts.rowClass}" data-testid=${ifDefined(opts.testids.row)}>
    <span class="heading">${t('hv.card.filters')}</span>
    <span class="staged" data-testid=${ifDefined(opts.testids.count)}
      >${t('hv.card.filtersActive', { count: opts.staged })}</span
    >
    <button class="hv-text-button" data-testid=${opts.testids.clear} @click=${opts.onClear}>
      ${t('hv.action.clearAll')}
    </button>
  </div>`;
}

export interface StagedFooterOptions {
  /** `sheet` on the card, `full-panel` in the expanded view. */
  prefix: string;
  /**
   * The row and its two buttons, as each surface dresses them: the card's
   * filter sheet commits with a pair of finger-sized buttons at the foot of a
   * phone screen, the expanded view's panel with a text button and a pill.
   * `lead` is drawn before them, `slot` is how a bottom sheet takes a footer.
   */
  rowClass: string;
  rowTestid?: string;
  slot?: string;
  cancelClass: string;
  applyClass: string;
  lead?: TemplateResult;
  /** The staged set's match count, or null while it is still being counted. */
  stagedCount: number | null;
  /**
   * The panel to commit, resolved per click: on the render that first draws it
   * the element does not exist yet, so a reference captured here would leave
   * the button doing nothing.
   */
  panel: () => HVFilterPanel | null | undefined;
  onCancel: () => void;
}

/**
 * The commit row a staged panel needs under it.
 *
 * `hv-filter-panel` stages its edits when it is on a phone and drops its own
 * footer, because its host is expected to provide one. Both hosts do, in the
 * same two words and the same counted sentence.
 */
export function renderStagedFooter(opts: StagedFooterOptions): TemplateResult {
  return html`<div
    class=${opts.rowClass}
    data-testid=${ifDefined(opts.rowTestid)}
    slot=${ifDefined(opts.slot)}
  >
    ${opts.lead ?? null}
    <button class=${opts.cancelClass} data-testid=${`${opts.prefix}-cancel`} @click=${opts.onCancel}>
      ${t('hv.action.cancel')}
    </button>
    <button
      class=${opts.applyClass}
      data-testid=${`${opts.prefix}-apply`}
      @click=${() => opts.panel()?.apply()}
    >
      ${opts.stagedCount === null
        ? t('hv.card.showItems')
        : tn('hv.card.showCount', opts.stagedCount)}
    </button>
  </div>`;
}

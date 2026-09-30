import { css, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import { t, tn } from '../i18n';
import { icon } from './icons';
import { debounce } from '../utils/debounce';
import { defaultFilters } from '../store/store';
import type { Store } from '../store/store';
import type { StoreFilters, StoreState } from '../store/types';
// Registers the elements this file emits, so no host renders them unregistered.
import '../components/hv-filter-chips';
import '../components/hv-filter-panel';
import type { HVFilterPanel } from '../components/hv-filter-panel';

/**
 * The controls that decide which items a surface shows: search, applied-filter
 * chips, the filter panel and a staged panel's head and commit rows, shared by
 * the card and the expanded view; each passes its own test ids.
 */

export const SEARCH_DEBOUNCE_MS = 200;

/** Shorter than the search window: pricing a staged set fetches no rows. */
const STAGED_PRICE_MS = 150;

/** Layout for the search pill; hosts paint their own fill and gutter. */
export const searchBox = css`
  /* min-width: 0 lets the pill shrink instead of pushing the row's end off. */
  .hv-search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: var(--hv-radius-chip);
  }
  .hv-search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    outline: none;
    font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
  }
`;

/** Layout for the head row of a sheet or a panel; hosts keep their own padding. */
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
  .hv-sheet-head .hv-text-button {
    margin-left: auto;
  }
`;

/** The search box's debounced write; the store is read per call, as a host gets it late. */
export function searchDebounce(getStore: () => Store | undefined): (q: string) => void {
  return debounce((q: string) => getStore()?.setFilters({ q }), SEARCH_DEBOUNCE_MS);
}

/** Price a staged filter set for its commit button; null leaves the uncounted wording. */
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
  /** The whole inventory's count for the placeholder, null while unknown. */
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
 * The head row of a staged filter surface. Clear all sits here because three
 * controls do not fit the 375px commit row in German.
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
  /** How each surface dresses the row; `lead` goes first, `slot` is for a bottom sheet. */
  rowClass: string;
  rowTestid?: string;
  slot?: string;
  cancelClass: string;
  applyClass: string;
  lead?: TemplateResult;
  /** The staged set's match count, or null while it is still being counted. */
  stagedCount: number | null;
  /** Resolved per click: the panel does not exist yet on the render that first draws it. */
  panel: () => HVFilterPanel | null | undefined;
  onCancel: () => void;
}

/** The commit row a staged (phone) `hv-filter-panel` leaves to its host. */
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

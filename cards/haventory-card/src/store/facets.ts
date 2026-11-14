import { Coalesced, Latest } from './scheduling';
import { Slice } from './slice';
import { activeFilterCount, toWireFilter } from './filters';
import type { Run } from './connection-health';
import type { DistinctValue, DistinctValues, StoreFilters, StoreState } from './types';
import type { WSClient } from './ws';

export type FacetsSlice = Pick<StoreState, 'distinctValuesCache'>;

/**
 * The category and tag tallies the filters offer, with the values named on
 * the card that no item carries yet folded in at zero.
 */
export class Facets {
  readonly slice = new Slice<FacetsSlice>({ distinctValuesCache: null });
  private readonly facetRefresh = new Coalesced();
  private readonly latestFacetTally = new Latest();
  /** Last untouched `distinct_values` result, so drafts can be re-merged. */
  private serverDistinct: DistinctValues | null = null;
  /** Whether the last `distinct_values` answer was priced against a filter. */
  private serverDistinctPriced = false;
  /** Values named in the organize dialog that no item carries yet. */
  private drafts: { categories: string[]; tags: string[] } = { categories: [], tags: [] };

  constructor(
    private readonly ws: WSClient,
    private readonly run: Run,
    private readonly getFilters: () => StoreFilters,
  ) {}

  /** Coalesced, so a burst of events asks once. */
  scheduleRefresh(delayMs = 250) {
    this.facetRefresh.schedule(delayMs, () => void this.refresh().catch(() => undefined));
  }

  /**
   * Refresh distinct categories/tags with counts. The tallies drop both
   * dimensions from the filter, as the tree drops location, so a facet does
   * not zero its own other rows; they are priced whenever any filter is on.
   */
  async refresh() {
    const current = this.latestFacetTally.claim();
    const counting = { ...this.getFilters(), categories: [], tags: [] };
    const filtered = activeFilterCount(this.getFilters()) > 0;
    const distinct = await this.run(() =>
      this.ws.distinctValues(filtered ? toWireFilter(counting) : undefined),
    );
    if (!current()) return;
    this.serverDistinct = distinct;
    this.serverDistinctPriced = filtered;
    // A draft the backend now knows about is no longer a draft.
    const known = (list: DistinctValue[], value: string) =>
      list.some((v) => v.value.toLowerCase() === value.toLowerCase());
    this.drafts = {
      categories: this.drafts.categories.filter((v) => !known(distinct.categories, v)),
      tags: this.drafts.tags.filter((v) => !known(distinct.tags, v)),
    };
    this.publish();
  }

  /**
   * Name a category or tag before any item carries it. `distinct_values` is
   * derived from the items, so the value is held here at count 0 until an item
   * adopts it. Returns false for a blank name or one that already exists.
   */
  addDraftValue(kind: 'category' | 'tag', raw: string): boolean {
    const value = kind === 'tag' ? raw.trim().toLowerCase() : raw.trim();
    if (!value) return false;
    const key = kind === 'tag' ? 'tags' : 'categories';
    const current = this.slice.value.distinctValuesCache?.[key] ?? [];
    if (current.some((v) => v.value.toLowerCase() === value.toLowerCase())) return false;
    this.drafts = { ...this.drafts, [key]: [...this.drafts[key], value] };
    this.publish();
    return true;
  }

  /** Drop a value named here that never made it onto an item. */
  removeDraftValue(kind: 'category' | 'tag', value: string): void {
    const key = kind === 'tag' ? 'tags' : 'categories';
    this.drafts = {
      ...this.drafts,
      [key]: this.drafts[key].filter((v) => v.toLowerCase() !== value.toLowerCase()),
    };
    this.publish();
  }

  /** True while this value only exists on the card. */
  isDraftValue(kind: 'category' | 'tag', value: string): boolean {
    const key = kind === 'tag' ? 'tags' : 'categories';
    return this.drafts[key].some((v) => v.toLowerCase() === value.toLowerCase());
  }

  /** Publish the server's distinct values with the drafts folded in. */
  private publish() {
    const server = this.serverDistinct;
    if (!server) return;
    // A draft is priced in the same shape as the rows beside it.
    const draft = (value: string): DistinctValue =>
      this.serverDistinctPriced ? { value, count: 0, matching_count: 0 } : { value, count: 0 };
    const merge = (list: DistinctValue[], drafts: string[]): DistinctValue[] =>
      drafts.length
        ? [...list, ...drafts.map(draft)].sort((a, b) =>
            a.value.toLowerCase().localeCompare(b.value.toLowerCase()),
          )
        : list;
    this.slice.set({
      distinctValuesCache: {
        ...server,
        categories: merge(server.categories, this.drafts.categories),
        tags: merge(server.tags, this.drafts.tags),
      },
    });
  }

  dispose() {
    this.facetRefresh.cancel();
  }
}

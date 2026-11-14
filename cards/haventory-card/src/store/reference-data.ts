import { Coalesced, Latest } from './scheduling';
import { Slice } from './slice';
import { activeFilterCount, toWireFilter } from './filters';
import { sortLocationTree } from './location-tree';
import { onDayChange } from '../ui/day-clock';
import { normalizeQuickFilters } from '../ui/quick-filters';
import type { Run } from './connection-health';
import type {
  Location,
  StatusColorValue,
  StatusDefinition,
  StoreFilters,
  StoreState,
  Unsubscribe,
} from './types';
import type { WSClient } from './ws';

export type LocationsSlice = Pick<
  StoreState,
  'areasCache' | 'locationTreeCache' | 'locationMatchTotal' | 'locationsFlatCache'
>;
export type StatsSlice = Pick<StoreState, 'statsCounts'>;
export type ConfigSlice = Pick<
  StoreState,
  'versionInfo' | 'cardTitle' | 'quickFilters' | 'mediaConfig' | 'statuses'
>;

/**
 * The data the views read beside the list: counts, areas, the location tree
 * and flat list, the card's config and the status vocabulary.
 */
export class ReferenceData {
  readonly locationsSlice = new Slice<LocationsSlice>({
    areasCache: null,
    locationTreeCache: null,
    locationMatchTotal: null,
    locationsFlatCache: null,
  });
  readonly statsSlice = new Slice<StatsSlice>({ statsCounts: null });
  readonly configSlice = new Slice<ConfigSlice>({
    versionInfo: null,
    cardTitle: null,
    quickFilters: null,
    mediaConfig: null,
    statuses: null,
  });
  private readonly treeRefresh = new Coalesced();
  private readonly areasRefresh = new Coalesced();
  private readonly latestTree = new Latest();
  private dayChangeUnsub: Unsubscribe | null = null;

  constructor(
    private readonly ws: WSClient,
    private readonly run: Run,
    private readonly getFilters: () => StoreFilters,
    private readonly countMatching: (filters: StoreFilters) => Promise<number | null>,
  ) {}

  /** Release the timers and the day-clock watch this part holds. */
  dispose() {
    // Held by the module-level day clock, which outlives every card.
    this.dayChangeUnsub?.();
    this.dayChangeUnsub = null;
    this.treeRefresh.cancel();
    this.areasRefresh.cancel();
  }

  /**
   * Re-read the counts when the browser's day turns over. The backend's midnight
   * broadcast is the primary path; this catches a device that slept through it.
   */
  watchDayChange() {
    this.dayChangeUnsub?.();
    this.dayChangeUnsub = onDayChange(() => void this.refreshStats().catch(() => undefined));
  }

  /** Coalesce area refetches: editing a handful of areas fires one event each. */
  scheduleAreasRefresh(delayMs = 250) {
    this.areasRefresh.schedule(delayMs, () => void this.refreshAreas().catch(() => undefined));
  }

  scheduleTreeRefresh(delayMs = 250) {
    this.treeRefresh.schedule(delayMs, () => void this.refreshLocationTree().catch(() => undefined));
  }

  applyStatsCounts(counts: StatsSlice['statsCounts']) {
    this.statsSlice.set({ statsCounts: counts });
  }

  async refreshStats() {
    const counts = await this.run(() => this.ws.stats());
    this.statsSlice.set({ statsCounts: counts });
  }

  async refreshAreas() {
    const areas = await this.run(() => this.ws.listAreas());
    this.locationsSlice.set({ areasCache: areas });
  }

  async refreshVersion() {
    const info = await this.run(() => this.ws.version());
    this.configSlice.set({ versionInfo: info });
  }

  async refreshStatuses() {
    const statuses = await this.run(() => this.ws.listStatuses()).catch(() => null);
    if (statuses) this.configSlice.set({ statuses });
  }

  /** Card heading, quick-filter pills, statuses and attachment caps; all cosmetic, so a failure keeps the defaults. */
  async refreshConfig() {
    const config = await this.run(() => this.ws.config()).catch(() => null);
    const title = config?.card_title;
    if (typeof title === 'string' && title) this.configSlice.set({ cardTitle: title });
    if (config && 'quick_filters' in config) {
      this.configSlice.set({ quickFilters: normalizeQuickFilters(config.quick_filters) });
    }
    if (config?.media) this.configSlice.set({ mediaConfig: config.media });
    if (config?.statuses?.length) this.configSlice.set({ statuses: config.statuses });
  }

  /**
   * The tree's counts are measured against every filter except location, which
   * the tree itself chooses, and are priced whenever any filter is on.
   */
  async refreshLocationTree() {
    const current = this.latestTree.claim();
    const counting = {
      ...this.getFilters(),
      locationIds: [],
      includeSubtree: true,
      orphansOnly: false,
    };
    const filtered = activeFilterCount(this.getFilters()) > 0;
    const tree = await this.run(() => this.ws.getLocationTree(filtered ? toWireFilter(counting) : undefined));
    if (!current()) return;
    // The API returns insertion order; sorted once here for every consumer.
    this.locationsSlice.set({ locationTreeCache: sortLocationTree(tree) });
    // The tree covers filed items only; "No location" is this total's remainder.
    const matchTotal = filtered ? await this.countMatching(counting) : null;
    if (!current()) return;
    this.locationsSlice.set({ locationMatchTotal: matchTotal });
  }

  async refreshLocationsFlat() {
    const locs = await this.run(() => this.ws.listLocations());
    const list = locs
      .slice()
      .sort((a, b) => a.path.sort_key.localeCompare(b.path.sort_key, undefined, { sensitivity: 'base' }));
    this.locationsSlice.set({ locationsFlatCache: list });
  }

  // ---------- Locations ----------
  /** Run a location change and re-read the flat list and the tree, neither of which is pushed. */
  private async afterLocationChange<T>(call: () => Promise<T>): Promise<T> {
    const result = await this.run(call);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    return result;
  }

  async createLocation(name: string, parentId?: string | null, areaId?: string | null): Promise<Location> {
    return this.afterLocationChange(() => this.ws.createLocation(name, parentId ?? null, areaId ?? undefined));
  }

  async updateLocation(
    locationId: string,
    changes: { name?: string; areaId?: string | null; newParentId?: string | null },
  ): Promise<Location> {
    return this.afterLocationChange(() => this.ws.updateLocation(locationId, changes));
  }

  /** Delete an empty location. Rejects with validation_error when it still has children or items. */
  async deleteLocation(locationId: string): Promise<void> {
    await this.afterLocationChange(() => this.ws.deleteLocation(locationId));
  }

  /** Move a whole subtree under a new parent (null = top level). */
  async moveLocationSubtree(locationId: string, newParentId: string | null): Promise<Location> {
    return this.afterLocationChange(() => this.ws.moveLocationSubtree(locationId, newParentId));
  }

  // ---------- Status definitions ----------
  /** Run a status change and re-read the whole vocabulary, whose order is part of it. */
  private async afterStatusChange<T>(call: () => Promise<T>): Promise<T> {
    const result = await this.run(call);
    await this.refreshStatuses();
    return result;
  }

  async createStatus(status: {
    slug: string;
    label: string;
    color?: StatusColorValue;
    icon?: string;
  }): Promise<StatusDefinition> {
    return this.afterStatusChange(() => this.ws.createStatus(status));
  }

  async updateStatus(
    slug: string,
    changes: { label?: string; color?: StatusColorValue; icon?: string },
  ): Promise<StatusDefinition> {
    return this.afterStatusChange(() => this.ws.updateStatus(slug, changes));
  }

  async reorderStatuses(slugs: string[]): Promise<StatusDefinition[]> {
    return this.afterStatusChange(() => this.ws.reorderStatuses(slugs));
  }

  /** Delete a status, moving its items to `reassignTo`; returns the reassigned count. */
  deleteStatus(slug: string, reassignTo?: string) {
    return this.afterStatusChange(() => this.ws.deleteStatus(slug, reassignTo));
  }
}

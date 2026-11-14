import type {
  LiveEventPayload,
  AttachmentKind,
  BulkOperation,
  BulkOutcome,
  ExportDocument,
  HassLike,
  ImportPolicy,
  ImportPreview,
  ImportSummary,
  Item,
  ItemCreate,
  ItemFilter,
  ItemUpdate,
  Location,
  StatusColorValue,
  StatusDefinition,
  StoreFilters,
  StoreState,
} from './types';
import { WSClient } from './ws';
import { ConnectionHealth } from './connection-health';
import type { ConnectionSlice } from './connection-health';
import { opTargetId, runBulk } from './bulk';
import type { BulkOptions } from './bulk';
import { Facets } from './facets';
import { ItemList } from './item-list';
import type { ListSlice } from './item-list';
import type { FacetsSlice } from './facets';
import { ReferenceData } from './reference-data';
import type { ConfigSlice, LocationsSlice, StatsSlice } from './reference-data';
import { ErrorQueue } from './error-queue';
import type { ErrorDetails, ErrorsSlice } from './error-queue';
import { defaultFilters, sameStrings, toWireFilter } from './filters';
import { LiveSubscriptions } from './live-subscriptions';
import { combineSlices } from './slice';
import type { Observable } from './slice';

export interface StoreOptions {
  /** Base backoff for the re-subscribe ladder; set to 0 in tests. */
  retryBaseMs?: number;
}

export { activeFilterCount, defaultFilters, soleLocationId, toWireFilter } from './filters';
export type { Observable } from './slice';
export { subscribeRetryDelayMs } from './live-subscriptions';
export { BULK_CHUNK_SIZE, makeBulkOp } from './bulk';

export class Store {
  private ws: WSClient;
  private readonly errors = new ErrorQueue();
  private readonly health: ConnectionHealth;
  private readonly list: ItemList;
  private readonly facets: Facets;
  private readonly reference: ReferenceData;
  private readonly subscriptions: LiveSubscriptions;
  /** Each part's state, notified on its own; `state` reads them as one. */
  readonly slices: {
    connection: Observable<ConnectionSlice>;
    list: Observable<ListSlice>;
    errors: Observable<ErrorsSlice>;
    facets: Observable<FacetsSlice>;
    locations: Observable<LocationsSlice>;
    stats: Observable<StatsSlice>;
    config: Observable<ConfigSlice>;
  };
  private readonly combined: Observable<Readonly<StoreState>>;
  /** True once `dispose` ran, so a load still in flight wires nothing. */
  private disposed = false;

  constructor(hass: HassLike, options: StoreOptions = {}) {
    this.ws = new WSClient(hass);

    this.health = new ConnectionHealth(this.ws);
    this.list = new ItemList(this.ws, this.health.run, (err, details) => this.pushError(err, details));
    this.facets = new Facets(this.ws, this.health.run, () => this.list.slice.value.filters);
    this.reference = new ReferenceData(
      this.ws,
      this.health.run,
      () => this.list.slice.value.filters,
      (filters) => this.list.countMatching(filters),
    );
    this.subscriptions = new LiveSubscriptions(
      this.ws,
      this.health,
      (err) => this.pushError(err),
      () => this.list.slice.value.filters,
      options.retryBaseMs ?? 400,
      {
        onItemsEvent: (evt) => this.onItemsEvent(evt),
        onStatsEvent: (evt) => this.onStatsEvent(evt),
        onLocationsEvent: (evt) => this.onLocationsEvent(evt),
        onStatusesEvent: () => void this.refreshStatuses(),
        onAreasChanged: () => this.reference.scheduleAreasRefresh(),
        onRestored: () => void this.reloadAll().catch(() => undefined),
      },
    );
    const slices = {
      connection: this.health.slice,
      list: this.list.slice,
      errors: this.errors.slice,
      facets: this.facets.slice,
      locations: this.reference.locationsSlice,
      stats: this.reference.statsSlice,
      config: this.reference.configSlice,
    };
    this.slices = slices;
    this.combined = combineSlices(slices);
  }

  /** Every slice as one flat state; `onChange` fires when any of them moves. */
  get state(): Observable<Readonly<StoreState>> {
    return this.combined;
  }

  /** Watch only the named slices: a change elsewhere does not call `cb`. */
  watch(names: readonly (keyof Store['slices'])[], cb: () => void): () => void {
    const offs = names.map((name) => this.slices[name].onChange(cb));
    return () => offs.forEach((off) => off());
  }

  // ---------- Initialization and subscriptions ----------
  /**
   * Load everything, then start watching for the ways it can go stale.
   *
   * The watches are wired in a `finally`: HA rebuilds the view on reconnect
   * before a restarting instance has set the integration up, so the first load
   * can be refused wholesale, and the refused subscribe is what retries and
   * re-reads the inventory once it lands.
   */
  async init() {
    try {
      await Promise.all([
        this.refreshStats(),
        this.refreshAreas(),
        this.refreshLocationTree(),
        this.refreshLocationsFlat(),
        this.refreshDistinctValues(),
        this.refreshVersion(),
        this.refreshConfig(),
      ]);
      await this.listItems(true);
    } finally {
      // The element can be unmounted while the first load is in flight, and
      // nobody would be left to close subscriptions opened then.
      if (!this.disposed) {
        this.subscriptions.subscribeTopics();
        this.subscriptions.watchAreaRegistry();
        this.health.watchConnectionGaps(() => {
          this.reference.scheduleAreasRefresh();
          // The events fired while the socket was down went nowhere.
          void this.reloadAll().catch(() => undefined);
        });
        this.reference.watchDayChange();
      }
    }
  }

  /**
   * (Re)open the four topic subscriptions as one round. Live updates count as
   * restored only once every subscribe in the newest round has been accepted.
   */
  subscribeTopics(resetRetryBudget = true) {
    this.subscriptions.subscribeTopics(resetRetryBudget);
  }
  /** Release everything this store holds outside itself. */
  dispose() {
    this.disposed = true;
    this.subscriptions.dispose();
    this.reference.dispose();
    this.list.dispose();
    this.facets.dispose();
    this.health.dispose();
  }

  private onItemsEvent(evt: LiveEventPayload) {
    if (evt.topic !== 'items') return;
    const item = evt.item;
    if (evt.action === 'reloaded' || item === undefined) {
      // The dataset moved wholesale: refetch, and say so while it is in flight,
      // because an open editor may be holding data that no longer exists.
      this.health.setDegraded({ reloading: true });
      void this.listItems(true)
        .catch(() => undefined)
        .finally(() => this.health.setDegraded({ reloading: false }));
      void this.refreshDistinctValues().catch(() => undefined);
      this.reference.scheduleTreeRefresh();
      return;
    }
    this.list.applyItemsEvent(evt, item);
    // Coalesced: a batch edit announces one event per row, and each tally is a
    // full scan on the backend.
    if (evt.action === 'created' || evt.action === 'updated' || evt.action === 'deleted') {
      this.facets.scheduleRefresh();
    }
    // Per-location counts ride the tree, which is not pushed.
    if (evt.action === 'created' || evt.action === 'deleted' || evt.action === 'moved') {
      this.reference.scheduleTreeRefresh();
    }
  }

  private onStatsEvent(evt: LiveEventPayload) {
    if (evt.topic !== 'stats') return;
    this.reference.applyStatsCounts(evt.counts);
  }

  private onLocationsEvent(evt: LiveEventPayload) {
    if (evt.topic !== 'locations') return;
    void Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]).catch(() => undefined);
    // Moving or renaming a location rewrites every `location_path` in its subtree.
    if (evt.action === 'reloaded' || evt.action === 'moved' || evt.action === 'renamed') {
      void this.listItems(true);
    }
  }

  // ---------- Data fetchers ----------
  // Every command goes through `run`, so transport failures on any of them grade
  // the connection. The attachment family is the exception, and says why.
  async refreshStats() {
    return this.reference.refreshStats();
  }

  async refreshAreas() {
    return this.reference.refreshAreas();
  }

  /** Refresh distinct categories/tags with counts. */
  refreshDistinctValues() {
    return this.facets.refresh();
  }

  /**
   * Name a category or tag before any item carries it. Returns false for a
   * blank name or one that already exists.
   */
  addDraftValue(kind: 'category' | 'tag', raw: string): boolean {
    return this.facets.addDraftValue(kind, raw);
  }

  /** Drop a value named here that never made it onto an item. */
  removeDraftValue(kind: 'category' | 'tag', value: string): void {
    this.facets.removeDraftValue(kind, value);
  }

  /** True while this value only exists on the card. */
  isDraftValue(kind: 'category' | 'tag', value: string): boolean {
    return this.facets.isDraftValue(kind, value);
  }

  async refreshVersion() {
    return this.reference.refreshVersion();
  }

  async refreshStatuses() {
    return this.reference.refreshStatuses();
  }

  /** Card heading, quick-filter pills, statuses and attachment caps; all cosmetic, so a failure keeps the defaults. */
  async refreshConfig() {
    return this.reference.refreshConfig();
  }

  // ---------- Attachments ----------

  uploadAttachment(
    itemId: string,
    file: File,
    kind: AttachmentKind = 'picture',
    expectedVersion?: number,
  ): Promise<Item> {
    return this.list.uploadAttachment(itemId, file, kind, expectedVersion);
  }

  /** Rename one attachment for display, leaving its filename and bytes alone. */
  updateAttachment(
    itemId: string,
    attachmentId: string,
    title: string,
    expectedVersion?: number,
  ): Promise<Item> {
    return this.list.updateAttachment(itemId, attachmentId, title, expectedVersion);
  }

  /** Renumber one kind's attachments; the first id named becomes position 0. */
  reorderAttachments(
    itemId: string,
    kind: AttachmentKind,
    attachmentIds: string[],
    expectedVersion?: number,
  ): Promise<Item> {
    return this.list.reorderAttachments(itemId, kind, attachmentIds, expectedVersion);
  }

  /** Detach one file; the backend deletes the bytes with it. */
  removeAttachment(itemId: string, attachmentId: string, expectedVersion?: number): Promise<Item> {
    return this.list.removeAttachment(itemId, attachmentId, expectedVersion);
  }

  /** Sign one attachment's media path so an `<img>` can load it. */
  signMediaPath(path: string, expires: number): Promise<string> {
    return this.list.signMediaPath(path, expires);
  }

  /**
   * The tree's counts are measured against every filter except location, which
   * the tree itself chooses, and are priced whenever any filter is on.
   */
  async refreshLocationTree() {
    return this.reference.refreshLocationTree();
  }

  async refreshLocationsFlat() {
    return this.reference.refreshLocationsFlat();
  }

  // ---------- Listing & pagination ----------
  async listItems(reset = false) {
    return this.list.listItems(reset);
  }

  /** How many items a filter would match: one row asked for, `total` read off it. */
  async countMatching(filters: StoreFilters): Promise<number | null> {
    return this.list.countMatching(filters);
  }

  /** Every item matching a filter; no `limit` makes the backend return them all. */
  async listAllMatching(filter: ItemFilter): Promise<Item[]> {
    return this.list.listAllMatching(filter);
  }

  /** Load every remaining page of the current filter into the list. */
  async loadAllPages(maxPages = 200): Promise<void> {
    return this.list.loadAllPages(maxPages);
  }

  async prefetchIfNeeded(scrollRatio: number) {
    return this.list.prefetchIfNeeded(scrollRatio);
  }

  // ---------- Filters ----------
  setFilters(patch: Partial<StoreFilters>) {
    const next = { ...this.list.slice.value.filters, ...patch };
    const previous = this.list.slice.value.filters;
    const scopeChanged =
      !sameStrings(next.locationIds, previous.locationIds) || next.areaId !== previous.areaId;
    this.list.applyFilters(next);
    // The items subscription is scoped by location and area only.
    if (scopeChanged) this.subscribeTopics();
    void this.listItems(true);
    // The counts move with every filter but not with the sort.
    if (Object.keys(patch).some((key) => key !== 'sort')) {
      this.reference.scheduleTreeRefresh();
      this.facets.scheduleRefresh();
    }
  }

  /** Drop every filter, keeping the current sort. */
  clearFilters() {
    this.setFilters({ ...defaultFilters(), sort: this.list.slice.value.filters.sort });
  }

  // ---------- Selection (bulk actions) ----------
  toggleSelected(itemId: string) {
    this.list.toggleSelected(itemId);
  }

  setSelected(itemIds: Iterable<string>) {
    this.list.setSelected(itemIds);
  }

  clearSelection() {
    this.list.clearSelection();
  }

  /** The loaded rows only; `loadAllThenSelectAll` is the explicit "all matching". */
  selectAllLoaded() {
    this.list.selectAllLoaded();
  }

  /** Page in every remaining match, then select the lot. */
  async loadAllThenSelectAll(): Promise<void> {
    return this.list.loadAllThenSelectAll();
  }

  // ---------- Recovery ----------
  /** The user-triggered recovery the contract prescribes: re-read and re-subscribe. */
  async refreshAll(): Promise<void> {
    this.health.reset();
    // First, so a refused re-read still leaves the subscriptions retrying.
    this.subscribeTopics();
    await this.reloadAll();
  }

  // ---------- Optimistic writes ----------
  async createItem(input: ItemCreate) {
    return this.list.createItem(input);
  }

  async updateItem(itemId: string, changes: ItemUpdate, expectedVersion?: number) {
    return this.list.updateItem(itemId, changes, expectedVersion);
  }

  async deleteItem(itemId: string, expectedVersion?: number) {
    return this.list.deleteItem(itemId, expectedVersion);
  }

  async adjustQuantity(itemId: string, delta: number, expectedVersion?: number) {
    return this.list.adjustQuantity(itemId, delta, expectedVersion);
  }

  async setQuantity(itemId: string, quantity: number, expectedVersion?: number) {
    return this.list.setQuantity(itemId, quantity, expectedVersion);
  }

  async checkOut(itemId: string, dueDate?: string | null, expectedVersion?: number) {
    return this.list.checkOut(itemId, dueDate, expectedVersion);
  }

  async markCheckedIn(itemId: string, expectedVersion?: number) {
    return this.list.markCheckedIn(itemId, expectedVersion);
  }

  /** Not optimistic: the next occurrence is month arithmetic from the series anchor. */
  async bumpReminder(itemId: string, expectedVersion?: number) {
    return this.list.bumpReminder(itemId, expectedVersion);
  }

  async setLowStockThreshold(itemId: string, threshold: number | null, expectedVersion?: number) {
    return this.list.setLowStockThreshold(itemId, threshold, expectedVersion);
  }

  async moveItem(itemId: string, locationId: string | null, expectedVersion?: number) {
    return this.list.moveItem(itemId, locationId, expectedVersion);
  }

  // ---------- Locations ----------
  async createLocation(name: string, parentId?: string | null, areaId?: string | null): Promise<Location> {
    return this.reference.createLocation(name, parentId, areaId);
  }

  async updateLocation(
    locationId: string,
    changes: { name?: string; areaId?: string | null; newParentId?: string | null },
  ): Promise<Location> {
    return this.reference.updateLocation(locationId, changes);
  }

  /** Delete an empty location. Rejects with validation_error when it still has children or items. */
  async deleteLocation(locationId: string): Promise<void> {
    await this.reference.deleteLocation(locationId);
  }

  /** Move a whole subtree under a new parent (null = top level). Descendant paths update live. */
  async moveLocationSubtree(locationId: string, newParentId: string | null): Promise<Location> {
    const moved = await this.reference.moveLocationSubtree(locationId, newParentId);
    // Denormalized item location_path values changed for the whole subtree.
    await this.listItems(true);
    return moved;
  }

  // ---------- Status definitions ----------
  async createStatus(status: {
    slug: string;
    label: string;
    color?: StatusColorValue;
    icon?: string;
  }): Promise<StatusDefinition> {
    return this.reference.createStatus(status);
  }

  async updateStatus(
    slug: string,
    changes: { label?: string; color?: StatusColorValue; icon?: string },
  ): Promise<StatusDefinition> {
    return this.reference.updateStatus(slug, changes);
  }

  async reorderStatuses(slugs: string[]): Promise<StatusDefinition[]> {
    return this.reference.reorderStatuses(slugs);
  }

  /**
   * Delete a status, moving its items to `reassignTo`; refused while items still
   * carry it and no target is given. A reassignment re-reads items and counts.
   */
  async deleteStatus(slug: string, reassignTo?: string): Promise<number> {
    const { reassigned } = await this.reference.deleteStatus(slug, reassignTo);
    if (reassigned > 0) await Promise.all([this.listItems(true), this.refreshStats()]);
    return reassigned;
  }

  // ---------- Bulk operations ----------
  /**
   * Run a batch of item operations in chunks, reporting progress. Partial
   * failure is normal: successes persist and nothing is rolled back.
   */
  async bulkExecute(ops: BulkOperation[], opts: BulkOptions = {}): Promise<BulkOutcome> {
    const { succeeded, failed, cancelled, succeededOpIds } = await runBulk(ops, opts, {
      run: this.health.run,
      send: (chunk) => this.ws.bulk(chunk),
      apply: (item) => this.list.applyOptimistic(item),
    });

    // Deletes are not echoed as items — drop them from the list here.
    for (const op of ops) {
      if (op.kind !== 'item_delete' || !succeededOpIds.has(op.op_id)) continue;
      const id = opTargetId(op);
      if (id) this.list.removeById(id);
    }

    // Counts and per-location totals moved; refresh what the UI reads.
    void this.refreshStats().catch(() => undefined);
    void this.refreshDistinctValues().catch(() => undefined);
    this.reference.scheduleTreeRefresh();

    return { succeeded, failed, cancelled };
  }

  // ---------- Import / export (data safety) ----------
  /** Build a versioned backup document; `scope: 'view'` applies the active filter. */
  async exportDocument(scope: 'all' | 'view' = 'all'): Promise<ExportDocument> {
    return this.health.run(() =>
      this.ws.exportDocument(scope === 'view' ? toWireFilter(this.list.slice.value.filters) : undefined),
    );
  }

  /** Validate + classify an import document without mutating state. */
  async previewImport(document: unknown, policy: ImportPolicy): Promise<ImportPreview> {
    return this.health.run(() => this.ws.importPreview(document, policy));
  }

  /** Apply an import document, then reload local caches to reflect the new dataset. */
  async executeImport(document: unknown, policy: ImportPolicy): Promise<ImportSummary> {
    const summary = await this.health.run(() => this.ws.importExecute(document, policy));
    await this.reloadAll();
    return summary;
  }

  /** Refresh every derived cache and the item list (used after a wholesale import). */
  async reloadAll(): Promise<void> {
    await Promise.all([
      this.refreshStats(),
      this.refreshLocationsFlat(),
      this.refreshLocationTree(),
      this.refreshDistinctValues(),
      this.refreshConfig(),
    ]);
    await this.listItems(true);
  }

  // ---------- Errors ----------
  private pushError(err: unknown, details?: ErrorDetails) {
    this.errors.push(err, details);
  }

  dismissError(id: string) {
    this.errors.dismiss(id);
  }

  async refreshItem(itemId: string) {
    return this.list.refreshItem(itemId);
  }

  /** True when this id was removed rather than merely filtered off the page. */
  wasRemoved(itemId: string): boolean {
    return this.list.wasRemoved(itemId);
  }
}

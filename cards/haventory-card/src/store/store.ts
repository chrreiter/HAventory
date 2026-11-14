import { t } from '../i18n';
import { serverErrorText } from './server-error';
import type {
  LiveEventPayload,
  AttachmentKind,
  BulkFailure,
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
  ListItemsResult,
  Location,
  StatusColorValue,
  StatusDefinition,
  StoreFilters,
  StoreState,
} from './types';
import { WSClient } from './ws';
import { ConnectionHealth } from './connection-health';
import type { ConnectionSlice } from './connection-health';
import { Facets } from './facets';
import type { FacetsSlice } from './facets';
import { ReferenceData } from './reference-data';
import type { ConfigSlice, LocationsSlice, StatsSlice } from './reference-data';
import { ErrorQueue, errorCode } from './error-queue';
import type { ErrorDetails, ErrorsSlice } from './error-queue';
import { activeFilterCount, defaultFilters, sameStrings, toWireFilter } from './filters';
import { LiveSubscriptions } from './live-subscriptions';
import { Coalesced, Latest } from './scheduling';
import { Slice, combineSlices } from './slice';
import type { Observable } from './slice';

const PAGE_LIMIT = 50;

/** Operations per `haventory/items/bulk` call, so progress and cancel work per chunk. */
export const BULK_CHUNK_SIZE = 25;

/** Removed item ids kept for `wasRemoved`: enough to outlive a bulk delete. */
const REMOVED_ID_MEMORY = 200;

type ListSlice = Pick<StoreState, 'items' | 'cursor' | 'total' | 'loading' | 'filters' | 'selection'>;

export interface StoreOptions {
  /** Base backoff for the re-subscribe ladder; set to 0 in tests. */
  retryBaseMs?: number;
}

export { activeFilterCount, defaultFilters, soleLocationId, toWireFilter } from './filters';
export type { Observable } from './slice';
export { subscribeRetryDelayMs } from './live-subscriptions';

export class Store {
  private ws: WSClient;
  private readonly errors = new ErrorQueue();
  private readonly health: ConnectionHealth;
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
  private readonly listSlice: Slice<ListSlice>;
  private readonly combined: Observable<Readonly<StoreState>>;
  private inflight: Map<string, Promise<unknown>> = new Map();
  /** Ids removed since this store connected — see `noteRemoved`. */
  private readonly removedIds = new Set<string>();
  /** The deferred work: every one of these is cancelled by `dispose`. */
  private readonly totalRefresh = new Coalesced();
  private readonly latestTotal = new Latest();
  /** True once `dispose` ran, so a load still in flight wires nothing. */
  private disposed = false;

  constructor(hass: HassLike, options: StoreOptions = {}) {
    this.ws = new WSClient(hass);

    this.health = new ConnectionHealth(this.ws);
    this.facets = new Facets(this.ws, this.health.run, () => this.listSlice.value.filters);
    this.reference = new ReferenceData(
      this.ws,
      this.health.run,
      () => this.listSlice.value.filters,
      (filters) => this.countMatching(filters),
    );
    this.subscriptions = new LiveSubscriptions(
      this.ws,
      this.health,
      (err) => this.pushError(err),
      () => this.listSlice.value.filters,
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
    this.listSlice = new Slice<ListSlice>({
      items: [],
      cursor: null,
      total: null,
      loading: true,
      filters: defaultFilters(),
      selection: new Set<string>(),
    });
    const slices = {
      connection: this.health.slice,
      list: this.listSlice,
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
    this.totalRefresh.cancel();
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
    const items = this.state.value.items.slice();
    const loadedBefore = items.length;
    const idx = items.findIndex((x) => x.id === item.id);
    switch (evt.action) {
      case 'created':
      case 'updated':
      case 'moved':
      case 'checked_out':
      case 'checked_in':
      case 'quantity_changed': {
        // A change to a row on a page not yet loaded is not a new row: it
        // arrives with its page, in its place.
        if (idx >= 0) items[idx] = item;
        else if (evt.action === 'created' || this.state.value.cursor === null) items.unshift(item);
        this.forgetRemoved(item.id);
        break;
      }
      case 'deleted': {
        if (idx >= 0) items.splice(idx, 1);
        this.noteRemoved(item.id);
        break;
      }
    }
    // Move `total` by what the event did to the loaded list, so the footer
    // agrees at once. That is a guess: the subscription is filtered by location
    // only, so with any filter on the server is asked for the real count.
    const total = this.state.value.total;
    const delta = items.length - loadedBefore;
    this.listSlice.set(
      total !== null && delta !== 0 ? { items, total: Math.max(0, total + delta) } : { items },
    );
    if (activeFilterCount(this.state.value.filters) > 0) this.scheduleTotalRefresh();
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

  /** Coalesced, so a burst of events asks once. */
  private scheduleTotalRefresh(delayMs = 250) {
    this.totalRefresh.schedule(delayMs, () => void this.refreshTotal().catch(() => undefined));
  }

  private async refreshTotal(): Promise<void> {
    const current = this.latestTotal.claim();
    const filters = this.state.value.filters;
    const asked = JSON.stringify(toWireFilter(filters));
    const total = await this.countMatching(filters);
    // A moved filter is already answered by the `listItems` it triggered.
    if (!current() || total === null) return;
    if (JSON.stringify(toWireFilter(this.state.value.filters)) !== asked) return;
    this.listSlice.set({ total });
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

  /**
   * Take the answered item into the list and hand it back, one version on, so
   * the caller's form does not save against a stale version.
   *
   * Attachment calls skip `run`: their failures are shown per file, and an
   * upload's HTTP errors carry no code, so they would read as a lost connection.
   */
  private async applyResult(call: Promise<Item>): Promise<Item> {
    const updated = await call;
    this.applyOptimistic(updated);
    return updated;
  }

  uploadAttachment(
    itemId: string,
    file: File,
    kind: AttachmentKind = 'picture',
    expectedVersion?: number,
  ): Promise<Item> {
    return this.applyResult(this.ws.uploadAttachment(itemId, file, kind, expectedVersion));
  }

  /** Rename one attachment for display, leaving its filename and bytes alone. */
  updateAttachment(
    itemId: string,
    attachmentId: string,
    title: string,
    expectedVersion?: number,
  ): Promise<Item> {
    return this.applyResult(this.ws.updateAttachment(itemId, attachmentId, title, expectedVersion));
  }

  /** Renumber one kind's attachments; the first id named becomes position 0. */
  reorderAttachments(
    itemId: string,
    kind: AttachmentKind,
    attachmentIds: string[],
    expectedVersion?: number,
  ): Promise<Item> {
    return this.applyResult(this.ws.reorderAttachments(itemId, kind, attachmentIds, expectedVersion));
  }

  /** Detach one file; the backend deletes the bytes with it. */
  removeAttachment(itemId: string, attachmentId: string, expectedVersion?: number): Promise<Item> {
    return this.applyResult(this.ws.removeAttachment(itemId, attachmentId, expectedVersion));
  }

  /** Sign one attachment's media path so an `<img>` can load it. */
  signMediaPath(path: string, expires: number): Promise<string> {
    return this.ws.signPath(path, expires);
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
    const st = this.state.value;
    const filter = toWireFilter(st.filters);
    const sort = st.filters.sort;
    const limit = PAGE_LIMIT;
    const cursor = reset ? undefined : st.cursor || undefined;

    const key = JSON.stringify({ op: 'list', filter, sort, limit, cursor });
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;

    const p = this.health
      .run(() => this.ws.listItems(filter, sort, limit, cursor))
      .then((res: ListItemsResult) => {
        const merged = reset ? res.items : mergeUniqueById(this.state.value.items, res.items);
        this.listSlice.set({
          items: merged,
          cursor: res.next_cursor,
          total: res.total,
          loading: false,
        });
      })
      .catch((err: unknown) => {
        this.listSlice.set({ loading: false });
        this.pushError(err);
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p;
  }

  /** How many items a filter would match: one row asked for, `total` read off it. */
  async countMatching(filters: StoreFilters): Promise<number | null> {
    try {
      const res = await this.health.run(() => this.ws.listItems(toWireFilter(filters), filters.sort, 1));
      return res.total;
    } catch {
      return null;
    }
  }

  /** Every item matching a filter; no `limit` makes the backend return them all. */
  async listAllMatching(filter: ItemFilter): Promise<Item[]> {
    const res = await this.health.run(() => this.ws.listItems(filter));
    return res.items;
  }

  /** Load every remaining page of the current filter into the list. */
  async loadAllPages(maxPages = 200): Promise<void> {
    let pages = 0;
    while (this.state.value.cursor && pages < maxPages) {
      const before = this.state.value.cursor;
      await this.listItems(false);
      pages += 1;
      // A failed page leaves the cursor where it was.
      if (this.state.value.cursor === before) break;
    }
  }

  async prefetchIfNeeded(scrollRatio: number) {
    if (scrollRatio < 0.7) return;
    if (!this.state.value.cursor) return;
    await this.listItems(false);
  }

  // ---------- Filters ----------
  setFilters(patch: Partial<StoreFilters>) {
    const next = { ...this.state.value.filters, ...patch };
    const previous = this.state.value.filters;
    const scopeChanged =
      !sameStrings(next.locationIds, previous.locationIds) || next.areaId !== previous.areaId;
    // Loaded rows stay until the refetch replaces them: blanking them would tear
    // the scroller, and an open editor with it, down mid-edit.
    this.listSlice.set({ filters: next, cursor: null, loading: true, selection: new Set<string>() });
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
    this.setFilters({ ...defaultFilters(), sort: this.state.value.filters.sort });
  }

  // ---------- Selection (bulk actions) ----------
  toggleSelected(itemId: string) {
    const next = new Set(this.state.value.selection);
    if (!next.delete(itemId)) next.add(itemId);
    this.setSelected(next);
  }

  setSelected(itemIds: Iterable<string>) {
    this.listSlice.set({ selection: new Set(itemIds) });
  }

  clearSelection() {
    if (this.state.value.selection.size > 0) this.setSelected([]);
  }

  /** The loaded rows only; `loadAllThenSelectAll` is the explicit "all matching". */
  selectAllLoaded() {
    this.setSelected(this.state.value.items.map((i) => i.id));
  }

  /** Page in every remaining match, then select the lot. */
  async loadAllThenSelectAll(): Promise<void> {
    await this.loadAllPages();
    this.selectAllLoaded();
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
  /**
   * Show `patch` on the row while the call is in flight, then take the server's
   * copy, or restore the row when refused. A null `patch` means the answer
   * cannot be guessed. `details` lets a conflict banner offer the edit again.
   */
  private async optimisticWrite(
    itemId: string,
    patch: ((before: Item) => Partial<Item> | ItemUpdate) | null,
    call: () => Promise<Item>,
    details?: { itemId?: string; changes?: ItemUpdate },
  ): Promise<void> {
    const before = patch ? this.state.value.items.find((i) => i.id === itemId) : undefined;
    if (patch && before) this.applyOptimistic({ ...before, ...patch(before) } as Item);
    try {
      this.applyOptimistic(await this.health.run(call));
    } catch (err) {
      this.pushError(err, details);
      if (before) this.applyOptimistic(before);
    }
  }

  async createItem(input: ItemCreate) {
    try {
      const created = await this.health.run(() => this.ws.createItem(input));
      // The items event carries this row too, so merge by id.
      this.listSlice.set({ items: mergeUniqueById(this.state.value.items, [created]) });
    } catch (err) {
      this.pushError(err);
    }
  }

  async updateItem(itemId: string, changes: ItemUpdate, expectedVersion?: number) {
    await this.optimisticWrite(
      itemId,
      () => changes,
      () => this.ws.updateItem(itemId, changes, expectedVersion),
      { itemId, changes },
    );
  }

  async deleteItem(itemId: string, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.removeById(itemId);
    try {
      await this.health.run(() => this.ws.deleteItem(itemId, expectedVersion));
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async adjustQuantity(itemId: string, delta: number, expectedVersion?: number) {
    await this.optimisticWrite(
      itemId,
      (before) => ({ quantity: before.quantity + delta }),
      () => this.ws.adjustQuantity(itemId, delta, expectedVersion),
    );
  }

  async setQuantity(itemId: string, quantity: number, expectedVersion?: number) {
    await this.optimisticWrite(
      itemId,
      () => ({ quantity }),
      () => this.ws.setQuantity(itemId, quantity, expectedVersion),
    );
  }

  async checkOut(itemId: string, dueDate?: string | null, expectedVersion?: number) {
    await this.optimisticWrite(
      itemId,
      // No date named keeps the one the item has.
      (before) => ({ checked_out: true, due_date: dueDate ?? before.due_date }),
      () => this.ws.checkOut(itemId, dueDate, expectedVersion),
    );
  }

  async markCheckedIn(itemId: string, expectedVersion?: number) {
    await this.optimisticWrite(
      itemId,
      () => ({ checked_out: false }),
      () => this.ws.markCheckedIn(itemId, expectedVersion),
    );
  }

  /** Not optimistic: the next occurrence is month arithmetic from the series anchor. */
  async bumpReminder(itemId: string, expectedVersion?: number) {
    await this.optimisticWrite(itemId, null, () => this.ws.bumpReminder(itemId, expectedVersion));
  }

  async setLowStockThreshold(itemId: string, threshold: number | null, expectedVersion?: number) {
    await this.optimisticWrite(
      itemId,
      () => ({ low_stock_threshold: threshold }),
      () => this.ws.setLowStockThreshold(itemId, threshold, expectedVersion),
    );
  }

  async moveItem(itemId: string, locationId: string | null, expectedVersion?: number) {
    await this.optimisticWrite(
      itemId,
      () => ({ location_id: locationId }),
      () => this.ws.moveItem(itemId, locationId, expectedVersion),
    );
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
  async bulkExecute(
    ops: BulkOperation[],
    opts: {
      chunkSize?: number;
      /** Called after every chunk with cumulative counts. */
      onProgress?: (done: number, total: number, failed: number) => void;
      /** Checked between chunks; the in-flight chunk always completes. */
      isCancelled?: () => boolean;
    } = {},
  ): Promise<BulkOutcome> {
    const chunkSize = Math.max(1, opts.chunkSize ?? BULK_CHUNK_SIZE);
    const succeeded: Item[] = [];
    const failed: BulkFailure[] = [];
    const succeededOpIds = new Set<string>();
    let done = 0;
    let cancelled = false;

    for (let i = 0; i < ops.length; i += chunkSize) {
      if (opts.isCancelled?.()) {
        cancelled = true;
        break;
      }
      const chunk = ops.slice(i, i + chunkSize);
      const byId = new Map(chunk.map((op) => [op.op_id, op]));
      try {
        const { results } = await this.health.run(() => this.ws.bulk(chunk));
        for (const [opId, result] of Object.entries(results)) {
          const op = byId.get(opId);
          if (result.success) {
            succeededOpIds.add(opId);
            // `item_delete` succeeds with a null result.
            if (result.result) {
              succeeded.push(result.result);
              this.applyOptimistic(result.result);
            }
          } else if (op) {
            failed.push({ op, error: result.error ?? unknownBulkError(), itemId: opTargetId(op) });
          }
        }
        // A conforming server answers every op_id, and refuses the whole call
        // when one repeats. An op left unanswered all the same (a backend of
        // another version, a cut frame) is reported rather than dropped from
        // both lists.
        for (const op of chunk) {
          if (!(op.op_id in results)) {
            failed.push({
              op,
              error: unknownBulkError(t('hv.store.noResult')),
              itemId: opTargetId(op),
            });
          }
        }
      } catch (err) {
        // The whole call failed (envelope validation, transport). Attribute it
        // to each op in the chunk.
        const error = {
          code: errorCode(err),
          message: serverErrorText(err, t('hv.store.batchFailed')),
        };
        for (const op of chunk) failed.push({ op, error, itemId: opTargetId(op) });
      }
      done += chunk.length;
      opts.onProgress?.(done, ops.length, failed.length);
    }

    // Deletes are not echoed as items — drop them from the list here.
    for (const op of ops) {
      if (op.kind !== 'item_delete' || !succeededOpIds.has(op.op_id)) continue;
      const id = opTargetId(op);
      if (id) this.removeById(id);
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
      this.ws.exportDocument(scope === 'view' ? toWireFilter(this.state.value.filters) : undefined),
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
    try {
      this.applyOptimistic(await this.health.run(() => this.ws.getItem(itemId)));
    } catch (err) {
      this.pushError(err);
    }
  }

  // ---------- Local mutations ----------
  private applyOptimistic(item: Item) {
    const items = this.state.value.items.slice();
    const idx = items.findIndex((x) => x.id === item.id);
    if (idx >= 0) items[idx] = item;
    else items.unshift(item);
    // A rolled-back delete puts the row back, so it is no longer gone.
    this.forgetRemoved(item.id);
    this.listSlice.set({ items });
  }

  private removeById(itemId: string) {
    const items = this.state.value.items.filter((x) => x.id !== itemId);
    this.noteRemoved(itemId);
    this.listSlice.set({ items });
  }

  /**
   * Remember an id the backend no longer has, bounded. An open editor must tell
   * a row filtered off the page from an item that is gone; a refetch that stops
   * listing an id is not a removal.
   */
  private noteRemoved(itemId: string) {
    this.removedIds.add(itemId);
    // A Set iterates in insertion order, so the first entry is the oldest.
    if (this.removedIds.size > REMOVED_ID_MEMORY) {
      this.removedIds.delete(this.removedIds.values().next().value as string);
    }
  }

  private forgetRemoved(itemId: string) {
    this.removedIds.delete(itemId);
  }

  /** True when this id was removed rather than merely filtered off the page. */
  wasRemoved(itemId: string): boolean {
    return this.removedIds.has(itemId);
  }
}

let bulkOpSeq = 0;

/** Build a batch operation with an `op_id` unique for the process: the backend refuses a call that repeats one. */
export function makeBulkOp(kind: BulkOperation['kind'], payload: Record<string, unknown>): BulkOperation {
  bulkOpSeq += 1;
  const target = typeof payload.item_id === 'string' ? payload.item_id : 'op';
  return { op_id: `${kind}:${target}:${bulkOpSeq}`, kind, payload };
}

function opTargetId(op: BulkOperation): string | null {
  const id = op.payload?.item_id;
  return typeof id === 'string' ? id : null;
}

function unknownBulkError(message = t('hv.store.operationFailed')) {
  return { code: 'unknown_error', message };
}

/** Existing rows in place (replaced when incoming has them), then the new ones. */
function mergeUniqueById(existing: Item[], incoming: Item[]): Item[] {
  const byId = new Map(incoming.map((i) => [i.id, i]));
  const known = new Set(existing.map((e) => e.id));
  return existing.map((e) => byId.get(e.id) ?? e).concat(incoming.filter((i) => !known.has(i.id)));
}

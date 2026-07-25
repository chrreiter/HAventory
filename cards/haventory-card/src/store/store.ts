import type {
  AreasListResult,
  AnyEventPayload,
  BulkFailure,
  BulkOperation,
  BulkOutcome,
  DegradedState,
  DistinctValues,
  ExportDocument,
  HassLike,
  HealthResult,
  ImportPolicy,
  ImportPreview,
  ImportSummary,
  Item,
  ItemCreate,
  ItemFilter,
  ItemUpdate,
  ListItemsResult,
  Location,
  LocationTreeNode,
  Sort,
  StatsCounts,
  StoreFilters,
  StoreState,
  Unsubscribe,
} from './types';
import { WSClient } from './ws';
import { DEFAULT_SORT } from './sort';
import { sortLocationTree } from './location-tree';

/** Max items fetched for a single-category/tag browse drill-down (snapshot). */
const BROWSE_PAGE_LIMIT = 500;

/** Page size for the main list. */
const PAGE_LIMIT = 50;

/**
 * Operations per `haventory/items/bulk` call.
 *
 * The endpoint answers a whole batch in one response, so a single call can only
 * ever show an indeterminate spinner. Splitting the work into fixed chunks gives
 * the determinate progress bar the design draws ("Rewriting 24 of 38") and makes
 * "cancel stops after the in-flight batch" literally true.
 */
export const BULK_CHUNK_SIZE = 25;

/** Error codes the backend's taxonomy defines; anything else looks like transport trouble. */
const DOMAIN_ERROR_CODES = new Set([
  'validation_error',
  'not_found',
  'conflict',
  'storage_error',
  'rate_limited',
  'unknown_error',
]);

/** Consecutive transport failures before the card declares the connection lost. */
const CONNECTION_LOST_THRESHOLD = 2;

/** Attempts (including the first) for a command rejected with `rate_limited`. */
const RATE_LIMIT_ATTEMPTS = 4;

const NO_DEGRADATION: DegradedState = {
  rateLimited: false,
  connectionLost: false,
  retrying: 0,
  nextRetryAt: null,
  reloading: false,
};

function errorCode(err: unknown): string {
  return String((err as { code?: unknown } | undefined)?.code ?? 'unknown_error');
}

/**
 * Translate the card's filter state into the backend's `ItemFilter`.
 *
 * Exported because the staged mobile filter sheet needs to price a filter it has
 * not applied yet (`Store.countMatching`), and "Export current view" needs to
 * send the same object the list is showing.
 */
export function toWireFilter(filters: StoreFilters): ItemFilter {
  const filter: ItemFilter = {
    q: filters.q || undefined,
    area_id: filters.areaId || undefined,
    location_id: filters.locationId ?? undefined,
    // Sent explicitly: the list filter defaults it to false server-side while
    // subscriptions default it to true.
    include_subtree: filters.includeSubtree,
    checked_out: filters.checkedOutOnly || undefined,
    low_stock_only: filters.lowStockOnly || undefined,
    // A presentation hint rather than a filter — it re-sorts, it does not exclude.
    low_stock_first: filters.lowStockFirst || undefined,
    orphaned_only: filters.orphansOnly || undefined,
    category: filters.category || undefined,
    updated_after: filters.updatedAfter || undefined,
    created_after: filters.createdAfter || undefined,
  };
  if (filters.tags.length) {
    if (filters.tagsMode === 'all') filter.tags_all = [...filters.tags];
    else filter.tags_any = [...filters.tags];
  }
  return filter;
}

/** The filter state a freshly-mounted card starts from. */
export function defaultFilters(): StoreFilters {
  return {
    q: '',
    areaId: null,
    locationId: null,
    includeSubtree: true,
    checkedOutOnly: false,
    lowStockFirst: false,
    orphansOnly: false,
    lowStockOnly: false,
    category: null,
    tags: [],
    tagsMode: 'any',
    updatedAfter: null,
    createdAfter: null,
    sort: DEFAULT_SORT,
  };
}

/** How many filters (ignoring sort) are narrowing the list right now. */
export function activeFilterCount(filters: StoreFilters): number {
  let n = 0;
  if (filters.q) n += 1;
  if (filters.areaId) n += 1;
  if (filters.locationId) n += 1;
  if (filters.checkedOutOnly) n += 1;
  if (filters.orphansOnly) n += 1;
  if (filters.lowStockOnly) n += 1;
  if (filters.lowStockFirst) n += 1;
  if (filters.category) n += 1;
  if (filters.tags.length) n += 1;
  if (filters.updatedAfter) n += 1;
  if (filters.createdAfter) n += 1;
  return n;
}

/** A very small reactive wrapper using a Proxy; components can subscribe to `onChange`. */
export interface Observable<T> {
  readonly value: T;
  onChange(cb: () => void): () => void;
}

export function createObservable<T extends object>(initial: T): Observable<T> & { set(patch: Partial<T>): void } {
  let listeners = new Set<() => void>();
  let state = { ...initial } as T;
  const notify = () => listeners.forEach((l) => l());
  return {
    get value() {
      return state;
    },
    set(patch: Partial<T>) {
      Object.assign(state as unknown as Record<string, unknown>, patch as Record<string, unknown>);
      notify();
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export interface StoreOptions {
  /** Base backoff for `rate_limited` retries; set to 0 in tests. */
  retryBaseMs?: number;
}

export class Store {
  private ws: WSClient;
  private stateObs: ReturnType<typeof createObservable<StoreState>>;
  private inflight: Map<string, Promise<unknown>> = new Map();
  private itemsUnsub: Unsubscribe | null = null;
  private statsUnsub: Unsubscribe | null = null;
  private locationsUnsub: Unsubscribe | null = null;
  private retryBaseMs: number;
  private consecutiveTransportFailures = 0;
  private treeRefreshHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(hass: HassLike, options: StoreOptions = {}) {
    this.ws = new WSClient(hass);
    this.retryBaseMs = options.retryBaseMs ?? 400;

    const initial: StoreState = {
      items: [],
      cursor: null,
      total: null,
      loading: true,
      filters: defaultFilters(),
      selection: new Set<string>(),
      pendingOps: new Map(),
      errorQueue: [],
      areasCache: null,
      locationTreeCache: null,
      locationsFlatCache: null,
      statsCounts: null,
      healthCache: null,
      versionInfo: null,
      distinctValuesCache: null,
      connected: { items: false, stats: false },
      degraded: { ...NO_DEGRADATION },
    };
    this.stateObs = createObservable<StoreState>(initial);
  }

  get state(): Observable<StoreState> {
    return this.stateObs;
  }

  // ---------- Initialization and subscriptions ----------
  async init() {
    await Promise.all([
      this.refreshStats(),
      this.refreshHealth(),
      this.refreshAreas(),
      this.refreshLocationTree(),
      this.refreshLocationsFlat(),
      this.refreshDistinctValues(),
      this.refreshVersion(),
    ]);
    await this.listItems(true);
    this.subscribeTopics();
  }

  subscribeTopics() {
    const onError = (err: unknown) => this.onSubscribeError(err);
    // Items
    if (this.itemsUnsub) this.itemsUnsub();
    this.itemsUnsub = this.ws.subscribe('items', (evt: AnyEventPayload) => this.onItemsEvent(evt), {
      location_id: this.state.value.filters.locationId ?? undefined,
      include_subtree: true, // Always include sublocations
      onError,
    });
    // Stats
    if (this.statsUnsub) this.statsUnsub();
    this.statsUnsub = this.ws.subscribe('stats', (evt: AnyEventPayload) => this.onStatsEvent(evt), { onError });
    // Locations
    if (this.locationsUnsub) this.locationsUnsub();
    this.locationsUnsub = this.ws.subscribe(
      'locations',
      (evt: AnyEventPayload) => this.onLocationsEvent(evt),
      { onError },
    );

    this.stateObs.set({ connected: { items: true, stats: true } });
  }

  /**
   * A rejected subscribe means live updates are gone. Rate limiting is the
   * expected cause; either way the card must stop implying it is live and offer
   * a manual refresh (docs/open-items.md #1).
   */
  private onSubscribeError(err: unknown) {
    const code = errorCode(err);
    this.setDegraded({
      rateLimited: code === 'rate_limited' ? true : this.state.value.degraded.rateLimited,
      connectionLost: code === 'rate_limited' ? this.state.value.degraded.connectionLost : true,
    });
    this.stateObs.set({ connected: { items: false, stats: false } });
    this.pushError(err);
  }

  /** Tear down subscriptions; the card calls this when it disconnects. */
  dispose() {
    this.itemsUnsub?.();
    this.statsUnsub?.();
    this.locationsUnsub?.();
    this.itemsUnsub = this.statsUnsub = this.locationsUnsub = null;
    if (this.treeRefreshHandle !== null) {
      clearTimeout(this.treeRefreshHandle);
      this.treeRefreshHandle = null;
    }
    this.stateObs.set({ connected: { items: false, stats: false } });
  }

  private onItemsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'items') return;
    if (evt.action === 'reloaded') {
      // An import replaced the dataset wholesale — reload from scratch. The
      // signal carries no payload, so there is nothing to merge; anything the
      // user had open is now editing data that no longer exists.
      this.setDegraded({ reloading: true });
      void this.listItems(true)
        .catch(() => undefined)
        .finally(() => this.setDegraded({ reloading: false }));
      void this.refreshDistinctValues().catch(() => undefined);
      this.scheduleTreeRefresh();
      return;
    }
    const item = (evt as unknown as { item: Item }).item; // narrow by known payload structure
    const items = this.state.value.items.slice();
    const idx = items.findIndex((x) => x.id === item.id);
    switch (evt.action) {
      case 'created':
      case 'updated':
      case 'moved':
      case 'checked_out':
      case 'checked_in':
      case 'quantity_changed': {
        if (idx >= 0) items[idx] = item; else items.unshift(item);
        break;
      }
      case 'deleted': {
        if (idx >= 0) items.splice(idx, 1);
        break;
      }
    }
    this.stateObs.set({ items });
    // Category/tag distributions can change on create/update/delete — keep the
    // autocomplete source fresh. Other actions (quantity, check-out) can't.
    if (evt.action === 'created' || evt.action === 'updated' || evt.action === 'deleted') {
      void this.refreshDistinctValues().catch(() => undefined);
    }
    // Per-location counts live on the tree, and only `stats/counts` is pushed —
    // so anything that moves an item between locations needs a tree refetch.
    if (evt.action === 'created' || evt.action === 'deleted' || evt.action === 'moved') {
      this.scheduleTreeRefresh();
    }
  }

  /**
   * Coalesce tree refetches. `location/tree` is a full walk with no parameters,
   * so a burst of item events (a bulk move, an import) must not fire one per event.
   */
  private scheduleTreeRefresh(delayMs = 250) {
    if (this.treeRefreshHandle !== null) clearTimeout(this.treeRefreshHandle);
    this.treeRefreshHandle = setTimeout(() => {
      this.treeRefreshHandle = null;
      void this.refreshLocationTree().catch(() => undefined);
    }, delayMs);
  }

  private onStatsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'stats' || evt.action !== 'counts') return;
    this.stateObs.set({ statsCounts: (evt as unknown as { counts: StatsCounts }).counts });
  }

  private onLocationsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'locations') return;
    if (evt.action === 'reloaded') {
      void Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
      void this.listItems(true);
      return;
    }
    void Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    // Moving or renaming a location rewrites the denormalized location_path on
    // every item in its subtree — reload the list so rows reflect it live.
    if (evt.action === 'moved' || evt.action === 'renamed') {
      void this.listItems(true);
    }
  }

  // ---------- Data fetchers ----------
  // Reads go through `run` too: a rate-limited read deserves the same backoff,
  // and a run of transport failures on any call is what "connection lost" means.
  async refreshStats() {
    const counts = await this.run(() => this.ws.stats());
    this.stateObs.set({ statsCounts: counts });
  }

  async refreshHealth() {
    const health: HealthResult = await this.run(() => this.ws.health());
    this.stateObs.set({ healthCache: health });
  }

  async refreshAreas() {
    const areas = await this.run(() => this.ws.listAreas());
    this.stateObs.set({ areasCache: areas as AreasListResult });
  }

  /** Refresh distinct categories/tags with counts (source for autocomplete). */
  async refreshDistinctValues() {
    const distinct = await this.run(() => this.ws.distinctValues());
    this.stateObs.set({ distinctValuesCache: distinct as DistinctValues });
  }

  /** Version banner for the diagnostics panel. */
  async refreshVersion() {
    const info = await this.run(() => this.ws.version());
    this.stateObs.set({ versionInfo: info });
  }

  async refreshLocationTree() {
    const tree = await this.run(() => this.ws.getLocationTree());
    // Sorted once here so every consumer — sidebar, pickers, organize dialog —
    // sees the same order; the API returns nodes in insertion order.
    this.stateObs.set({ locationTreeCache: sortLocationTree((tree ?? []) as LocationTreeNode[]) });
  }

  async refreshLocationsFlat() {
    const locs = await this.run(() => this.ws.listLocations());
    const list = (locs as Location[]).slice().sort((a, b) =>
      (a.path?.sort_key || '').localeCompare(b.path?.sort_key || '', undefined, { sensitivity: 'base' }),
    );
    this.stateObs.set({ locationsFlatCache: list });
  }

  // ---------- Listing & pagination ----------
  async listItems(reset = false) {
    const st = this.state.value;
    const filter = toWireFilter(st.filters);
    const sort = st.filters.sort;
    const limit = PAGE_LIMIT;
    const cursor = reset ? undefined : st.cursor || undefined;

    // de-dup by a composite key
    const key = JSON.stringify({ op: 'list', filter, sort, limit, cursor });
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;

    const p = this.ws
      .listItems(filter, sort, limit, cursor)
      .then((res: ListItemsResult) => {
        this.noteSuccess();
        const merged = reset ? res.items : mergeUniqueById(this.state.value.items, res.items);
        this.stateObs.set({
          items: merged,
          cursor: res.next_cursor,
          // `total` counts every match across all pages, not just this one.
          total: typeof res.total === 'number' ? res.total : null,
          loading: false,
        });
      })
      .catch((err: unknown) => {
        this.noteFailure(err);
        this.stateObs.set({ loading: false });
        this.pushError(err);
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p as Promise<void>;
  }

  /**
   * How many items a filter would match, without applying it.
   *
   * The staged mobile filter sheet shows a live "Show 38 items" before the user
   * commits, and there is no count-only endpoint — so ask for one row and read
   * the filtered `total` off the response.
   */
  async countMatching(filters: StoreFilters): Promise<number | null> {
    try {
      const res = await this.ws.listItems(toWireFilter(filters), filters.sort, 1);
      return typeof res.total === 'number' ? res.total : null;
    } catch {
      return null;
    }
  }

  /**
   * Every item matching a filter, in one shot. Omitting `limit` makes the backend
   * return the whole match set — that is what "Load all N to select" and the
   * tag/category merge rewrites need, since selection cannot span unloaded pages.
   */
  async listAllMatching(filter: ItemFilter, sort?: Sort): Promise<Item[]> {
    const res = await this.ws.listItems(filter, sort);
    return res.items;
  }

  /** Load every remaining page of the current filter into the list. */
  async loadAllPages(maxPages = 200): Promise<void> {
    let pages = 0;
    while (this.state.value.cursor && pages < maxPages) {
      const before = this.state.value.cursor;
      await this.listItems(false);
      pages += 1;
      if (this.state.value.cursor === before) break; // defensive: cursor not advancing
    }
  }

  /**
   * Fetch items filed under a single category, sorted by name. Used by the
   * dedicated category browser (drill-down). Returns a snapshot (first page,
   * capped) independent of the main list's filters/pagination.
   */
  async fetchItemsByCategory(category: string): Promise<Item[]> {
    const res = await this.ws.listItems({ category }, { field: 'name', order: 'asc' }, BROWSE_PAGE_LIMIT);
    return res.items;
  }

  /**
   * Fetch items carrying a single tag, sorted by name. Used by the dedicated
   * tag browser (drill-down). Returns a snapshot (first page, capped) independent
   * of the main list's filters/pagination.
   */
  async fetchItemsByTag(tag: string): Promise<Item[]> {
    const res = await this.ws.listItems({ tags_any: [tag] }, { field: 'name', order: 'asc' }, BROWSE_PAGE_LIMIT);
    return res.items;
  }

  async prefetchIfNeeded(scrollRatio: number) {
    if (scrollRatio < 0.7) return;
    if (!this.state.value.cursor) return;
    // Trigger next page load
    await this.listItems(false);
  }

  // ---------- Filters ----------
  setFilters(patch: Partial<StoreFilters>) {
    const next = { ...this.state.value.filters, ...patch };
    const locationChanged = next.locationId !== this.state.value.filters.locationId;
    this.stateObs.set({
      filters: next,
      cursor: null,
      items: [],
      total: null,
      loading: true,
      // A row that is no longer listed cannot stay selected.
      selection: new Set<string>(),
    });
    // The items subscription is scoped by location, so only a location change
    // needs the sockets torn down and rebuilt.
    if (locationChanged) this.subscribeTopics();
    // Reload with new filters
    void this.listItems(true);
  }

  /** Drop every filter, keeping the current sort. */
  clearFilters() {
    this.setFilters({ ...defaultFilters(), sort: this.state.value.filters.sort });
  }

  // ---------- Selection (bulk actions) ----------
  private setSelection(next: Set<string>) {
    this.stateObs.set({ selection: next });
  }

  toggleSelected(itemId: string) {
    const next = new Set(this.state.value.selection);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    this.setSelection(next);
  }

  setSelected(itemIds: Iterable<string>) {
    this.setSelection(new Set(itemIds));
  }

  clearSelection() {
    if (this.state.value.selection.size === 0) return;
    this.setSelection(new Set<string>());
  }

  /**
   * Select the rows that are loaded — deliberately not "all matching". Cursor
   * pagination means the card only holds a prefix of the match set, so the UI
   * labels this honestly and offers `loadAllThenSelectAll` as the explicit path.
   */
  selectAllLoaded() {
    this.setSelection(new Set(this.state.value.items.map((i) => i.id)));
  }

  /** Page in every remaining match, then select the lot. */
  async loadAllThenSelectAll(): Promise<void> {
    await this.loadAllPages();
    this.selectAllLoaded();
  }

  // ---------- Degraded / retry plumbing ----------
  private setDegraded(patch: Partial<DegradedState>) {
    const next = { ...this.state.value.degraded, ...patch };
    const cur = this.state.value.degraded;
    const same =
      cur.rateLimited === next.rateLimited &&
      cur.connectionLost === next.connectionLost &&
      cur.retrying === next.retrying &&
      cur.nextRetryAt === next.nextRetryAt &&
      cur.reloading === next.reloading;
    if (same) return;
    this.stateObs.set({ degraded: next });
  }

  /** Any successful round trip proves the socket is alive. */
  private noteSuccess() {
    this.consecutiveTransportFailures = 0;
    if (this.state.value.degraded.connectionLost) this.setDegraded({ connectionLost: false });
  }

  /**
   * Classify a failure. A code from the backend's taxonomy means the socket is
   * fine and the command was refused; anything else is transport trouble, and a
   * run of those is the only "connection lost" signal a card can observe — HA's
   * WS client reconnects transparently and exposes no disconnect event.
   */
  private noteFailure(err: unknown) {
    const code = errorCode(err);
    if (code === 'rate_limited') {
      this.setDegraded({ rateLimited: true });
      return;
    }
    if (DOMAIN_ERROR_CODES.has(code) && code !== 'unknown_error') {
      this.consecutiveTransportFailures = 0;
      return;
    }
    this.consecutiveTransportFailures += 1;
    if (this.consecutiveTransportFailures >= CONNECTION_LOST_THRESHOLD) {
      this.setDegraded({ connectionLost: true });
    }
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Run a command, retrying with backoff while the backend says `rate_limited`.
   *
   * Rate limiting is opt-in but real, and the contract's guidance is to retry
   * later — so the card absorbs it rather than surfacing a scary error on the
   * first refusal. The banner shows the wait; if every attempt is refused the
   * error propagates and the caller reports it as usual.
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await fn();
        this.noteSuccess();
        if (attempt > 0) {
          this.setDegraded({
            retrying: Math.max(0, this.state.value.degraded.retrying - 1),
            nextRetryAt: null,
          });
        }
        return out;
      } catch (err) {
        this.noteFailure(err);
        const retriable = errorCode(err) === 'rate_limited' && attempt < RATE_LIMIT_ATTEMPTS - 1;
        if (!retriable) {
          if (attempt > 0) {
            this.setDegraded({
              retrying: Math.max(0, this.state.value.degraded.retrying - 1),
              nextRetryAt: null,
            });
          }
          throw err;
        }
        const delay = this.retryBaseMs * 2 ** attempt;
        this.setDegraded({
          retrying: attempt === 0 ? this.state.value.degraded.retrying + 1 : this.state.value.degraded.retrying,
          nextRetryAt: Date.now() + delay,
        });
        await this.sleep(delay);
      }
    }
  }

  /**
   * Re-list everything and clear the degraded flags.
   *
   * This is the recovery the contract prescribes: a dropped subscription event
   * is undetectable, so the only honest fix is an explicit, user-triggered
   * re-read of items, locations and stats.
   */
  async refreshAll(): Promise<void> {
    this.consecutiveTransportFailures = 0;
    this.setDegraded({ ...NO_DEGRADATION });
    await this.reloadAll();
    // Re-establish subscriptions in case one of them was refused earlier.
    this.subscribeTopics();
  }

  // ---------- Optimistic writes ----------
  async createItem(input: ItemCreate) {
    const opId = `create:${Date.now()}`;
    this.state.value.pendingOps.set(opId, { kind: 'create' });
    try {
      const created = await this.run(() => this.ws.createItem(input));
      // Insert optimistically already covered by items event; ensure presence
      const items = mergeUniqueById(this.state.value.items, [created]);
      this.stateObs.set({ items });
    } catch (err) {
      this.pushError(err);
    } finally {
      this.state.value.pendingOps.delete(opId);
      this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
    }
  }

  async updateItem(itemId: string, changes: ItemUpdate, expectedVersion?: number) {
    const opId = `update:${itemId}:${Date.now()}`;
    this.state.value.pendingOps.set(opId, { kind: 'update', itemId });
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) {
      const optimistic: Item = { ...before, ...changes } as Item;
      this.applyOptimistic(optimistic);
    }
    try {
      const updated = await this.run(() => this.ws.updateItem(itemId, changes, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      // Capture conflict context for actionable retry
      this.pushError(err, { itemId, changes });
      if (before) this.applyOptimistic(before);
    } finally {
      this.state.value.pendingOps.delete(opId);
      this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
    }
  }

  async deleteItem(itemId: string, expectedVersion?: number) {
    const opId = `delete:${itemId}:${Date.now()}`;
    this.state.value.pendingOps.set(opId, { kind: 'delete', itemId });
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.removeById(itemId);
    try {
      await this.run(() => this.ws.deleteItem(itemId, expectedVersion));
    } catch (err) {
      this.pushError(err);
      // rollback
      if (before) this.applyOptimistic(before);
    } finally {
      this.state.value.pendingOps.delete(opId);
      this.stateObs.set({ pendingOps: new Map(this.state.value.pendingOps) });
    }
  }

  async adjustQuantity(itemId: string, delta: number, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, quantity: before.quantity + delta } as Item);
    try {
      const updated = await this.run(() => this.ws.adjustQuantity(itemId, delta, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async setQuantity(itemId: string, quantity: number, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, quantity } as Item);
    try {
      const updated = await this.run(() => this.ws.setQuantity(itemId, quantity, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async checkOut(itemId: string, dueDate?: string | null, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, checked_out: true, due_date: dueDate ?? before.due_date } as Item);
    try {
      const updated = await this.run(() => this.ws.checkOut(itemId, dueDate, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async markCheckedIn(itemId: string, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, checked_out: false } as Item);
    try {
      const updated = await this.run(() => this.ws.markCheckedIn(itemId, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async setLowStockThreshold(itemId: string, threshold: number | null, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, low_stock_threshold: threshold } as Item);
    try {
      const updated = await this.run(() => this.ws.setLowStockThreshold(itemId, threshold, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async moveItem(itemId: string, locationId: string | null, expectedVersion?: number) {
    const before = this.state.value.items.find((i) => i.id === itemId);
    if (before) this.applyOptimistic({ ...before, location_id: locationId } as Item);
    try {
      const updated = await this.run(() => this.ws.moveItem(itemId, locationId, expectedVersion));
      this.applyOptimistic(updated);
    } catch (err) {
      this.pushError(err);
      if (before) this.applyOptimistic(before);
    }
  }

  async createLocation(name: string, parentId?: string | null, areaId?: string | null): Promise<Location> {
    const created = await this.ws.createLocation(name, parentId ?? null, areaId ?? undefined);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    return created;
  }

  async updateLocation(locationId: string, changes: { name?: string; areaId?: string | null }): Promise<Location> {
    const updated = await this.ws.updateLocation(locationId, changes);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    return updated;
  }

  /** Delete an empty location. Rejects with validation_error when it still has children or items. */
  async deleteLocation(locationId: string): Promise<void> {
    await this.ws.deleteLocation(locationId);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
  }

  /** Move a whole subtree under a new parent (null = top level). Descendant paths update live. */
  async moveLocationSubtree(locationId: string, newParentId: string | null): Promise<Location> {
    const moved = await this.ws.moveLocationSubtree(locationId, newParentId);
    await Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
    // Denormalized item location_path values changed for the whole subtree.
    await this.listItems(true);
    return moved;
  }

  // ---------- Bulk operations ----------
  /**
   * Run a batch of item operations, chunked, reporting progress as it goes.
   *
   * Partial failure is the normal case for `haventory/items/bulk`: successes
   * persist, failures come back per operation, and nothing is rolled back. The
   * caller gets both halves so it can show "39 of 42 moved" and retry only the
   * three that failed.
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
        const res = await this.run(() => this.ws.bulk(chunk));
        const results = res?.results ?? {};
        for (const [opId, result] of Object.entries(results)) {
          const op = byId.get(opId);
          if (result?.success) {
            succeededOpIds.add(opId);
            // `item_delete` succeeds with a null result — there is no item to merge.
            const item = result.result;
            if (item && typeof item.id === 'string') {
              succeeded.push(item);
              this.applyOptimistic(item);
            }
          } else if (op) {
            failed.push({ op, error: result?.error ?? unknownBulkError(), itemId: opTargetId(op) });
          }
        }
        // An op whose id never came back is reported rather than silently
        // dropped — the endpoint collapses duplicate op_ids to the last one.
        for (const op of chunk) {
          if (!(op.op_id in results)) {
            failed.push({
              op,
              error: unknownBulkError('no result returned for this operation'),
              itemId: opTargetId(op),
            });
          }
        }
      } catch (err) {
        // The whole call failed (envelope validation, rate limiting after every
        // retry, transport). Attribute it to each op in the chunk.
        const error = {
          code: errorCode(err),
          message: String((err as { message?: unknown } | undefined)?.message ?? 'Batch failed'),
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
    this.scheduleTreeRefresh();

    return { succeeded, failed, cancelled };
  }

  // ---------- Import / export (data safety) ----------
  /**
   * Build a versioned backup document.
   *
   * `scope: 'view'` applies the active filter — the export endpoint accepts one,
   * and the document still carries each item's location ancestry so a filtered
   * backup stays self-consistent.
   */
  async exportDocument(scope: 'all' | 'view' = 'all'): Promise<ExportDocument> {
    return this.ws.exportDocument(scope === 'view' ? toWireFilter(this.state.value.filters) : undefined);
  }

  /** Validate + classify an import document without mutating state. */
  async previewImport(document: unknown, policy: ImportPolicy): Promise<ImportPreview> {
    return this.ws.importPreview(document, policy);
  }

  /** Apply an import document, then reload local caches to reflect the new dataset. */
  async executeImport(document: unknown, policy: ImportPolicy): Promise<ImportSummary> {
    const summary = await this.ws.importExecute(document, policy);
    await this.reloadAll();
    return summary;
  }

  /** Refresh every derived cache and the item list (used after a wholesale import). */
  async reloadAll(): Promise<void> {
    await Promise.all([
      this.refreshStats(),
      this.refreshHealth(),
      this.refreshLocationsFlat(),
      this.refreshLocationTree(),
      this.refreshDistinctValues(),
    ]);
    await this.listItems(true);
  }

  // ---------- Errors ----------
  private pushError(err: unknown, details?: { itemId?: string; changes?: ItemUpdate }) {
    // Home Assistant callWS returns an error envelope with {code, message, context}
    const anyErr = err as { code?: unknown; message?: unknown; context?: unknown; data?: unknown } | undefined;
    const code = String(anyErr?.code ?? 'unknown_error');
    const message = String(anyErr?.message ?? 'Unknown error');
    const context = (anyErr?.context ?? anyErr?.data ?? null) as Record<string, unknown> | null;
    const entry = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      code,
      message,
      context: context ?? undefined,
      kind: code === 'conflict' ? 'conflict' as const : 'error' as const,
      itemId: details?.itemId,
      changes: details?.changes,
    };
    const next = this.state.value.errorQueue.concat([entry]);
    this.stateObs.set({ errorQueue: next });
  }

  dismissError(id: string) {
    const next = this.state.value.errorQueue.filter((e) => e.id !== id);
    this.stateObs.set({ errorQueue: next });
  }

  async refreshItem(itemId: string) {
    try {
      const latest = await this.ws.getItem(itemId);
      this.applyOptimistic(latest);
    } catch (err) {
      this.pushError(err);
    }
  }

  // ---------- Local mutations ----------
  private applyOptimistic(item: Item) {
    const items = this.state.value.items.slice();
    const idx = items.findIndex((x) => x.id === item.id);
    if (idx >= 0) items[idx] = item; else items.unshift(item);
    this.stateObs.set({ items });
  }

  private removeById(itemId: string) {
    const items = this.state.value.items.filter((x) => x.id !== itemId);
    this.stateObs.set({ items });
  }
}

let bulkOpSeq = 0;

/**
 * Build a batch operation with an id that is unique for the process.
 *
 * The backend keys results by `op_id` and silently keeps only the last entry for
 * a duplicate, which would leave the client unable to say which op failed — so
 * ids are never derived from the item alone.
 */
export function makeBulkOp(
  kind: BulkOperation['kind'],
  payload: Record<string, unknown>,
): BulkOperation {
  bulkOpSeq += 1;
  const target = typeof payload.item_id === 'string' ? payload.item_id : 'op';
  return { op_id: `${kind}:${target}:${bulkOpSeq}`, kind, payload };
}

function opTargetId(op: BulkOperation): string | null {
  const id = op.payload?.item_id;
  return typeof id === 'string' ? id : null;
}

function unknownBulkError(message = 'Operation failed') {
  return { code: 'unknown_error', message };
}

function mergeUniqueById(existing: Item[], incoming: Item[]): Item[] {
  const map = new Map<string, Item>();
  for (const it of existing) map.set(it.id, it);
  for (const it of incoming) map.set(it.id, it);
  // Keep order: existing first then incoming new ones
  const incomingOnly = incoming.filter((i) => !existing.some((e) => e.id === i.id));
  return existing.map((e) => map.get(e.id)!) .concat(incomingOnly);
}

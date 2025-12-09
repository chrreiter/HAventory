import type {
  AreasListResult,
  AnyEventPayload,
  HassLike,
  Item,
  ItemCreate,
  ItemFilter,
  ItemUpdate,
  ListItemsResult,
  Location,
  Sort,
  StatsCounts,
  StoreFilters,
  StoreState,
  Unsubscribe,
} from './types';
import { WSClient } from './ws';
import { DEFAULT_SORT } from './sort';

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

export class Store {
  private ws: WSClient;
  private stateObs: ReturnType<typeof createObservable<StoreState>>;
  private inflight: Map<string, Promise<unknown>> = new Map();
  private itemsUnsub: Unsubscribe | null = null;
  private statsUnsub: Unsubscribe | null = null;
  private locationsUnsub: Unsubscribe | null = null;

  constructor(hass: HassLike) {
    this.ws = new WSClient(hass);

    const defaultSort: Sort = DEFAULT_SORT;
    const initial: StoreState = {
      items: [],
      cursor: null,
      filters: {
        q: '',
        areaId: null,
        locationId: null,
        includeSubtree: true,
        checkedOutOnly: false,
        lowStockFirst: false,
        sort: defaultSort,
      },
      selection: new Set<string>(),
      pendingOps: new Map(),
      errorQueue: [],
      areasCache: null,
      locationTreeCache: null,
      locationsFlatCache: null,
      statsCounts: null,
      connected: { items: false, stats: false },
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
      this.refreshAreas(),
      this.refreshLocationTree(),
      this.refreshLocationsFlat(),
    ]);
    await this.listItems(true);
    this.subscribeTopics();
  }

  subscribeTopics() {
    // Items
    if (this.itemsUnsub) this.itemsUnsub();
    this.itemsUnsub = this.ws.subscribe('items', (evt: AnyEventPayload) => this.onItemsEvent(evt), {
      location_id: this.state.value.filters.locationId ?? undefined,
      include_subtree: this.state.value.filters.includeSubtree,
    });
    // Stats
    if (this.statsUnsub) this.statsUnsub();
    this.statsUnsub = this.ws.subscribe('stats', (evt: AnyEventPayload) => this.onStatsEvent(evt));
    // Locations
    if (this.locationsUnsub) this.locationsUnsub();
    this.locationsUnsub = this.ws.subscribe('locations', (evt: AnyEventPayload) => this.onLocationsEvent(evt));

    this.stateObs.set({ connected: { items: true, stats: true } });
  }

  private onItemsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'items') return;
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
  }

  private onStatsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'stats' || evt.action !== 'counts') return;
    this.stateObs.set({ statsCounts: (evt as unknown as { counts: StatsCounts }).counts });
  }

  private onLocationsEvent(evt: AnyEventPayload) {
    if (evt.topic !== 'locations') return;
    void Promise.all([this.refreshLocationsFlat(), this.refreshLocationTree()]);
  }

  // ---------- Data fetchers ----------
  async refreshStats() {
    const counts = await this.ws.stats();
    this.stateObs.set({ statsCounts: counts });
  }

  async refreshAreas() {
    const areas = await this.ws.listAreas();
    this.stateObs.set({ areasCache: areas as AreasListResult });
  }

  async refreshLocationTree() {
    const tree = await this.ws.getLocationTree();
    // Keep as-is (unknown[]); UI will interpret into a tree component later
    this.stateObs.set({ locationTreeCache: tree as unknown[] });
  }

  async refreshLocationsFlat() {
    const locs = await this.ws.listLocations();
    const list = (locs as Location[]).slice().sort((a, b) =>
      (a.path?.sort_key || '').localeCompare(b.path?.sort_key || '', undefined, { sensitivity: 'base' }),
    );
    this.stateObs.set({ locationsFlatCache: list });
  }

  // ---------- Listing & pagination ----------
  async listItems(reset = false) {
    const st = this.state.value;
    const filter: ItemFilter = {
      q: st.filters.q || undefined,
      area_id: st.filters.areaId || undefined,
      location_id: st.filters.locationId ?? undefined,
      include_subtree: st.filters.includeSubtree,
      checked_out: st.filters.checkedOutOnly || undefined,
      // Interpret UI toggle as preference to show low-stock items first
      low_stock_first: st.filters.lowStockFirst || undefined,
    };
    const sort = st.filters.sort;
    const limit = 50;
    const cursor = reset ? undefined : st.cursor || undefined;

    // de-dup by a composite key
    const key = JSON.stringify({ op: 'list', filter, sort, limit, cursor });
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;

    const p = this.ws
      .listItems(filter, sort, limit, cursor)
      .then((res: ListItemsResult) => {
        const merged = reset ? res.items : mergeUniqueById(st.items, res.items);
        this.stateObs.set({ items: merged, cursor: res.next_cursor });
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p as Promise<void>;
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
    this.stateObs.set({ filters: next, cursor: null, items: [] });
    // Update items subscription filters (location, include_subtree)
    this.subscribeTopics();
    // Reload with new filters
    void this.listItems(true);
  }

  // ---------- Optimistic writes ----------
  async createItem(input: ItemCreate) {
    const opId = `create:${Date.now()}`;
    this.state.value.pendingOps.set(opId, { kind: 'create' });
    try {
      const created = await this.ws.createItem(input);
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
      const updated = await this.ws.updateItem(itemId, changes, expectedVersion);
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
      await this.ws.deleteItem(itemId, expectedVersion);
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
      const updated = await this.ws.adjustQuantity(itemId, delta, expectedVersion);
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
      const updated = await this.ws.setQuantity(itemId, quantity, expectedVersion);
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
      const updated = await this.ws.checkOut(itemId, dueDate, expectedVersion);
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
      const updated = await this.ws.markCheckedIn(itemId, expectedVersion);
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
      const updated = await this.ws.setLowStockThreshold(itemId, threshold, expectedVersion);
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
      const updated = await this.ws.moveItem(itemId, locationId, expectedVersion);
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

function mergeUniqueById(existing: Item[], incoming: Item[]): Item[] {
  const map = new Map<string, Item>();
  for (const it of existing) map.set(it.id, it);
  for (const it of incoming) map.set(it.id, it);
  // Keep order: existing first then incoming new ones
  const incomingOnly = incoming.filter((i) => !existing.some((e) => e.id === i.id));
  return existing.map((e) => map.get(e.id)!) .concat(incomingOnly);
}

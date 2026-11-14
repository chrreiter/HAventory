import { Coalesced, Latest } from './scheduling';
import { Slice } from './slice';
import { activeFilterCount, defaultFilters, toWireFilter } from './filters';
import type { Run } from './connection-health';
import type { ErrorDetails } from './error-queue';
import type {
  AttachmentKind,
  Item,
  ItemCreate,
  ItemFilter,
  ItemUpdate,
  ItemsEventPayload,
  ListItemsResult,
  StoreFilters,
  StoreState,
} from './types';
import type { WSClient } from './ws';

const PAGE_LIMIT = 50;

/** Removed item ids kept for `wasRemoved`: enough to outlive a bulk delete. */
const REMOVED_ID_MEMORY = 200;

export type ListSlice = Pick<StoreState, 'items' | 'cursor' | 'total' | 'loading' | 'filters' | 'selection'>;

/**
 * The loaded rows and their paging, the filters and the selection, the
 * optimistic item writes, and the memory of which ids were removed.
 */
export class ItemList {
  readonly slice = new Slice<ListSlice>({
    items: [],
    cursor: null,
    total: null,
    loading: true,
    filters: defaultFilters(),
    selection: new Set<string>(),
  });
  private inflight: Map<string, Promise<unknown>> = new Map();
  /** Ids removed since this store connected — see `noteRemoved`. */
  private readonly removedIds = new Set<string>();
  /** The deferred work: every one of these is cancelled by `dispose`. */
  private readonly totalRefresh = new Coalesced();
  private readonly latestTotal = new Latest();
  private readonly latestList = new Latest();

  constructor(
    private readonly ws: WSClient,
    private readonly run: Run,
    private readonly pushError: (err: unknown, details?: ErrorDetails) => void,
  ) {}

  /** Cancel the deferred total refresh. */
  dispose() {
    this.totalRefresh.cancel();
  }

  /**
   * Swap in new filters and reset the paging and selection; the caller
   * refetches.
   */
  applyFilters(next: StoreFilters) {
    // Loaded rows stay until the refetch replaces them: blanking them would tear
    // the scroller, and an open editor with it, down mid-edit.
    this.slice.set({ filters: next, cursor: null, loading: true, selection: new Set<string>() });
  }

  /** Fold one items event into the loaded rows, the total and the removed-id memory. */
  applyItemsEvent(evt: ItemsEventPayload, item: Item) {
    const items = this.slice.value.items.slice();
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
        else if (evt.action === 'created' || this.slice.value.cursor === null) items.unshift(item);
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
    const total = this.slice.value.total;
    const delta = items.length - loadedBefore;
    this.slice.set(total !== null && delta !== 0 ? { items, total: Math.max(0, total + delta) } : { items });
    if (activeFilterCount(this.slice.value.filters) > 0) this.scheduleTotalRefresh();
  }

  /** Coalesced, so a burst of events asks once. */
  private scheduleTotalRefresh(delayMs = 250) {
    this.totalRefresh.schedule(delayMs, () => void this.refreshTotal().catch(() => undefined));
  }

  private async refreshTotal(): Promise<void> {
    const current = this.latestTotal.claim();
    const filters = this.slice.value.filters;
    const asked = JSON.stringify(toWireFilter(filters));
    const total = await this.countMatching(filters);
    // A moved filter is already answered by the `listItems` it triggered.
    if (!current() || total === null) return;
    if (JSON.stringify(toWireFilter(this.slice.value.filters)) !== asked) return;
    this.slice.set({ total });
  }

  async listItems(reset = false) {
    const st = this.slice.value;
    const filter = toWireFilter(st.filters);
    const sort = st.filters.sort;
    const limit = PAGE_LIMIT;
    const cursor = reset ? undefined : st.cursor || undefined;

    const key = JSON.stringify({ op: 'list', filter, sort, limit, cursor });
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<void>;

    // Newest wins: an answer, or a refusal, for a filter or page the view has
    // since left does not land, whatever order the two arrive in.
    const current = this.latestList.claim();
    const p = this.run(() => this.ws.listItems(filter, sort, limit, cursor))
      .then((res: ListItemsResult) => {
        if (!current()) return;
        const merged = reset ? res.items : mergeUniqueById(this.slice.value.items, res.items);
        this.slice.set({
          items: merged,
          cursor: res.next_cursor,
          total: res.total,
          loading: false,
        });
      })
      .catch((err: unknown) => {
        if (!current()) return;
        this.slice.set({ loading: false });
        this.pushError(err);
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p;
  }

  /** How many items a filter would match: one row asked for, `total` read off it. */
  async countMatching(filters: StoreFilters): Promise<number | null> {
    try {
      const res = await this.run(() => this.ws.listItems(toWireFilter(filters), filters.sort, 1));
      return res.total;
    } catch {
      return null;
    }
  }

  /** Every item matching a filter; no `limit` makes the backend return them all. */
  async listAllMatching(filter: ItemFilter): Promise<Item[]> {
    const res = await this.run(() => this.ws.listItems(filter));
    return res.items;
  }

  /** Load every remaining page of the current filter into the list. */
  async loadAllPages(maxPages = 200): Promise<void> {
    let pages = 0;
    while (this.slice.value.cursor && pages < maxPages) {
      const before = this.slice.value.cursor;
      await this.listItems(false);
      pages += 1;
      // A failed page leaves the cursor where it was.
      if (this.slice.value.cursor === before) break;
    }
  }

  async prefetchIfNeeded(scrollRatio: number) {
    if (scrollRatio < 0.7) return;
    if (!this.slice.value.cursor) return;
    await this.listItems(false);
  }

  toggleSelected(itemId: string) {
    const next = new Set(this.slice.value.selection);
    if (!next.delete(itemId)) next.add(itemId);
    this.setSelected(next);
  }

  setSelected(itemIds: Iterable<string>) {
    this.slice.set({ selection: new Set(itemIds) });
  }

  clearSelection() {
    if (this.slice.value.selection.size > 0) this.setSelected([]);
  }

  /** The loaded rows only; `loadAllThenSelectAll` is the explicit "all matching". */
  selectAllLoaded() {
    this.setSelected(this.slice.value.items.map((i) => i.id));
  }

  /** Page in every remaining match, then select the lot. */
  async loadAllThenSelectAll(): Promise<void> {
    await this.loadAllPages();
    this.selectAllLoaded();
  }

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
    const before = patch ? this.slice.value.items.find((i) => i.id === itemId) : undefined;
    if (patch && before) this.applyOptimistic({ ...before, ...patch(before) } as Item);
    try {
      this.applyOptimistic(await this.run(call));
    } catch (err) {
      this.pushError(err, details);
      if (before) this.applyOptimistic(before);
    }
  }

  async createItem(input: ItemCreate) {
    try {
      const created = await this.run(() => this.ws.createItem(input));
      // The items event carries this row too, so merge by id.
      this.slice.set({ items: mergeUniqueById(this.slice.value.items, [created]) });
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
    const before = this.slice.value.items.find((i) => i.id === itemId);
    if (before) this.removeById(itemId);
    try {
      await this.run(() => this.ws.deleteItem(itemId, expectedVersion));
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

  async refreshItem(itemId: string) {
    try {
      this.applyOptimistic(await this.run(() => this.ws.getItem(itemId)));
    } catch (err) {
      this.pushError(err);
    }
  }

  applyOptimistic(item: Item) {
    const items = this.slice.value.items.slice();
    const idx = items.findIndex((x) => x.id === item.id);
    if (idx >= 0) items[idx] = item;
    else items.unshift(item);
    // A rolled-back delete puts the row back, so it is no longer gone.
    this.forgetRemoved(item.id);
    this.slice.set({ items });
  }

  removeById(itemId: string) {
    const items = this.slice.value.items.filter((x) => x.id !== itemId);
    this.noteRemoved(itemId);
    this.slice.set({ items });
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

/** Existing rows in place (replaced when incoming has them), then the new ones. */
function mergeUniqueById(existing: Item[], incoming: Item[]): Item[] {
  const byId = new Map(incoming.map((i) => [i.id, i]));
  const known = new Set(existing.map((e) => e.id));
  return existing.map((e) => byId.get(e.id) ?? e).concat(incoming.filter((i) => !known.has(i.id)));
}

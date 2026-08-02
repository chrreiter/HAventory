import type {
  AreasListResult,
  BulkOperation,
  BulkResults,
  DistinctValues,
  ExportDocument,
  HassLike,
  HealthResult,
  ImportPolicy,
  ImportPreview,
  ImportSummary,
  IntegrationConfig,
  Item,
  ItemCreate,
  ItemFilter,
  ItemUpdate,
  ListItemsResult,
  Location,
  LocationTreeNode,
  ScalarValue,
  Sort,
  StatsCounts,
  Unsubscribe,
  VersionInfo,
  AnyEventPayload,
} from './types';

let nextSubscriptionId = 1;

export class WSClient {
  private hass: HassLike;

  constructor(hass: HassLike) {
    this.hass = hass;
  }

  // ---------- Utility ----------
  ping(echo?: unknown) {
    return this.hass.callWS<{ echo: unknown; ts: string }>({ type: 'haventory/ping', echo });
  }

  version() {
    return this.hass.callWS<VersionInfo>({ type: 'haventory/version' });
  }

  config() {
    return this.hass.callWS<IntegrationConfig>({ type: 'haventory/config' });
  }

  stats() {
    return this.hass.callWS<StatsCounts>({ type: 'haventory/stats' });
  }

  health() {
    return this.hass.callWS<HealthResult>({ type: 'haventory/health' });
  }

  distinctValues() {
    return this.hass.callWS<DistinctValues>({ type: 'haventory/distinct_values' });
  }

  // ---------- Items ----------
  getItem(itemId: string) {
    return this.hass.callWS<Item>({ type: 'haventory/item/get', item_id: itemId });
  }
  listItems(filter?: ItemFilter, sort?: Sort, limit?: number, cursor?: string) {
    const msg: Record<string, unknown> = { type: 'haventory/item/list' };
    if (filter) msg.filter = filter;
    if (sort) msg.sort = sort;
    if (typeof limit === 'number') msg.limit = limit;
    if (cursor) msg.cursor = cursor;
    return this.hass.callWS<ListItemsResult>(msg);
  }

  createItem(input: ItemCreate) {
    return this.hass.callWS<Item>({ type: 'haventory/item/create', ...input });
  }

  updateItem(itemId: string, changes: ItemUpdate, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/update', item_id: itemId, ...changes };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  deleteItem(itemId: string, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/delete', item_id: itemId };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<null>(payload);
  }

  adjustQuantity(itemId: string, delta: number, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/adjust_quantity', item_id: itemId, delta };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  setQuantity(itemId: string, quantity: number, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/set_quantity', item_id: itemId, quantity };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  checkOut(itemId: string, dueDate?: string | null, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/check_out', item_id: itemId };
    if (dueDate !== undefined) payload.due_date = dueDate;
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  markCheckedIn(itemId: string, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/check_in', item_id: itemId };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  setLowStockThreshold(itemId: string, threshold: number | null, expectedVersion?: number) {
    const payload: Record<string, unknown> = {
      type: 'haventory/item/set_low_stock_threshold',
      item_id: itemId,
      low_stock_threshold: threshold,
    };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  moveItem(itemId: string, locationId: string | null, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/move', item_id: itemId, location_id: locationId };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  /**
   * Additive tag edit. Preferred over sending the whole `tags` array through
   * item/update, which loses a concurrent edit made by another client.
   */
  addTags(itemId: string, tags: string[], expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/add_tags', item_id: itemId, tags };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  removeTags(itemId: string, tags: string[], expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/remove_tags', item_id: itemId, tags };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  updateCustomFields(
    itemId: string,
    set: Record<string, ScalarValue> | undefined,
    unset: string[] | undefined,
    expectedVersion?: number,
  ) {
    const payload: Record<string, unknown> = {
      type: 'haventory/item/update_custom_fields',
      item_id: itemId,
    };
    if (set) payload.set = set;
    if (unset) payload.unset = unset;
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return this.hass.callWS<Item>(payload);
  }

  /**
   * Run a mixed batch in one call. Partial failure is the normal case: the result
   * is keyed by `op_id` and each entry independently succeeded or failed. There is
   * no rollback — earlier successes stand.
   */
  bulk(operations: BulkOperation[]) {
    return this.hass.callWS<BulkResults>({ type: 'haventory/items/bulk', operations });
  }

  // ---------- Locations / Areas ----------
  listLocations() {
    return this.hass.callWS<Location[]>({ type: 'haventory/location/list' });
  }

  createLocation(name: string, parentId?: string | null, areaId?: string | null) {
    const msg: Record<string, unknown> = { type: 'haventory/location/create', name };
    if (parentId !== undefined) msg.parent_id = parentId;
    if (areaId !== undefined) msg.area_id = areaId;
    return this.hass.callWS<Location>(msg);
  }

  getLocation(locationId: string) {
    return this.hass.callWS<Location>({ type: 'haventory/location/get', location_id: locationId });
  }

  /**
   * Rename, re-area and/or re-parent in one call. `newParentId` moves the whole
   * subtree, so an edit that also re-parents lands atomically instead of needing
   * a second `move_subtree` round trip.
   */
  updateLocation(
    locationId: string,
    changes: { name?: string; areaId?: string | null; newParentId?: string | null },
  ) {
    const msg: Record<string, unknown> = { type: 'haventory/location/update', location_id: locationId };
    if (changes.name !== undefined) msg.name = changes.name;
    if (changes.areaId !== undefined) msg.area_id = changes.areaId;
    if (changes.newParentId !== undefined) msg.new_parent_id = changes.newParentId;
    return this.hass.callWS<Location>(msg);
  }

  deleteLocation(locationId: string) {
    return this.hass.callWS<null>({ type: 'haventory/location/delete', location_id: locationId });
  }

  moveLocationSubtree(locationId: string, newParentId: string | null) {
    return this.hass.callWS<Location>({
      type: 'haventory/location/move_subtree',
      location_id: locationId,
      new_parent_id: newParentId,
    });
  }

  /**
   * Nested tree nodes carrying `direct_item_count` / `subtree_item_count`.
   * With a filter each node also carries the matching pair, so a sidebar can
   * say how much of a location the active filter keeps.
   */
  getLocationTree(filter?: ItemFilter) {
    const msg: Record<string, unknown> = { type: 'haventory/location/tree' };
    if (filter) msg.filter = filter;
    return this.hass.callWS<LocationTreeNode[]>(msg);
  }

  listAreas() {
    return this.hass.callWS<AreasListResult>({ type: 'haventory/areas/list' });
  }

  // ---------- Import / export (data safety) ----------
  /** Build a versioned backup document (optionally filtered to matching items). */
  exportDocument(filter?: ItemFilter) {
    const msg: Record<string, unknown> = { type: 'haventory/export' };
    if (filter) msg.filter = filter;
    return this.hass.callWS<ExportDocument>(msg);
  }

  /** Validate + classify a document without mutating state. */
  importPreview(document: unknown, policy: ImportPolicy) {
    return this.hass.callWS<ImportPreview>({ type: 'haventory/import/preview', document, policy });
  }

  /** Apply a document with the chosen conflict policy (rolls back on failure). */
  importExecute(document: unknown, policy: ImportPolicy) {
    return this.hass.callWS<ImportSummary>({ type: 'haventory/import/execute', document, policy });
  }

  // ---------- Subscriptions ----------
  subscribe(
    topic: 'items' | 'locations' | 'stats',
    cb: (payload: AnyEventPayload) => void,
    opts?: {
      location_id?: string | null;
      include_subtree?: boolean;
      /**
       * Called when the backend rejects the subscribe — most importantly with
       * `rate_limited`, which otherwise kills live updates silently.
       */
      onError?: (err: unknown) => void;
      /**
       * Called once the backend has accepted the subscribe. The only positive
       * signal there is: a caller retrying a refused subscribe needs to know
       * when the topic is live again, and no event may ever arrive to prove it.
       */
      onOpen?: () => void;
    }
  ): Unsubscribe {
    const id = nextSubscriptionId++;
    const msg: Record<string, unknown> = {
      id,
      type: 'haventory/subscribe',
      topic,
    };
    if (opts && 'location_id' in opts) msg.location_id = opts.location_id ?? null;
    if (opts && 'include_subtree' in opts) msg.include_subtree = !!opts.include_subtree;

    const unsubOrPromise = this.hass.connection.subscribeMessage((event) => {
      // Home Assistant's `subscribeMessage` delivers the *inner* event payload
      // (the `event` field of the `{id, type:'event', event}` wire frame) to the
      // callback — NOT the whole envelope. Guard only against a nullish payload.
      if (!event) return;
      cb(event as AnyEventPayload);
    }, msg);

    // Home Assistant may return either an unsubscribe function or a Promise<unsubscribe>.
    if (typeof unsubOrPromise === 'function') {
      opts?.onOpen?.();
      return unsubOrPromise as unknown as Unsubscribe;
    }

    // Handle Promise<Unsubscribe> with early-cancel support.
    let resolvedUnsub: Unsubscribe | null = null;
    let cancelRequested = false;
    // The rejection handler is `then`'s second argument rather than a trailing
    // `catch`, so a throw from `onOpen` cannot be misread as a refused subscribe.
    Promise.resolve(unsubOrPromise).then(
      (fn) => {
        resolvedUnsub = fn as Unsubscribe;
        if (cancelRequested && resolvedUnsub) {
          try { resolvedUnsub(); } catch { /* ignore */ }
          return;
        }
        opts?.onOpen?.();
      },
      (err: unknown) => {
        // A rejected subscribe means no live updates at all. Report it so the
        // card can retry, go degraded and offer a manual refresh instead of
        // quietly showing stale data.
        opts?.onError?.(err);
      },
    );

    return () => {
      if (resolvedUnsub) {
        resolvedUnsub();
      } else {
        cancelRequested = true;
      }
    };
  }

  /**
   * Watch Home Assistant's area registry.
   *
   * Areas belong to HA, not to HAventory: renaming or deleting one moves no
   * inventory data, so no `haventory/subscribe` topic reports it. This is HA's
   * own event bus, subscribed the way the frontend's `subscribeEvents` does.
   * The callback takes no payload — the event says only that the registry
   * moved, and the caller refetches.
   *
   * A refused subscribe is swallowed: the card keeps the areas it already
   * holds, which is the whole of what it had before it listened at all.
   */
  subscribeAreaRegistry(cb: () => void): Unsubscribe {
    const unsubOrPromise = this.hass.connection.subscribeMessage(() => cb(), {
      type: 'subscribe_events',
      event_type: 'area_registry_updated',
    });

    if (typeof unsubOrPromise === 'function') return unsubOrPromise as unknown as Unsubscribe;

    let resolvedUnsub: Unsubscribe | null = null;
    let cancelRequested = false;
    Promise.resolve(unsubOrPromise).then(
      (fn) => {
        resolvedUnsub = fn as Unsubscribe;
        if (cancelRequested) resolvedUnsub();
      },
      () => undefined,
    );

    return () => {
      if (resolvedUnsub) {
        resolvedUnsub();
      } else {
        cancelRequested = true;
      }
    };
  }
}

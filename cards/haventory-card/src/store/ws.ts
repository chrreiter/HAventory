import { t } from '../i18n';
import { callWS, subscribeMessage } from '../ha-contract';
import type {
  AnyEventPayload,
  AreasListResult,
  AttachmentKind,
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
  Sort,
  StatsCounts,
  StatusColorValue,
  StatusDefinition,
  Unsubscribe,
  VersionInfo,
} from './types';

let nextSubscriptionId = 1;

export class WSClient {
  private hass: HassLike;

  constructor(hass: HassLike) {
    this.hass = hass;
  }

  // ---------- Utility ----------
  version() {
    return callWS<VersionInfo>(this.hass, { type: 'haventory/version' });
  }

  config() {
    return callWS<IntegrationConfig>(this.hass, { type: 'haventory/config' });
  }

  stats() {
    return callWS<StatsCounts>(this.hass, { type: 'haventory/stats' });
  }

  health() {
    return callWS<HealthResult>(this.hass, { type: 'haventory/health' });
  }

  /**
   * Distinct categories, tags and custom-field keys with usage counts. With a
   * filter each category and tag also carries `matching_count`; the lists
   * themselves never shrink, so autocomplete keeps its full vocabulary.
   */
  distinctValues(filter?: ItemFilter) {
    const msg: Record<string, unknown> = { type: 'haventory/distinct_values' };
    if (filter) msg.filter = filter;
    return callWS<DistinctValues>(this.hass, msg);
  }

  // ---------- Items ----------
  getItem(itemId: string) {
    return callWS<Item>(this.hass, { type: 'haventory/item/get', item_id: itemId });
  }
  listItems(filter?: ItemFilter, sort?: Sort, limit?: number, cursor?: string) {
    const msg: Record<string, unknown> = { type: 'haventory/item/list' };
    if (filter) msg.filter = filter;
    if (sort) msg.sort = sort;
    if (typeof limit === 'number') msg.limit = limit;
    if (cursor) msg.cursor = cursor;
    return callWS<ListItemsResult>(this.hass, msg);
  }

  createItem(input: ItemCreate) {
    return callWS<Item>(this.hass, { type: 'haventory/item/create', ...input });
  }

  updateItem(itemId: string, changes: ItemUpdate, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/update', item_id: itemId, ...changes };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  deleteItem(itemId: string, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/delete', item_id: itemId };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<null>(this.hass, payload);
  }

  adjustQuantity(itemId: string, delta: number, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/adjust_quantity', item_id: itemId, delta };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  setQuantity(itemId: string, quantity: number, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/set_quantity', item_id: itemId, quantity };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  checkOut(itemId: string, dueDate?: string | null, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/check_out', item_id: itemId };
    if (dueDate !== undefined) payload.due_date = dueDate;
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  markCheckedIn(itemId: string, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/check_in', item_id: itemId };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  /**
   * Mark a recurring reminder done and move it to its next occurrence.
   *
   * The next date is the backend's to work out — it counts from the series
   * anchor, which no client is sent in a form it could count from — so there is
   * nothing to send but the item and its version.
   */
  bumpReminder(itemId: string, expectedVersion?: number) {
    const payload: Record<string, unknown> = {
      type: 'haventory/reminder/bump',
      item_id: itemId,
    };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  setLowStockThreshold(itemId: string, threshold: number | null, expectedVersion?: number) {
    const payload: Record<string, unknown> = {
      type: 'haventory/item/set_low_stock_threshold',
      item_id: itemId,
      low_stock_threshold: threshold,
    };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  moveItem(itemId: string, locationId: string | null, expectedVersion?: number) {
    const payload: Record<string, unknown> = { type: 'haventory/item/move', item_id: itemId, location_id: locationId };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  /**
   * Run a mixed batch in one call. Partial failure is the normal case: the result
   * is keyed by `op_id` and each entry independently succeeded or failed. There is
   * no rollback — earlier successes stand.
   */
  bulk(operations: BulkOperation[]) {
    return callWS<BulkResults>(this.hass, { type: 'haventory/items/bulk', operations });
  }

  // ---------- Attachments ----------

  /**
   * Upload a file and attach it to an item, in the two steps the backend expects.
   *
   * The bytes go to Home Assistant core's `/api/file_upload` over HTTP — the
   * WebSocket carries JSON frames, and an 8 MB photo base64'd into one would be
   * both slower and larger. That POST hands back a `file_id`, which the
   * `attachment/add` command consumes.
   *
   * Resolves to the item as the backend now holds it, one version on: the
   * caller must take that item back into its form model, or its next save
   * fails with `conflict` against a version the upload already moved past.
   */
  async uploadAttachment(
    itemId: string,
    file: File,
    kind: AttachmentKind = 'picture',
    expectedVersion?: number,
  ): Promise<Item> {
    const fetchWithAuth = this.hass.fetchWithAuth;
    if (typeof fetchWithAuth !== 'function') {
      throw new Error(t('hv.store.cannotUpload'));
    }
    const body = new FormData();
    body.append('file', file);
    const response = await fetchWithAuth.call(this.hass, '/api/file_upload', {
      method: 'POST',
      body,
    });
    if (!response.ok) {
      throw new Error(t('hv.store.uploadFailed', { status: response.status }));
    }
    const { file_id: fileId } = (await response.json()) as { file_id: string };

    const payload: Record<string, unknown> = {
      type: 'haventory/item/attachment/add',
      item_id: itemId,
      file_id: fileId,
      kind,
      filename: file.name,
    };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  /**
   * Retitle one attachment.
   *
   * The stored filename never changes — it is what the bytes were uploaded as,
   * and the title is only what the card shows in its place.
   */
  updateAttachment(
    itemId: string,
    attachmentId: string,
    title: string,
    expectedVersion?: number,
  ) {
    const payload: Record<string, unknown> = {
      type: 'haventory/item/attachment/update',
      item_id: itemId,
      attachment_id: attachmentId,
      title,
    };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  /**
   * Renumber one kind's attachments; the first id named takes position 0.
   *
   * A picture at position 0 is the item's cover, so "make cover" is this
   * command rather than a flag of its own. The list must name every attachment
   * of that kind exactly once — the backend refuses a partial permutation.
   */
  reorderAttachments(
    itemId: string,
    kind: AttachmentKind,
    attachmentIds: string[],
    expectedVersion?: number,
  ) {
    const payload: Record<string, unknown> = {
      type: 'haventory/item/attachment/reorder',
      item_id: itemId,
      kind,
      attachment_ids: attachmentIds,
    };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  /** Detach one file from an item; the backend deletes the bytes with it. */
  removeAttachment(itemId: string, attachmentId: string, expectedVersion?: number) {
    const payload: Record<string, unknown> = {
      type: 'haventory/item/attachment/remove',
      item_id: itemId,
      attachment_id: attachmentId,
    };
    if (typeof expectedVersion === 'number') payload.expected_version = expectedVersion;
    return callWS<Item>(this.hass, payload);
  }

  /**
   * Sign a path so an `<img>` can fetch it.
   *
   * An `<img src>` carries no Authorization header, and the media view requires
   * one. Core's `auth/sign_path` hands back the same path with a short-lived
   * signature on it, which is what makes the tag work at all. The alternative —
   * `fetchWithAuth` plus `URL.createObjectURL` — pins every decoded image in JS
   * memory for the life of the view and needs manual revocation; a signed URL
   * lets the browser cache and evict it normally.
   */
  async signPath(path: string, expires: number): Promise<string> {
    const signed = await callWS<{ path: string }>(this.hass, {
      type: 'auth/sign_path',
      path,
      expires,
    });
    return signed.path;
  }

  // ---------- Locations / Areas ----------
  listLocations() {
    return callWS<Location[]>(this.hass, { type: 'haventory/location/list' });
  }

  createLocation(name: string, parentId?: string | null, areaId?: string | null) {
    const msg: Record<string, unknown> = { type: 'haventory/location/create', name };
    if (parentId !== undefined) msg.parent_id = parentId;
    if (areaId !== undefined) msg.area_id = areaId;
    return callWS<Location>(this.hass, msg);
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
    return callWS<Location>(this.hass, msg);
  }

  deleteLocation(locationId: string) {
    return callWS<null>(this.hass, { type: 'haventory/location/delete', location_id: locationId });
  }

  moveLocationSubtree(locationId: string, newParentId: string | null) {
    return callWS<Location>(this.hass, {
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
    return callWS<LocationTreeNode[]>(this.hass, msg);
  }

  listAreas() {
    return callWS<AreasListResult>(this.hass, { type: 'haventory/areas/list' });
  }

  // ---------- Import / export (data safety) ----------
  /** Build a versioned backup document (optionally filtered to matching items). */
  exportDocument(filter?: ItemFilter) {
    const msg: Record<string, unknown> = { type: 'haventory/export' };
    if (filter) msg.filter = filter;
    return callWS<ExportDocument>(this.hass, msg);
  }

  /** Validate + classify a document without mutating state. */
  importPreview(document: unknown, policy: ImportPolicy) {
    return callWS<ImportPreview>(this.hass, { type: 'haventory/import/preview', document, policy });
  }

  /** Apply a document with the chosen conflict policy (rolls back on failure). */
  importExecute(document: unknown, policy: ImportPolicy) {
    return callWS<ImportSummary>(this.hass, { type: 'haventory/import/execute', document, policy });
  }

  // ---------- Status definitions ----------

  /** The status vocabulary in display order. */
  listStatuses() {
    return callWS<StatusDefinition[]>(this.hass, { type: 'haventory/status/list' });
  }

  createStatus(status: {
    slug: string;
    label: string;
    color?: StatusColorValue;
    icon?: string;
    order?: number;
  }) {
    return callWS<StatusDefinition>(this.hass, { type: 'haventory/status/create', ...status });
  }

  /** Edit presentation only — the slug is what items store and cannot change. */
  updateStatus(
    slug: string,
    changes: { label?: string; color?: StatusColorValue; icon?: string; order?: number },
  ) {
    return callWS<StatusDefinition>(this.hass, {
      type: 'haventory/status/update',
      slug,
      ...changes,
    });
  }

  /** Rewrite display order. `slugs` must name every status exactly once. */
  reorderStatuses(slugs: string[]) {
    return callWS<StatusDefinition[]>(this.hass, { type: 'haventory/status/reorder', slugs });
  }

  /**
   * Delete a status.
   *
   * Refused while items still carry it unless `reassignTo` says where they go;
   * the move and the delete happen in one call, so no client can observe an
   * item naming a status that no longer exists.
   */
  deleteStatus(slug: string, reassignTo?: string) {
    return callWS<{ status: StatusDefinition; reassigned: number }>(this.hass, {
      type: 'haventory/status/delete',
      slug,
      ...(reassignTo ? { reassign_to: reassignTo } : {}),
    });
  }

  // ---------- Subscriptions ----------
  subscribe(
    topic: 'items' | 'locations' | 'stats' | 'statuses',
    cb: (payload: AnyEventPayload) => void,
    opts?: {
      location_id?: string | null;
      /** Multi-select beside `location_id`, unioned with it by the backend. */
      location_ids?: string[];
      area_id?: string | null;
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
    if (opts && 'location_ids' in opts) msg.location_ids = opts.location_ids ?? [];
    if (opts && 'area_id' in opts) msg.area_id = opts.area_id ?? null;
    if (opts && 'include_subtree' in opts) msg.include_subtree = !!opts.include_subtree;

    const unsubOrPromise = subscribeMessage(this.hass, (event) => {
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
   * Call back each time the connection comes back after a drop.
   *
   * Home Assistant re-issues the subscriptions it was holding before it fires
   * `ready`, so a dropped socket produces neither a refusal nor a fresh
   * `subscribeAreaRegistry` call — the watch simply resumes, and anything the
   * registry did meanwhile went to nobody. This event is the only notice the
   * card gets that such a gap happened at all.
   */
  onConnectionReady(cb: () => void): Unsubscribe {
    return this.onConnectionEvent('ready', cb);
  }

  /**
   * Call back when the socket closes, before Home Assistant reconnects.
   *
   * Without it a surface nobody is touching cannot tell that it went stale:
   * every other signal the card has comes from a call it made, so an idle list
   * would keep showing data from before the outage with nothing to say so.
   */
  onConnectionLost(cb: () => void): Unsubscribe {
    return this.onConnectionEvent('disconnected', cb);
  }

  /**
   * Attach one connection-lifecycle listener.
   *
   * Returns a no-op unsubscribe when the connection does not expose the
   * lifecycle, so a caller never has to branch on it.
   */
  private onConnectionEvent(event: 'ready' | 'disconnected', cb: () => void): Unsubscribe {
    const connection = this.hass.connection;
    const { addEventListener, removeEventListener } = connection;
    if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function') {
      return () => undefined;
    }
    const handler = () => cb();
    addEventListener.call(connection, event, handler);
    return () => removeEventListener.call(connection, event, handler);
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
   * A refusal is reported rather than thrown: the card keeps the areas it
   * already holds, which is the whole of what it had before it listened at all,
   * so the caller decides whether to retry. `onOpen` fires once the watch is
   * actually established, which is the caller's cue that a gap has closed.
   */
  subscribeAreaRegistry(
    cb: () => void,
    opts?: { onOpen?: () => void; onError?: (err: unknown) => void },
  ): Unsubscribe {
    const unsubOrPromise = subscribeMessage(this.hass, () => cb(), {
      type: 'subscribe_events',
      event_type: 'area_registry_updated',
    });

    if (typeof unsubOrPromise === 'function') {
      opts?.onOpen?.();
      return unsubOrPromise as unknown as Unsubscribe;
    }

    let resolvedUnsub: Unsubscribe | null = null;
    let cancelRequested = false;
    Promise.resolve(unsubOrPromise).then(
      (fn) => {
        resolvedUnsub = fn as Unsubscribe;
        if (cancelRequested) {
          resolvedUnsub();
          return;
        }
        opts?.onOpen?.();
      },
      (err: unknown) => opts?.onError?.(err),
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

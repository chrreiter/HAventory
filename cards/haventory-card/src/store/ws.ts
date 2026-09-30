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

  /** With a filter each category and tag also carries `matching_count`; the lists never shrink. */
  distinctValues(filter?: ItemFilter) {
    const msg: Record<string, unknown> = { type: 'haventory/distinct_values' };
    if (filter) msg.filter = filter;
    return callWS<DistinctValues>(this.hass, msg);
  }

  // ---------- Items ----------
  /** One command on one item, carrying `expected_version` only when one was given. */
  private itemCommand<T = Item>(
    type: string,
    itemId: string,
    fields: Record<string, unknown> = {},
    expectedVersion?: number,
  ) {
    const msg: Record<string, unknown> = { type: `haventory/${type}`, item_id: itemId, ...fields };
    if (typeof expectedVersion === 'number') msg.expected_version = expectedVersion;
    return callWS<T>(this.hass, msg);
  }

  getItem(itemId: string) {
    return this.itemCommand('item/get', itemId);
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
    return this.itemCommand('item/update', itemId, { ...changes }, expectedVersion);
  }

  deleteItem(itemId: string, expectedVersion?: number) {
    return this.itemCommand<null>('item/delete', itemId, {}, expectedVersion);
  }

  adjustQuantity(itemId: string, delta: number, expectedVersion?: number) {
    return this.itemCommand('item/adjust_quantity', itemId, { delta }, expectedVersion);
  }

  setQuantity(itemId: string, quantity: number, expectedVersion?: number) {
    return this.itemCommand('item/set_quantity', itemId, { quantity }, expectedVersion);
  }

  /** An explicit null due date clears it; `undefined` leaves the key off. */
  checkOut(itemId: string, dueDate?: string | null, expectedVersion?: number) {
    const fields = dueDate !== undefined ? { due_date: dueDate } : {};
    return this.itemCommand('item/check_out', itemId, fields, expectedVersion);
  }

  markCheckedIn(itemId: string, expectedVersion?: number) {
    return this.itemCommand('item/check_in', itemId, {}, expectedVersion);
  }

  /** The backend works out the next occurrence from the series anchor. */
  bumpReminder(itemId: string, expectedVersion?: number) {
    return this.itemCommand('reminder/bump', itemId, {}, expectedVersion);
  }

  setLowStockThreshold(itemId: string, threshold: number | null, expectedVersion?: number) {
    const fields = { low_stock_threshold: threshold };
    return this.itemCommand('item/set_low_stock_threshold', itemId, fields, expectedVersion);
  }

  moveItem(itemId: string, locationId: string | null, expectedVersion?: number) {
    return this.itemCommand('item/move', itemId, { location_id: locationId }, expectedVersion);
  }

  /** A mixed batch keyed by `op_id`; each entry succeeds or fails on its own, with no rollback. */
  bulk(operations: BulkOperation[]) {
    return callWS<BulkResults>(this.hass, { type: 'haventory/items/bulk', operations });
  }

  // ---------- Attachments ----------
  /**
   * Upload a file and attach it to an item. The bytes go to core's
   * `/api/file_upload` over HTTP rather than base64 over the socket, and the
   * `file_id` it answers is what `attachment/add` consumes.
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
    const response = await fetchWithAuth.call(this.hass, '/api/file_upload', { method: 'POST', body });
    if (!response.ok) {
      throw new Error(t('hv.store.uploadFailed', { status: response.status }));
    }
    const { file_id: fileId } = (await response.json()) as { file_id: string };
    const fields = { file_id: fileId, kind, filename: file.name };
    return this.itemCommand('item/attachment/add', itemId, fields, expectedVersion);
  }

  /** Retitle one attachment; the stored filename never changes. */
  updateAttachment(itemId: string, attachmentId: string, title: string, expectedVersion?: number) {
    const fields = { attachment_id: attachmentId, title };
    return this.itemCommand('item/attachment/update', itemId, fields, expectedVersion);
  }

  /**
   * Renumber one kind's attachments; the first id named takes position 0, the
   * cover for pictures. The backend refuses a list that misses one.
   */
  reorderAttachments(
    itemId: string,
    kind: AttachmentKind,
    attachmentIds: string[],
    expectedVersion?: number,
  ) {
    const fields = { kind, attachment_ids: attachmentIds };
    return this.itemCommand('item/attachment/reorder', itemId, fields, expectedVersion);
  }

  removeAttachment(itemId: string, attachmentId: string, expectedVersion?: number) {
    const fields = { attachment_id: attachmentId };
    return this.itemCommand('item/attachment/remove', itemId, fields, expectedVersion);
  }

  /**
   * Sign a path so an `<img>`, which sends no Authorization header, can load
   * it. Unlike a blob URL, a signed URL leaves caching to the browser.
   */
  async signPath(path: string, expires: number): Promise<string> {
    const signed = await callWS<{ path: string }>(this.hass, { type: 'auth/sign_path', path, expires });
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

  /** Rename, re-area and/or re-parent the whole subtree in one call. */
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

  /** With a filter each node also carries the matching pair of counts. */
  getLocationTree(filter?: ItemFilter) {
    const msg: Record<string, unknown> = { type: 'haventory/location/tree' };
    if (filter) msg.filter = filter;
    return callWS<LocationTreeNode[]>(this.hass, msg);
  }

  listAreas() {
    return callWS<AreasListResult>(this.hass, { type: 'haventory/areas/list' });
  }

  // ---------- Import / export (data safety) ----------
  exportDocument(filter?: ItemFilter) {
    const msg: Record<string, unknown> = { type: 'haventory/export' };
    if (filter) msg.filter = filter;
    return callWS<ExportDocument>(this.hass, msg);
  }

  importPreview(document: unknown, policy: ImportPolicy) {
    return callWS<ImportPreview>(this.hass, { type: 'haventory/import/preview', document, policy });
  }

  importExecute(document: unknown, policy: ImportPolicy) {
    return callWS<ImportSummary>(this.hass, { type: 'haventory/import/execute', document, policy });
  }

  // ---------- Status definitions ----------
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

  /** The slug is what items store and cannot change. */
  updateStatus(
    slug: string,
    changes: { label?: string; color?: StatusColorValue; icon?: string; order?: number },
  ) {
    return callWS<StatusDefinition>(this.hass, { type: 'haventory/status/update', slug, ...changes });
  }

  /** `slugs` must name every status exactly once. */
  reorderStatuses(slugs: string[]) {
    return callWS<StatusDefinition[]>(this.hass, { type: 'haventory/status/reorder', slugs });
  }

  /** Refused while items carry the status, unless `reassignTo` moves them in the same call. */
  deleteStatus(slug: string, reassignTo?: string) {
    return callWS<{ status: StatusDefinition; reassigned: number }>(this.hass, {
      type: 'haventory/status/delete',
      slug,
      ...(reassignTo ? { reassign_to: reassignTo } : {}),
    });
  }

  // ---------- Subscriptions ----------
  /**
   * Open one subscription. HA hands back the unsubscribe function or a promise
   * of one, and a refused promise is the only notice that live updates never
   * started. Called before the promise resolves, the returned closure records
   * the intent and the resolution unsubscribes at once.
   */
  private openSubscription(
    msg: Record<string, unknown>,
    onEvent: (event: AnyEventPayload) => void,
    opts?: { onOpen?: () => void; onError?: (err: unknown) => void },
  ): Unsubscribe {
    const unsubOrPromise = subscribeMessage(this.hass, onEvent, msg);

    if (typeof unsubOrPromise === 'function') {
      opts?.onOpen?.();
      return unsubOrPromise;
    }

    let resolvedUnsub: Unsubscribe | null = null;
    let cancelRequested = false;
    // `then`'s second argument, so a throw from `onOpen` is not read as a refusal.
    unsubOrPromise.then(
      (fn) => {
        resolvedUnsub = fn;
        if (cancelRequested) {
          // Nobody holds this any more, so a throwing unsubscribe has nobody to tell.
          try {
            fn();
          } catch {
            /* ignore */
          }
          return;
        }
        opts?.onOpen?.();
      },
      (err: unknown) => opts?.onError?.(err),
    );

    return () => {
      if (resolvedUnsub) resolvedUnsub();
      else cancelRequested = true;
    };
  }

  subscribe(
    topic: 'items' | 'locations' | 'stats' | 'statuses',
    cb: (payload: AnyEventPayload) => void,
    opts?: {
      location_ids?: string[];
      area_id?: string | null;
      include_subtree?: boolean;
      /** Called when the backend refuses the subscribe. */
      onError?: (err: unknown) => void;
      /** Called once the backend accepts it, the only positive signal there is. */
      onOpen?: () => void;
    },
  ): Unsubscribe {
    const msg: Record<string, unknown> = { id: nextSubscriptionId++, type: 'haventory/subscribe', topic };
    if (opts && 'location_ids' in opts) msg.location_ids = opts.location_ids ?? [];
    if (opts && 'area_id' in opts) msg.area_id = opts.area_id ?? null;
    if (opts && 'include_subtree' in opts) msg.include_subtree = !!opts.include_subtree;
    // HA delivers the inner `event` of the wire frame, not the envelope.
    return this.openSubscription(msg, cb, opts);
  }

  /**
   * Called each time the connection comes back. HA re-issues its subscriptions
   * before `ready`, so this is the only notice that events may have been missed.
   */
  onConnectionReady(cb: () => void): Unsubscribe {
    return this.onConnectionEvent('ready', cb);
  }

  /** Called when the socket closes, before HA reconnects. */
  onConnectionLost(cb: () => void): Unsubscribe {
    return this.onConnectionEvent('disconnected', cb);
  }

  /** A no-op unsubscribe when the connection does not expose the lifecycle. */
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
   * Watch HA's area registry, which no `haventory/subscribe` topic covers. The
   * callback takes no payload: the caller refetches. A refusal goes to
   * `onError`, and `onOpen` fires once the watch is established.
   */
  subscribeAreaRegistry(
    cb: () => void,
    opts?: { onOpen?: () => void; onError?: (err: unknown) => void },
  ): Unsubscribe {
    return this.openSubscription(
      { type: 'subscribe_events', event_type: 'area_registry_updated' },
      () => cb(),
      opts,
    );
  }
}

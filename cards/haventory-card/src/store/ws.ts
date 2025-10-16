import type {
  AreasListResult,
  HassLike,
  Item,
  ItemCreate,
  ItemFilter,
  ItemUpdate,
  ListItemsResult,
  Location,
  Sort,
  StatsCounts,
  Unsubscribe,
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
    return this.hass.callWS<{ integration_version: string; schema_version: number }>({ type: 'haventory/version' });
  }

  stats() {
    return this.hass.callWS<StatsCounts>({ type: 'haventory/stats' });
  }

  // ---------- Items ----------
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

  // ---------- Locations / Areas ----------
  listLocations() {
    return this.hass.callWS<Location[]>({ type: 'haventory/location/list' });
  }

  getLocationTree() {
    // The backend returns tree nodes; for typing keep as unknown[] | Location-like.
    return this.hass.callWS<unknown[]>({ type: 'haventory/location/tree' });
  }

  listAreas() {
    return this.hass.callWS<AreasListResult>({ type: 'haventory/areas/list' });
  }

  // ---------- Subscriptions ----------
  subscribe(
    topic: 'items' | 'locations' | 'stats',
    cb: (payload: AnyEventPayload) => void,
    opts?: { location_id?: string | null; include_subtree?: boolean }
  ): Unsubscribe {
    const id = nextSubscriptionId++;
    const msg: Record<string, unknown> = {
      id,
      type: 'haventory/subscribe',
      topic,
    };
    if (opts && 'location_id' in opts) msg.location_id = opts.location_id ?? null;
    if (opts && 'include_subtree' in opts) msg.include_subtree = !!opts.include_subtree;

    const unsubscribe = this.hass.subscribeMessage((message) => {
      // message: { id, type: 'event', event: AnyEventPayload }
      if (!message || message.type !== 'event') return;
      cb(message.event as AnyEventPayload);
    }, msg);
    return unsubscribe;
  }
}

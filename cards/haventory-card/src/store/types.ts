/**
 * Typed frontend models and WS shapes for HAventory.
 *
 * These mirror the backend WebSocket contract in custom_components/haventory/ws.py.
 */

export type ScalarValue = string | number | boolean;

export interface LocationPath {
  id_path: string[];
  name_path: string[];
  display_path: string;
  sort_key: string;
}

export interface Location {
  id: string;
  parent_id: string | null;
  name: string;
  area_id: string | null;
  path: LocationPath;
}

export interface Item {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  checked_out: boolean;
  due_date: string | null;
  location_id: string | null;
  tags: string[];
  category: string | null;
  low_stock_threshold: number | null;
  custom_fields: Record<string, ScalarValue>;
  created_at: string;
  updated_at: string;
  version: number;
  location_path: LocationPath;
}

export interface ItemCreate {
  name: string;
  description?: string | null;
  quantity?: number;
  checked_out?: boolean;
  due_date?: string | null;
  location_id?: string | null;
  tags?: string[];
  category?: string | null;
  low_stock_threshold?: number | null;
  custom_fields?: Record<string, ScalarValue>;
}

export interface ItemUpdate {
  name?: string;
  description?: string | null;
  quantity?: number;
  checked_out?: boolean;
  due_date?: string | null;
  location_id?: string | null;
  tags?: string[] | null;
  category?: string | null;
  low_stock_threshold?: number | null;
  custom_fields_set?: Record<string, ScalarValue>;
  custom_fields_unset?: string[];
}

export interface ItemFilter {
  q?: string;
  tags_any?: string[];
  tags_all?: string[];
  category?: string;
  checked_out?: boolean;
  low_stock_only?: boolean;
  location_id?: string | null;
  area_id?: string;
  include_subtree?: boolean;
  updated_after?: string;
  created_after?: string;
}

export type SortField = 'updated_at' | 'created_at' | 'name' | 'quantity';
export type SortOrder = 'asc' | 'desc';

export interface Sort {
  field: SortField;
  order: SortOrder;
}

export interface ListItemsResult {
  items: Item[];
  next_cursor: string | null;
}

export interface StatsCounts {
  items_total: number;
  low_stock_count: number;
  checked_out_count: number;
  locations_total: number;
}

export interface AreasListResult {
  areas: { id: string; name: string }[];
}

// WS subscription event payloads
export interface BaseEventPayload {
  domain: 'haventory';
  topic: 'items' | 'locations' | 'stats';
  action: string;
  ts: string;
}

export interface ItemsEventPayload extends BaseEventPayload {
  topic: 'items';
  item: Item;
  action:
    | 'created'
    | 'updated'
    | 'moved'
    | 'deleted'
    | 'checked_out'
    | 'checked_in'
    | 'quantity_changed';
}

export interface LocationsEventPayload extends BaseEventPayload {
  topic: 'locations';
  location: Location;
  action: 'created' | 'renamed' | 'moved' | 'deleted';
}

export interface StatsEventPayload extends BaseEventPayload {
  topic: 'stats';
  action: 'counts';
  counts: StatsCounts;
}

export type AnyEventPayload = ItemsEventPayload | LocationsEventPayload | StatsEventPayload;

export type Unsubscribe = () => void;

/** Minimal Home Assistant-like interface used by the WS client. */
export interface HassLike {
  // Home Assistant's callWS returns the `result` part of the message.
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  // subscribeMessage wires a callback to receive subsequent event messages; returns unsubscribe.
  subscribeMessage(cb: (msg: { id: number; type: 'event'; event: AnyEventPayload }) => void, msg: Record<string, unknown>): Unsubscribe;
}

export interface StoreFilters {
  q: string;
  areaId: string | null;
  locationId: string | null;
  includeSubtree: boolean;
  checkedOutOnly: boolean;
  lowStockFirst: boolean;
  sort: Sort; // default: { field: 'updated_at', order: 'desc' }
}

export interface StoreState {
  items: Item[];
  cursor: string | null;
  filters: StoreFilters;
  selection: Set<string>;
  pendingOps: Map<string, { kind: string; itemId?: string }>;
  errorQueue: ErrorEntry[];
  areasCache: AreasListResult | null;
  locationTreeCache: unknown[] | null; // backend returns nested tree nodes; UI shapes can extend
  // Optional flat locations cache to enrich UI (e.g., show area per node in selectors)
  locationsFlatCache: Location[] | null;
  statsCounts: StatsCounts | null;
  connected: { items: boolean; stats: boolean };
}

export interface ErrorEntry {
  id: string;
  code: string;
  message: string;
  context?: Record<string, unknown>;
  kind?: 'conflict' | 'error';
  itemId?: string;
  changes?: ItemUpdate;
}

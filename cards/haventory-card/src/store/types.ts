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
  inspection_date: string | null;
  location_id: string | null;
  tags: string[];
  category: string | null;
  low_stock_threshold: number | null;
  custom_fields: Record<string, ScalarValue>;
  created_at: string;
  updated_at: string;
  version: number;
  effective_area_id?: string | null;
  location_path: LocationPath;
}

export interface ItemCreate {
  name: string;
  description?: string | null;
  quantity?: number;
  checked_out?: boolean;
  due_date?: string | null;
  inspection_date?: string | null;
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
  inspection_date?: string | null;
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
  low_stock_first?: boolean;
  orphaned_only?: boolean;
  location_id?: string | null;
  area_id?: string;
  include_subtree?: boolean;
  updated_after?: string;
  created_after?: string;
}

export type SortField = 'updated_at' | 'created_at' | 'name' | 'quantity' | 'due_date' | 'inspection_date';
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

/** A distinct field value with its usage count (see haventory/distinct_values). */
export interface DistinctValue {
  value: string;
  count: number;
}

/** Result of haventory/distinct_values: distinct categories and tags with counts. */
export interface DistinctValues {
  categories: DistinctValue[];
  tags: DistinctValue[];
  /** Distinct custom-field keys across all items (sorted, case-insensitive). */
  custom_field_keys: string[];
}

/** Result of haventory/health: storage/index integrity as seen by the backend. */
export interface HealthResult {
  healthy: boolean;
  issues: string[];
  counts: StatsCounts;
  generation: number;
}

// ---------- Import / export (data safety) ----------

/** Conflict resolution policy for import/execute and import/preview. */
export type ImportPolicy = 'merge' | 'replace' | 'skip';

/** A versioned backup document produced by haventory/export. */
export interface ExportDocument {
  haventory_export_version: number;
  schema_version: number;
  exported_at: string;
  integration_version: string;
  items: unknown[];
  locations: unknown[];
}

/** A single structured validation problem in an import document. */
export interface ImportError {
  path: string;
  message: string;
}

/** Per-type classification counts in an import preview. */
export interface ImportBucketCounts {
  total: number;
  add: number;
  update: number;
  conflict: number;
  unchanged: number;
}

/** Per-type lists of entity ids by classification. */
export interface ImportBuckets {
  add: string[];
  update: string[];
  conflict: string[];
  unchanged: string[];
}

/** Result of haventory/import/preview: validation + classification, no mutation. */
export interface ImportPreview {
  valid: boolean;
  errors: ImportError[];
  policy: ImportPolicy;
  document: {
    haventory_export_version: number | null;
    schema_version: number | null;
    exported_at: string | null;
    integration_version: string | null;
  };
  items: ImportBuckets;
  locations: ImportBuckets;
  counts: { items?: ImportBucketCounts; locations?: ImportBucketCounts };
}

/** Result of haventory/import/execute after a successful apply. */
export interface ImportSummary {
  applied: boolean;
  policy: ImportPolicy;
  items: ImportBucketCounts;
  locations: ImportBucketCounts;
  totals: StatsCounts;
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
  // `item` is present for per-item actions; absent for the wholesale `reloaded`
  // signal emitted after an import replaces the dataset.
  item?: Item;
  action:
  | 'created'
  | 'updated'
  | 'moved'
  | 'deleted'
  | 'checked_out'
  | 'checked_in'
  | 'quantity_changed'
  | 'reloaded';
}

export interface LocationsEventPayload extends BaseEventPayload {
  topic: 'locations';
  location?: Location;
  action: 'created' | 'renamed' | 'moved' | 'deleted' | 'reloaded';
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
  // WebSocket connection with subscribeMessage to receive event messages; returns unsubscribe.
  // Home Assistant delivers the *inner* event payload to the callback (the `event`
  // field of the `{id, type:'event', event}` wire frame), not the whole envelope.
  connection: {
    subscribeMessage(
      cb: (event: AnyEventPayload) => void,
      msg: Record<string, unknown>,
    ): Unsubscribe | Promise<Unsubscribe>;
  };
}

export interface StoreFilters {
  q: string;
  areaId: string | null;
  locationId: string | null;
  includeSubtree: boolean;
  checkedOutOnly: boolean;
  lowStockFirst: boolean;
  orphansOnly: boolean;
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
  healthCache: HealthResult | null;
  // Distinct categories/tags with counts, sourcing category/tag autocomplete.
  distinctValuesCache: DistinctValues | null;
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

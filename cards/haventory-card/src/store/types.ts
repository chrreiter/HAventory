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
  /** Only items whose `due_date` is strictly before today (UTC). */
  overdue_only?: boolean;
  location_id?: string | null;
  area_id?: string;
  include_subtree?: boolean;
  updated_after?: string;
  created_after?: string;
  updated_before?: string;
  created_before?: string;
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
  /** Count of items matching the filter across all pages, independent of limit/cursor. */
  total: number;
}

export interface StatsCounts {
  items_total: number;
  low_stock_count: number;
  checked_out_count: number;
  /**
   * Items whose `due_date` has passed. Derived from the calendar rather than
   * stored state, so it can change with no event to announce it; optional
   * because older backends do not send it.
   */
  overdue_count?: number;
  locations_total: number;
  /** Items without a location (location_id == null). */
  no_location_count: number;
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

/** Rate-limiter state reported by haventory/health (opt-in; disabled by default). */
export interface RateLimitHealth {
  enabled: boolean;
  dropped_commands: number;
  dropped_events: number;
}

/** Result of haventory/health: storage/index integrity as seen by the backend. */
export interface HealthResult {
  healthy: boolean;
  issues: string[];
  counts: StatsCounts;
  generation: number;
  /** Present on every real backend; optional so older payloads still type-check. */
  rate_limit?: RateLimitHealth;
}

/** Result of haventory/version. */
export interface VersionInfo {
  integration_version: string;
  schema_version: number;
}

/**
 * A node of haventory/location/tree. Unlike the flat `location/list`, tree nodes
 * carry the per-location counts the sidebar and organize dialog display.
 */
export interface LocationTreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  area_id: string | null;
  path: LocationPath;
  /** Items filed directly on this location. */
  direct_item_count: number;
  /** Items on this location or any descendant (always >= direct_item_count). */
  subtree_item_count: number;
  /**
   * The two counts above restricted to what an active filter keeps. Present
   * only when `location/tree` was asked with a filter, so `undefined` means
   * "nothing was asked" rather than "nothing matches".
   */
  matching_direct_count?: number;
  matching_subtree_count?: number;
  children: LocationTreeNode[];
}

// ---------- Bulk operations (haventory/items/bulk) ----------

/**
 * Operation kinds the batch endpoint dispatches. Note there is deliberately no
 * `item_create` — the backend does not support creation in a batch.
 */
export type BulkOpKind =
  | 'item_update'
  | 'item_delete'
  | 'item_move'
  | 'item_adjust_quantity'
  | 'item_set_quantity'
  | 'item_check_out'
  | 'item_check_in'
  | 'item_add_tags'
  | 'item_remove_tags'
  | 'item_update_custom_fields'
  | 'item_set_low_stock_threshold';

export interface BulkOperation {
  /** Must be unique per call — the backend keys results by it and silently keeps the last duplicate. */
  op_id: string;
  kind: BulkOpKind;
  payload: Record<string, unknown>;
}

/** Per-operation failure. The backend names this key `context`, not `data`. */
export interface BulkOpError {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export type BulkOpResult = { success: true; result: Item } | { success: false; error: BulkOpError };

/** Raw haventory/items/bulk response: one entry per op_id. */
export interface BulkResults {
  results: Record<string, BulkOpResult>;
}

/** A failed operation paired back up with the op that produced it. */
export interface BulkFailure {
  op: BulkOperation;
  error: BulkOpError;
  /** Item id the op targeted, when it had one — lets the UI name the row. */
  itemId: string | null;
}

/** Aggregated outcome of a chunked bulk run. */
export interface BulkOutcome {
  succeeded: Item[];
  failed: BulkFailure[];
  /** True when the caller cancelled between chunks; already-applied chunks stand. */
  cancelled: boolean;
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

/** How a tag selection is combined: any of them, or all of them. */
export type TagMatchMode = 'any' | 'all';

export interface StoreFilters {
  q: string;
  areaId: string | null;
  locationId: string | null;
  includeSubtree: boolean;
  checkedOutOnly: boolean;
  /** Presentation hint, not a filter: re-sorts low-stock items to the front. */
  lowStockFirst: boolean;
  orphansOnly: boolean;
  /** A real filter, independent of `lowStockFirst` — both are separately clearable. */
  lowStockOnly: boolean;
  /** Only items past their due date. */
  overdueOnly: boolean;
  category: string | null;
  tags: string[];
  tagsMode: TagMatchMode;
  /** ISO-8601 instants; the backend compares strictly greater-than. */
  updatedAfter: string | null;
  createdAfter: string | null;
  /** ISO-8601 instants; the backend compares strictly less-than. */
  updatedBefore: string | null;
  createdBefore: string | null;
  sort: Sort; // default: { field: 'updated_at', order: 'desc' }
}

/**
 * Conditions that make the card quietly untrustworthy, so it can say so.
 *
 * Rate limiting can reject commands *and silently drop subscription events*, and
 * events carry no sequence number, so a card cannot detect a gap on its own. The
 * contract's stated recovery is that the client re-lists on demand — hence the
 * explicit Refresh action these flags drive.
 */
export interface DegradedState {
  /** A command or a subscribe came back `rate_limited`. */
  rateLimited: boolean;
  /** Consecutive transport-level failures — best-effort, lags a real outage by one call. */
  connectionLost: boolean;
  /** Commands currently waiting on an automatic retry. */
  retrying: number;
  /** Epoch ms of the next scheduled retry, when one is pending. */
  nextRetryAt: number | null;
  /** True while reloading after an import replaced the dataset. */
  reloading: boolean;
}

export interface StoreState {
  items: Item[];
  cursor: string | null;
  /** Items matching the active filter across all pages (not just the loaded page). */
  total: number | null;
  /** True until the first list resolves — drives skeleton rows. */
  loading: boolean;
  filters: StoreFilters;
  selection: Set<string>;
  pendingOps: Map<string, { kind: string; itemId?: string }>;
  errorQueue: ErrorEntry[];
  areasCache: AreasListResult | null;
  locationTreeCache: LocationTreeNode[] | null;
  /**
   * Items matching the active filter ignoring its location dimension — the
   * denominator-free half of the sidebar's "4 / 37". Null when no filter is on.
   */
  locationMatchTotal: number | null;
  // Optional flat locations cache to enrich UI (e.g., show area per node in selectors)
  locationsFlatCache: Location[] | null;
  statsCounts: StatsCounts | null;
  healthCache: HealthResult | null;
  versionInfo: VersionInfo | null;
  // Distinct categories/tags with counts, sourcing category/tag autocomplete.
  distinctValuesCache: DistinctValues | null;
  connected: { items: boolean; stats: boolean };
  degraded: DegradedState;
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

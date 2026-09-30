/** Frontend models and WS shapes, mirroring the contract in custom_components/haventory/ws.py. */

import type { QuickFilterKey } from '../ui/quick-filters';

export type ScalarValue = string | number | boolean;

/**
 * The slug of one status definition; `ok` is the default and how a flagged state
 * clears. A string, not a union: a household defines its own statuses.
 */
export type ItemStatus = string;

/** A status tone: five hues, each in a light and a strong form. */
export type StatusColor =
  | 'neutral'
  | 'neutral_strong'
  | 'green'
  | 'green_strong'
  | 'blue'
  | 'blue_strong'
  | 'amber'
  | 'amber_strong'
  | 'red'
  | 'red_strong';

/**
 * One of the ten tones or a `#rrggbb` literal. Widened to `string` because the
 * backend validates the spelling and an unknown token renders as the neutral chip.
 */
export type StatusColorValue = StatusColor | string;

/** A status: an immutable `slug` (what items store) and an editable `label`. */
export interface StatusDefinition {
  slug: string;
  label: string;
  order: number;
  color?: StatusColorValue;
  /** One of the glyph names in `ui/icons.ts`. */
  icon?: string;
}

export type AttachmentKind = 'picture' | 'manual';

/**
 * Metadata for one attached file. The bytes come from the authenticated media
 * view; an export carries only this, so a reference can outlive its file.
 */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  filename: string;
  mime: string;
  size: number;
  uploaded_at: string;
  /** What the user called it. Empty means show `filename` instead. */
  title?: string;
  /** Position within the item's attachments of this kind; 0 is the cover. */
  order?: number;
}

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

/** How far apart a recurring reminder's occurrences fall. */
export type ReminderUnit = 'days' | 'weeks' | 'months';

export interface ReminderInterval {
  unit: ReminderUnit;
  count: number;
}

export interface Item {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  /** Absent reads as `ok`. */
  status?: ItemStatus;
  checked_out: boolean;
  due_date: string | null;
  inspection_date: string | null;
  /**
   * `reminder_date` alone is a one-off; with an interval it is the next
   * occurrence of a series. `reminder_anchor` is what the series is measured
   * from and only the backend writes it, so it is absent from the write shapes.
   */
  reminder_date?: string | null;
  reminder_anchor?: string | null;
  reminder_interval?: ReminderInterval | null;
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
  /** Written only by the attachment commands, never by an item save. */
  attachments?: Attachment[];
}

export interface ItemCreate {
  name: string;
  description?: string | null;
  quantity?: number;
  status?: ItemStatus;
  checked_out?: boolean;
  due_date?: string | null;
  inspection_date?: string | null;
  reminder_date?: string | null;
  reminder_interval?: ReminderInterval | null;
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
  /** Non-nullable: `ok` is how a flagged state clears, never `null`. */
  status?: ItemStatus;
  checked_out?: boolean;
  due_date?: string | null;
  inspection_date?: string | null;
  reminder_date?: string | null;
  reminder_interval?: ReminderInterval | null;
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
  /** Unioned with `category`; an empty list does not narrow. */
  categories?: string[];
  status?: ItemStatus;
  checked_out?: boolean;
  low_stock_only?: boolean;
  low_stock_first?: boolean;
  orphaned_only?: boolean;
  /** `overdue_only` / `inspection_overdue_only`: the date is before today (UTC). */
  overdue_only?: boolean;
  /** The `*_due_only` keys: the date is on or before today (UTC). */
  checked_out_due_only?: boolean;
  inspection_overdue_only?: boolean;
  inspection_due_only?: boolean;
  reminder_due_only?: boolean;
  location_id?: string | null;
  /** Unioned with `location_id`; `include_subtree` applies to the whole selection. */
  location_ids?: string[];
  area_id?: string;
  include_subtree?: boolean;
  updated_after?: string;
  created_after?: string;
  updated_before?: string;
  created_before?: string;
}

export type SortField =
  | 'updated_at'
  | 'created_at'
  | 'name'
  | 'quantity'
  | 'due_date'
  | 'inspection_date'
  | 'reminder_date'
  /** The item's denormalized location path. Not an area sort — see the contract. */
  | 'location';
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
   * The date-derived counts can change with no event to announce them. `*_overdue`
   * counts dates before today; `*_due` counts include today.
   */
  overdue_count?: number;
  checked_out_due_count?: number;
  inspection_overdue_count?: number;
  inspection_due_count?: number;
  reminder_due_count?: number;
  missing_count?: number;
  needs_repair_count?: number;
  /** Every defined status slug to its item count, `ok` included. */
  status_counts?: Record<string, number>;
  locations_total: number;
  /** Items without a location (location_id == null). */
  no_location_count: number;
}

/** An HA area as `haventory/areas` reports it: registry id and display name. */
export interface AreaRef {
  id: string;
  name: string;
}

export interface AreasListResult {
  areas: AreaRef[];
}

/** A distinct field value with its usage count (see haventory/distinct_values). */
export interface DistinctValue {
  value: string;
  count: number;
  /** Present only when the request carried a filter; `undefined` is not zero. */
  matching_count?: number;
}

/** Result of haventory/distinct_values: distinct categories and tags with counts. */
export interface DistinctValues {
  categories: DistinctValue[];
  tags: DistinctValue[];
  /** Distinct custom-field keys across all items (sorted, case-insensitive). */
  custom_field_keys: string[];
}

/** Result of haventory/version. */
export interface VersionInfo {
  integration_version: string;
  schema_version: number;
}

/**
 * Attachment limits from `haventory/config`, so the picker can refuse a file
 * early. The backend re-checks every one against the file's own bytes.
 */
export interface MediaConfig {
  picture_mime_types: string[];
  max_pictures_per_item: number;
  manual_mime_types?: string[];
  max_manuals_per_item?: number;
  max_attachment_bytes: number;
}

/** Result of haventory/config: the config-entry settings the card renders. */
export interface IntegrationConfig {
  /** Heading set in the integration's options flow. */
  card_title: string;
  /**
   * `null` (no opinion) leaves the choice to the dashboard's `quick_filters:`;
   * `[]` is a choice of no pills.
   */
  quick_filters?: string[] | null;
  statuses?: StatusDefinition[];
  media?: MediaConfig;
}

/** A node of haventory/location/tree, with the per-location item counts. */
export interface LocationTreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  area_id: string | null;
  path: LocationPath;
  direct_item_count: number;
  /** Items on this location or any descendant. */
  subtree_item_count: number;
  /** The two counts above under a filter; present only when one was sent. */
  matching_direct_count?: number;
  matching_subtree_count?: number;
  children: LocationTreeNode[];
}

// ---------- Bulk operations (haventory/items/bulk) ----------

/** The batch endpoint has no `item_create`. */
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

export interface ImportError {
  path: string;
  message: string;
}

/**
 * A finding that never affects `valid`. `name_collision`: an incoming entity
 * takes a name a stored entity of a different id has, so import duplicates it.
 */
export interface ImportWarning {
  code: 'name_collision' | string;
  path: string;
  message: string;
  name?: string;
  existing_ids?: string[];
}

export interface ImportBucketCounts {
  total: number;
  add: number;
  update: number;
  conflict: number;
  unchanged: number;
}

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
  warnings?: ImportWarning[];
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
  /** Attachment references the import would hold, and how many name no file here. */
  attachments?: { referenced: number; missing: number };
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
  // A `statuses` event only signals a re-read, so it has no payload shape below.
  topic: 'items' | 'locations' | 'stats' | 'statuses';
  action: string;
  ts: string;
}

/** Sent on every open subscription when the config entry serving it tears down. */
export type TeardownAction = 'unavailable';

export interface ItemsEventPayload extends BaseEventPayload {
  topic: 'items';
  // Absent when the dataset moved wholesale, which is a refetch signal.
  item?: Item;
  action:
  | 'created'
  | 'updated'
  | 'moved'
  | 'deleted'
  | 'checked_out'
  | 'checked_in'
  | 'quantity_changed'
  | 'reloaded'
  | TeardownAction;
}

export interface LocationsEventPayload extends BaseEventPayload {
  topic: 'locations';
  location?: Location;
  action: 'created' | 'renamed' | 'moved' | 'deleted' | 'reloaded' | TeardownAction;
}

export interface StatsEventPayload extends BaseEventPayload {
  topic: 'stats';
  action: 'counts' | TeardownAction;
  counts: StatsCounts;
}

export type AnyEventPayload = ItemsEventPayload | LocationsEventPayload | StatsEventPayload;

export type Unsubscribe = () => void;

export type { HassLike } from '../ha-contract';

export type TagMatchMode = 'any' | 'all';

export interface StoreFilters {
  q: string;
  areaId: string | null;
  /** Unioned; empty means every location. `includeSubtree` covers the whole selection. */
  locationIds: string[];
  includeSubtree: boolean;
  checkedOutOnly: boolean;
  /** A sort hint, not a filter: low-stock items first. */
  lowStockFirst: boolean;
  orphansOnly: boolean;
  lowStockOnly: boolean;
  /** Due date before today. */
  overdueOnly: boolean;
  /** Inspection / reminder date on or before today. */
  inspectionDueOnly: boolean;
  reminderDueOnly: boolean;
  /** null means any. */
  status: ItemStatus | null;
  /** Unioned; empty means every category. */
  categories: string[];
  tags: string[];
  tagsMode: TagMatchMode;
  /** ISO-8601 instants; the backend compares strictly greater-than. */
  updatedAfter: string | null;
  createdAfter: string | null;
  /** ISO-8601 instants; the backend compares strictly less-than. */
  updatedBefore: string | null;
  createdBefore: string | null;
  sort: Sort;
}

/**
 * Conditions that make the card quietly untrustworthy. Events carry no sequence
 * number, so a missed one is undetectable and the recovery is an explicit re-list.
 */
export interface DegradedState {
  /** The socket closed and stayed closed, or calls keep failing before they reach a server. */
  connectionLost: boolean;
  /** True while reloading after an import replaced the dataset. */
  reloading: boolean;
  liveUpdates: LiveUpdateState;
  /** null while live. */
  liveUpdatesReason: LiveUpdatePause | null;
  /** Epoch ms of the next automatic re-subscribe, when one is scheduled. */
  nextLiveRetryAt: number | null;
}

/** `retrying`: a refused subscribe is on a bounded backoff. `paused`: only a refresh resumes. */
export type LiveUpdateState = 'live' | 'retrying' | 'paused';

/** `unavailable`: no config entry owns the data, so every command is refused too. */
export type LiveUpdatePause = 'unavailable';

export interface StoreState {
  items: Item[];
  cursor: string | null;
  /** Items matching the active filter across all pages. */
  total: number | null;
  /** True until the first list resolves. */
  loading: boolean;
  filters: StoreFilters;
  selection: Set<string>;
  errorQueue: ErrorEntry[];
  areasCache: AreasListResult | null;
  locationTreeCache: LocationTreeNode[] | null;
  /** Items matching the active filter ignoring its locations; null when no filter is on. */
  locationMatchTotal: number | null;
  locationsFlatCache: Location[] | null;
  statsCounts: StatsCounts | null;
  versionInfo: VersionInfo | null;
  cardTitle: string | null;
  /** The integration's pills; a dashboard's own `quick_filters:` outranks it. */
  quickFilters: QuickFilterKey[] | null;
  mediaConfig: MediaConfig | null;
  /** null until read; `ui/status` falls back to the built-in three. */
  statuses: StatusDefinition[] | null;
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

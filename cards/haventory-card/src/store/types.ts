/**
 * Typed frontend models and WS shapes for HAventory.
 *
 * These mirror the backend WebSocket contract in custom_components/haventory/ws.py.
 */

import type { QuickFilterKey } from '../ui/quick-filters';

export type ScalarValue = string | number | boolean;

/**
 * Stored per-item condition: the slug of one status definition. Non-nullable on
 * the backend — every item has exactly one, `ok` being the default and the way a
 * flagged state clears.
 *
 * Not a union of the built-in three: a household defines its own statuses, so
 * the set is data the backend reports, not something this file can enumerate.
 */
export type ItemStatus = string;

/**
 * One entry of the backend's status vocabulary: an immutable `slug` (what items
 * store) and an editable `label` (what a surface shows). Renaming a status
 * touches only the label, so no item is ever rewritten.
 *
 * A tone: five hues, each in a light and a strong form.
 */
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
 * What a status is painted in: one of the ten tones, or a `#rrggbb` literal a
 * household entered. Widened to `string` rather than a template-literal type
 * because the backend validates the spelling and the card must render whatever
 * came back — including a token from a newer backend, which falls back to the
 * neutral chip rather than failing to type-check a stored value.
 */
export type StatusColorValue = StatusColor | string;

export interface StatusDefinition {
  slug: string;
  label: string;
  order: number;
  /** Optional: a backend older than the appearance fields does not send them. */
  color?: StatusColorValue;
  /** One of the glyph names in `ui/icons.ts`. */
  icon?: string;
}

/** What an item can carry. Only `picture` has a card surface today. */
export type AttachmentKind = 'picture' | 'manual';

/**
 * Metadata for one file attached to an item. The bytes live on the server and
 * are fetched from the authenticated media view, never embedded here — and a
 * JSON export carries this metadata without them, so a reference can outlive
 * the file it names.
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
  /** Optional because older backends do not send it; absent reads as `ok`. */
  status?: ItemStatus;
  checked_out: boolean;
  due_date: string | null;
  inspection_date: string | null;
  /**
   * Optional because a backend older than schema v8 does not send them; absent
   * reads as no reminder. The anchor alone is a one-off; with an interval it is
   * the start of a series the calendar expands on read.
   */
  reminder_date?: string | null;
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
  /**
   * Optional because older backends do not send it; absent reads as none.
   * Written only by the two attachment commands — an ordinary item save never
   * carries it.
   */
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
  /**
   * Multi-select beside `category`, unioned with it — an item has exactly one
   * category, so a selection can only mean OR. An empty list does not narrow.
   */
  categories?: string[];
  /** Exact match against one status; unknown values are `validation_error`. */
  status?: ItemStatus;
  checked_out?: boolean;
  low_stock_only?: boolean;
  low_stock_first?: boolean;
  orphaned_only?: boolean;
  /** Only items whose `due_date` is strictly before today (UTC). */
  overdue_only?: boolean;
  /**
   * Only items whose `inspection_date` is strictly before today (UTC) — i.e.
   * the next inspection is already missed. Independent of check-out state.
   */
  inspection_overdue_only?: boolean;
  location_id?: string | null;
  /**
   * Multi-select beside `location_id`, unioned with it. `include_subtree` is
   * one flag for the whole selection, not one per entry.
   */
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
   * Items whose `due_date` has passed. Derived from the calendar rather than
   * stored state, so it can change with no event to announce it; optional
   * because older backends do not send it.
   */
  overdue_count?: number;
  /**
   * Items past the date they were next due for inspection, across the whole
   * inventory. Calendar-derived like `overdue_count`, and optional for the
   * same reason: an older backend does not send it.
   */
  inspection_overdue_count?: number;
  /**
   * Items whose stored `status` is `missing` / `needs_repair`. Stored state,
   * not calendar-derived — every mutation that moves them emits fresh counts.
   * Optional because an older backend does not send them.
   */
  missing_count?: number;
  needs_repair_count?: number;
  /**
   * Every defined status slug to its item count, including `ok` — which the
   * backend's index deliberately does not bucket but still counts. Additive to
   * the two keys above rather than a replacement for them.
   */
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
  /**
   * How many of this value's items the request's filter keeps. Present only
   * when the request carried a filter, so `undefined` means "unpriced" rather
   * than "nothing matches" — a backend older than this never sends it.
   */
  matching_count?: number;
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
 * Attachment limits and routes, as `haventory/config` reports them.
 *
 * Reported so the picker can refuse an oversized or wrong-typed file before it
 * is sent — never so the backend can trust that it did. Every one of these is
 * re-checked server-side, against the file's own bytes.
 */
export interface MediaConfig {
  picture_mime_types: string[];
  max_pictures_per_item: number;
  /** Accepted document types. Absent on a backend that predates manuals. */
  manual_mime_types?: string[];
  max_manuals_per_item?: number;
  max_attachment_bytes: number;
}

/** Result of haventory/config: the config-entry settings the card renders. */
export interface IntegrationConfig {
  /** Heading set in the integration's options flow. */
  card_title: string;
  /**
   * Which quick-filter pills the integration offers, or `null` when it has no
   * opinion — which is also what an older backend's silence reads as. `null`
   * and `[]` are different answers: no opinion leaves the choice to the
   * dashboard's own `quick_filters:`, an empty list is a choice of no pills.
   */
  quick_filters?: string[] | null;
  /** The status vocabulary. Optional: an older backend does not send it. */
  statuses?: StatusDefinition[];
  /** Attachment caps and the media route. Optional for the same reason. */
  media?: MediaConfig;
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

/**
 * A non-blocking finding about an otherwise valid import document.
 *
 * Warnings never affect `valid` and never reach `import/execute` — the preview
 * tells, the entity id still decides. `code` discriminates the kind:
 * `name_collision` is an incoming entity about to be created under a name a
 * stored entity of a *different* id already answers to, which import duplicates
 * rather than merges.
 */
export interface ImportWarning {
  code: 'name_collision' | string;
  path: string;
  message: string;
  name?: string;
  /**
   * Every stored entity the name collides with, not just one. A location tree
   * repeats leaf names ("Shelf A", "Drawer 1"), so a hand-rebuilt tree collides
   * several deep on the same name at once.
   */
  existing_ids?: string[];
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
  /** Optional so a preview from a backend that predates warnings still type-checks. */
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
  // The four topics `haventory/subscribe` accepts. Only three have a payload
  // shape below: a `statuses` event is a signal to re-read the vocabulary, not
  // a patch to apply, so the store never narrows one.
  topic: 'items' | 'locations' | 'stats' | 'statuses';
  action: string;
  ts: string;
}

/**
 * Sent on every open subscription, whatever its topic, when the config entry
 * serving it tears down — an unload, a disable, a removal, or the first half of
 * a reload. Carries no payload: it says the subscription has stopped, not that
 * anything in the inventory changed.
 */
export type TeardownAction = 'unavailable';

export interface ItemsEventPayload extends BaseEventPayload {
  topic: 'items';
  // `item` is present for per-item actions and absent whenever the dataset
  // moved wholesale — the `reloaded` signal after an import, and an `updated`
  // signal after a status delete reassigned every item carrying the slug.
  // Absence is a refetch signal: there is nothing to merge.
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

/** Minimal Home Assistant-like interface used by the WS client. */
export interface HassLike {
  // Home Assistant's callWS returns the `result` part of the message.
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  /**
   * `fetch` with the user's auth header attached — the only way to POST to
   * core's `/api/file_upload`, which is how attachment bytes reach the server
   * without crossing the WebSocket. Optional because this interface is
   * structural: a caller that never uploads need not provide it.
   */
  fetchWithAuth?(path: string, init?: RequestInit): Promise<Response>;
  // WebSocket connection with subscribeMessage to receive event messages; returns unsubscribe.
  // Home Assistant delivers the *inner* event payload to the callback (the `event`
  // field of the `{id, type:'event', event}` wire frame), not the whole envelope.
  connection: {
    subscribeMessage(
      cb: (event: AnyEventPayload) => void,
      msg: Record<string, unknown>,
    ): Unsubscribe | Promise<Unsubscribe>;
    // Connection lifecycle. `disconnected` fires when the socket closes, before
    // Home Assistant starts reconnecting; `ready` fires once it is back and HA
    // has re-issued the subscriptions it was holding, so a listener runs with
    // the watches already live again. Optional because the interface is
    // structural: a caller may pass a connection that only sends messages.
    addEventListener?(event: 'ready' | 'disconnected', cb: () => void): void;
    removeEventListener?(event: 'ready' | 'disconnected', cb: () => void): void;
  };
}

/** How a tag selection is combined: any of them, or all of them. */
export type TagMatchMode = 'any' | 'all';

export interface StoreFilters {
  q: string;
  areaId: string | null;
  /**
   * The locations the list is narrowed to, unioned. Empty means every
   * location; `includeSubtree` governs the whole selection at once.
   */
  locationIds: string[];
  includeSubtree: boolean;
  checkedOutOnly: boolean;
  /** Presentation hint, not a filter: re-sorts low-stock items to the front. */
  lowStockFirst: boolean;
  orphansOnly: boolean;
  /** A real filter, independent of `lowStockFirst` — both are separately clearable. */
  lowStockOnly: boolean;
  /** Only items past their due date. */
  overdueOnly: boolean;
  /** Only items past the date they were next due for inspection. */
  inspectionDueOnly: boolean;
  /** Only items with this stored status; null means any. */
  status: ItemStatus | null;
  /** The categories the list is narrowed to, unioned. Empty means every category. */
  categories: string[];
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
  /** The socket closed and stayed closed, or calls keep failing before they reach a server. */
  connectionLost: boolean;
  /** Commands currently waiting on an automatic retry. */
  retrying: number;
  /** Epoch ms of the next scheduled retry, when one is pending. */
  nextRetryAt: number | null;
  /** True while reloading after an import replaced the dataset. */
  reloading: boolean;
  /** Whether the topic subscriptions are up, being re-opened, or given up on. */
  liveUpdates: LiveUpdateState;
  /** Why live updates are not `live`; null while they are. */
  liveUpdatesReason: LiveUpdatePause | null;
  /** Epoch ms of the next automatic re-subscribe, when one is scheduled. */
  nextLiveRetryAt: number | null;
}

/**
 * State of the three topic subscriptions.
 *
 * `retrying` means a refused subscribe is being re-attempted on a bounded
 * backoff; `paused` means the budget is spent, so only an explicit refresh
 * brings live updates back.
 */
export type LiveUpdateState = 'live' | 'retrying' | 'paused';

/**
 * What stopped live updates — the two cases read the same to the subscription
 * machinery and completely differently to the person reading the banner.
 *
 * `rate_limited`: the limiter refused the subscribe; the backend is there and
 * the data on screen is current as of the last event.
 * `unavailable`: no config entry owns the data — HAventory is reloading, or has
 * been disabled or removed — so every command is being refused too.
 */
export type LiveUpdatePause = 'rate_limited' | 'unavailable';

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
  /** Heading configured in the integration, or null until it has been read. */
  cardTitle: string | null;
  /**
   * Quick-filter pills chosen in the integration's options flow, or null when
   * it has none — the state a fresh install, an older backend and a store that
   * has not answered yet all share. A dashboard's own `quick_filters:` outranks
   * it; the sidebar panel has no dashboard config, so this is all it reads.
   */
  quickFilters: QuickFilterKey[] | null;
  /**
   * Attachment caps and the media route, or null until `haventory/config` has
   * answered — or permanently, against a backend too old to report them.
   */
  mediaConfig: MediaConfig | null;
  /**
   * The status vocabulary, or null until `haventory/config` has answered — or
   * permanently, against a backend too old to report it. `ui/status` falls back
   * to the built-in three either way.
   */
  statuses: StatusDefinition[] | null;
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

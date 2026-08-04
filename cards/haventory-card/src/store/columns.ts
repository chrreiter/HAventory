/**
 * Configurable columns for the full view's table.
 *
 * The Name column and the trailing actions are always shown; the columns
 * defined here are the optional, user-selectable middle ones. The standard
 * card draws its own compact row and takes no selection, so this is the full
 * view's setting alone. The choice is persisted in localStorage (per browser).
 */

export type ColumnKey =
  | 'quantity'
  | 'status'
  | 'category'
  | 'location'
  | 'tags'
  | 'due_date'
  | 'inspection_date'
  | 'updated_at';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** grid-template-columns sizing for the full-view table. */
  tableSize: string;
  /**
   * The backend sort field this column maps to, when it has one. Status,
   * category, location and tags are deliberately absent: the API cannot sort by
   * them, and a header that looks clickable but does nothing is worse than a
   * plain one.
   */
  sortField?: 'quantity' | 'due_date' | 'inspection_date' | 'updated_at';
}

/** Canonical column order. Selections are normalized to this order. */
export const COLUMN_DEFS: readonly ColumnDef[] = [
  { key: 'quantity', label: 'Qty', tableSize: '70px', sortField: 'quantity' },
  // Wide enough for the "Needs repair" chip on one line: a status that wrapped
  // or clipped would be unreadable in exactly the rows that matter most.
  { key: 'status', label: 'Status', tableSize: '112px' },
  { key: 'category', label: 'Category', tableSize: 'minmax(110px, 1fr)' },
  { key: 'location', label: 'Location', tableSize: 'minmax(110px, 1fr)' },
  { key: 'tags', label: 'Tags', tableSize: 'minmax(120px, 1.4fr)' },
  { key: 'due_date', label: 'Due', tableSize: '100px', sortField: 'due_date' },
  {
    key: 'inspection_date',
    label: 'Next inspection',
    // Wider than the other date columns because the header is what sets the
    // floor here, not the "Jul 31" it sits above.
    tableSize: '124px',
    sortField: 'inspection_date',
  },
  { key: 'updated_at', label: 'Updated', tableSize: '96px', sortField: 'updated_at' },
];

const COLUMN_ORDER: ColumnKey[] = COLUMN_DEFS.map((c) => c.key);

/**
 * A browser that has made no choice yet gets every column.
 *
 * Showing the whole record is what makes the optional columns discoverable at
 * all; the picker is there to thin it down. The table scrolls sideways when the
 * full set is wider than the viewport, so no column is unreachable.
 */
export const DEFAULT_COLUMNS: readonly ColumnKey[] = COLUMN_DEFS.map((c) => c.key);

export const COLUMN_PREFS_STORAGE_KEY = 'haventory:columns:v1';

/** Filter to known keys, dedupe, and enforce the canonical order. */
export function normalizeColumns(keys: unknown): ColumnKey[] {
  if (!Array.isArray(keys)) return [];
  const wanted = new Set(keys.filter((k): k is ColumnKey => COLUMN_ORDER.includes(k as ColumnKey)));
  return COLUMN_ORDER.filter((k) => wanted.has(k));
}

const COLUMN_TABLE_SIZE: Record<ColumnKey, string> = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.key, c.tableSize]),
) as Record<ColumnKey, string>;

/**
 * grid-template-columns for the full-view table: an optional selection column,
 * the name, the chosen columns, then room for the hover actions.
 */
export function tableTemplateFor(columns: ColumnKey[], opts: { selectable: boolean }): string {
  const cols = [
    ...(opts.selectable ? ['40px'] : []),
    'minmax(180px, 2fr)',
    ...normalizeColumns(columns).map((k) => COLUMN_TABLE_SIZE[k]),
    '110px',
  ];
  return cols.join(' ');
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Access to localStorage can throw (e.g. disabled cookies / sandboxed iframe).
    return null;
  }
}

/**
 * Load the persisted column selection, falling back to the defaults on any
 * problem. The stored record is `{ expanded: [...] }`; any other key in it is
 * ignored, so an older or newer payload never breaks the load.
 */
export function loadColumnPrefs(): ColumnKey[] {
  const store = safeLocalStorage();
  if (!store) return [...DEFAULT_COLUMNS];
  try {
    const raw = store.getItem(COLUMN_PREFS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_COLUMNS];
    const parsed = JSON.parse(raw) as { expanded?: unknown };
    return 'expanded' in parsed ? normalizeColumns(parsed.expanded) : [...DEFAULT_COLUMNS];
  } catch {
    return [...DEFAULT_COLUMNS];
  }
}

/** Persist the column selection (best-effort; ignores storage failures). */
export function saveColumnPrefs(columns: ColumnKey[]): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ expanded: normalizeColumns(columns) }));
  } catch {
    // Best-effort; ignore quota/serialization errors.
  }
}

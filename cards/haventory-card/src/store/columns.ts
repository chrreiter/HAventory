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

/** Canonical column order — the default, and what "Reset order" restores. */
export const COLUMN_DEFS: readonly ColumnDef[] = [
  { key: 'quantity', label: 'Qty', tableSize: '70px', sortField: 'quantity' },
  // Wide enough for the "Needs repair" chip on one line: a status that wrapped
  // or clipped would be unreadable in exactly the rows that matter most.
  { key: 'status', label: 'Status', tableSize: '112px' },
  { key: 'category', label: 'Category', tableSize: 'minmax(110px, 1fr)' },
  { key: 'location', label: 'Location', tableSize: 'minmax(110px, 1fr)' },
  // The narrowest of the flexible columns, and the only one that yields to the
  // name: a row identified by its tags and not by its name cannot be scanned,
  // and tags are the column a reader can most afford to see one of.
  { key: 'tags', label: 'Tags', tableSize: 'minmax(96px, 1fr)' },
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

/**
 * Filter to known keys and dedupe, **keeping the order given**.
 *
 * The order is the user's — the picker can move a column up or down and that
 * choice is stored alongside which columns are on. Selections written before
 * ordering existed were already in canonical order, so they load unchanged.
 */
export function normalizeColumns(keys: unknown): ColumnKey[] {
  if (!Array.isArray(keys)) return [];
  const seen = new Set<ColumnKey>();
  const out: ColumnKey[] = [];
  for (const k of keys) {
    if (!COLUMN_ORDER.includes(k as ColumnKey)) continue;
    const key = k as ColumnKey;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** The canonical order, restricted to the columns currently switched on. */
export function canonicalOrder(keys: ColumnKey[]): ColumnKey[] {
  const wanted = new Set(normalizeColumns(keys));
  return COLUMN_ORDER.filter((k) => wanted.has(k));
}

/**
 * Move one column one place up or down within the selection.
 *
 * Returns the same array when the move is impossible, so a caller can tell "no
 * change" without comparing element by element.
 */
export function moveColumn(keys: ColumnKey[], key: ColumnKey, delta: -1 | 1): ColumnKey[] {
  const order = normalizeColumns(keys);
  const from = order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

const COLUMN_TABLE_SIZE: Record<ColumnKey, string> = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.key, c.tableSize]),
) as Record<ColumnKey, string>;

/**
 * grid-template-columns for the full-view table: an optional selection column,
 * the name, the chosen columns, then room for the hover actions.
 *
 * The name track outweighs every flexible column beside it, in both halves of
 * its `minmax`: the name is the row's identity, and it also carries an inline
 * chip — Low, or Checked out, or the status when that column is off — which
 * takes its width before the name gets any. At most one of Low and Checked out
 * draws, so the floor holds a readable name rather than the tail of one; the
 * table renders that choice. With the full column set the flexible tracks all
 * sit at their minimum anyway — there the floor is the whole answer, and the
 * growth factor decides only what a wider window hands out.
 */
export const NAME_COLUMN_SIZE = 'minmax(220px, 3fr)';

/**
 * The selection column's track. Exported because the table pins the name cell
 * to the right of it while scrolling sideways, and an offset that disagreed
 * with the track would leave the name over the checkboxes or short of them.
 */
export const SELECT_COLUMN_WIDTH = '40px';

/**
 * The trailing actions track. It has to hold four controls at their real sizes
 * — two 26px quantity buttons, a 30px Edit and the 34px row menu, plus the gaps
 * — because they are fixed-width circles: a track short of their sum squashes
 * them into ovals rather than wrapping or scrolling.
 */
export const ACTIONS_COLUMN_WIDTH = '140px';

export function tableTemplateFor(columns: ColumnKey[], opts: { selectable: boolean }): string {
  const cols = [
    ...(opts.selectable ? [SELECT_COLUMN_WIDTH] : []),
    NAME_COLUMN_SIZE,
    ...normalizeColumns(columns).map((k) => COLUMN_TABLE_SIZE[k]),
    ACTIONS_COLUMN_WIDTH,
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

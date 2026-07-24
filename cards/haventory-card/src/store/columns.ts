/**
 * Configurable inventory-list columns.
 *
 * The Name column and the trailing Actions column are always shown; the columns
 * defined here are the optional, user-selectable middle columns. Users pick a
 * set for the standard (card) view and a separate set for the expanded view;
 * the choice is persisted in localStorage (per browser).
 */

export type ColumnKey =
  | 'quantity'
  | 'category'
  | 'location'
  | 'tags'
  | 'due_date'
  | 'inspection_date'
  | 'updated_at';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** grid-template-columns sizing for the compact list. */
  size: string;
  /** grid-template-columns sizing for the full-view table. */
  tableSize: string;
  /**
   * The backend sort field this column maps to, when it has one. Category,
   * location and tags are deliberately absent: the API cannot sort by them, and
   * a header that looks clickable but does nothing is worse than a plain one.
   */
  sortField?: 'quantity' | 'due_date' | 'inspection_date' | 'updated_at';
}

/** Canonical column order. Selections are normalized to this order. */
export const COLUMN_DEFS: readonly ColumnDef[] = [
  // `size` is the legacy/compact sizing; the full-view table uses `tableSize`,
  // which follows the redesign's proportions.
  { key: 'quantity', label: 'Qty', size: '50px', tableSize: '70px', sortField: 'quantity' },
  { key: 'category', label: 'Category', size: 'minmax(80px, 1fr)', tableSize: 'minmax(110px, 1fr)' },
  { key: 'location', label: 'Location', size: 'minmax(100px, 2fr)', tableSize: 'minmax(110px, 1fr)' },
  { key: 'tags', label: 'Tags', size: 'minmax(80px, 1fr)', tableSize: 'minmax(120px, 1.4fr)' },
  { key: 'due_date', label: 'Due', size: '110px', tableSize: '100px', sortField: 'due_date' },
  {
    key: 'inspection_date',
    label: 'Inspected',
    size: '110px',
    tableSize: '100px',
    sortField: 'inspection_date',
  },
  { key: 'updated_at', label: 'Updated', size: '100px', tableSize: '96px', sortField: 'updated_at' },
];

const COLUMN_ORDER: ColumnKey[] = COLUMN_DEFS.map((c) => c.key);
const COLUMN_SIZE: Record<ColumnKey, string> = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.key, c.size]),
) as Record<ColumnKey, string>;

export interface ColumnPrefs {
  standard: ColumnKey[];
  expanded: ColumnKey[];
}

/**
 * Defaults: the standard card draws its own compact row, so only the expanded
 * (full-view) table reads these. The set matches the redesigned table —
 * Name | Qty | Category | Tags | Due | Updated.
 */
export const DEFAULT_COLUMN_PREFS: ColumnPrefs = {
  standard: ['quantity'],
  expanded: ['quantity', 'category', 'tags', 'due_date', 'updated_at'],
};

export const COLUMN_PREFS_STORAGE_KEY = 'haventory:columns:v1';

/**
 * Column set the pre-WP4.1 list components fall back to when the host passes
 * none. Pinned here so the redesigned defaults above can move independently of
 * what `ui: legacy` renders.
 */
export const LEGACY_DEFAULT_COLUMNS: readonly ColumnKey[] = ['quantity', 'category', 'location'];

/** Filter to known keys, dedupe, and enforce the canonical order. */
export function normalizeColumns(keys: unknown): ColumnKey[] {
  if (!Array.isArray(keys)) return [];
  const wanted = new Set(keys.filter((k): k is ColumnKey => COLUMN_ORDER.includes(k as ColumnKey)));
  return COLUMN_ORDER.filter((k) => wanted.has(k));
}

/** Build a grid-template-columns value: name + selected columns + actions. */
export function gridTemplateFor(columns: ColumnKey[], opts: { compact: boolean }): string {
  const nameCol = 'minmax(120px, 2fr)';
  const actionsCol = opts.compact ? '120px' : '160px';
  const middle = normalizeColumns(columns).map((k) => COLUMN_SIZE[k]);
  return [nameCol, ...middle, actionsCol].join(' ');
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

/** Load persisted column preferences, falling back to defaults on any problem. */
export function loadColumnPrefs(): ColumnPrefs {
  const store = safeLocalStorage();
  if (!store) return { ...DEFAULT_COLUMN_PREFS };
  try {
    const raw = store.getItem(COLUMN_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COLUMN_PREFS };
    const parsed = JSON.parse(raw) as Partial<ColumnPrefs>;
    return {
      standard: 'standard' in parsed ? normalizeColumns(parsed.standard) : [...DEFAULT_COLUMN_PREFS.standard],
      expanded: 'expanded' in parsed ? normalizeColumns(parsed.expanded) : [...DEFAULT_COLUMN_PREFS.expanded],
    };
  } catch {
    return { ...DEFAULT_COLUMN_PREFS };
  }
}

/** Persist column preferences (best-effort; ignores storage failures). */
export function saveColumnPrefs(prefs: ColumnPrefs): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    const normalized: ColumnPrefs = {
      standard: normalizeColumns(prefs.standard),
      expanded: normalizeColumns(prefs.expanded),
    };
    store.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Best-effort; ignore quota/serialization errors.
  }
}

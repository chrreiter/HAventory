/**
 * Configurable inventory-list columns.
 *
 * The Name column and the trailing Actions column are always shown; the columns
 * defined here are the optional, user-selectable middle columns. Users pick a
 * set for the standard (card) view and a separate set for the expanded view;
 * the choice is persisted in localStorage (per browser).
 */

export type ColumnKey = 'quantity' | 'category' | 'location' | 'tags' | 'due_date';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** grid-template-columns sizing for this column. */
  size: string;
}

/** Canonical column order. Selections are normalized to this order. */
export const COLUMN_DEFS: readonly ColumnDef[] = [
  { key: 'quantity', label: 'Qty', size: '50px' },
  { key: 'category', label: 'Category', size: 'minmax(80px, 1fr)' },
  { key: 'location', label: 'Location', size: 'minmax(100px, 2fr)' },
  { key: 'tags', label: 'Tags', size: 'minmax(80px, 1fr)' },
  { key: 'due_date', label: 'Due', size: '110px' },
];

const COLUMN_ORDER: ColumnKey[] = COLUMN_DEFS.map((c) => c.key);
const COLUMN_SIZE: Record<ColumnKey, string> = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.key, c.size]),
) as Record<ColumnKey, string>;

export interface ColumnPrefs {
  standard: ColumnKey[];
  expanded: ColumnKey[];
}

/** Defaults mirror the pre-column-selection layout. */
export const DEFAULT_COLUMN_PREFS: ColumnPrefs = {
  standard: ['quantity'],
  expanded: ['quantity', 'category', 'location'],
};

export const COLUMN_PREFS_STORAGE_KEY = 'haventory:columns:v1';

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

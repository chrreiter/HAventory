/**
 * The full view's optional table columns, between the always-shown Name and
 * trailing actions. The choice is persisted in localStorage, per browser.
 */

import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

export type ColumnKey =
  | 'quantity'
  | 'status'
  | 'category'
  | 'location'
  | 'tags'
  | 'due_date'
  | 'inspection_date'
  | 'reminder_date'
  | 'updated_at';

export interface ColumnDef {
  key: ColumnKey;
  /** grid-template-columns sizing for the full-view table. */
  tableSize: string;
  /** The backend sort field, when there is one; a header without it is not clickable. */
  sortField?:
    | 'quantity'
    | 'due_date'
    | 'inspection_date'
    | 'reminder_date'
    | 'updated_at'
    | 'location';
}

/** Headers on a track too narrow for the full word take the short spelling. */
const SHORT_HEADERS: Partial<Record<ColumnKey, TranslationKey>> = {
  quantity: 'hv.field.quantityShort',
  due_date: 'hv.field.dueShort',
};

/** A column's label in the language in force; the same key every other surface names the field by. */
export function columnLabel(key: ColumnKey): string {
  return t(SHORT_HEADERS[key] ?? `hv.field.${key}`);
}

/** Canonical column order — the default, and what "Reset order" restores. */
export const COLUMN_DEFS: readonly ColumnDef[] = [
  { key: 'quantity', tableSize: '70px', sortField: 'quantity' },
  // Wide enough for the "Needs repair" chip on one line.
  { key: 'status', tableSize: '112px' },
  // One word: the smallest floor and share, so the name beside it gets the rest.
  { key: 'category', tableSize: 'minmax(92px, 1fr)' },
  // A path and a tag set have no natural end and wrap, so surplus width goes here.
  { key: 'location', tableSize: 'minmax(140px, 2fr)', sortField: 'location' },
  { key: 'tags', tableSize: 'minmax(130px, 2fr)' },
  { key: 'due_date', tableSize: '100px', sortField: 'due_date' },
  // The header, not the date below it, sets this floor.
  { key: 'inspection_date', tableSize: '124px', sortField: 'inspection_date' },
  // The cell shows the repeat beside the date: "Aug 31 · every 3 months".
  { key: 'reminder_date', tableSize: '150px', sortField: 'reminder_date' },
  { key: 'updated_at', tableSize: '96px', sortField: 'updated_at' },
];

const COLUMN_ORDER: ColumnKey[] = COLUMN_DEFS.map((c) => c.key);

/**
 * A browser with no stored choice gets every column but Reminder: the panel's
 * table has no width left for another fixed track, and most items carry none.
 */
export const DEFAULT_COLUMNS: readonly ColumnKey[] = COLUMN_ORDER.filter((key) => key !== 'reminder_date');

export const COLUMN_PREFS_STORAGE_KEY = 'haventory:columns:v1';

/** Filter to known keys and dedupe, keeping the user's order. */
export function normalizeColumns(keys: unknown): ColumnKey[] {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.filter((k): k is ColumnKey => COLUMN_ORDER.includes(k as ColumnKey)))];
}

/** The canonical order, restricted to the columns currently switched on. */
export function canonicalOrder(keys: ColumnKey[]): ColumnKey[] {
  const wanted = new Set(normalizeColumns(keys));
  return COLUMN_ORDER.filter((k) => wanted.has(k));
}

/** Move one column one place up or down; an impossible move returns the order unchanged. */
export function moveColumn(keys: ColumnKey[], key: ColumnKey, delta: -1 | 1): ColumnKey[] {
  const order = normalizeColumns(keys);
  const from = order.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

const COLUMN_TABLE_SIZE = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.key, c.tableSize]),
) as Record<ColumnKey, string>;

/**
 * The name track. Its floor outranks every flexible column: with the full set
 * every flexible track sits on its floor, and 250px holds a ~35-character name
 * beside its inline chip (~31 when a thumbnail takes 42px of it; widening it for
 * that would push the panel's default set into a sideways scroll). Past the
 * floors, surplus goes to Location and Tags, whose cells wrap.
 */
export const NAME_COLUMN_SIZE = 'minmax(250px, 2fr)';

/** The selection track; the table pins the name cell right of it while scrolling. */
export const SELECT_COLUMN_WIDTH = '40px';

/**
 * Holds two 26px quantity buttons, a 30px Edit and the 34px menu plus gaps: a
 * shorter track squashes the fixed-width circles into ovals.
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

/**
 * The persisted selection, `{ expanded: [...] }`, or the defaults on any
 * problem. Storage access itself can throw (sandboxed iframe, blocked cookies).
 */
export function loadColumnPrefs(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(COLUMN_PREFS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { expanded?: unknown } | null) : null;
    if (parsed && 'expanded' in parsed) return normalizeColumns(parsed.expanded);
  } catch {
    // Fall through to the defaults.
  }
  return [...DEFAULT_COLUMNS];
}

/** Persist the column selection, best-effort. */
export function saveColumnPrefs(columns: ColumnKey[]): void {
  try {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ expanded: normalizeColumns(columns) }));
  } catch {
    // Blocked storage or a full quota: nothing is persisted.
  }
}

/**
 * Configurable columns for the full view's table.
 *
 * The Name column and the trailing actions are always shown; the columns
 * defined here are the optional, user-selectable middle ones. The standard
 * card draws its own compact row and takes no selection, so this is the full
 * view's setting alone. The choice is persisted in localStorage (per browser).
 */

import { t } from '../i18n';

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
  /**
   * The backend sort field this column maps to, when it has one. Status,
   * category and tags are deliberately absent: the API cannot sort by them, and
   * a header that looks clickable but does nothing is worse than a plain one.
   */
  sortField?:
    | 'quantity'
    | 'due_date'
    | 'inspection_date'
    | 'reminder_date'
    | 'updated_at'
    | 'location';
}

/**
 * What a column is called, in the language in force.
 *
 * Separate from `COLUMN_DEFS` below rather than a field on it: everything else
 * about a column — its order, its track size, the backend field it sorts on —
 * is the same in every language and is read at module scope, while the label is
 * copy and is not known until Home Assistant hands the card a `hass`.
 */
export function columnLabel(key: ColumnKey): string {
  return t(`hv.column.${key}`);
}

/** Canonical column order — the default, and what "Reset order" restores. */
export const COLUMN_DEFS: readonly ColumnDef[] = [
  { key: 'quantity', tableSize: '70px', sortField: 'quantity' },
  // Wide enough for the "Needs repair" chip on one line: a status that wrapped
  // or clipped would be unreadable in exactly the rows that matter most.
  { key: 'status', tableSize: '112px' },
  // One word, and the only flexible column that carries one: it takes the
  // smallest floor and the smallest share of whatever is left over. The floor
  // holds its own header and a one-word value and stops there — with the full
  // column set every flexible track freezes on its floor, so what this one does
  // not claim is what the name beside it gets to finish a word on.
  { key: 'category', tableSize: 'minmax(92px, 1fr)' },
  // The two columns whose content has no natural end — a path grows a segment
  // per nesting level, a tag set a chip per tag — so they are where surplus
  // width does the most: their cells wrap, and every pixel they get is a
  // segment or a chip that does not need a second line.
  { key: 'location', tableSize: 'minmax(140px, 2fr)', sortField: 'location' },
  { key: 'tags', tableSize: 'minmax(130px, 2fr)' },
  { key: 'due_date', tableSize: '100px', sortField: 'due_date' },
  {
    key: 'inspection_date',
    // Wider than the other date columns because the header is what sets the
    // floor here, not the "Jul 31" it sits above.
    tableSize: '124px',
    sortField: 'inspection_date',
  },
  {
    key: 'reminder_date',
    // The date is what the column sorts on, but the cell shows the repeat
    // beside it — "Aug 31 · every 3 months" is the whole reminder, and the date
    // alone cannot tell a series from a one-off.
    tableSize: '150px',
    sortField: 'reminder_date',
  },
  { key: 'updated_at', tableSize: '96px', sortField: 'updated_at' },
];

const COLUMN_ORDER: ColumnKey[] = COLUMN_DEFS.map((c) => c.key);

/**
 * Columns a browser that has made no choice yet is off by default.
 *
 * Only Reminder. The sidebar panel at 1920 leaves the table a 1360px content
 * box, and the rest of the set already spends it: Location and Tags finish a
 * path segment and a tag chip out of what is left over, and one more fixed
 * track puts every flexible column on its floor. A reminder is also the one
 * column most households have nothing to put in — the feature is opt-in per
 * item — so it is the one that earns its width only where it is asked for.
 */
const OFF_BY_DEFAULT: readonly ColumnKey[] = ['reminder_date'];

/**
 * A browser that has made no choice yet gets every column but those above.
 *
 * Showing the whole record is what makes the optional columns discoverable at
 * all; the picker is there to thin it down, and to switch on what starts off.
 * The table scrolls sideways when the chosen set is wider than the viewport, so
 * no column is unreachable.
 */
export const DEFAULT_COLUMNS: readonly ColumnKey[] = COLUMN_DEFS.map((c) => c.key).filter(
  (key) => !OFF_BY_DEFAULT.includes(key),
);

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
 * The name's *floor* outranks every flexible column beside it: the name is the
 * row's identity, and it also carries an inline chip — Low, or Checked out, or
 * the status when that column is off — which takes its width before the name
 * gets any. At most one of Low and Checked out draws, so the floor holds a
 * readable name rather than the tail of one.
 *
 * That floor is what the name actually gets on the surface it is read on. With
 * the full column set the fixed columns take enough that every flexible track
 * freezes on its minimum, so the floor — not the growth factor — decides
 * whether a name ends or elides: it holds an ordinary one of about 35
 * characters, which is 245px at the row's 13.5px text.
 *
 * A row carrying a picture spends 42px of that floor on the leading thumbnail
 * — the `ROW_THUMB_SIZE` box and the cell's gap — and the floor is deliberately
 * *not* widened to hold both. Widening it by that much is what the panel cannot
 * afford: at the 1360px content box the docked HA sidebar leaves it, the
 * default column set has 34px of slack, so a 42px reserve puts the table into a
 * sideways scroll at the width it is most often read at and drops Location and
 * Tags from 152px each onto their floors — on every row, including the ones
 * with no picture at all. Against that, the reserve would buy the guarantee
 * back from ~31 characters to ~35, on the rows that have a photo, where the
 * photo is itself what makes the row recognisable. Measured on a 1093-item
 * inventory: 0.4% of names run past 31 characters.
 *
 * The growth factor does not outrank the others, and that is the point. A name
 * is one line of text with an end to it; a path and a tag set are not. Past the
 * floors every extra pixel goes to Location and Tags, whose cells wrap — which
 * is where a wider window can still change what the row says. So the two ends
 * of the range answer different questions rather than the same one twice.
 */
export const NAME_COLUMN_SIZE = 'minmax(250px, 2fr)';

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

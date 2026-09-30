/**
 * A list of rows as one tab stop: one row holds `tabindex="0"`, and Arrow, Home
 * and End move it, so a long facet list is not a long Tab walk. The locations
 * tree adds Right and Left for its twisties. The caller reads the rows from the
 * rendered DOM, which is exactly what is walkable.
 */

/** The keys this layer answers to; everything else is the browser's. */
const MOVE_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/** What a list whose rows open and close adds to them. */
const DISCLOSURE_KEYS = [...MOVE_KEYS, 'ArrowRight', 'ArrowLeft'];

/** Where the stop starts: on what is already picked (`aria-pressed` or `aria-selected`). */
const isSelected = (el: HTMLElement) =>
  el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';

/** How deep a row sits, for the step out to its parent. Flat lists are all 1. */
const levelOf = (el: HTMLElement) => Number(el.getAttribute('aria-level') ?? '1');

/**
 * Leave exactly one row in the tab order and return its key: `held` if still
 * drawn, else the selected row, else the first; null for an empty list.
 * `riders` are a row's own buttons, in the tab order only while it holds the stop.
 */
export function syncRovingTabindex(
  rows: HTMLElement[],
  held: string | null,
  keyOf: (el: HTMLElement) => string,
  riders?: (el: HTMLElement) => Iterable<HTMLElement>,
): string | null {
  if (!rows.length) return null;
  const active = rows.find((el) => keyOf(el) === held) ?? rows.find(isSelected) ?? rows[0];
  for (const el of rows) {
    el.tabIndex = el === active ? 0 : -1;
    if (riders) for (const rider of riders(el)) rider.tabIndex = el === active ? 0 : -1;
  }
  return keyOf(active);
}

/** What a list has to tell this layer before Right and Left mean anything. */
export interface Disclosure {
  /** Open or close the node `el` stands for. */
  toggle: (el: HTMLElement) => void;
  /** Every node is drawn open (a filter is running), so Left steps out instead of closing. */
  frozen?: boolean;
}

/**
 * The row a key press moves to, or null when it moved nothing. The ends do not
 * wrap, and only a handled key is claimed. With a `disclosure`, Right opens or
 * steps in, and Left closes or steps out to the parent.
 */
export function rovingTarget(
  e: KeyboardEvent,
  rows: HTMLElement[],
  disclosure?: Disclosure,
): HTMLElement | null {
  const keys = disclosure ? DISCLOSURE_KEYS : MOVE_KEYS;
  if (!keys.includes(e.key)) return null;
  const index = rows.findIndex((el) => el.contains(e.target as Node));
  if (index < 0) return null;
  e.preventDefault();
  e.stopPropagation();
  const current = rows[index];
  switch (e.key) {
    case 'ArrowDown':
      return rows[Math.min(index + 1, rows.length - 1)];
    case 'ArrowUp':
      return rows[Math.max(index - 1, 0)];
    case 'Home':
      return rows[0];
    case 'End':
      return rows[rows.length - 1];
    case 'ArrowRight':
      // An open node's first child is the next row drawn; a leaf stays put.
      if (current.getAttribute('aria-expanded') === 'false') {
        disclosure?.toggle(current);
        return null;
      }
      if (current.getAttribute('aria-expanded') === 'true') return rows[index + 1] ?? null;
      return null;
    case 'ArrowLeft':
      if (current.getAttribute('aria-expanded') === 'true' && !disclosure?.frozen) {
        disclosure?.toggle(current);
        return null;
      }
      return parentOf(rows, index);
  }
  return null;
}

/** The row one level out from `rows[index]` — the nearest earlier, shallower one. */
function parentOf(rows: HTMLElement[], index: number): HTMLElement | null {
  const level = levelOf(rows[index]);
  for (let i = index - 1; i >= 0; i--) {
    if (levelOf(rows[i]) < level) return rows[i];
  }
  return null;
}

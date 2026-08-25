/**
 * A list of rows as one tab stop, with the arrows moving inside it.
 *
 * A facet list is as long as the household's vocabulary, and every row being a
 * tab stop of its own put that vocabulary between the search box and the table:
 * a household with 122 labels made 184 presses of the walk. One row holds
 * `tabindex="0"`, the rest hold `-1`, and Arrow, Home and End move that stop
 * about. The locations tree carries the same pattern one level deeper — its
 * rows open and close, and Right and Left are what work the twisties, which is
 * why they are out of the tab order — so it reads from here too, and the four
 * lists cannot drift apart from each other.
 *
 * The rows are read from the rendered DOM by the caller rather than derived
 * from the data: what is drawn is already exactly what is walkable, and a
 * second walk over the values would be a second copy of the collapse and
 * filter rules to keep in step.
 */

/** The keys this layer answers to; everything else is the browser's. */
const MOVE_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/** What a list whose rows open and close adds to them. */
const DISCLOSURE_KEYS = [...MOVE_KEYS, 'ArrowRight', 'ArrowLeft'];

/**
 * Where the stop belongs before anyone has moved it: on what is already picked.
 * A pressable row says so with `aria-pressed` and a row inside a tree with
 * `aria-selected`; both mean the same thing to whoever arrives on the list.
 */
const isSelected = (el: HTMLElement) =>
  el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';

/** How deep a row sits, for the step out to its parent. Flat lists are all 1. */
const levelOf = (el: HTMLElement) => Number(el.getAttribute('aria-level') ?? '1');

/**
 * Leave exactly one row in the tab order, and say which row that is.
 *
 * `held` is the key the caller stored last. A row drawn away since — a narrowed
 * vocabulary, a cleared filter — hands the stop to the selected row if there is
 * one and to the first row otherwise, so the list is never left without a way
 * in. Null back means the list is empty and there is nothing to hold.
 *
 * `riders` names controls that have no key of their own to reach them by and so
 * travel with their row: the tree's merge, edit and delete buttons are in the
 * tab order only while their row holds the stop, so Tab from the active row
 * steps through that row's actions and then leaves the list.
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
  /**
   * Every node is drawn open whatever its own state says — a filter is running
   * — so closing one would move nothing on the screen and Left steps out
   * instead.
   */
  frozen?: boolean;
}

/**
 * The row a key press moves to, or null when the press moved nothing: it was
 * not this list's key, or it opened or closed a node rather than travelling.
 *
 * The ends do not wrap: the end of a filter list is an end, and coming back
 * round to the other one reads as the focus having jumped somewhere else. Only
 * a handled key is claimed — Enter and Space stay the row's own, and an
 * unclaimed ArrowDown still scrolls the sidebar.
 *
 * With a `disclosure`, Right and Left work the twisties, which is what lets a
 * tree keep them out of the tab order: Right opens what is closed and steps
 * into what is open, Left closes what is open and otherwise steps out to the
 * parent — the nearest earlier row drawn one level shallower.
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
      // Open what is closed; on what is already open, step into it — the first
      // child is the next row drawn. A leaf has neither and stays put.
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

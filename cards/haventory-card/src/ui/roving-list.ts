/**
 * A list of rows as one tab stop, with the arrows moving inside it.
 *
 * A facet list is as long as the household's vocabulary, and every row being a
 * tab stop of its own put that vocabulary between the search box and the table:
 * a household with 122 labels made 184 presses of the walk. One row holds
 * `tabindex="0"`, the rest hold `-1`, and Arrow, Home and End move that stop
 * about — the same pattern the locations tree carries, kept here so the three
 * sidebar lists cannot drift apart from each other.
 *
 * The rows are read from the rendered DOM by the caller rather than derived
 * from the data: what is drawn is already exactly what is walkable, and a
 * second walk over the values would be a second copy of the collapse and
 * filter rules to keep in step.
 */

/** The keys this layer answers to; everything else is the browser's. */
const MOVE_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/** Where the stop belongs before anyone has moved it: on what is already picked. */
const isSelected = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';

/**
 * Leave exactly one row in the tab order, and say which row that is.
 *
 * `held` is the key the caller stored last. A row drawn away since — a narrowed
 * vocabulary, a cleared filter — hands the stop to the selected row if there is
 * one and to the first row otherwise, so the list is never left without a way
 * in. Null back means the list is empty and there is nothing to hold.
 */
export function syncRovingTabindex(
  rows: HTMLElement[],
  held: string | null,
  keyOf: (el: HTMLElement) => string,
): string | null {
  if (!rows.length) return null;
  const active = rows.find((el) => keyOf(el) === held) ?? rows.find(isSelected) ?? rows[0];
  for (const el of rows) el.tabIndex = el === active ? 0 : -1;
  return keyOf(active);
}

/**
 * The row a key press moves to, or null when the press is not this list's.
 *
 * The ends do not wrap: the end of a filter list is an end, and coming back
 * round to the other one reads as the focus having jumped somewhere else. Only
 * a handled key is claimed — Enter and Space stay the row's own, and an
 * unclaimed ArrowDown still scrolls the sidebar.
 */
export function rovingTarget(e: KeyboardEvent, rows: HTMLElement[]): HTMLElement | null {
  if (!MOVE_KEYS.includes(e.key)) return null;
  const index = rows.findIndex((el) => el.contains(e.target as Node));
  if (index < 0) return null;
  e.preventDefault();
  e.stopPropagation();
  switch (e.key) {
    case 'ArrowDown':
      return rows[Math.min(index + 1, rows.length - 1)];
    case 'ArrowUp':
      return rows[Math.max(index - 1, 0)];
    case 'Home':
      return rows[0];
    case 'End':
      return rows[rows.length - 1];
  }
  return null;
}

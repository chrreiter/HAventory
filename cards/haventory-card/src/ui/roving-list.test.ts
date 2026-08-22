import { rovingTarget, syncRovingTabindex } from './roving-list';

/** A facet list in miniature: pressable rows, each wrapping its own label. */
function list(values: string[], selected?: string) {
  const box = document.createElement('div');
  for (const value of values) {
    const row = document.createElement('button');
    row.dataset.value = value;
    row.setAttribute('aria-pressed', String(value === selected));
    const label = document.createElement('span');
    label.textContent = value;
    row.append(label);
    box.append(row);
  }
  document.body.append(box);
  return [...box.querySelectorAll('button')] as HTMLElement[];
}

const keyOf = (el: HTMLElement) => `tags:${el.dataset.value}`;
const stops = (rows: HTMLElement[]) =>
  rows.filter((r) => r.getAttribute('tabindex') === '0').map((r) => r.dataset.value);

/** A real `keydown` on `target`, handed back so the test can read what came of it. */
function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('syncRovingTabindex', () => {
  it('leaves one row in the tab order and takes the rest out', () => {
    const rows = list(['blue', 'green', 'red']);
    expect(syncRovingTabindex(rows, null, keyOf)).toBe('tags:blue');
    expect(stops(rows)).toEqual(['blue']);
    expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('starts on the selected row rather than the first', () => {
    const rows = list(['blue', 'green', 'red'], 'red');
    expect(syncRovingTabindex(rows, null, keyOf)).toBe('tags:red');
    expect(stops(rows)).toEqual(['red']);
  });

  it('keeps a held row holding the stop across a redraw', () => {
    const rows = list(['blue', 'green', 'red'], 'red');
    expect(syncRovingTabindex(rows, 'tags:green', keyOf)).toBe('tags:green');
    expect(stops(rows)).toEqual(['green']);
  });

  // A narrowed vocabulary or a cleared filter can draw the held row away, and
  // the stop has to land somewhere or the list leaves the tab order entirely.
  it('hands the stop to the selected row when the held one is gone', () => {
    const rows = list(['blue', 'red'], 'red');
    expect(syncRovingTabindex(rows, 'tags:green', keyOf)).toBe('tags:red');
    expect(stops(rows)).toEqual(['red']);
  });

  it('falls back to the first row when nothing is selected either', () => {
    const rows = list(['blue', 'red']);
    expect(syncRovingTabindex(rows, 'tags:green', keyOf)).toBe('tags:blue');
    expect(stops(rows)).toEqual(['blue']);
  });

  it('holds nothing for an empty list', () => {
    expect(syncRovingTabindex([], 'tags:green', keyOf)).toBe(null);
  });
});

describe('rovingTarget', () => {
  it('moves one row down and one row up', () => {
    const rows = list(['blue', 'green', 'red']);
    expect(rovingTarget(press(rows[0], 'ArrowDown'), rows)).toBe(rows[1]);
    expect(rovingTarget(press(rows[1], 'ArrowUp'), rows)).toBe(rows[0]);
  });

  // No wrap: the ends of a filter list are ends, and wrapping past them reads
  // as the focus having jumped somewhere else entirely.
  it('stays put at both ends', () => {
    const rows = list(['blue', 'green', 'red']);
    expect(rovingTarget(press(rows[2], 'ArrowDown'), rows)).toBe(rows[2]);
    expect(rovingTarget(press(rows[0], 'ArrowUp'), rows)).toBe(rows[0]);
  });

  it('reaches both ends with Home and End', () => {
    const rows = list(['blue', 'green', 'red']);
    expect(rovingTarget(press(rows[1], 'Home'), rows)).toBe(rows[0]);
    expect(rovingTarget(press(rows[1], 'End'), rows)).toBe(rows[2]);
  });

  // The row holds the focus, so it is usually the target; a key can still
  // arrive from the label inside it.
  it('finds the row from a target inside it', () => {
    const rows = list(['blue', 'green', 'red']);
    const label = rows[1].querySelector('span') as HTMLElement;
    expect(rovingTarget(press(label, 'ArrowDown'), rows)).toBe(rows[2]);
  });

  // Handled keys are claimed so the sidebar does not scroll out from under the
  // row they just moved to; everything else is left to the browser and to the
  // button's own Enter and Space.
  it('claims the keys it answers to and no others', () => {
    const rows = list(['blue', 'green', 'red']);
    const handled = press(rows[0], 'ArrowDown');
    expect(rovingTarget(handled, rows)).toBe(rows[1]);
    expect(handled.defaultPrevented).toBe(true);

    const ignored = press(rows[0], 'ArrowRight');
    expect(rovingTarget(ignored, rows)).toBe(null);
    expect(ignored.defaultPrevented).toBe(false);
    expect(rovingTarget(press(rows[0], 'Enter'), rows)).toBe(null);
  });

  it('ignores a key pressed outside the rows', () => {
    const rows = list(['blue', 'green', 'red']);
    const outside = document.createElement('button');
    document.body.append(outside);
    const event = press(outside, 'ArrowDown');
    expect(rovingTarget(event, rows)).toBe(null);
    expect(event.defaultPrevented).toBe(false);
  });
});

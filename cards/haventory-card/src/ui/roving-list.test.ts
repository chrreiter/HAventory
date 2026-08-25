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

/** One node of a tree in miniature: a depth, a disclosure state, its actions. */
interface Node {
  value: string;
  level?: number;
  /** Absent for a leaf, which discloses nothing and so says nothing. */
  expanded?: boolean;
  selected?: boolean;
  /** Controls that ride with the row: the tree's rename, merge and delete. */
  actions?: number;
}

/** A tree in miniature: rows that carry a level, a state and their own actions. */
function tree(nodes: Node[]) {
  const box = document.createElement('div');
  for (const node of nodes) {
    const row = document.createElement('div');
    row.dataset.value = node.value;
    row.setAttribute('aria-level', String(node.level ?? 1));
    row.setAttribute('aria-selected', String(node.selected ?? false));
    if (node.expanded !== undefined) row.setAttribute('aria-expanded', String(node.expanded));
    const actions = document.createElement('span');
    actions.className = 'actions';
    for (let i = 0; i < (node.actions ?? 0); i += 1) actions.append(document.createElement('button'));
    row.append(actions);
    box.append(row);
  }
  document.body.append(box);
  return [...box.querySelectorAll<HTMLElement>('[data-value]')];
}

const actionsOf = (el: HTMLElement) => el.querySelectorAll<HTMLElement>('.actions button');

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

  // A tree row is not pressable — it is selected — and means the same thing.
  it('starts on a selected row however the row says it is selected', () => {
    const rows = tree([{ value: 'garage' }, { value: 'kitchen', selected: true }]);
    expect(syncRovingTabindex(rows, null, keyOf)).toBe('tags:kitchen');
    expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  // A row's own rename, merge and delete buttons have no key to reach them by,
  // so they ride with their row: Tab from the active one steps through that
  // row's actions and then leaves the list.
  it('takes the actions of a row in and out of the tab order with it', () => {
    const rows = tree([
      { value: 'garage', actions: 2 },
      { value: 'kitchen', actions: 2 },
    ]);
    syncRovingTabindex(rows, 'tags:kitchen', keyOf, actionsOf);
    expect([...actionsOf(rows[1])].map((b) => b.getAttribute('tabindex'))).toEqual(['0', '0']);
    expect([...actionsOf(rows[0])].map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '-1']);

    syncRovingTabindex(rows, 'tags:garage', keyOf, actionsOf);
    expect([...actionsOf(rows[0])].map((b) => b.getAttribute('tabindex'))).toEqual(['0', '0']);
    expect([...actionsOf(rows[1])].map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '-1']);
  });
});

describe('rovingTarget: rows that open and close', () => {
  /** Garage open over one child, Kitchen closed over its own, Attic a leaf. */
  const branch = () =>
    tree([
      { value: 'garage', expanded: true },
      { value: 'shelf', level: 2 },
      { value: 'kitchen', expanded: false },
      { value: 'attic' },
    ]);

  function disclosure(frozen = false) {
    const toggled: string[] = [];
    return { toggled, spec: { toggle: (el: HTMLElement) => toggled.push(el.dataset.value!), frozen } };
  }

  it('opens a closed row with Right, moving nothing', () => {
    const rows = branch();
    const { toggled, spec } = disclosure();
    expect(rovingTarget(press(rows[2], 'ArrowRight'), rows, spec)).toBe(null);
    expect(toggled).toEqual(['kitchen']);
  });

  it('steps into an open row with Right — the first child is the next row', () => {
    const rows = branch();
    const { toggled, spec } = disclosure();
    expect(rovingTarget(press(rows[0], 'ArrowRight'), rows, spec)).toBe(rows[1]);
    expect(toggled).toEqual([]);
  });

  it('claims Right on a leaf and does nothing with it', () => {
    const rows = branch();
    const { toggled, spec } = disclosure();
    const event = press(rows[3], 'ArrowRight');
    expect(rovingTarget(event, rows, spec)).toBe(null);
    expect(event.defaultPrevented).toBe(true);
    expect(toggled).toEqual([]);
  });

  it('closes an open row with Left, keeping the stop on it', () => {
    const rows = branch();
    const { toggled, spec } = disclosure();
    expect(rovingTarget(press(rows[0], 'ArrowLeft'), rows, spec)).toBe(null);
    expect(toggled).toEqual(['garage']);
  });

  it('steps out to the parent with Left on a row that is not open', () => {
    const rows = branch();
    const { toggled, spec } = disclosure();
    expect(rovingTarget(press(rows[1], 'ArrowLeft'), rows, spec)).toBe(rows[0]);
    expect(rovingTarget(press(rows[2], 'ArrowLeft'), rows, spec)).toBe(null);
    expect(toggled).toEqual([]);
  });

  // A filter draws every node open whatever its own state says, so closing one
  // would move nothing on the screen.
  it('steps out rather than closing while the list is drawn open', () => {
    const rows = branch();
    const { toggled, spec } = disclosure(true);
    expect(rovingTarget(press(rows[0], 'ArrowLeft'), rows, spec)).toBe(null);
    expect(rovingTarget(press(rows[1], 'ArrowLeft'), rows, spec)).toBe(rows[0]);
    expect(toggled).toEqual([]);
  });

  it('still walks the list with the keys a flat one answers to', () => {
    const rows = branch();
    const { spec } = disclosure();
    expect(rovingTarget(press(rows[0], 'ArrowDown'), rows, spec)).toBe(rows[1]);
    expect(rovingTarget(press(rows[3], 'Home'), rows, spec)).toBe(rows[0]);
    expect(rovingTarget(press(rows[0], 'End'), rows, spec)).toBe(rows[3]);
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

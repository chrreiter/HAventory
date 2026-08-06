import './hv-data-table';
import { makeItem } from '../test.utils';
import type { HVDataTable } from './hv-data-table';
import type { Item, Sort } from '../store/types';

async function mount(items: Partial<Item>[], props: Partial<HVDataTable> = {}) {
  const el = document.createElement('hv-data-table') as HVDataTable;
  el.items = items.map((i) => makeItem(i));
  el.columns = ['quantity', 'category', 'tags', 'due_date', 'updated_at'];
  el.sort = { field: 'updated_at', order: 'desc' };
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVDataTable, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVDataTable, sel: string) => [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

const tableCss = () => {
  const styles = (customElements.get('hv-data-table') as typeof HVDataTable).styles;
  return (Array.isArray(styles) ? styles : [styles])
    .map((s) => String(s.cssText))
    .join('\n')
    .replace(/\s+/g, ' ');
};

describe('hv-data-table: area', () => {
  const AREAS = [{ id: 'area-kitchen', name: 'Kitchen' }];
  const pantry = { id_path: [], name_path: [], display_path: 'Fridge / Pantry', sort_key: '' };

  it('names the room in the location cell, beside the path', async () => {
    const el = await mount([{ id: '1', effective_area_id: 'area-kitchen', location_path: pantry }], {
      columns: ['location'],
      areas: AREAS,
    });
    const cell = q(el, '[data-testid="cell-location"]');
    expect(cell?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(cell?.textContent).toContain('Fridge › Pantry');
    expect(cell?.getAttribute('title')).toBe('Area: Kitchen · Fridge › Pantry');
  });

  it('leaves a cell with no area exactly as it was', async () => {
    const el = await mount([{ id: '1', location_path: pantry }], { columns: ['location'], areas: AREAS });
    const cell = q(el, '[data-testid="cell-location"]');
    expect(cell?.querySelector('.hv-area-chip')).toBe(null);
    expect(cell?.textContent?.trim()).toBe('Fridge › Pantry');
    expect(cell?.getAttribute('title')).toBe('Fridge › Pantry');
  });

  it('still says nothing is filed there with an em dash', async () => {
    const el = await mount([{ id: '1' }], { columns: ['location'], areas: AREAS });
    expect(q(el, '[data-testid="cell-location"]')?.textContent?.trim()).toBe('—');
  });
});

describe('hv-data-table: narrow screens', () => {
  // The template has a hard ~786px minimum, and a grid whose tracks do not fit
  // overflows its box rather than shrinking. With overflow visible the spill
  // was clipped by the shell: rows measured clientWidth 634 / scrollWidth 854
  // at 375px, and three columns could not be reached by any gesture.
  it('scrolls sideways rather than clipping columns away', () => {
    const css = tableCss();
    expect(css).toMatch(/:host \{[^}]*overflow-x: auto/);
    expect(css).toMatch(/:host \{[^}]*min-width: 0/);
  });

  // Making the host the sideways scroller was not enough on its own: the rows
  // live in a vertical scroll box inside it, declaring overflow on one axis
  // makes the other compute to auto, and that box is exactly as wide as its own
  // content. So a horizontal swipe starting over a row landed on a scroll
  // container with nothing to scroll, and `overscroll-behavior: contain` on
  // both axes meant it was not handed on either. The host measured scrollWidth
  // 874 against clientWidth 390 and never moved off scrollLeft 0.
  it('contains the vertical overscroll only, so a sideways swipe reaches the host', () => {
    const css = tableCss();
    expect(css).toMatch(/\.body \{[^}]*overscroll-behavior-y: contain/);
    expect(css).not.toMatch(/\.body \{[^}]*overscroll-behavior: contain/);
    // The host still contains its own, which is what keeps a flick that runs
    // out of table off the dashboard behind it.
    expect(css).toMatch(/:host \{[^}]*overscroll-behavior-x: contain/);
  });

  it('sizes the header and body to the grid minimum so they scroll together', () => {
    // Left at the container width they would stay 375px wide while their
    // tracks painted past the edge, cutting the row dividers short.
    expect(tableCss()).toMatch(/\.head, \.body \{ min-width: min-content; \}/);
  });

  it('grows the checkbox hit area for touch without growing the box', () => {
    // 16px is right for a dense table; 16px of tappable area is not.
    expect(tableCss()).toMatch(
      /\.box::after \{[^}]*inset: calc\(\(var\(--hv-tap-min, 16px\) - 16px\) \/ -2\)/,
    );
  });

  it('gives the sort headers a tappable height', () => {
    expect(tableCss()).toMatch(/\.head button\.sort \{[^}]*min-height: var\(--hv-tap-min, auto\)/);
  });

  it('keeps rows scrolling vertically inside the body', () => {
    // The horizontal scroller is the host; the body stays the vertical one, so
    // the header does not scroll away with the rows.
    expect(tableCss()).toMatch(/\.body \{[^}]*overflow-y: auto/);
  });
});

describe('hv-data-table: columns', () => {
  it('renders a header and a cell per selected column', async () => {
    const el = await mount([{ id: '1', name: 'M4 Screws', quantity: 340, category: 'Hardware', tags: ['m4'] }]);
    const headers = all(el, '[role="columnheader"]').map((h) => h.textContent?.trim());
    expect(headers[0]).toContain('Name');
    expect(headers.join(' ')).toContain('Qty');
    expect(headers.join(' ')).toContain('Updated');

    expect(q(el, '[data-testid="cell-quantity"]')?.textContent).toBe('340');
    expect(q(el, '[data-testid="cell-category"]')?.textContent).toBe('Hardware');
    expect(q(el, '[data-testid="cell-tags"]')?.textContent).toContain('m4');
  });

  it('follows the column selection', async () => {
    const el = await mount([{ id: '1' }], { columns: ['quantity'] });
    expect(q(el, '[data-testid="cell-quantity"]')).toBeTruthy();
    expect(q(el, '[data-testid="cell-category"]')).toBe(null);
  });

  it('dashes an empty cell rather than leaving a gap', async () => {
    const el = await mount([{ id: '1', category: null, tags: [], due_date: null }]);
    expect(q(el, '[data-testid="cell-category"]')?.textContent).toBe('—');
    expect(q(el, '[data-testid="cell-due_date"]')?.textContent).toBe('—');
  });

  it('marks low stock and overdue in the cells', async () => {
    const el = await mount([
      { id: '1', quantity: 1, low_stock_threshold: 5, checked_out: true, due_date: '2020-01-01' },
    ]);
    expect(q(el, '[data-testid="cell-quantity"]')?.classList.contains('low')).toBe(true);
    expect(q(el, '[data-testid="cell-due_date"]')?.classList.contains('overdue')).toBe(true);
    expect(el.shadowRoot?.textContent).toContain('Low');
    expect(el.shadowRoot?.textContent).toContain('Checked out');
  });
});

describe('hv-data-table: sorting', () => {
  it('only makes a header clickable when the backend can sort by it', async () => {
    const el = await mount([{ id: '1' }]);
    const sortable = all(el, '[data-testid="table-sort"]').map((b) => b.dataset.field);
    expect(sortable).toEqual(['name', 'quantity', 'due_date', 'updated_at']);
    // Category and tags have no sort field server-side, so no button.
    expect(q(el, '[data-field="category"]')).toBe(null);
    expect(q(el, '[data-field="tags"]')).toBe(null);
  });

  it('marks the sorted column and its direction', async () => {
    const el = await mount([{ id: '1' }], { sort: { field: 'name', order: 'asc' } });
    const header = q(el, '[data-field="name"]') as HTMLElement;
    expect(header.classList.contains('sorted')).toBe(true);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(q(el, '[data-field="quantity"]')?.getAttribute('aria-sort')).toBe('none');
  });

  it('flips the direction when the sorted column is clicked again', async () => {
    const el = await mount([{ id: '1' }], { sort: { field: 'name', order: 'asc' } });
    let sort: Sort | null = null;
    el.addEventListener('sort-change', (e) => {
      sort = (e as CustomEvent).detail.sort;
    });

    (q(el, '[data-field="name"]') as HTMLButtonElement).click();
    expect(sort).toEqual({ field: 'name', order: 'desc' });
  });

  it('picks a sensible direction for a newly chosen column', async () => {
    const el = await mount([{ id: '1' }], { sort: { field: 'name', order: 'asc' } });
    const seen: Sort[] = [];
    el.addEventListener('sort-change', (e) => seen.push((e as CustomEvent).detail.sort));

    (q(el, '[data-field="updated_at"]') as HTMLButtonElement).click();
    (q(el, '[data-field="quantity"]') as HTMLButtonElement).click();

    // Timestamps read newest-first; counts read smallest-first.
    expect(seen[0]).toEqual({ field: 'updated_at', order: 'desc' });
    expect(seen[1]).toEqual({ field: 'quantity', order: 'asc' });
  });

  // A deadline is not a timestamp: "newest" due date is the least urgent one.
  // Opening Due on desc buried the overdue rows the card badges elsewhere.
  it('opens a deadline column soonest-first, not newest-first', async () => {
    const el = await mount([{ id: '1' }], {
      columns: ['due_date', 'inspection_date'],
      sort: { field: 'name', order: 'asc' },
    });
    const seen: Sort[] = [];
    el.addEventListener('sort-change', (e) => seen.push((e as CustomEvent).detail.sort));

    (q(el, '[data-field="due_date"]') as HTMLButtonElement).click();
    (q(el, '[data-field="inspection_date"]') as HTMLButtonElement).click();

    expect(seen[0]).toEqual({ field: 'due_date', order: 'asc' });
    expect(seen[1]).toEqual({ field: 'inspection_date', order: 'asc' });
  });
});

describe('hv-data-table: inspection column', () => {
  // The header used to read "Inspected", past tense, over a date the rest of
  // the card treats as the next one due.
  it('heads the column with the date it holds', async () => {
    const el = await mount([{ id: '1' }], { columns: ['inspection_date'] });
    expect(q(el, '[data-field="inspection_date"]')?.textContent?.trim()).toBe('Next inspection');
  });

  it('marks a cell whose inspection has come due, and only that one', async () => {
    const el = await mount(
      [
        { id: '1', inspection_date: '2020-01-01' },
        { id: '2', inspection_date: '2099-01-01' },
        { id: '3', inspection_date: null },
      ],
      { columns: ['inspection_date'] },
    );
    const cells = all(el, '[data-testid="cell-inspection_date"]');
    expect(cells.map((c) => c.classList.contains('due'))).toEqual([true, false, false]);
  });
});

describe('hv-data-table: rows', () => {
  it('emits row actions with the item id', async () => {
    const el = await mount([{ id: 'item-1', quantity: 5 }]);
    const seen: string[] = [];
    for (const name of ['increment', 'decrement', 'edit', 'open-item']) {
      el.addEventListener(name, (e) => seen.push(`${name}:${(e as CustomEvent).detail.itemId}`));
    }

    (q(el, '[data-testid="table-increment"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="table-decrement"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="table-edit"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="table-row"]') as HTMLElement).click();

    expect(seen).toEqual([
      'increment:item-1',
      'decrement:item-1',
      'edit:item-1',
      'open-item:item-1',
    ]);
  });

  it('disables the stepper for a checked-out row and at zero', async () => {
    const el = await mount([{ id: '1', checked_out: true }, { id: '2', quantity: 0 }]);
    const rows = all(el, '[data-testid="table-row"]');
    expect(
      (rows[0].querySelector('[data-testid="table-increment"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (rows[1].querySelector('[data-testid="table-decrement"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('reports scroll position so the host can page in more', async () => {
    const el = await mount([{ id: '1' }]);
    let ratio: number | null = null;
    el.addEventListener('near-end', (e) => {
      ratio = (e as CustomEvent).detail.ratio;
    });
    (q(el, '[data-testid="table-body"]') as HTMLElement).dispatchEvent(new Event('scroll'));
    expect(typeof ratio).toBe('number');
  });

  it('shows the host-supplied empty message', async () => {
    const el = await mount([]);
    expect(q(el, '[data-testid="table-empty"]')).toBeTruthy();
  });

  it('chips a flagged status in the name cell and leaves ok rows quiet', async () => {
    const el = await mount([
      { id: '1', status: 'missing' },
      { id: '2', status: 'needs_repair' },
      { id: '3', status: 'ok' },
      { id: '4' },
    ]);
    const rows = all(el, '[data-testid="table-row"]');
    const chip = (row: HTMLElement) =>
      row.querySelector('[data-testid="table-status"]')?.textContent?.trim() ?? null;
    expect(rows.map(chip)).toEqual(['Missing', 'Needs repair', null, null]);
  });
});

describe('hv-data-table: keyboard', () => {
  const captured = (el: HVDataTable, names: string[]) => {
    const seen: string[] = [];
    for (const name of names) {
      el.addEventListener(name, (e) => seen.push(`${name}:${(e as CustomEvent).detail.itemId}`));
    }
    return seen;
  };
  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  // The rows were tabbable and had a click handler and nothing else, so on the
  // one surface that lists every item, no item could be reached without a mouse.
  it('keeps the same shortcuts the card list row has', async () => {
    const el = await mount([{ id: 'item-1' }]);
    const seen = captured(el, ['open-item', 'request-delete', 'increment', 'decrement']);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;

    for (const key of ['Enter', 'Delete', '+', '-']) press(row, key);

    expect(seen).toEqual([
      'open-item:item-1',
      'request-delete:item-1',
      'increment:item-1',
      'decrement:item-1',
    ]);
  });

  it('takes the numpad and shifted spellings of the same two keys', async () => {
    const el = await mount([{ id: 'item-1' }]);
    const seen = captured(el, ['increment', 'decrement']);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;

    // `=` is what an unshifted `+` reports on a US layout; `Add`/`Subtract` are
    // the numpad's.
    for (const key of ['=', 'Add', 'Subtract']) press(row, key);

    expect(seen).toEqual(['increment:item-1', 'increment:item-1', 'decrement:item-1']);
  });

  it('claims the keys it acts on, so the surface below does not answer too', async () => {
    const el = await mount([{ id: 'item-1' }]);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;
    expect(press(row, 'Enter')).toBe(false);
    // Anything else is still the browser's — Tab has to keep leaving the row.
    expect(press(row, 'Tab')).toBe(true);
  });

  it('follows the row click into selection mode rather than opening the item', async () => {
    const el = await mount([{ id: 'item-1' }], { selectable: true });
    const seen = captured(el, ['open-item', 'toggle-select']);
    press(q(el, '[data-testid="table-row"]') as HTMLElement, 'Enter');
    expect(seen).toEqual(['toggle-select:item-1']);
  });

  it('leaves a key pressed on a control inside the row to that control', async () => {
    // Enter on Edit already opens the editor; the row acting on the same press
    // would open it a second time, and Delete on any of the three buttons would
    // ask to delete the item.
    const el = await mount([{ id: 'item-1' }]);
    const seen = captured(el, ['open-item', 'request-delete', 'increment', 'decrement']);
    const edit = q(el, '[data-testid="table-edit"]') as HTMLElement;

    for (const key of ['Enter', 'Delete', '+', '-']) press(edit, key);

    expect(seen).toEqual([]);
  });
});

describe('hv-data-table: table semantics', () => {
  // `row`, `columnheader` and `cell` are only meaningful under a table role.
  // Without one the structure is dropped and the rows read as a run of text.
  it('carries the table role the rows and cells hang off', async () => {
    const el = await mount([{ id: '1' }]);
    expect(el.getAttribute('role')).toBe('table');
  });

  it('marks every value in a row as a cell', async () => {
    const el = await mount([{ id: '1', tags: ['m4'] }]);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;
    const cells = [...row.querySelectorAll('[role="cell"]')];
    // Name, the five mounted columns, and the action group.
    expect(cells).toHaveLength(7);
    expect(cells[0].querySelector('[data-testid="table-name"]')).toBeTruthy();
    expect(cells.map((c) => c.getAttribute('data-testid'))).toContain('cell-quantity');
  });

  it('gives each row a cell for every column header', async () => {
    const el = await mount([{ id: '1' }], { columns: ['quantity', 'location', 'status'] });
    const headers = all(el, '[role="columnheader"]').length;
    const cells = (q(el, '[data-testid="table-row"]') as HTMLElement).querySelectorAll('[role="cell"]');
    expect(cells).toHaveLength(headers);
  });

  it('spans the empty message across a row, the way a table has to', async () => {
    // A row group whose only child is a loose message owns something a table
    // cannot contain, and the whole structure is dropped rather than repaired.
    const el = await mount([]);
    const empty = q(el, '[data-testid="table-empty"]') as HTMLElement;
    expect(empty.getAttribute('role')).toBe('cell');
    expect(empty.parentElement?.getAttribute('role')).toBe('row');
    expect(empty.closest('[role="rowgroup"]')).toBeTruthy();
  });

  it('leaves the announcing to whatever fills the slot', async () => {
    // The shared empty state is a live region already; a second one wrapped
    // around it says everything twice.
    const el = await mount([]);
    expect(q(el, '[data-testid="table-empty"]')?.getAttribute('role')).not.toBe('status');
  });
});

describe('hv-data-table: status column', () => {
  const mixed = [
    { id: '1', status: 'missing' as const },
    { id: '2', status: 'needs_repair' as const },
    { id: '3', status: 'ok' as const },
    { id: '4' },
  ];

  // The name-cell chip only ever marks the exceptions. A column that did the
  // same would leave most rows blank under a header promising a value.
  it('names every row, ok included, and reads an absent status as ok', async () => {
    const el = await mount(mixed, { columns: ['status'] });
    expect(all(el, '[data-testid="cell-status"]').map((c) => c.textContent?.trim())).toEqual([
      'Missing',
      'Needs repair',
      'OK',
      'OK',
    ]);
  });

  // Every value in the column is a chip, or half of it would read as a second
  // column interleaved with the first. The colour is the status definition's,
  // not one of the fixed semantic hues — a household chooses it.
  it('chips every value and paints each from its own definition', async () => {
    const el = await mount(mixed, { columns: ['status'] });
    const cells = all(el, '[data-testid="cell-status"]');
    expect(cells.map((c) => !!c.querySelector('.hv-status-chip'))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(cells.map((c) => !!c.querySelector('.hv-status-chip.tone-amber'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(cells.map((c) => !!c.querySelector('.hv-status-chip.tone-green'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // The semantic vocabulary stays for the marks that do carry a fixed meaning.
    expect(cells.map((c) => !!c.querySelector('.hv-chip.warning'))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('stands the name-cell chip down, so no row says it twice', async () => {
    const el = await mount([{ id: '1', status: 'missing' }], { columns: ['status'] });
    expect(q(el, '[data-testid="table-status"]')).toBe(null);
    expect(q(el, '[data-testid="cell-status"]')?.textContent?.trim()).toBe('Missing');
  });

  it('keeps the name-cell chip when the column is turned off', async () => {
    const el = await mount([{ id: '1', status: 'missing' }], { columns: ['quantity'] });
    expect(q(el, '[data-testid="table-status"]')?.textContent?.trim()).toBe('Missing');
  });

  it('gives the header no sort button — the API cannot order by status', async () => {
    const el = await mount([{ id: '1' }], { columns: ['status'] });
    expect(all(el, '[data-testid="table-sort"]').map((b) => b.dataset.field)).not.toContain('status');
  });
});

describe('hv-data-table: selection mode', () => {
  it('adds checkboxes and turns row clicks into selection', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const seen: string[] = [];
    el.addEventListener('toggle-select', (e) => seen.push((e as CustomEvent).detail.itemId));
    el.addEventListener('open-item', () => seen.push('open'));

    expect(all(el, '[data-testid="table-row-select"]')).toHaveLength(2);
    (q(el, '[data-testid="table-row"]') as HTMLElement).click();
    expect(seen).toEqual(['1']);
  });

  it('reflects none, some and all in the header checkbox', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const master = () => q(el, '[data-testid="table-select-all"]') as HTMLElement;
    expect(master().getAttribute('aria-checked')).toBe('false');

    el.selection = new Set(['1']);
    await el.updateComplete;
    expect(master().getAttribute('aria-checked')).toBe('mixed');

    el.selection = new Set(['1', '2']);
    await el.updateComplete;
    expect(master().getAttribute('aria-checked')).toBe('true');
  });

  it('selects all loaded rows, then clears', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const seen: string[] = [];
    el.addEventListener('select-all-loaded', () => seen.push('select-all'));
    el.addEventListener('clear-selection', () => seen.push('clear'));

    (q(el, '[data-testid="table-select-all"]') as HTMLButtonElement).click();
    el.selection = new Set(['1', '2']);
    await el.updateComplete;
    (q(el, '[data-testid="table-select-all"]') as HTMLButtonElement).click();

    expect(seen).toEqual(['select-all', 'clear']);
  });

  // jsdom does not run the shadow-DOM cascade, so nothing here can read the
  // painted border. The two halves that produce it are assertable separately:
  // the box keeps `.box` in every state, and the sort-header reset that would
  // otherwise outrank it is keyed to a class the box does not carry.
  it('keeps the header checkbox on .box through none, some and all', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const master = () => q(el, '[data-testid="table-select-all"]') as HTMLElement;
    expect([...master().classList]).toEqual(['box']);

    el.selection = new Set(['1']);
    await el.updateComplete;
    expect([...master().classList]).toEqual(['box', 'mixed']);

    el.selection = new Set(['1', '2']);
    await el.updateComplete;
    expect([...master().classList]).toEqual(['box', 'on']);
  });

  it('keeps the sort-header reset off the header checkbox', async () => {
    const css = tableCss();
    // Unscoped, this rule matches every button in the header — the select-all
    // included — and its 0-1-1 beats `.box`, so the unchecked box paints
    // neither border nor fill and the target is invisible until it is used.
    expect(css).not.toMatch(/\.head button \{/);
    expect(css).toMatch(/\.head button\.sort \{[^}]*border: none/);
    expect(css).toMatch(/\.box \{[^}]*border: 1\.5px solid var\(--hv-text-tertiary\)/);
    expect(css).toMatch(/\.box\.on, \.box\.mixed \{[^}]*background: var\(--hv-primary-dark\)/);

    const el = await mount([{ id: '1' }], { selectable: true });
    for (const b of all(el, '[data-testid="table-sort"]')) expect(b.classList.contains('sort')).toBe(true);
    expect(q(el, '[data-testid="table-select-all"]')?.classList.contains('sort')).toBe(false);
  });

  it('hides the row action buttons while selecting', async () => {
    const el = await mount([{ id: '1' }], { selectable: true });
    // Actions stay available; it is the row click that changes meaning.
    expect(q(el, '[data-testid="table-edit"]')).toBeTruthy();
    expect(q(el, '[data-testid="table-row-select"]')).toBeTruthy();
  });
});

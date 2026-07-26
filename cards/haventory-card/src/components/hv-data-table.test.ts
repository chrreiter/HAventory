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
    expect(el.shadowRoot?.textContent).toContain('LOW');
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

  it('hides the row action buttons while selecting', async () => {
    const el = await mount([{ id: '1' }], { selectable: true });
    // Actions stay available; it is the row click that changes meaning.
    expect(q(el, '[data-testid="table-edit"]')).toBeTruthy();
    expect(q(el, '[data-testid="table-row-select"]')).toBeTruthy();
  });
});

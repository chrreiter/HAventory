import './hv-list-row';
import { makeItem } from '../test.utils';
import { displayPath, elidePath, isLowStock } from './hv-list-row';
import type { HVListRow } from './hv-list-row';
import type { Item } from '../store/types';

async function mount(item: Partial<Item>, props: Partial<HVListRow> = {}) {
  const el = document.createElement('hv-list-row') as HVListRow;
  el.item = makeItem(item);
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVListRow, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;

function captured(el: HVListRow, names: string[]) {
  const seen: string[] = [];
  for (const name of names) el.addEventListener(name, () => seen.push(name));
  return seen;
}

describe('isLowStock / displayPath', () => {
  it('treats a null threshold as never low', () => {
    expect(isLowStock(makeItem({ quantity: 0, low_stock_threshold: null }))).toBe(false);
  });

  it('is low at or below the threshold', () => {
    expect(isLowStock(makeItem({ quantity: 3, low_stock_threshold: 3 }))).toBe(true);
    expect(isLowStock(makeItem({ quantity: 4, low_stock_threshold: 3 }))).toBe(false);
  });

  it('renders the backend path with the design separator', () => {
    const item = makeItem({});
    item.location_path = {
      id_path: ['g', 's'],
      name_path: ['Garage', 'Shelf A'],
      display_path: 'Garage / Shelf A',
      sort_key: '',
    };
    expect(displayPath(item)).toBe('Garage › Shelf A');
  });
});

describe('elidePath', () => {
  it('leaves a path that already fits alone', () => {
    expect(elidePath('Garage')).toBe('Garage');
    expect(elidePath('Garage › Shelf A')).toBe('Garage › Shelf A');
    expect(elidePath('Garage › Shelf A › Bin 2')).toBe('Garage › Shelf A › Bin 2');
  });

  // The leaf is the whole point: it is the segment that says where the item
  // actually is, and right-clipping was dropping exactly that.
  it('drops the middle rather than the leaf', () => {
    expect(elidePath('Workshop › Parts Cabinet › Drawer A › Small Bin')).toBe('Workshop › … › Small Bin');
  });

  it('keeps both ends however deep the tree gets', () => {
    expect(elidePath('A › B › C › D › E › F')).toBe('A › … › F');
  });

  it('handles an item with no location at all', () => {
    expect(elidePath('')).toBe('');
  });
});

describe('hv-list-row: content', () => {
  it('shows the name over location and category', async () => {
    const el = await mount({
      name: 'AA Batteries',
      category: 'Consumables',
      location_path: { id_path: [], name_path: [], display_path: 'Kitchen / Pantry', sort_key: '' },
    });
    expect(q(el, '[data-testid="row-name"]')?.textContent).toContain('AA Batteries');
    expect(el.shadowRoot?.textContent).toContain('Kitchen › Pantry · Consumables');
  });

  it('says so when an item has no location at all', async () => {
    const el = await mount({ name: 'Orphan', category: null });
    expect(el.shadowRoot?.textContent).toContain('No location');
  });

  it('badges low stock and colours the quantity', async () => {
    const el = await mount({ quantity: 2, low_stock_threshold: 8 });
    expect(q(el, '[data-testid="row-low"]')).toBeTruthy();
    expect(q(el, '[data-testid="row-qty"]')?.classList.contains('low')).toBe(true);
  });

  it('marks a checked-out item and disables its stepper', async () => {
    const el = await mount({ checked_out: true });
    expect(q(el, '[data-testid="row-checked-out"]')?.textContent).toContain('Checked out');
    expect((q(el, '[data-testid="row-increment"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(el, '[data-testid="row-decrement"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls out an overdue check-out in error colour', async () => {
    const el = await mount({ checked_out: true, due_date: '2020-01-01' });
    const chip = q(el, '[data-testid="row-checked-out"]');
    expect(chip?.classList.contains('overdue')).toBe(true);
    expect(chip?.textContent).toContain('Overdue');
  });

  it('does not call a future due date overdue', async () => {
    const el = await mount({ checked_out: true, due_date: '2099-01-01' });
    expect(q(el, '[data-testid="row-checked-out"]')?.classList.contains('overdue')).toBe(false);
  });
});

describe('hv-list-row: interaction', () => {
  it('emits stepper events with the item id', async () => {
    const el = await mount({ id: 'item-1', quantity: 5 });
    let detail: { itemId?: string } = {};
    el.addEventListener('increment', (e) => {
      detail = (e as CustomEvent).detail;
    });
    (q(el, '[data-testid="row-increment"]') as HTMLButtonElement).click();
    expect(detail.itemId).toBe('item-1');
  });

  it('does not open the row when the stepper is used', async () => {
    const el = await mount({ id: 'item-1' });
    const seen = captured(el, ['open-item']);
    (q(el, '[data-testid="row-increment"]') as HTMLButtonElement).click();
    expect(seen).toEqual([]);
  });

  it('keeps the keyboard shortcuts the POC row had', async () => {
    const el = await mount({ id: 'item-1' });
    const seen = captured(el, ['open-item', 'request-delete', 'increment', 'decrement']);
    const row = q(el, '[data-testid="list-row"]') as HTMLElement;

    for (const key of ['Enter', 'Delete', '+', '-']) {
      row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(seen).toEqual(['open-item', 'request-delete', 'increment', 'decrement']);
  });

  it('offers edit and row-menu actions, hidden on touch by the mobile attribute', async () => {
    const desktop = await mount({ id: '1' });
    expect(q(desktop, '[data-testid="row-edit"]')).toBeTruthy();
    expect(q(desktop, '[data-testid="row-menu"]')).toBeTruthy();

    // jsdom does not evaluate shadow-DOM CSS, so assert the hook the stylesheet
    // keys off (`:host([mobile]) .hover-actions { display: none }`) rather than
    // a computed style it cannot produce.
    const mobile = await mount({ id: '1' }, { mobile: true });
    expect(mobile.hasAttribute('mobile')).toBe(true);
    expect(mobile.shadowRoot?.querySelector('.hover-actions')).toBeTruthy();
  });

  it('opens the item when the row is tapped', async () => {
    const el = await mount({ id: 'item-1' }, { mobile: true });
    const seen = captured(el, ['open-item']);
    (q(el, '[data-testid="list-row"]') as HTMLElement).click();
    expect(seen).toEqual(['open-item']);
  });
});

describe('hv-list-row: mobile affordances', () => {
  const deepPath = {
    id_path: [],
    name_path: [],
    display_path: 'Workshop / Parts Cabinet / Drawer A / Small Bin',
    sort_key: '',
  };

  it('elides a deep path so the phone row still names the bin', async () => {
    const el = await mount({ category: null, location_path: deepPath }, { mobile: true });
    expect(q(el, '[data-testid="row-secondary"]')?.textContent).toContain('Workshop › … › Small Bin');
  });

  it('leaves the full path on the desktop row, which has the room', async () => {
    const el = await mount({ category: null, location_path: deepPath });
    expect(q(el, '[data-testid="row-secondary"]')?.textContent).toContain(
      'Workshop › Parts Cabinet › Drawer A › Small Bin',
    );
  });

  it('marks low stock with a dot instead of a badge', async () => {
    const el = await mount({ quantity: 1, low_stock_threshold: 5 }, { mobile: true });
    expect(q(el, '[data-testid="row-low-dot"]')).toBeTruthy();
    expect(q(el, '[data-testid="row-low"]')).toBe(null);
  });

  it('replaces the stepper with Check in for a checked-out row', async () => {
    const el = await mount({ checked_out: true, due_date: '2026-07-28' }, { mobile: true });
    expect(q(el, '[data-testid="row-stepper"]')).toBe(null);
    const btn = q(el, '[data-testid="row-check-in"]');
    expect(btn?.textContent).toContain('Check in');
    expect(el.shadowRoot?.textContent).toContain('Checked out · due Jul 28');
  });

  // A passed date used to render exactly like an upcoming one — same wording,
  // same blue — so the row said nothing about being late.
  it('says a passed due date is overdue, and colours it that way', async () => {
    const el = await mount({ checked_out: true, due_date: '2000-01-02' }, { mobile: true });
    const secondary = q(el, '[data-testid="row-secondary"]');

    expect(secondary?.textContent).toContain('Overdue · due Jan 2, 2000');
    expect(secondary?.classList.contains('overdue')).toBe(true);
  });

  it('leaves an upcoming due date alone', async () => {
    const el = await mount({ checked_out: true, due_date: '2999-12-31' }, { mobile: true });
    const secondary = q(el, '[data-testid="row-secondary"]');

    expect(secondary?.textContent).toContain('Checked out · due Dec 31, 2999');
    expect(secondary?.classList.contains('overdue')).toBe(false);
  });
});

describe('hv-list-row: truncation', () => {
  // jsdom does not lay shadow DOM out, so the stylesheet itself is the only
  // thing here worth asserting on — and the bug was entirely in the stylesheet.
  const styleText = () => {
    const styles = (customElements.get('hv-list-row') as typeof HVListRow).styles;
    return (Array.isArray(styles) ? styles : [styles]).map((s) => String(s.cssText)).join('\n');
  };
  const rule = (selector: string) => {
    const css = styleText();
    const start = css.indexOf(`${selector} {`);
    expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start)).replace(/\s+/g, ' ');
  };

  // `overflow`/`text-overflow` are ignored on an inline box, and `text-overflow`
  // is ignored on a flex container. Both lines asked for an ellipsis from a box
  // that could never draw one, so a long path hard-cut mid-character instead.
  it('gives the name line a box an ellipsis can apply to', () => {
    const css = rule('.name');
    expect(css).toMatch(/display: block/);
    expect(css).toMatch(/text-overflow: ellipsis/);
    expect(css).not.toMatch(/display: flex/);
  });

  it('gives the location line a box an ellipsis can apply to', () => {
    const css = rule('.secondary');
    expect(css).toMatch(/display: block/);
    expect(css).toMatch(/text-overflow: ellipsis/);
    expect(css).not.toMatch(/display: flex/);
  });

  it('keeps the low-stock dot on the same line once that line is a block', () => {
    // It used to be a flex item; as a block child it would have stacked above
    // the text and pushed every row 6px taller.
    expect(rule('.dot')).toMatch(/display: inline-block/);
  });

  // 34x34, fifteen to a screen, with − directly beside + — the control most
  // likely to be mis-tapped and the one where a mis-tap moves stock.
  it('sizes the stepper from the inherited touch target on a phone', () => {
    expect(rule(':host([mobile]) .stepper button')).toMatch(/width: var\(--hv-tap-min, 34px\)/);
  });

  it('expands the selection checkbox hit area without resizing the box', () => {
    // The row toggles the same selection, so the grown area can only agree
    // with what is underneath it.
    expect(rule(':host([mobile]) .box::after')).toMatch(
      /inset: calc\(\(var\(--hv-tap-min, 16px\) - 16px\) \/ -2\)/,
    );
  });
});

describe('hv-list-row: selection mode', () => {
  it('swaps row navigation for a checkbox', async () => {
    const el = await mount({ id: 'item-1' }, { selectable: true });
    const seen = captured(el, ['open-item', 'toggle-select']);

    expect(q(el, '[data-testid="row-select"]')).toBeTruthy();
    expect(q(el, '[data-testid="row-edit"]')).toBe(null);

    (q(el, '[data-testid="list-row"]') as HTMLElement).click();
    expect(seen).toEqual(['toggle-select']);
  });

  it('reflects the selected state on the checkbox', async () => {
    const el = await mount({ id: 'item-1' }, { selectable: true, selected: true });
    expect(q(el, '[data-testid="row-select"]')?.getAttribute('aria-checked')).toBe('true');
  });
});

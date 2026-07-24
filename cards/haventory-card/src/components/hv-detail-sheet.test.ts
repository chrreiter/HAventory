import './hv-detail-sheet';
import { makeItem } from '../test.utils';
import type { HVDetailSheet } from './hv-detail-sheet';
import type { Item } from '../store/types';

async function mount(item: Partial<Item>, props: Partial<HVDetailSheet> = {}) {
  const el = document.createElement('hv-detail-sheet') as HVDetailSheet;
  el.item = makeItem(item);
  el.open = true;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

const q = (el: HVDetailSheet, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVDetailSheet, sel: string) =>
  [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

function captured(el: HVDetailSheet, names: string[]) {
  const seen: string[] = [];
  for (const name of names) el.addEventListener(name, () => seen.push(name));
  return seen;
}

describe('hv-detail-sheet: read view', () => {
  it('leads with the name, path and state chips', async () => {
    const el = await mount({
      name: 'Multimeter',
      category: 'Tools',
      tags: ['electric', 'meter'],
      checked_out: true,
      due_date: '2099-07-31',
      location_path: { id_path: [], name_path: [], display_path: 'Garage / Shelf B', sort_key: '' },
    });

    expect(q(el, '[data-testid="sheet-name"]')?.textContent).toContain('Multimeter');
    expect(q(el, '[data-testid="sheet-path"]')?.textContent).toContain('Garage › Shelf B');
    expect(q(el, '[data-testid="sheet-out"]')?.textContent).toContain('Out · due Jul 31');
    expect(q(el, '[data-testid="sheet-category"]')?.textContent).toContain('Tools');
    expect(all(el, '[data-testid="sheet-tag"]').map((t) => t.textContent?.trim())).toEqual([
      'electric',
      'meter',
    ]);
  });

  it('marks an overdue check-out and low stock', async () => {
    const el = await mount({ checked_out: true, due_date: '2020-01-01', quantity: 1, low_stock_threshold: 5 });
    expect(q(el, '[data-testid="sheet-out"]')?.textContent).toContain('Overdue');
    expect(q(el, '[data-testid="sheet-low"]')).toBeTruthy();
  });

  it('makes quantity the primary action, with the threshold as a caption', async () => {
    const el = await mount({ quantity: 2, low_stock_threshold: 8 });
    expect(q(el, '[data-testid="sheet-qty"]')?.textContent).toBe('2');
    expect(q(el, '[data-testid="sheet-qty"]')?.classList.contains('low')).toBe(true);
    expect(q(el, '[data-testid="sheet-threshold"]')?.textContent).toContain('low-stock at 8');
  });

  it('emits quantity changes', async () => {
    const el = await mount({ id: 'item-1', quantity: 5 });
    const seen = captured(el, ['increment', 'decrement']);
    (q(el, '[data-testid="sheet-increment"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="sheet-decrement"]') as HTMLButtonElement).click();
    expect(seen).toEqual(['increment', 'decrement']);
  });

  it('disables the stepper for a checked-out item and at zero', async () => {
    const out = await mount({ checked_out: true, quantity: 3 });
    expect((q(out, '[data-testid="sheet-increment"]') as HTMLButtonElement).disabled).toBe(true);

    const zero = await mount({ quantity: 0 });
    expect((q(zero, '[data-testid="sheet-decrement"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(zero, '[data-testid="sheet-increment"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reads out custom fields as facts, typed', async () => {
    const el = await mount({
      custom_fields: { serial: '44210-887', purchase_price: 189, calibrated: true, checked: '2019-02-01' },
    });
    const facts = Object.fromEntries(
      all(el, '[data-testid="sheet-fact"]').map((f) => [f.dataset.key, f.textContent?.replace(/\s+/g, ' ').trim()]),
    );
    expect(facts.serial).toContain('44210-887');
    expect(facts.purchase_price).toContain('189');
    expect(facts.calibrated).toContain('Yes');
    // Dates render through the same formatter as the rest of the card.
    expect(facts.checked).toContain('Feb 1, 2019');
  });

  it('says "Not set" rather than hiding an empty date', async () => {
    const el = await mount({ due_date: null, inspection_date: null });
    const facts = all(el, '[data-testid="sheet-fact"]');
    expect(facts.find((f) => f.dataset.key === 'due')?.textContent).toContain('Not set');
    expect(facts.find((f) => f.dataset.key === 'inspection')?.textContent).toContain('Not set');
  });

  it('shows the version alongside when it was updated', async () => {
    const el = await mount({ version: 14 });
    expect(q(el, '[data-testid="sheet-updated"]')?.textContent).toContain('v14');
  });

  it('offers check out or check in depending on the state', async () => {
    const inStock = await mount({ checked_out: false });
    expect(q(inStock, '[data-testid="sheet-check-out"]')).toBeTruthy();
    expect(q(inStock, '[data-testid="sheet-check-in"]')).toBe(null);

    const out = await mount({ checked_out: true });
    expect(q(out, '[data-testid="sheet-check-in"]')).toBeTruthy();
    expect(q(out, '[data-testid="sheet-check-out"]')).toBe(null);
  });

  it('emits check-out, check-in and delete', async () => {
    const el = await mount({ id: 'item-1' });
    const seen = captured(el, ['check-out', 'request-delete']);
    (q(el, '[data-testid="sheet-check-out"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="sheet-delete"]') as HTMLButtonElement).click();
    expect(seen).toEqual(['check-out', 'request-delete']);
  });

  it('closes from the ✕', async () => {
    const el = await mount({ id: '1' });
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });
    (q(el, '[data-testid="sheet-close"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});

describe('hv-detail-sheet: edit view', () => {
  it('swaps to the form in the same sheet, never a second dialog', async () => {
    const el = await mount({ id: '1', name: 'Multimeter' });
    expect(q(el, '[data-testid="sheet-editor"]')).toBe(null);

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
    // Still one sheet.
    expect(all(el, 'hv-bottom-sheet')).toHaveLength(1);
    // The read view is gone, not stacked underneath.
    expect(q(el, '[data-testid="sheet-qty"]')).toBe(null);
  });

  it('reaches the form from "Edit details" too', async () => {
    const el = await mount({ id: '1' });
    (q(el, '[data-testid="sheet-edit-details"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
  });

  it('goes back to the read view', async () => {
    const el = await mount({ id: '1' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    (q(el, '[data-testid="sheet-back"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });

  it('drives the embedded editor from the sheet header Save', async () => {
    const el = await mount({ id: 'item-1', name: 'Old' });
    const saves: unknown[] = [];
    el.addEventListener('save', (e) => saves.push((e as CustomEvent).detail));

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'New';
    name.dispatchEvent(new Event('input'));
    await el.updateComplete;

    (q(el, '[data-testid="sheet-save"]') as HTMLButtonElement).click();
    expect(saves).toHaveLength(1);
    expect((saves[0] as { changes: { name: string } }).changes.name).toBe('New');
  });

  it('reports whether the form has unsaved changes', async () => {
    const el = await mount({ id: '1', name: 'A' });
    expect(el.dirty).toBe(false);

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.dirty).toBe(false);

    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'B';
    name.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(el.dirty).toBe(true);
  });

  it('returns to the read view when a different item is loaded', async () => {
    const el = await mount({ id: '1', name: 'A' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    el.item = makeItem({ id: '2', name: 'B' });
    await el.updateComplete;
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });
});

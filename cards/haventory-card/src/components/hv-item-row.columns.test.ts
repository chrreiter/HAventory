import { describe, it, expect, afterEach } from 'vitest';
import './hv-item-row';
import './hv-inventory-list';
import type { Item } from '../store/types';
import type { ColumnKey } from '../store/columns';

function makeItem(overrides?: Partial<Item>): Item {
  const now = new Date().toISOString();
  return {
    id: '1', name: 'Drill', description: null, quantity: 4, checked_out: false,
    due_date: '2026-08-01', inspection_date: null, location_id: 'loc1',
    tags: ['power', 'metal'], category: 'Tools', low_stock_threshold: null,
    custom_fields: {}, created_at: now, updated_at: now, version: 1,
    location_path: { id_path: ['g'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
    ...overrides,
  };
}

async function mountRow(columns: ColumnKey[], compact = false) {
  const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
  (el as any).item = makeItem();
  (el as any).columns = columns;
  (el as any).compact = compact;
  document.body.appendChild(el);
  await customElements.whenDefined('hv-item-row');
  if (el.updateComplete) await el.updateComplete;
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('hv-item-row configurable columns', () => {
  it('renders only the selected columns', async () => {
    const el = await mountRow(['quantity', 'tags']);
    const sr = el.shadowRoot as ShadowRoot;
    const text = sr.textContent || '';
    expect(text).toContain('4');            // quantity
    expect(text).toContain('power, metal'); // tags
    expect(text).not.toContain('Tools');    // category not selected
    expect(text).not.toContain('Garage');   // location not selected
  });

  it('renders the due date column when selected', async () => {
    const el = await mountRow(['due_date']);
    const sr = el.shadowRoot as ShadowRoot;
    expect(sr.textContent || '').toContain('2026-08-01');
  });

  it('compact mode omits the check-out button; full mode includes it', async () => {
    const compact = await mountRow(['quantity'], true);
    const compactBtns = Array.from((compact.shadowRoot as ShadowRoot).querySelectorAll('button')).map((b) => b.textContent);
    expect(compactBtns).not.toContain('Out');

    const full = await mountRow(['quantity'], false);
    const fullBtns = Array.from((full.shadowRoot as ShadowRoot).querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(fullBtns).toContain('Out');
  });
});

describe('hv-inventory-list configurable columns', () => {
  it('renders headers for the selected columns only', async () => {
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).items = [makeItem()];
    (el as any).columns = ['quantity', 'due_date'];
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    if (el.updateComplete) await el.updateComplete;

    const headers = Array.from((el.shadowRoot as ShadowRoot).querySelectorAll('[role="columnheader"]'))
      .map((h) => h.textContent?.trim())
      .filter((t) => t);
    expect(headers).toEqual(['Name', 'Qty', 'Due']);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import './hv-category-browser';
import type { DistinctValue, Item } from '../store/types';

type Browser = HTMLElement & {
  open: boolean;
  categories: DistinctValue[];
  selectedCategory: string | null;
  items: Item[];
  loading: boolean;
  updateComplete?: Promise<unknown>;
};

function makeItem(partial: Partial<Item>): Item {
  return {
    id: 'i', name: 'Item', description: null, quantity: 1, checked_out: false,
    due_date: null, inspection_date: null, location_id: null, tags: [], category: null,
    low_stock_threshold: null, custom_fields: {}, created_at: '', updated_at: '', version: 1,
    location_path: { id_path: [], name_path: [], display_path: '', sort_key: '' },
    ...partial,
  };
}

async function mount(props: Partial<Browser>): Promise<Browser> {
  const el = document.createElement('hv-category-browser') as Browser;
  Object.assign(el, props);
  document.body.appendChild(el);
  await customElements.whenDefined('hv-category-browser');
  el.open = true;
  if (el.updateComplete) await el.updateComplete;
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('hv-category-browser', () => {
  it('lists categories with counts', async () => {
    const el = await mount({ categories: [{ value: 'Books', count: 3 }, { value: 'Tools', count: 5 }] });
    const sr = el.shadowRoot as ShadowRoot;
    const rows = Array.from(sr.querySelectorAll('[data-testid="category-row"]'));
    expect(rows.map((r) => r.getAttribute('data-value'))).toEqual(['Books', 'Tools']);
    expect(rows.map((r) => r.querySelector('.count')?.textContent)).toEqual(['3', '5']);
  });

  it('filters the category list', async () => {
    const el = await mount({ categories: [{ value: 'Books', count: 1 }, { value: 'Tools', count: 1 }, { value: 'Toys', count: 1 }] });
    const sr = el.shadowRoot as ShadowRoot;
    const filter = sr.querySelector('[data-testid="category-filter"]') as HTMLInputElement;
    filter.value = 'to';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    if (el.updateComplete) await el.updateComplete;
    const rows = Array.from(sr.querySelectorAll('[data-testid="category-row"]'));
    expect(rows.map((r) => r.getAttribute('data-value'))).toEqual(['Tools', 'Toys']);
  });

  it('emits select-category when a category is clicked', async () => {
    const el = await mount({ categories: [{ value: 'Tools', count: 2 }] });
    const sr = el.shadowRoot as ShadowRoot;
    let picked: string | null = null;
    el.addEventListener('select-category', (e: any) => { picked = e.detail.category; });
    (sr.querySelector('[data-testid="category-row"]') as HTMLButtonElement).click();
    expect(picked).toBe('Tools');
  });

  it('shows the drill-down items and a back button when a category is selected', async () => {
    const el = await mount({
      categories: [{ value: 'Tools', count: 2 }],
      selectedCategory: 'Tools',
      items: [
        makeItem({ id: '1', name: 'Hammer', quantity: 2, location_path: { id_path: [], name_path: [], display_path: 'Garage', sort_key: '' } }),
        makeItem({ id: '2', name: 'Wrench', quantity: 1 }),
      ],
    });
    const sr = el.shadowRoot as ShadowRoot;
    const rows = Array.from(sr.querySelectorAll('[data-testid="item-row"]'));
    expect(rows.map((r) => r.querySelector('.grow')?.textContent)).toEqual(['Hammer', 'Wrench']);
    expect(sr.querySelector('.header h2')?.textContent).toBe('Tools');
    expect(sr.querySelector('[data-testid="browser-back"]')).toBeTruthy();

    let cleared = false;
    el.addEventListener('clear-category', () => { cleared = true; });
    (sr.querySelector('[data-testid="browser-back"]') as HTMLButtonElement).click();
    expect(cleared).toBe(true);
  });

  it('emits open-item when a drill-down item is clicked', async () => {
    const el = await mount({
      selectedCategory: 'Tools',
      items: [makeItem({ id: 'abc', name: 'Hammer' })],
    });
    const sr = el.shadowRoot as ShadowRoot;
    let openedId: string | null = null;
    el.addEventListener('open-item', (e: any) => { openedId = e.detail.itemId; });
    (sr.querySelector('[data-testid="item-row"]') as HTMLButtonElement).click();
    expect(openedId).toBe('abc');
  });

  it('shows loading and empty states in the drill-down', async () => {
    const el = await mount({ selectedCategory: 'Tools', loading: true, items: [] });
    let sr = el.shadowRoot as ShadowRoot;
    expect(sr.querySelector('[data-testid="browser-loading"]')).toBeTruthy();

    (el as Browser).loading = false;
    if (el.updateComplete) await el.updateComplete;
    sr = el.shadowRoot as ShadowRoot;
    expect(sr.querySelector('[data-testid="browser-empty"]')?.textContent).toContain('No items');
  });

  it('shows an empty state when there are no categories', async () => {
    const el = await mount({ categories: [] });
    const sr = el.shadowRoot as ShadowRoot;
    expect(sr.querySelector('[data-testid="browser-empty"]')?.textContent).toContain('No categories');
  });

  it('Escape steps back when drilled in, and closes at the top level', async () => {
    const el = await mount({ categories: [{ value: 'Tools', count: 1 }], selectedCategory: 'Tools', items: [] });
    const sr = el.shadowRoot as ShadowRoot;
    const panel = sr.querySelector('[role="dialog"]') as HTMLElement;

    let cleared = false; let cancelled = false;
    el.addEventListener('clear-category', () => { cleared = true; });
    el.addEventListener('cancel', () => { cancelled = true; });

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cleared).toBe(true);
    expect(cancelled).toBe(false);

    // Back at the top level, Escape closes.
    (el as Browser).selectedCategory = null;
    if (el.updateComplete) await el.updateComplete;
    (sr.querySelector('[role="dialog"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toBe(true);
    expect(el.open).toBe(false);
  });

  it('closes on backdrop click', async () => {
    const el = await mount({ categories: [] });
    const sr = el.shadowRoot as ShadowRoot;
    let cancelled = false;
    el.addEventListener('cancel', () => { cancelled = true; });
    (sr.querySelector('.backdrop') as HTMLElement).click();
    expect(cancelled).toBe(true);
    expect(el.open).toBe(false);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import './hv-tag-browser';
import type { DistinctValue, Item } from '../store/types';

type Browser = HTMLElement & {
  open: boolean;
  tags: DistinctValue[];
  selectedTag: string | null;
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
  const el = document.createElement('hv-tag-browser') as Browser;
  Object.assign(el, props);
  document.body.appendChild(el);
  await customElements.whenDefined('hv-tag-browser');
  el.open = true;
  if (el.updateComplete) await el.updateComplete;
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('hv-tag-browser', () => {
  it('lists tags with counts', async () => {
    const el = await mount({ tags: [{ value: 'blue', count: 2 }, { value: 'red', count: 4 }] });
    const sr = el.shadowRoot as ShadowRoot;
    const rows = Array.from(sr.querySelectorAll('[data-testid="tag-row"]'));
    expect(rows.map((r) => r.getAttribute('data-value'))).toEqual(['blue', 'red']);
    expect(rows.map((r) => r.querySelector('.count')?.textContent)).toEqual(['2', '4']);
  });

  it('filters the tag list', async () => {
    const el = await mount({ tags: [{ value: 'blue', count: 1 }, { value: 'red', count: 1 }, { value: 'green', count: 1 }] });
    const sr = el.shadowRoot as ShadowRoot;
    const filter = sr.querySelector('[data-testid="tag-filter"]') as HTMLInputElement;
    filter.value = 'e';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    if (el.updateComplete) await el.updateComplete;
    const rows = Array.from(sr.querySelectorAll('[data-testid="tag-row"]'));
    expect(rows.map((r) => r.getAttribute('data-value'))).toEqual(['blue', 'red', 'green']
      .filter((v) => v.includes('e')));
  });

  it('emits select-tag when a tag is clicked', async () => {
    const el = await mount({ tags: [{ value: 'red', count: 2 }] });
    const sr = el.shadowRoot as ShadowRoot;
    let picked: string | null = null;
    el.addEventListener('select-tag', (e: any) => { picked = e.detail.tag; });
    (sr.querySelector('[data-testid="tag-row"]') as HTMLButtonElement).click();
    expect(picked).toBe('red');
  });

  it('shows drill-down items and a back button when a tag is selected', async () => {
    const el = await mount({
      tags: [{ value: 'red', count: 2 }],
      selectedTag: 'red',
      items: [makeItem({ id: '1', name: 'Hammer', quantity: 2 }), makeItem({ id: '2', name: 'Wrench' })],
    });
    const sr = el.shadowRoot as ShadowRoot;
    const rows = Array.from(sr.querySelectorAll('[data-testid="item-row"]'));
    expect(rows.map((r) => r.querySelector('.grow')?.textContent)).toEqual(['Hammer', 'Wrench']);
    expect(sr.querySelector('.header h2')?.textContent).toBe('#red');

    let cleared = false;
    el.addEventListener('clear-tag', () => { cleared = true; });
    (sr.querySelector('[data-testid="browser-back"]') as HTMLButtonElement).click();
    expect(cleared).toBe(true);
  });

  it('emits open-item when a drill-down item is clicked', async () => {
    const el = await mount({ selectedTag: 'red', items: [makeItem({ id: 'xyz', name: 'Hammer' })] });
    const sr = el.shadowRoot as ShadowRoot;
    let openedId: string | null = null;
    el.addEventListener('open-item', (e: any) => { openedId = e.detail.itemId; });
    (sr.querySelector('[data-testid="item-row"]') as HTMLButtonElement).click();
    expect(openedId).toBe('xyz');
  });

  it('shows loading and empty drill-down states', async () => {
    const el = await mount({ selectedTag: 'red', loading: true, items: [] });
    let sr = el.shadowRoot as ShadowRoot;
    expect(sr.querySelector('[data-testid="browser-loading"]')).toBeTruthy();

    (el as Browser).loading = false;
    if (el.updateComplete) await el.updateComplete;
    sr = el.shadowRoot as ShadowRoot;
    expect(sr.querySelector('[data-testid="browser-empty"]')?.textContent).toContain('No items');
  });

  it('shows an empty state when there are no tags', async () => {
    const el = await mount({ tags: [] });
    const sr = el.shadowRoot as ShadowRoot;
    expect(sr.querySelector('[data-testid="browser-empty"]')?.textContent).toContain('No tags');
  });

  it('Escape steps back when drilled in, and closes at the top level', async () => {
    const el = await mount({ tags: [{ value: 'red', count: 1 }], selectedTag: 'red', items: [] });
    const sr = el.shadowRoot as ShadowRoot;
    let cleared = false; let cancelled = false;
    el.addEventListener('clear-tag', () => { cleared = true; });
    el.addEventListener('cancel', () => { cancelled = true; });

    (sr.querySelector('[role="dialog"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cleared).toBe(true);
    expect(cancelled).toBe(false);

    (el as Browser).selectedTag = null;
    if (el.updateComplete) await el.updateComplete;
    (sr.querySelector('[role="dialog"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toBe(true);
    expect(el.open).toBe(false);
  });

  it('closes on backdrop click', async () => {
    const el = await mount({ tags: [] });
    const sr = el.shadowRoot as ShadowRoot;
    let cancelled = false;
    el.addEventListener('cancel', () => { cancelled = true; });
    (sr.querySelector('.backdrop') as HTMLElement).click();
    expect(cancelled).toBe(true);
    expect(el.open).toBe(false);
  });
});

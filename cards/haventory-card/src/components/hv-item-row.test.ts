import { describe, it, expect } from 'vitest';
import './hv-item-row';
import type { Item } from '../store/types';

function makeItem(overrides?: Partial<Item>): Item {
  const now = new Date().toISOString();
  return {
    id: '1',
    name: 'Test Item',
    description: null,
    quantity: 10,
    checked_out: false,
    due_date: null,
    location_id: 'loc1',
    tags: [],
    category: 'Tools',
    low_stock_threshold: null,
    custom_fields: {},
    created_at: now,
    updated_at: now,
    version: 1,
    location_path: {
      id_path: ['root', 'garage', 'shelf'],
      name_path: ['Home', 'Garage', 'Shelf A'],
      display_path: 'Home / Garage / Shelf A',
      sort_key: 'home/garage/shelf a',
    },
    ...overrides,
  };
}

describe('hv-item-row', () => {
  it('renders item with name, quantity, category, and location', async () => {
    const item = makeItem({ name: 'Drill', quantity: 5, category: 'Tools' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const text = sr.textContent || '';

    expect(text).toContain('Drill');
    expect(text).toContain('5');
    expect(text).toContain('Tools');
    expect(text).toContain('Home / Garage / Shelf A');
  });

  it('shows LOW badge when quantity is at or below low_stock_threshold', async () => {
    const item = makeItem({ quantity: 2, low_stock_threshold: 5 });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const badge = sr.querySelector('.badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('LOW');
  });

  it('does not show LOW badge when quantity is above threshold', async () => {
    const item = makeItem({ quantity: 10, low_stock_threshold: 5 });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const badge = sr.querySelector('.badge');
    expect(badge).toBe(null);
  });

  it('resolves and displays area name from location and areas data', async () => {
    const item = makeItem({ location_id: 'loc1' });
    const areas = [{ id: 'area1', name: 'Garage' }];
    const locations = [{ id: 'loc1', area_id: 'area1' }];

    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    (el as any).areas = areas;
    (el as any).locations = locations;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const text = sr.textContent || '';
    expect(text).toContain('[Area: Garage]');
  });

  it('does not show area label when location has no area', async () => {
    const item = makeItem({ location_id: 'loc1' });
    const locations = [{ id: 'loc1', area_id: null }];

    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    (el as any).areas = [];
    (el as any).locations = locations;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const text = sr.textContent || '';
    expect(text).not.toContain('[Area:');
  });

  it('emits decrement event when − button is clicked', async () => {
    const item = makeItem({ id: 'item1' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('decrement', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const decrementBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === '−');
    decrementBtn?.click();

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });

  it('emits increment event when + button is clicked', async () => {
    const item = makeItem({ id: 'item1' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('increment', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const incrementBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === '+');
    incrementBtn?.click();

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });

  it('emits edit event when Edit button is clicked', async () => {
    const item = makeItem({ id: 'item1' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('edit', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const editBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Edit');
    editBtn?.click();

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });

  it('emits toggle-checkout event when Out/In button is clicked', async () => {
    const item = makeItem({ id: 'item1', checked_out: false });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('toggle-checkout', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const checkoutBtn = Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Out');
    checkoutBtn?.click();

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });

  it('handles Enter key to open edit dialog', async () => {
    const item = makeItem({ id: 'item1' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('edit', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const row = sr.querySelector('.row') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });

  it('handles Delete key to request deletion', async () => {
    const item = makeItem({ id: 'item1' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('request-delete', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const row = sr.querySelector('.row') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });

  it('handles + key to increment quantity', async () => {
    const item = makeItem({ id: 'item1' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('increment', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const row = sr.querySelector('.row') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });

  it('handles - key to decrement quantity', async () => {
    const item = makeItem({ id: 'item1' });
    const el = document.createElement('hv-item-row') as HTMLElement & { updateComplete?: Promise<unknown> };
    (el as any).item = item;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-row');
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    let eventDetail: any = null;
    el.addEventListener('decrement', (e: any) => {
      eventDetail = e.detail;
    });

    const sr = el.shadowRoot as ShadowRoot;
    const row = sr.querySelector('.row') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));

    expect(eventDetail).toBeTruthy();
    expect(eventDetail.itemId).toBe('item1');
  });
});

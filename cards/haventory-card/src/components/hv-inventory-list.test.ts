import { describe, it, expect } from 'vitest';
import './hv-inventory-list';
import './hv-item-row';
import type { Item } from '../store/types';

function makeItems(n: number): Item[] {
  const now = new Date().toISOString();
  return Array.from({ length: n }, (_, i) => ({
    id: `${i}`,
    name: `Item ${i}`,
    description: null,
    quantity: i,
    checked_out: false,
    due_date: null,
    location_id: null,
    tags: [],
    category: null,
    low_stock_threshold: null,
    custom_fields: {},
    created_at: now,
    updated_at: now,
    version: 1,
    location_path: { id_path: [], name_path: [], display_path: '', sort_key: '' },
  }));
}

describe('hv-inventory-list', () => {
  it('renders visible rows and emits near-end at threshold', async () => {
    // Expanded view (fill) uses a full-height scroll container and should emit near-end
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = makeItems(120);
    (el as any).fill = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const fillList = sr.querySelector('.fill-list') as HTMLElement;
    expect(fillList).toBeTruthy();

    let ratioSeen = 0;
    el.addEventListener('near-end', (e: any) => { ratioSeen = e.detail?.ratio ?? 0; });

    // Simulate scroll to ~80%
    Object.defineProperty(fillList, 'scrollTop', { value: 800, configurable: true });
    Object.defineProperty(fillList, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(fillList, 'scrollHeight', { value: 1250, configurable: true });
    fillList.dispatchEvent(new Event('scroll'));

    expect(ratioSeen).toBeGreaterThan(0.7);
  });

  it('renders empty state when items array is empty', async () => {
    // Empty state should show helpful message when no items exist
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = [];
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const emptyState = sr.querySelector('.empty-state');
    expect(emptyState).toBeTruthy();
    expect(sr.textContent).toContain('No items found');
    expect(sr.textContent).toContain('Try adjusting your filters');

    // Should not render the virtualizer or header
    const virt = sr.querySelector('lit-virtualizer');
    expect(virt).toBe(null);
  });

  it('does not render empty state when items exist', async () => {
    // Normal list view when items are present
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = makeItems(5);
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const emptyState = sr.querySelector('.empty-state');
    expect(emptyState).toBe(null);

    // Should render header
    const header = sr.querySelector('.header');
    expect(header).toBeTruthy();
  });

  it('uses plain list for compact card view', async () => {
    // Non-fill mode should always use a plain list with capped height
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = makeItems(8);
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const plainList = sr.querySelector('.plain-list');

    expect(plainList).toBeTruthy();
  });

  it('uses plain list regardless of item count in compact card view', async () => {
    // Even larger item counts in compact mode should still use a plain list
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = makeItems(50);
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const plainList = sr.querySelector('.plain-list');

    expect(plainList).toBeTruthy();
  });

  it('uses fill-list container in fill mode (expanded view)', async () => {
    // In expanded view (fill), a dedicated fill-list container should be used
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = makeItems(10);
    (el as any).fill = true;
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const plainList = sr.querySelector('.plain-list');
    const fillList = sr.querySelector('.fill-list');

    expect(plainList).toBe(null);
    expect(fillList).toBeTruthy();
  });

  it('emits near-end event from plain list scroll', async () => {
    // Plain list should also emit near-end events for prefetch
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = makeItems(5);
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const plainList = sr.querySelector('.plain-list') as HTMLElement;
    expect(plainList).toBeTruthy();

    let ratioSeen = 0;
    el.addEventListener('near-end', (e: any) => { ratioSeen = e.detail?.ratio ?? 0; });

    // Simulate scroll
    Object.defineProperty(plainList, 'scrollTop', { value: 100, configurable: true });
    Object.defineProperty(plainList, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(plainList, 'scrollHeight', { value: 400, configurable: true });
    plainList.dispatchEvent(new Event('scroll'));

    expect(ratioSeen).toBeCloseTo(0.75, 1);
  });
});

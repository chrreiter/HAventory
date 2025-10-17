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
    const el = document.createElement('hv-inventory-list') as HTMLElement & { updateComplete?: Promise<unknown> };
    document.body.appendChild(el);
    await customElements.whenDefined('hv-inventory-list');
    (el as any).items = makeItems(120);
    if ('updateComplete' in el && el.updateComplete) await el.updateComplete;

    const sr = el.shadowRoot as ShadowRoot;
    const virt = sr.querySelector('lit-virtualizer') as HTMLElement;
    expect(virt).toBeTruthy();

    let ratioSeen = 0;
    el.addEventListener('near-end', (e: any) => { ratioSeen = e.detail?.ratio ?? 0; });

    // Simulate scroll to ~80%
    Object.defineProperty(virt, 'scrollTop', { value: 800, configurable: true });
    Object.defineProperty(virt, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(virt, 'scrollHeight', { value: 1250, configurable: true });
    virt.dispatchEvent(new Event('scroll'));

    expect(ratioSeen).toBeGreaterThan(0.7);
  });
});

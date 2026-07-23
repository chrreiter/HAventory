import { describe, it, expect, afterEach } from 'vitest';
import './hv-column-picker';
import type { ColumnKey } from '../store/columns';

type Picker = HTMLElement & {
  open: boolean;
  columns: ColumnKey[];
  heading: string;
  updateComplete?: Promise<unknown>;
};

async function mount(props: Partial<Picker>): Promise<Picker> {
  const el = document.createElement('hv-column-picker') as Picker;
  Object.assign(el, props);
  document.body.appendChild(el);
  await customElements.whenDefined('hv-column-picker');
  el.open = true;
  if (el.updateComplete) await el.updateComplete;
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('hv-column-picker', () => {
  it('reflects the current selection as checked boxes', async () => {
    const el = await mount({ columns: ['quantity', 'location'] });
    const sr = el.shadowRoot as ShadowRoot;
    const boxes = Array.from(sr.querySelectorAll('[data-testid="column-option"]')) as HTMLInputElement[];
    const checked = boxes.filter((b) => b.checked).map((b) => b.getAttribute('data-key'));
    expect(checked).toEqual(['quantity', 'location']);
  });

  it('emits change with the added column (canonical order) when a box is checked', async () => {
    const el = await mount({ columns: ['location'] });
    const sr = el.shadowRoot as ShadowRoot;
    let received: ColumnKey[] | null = null;
    el.addEventListener('change', (e: any) => { received = e.detail.columns; });

    const qty = sr.querySelector('[data-testid="column-option"][data-key="quantity"]') as HTMLInputElement;
    qty.checked = true;
    qty.dispatchEvent(new Event('change', { bubbles: true }));
    // canonical order: quantity before location
    expect(received).toEqual(['quantity', 'location']);
  });

  it('emits change removing a column when unchecked', async () => {
    const el = await mount({ columns: ['quantity', 'category'] });
    const sr = el.shadowRoot as ShadowRoot;
    let received: ColumnKey[] | null = null;
    el.addEventListener('change', (e: any) => { received = e.detail.columns; });

    const cat = sr.querySelector('[data-testid="column-option"][data-key="category"]') as HTMLInputElement;
    cat.checked = false;
    cat.dispatchEvent(new Event('change', { bubbles: true }));
    expect(received).toEqual(['quantity']);
  });

  it('closes on Done and on Escape', async () => {
    const el = await mount({ columns: [] });
    const sr = el.shadowRoot as ShadowRoot;
    let cancels = 0;
    el.addEventListener('cancel', () => { cancels += 1; });
    (sr.querySelector('[data-testid="column-picker-done"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});

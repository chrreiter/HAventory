import { describe, it, expect, afterEach } from 'vitest';
import './hv-item-dialog';
import type { Item } from '../store/types';

type Dialog = HTMLElement & {
  open: boolean;
  item: Item | null;
  customFieldKeys: string[];
  updateComplete?: Promise<unknown>;
};

function makeItem(custom_fields: Record<string, string | number | boolean>): Item {
  return {
    id: '1', name: 'Thing', description: null, quantity: 1, checked_out: false,
    due_date: null, inspection_date: null, location_id: null, tags: [], category: null,
    low_stock_threshold: null, custom_fields, created_at: '', updated_at: '', version: 1,
    location_path: { id_path: [], name_path: [], display_path: '', sort_key: '' },
  };
}

async function mount(props: Partial<Dialog>): Promise<Dialog> {
  const el = document.createElement('hv-item-dialog') as Dialog;
  Object.assign(el, props);
  document.body.appendChild(el);
  await customElements.whenDefined('hv-item-dialog');
  el.open = true;
  if (el.updateComplete) await el.updateComplete;
  return el;
}

function setName(sr: ShadowRoot, name: string) {
  const nameInput = sr.querySelector('input[type="text"]') as HTMLInputElement;
  nameInput.value = name;
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
}

async function addField(el: Dialog) {
  const sr = el.shadowRoot as ShadowRoot;
  (sr.querySelector('[data-testid="cf-add"]') as HTMLButtonElement).click();
  if (el.updateComplete) await el.updateComplete;
}

function rows(sr: ShadowRoot): HTMLElement[] {
  return Array.from(sr.querySelectorAll('[data-testid="cf-row"]'));
}

async function fillRow(el: Dialog, row: HTMLElement, key: string, type: string, value: string) {
  const keyInput = row.querySelector('[data-testid="cf-key"]') as HTMLInputElement;
  keyInput.value = key;
  keyInput.dispatchEvent(new Event('input', { bubbles: true }));

  const typeSel = row.querySelector('[data-testid="cf-type"]') as HTMLSelectElement;
  typeSel.value = type;
  typeSel.dispatchEvent(new Event('change', { bubbles: true }));
  if (el.updateComplete) await el.updateComplete;

  // Re-query the row (value input type may have changed after the type switch).
  const freshRow = rows(el.shadowRoot as ShadowRoot).find(
    (r) => (r.querySelector('[data-testid="cf-key"]') as HTMLInputElement).value === key,
  ) as HTMLElement;
  const valInput = freshRow.querySelector('[data-testid="cf-value"]') as HTMLInputElement;
  if (type === 'boolean') {
    valInput.checked = value === 'true';
    valInput.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    valInput.value = value;
    valInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (el.updateComplete) await el.updateComplete;
}

function save(sr: ShadowRoot) {
  (sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement).click();
}

afterEach(() => { document.body.innerHTML = ''; });

describe('hv-item-dialog custom fields', () => {
  it('adds a typed custom field on create', async () => {
    const el = await mount({});
    const sr = el.shadowRoot as ShadowRoot;
    setName(sr, 'Gadget');

    await addField(el);
    await fillRow(el, rows(sr)[0], 'color', 'string', 'red');

    let detail: any = null;
    el.addEventListener('save', (e: any) => { detail = e.detail; });
    save(sr);

    expect(detail.custom_fields).toEqual({ color: 'red' });
    // Create path: no *_set / *_unset keys.
    expect('custom_fields_set' in detail).toBe(false);
  });

  it('stores number, boolean, and date fields with correct types', async () => {
    const el = await mount({});
    const sr = el.shadowRoot as ShadowRoot;
    setName(sr, 'Gadget');

    await addField(el);
    await fillRow(el, rows(sr)[0], 'voltage', 'number', '18');
    await addField(el);
    await fillRow(el, rows(sr)[1], 'active', 'boolean', 'true');
    await addField(el);
    await fillRow(el, rows(sr)[2], 'bought', 'date', '2026-08-01');

    let detail: any = null;
    el.addEventListener('save', (e: any) => { detail = e.detail; });
    save(sr);

    expect(detail.custom_fields).toEqual({ voltage: 18, active: true, bought: '2026-08-01' });
  });

  it('rejects a non-numeric number field with a validation error', async () => {
    const el = await mount({});
    const sr = el.shadowRoot as ShadowRoot;
    setName(sr, 'Gadget');
    await addField(el);
    await fillRow(el, rows(sr)[0], 'weight', 'number', 'heavy');

    let saved = false;
    el.addEventListener('save', () => { saved = true; });
    save(sr);
    if (el.updateComplete) await el.updateComplete;

    expect(saved).toBe(false);
    expect((sr.textContent || '').toLowerCase()).toContain('must be a number');
  });

  it('pre-populates rows from an existing item with inferred types', async () => {
    const el = await mount({ item: makeItem({ note: 'hi', count: 3, flag: true, when: '2026-01-02' }) });
    const sr = el.shadowRoot as ShadowRoot;
    const typeByKey: Record<string, string> = {};
    for (const r of rows(sr)) {
      const key = (r.querySelector('[data-testid="cf-key"]') as HTMLInputElement).value;
      typeByKey[key] = (r.querySelector('[data-testid="cf-type"]') as HTMLSelectElement).value;
    }
    expect(typeByKey).toEqual({ note: 'string', count: 'number', flag: 'boolean', when: 'date' });
  });

  it('emits custom_fields_set and custom_fields_unset when editing', async () => {
    const el = await mount({ item: makeItem({ a: 'x', n: 5 }) });
    const sr = el.shadowRoot as ShadowRoot;

    // Remove the row for key 'a'.
    const rowA = rows(sr).find(
      (r) => (r.querySelector('[data-testid="cf-key"]') as HTMLInputElement).value === 'a',
    ) as HTMLElement;
    (rowA.querySelector('[data-testid="cf-remove"]') as HTMLButtonElement).click();
    if (el.updateComplete) await el.updateComplete;

    let detail: any = null;
    el.addEventListener('save', (e: any) => { detail = e.detail; });
    save(sr);

    expect(detail.custom_fields_set).toEqual({ n: 5 });
    expect(detail.custom_fields_unset).toEqual(['a']);
    expect('custom_fields' in detail).toBe(false);
  });

  it('offers existing field keys as datalist suggestions', async () => {
    const el = await mount({ customFieldKeys: ['serial', 'warranty'] });
    const sr = el.shadowRoot as ShadowRoot;
    const opts = Array.from(sr.querySelectorAll('#cf-key-suggestions option')).map((o) => o.getAttribute('value'));
    expect(opts).toEqual(['serial', 'warranty']);
  });
});

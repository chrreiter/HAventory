import { describe, it, expect, afterEach } from 'vitest';
import './hv-column-picker';
import type { ColumnKey } from '../store/columns';
import type { HVColumnPicker } from './hv-column-picker';

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

const option = (el: Picker, key: string) =>
  el.shadowRoot?.querySelector(`[data-testid="column-option"][data-key="${key}"]`) as HTMLButtonElement;

describe('hv-column-picker', () => {
  it('reflects the current selection as ticked boxes', async () => {
    const el = await mount({ columns: ['quantity', 'location'] });
    const sr = el.shadowRoot as ShadowRoot;
    const rows = Array.from(sr.querySelectorAll('[data-testid="column-option"]')) as HTMLElement[];
    const checked = rows
      .filter((r) => r.getAttribute('aria-checked') === 'true')
      .map((r) => r.getAttribute('data-key'));
    expect(checked).toEqual(['quantity', 'location']);
  });

  it('emits change with the added column (canonical order) when a box is ticked', async () => {
    const el = await mount({ columns: ['location'] });
    let received: ColumnKey[] | null = null;
    el.addEventListener('change', (e) => {
      received = (e as CustomEvent<{ columns: ColumnKey[] }>).detail.columns;
    });

    option(el, 'quantity').click();
    // canonical order: quantity before location
    expect(received).toEqual(['quantity', 'location']);
  });

  it('emits change removing a column when unticked', async () => {
    const el = await mount({ columns: ['quantity', 'category'] });
    let received: ColumnKey[] | null = null;
    el.addEventListener('change', (e) => {
      received = (e as CustomEvent<{ columns: ColumnKey[] }>).detail.columns;
    });

    option(el, 'category').click();
    expect(received).toEqual(['quantity']);
  });

  it('closes on Done', async () => {
    const el = await mount({ columns: [] });
    const sr = el.shadowRoot as ShadowRoot;
    let cancels = 0;
    el.addEventListener('cancel', () => { cancels += 1; });
    (sr.querySelector('[data-testid="column-picker-done"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });

  it('closes on Escape', async () => {
    const el = await mount({ columns: [] });
    const sr = el.shadowRoot as ShadowRoot;
    let cancels = 0;
    el.addEventListener('cancel', () => { cancels += 1; });

    (sr.querySelector('[role="dialog"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });

  it('puts focus in the dialog when it opens, so Escape can reach it', async () => {
    // The Escape handler lives on the panel; without this the key never arrives.
    const el = await mount({ columns: [] });
    expect(el.shadowRoot?.activeElement).toBe(el.shadowRoot?.querySelector('[role="dialog"]'));
  });

  // This dialog styled itself from HA's variables instead of the card's tokens,
  // so it read as a different application: its own 8px radius, native
  // checkboxes, a filled Done at a fourth radius, and 32px rows — the only
  // targets in the card that ignored the 44px minimum on a phone.
  it('is built from the shared design tokens', async () => {
    const el = await mount({ columns: [] });
    const styles = (customElements.get('hv-column-picker') as typeof HVColumnPicker).styles;
    const sheets = Array.isArray(styles) ? styles : [styles];
    // The component's own block is last; the tokens sheet ahead of it is where
    // HA's variables are legitimately read.
    const own = String(sheets[sheets.length - 1].cssText).replace(/\s+/g, ' ');

    expect(sheets.length).toBeGreaterThan(1);
    expect(own).toMatch(/\.panel \{[^}]*border-radius: var\(--hv-radius-dialog\)/);
    expect(own).toMatch(/\.option \{[^}]*min-height: var\(--hv-tap-min, 34px\)/);
    // Nothing reaches past the tokens to HA's own variables any more.
    expect(own).not.toMatch(/--card-background-color|--primary-color|--divider-color/);
    // …and Done is the shared pill, not a bespoke button.
    expect(
      el.shadowRoot?.querySelector('[data-testid="column-picker-done"]')?.classList.contains('hv-pill'),
    ).toBe(true);
  });
});

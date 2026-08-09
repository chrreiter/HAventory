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

const arrow = (el: Picker, dir: 'up' | 'down', key: string) =>
  el.shadowRoot?.querySelector(`[data-testid="column-${dir}"][data-key="${key}"]`) as HTMLButtonElement;

const keysOf = (el: Picker) =>
  Array.from(el.shadowRoot?.querySelectorAll('[data-testid="column-option"]') ?? []).map((r) =>
    r.getAttribute('data-key'),
  );

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

  // The shown columns lead, in the order the table draws them; the ones that
  // are off follow in canonical order, so switching one on is predictable.
  it('lists the shown columns first, in their chosen order', async () => {
    const el = await mount({ columns: ['location', 'quantity'] });
    const keys = keysOf(el);
    expect(keys.slice(0, 2)).toEqual(['location', 'quantity']);
    expect(keys.slice(2)).toEqual(['status', 'category', 'tags', 'due_date', 'inspection_date', 'updated_at']);
  });

  // A re-enabled column joins at the end: dropping it back into its canonical
  // slot would move a column the user never touched.
  it('appends a column switched back on', async () => {
    const el = await mount({ columns: ['location'] });
    let received: ColumnKey[] | null = null;
    el.addEventListener('change', (e) => {
      received = (e as CustomEvent<{ columns: ColumnKey[] }>).detail.columns;
    });

    option(el, 'quantity').click();
    expect(received).toEqual(['location', 'quantity']);
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

  describe('reordering', () => {
    it('emits the permuted order when a column is moved', async () => {
      const el = await mount({ columns: ['quantity', 'status', 'tags'] });
      let received: ColumnKey[] | null = null;
      el.addEventListener('change', (e) => {
        received = (e as CustomEvent<{ columns: ColumnKey[] }>).detail.columns;
      });

      arrow(el, 'down', 'quantity').click();
      expect(received).toEqual(['status', 'quantity', 'tags']);

      arrow(el, 'up', 'tags').click();
      expect(received).toEqual(['quantity', 'tags', 'status']);
    });

    // The rows are stacked and the glyphs are vertical chevrons, so the words
    // are too — the same pair the organize dialog's reorder rows carry.
    it('names each direction the way its glyph and its list read', async () => {
      const el = await mount({ columns: ['quantity', 'status'] });
      expect(arrow(el, 'up', 'status').getAttribute('aria-label')).toBe('Move Status up');
      expect(arrow(el, 'up', 'status').getAttribute('title')).toBe('Move up');
      expect(arrow(el, 'down', 'quantity').getAttribute('aria-label')).toBe('Move Qty down');
      expect(arrow(el, 'down', 'quantity').getAttribute('title')).toBe('Move down');
    });

    it('disables the direction the first and last rows cannot go', async () => {
      const el = await mount({ columns: ['quantity', 'status', 'tags'] });
      expect(arrow(el, 'up', 'quantity').disabled).toBe(true);
      expect(arrow(el, 'down', 'quantity').disabled).toBe(false);
      expect(arrow(el, 'down', 'tags').disabled).toBe(true);
      expect(arrow(el, 'up', 'tags').disabled).toBe(false);
    });

    // A column that is off has no position, so promising it one would be a
    // promise the toggle then does not keep.
    it('offers no move buttons on a column that is switched off', async () => {
      const el = await mount({ columns: ['quantity'] });
      expect(arrow(el, 'up', 'tags')).toBe(null);
      expect(arrow(el, 'down', 'tags')).toBe(null);
    });

    it('resets to the canonical order, keeping the same columns', async () => {
      const el = await mount({ columns: ['tags', 'quantity'] });
      let received: ColumnKey[] | null = null;
      el.addEventListener('change', (e) => {
        received = (e as CustomEvent<{ columns: ColumnKey[] }>).detail.columns;
      });

      const reset = el.shadowRoot?.querySelector(
        '[data-testid="column-picker-reset-order"]',
      ) as HTMLButtonElement;
      expect(reset.disabled).toBe(false);
      reset.click();
      expect(received).toEqual(['quantity', 'tags']);
    });

    it('offers nothing to reset while the order is already canonical', async () => {
      const el = await mount({ columns: ['quantity', 'tags'] });
      const reset = el.shadowRoot?.querySelector(
        '[data-testid="column-picker-reset-order"]',
      ) as HTMLButtonElement;
      expect(reset.disabled).toBe(true);
    });
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

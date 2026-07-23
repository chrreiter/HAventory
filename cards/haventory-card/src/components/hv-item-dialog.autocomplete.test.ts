import { describe, it, expect, vi, afterEach } from 'vitest';
import './hv-item-dialog';

type Dialog = HTMLElement & {
  open: boolean;
  updateComplete?: Promise<unknown>;
  categorySuggestions: string[];
  tagSuggestions: string[];
  debounceMs: number;
};

async function mount(props: Partial<Dialog>): Promise<Dialog> {
  const el = document.createElement('hv-item-dialog') as Dialog;
  el.debounceMs = 0;
  Object.assign(el, props);
  document.body.appendChild(el);
  await customElements.whenDefined('hv-item-dialog');
  el.open = true;
  if (el.updateComplete) await el.updateComplete;
  return el;
}

function inputByLabel(sr: ShadowRoot, label: string): HTMLInputElement {
  return Array.from(sr.querySelectorAll('input[type="text"]')).find(
    (inp) => inp.closest('label')?.textContent?.includes(label),
  ) as HTMLInputElement;
}

function setName(sr: ShadowRoot, name: string) {
  const nameInput = sr.querySelector('input[type="text"]') as HTMLInputElement;
  nameInput.value = name;
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Type into a field and open its suggestion dropdown synchronously (via focus). */
async function typeAndFocus(el: Dialog, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('focus', { bubbles: true }));
  if (el.updateComplete) await el.updateComplete;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('hv-item-dialog autocomplete', () => {
  it('filters category suggestions by substring and selects on click', async () => {
    const el = await mount({ categorySuggestions: ['Books', 'Tools', 'Toys'] });
    const sr = el.shadowRoot as ShadowRoot;
    setName(sr, 'X');

    const catInput = inputByLabel(sr, 'Category');
    await typeAndFocus(el, catInput, 'to');

    const list = sr.querySelector('[data-testid="category-suggestions"]') as HTMLElement;
    expect(list).toBeTruthy();
    const options = Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.textContent);
    expect(options).toEqual(['Tools', 'Toys']);

    // Select via mousedown (click would blur-close before firing).
    const firstOption = list.querySelector('[role="option"]') as HTMLElement;
    firstOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    if (el.updateComplete) await el.updateComplete;

    // Dropdown closes after selection.
    expect(sr.querySelector('[data-testid="category-suggestions"]')).toBe(null);

    let saveDetail: any = null;
    el.addEventListener('save', (e: any) => { saveDetail = e.detail; });
    (sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement).click();
    expect(saveDetail.category).toBe('Tools');
  });

  it('navigates category suggestions with the keyboard and selects on Enter', async () => {
    const el = await mount({ categorySuggestions: ['Alpha', 'Beta', 'Gamma'] });
    const sr = el.shadowRoot as ShadowRoot;
    setName(sr, 'X');

    const catInput = inputByLabel(sr, 'Category');
    await typeAndFocus(el, catInput, 'a'); // all three contain 'a'

    catInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    if (el.updateComplete) await el.updateComplete;
    catInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (el.updateComplete) await el.updateComplete;

    let saveDetail: any = null;
    el.addEventListener('save', (e: any) => { saveDetail = e.detail; });
    (sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement).click();
    expect(saveDetail.category).toBe('Beta');
  });

  it('autocompletes the last tag token and preserves earlier tags', async () => {
    const el = await mount({ tagSuggestions: ['red', 'green', 'blue'] });
    const sr = el.shadowRoot as ShadowRoot;
    setName(sr, 'X');

    const tagsInput = inputByLabel(sr, 'Tags');
    await typeAndFocus(el, tagsInput, 'red, gr');

    const list = sr.querySelector('[data-testid="tags-suggestions"]') as HTMLElement;
    const options = Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.textContent);
    expect(options).toEqual(['green']); // only the last token 'gr' is matched

    tagsInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (el.updateComplete) await el.updateComplete;

    let saveDetail: any = null;
    el.addEventListener('save', (e: any) => { saveDetail = e.detail; });
    (sr.querySelector('button[aria-label="Save item"]') as HTMLButtonElement).click();
    expect(saveDetail.tags).toEqual(['red', 'green']);
  });

  it('excludes already-chosen tags from suggestions', async () => {
    const el = await mount({ tagSuggestions: ['red', 'green', 'blue'] });
    const sr = el.shadowRoot as ShadowRoot;
    const tagsInput = inputByLabel(sr, 'Tags');
    await typeAndFocus(el, tagsInput, 'red, '); // empty last token, 'red' committed

    const list = sr.querySelector('[data-testid="tags-suggestions"]') as HTMLElement;
    const options = Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.textContent);
    expect(options).toEqual(['green', 'blue']); // 'red' excluded, order preserved
  });

  it('Escape closes the dropdown without closing the dialog', async () => {
    const el = await mount({ categorySuggestions: ['Books'] });
    const sr = el.shadowRoot as ShadowRoot;
    const catInput = inputByLabel(sr, 'Category');
    await typeAndFocus(el, catInput, 'boo');
    expect(sr.querySelector('[data-testid="category-suggestions"]')).toBeTruthy();

    let cancelled = false;
    el.addEventListener('cancel', () => { cancelled = true; });

    catInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (el.updateComplete) await el.updateComplete;

    expect(sr.querySelector('[data-testid="category-suggestions"]')).toBe(null);
    expect(cancelled).toBe(false);
    expect(el.open).toBe(true);
  });

  it('debounces suggestion computation while typing', async () => {
    vi.useFakeTimers();
    const el = document.createElement('hv-item-dialog') as Dialog;
    el.categorySuggestions = ['Books', 'Tools'];
    el.debounceMs = 120;
    document.body.appendChild(el);
    await customElements.whenDefined('hv-item-dialog');
    el.open = true;
    if (el.updateComplete) await el.updateComplete;
    const sr = el.shadowRoot as ShadowRoot;

    const catInput = inputByLabel(sr, 'Category');
    catInput.value = 'boo';
    catInput.dispatchEvent(new Event('input', { bubbles: true })); // no focus → debounced only
    if (el.updateComplete) await el.updateComplete;

    // Before the debounce elapses, no dropdown.
    expect(sr.querySelector('[data-testid="category-suggestions"]')).toBe(null);

    vi.advanceTimersByTime(120);
    if (el.updateComplete) await el.updateComplete;

    const list = sr.querySelector('[data-testid="category-suggestions"]') as HTMLElement;
    expect(list).toBeTruthy();
    expect(Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.textContent)).toEqual(['Books']);
  });
});

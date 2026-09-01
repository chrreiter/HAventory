import { setLanguage } from '../i18n';
import './hv-chip-input';
import type { HVChipInput } from './hv-chip-input';
import { all, mountComponent, q } from '../test.utils';

async function mount(props: Partial<HVChipInput> = {}) {
  const { el } = await mountComponent<HVChipInput>('hv-chip-input', {
    values: [],
    suggestions: [],
    ...props,
  });
  return el;
}

function changes(el: HVChipInput) {
  const seen: string[][] = [];
  el.addEventListener('change', (e) => seen.push((e as CustomEvent).detail.values));
  return seen;
}

function commit(el: HVChipInput, text: string, key = 'Enter') {
  const input = q(el, '[data-testid="chip-input"]') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('hv-chip-input', () => {
  it('renders one removable chip per value', async () => {
    const el = await mount({ values: ['battery', 'aa'] });
    expect(all(el, '[data-testid="chip"]').map((c) => c.dataset.value)).toEqual(['battery', 'aa']);
    expect(all(el, '[data-testid="chip-remove"]')).toHaveLength(2);
  });

  // The editor's tokens are tags, so they wear the tag chip — the same one the
  // table's Tags column and the detail sheet draw.
  it('draws a value as the card draws a tag anywhere else', async () => {
    const el = await mount({ values: ['battery'] });
    const token = q(el, '[data-testid="chip"]')!;

    expect([...token.classList].sort()).toEqual(['chip', 'hv-chip', 'tag']);
    expect(token.querySelector('.hv-tag-mark')?.getAttribute('aria-hidden')).toBe('true');
    // The remove button is named for the value, not for what is printed on the chip.
    expect(q(el, '[data-testid="chip-remove"]')?.getAttribute('aria-label')).toBe('Remove battery');
  });

  // The name is spoken and never drawn, which is how it stayed English while
  // every label around it moved.
  it('names the remove button in the language in force', async () => {
    setLanguage('de');
    const el = await mount({ values: ['werkzeug'] });
    expect(q(el, '[data-testid="chip-remove"]')?.getAttribute('aria-label')).toBe('werkzeug entfernen');
  });

  // A tag someone writes with a # of their own would otherwise read as ##ok.
  it('marks a value once, whatever the value looks like', async () => {
    const el = await mount({ values: ['#ok'] });
    expect(all(el, '.hv-tag-mark')).toHaveLength(1);
    expect(q(el, '[data-testid="chip"]')?.textContent?.trim()).toBe('##ok');
  });

  it('lowercases and trims on commit, matching how the backend stores tags', async () => {
    const el = await mount();
    const seen = changes(el);
    commit(el, '  Battery  ');
    expect(seen).toEqual([['battery']]);
  });

  it('accepts a comma as a separator too', async () => {
    const el = await mount();
    const seen = changes(el);
    commit(el, 'metric', ',');
    expect(seen).toEqual([['metric']]);
  });

  it('ignores a duplicate and an empty commit', async () => {
    const el = await mount({ values: ['metric'] });
    const seen = changes(el);
    commit(el, 'METRIC');
    commit(el, '   ');
    expect(seen).toEqual([]);
  });

  it('removes a chip by its button, and by Backspace on an empty input', async () => {
    const el = await mount({ values: ['a', 'b'] });
    const seen = changes(el);

    (q(el, '[data-testid="chip-remove"][data-value="a"]') as HTMLButtonElement).click();
    expect(seen[0]).toEqual(['b']);

    const input = q(el, '[data-testid="chip-input"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(seen[1]).toEqual(['a']);
  });

  it('suggests unused values, filtered by what is typed', async () => {
    const el = await mount({ values: ['metric'], suggestions: ['metric', 'm4', 'wood'] });
    expect(all(el, '[data-testid="chip-suggestion"]').map((s) => s.dataset.value)).toEqual(['m4', 'wood']);

    const input = q(el, '[data-testid="chip-input"]') as HTMLInputElement;
    input.value = 'wo';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(all(el, '[data-testid="chip-suggestion"]').map((s) => s.dataset.value)).toEqual(['wood']);
  });

  it('offers three suggestions at most, however many are unused', async () => {
    const el = await mount({ suggestions: ['m3', 'm4', 'm5', 'm6', 'm8'] });
    expect(all(el, '[data-testid="chip-suggestion"]').map((s) => s.dataset.value)).toEqual(['m3', 'm4', 'm5']);
  });

  it('adds a suggestion when it is clicked', async () => {
    const el = await mount({ suggestions: ['m4'] });
    const seen = changes(el);
    (q(el, '[data-testid="chip-suggestion"]') as HTMLButtonElement).click();
    expect(seen[0]).toEqual(['m4']);
  });

  it('shows nothing when every suggestion is already used', async () => {
    const el = await mount({ values: ['m4'], suggestions: ['m4'] });
    expect(q(el, '[data-testid="chip-suggestions"]')).toBe(null);
  });
});

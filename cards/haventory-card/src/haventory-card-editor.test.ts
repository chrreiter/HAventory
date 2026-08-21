import './haventory-card-editor';
import type { HAventoryCardEditor, HAventoryCardConfig } from './haventory-card-editor';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import { mountComponent } from './test.utils';

async function mount(config: HAventoryCardConfig) {
  const { el } = await mountComponent<
    HAventoryCardEditor & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot }
  >('haventory-card-editor');
  el.setConfig(config);
  await el.updateComplete;
  return el;
}

const titleOf = (el: { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('[data-testid="card-editor-title"]') as HTMLInputElement;

/** Type into the field the way a person editing the card does. */
const edit = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
};

function captured(el: HTMLElement) {
  const seen: HAventoryCardConfig[] = [];
  el.addEventListener('config-changed', (e) => {
    seen.push((e as CustomEvent<{ config: HAventoryCardConfig }>).detail.config);
  });
  return seen;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('haventory-card-editor', () => {
  // The card's own input rather than HA's `ha-form`: that control is lazily
  // registered inside HA's bundle and does not exist in jsdom, so a break would
  // arrive as a user report after an upgrade rather than as a red test here.
  it("edits the title with the card's own labelled field", async () => {
    const el = await mount({ type: 'custom:haventory-card', title: 'Pantry' });
    const input = titleOf(el);

    expect(input.value).toBe('Pantry');
    expect(el.shadowRoot.querySelector('label')?.textContent?.trim()).toBe('Title');
    expect(el.shadowRoot.querySelector('label')?.getAttribute('for')).toBe(input.id);
  });

  // The heading a card with no title of its own shows, so the empty field says
  // what leaving it empty means rather than only that it is empty.
  it('shows the heading an untitled card falls back to', async () => {
    const el = await mount({ type: 'custom:haventory-card' });
    expect(titleOf(el).value).toBe('');
    expect(titleOf(el).placeholder).toBe(DEFAULT_CARD_TITLE);
  });

  it('raises exactly one config-changed, keeping the card type', async () => {
    const el = await mount({ type: 'custom:haventory-card', title: 'Pantry' });
    const seen = captured(el);

    edit(titleOf(el), 'Garage shelf');

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ type: 'custom:haventory-card', title: 'Garage shelf' });
  });

  // `setConfig` on the card ignores unknown keys rather than rejecting them, so
  // a dashboard's `quick_filters` — or a key from a version this build has never
  // seen — has to survive a trip through this form untouched.
  it('carries keys the card does not read straight through an edit', async () => {
    const el = await mount({
      type: 'custom:haventory-card',
      title: 'Pantry',
      quick_filters: ['low_stock'],
      something_from_the_future: 42,
    });
    const seen = captured(el);

    edit(titleOf(el), 'Garage shelf');

    expect(seen[0]).toEqual({
      type: 'custom:haventory-card',
      title: 'Garage shelf',
      quick_filters: ['low_stock'],
      something_from_the_future: 42,
    });
  });

  // An empty title is the absent key, not an empty heading: that is what hands
  // the heading back to the integration-wide option.
  it('drops an emptied title from the config rather than writing ""', async () => {
    const el = await mount({ type: 'custom:haventory-card', title: 'Pantry' });
    const seen = captured(el);

    edit(titleOf(el), '   ');

    expect(seen[0]).toEqual({ type: 'custom:haventory-card' });
    expect('title' in seen[0]).toBe(false);
  });
});

import './haventory-card-editor';
import type { HAventoryCardEditor, HAventoryCardConfig } from './haventory-card-editor';
import { mountComponent } from './test.utils';

// jsdom does not define `ha-form` — Home Assistant does, at runtime — so the
// node stays an unknown element. That is exactly the seam worth testing: what
// Lit sets on it going in, and what this element makes of the event HA's own
// control dispatches coming back.
type Form = HTMLElement & {
  schema?: { name: string }[];
  data?: HAventoryCardConfig;
  computeLabel?: () => string;
};

async function mount(config: HAventoryCardConfig) {
  const { el } = await mountComponent<
    HAventoryCardEditor & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot }
  >('haventory-card-editor');
  el.setConfig(config);
  await el.updateComplete;
  return el;
}

const formOf = (el: { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('[data-testid="card-editor-form"]') as Form;

/** What HA's own `ha-form` raises when a field is edited. */
const edit = (form: Form, value: Record<string, unknown>) =>
  form.dispatchEvent(
    new CustomEvent('value-changed', { detail: { value }, bubbles: true, composed: true }),
  );

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
  it('puts the title into the form HA renders', async () => {
    const el = await mount({ type: 'custom:haventory-card', title: 'Pantry' });
    const form = formOf(el);
    expect(form.schema?.map((f) => f.name)).toEqual(['title']);
    expect(form.data?.title).toBe('Pantry');
    expect(form.computeLabel?.()).toBe('Title');
  });

  it('raises exactly one config-changed, keeping the card type', async () => {
    const el = await mount({ type: 'custom:haventory-card', title: 'Pantry' });
    const seen = captured(el);

    edit(formOf(el), { title: 'Garage shelf' });

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

    edit(formOf(el), { title: 'Garage shelf' });

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

    edit(formOf(el), { title: '   ' });

    expect(seen[0]).toEqual({ type: 'custom:haventory-card' });
    expect('title' in seen[0]).toBe(false);
  });

  it('does not let the form event escape as well as the config change', async () => {
    const el = await mount({ type: 'custom:haventory-card' });
    const escaped: Event[] = [];
    document.addEventListener('value-changed', (e) => escaped.push(e));

    edit(formOf(el), { title: 'Garage shelf' });

    expect(escaped).toHaveLength(0);
    document.removeEventListener('value-changed', (e) => escaped.push(e));
  });
});

import './index';
import { loadedRuntime } from './runtime-loader';
import { makeMockHass, mountComponent, q, settle } from './test.utils';

/**
 * This spec file loads the runtime itself rather than in its preamble, so the
 * first mount meets a host whose runtime is still on its way: the shape of a
 * dashboard opened on a page that has never shown HAventory before.
 */

type Host = HTMLElement & { hass?: unknown; updateComplete: Promise<unknown> };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a host whose runtime is still loading', () => {
  // `host-placeholder.test.ts` holds the runtime back to look at the placeholder.
  it('is defined at once, draws its placeholder, then renders in full once the runtime is in', async () => {
    expect(customElements.get('haventory-card')).toBeTruthy();
    expect(customElements.get('haventory-panel')).toBeTruthy();
    expect(loadedRuntime()).toBeUndefined();

    const { el } = await mountComponent<Host>('haventory-card');
    el.hass = makeMockHass();
    expect(q(el, '[data-testid="card-placeholder"]')).toBeTruthy();
    expect(q(el, '[data-testid="card-shell"]')).toBeNull();

    await vi.waitFor(() => expect(loadedRuntime()).toBeTruthy());
    await settle(el);

    expect(q(el, '[data-testid="card-shell"]')).toBeTruthy();
    expect(q(el, '[data-testid="card-placeholder"]')).toBeNull();
    expect(customElements.get('hv-card-shell')).toBeTruthy();
  });

  it('hands HA the editor only once its definition is in', async () => {
    const card = customElements.get('haventory-card') as unknown as {
      getConfigElement(): Promise<HTMLElement>;
    };
    const editor = await card.getConfigElement();
    expect(editor.tagName).toBe('HAVENTORY-CARD-EDITOR');
    expect(customElements.get('haventory-card-editor')).toBeTruthy();
  });
});

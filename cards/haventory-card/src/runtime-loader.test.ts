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
  it('is defined at once, renders nothing, then renders in full once the runtime is in', async () => {
    expect(customElements.get('haventory-card')).toBeTruthy();
    expect(customElements.get('haventory-panel')).toBeTruthy();
    expect(loadedRuntime()).toBeUndefined();

    const { el, sr } = await mountComponent<Host>('haventory-card');
    el.hass = makeMockHass();
    expect(sr.childElementCount).toBe(0);

    await vi.waitFor(() => expect(loadedRuntime()).toBeTruthy());
    await settle(el);

    expect(q(el, '[data-testid="card-shell"]')).toBeTruthy();
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

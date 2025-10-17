import './index';
import { makeMockHass, makeItem } from './test.utils';
import { Store } from './store/store';

describe('HAventoryCard', () => {
  it('renders header and search bar', async () => {
    const el = document.createElement('haventory-card') as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    document.body.appendChild(el);

    await customElements.whenDefined('haventory-card');

    if ('updateComplete' in el && el.updateComplete) {
      await el.updateComplete;
    }

    const sr = el.shadowRoot as ShadowRoot;
    expect(sr.textContent || '').toContain('HAventory');
    expect(sr.querySelector('hv-search-bar')).toBeTruthy();
    expect(sr.querySelector('hv-inventory-list')).toBeTruthy();
  });

  it('overlay toggles and Esc closes; focus returns to toggle; banners render', async () => {
    const el = document.createElement('haventory-card') as HTMLElement & { updateComplete?: Promise<unknown>; hass?: any };
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');

    const hass = makeMockHass({ items: [makeItem({ id: '1', name: 'A' })] });
    (el as any).hass = hass;

    if ('updateComplete' in el && el.updateComplete) { await el.updateComplete; }
    const sr = el.shadowRoot as ShadowRoot;

    const toggle = sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement;
    toggle.click();
    // Overlay root should exist and contain content
    const root = document.getElementById('haventory-overlay-root') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.textContent || '').toContain('HAventory');

    // Inject a conflict to render banner
    const store = (el as any).store as Store;
    store['pushError']({ code: 'conflict', message: 'conflict', context: {} }, { itemId: '1', changes: { name: 'B' } } as any);
    // Re-render overlay with banners
    ;(el as any)['_renderOverlay']();
    expect(root.textContent || '').toContain('conflict');

    // Send Esc key to close overlay
    const overlay = root.querySelector('.overlay') as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // Toggle should regain focus
    expect(document.activeElement === toggle || (sr.activeElement === toggle)).toBeTruthy();
  });
});

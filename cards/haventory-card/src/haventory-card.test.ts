import './index';

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
});

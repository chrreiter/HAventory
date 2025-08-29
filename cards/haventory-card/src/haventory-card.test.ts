import './index';

describe('HAventoryCard', () => {
  it('renders placeholder text', async () => {
    const el = document.createElement('haventory-card') as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    document.body.appendChild(el);

    await customElements.whenDefined('haventory-card');

    if ('updateComplete' in el && el.updateComplete) {
      await el.updateComplete;
    }

    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('HAventory card placeholder');
  });
});

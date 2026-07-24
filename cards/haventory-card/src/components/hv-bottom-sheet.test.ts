import './hv-bottom-sheet';
import type { HVBottomSheet } from './hv-bottom-sheet';

async function mount(props: Partial<HVBottomSheet> = {}) {
  const el = document.createElement('hv-bottom-sheet') as HVBottomSheet;
  Object.assign(el, { open: true, ...props });
  el.innerHTML = '<p>sheet body</p><div slot="footer">footer</div>';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('hv-bottom-sheet', () => {
  it('renders nothing when closed', async () => {
    const el = await mount({ open: false });
    expect(el.shadowRoot?.querySelector('[data-testid="bottom-sheet"]')).toBe(null);
  });

  it('renders a modal dialog with a drag handle and both slots', async () => {
    const el = await mount({ label: 'AA Batteries' });
    const sr = el.shadowRoot as ShadowRoot;
    const sheet = sr.querySelector('[data-testid="bottom-sheet"]') as HTMLElement;

    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBe('AA Batteries');
    expect(sr.querySelector('[data-testid="sheet-handle"]')).toBeTruthy();
    expect(sr.querySelector('slot[name="footer"]')).toBeTruthy();
  });

  it('can hide the handle when the content supplies its own header', async () => {
    const el = await mount({ noHandle: true });
    expect(el.shadowRoot?.querySelector('[data-testid="sheet-handle"]')).toBe(null);
  });

  it('closes and emits cancel from the scrim and from Escape', async () => {
    for (const trigger of ['scrim', 'escape'] as const) {
      const el = await mount();
      let fired = 0;
      el.addEventListener('cancel', () => {
        fired += 1;
      });
      const sr = el.shadowRoot as ShadowRoot;

      if (trigger === 'scrim') {
        (sr.querySelector('.scrim') as HTMLElement).click();
      } else {
        (sr.querySelector('[data-testid="bottom-sheet"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      }

      expect(fired, `cancel via ${trigger}`).toBe(1);
      expect(el.open).toBe(false);
      el.remove();
    }
  });

  it('stacks above previously opened surfaces', async () => {
    const first = await mount();
    const second = await mount();
    const zOf = (el: HVBottomSheet) =>
      Number((el.shadowRoot?.querySelector('.scrim') as HTMLElement).style.zIndex);
    expect(zOf(second)).toBeGreaterThan(zOf(first));
  });
});

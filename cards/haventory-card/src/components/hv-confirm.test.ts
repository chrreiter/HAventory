import './hv-confirm';
import type { HVConfirm } from './hv-confirm';

async function mount(props: Partial<HVConfirm> = {}) {
  const el = document.createElement('hv-confirm') as HVConfirm;
  Object.assign(el, { open: true, heading: 'Delete 42 items?', ...props });
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('hv-confirm', () => {
  it('renders nothing when closed', async () => {
    const el = await mount({ open: false });
    expect(el.shadowRoot?.querySelector('[data-testid="confirm-dialog"]')).toBe(null);
  });

  it('renders heading, message and warning strip', async () => {
    const el = await mount({
      message: 'This cannot be undone.',
      warning: '6 of them are checked out',
    });
    const sr = el.shadowRoot as ShadowRoot;
    expect(sr.textContent).toContain('Delete 42 items?');
    expect(sr.querySelector('[data-testid="confirm-message"]')?.textContent).toContain('cannot be undone');
    expect(sr.querySelector('[data-testid="confirm-warning"]')).toBeTruthy();
  });

  it('omits the warning strip when there is nothing to warn about', async () => {
    const el = await mount();
    expect(el.shadowRoot?.querySelector('[data-testid="confirm-warning"]')).toBe(null);
  });

  it('emits confirm and closes when accepted', async () => {
    const el = await mount({ confirmLabel: 'Delete 42', destructive: true });
    let fired = 0;
    el.addEventListener('confirm', () => {
      fired += 1;
    });

    const accept = el.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement;
    expect(accept.textContent).toContain('Delete 42');
    // The card's one committing shape, in its error fill — this dialog draws no
    // primary of its own.
    expect(accept.classList.contains('hv-pill')).toBe(true);
    expect(accept.classList.contains('danger')).toBe(true);
    accept.click();

    expect(fired).toBe(1);
    expect(el.open).toBe(false);
  });

  it('emits cancel from the cancel button, the backdrop and Escape', async () => {
    for (const trigger of ['button', 'backdrop', 'escape'] as const) {
      const el = await mount();
      let fired = 0;
      el.addEventListener('cancel', () => {
        fired += 1;
      });
      const sr = el.shadowRoot as ShadowRoot;

      if (trigger === 'button') {
        (sr.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
      } else if (trigger === 'backdrop') {
        (sr.querySelector('.backdrop') as HTMLElement).click();
      } else {
        (sr.querySelector('[data-testid="confirm-dialog"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      }

      expect(fired, `cancel via ${trigger}`).toBe(1);
      expect(el.open).toBe(false);
      el.remove();
    }
  });

  it('is a modal alertdialog and focuses the accept action on open', async () => {
    const el = await mount();
    const dialog = el.shadowRoot?.querySelector('[data-testid="confirm-dialog"]') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el.shadowRoot?.activeElement).toBe(el.shadowRoot?.querySelector('[data-testid="confirm-accept"]'));
  });
});

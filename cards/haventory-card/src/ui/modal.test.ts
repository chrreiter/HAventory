import '../components/hv-column-picker';
import '../components/hv-confirm';
import '../components/hv-diagnostics-panel';
import '../components/hv-import-sheet';
import '../components/hv-organize-dialog';
import { mountComponent, settle } from '../test.utils';

/**
 * The five centred dialogs, which have to come out alike: one backdrop, one
 * centring layer, one panel box and one answer to "who closes this?".
 */
const DIALOGS = [
  'hv-column-picker',
  'hv-confirm',
  'hv-import-sheet',
  'hv-diagnostics-panel',
  'hv-organize-dialog',
] as const;

/** The four that take the bottom-sheet form on a phone; organize is a full page. */
const SHEETED = DIALOGS.filter((tag) => tag !== 'hv-organize-dialog');

type Dialog = HTMLElement & { open: boolean; mobile: boolean };

const mount = async (tag: string, props: Partial<Dialog> = {}) => {
  const { el } = await mountComponent<Dialog>(tag, { open: true, ...props });
  return el;
};

const panelOf = (el: Dialog) => el.shadowRoot?.querySelector('[role="dialog"], [role="alertdialog"]') as HTMLElement;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the modal chrome', () => {
  it('draws every centred dialog in the same three layers', async () => {
    for (const tag of DIALOGS) {
      const el = await mount(tag);
      const sr = el.shadowRoot as ShadowRoot;
      expect(sr.querySelector('.backdrop'), tag).toBeTruthy();
      expect(sr.querySelector('.wrap'), tag).toBeTruthy();

      const panel = panelOf(el);
      expect(panel, tag).toBeTruthy();
      expect(panel.classList.contains('panel'), tag).toBe(true);
      expect(panel.getAttribute('aria-modal'), tag).toBe('true');
      // A dialog with no accessible name is announced as an unnamed group.
      expect(panel.getAttribute('aria-label'), tag).toBeTruthy();
      expect(panel.dataset.testid, tag).toBeTruthy();
      el.remove();
    }
  });

  // One convention, because the host binds `open` from its own state: Lit
  // compares against the value it last committed, so a dialog that wrote its own
  // `open` would leave that binding unable to put it back up.
  it('reports every dismissal and leaves the closing to the host', async () => {
    for (const tag of DIALOGS) {
      for (const trigger of ['backdrop', 'escape'] as const) {
        const el = await mount(tag);
        let cancels = 0;
        el.addEventListener('cancel', () => {
          cancels += 1;
        });

        if (trigger === 'backdrop') {
          (el.shadowRoot?.querySelector('.backdrop') as HTMLElement).click();
        } else {
          panelOf(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
        await settle(el);

        expect(cancels, `${tag} via ${trigger}`).toBe(1);
        expect(el.open, `${tag} via ${trigger}`).toBe(true);
        el.remove();
      }
    }
  });

  // The flag has to reach the shadow root as an attribute or none of the phone
  // rules can match — a property alone selects nothing.
  it('reflects the phone flag so the sheet rules apply', async () => {
    for (const tag of SHEETED) {
      const phone = await mount(tag, { mobile: true });
      expect(phone.hasAttribute('mobile'), tag).toBe(true);
      phone.remove();

      const desktop = await mount(tag, { mobile: false });
      expect(desktop.hasAttribute('mobile'), tag).toBe(false);
      desktop.remove();
    }
  });

  // A confirmation raised from a dialog has to be readable over it.
  it('stacks each opening over the one that raised it', async () => {
    const first = await mount('hv-diagnostics-panel');
    const second = await mount('hv-column-picker');
    const z = (el: Dialog) => Number((el.shadowRoot?.querySelector('.backdrop') as HTMLElement).style.zIndex);
    expect(z(second)).toBeGreaterThan(z(first));
    // The panel sits over its own backdrop.
    expect(Number(panelOf(second).parentElement?.style.zIndex)).toBe(z(second) + 1);
  });

  it('takes a fresh stacking base every time the same dialog opens', async () => {
    const el = await mount('hv-column-picker');
    const z = () => Number((el.shadowRoot?.querySelector('.backdrop') as HTMLElement).style.zIndex);
    const first = z();
    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);
    expect(z()).toBeGreaterThan(first);
  });

  it('puts focus in the dialog on open and hands it back on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const el = await mount('hv-diagnostics-panel', { open: false });
    el.open = true;
    await settle(el);
    // The Escape handler lives on the panel; without this the key never arrives.
    expect(el.shadowRoot?.activeElement).toBe(panelOf(el));

    el.open = false;
    await settle(el);
    expect(document.activeElement).toBe(opener);
  });
});

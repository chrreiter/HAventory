import '../components/hv-column-picker';
import '../components/hv-confirm';
import '../components/hv-diagnostics-panel';
import '../components/hv-import-sheet';
import { componentCss, mountComponent } from '../test.utils';

/**
 * The four host dialogs, which have to end up alike: on a phone the card raises
 * its filter panel, its detail sheet and its ⋮ menu from the bottom edge, and
 * these four arrived as small centred boxes in the middle of the same screen.
 */
const DIALOGS = ['hv-column-picker', 'hv-confirm', 'hv-import-sheet', 'hv-diagnostics-panel'] as const;

const mount = async (tag: string, mobile: boolean) => {
  const { el } = await mountComponent<HTMLElement & { open: boolean; mobile: boolean }>(tag, {
    open: true,
    mobile,
  });
  return el;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('host dialogs: one phone presentation', () => {
  it('rises from the bottom edge, full width, under mobile', () => {
    for (const tag of DIALOGS) {
      const css = componentCss(tag);
      expect(css, tag).toMatch(/:host\(\[mobile\]\) \.wrap \{[^}]*place-items: end stretch/);
      expect(css, tag).toMatch(/:host\(\[mobile\]\) \.panel \{[^}]*width: 100%/);
      expect(css, tag).toMatch(
        /:host\(\[mobile\]\) \.panel \{[^}]*border-radius: var\(--hv-radius-sheet\) var\(--hv-radius-sheet\) 0 0/,
      );
      expect(css, tag).toMatch(/:host\(\[mobile\]\) \.panel \{[^}]*box-shadow: var\(--hv-shadow-sheet\)/);
    }
  });

  it('keeps the centred dialog when it is not on a phone', () => {
    for (const tag of DIALOGS) {
      const css = componentCss(tag);
      expect(css, tag).toMatch(/[^)] \.wrap \{[^}]*place-items: center/);
      expect(css, tag).toMatch(/[^)] \.panel \{[^}]*border-radius: var\(--hv-radius-dialog\)/);
    }
  });

  // The flag has to reach the shadow root as an attribute or none of the rules
  // above can match — a property alone selects nothing.
  it('reflects the flag so :host([mobile]) applies', async () => {
    for (const tag of DIALOGS) {
      const phone = await mount(tag, true);
      expect(phone.hasAttribute('mobile'), tag).toBe(true);
      phone.remove();

      const desktop = await mount(tag, false);
      expect(desktop.hasAttribute('mobile'), tag).toBe(false);
      desktop.remove();
    }
  });

  // A sheet sits against the bottom edge, where a phone's home indicator is.
  it('clears the safe area under the bottom row of actions', () => {
    for (const tag of DIALOGS) {
      expect(componentCss(tag), tag).toMatch(
        /:host\(\[mobile\]\) \.panel \{[^}]*padding-bottom: max\(12px, env\(safe-area-inset-bottom\)\)/,
      );
    }
  });
});

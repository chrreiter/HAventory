import '../components/hv-column-picker';
import '../components/hv-confirm';
import '../components/hv-diagnostics-panel';
import '../components/hv-import-sheet';
import { mountComponent } from '../test.utils';

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

});

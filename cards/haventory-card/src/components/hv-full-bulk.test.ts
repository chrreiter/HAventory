import './hv-full-bulk';
import { makeItem, mountHost, q, settle } from '../test.utils';
import type { HVFullBulk } from './hv-full-bulk';
import type { Item, Location } from '../store/types';

function loc(id: string, name: string): Location {
  return {
    id,
    name,
    parent_id: null,
    area_id: null,
    path: { id_path: [id], name_path: [name], display_path: name, sort_key: name.toLowerCase() },
  };
}

/** Mounts the bulk run with every item selected, the way select-all leaves the store. */
async function mount(opts: { items: Item[]; locations?: Location[]; mobile?: boolean }) {
  const mounted = await mountHost<HVFullBulk>(
    'hv-full-bulk',
    { items: opts.items, locations: opts.locations ?? [] },
    opts.mobile ? { mobile: true } : {},
    { renders: 2 },
  );
  mounted.store.setSelected(opts.items.map((i) => i.id));
  await settle(mounted.el);
  return mounted;
}

describe('hv-full-bulk: running an action over the selection', () => {
  const bulkBar = (sr: ShadowRoot) => q(sr, '[data-testid="full-bulk-bar"]') as HTMLElement;

  /** Press one of the bulk bar's action buttons and let the view settle. */
  async function pressBulk(el: HVFullBulk, sr: ShadowRoot, action: string) {
    (bulkBar(sr).shadowRoot?.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
    await settle(el);
  }

  it('runs a bulk move and reports it', async () => {
    const locations = [loc('workshop', 'Workshop')];
    const items = [makeItem({ id: '1' }), makeItem({ id: '2' })];
    const { el, store, sr } = await mount({ items, locations });

    const bar = bulkBar(sr);
    (
      bar.shadowRoot?.querySelector('[data-testid="bulk-action"][data-action="move"]') as HTMLButtonElement
    ).click();
    await settle(el);
    const tree = bar.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="workshop"]') as HTMLButtonElement
    ).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items.every((i) => i.location_id === 'workshop')).toBe(true);
    expect(bar.shadowRoot?.querySelector('[data-testid="bulk-result-summary"]')?.textContent).toContain(
      '2 of 2 succeeded',
    );
  });

  it('keeps the failures listed and the selection narrowed to them', async () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2', name: 'Stubborn' })];
    const { el, store, sr } = await mount({ items });

    // One of the two rows refuses.
    const realBulk = store['ws'].bulk.bind(store['ws']);
    store['ws'].bulk = async (ops) => {
      const res = await realBulk(ops);
      const doomed = ops.find((o) => o.payload.item_id === '2');
      if (doomed) {
        res.results[doomed.op_id] = {
          success: false,
          error: { code: 'conflict', message: 'version conflict', context: {} },
        };
      }
      return res;
    };

    const bar = bulkBar(sr);
    await pressBulk(el, sr, 'check-in');
    await settle(el);

    expect(bar.shadowRoot?.querySelector('[data-testid="bulk-result-summary"]')?.textContent).toContain(
      '1 of 2 succeeded',
    );
    expect(bar.shadowRoot?.querySelector('[data-testid="bulk-failure"]')?.textContent).toContain('Stubborn');
    expect([...store.state.value.selection]).toEqual(['2']);
  });

  // A batch is asked for a due date exactly as a single row is: firing on the
  // press with no date means a bulk check-out can never go overdue.
  describe('bulk check-out asks for a due date, once', () => {
    async function selectTwoAndCheckOut(mobile = false) {
      const items = [makeItem({ id: '1' }), makeItem({ id: '2' })];
      const mounted = await mount({ items, mobile });
      const { el, sr } = mounted;
      await pressBulk(el, sr, 'check-out');

      const popover = q(sr, '[data-testid="full-bulk-checkout"]') as HTMLElement & {
        open: boolean;
        inline: boolean;
        touch: boolean;
      };
      return { ...mounted, popover };
    }

    // Opened by a bar at the foot of the table, so it has no body to be a step
    // inside of and stays a centred dialog. That says nothing about how big its
    // controls should be: on the narrow branch a finger has to hit them.
    it('takes finger-sized controls on the narrow branch and stays a centred dialog', async () => {
      for (const mobile of [false, true]) {
        const { el, popover } = await selectTwoAndCheckOut(mobile);
        const where = `mobile=${mobile}`;
        expect(popover.open, where).toBe(true);
        expect(popover.inline, where).toBe(false);
        expect(popover.touch, where).toBe(mobile);
        expect(popover.shadowRoot?.querySelector('.scrim')?.classList.contains('dim'), where).toBe(true);
        el.remove();
      }
    });

    it('opens one popover for the whole selection and applies the date to every row', async () => {
      const { el, store, popover } = await selectTwoAndCheckOut();
      expect(popover.open).toBe(true);
      // One question, named for what it covers.
      expect(popover.shadowRoot?.querySelector('[data-testid="checkout-title"]')?.textContent).toContain(
        'Check out 2 items',
      );
      // Nothing has run yet.
      expect(store.state.value.items.some((i) => i.checked_out)).toBe(false);

      const date = popover.shadowRoot?.querySelector('[data-testid="checkout-date"] input') as HTMLInputElement;
      date.value = '2031-04-05';
      date.dispatchEvent(new Event('input', { bubbles: true }));
      await settle(el);
      (popover.shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.map((i) => [i.checked_out, i.due_date])).toEqual([
        [true, '2031-04-05'],
        [true, '2031-04-05'],
      ]);
    });

    it('honours the explicit no-date choice', async () => {
      const { el, store, popover } = await selectTwoAndCheckOut();
      (popover.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.every((i) => i.checked_out && i.due_date === null)).toBe(true);
    });

    it('checks nothing out when the question is cancelled', async () => {
      const { el, store, popover } = await selectTwoAndCheckOut();
      (popover.shadowRoot?.querySelector('[data-testid="checkout-cancel"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.some((i) => i.checked_out)).toBe(false);
    });

    // Nothing to ask about, so nothing is asked.
    it('leaves bulk check-in immediate', async () => {
      const items = [makeItem({ id: '1', checked_out: true }), makeItem({ id: '2', checked_out: true })];
      const { el, store, sr } = await mount({ items });

      await pressBulk(el, sr, 'check-in');
      await settle(el);

      expect(store.state.value.items.every((i) => !i.checked_out)).toBe(true);
    });
  });

  it('confirms a bulk delete and warns about checked-out items', async () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2', checked_out: true })];
    const { el, store, sr } = await mount({ items });

    await pressBulk(el, sr, 'delete');

    const confirm = q(sr, '[data-testid="bulk-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    expect(confirm.shadowRoot?.textContent).toContain('Delete 2 items?');
    const warning = confirm.shadowRoot?.querySelector('[data-testid="confirm-warning"]') as HTMLElement;
    expect(warning.shadowRoot?.textContent).toContain('1 of them is checked out');

    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(store.state.value.items).toHaveLength(0);
  });

  // This confirm belongs to the same family as the dialogs the host owns: one
  // width flips every overlay, so a phone never shows a centred box over sheets.
  it('raises its delete confirm as a sheet on a phone viewport', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })], mobile: true });
    await pressBulk(el, sr, 'delete');

    expect(q(sr, '[data-testid="bulk-confirm"]')?.hasAttribute('mobile')).toBe(true);
  });

  it('leaves everything alone when the delete is cancelled', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' })] });
    await pressBulk(el, sr, 'delete');

    const confirm = q(sr, '[data-testid="bulk-confirm"]') as HTMLElement & { open: boolean };
    (confirm.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.items).toHaveLength(1);
  });
});

import './hv-checkout-popover';
import { all, makeItem, mountComponent, q } from '../test.utils';
import { addDays, formatDate } from '../ui/relative-time';
import type { HVCheckoutPopover } from './hv-checkout-popover';
import type { Item } from '../store/types';

async function mount(item: Partial<Item> = {}, props: Partial<HVCheckoutPopover> = {}) {
  const { el } = await mountComponent<HVCheckoutPopover>('hv-checkout-popover', {
    item: makeItem(item),
    open: true,
    ...props,
  });
  return el;
}

describe('hv-checkout-popover: check-out', () => {
  it('renders nothing without an item or when closed', async () => {
    expect(q(await mount({}, { open: false }), '[data-testid="checkout-popover"]')).toBe(null);
    const noItem = await mount();
    noItem.item = null;
    await noItem.updateComplete;
    expect(q(noItem, '[data-testid="checkout-popover"]')).toBe(null);
  });

  it('names the item and says the date is optional', async () => {
    const el = await mount({ name: 'Multimeter' });
    expect(q(el, '[data-testid="checkout-title"]')?.textContent).toContain('Check out Multimeter');
    expect(el.shadowRoot?.textContent).toContain('A due date is optional');
  });

  it('suggests +7 days by default', async () => {
    const el = await mount();
    const selected = all(el, '[data-testid="checkout-offset"]').find((b) => b.classList.contains('on'));
    expect(selected?.dataset.days).toBe('7');
    expect(q(el, '[data-testid="checkout-date-label"]')?.textContent).toBe(formatDate(addDays(7)));
  });

  // A week, a month, a quarter — the round spans a household names, with +1 day
  // left out as shorter than most borrowings ever are.
  it('offers the other offsets and switches between them', async () => {
    const el = await mount();
    expect(all(el, '[data-testid="checkout-offset"]').map((b) => b.dataset.days)).toEqual(['7', '30', '90']);
    expect(all(el, '[data-testid="checkout-offset"]').map((b) => b.textContent?.trim())).toEqual([
      '+7 days',
      '+30 days',
      '+90 days',
    ]);

    (all(el, '[data-testid="checkout-offset"]')[2] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="checkout-date-label"]')?.textContent).toBe(formatDate(addDays(90)));
  });

  it('takes a wait time of your own, and hands the date back to a preset', async () => {
    const el = await mount();
    expect(q(el, '[data-testid="checkout-custom"]')).toBe(null);

    (q(el, '[data-testid="checkout-offset-custom"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="checkout-date-label"]')?.textContent).toBe(formatDate(addDays(14)));

    const input = q(el, '[data-testid="checkout-custom"]')?.querySelector('input') as HTMLInputElement;
    input.value = '45';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(q(el, '[data-testid="checkout-date-label"]')?.textContent).toBe(formatDate(addDays(45)));
    // No preset can claim the date while the custom field owns it.
    expect(all(el, '[data-testid="checkout-offset"]').some((b) => b.classList.contains('on'))).toBe(false);

    // An emptied box is "no date yet", not a stale one left behind.
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect((q(el, '[data-testid="checkout-confirm"]') as HTMLButtonElement).disabled).toBe(true);

    (all(el, '[data-testid="checkout-offset"]')[0] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="checkout-custom"]')).toBe(null);
    expect(q(el, '[data-testid="checkout-date-label"]')?.textContent).toBe(formatDate(addDays(7)));
  });

  it('starts from the existing due date when there is one', async () => {
    const el = await mount({ checked_out: true, due_date: '2030-01-15' });
    expect(q(el, '[data-testid="checkout-date-label"]')?.textContent).toBe('Jan 15, 2030');
  });

  it('checks out with the chosen date', async () => {
    const el = await mount({ id: 'item-1' });
    let detail: { itemId?: string; dueDate?: string | null } = {};
    el.addEventListener('check-out', (e) => {
      detail = (e as CustomEvent).detail;
    });

    (q(el, '[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
    expect(detail.itemId).toBe('item-1');
    expect(detail.dueDate).toBe(addDays(7));
    expect(el.open).toBe(false);
  });

  it('keeps "no due date" as a real path, not a cancel', async () => {
    const el = await mount({ id: 'item-1' });
    let detail: { dueDate?: string | null } = {};
    let cancels = 0;
    el.addEventListener('check-out', (e) => {
      detail = (e as CustomEvent).detail;
    });
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    (q(el, '[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    expect(detail.dueDate).toBe(null);
    expect(cancels).toBe(0);
  });

  it('accepts a hand-typed date', async () => {
    const el = await mount({ id: 'item-1' });
    let detail: { dueDate?: string | null } = {};
    el.addEventListener('check-out', (e) => {
      detail = (e as CustomEvent).detail;
    });

    const input = q(el, '[data-testid="checkout-date"]')?.querySelector('input') as HTMLInputElement;
    input.value = '2030-03-04';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;

    (q(el, '[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
    expect(detail.dueDate).toBe('2030-03-04');
  });

  it('cancels from the button, the scrim and Escape', async () => {
    for (const trigger of ['button', 'scrim', 'escape'] as const) {
      const el = await mount();
      let cancels = 0;
      el.addEventListener('cancel', () => {
        cancels += 1;
      });

      if (trigger === 'button') (q(el, '[data-testid="checkout-cancel"]') as HTMLButtonElement).click();
      else if (trigger === 'scrim') (q(el, '.scrim') as HTMLElement).click();
      else
        (q(el, '[data-testid="checkout-popover"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

      expect(cancels, trigger).toBe(1);
      el.remove();
    }
  });
});

describe('hv-checkout-popover: setting a due date on an item already out', () => {
  it('changes the wording and the event', async () => {
    const el = await mount({ id: 'item-1', checked_out: true }, { mode: 'set-due-date' });
    let detail: { dueDate?: string | null } = {};
    el.addEventListener('set-due-date', (e) => {
      detail = (e as CustomEvent).detail;
    });

    expect(q(el, '[data-testid="checkout-title"]')?.textContent).toContain('Set a due date');
    expect(q(el, '[data-testid="checkout-no-date"]')?.textContent).toContain('Clear due date');

    (q(el, '[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
    expect(detail.dueDate).toBe(addDays(7));
  });
});

describe('hv-checkout-popover: placement', () => {
  it('anchors under the control that opened it on desktop', async () => {
    const anchor = { left: 120, bottom: 240, top: 210, right: 160, width: 40, height: 30 } as DOMRect;
    const el = await mount({}, { anchor });
    const style = (q(el, '[data-testid="checkout-popover"]') as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain('top: 246px');
    expect(style).toContain('left: 120px');
  });

  // It always hung below its anchor, which is fine from a row menu near the top
  // of a list and runs straight off the bottom of the screen once the editor
  // opens it from a control far down a long form.
  it('hangs above the control when there is no room under it', async () => {
    const anchor = { left: 200, top: window.innerHeight - 60, bottom: window.innerHeight - 20 } as DOMRect;
    const el = await mount({}, { anchor });
    const style = (q(el, '[data-testid="checkout-popover"]') as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain(`bottom: ${66}px`);
    expect(style).not.toMatch(/top: \d+px/);
  });

  it('keeps itself on screen near the right edge', async () => {
    const anchor = { left: window.innerWidth - 20, bottom: 100 } as DOMRect;
    const el = await mount({}, { anchor });
    const style = (q(el, '[data-testid="checkout-popover"]') as HTMLElement).getAttribute('style') ?? '';
    const left = Number(/left: (-?\d+)px/.exec(style)?.[1]);
    expect(left).toBeLessThanOrEqual(window.innerWidth - 300 - 8);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it('drops the scrim and fills the width when it is an inline step', async () => {
    const el = await mount({}, { inline: true });
    expect(q(el, '.scrim')).toBe(null);
    expect(q(el, '[data-testid="checkout-popover"]')?.getAttribute('style')).toBe('');
  });

  // Anchored it is a popover, and its scrim is only there to catch the click
  // that dismisses. With nothing to anchor to it is a centred dialog instead,
  // and a dialog that does not dim reads as a card floating over a live surface.
  it('dims the page only when it has no control to hang from', async () => {
    const anchored = await mount({}, { anchor: { left: 120, bottom: 240 } as DOMRect });
    expect(q(anchored, '.scrim')?.classList.contains('dim')).toBe(false);

    const centred = await mount({}, { anchor: null });
    expect(q(centred, '.scrim')?.classList.contains('dim')).toBe(true);
    expect(
      (q(centred, '[data-testid="checkout-popover"]') as HTMLElement).getAttribute('style'),
    ).toContain('left: 50%');
  });
});

describe('hv-checkout-popover: where it draws and how big it is are separate asks', () => {

  it('keeps the scrim and its own placement when only the sizes grow', async () => {
    const el = await mount({}, { touch: true });
    expect(q(el, '.scrim')?.classList.contains('dim')).toBe(true);
    expect(q(el, '[data-testid="checkout-popover"]')?.getAttribute('style')).toContain('left: 50%');
  });

  // The row of actions becomes a stack of full-width buttons, so the spacer that
  // pushes the pair right in the flex row has to go with it — left in, it is an
  // empty grid row with a gap on both sides of it.
  it('stacks the actions and drops the spacer with the sizes, not with the step', async () => {
    const el = await mount({}, { touch: true });
    expect(q(el, '.actions .spacer')).toBe(null);
    expect(q(await mount({}, { inline: true }), '.actions .spacer')).not.toBe(null);
  });
});

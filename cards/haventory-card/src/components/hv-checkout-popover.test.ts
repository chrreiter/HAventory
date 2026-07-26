import './hv-checkout-popover';
import { makeItem } from '../test.utils';
import { addDays, formatDate } from '../ui/relative-time';
import type { HVCheckoutPopover } from './hv-checkout-popover';
import type { Item } from '../store/types';

async function mount(item: Partial<Item> = {}, props: Partial<HVCheckoutPopover> = {}) {
  const el = document.createElement('hv-checkout-popover') as HVCheckoutPopover;
  el.item = makeItem(item);
  el.open = true;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVCheckoutPopover, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVCheckoutPopover, sel: string) =>
  [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

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

  // A week, a month, a quarter. +1 day was shorter than most borrowings ever
  // are, and +30 was a month that isn't one.
  it('offers the other offsets and switches between them', async () => {
    const el = await mount();
    expect(all(el, '[data-testid="checkout-offset"]').map((b) => b.dataset.days)).toEqual(['7', '31', '90']);

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

  it('keeps itself on screen near the right edge', async () => {
    const anchor = { left: window.innerWidth - 20, bottom: 100 } as DOMRect;
    const el = await mount({}, { anchor });
    const style = (q(el, '[data-testid="checkout-popover"]') as HTMLElement).getAttribute('style') ?? '';
    const left = Number(/left: (-?\d+)px/.exec(style)?.[1]);
    expect(left).toBeLessThanOrEqual(window.innerWidth - 300 - 8);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it('drops the scrim and fills the width on mobile, where it is an inline step', async () => {
    const el = await mount({}, { mobile: true });
    expect(q(el, '.scrim')).toBe(null);
    expect(q(el, '[data-testid="checkout-popover"]')?.getAttribute('style')).toBe('');
  });
});

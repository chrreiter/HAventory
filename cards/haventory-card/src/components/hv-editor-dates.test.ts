import { vi } from 'vitest';
import './hv-editor-dates';
import { all, componentCss, makeItem, mountComponent, q, settle } from '../test.utils';
import { formFromItem } from '../ui/item-form';
import type { ItemFormModel } from '../ui/item-form';
import { addDays } from '../ui/relative-time';
import type { Item } from '../store/types';
import type { HVEditorDates } from './hv-editor-dates';

/**
 * The element as the editor holds it: every `change` is merged back into
 * `.model`, which is what the dates and the dialog read.
 */
async function mount(
  item: Item | null,
  props: Partial<HVEditorDates> = {},
  patch: Partial<ItemFormModel> = {},
) {
  const { el } = await mountComponent<HVEditorDates>('hv-editor-dates', {
    item,
    model: { ...formFromItem(item), ...patch },
    ...props,
  });
  const changes: Partial<ItemFormModel>[] = [];
  el.addEventListener('change', (e) => {
    const detail = (e as CustomEvent<Partial<ItemFormModel>>).detail;
    changes.push(detail);
    el.model = { ...el.model, ...detail };
  });
  return { el, changes };
}

async function type(el: HVEditorDates, testid: string, value: string) {
  const input = q(el, `[data-testid="${testid}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await el.updateComplete;
}

type Popover = HTMLElement & { updateComplete: Promise<unknown>; open: boolean };

/** Press Check out and confirm the dialog it opens, with whatever it suggests. */
async function checkOut(el: HVEditorDates) {
  (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
  await el.updateComplete;
  const popover = q(el, '[data-testid="editor-checkout"]') as Popover;
  await popover.updateComplete;
  (popover.shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
  await el.updateComplete;
  return popover;
}

describe('hv-editor-dates', () => {
  it('only allows a due date while the item is checked out', async () => {
    const { el } = await mount(makeItem({ id: '1' }));
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).disabled).toBe(true);

    await checkOut(el);
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).disabled).toBe(false);
  });

  // The mobile sheet has asked for a due date, with quick offsets and a way to
  // decline one, since the revamp. The editor flipped a flag and left you to
  // find the date field yourself. Same component, both widths.
  it('asks for a due date through the same dialog the sheet uses', async () => {
    const { el } = await mount(makeItem({ id: '1', name: 'Multimeter', checked_out: false }));
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check out…');

    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const popover = q(el, '[data-testid="editor-checkout"]') as Popover;
    await popover.updateComplete;
    expect(popover.open).toBe(true);
    expect(popover.shadowRoot?.querySelector('[data-testid="checkout-title"]')?.textContent).toContain(
      'Check out Multimeter',
    );

    // Confirming writes the form model, not the item — the same button also
    // has to work while creating an item that has no id to check out yet.
    (popover.shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check in');
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).value).toBe(addDays(7));
  });

  it('checks out an item that does not exist yet', async () => {
    const { el } = await mount(null, {}, { name: 'Torque wrench' });
    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const popover = q(el, '[data-testid="editor-checkout"]') as Popover;
    await popover.updateComplete;
    expect(popover.shadowRoot?.querySelector('[data-testid="checkout-title"]')?.textContent).toContain(
      'Check out Torque wrench',
    );
  });

  it('takes no due date for an answer', async () => {
    const { el } = await mount(makeItem({ id: '1' }));
    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const popover = q(el, '[data-testid="editor-checkout"]') as Popover;
    await popover.updateComplete;
    (popover.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check in');
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).value).toBe('');
  });

  it('checks back in without asking anything', async () => {
    const { el } = await mount(makeItem({ id: '1', checked_out: true, due_date: '2099-01-01' }));
    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check out…');
  });

  // The field was already disabled, but a disabled date input keeps the
  // browser's own colour — against a dark HA theme it looked live, and the
  // `title` explaining it never reaches a phone.
  it('greys the due date out, and says why, while the item is not checked out', async () => {
    const { el } = await mount(makeItem({ id: '1', checked_out: false }));
    expect(q(el, '.due-label')?.classList).toContain('muted');
    expect(q(el, '[data-testid="editor-due-hint"]')?.textContent?.trim()).toBe(
      'A due date applies while the item is checked out.',
    );
    expect(q(el, '[data-testid="editor-due-date"]')?.getAttribute('title')).toBe(
      'A due date applies while the item is checked out.',
    );

    await checkOut(el);
    expect(q(el, '.due-label')?.classList).not.toContain('muted');
    expect(q(el, '[data-testid="editor-due-hint"]')).toBe(null);

    const css = componentCss('hv-editor-dates');
    expect(css).toMatch(/\.hv-input:disabled \{[^}]*color: var\(--hv-text-tertiary\)/);
    expect(css).toMatch(/\.hv-input:disabled \{[^}]*-webkit-text-fill-color/);
  });

  // A switch says "this is a property, set it either way". Checking something
  // out is an act, and the detail sheet has always said so — same words, same
  // icons, so the two surfaces cannot teach different things.
  it('offers checking out as an action, in the same words the sheet uses', async () => {
    const { el } = await mount(makeItem({ id: '1', checked_out: false }));
    const button = q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('role')).toBe(null);
    // The ellipsis is the card's own mark for "this opens something".
    expect(button.textContent?.trim()).toBe('Check out…');

    await checkOut(el);
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check in');
  });

  // Three equal thirds of one row read as three settings of the same kind. Two
  // of them are not: the due date is half of the checkout — disabled without
  // one, nulled on save — while the inspection date is its own fact.
  it('keeps the due date inside the checkout and the inspection date outside it', async () => {
    const { el } = await mount(makeItem({ id: '1' }));

    const checkout = q(el, '[data-testid="editor-checkout-caption"]')?.closest('.group');
    expect(checkout).toBeTruthy();
    expect(checkout?.querySelector('[data-testid="editor-checked-out"]')).toBeTruthy();
    expect(checkout?.querySelector('[data-testid="editor-due-date"]')).toBeTruthy();
    expect(checkout?.querySelector('[data-testid="editor-inspection-date"]')).toBe(null);

    const inspection = q(el, '[data-testid="editor-inspection-caption"]')?.closest('.group');
    expect(inspection).toBeTruthy();
    expect(inspection).not.toBe(checkout);
    expect(inspection?.querySelector('[data-testid="editor-inspection-date"]')).toBeTruthy();

    // The box has to name itself to the same reader the border speaks to.
    expect(checkout?.getAttribute('aria-labelledby')).toBe('editor-checkout-caption');
    expect(q(el, '[data-testid="editor-inspection-caption"]')?.getAttribute('for')).toBe('editor-inspection');
  });

  // The field is when the item is next due for inspection, so the caption says
  // that rather than leaving "Inspection date" to be read either way.
  it('captions the inspection field for the date it holds', async () => {
    const { el } = await mount(makeItem({ id: '1' }));
    const caption = q(el, '[data-testid="editor-inspection-caption"]')?.textContent?.trim();
    expect(caption).toBe('Next inspection');
  });

  // An interval is known in weeks or months; a date three months out is
  // arithmetic. Same jumps as the check-out popover, since it is one gesture.
  it('offers the same quick offsets the check-out popover does', async () => {
    const { el } = await mount(makeItem({ id: '1', inspection_date: null }));
    expect(all(el, '[data-testid="editor-inspection-offset"]').map((b) => b.dataset.days)).toEqual([
      '7',
      '30',
      '90',
    ]);
    expect(all(el, '[data-testid="editor-inspection-offset"]').map((b) => b.textContent?.trim())).toEqual([
      '+7 days',
      '+30 days',
      '+90 days',
    ]);

    const dateInput = () => q(el, '[data-testid="editor-inspection-date"]') as HTMLInputElement;
    (all(el, '[data-testid="editor-inspection-offset"]')[1] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(dateInput().value).toBe(addDays(30));
    expect(all(el, '[data-testid="editor-inspection-offset"]')[1]?.classList.contains('on')).toBe(true);
  });

  it('takes an interval of your own behind +X days', async () => {
    const { el } = await mount(makeItem({ id: '1', inspection_date: null }));
    expect(q(el, '[data-testid="editor-inspection-custom"]')).toBe(null);

    (q(el, '[data-testid="editor-inspection-offset-custom"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const dateInput = () => q(el, '[data-testid="editor-inspection-date"]') as HTMLInputElement;
    expect(dateInput().value).toBe(addDays(14));

    const input = q(el, '[data-testid="editor-inspection-custom"]')?.querySelector('input') as HTMLInputElement;
    input.value = '180';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(dateInput().value).toBe(addDays(180));
    // No preset can claim the date while the custom field owns it.
    expect(all(el, '[data-testid="editor-inspection-offset"]').some((b) => b.classList.contains('on'))).toBe(
      false,
    );

    // An emptied box means no date yet rather than the last one it wrote.
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(dateInput().value).toBe('');
  });

  // Disabled rather than absent, on the terms the due date and the repeat are:
  // a control that would do nothing keeps its place, so pressing it is not a
  // race against the row resizing under the pointer.
  it('leaves the remove button dead until there is a date to remove', async () => {
    const { el } = await mount(makeItem({ id: '1', inspection_date: null }));
    const clear = () => q(el, '[data-testid="editor-inspection-clear"]') as HTMLButtonElement;
    expect(clear().disabled).toBe(true);

    (all(el, '[data-testid="editor-inspection-offset"]')[0] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(clear().disabled).toBe(false);
  });

  // The custom row is open because an interval of somebody's own is in force.
  // Over an emptied field its chip would still be lit as the one that set the
  // date, which is the state the presets are never left in.
  it('shuts the +X days row when the date that row wrote is removed', async () => {
    const { el } = await mount(makeItem({ id: '1', inspection_date: null }));
    (q(el, '[data-testid="editor-inspection-offset-custom"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-inspection-custom"]')).toBeTruthy();

    (q(el, '[data-testid="editor-inspection-clear"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect((q(el, '[data-testid="editor-inspection-date"]') as HTMLInputElement).value).toBe('');
    expect(q(el, '[data-testid="editor-inspection-custom"]')).toBe(null);
    expect(q(el, '[data-testid="editor-inspection-offset-custom"]')?.classList.contains('on')).toBe(false);
  });

  // The button disables itself on the empty field it has just made, and a
  // disabled control leaves its focus on the page body — where Escape no longer
  // reaches this form and the next Tab starts over from the top.
  it('hands focus to the field it emptied rather than to the page', async () => {
    const { el } = await mount(makeItem({ id: '1', inspection_date: '2027-03-01' }));

    (q(el, '[data-testid="editor-inspection-clear"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-inspection-date"]'));
  });

  /*
   * The check-out box holds two controls side by side and one of them has no
   * label, which is what put them on different lines: packed to the top of
   * their own cells, the button landed level with the *label* opposite it and
   * the date input a label's height lower, with dead air under the button.
   *
   * jsdom lays out nothing, so what can be pinned here is the structure the
   * alignment rests on — one grid, four children, named rows — rather than the
   * two edges lining up. The measurement is in the PR body.
   */
  it('puts the button and the due date in one grid rather than two stacks', async () => {
    const { el } = await mount(makeItem({ id: '1', checked_out: false }));
    const body = q(el, '.checkout-body') as HTMLElement;
    const children = [...body.children].map((c) => c.className.split(' ').filter(Boolean));

    expect(children).toEqual([
      ['field-button', 'checkout-action'],
      ['hv-label', 'due-label', 'muted'],
      ['hv-input', 'due-input'],
      ['group-hint'],
    ]);
    // No per-half wrapper left to pack its own contents to the top.
    expect(body.querySelector('.cell')).toBe(null);
  });

  // Checked out, the note goes and the grid is three children — the hint area
  // collapses rather than leaving a row behind.
  it('drops the note once the item is checked out', async () => {
    const { el } = await mount(makeItem({ id: '1', checked_out: true, due_date: '2099-01-01' }));
    const body = q(el, '.checkout-body') as HTMLElement;
    expect([...body.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'editor-checked-out',
      null,
      'editor-due-date',
    ]);
  });

  // The element's top level is the grid, so the editor's cell is the only box around it.
  it('draws the two boxes and the reminder as one grid', async () => {
    const { el } = await mount(makeItem({ id: '1' }));
    const grid = q(el, '.state') as HTMLElement;

    expect([...grid.children].map((c) => c.className.split(' ').filter(Boolean))).toEqual([
      ['group'],
      ['group'],
      ['group', 'reminder'],
    ]);
    expect([...(el.shadowRoot?.children ?? [])].filter((c) => c.tagName !== 'STYLE')).toEqual([grid]);
  });

  it('stacks the boxes on a phone and gives the dialog the phone flags', async () => {
    const { el } = await mount(makeItem({ id: '1' }), { mobile: true });
    const popover = q(el, '[data-testid="editor-checkout"]') as HTMLElement & {
      inline: boolean;
      touch: boolean;
    };

    expect(el.hasAttribute('mobile')).toBe(true);
    expect(popover.inline).toBe(true);
    expect(popover.touch).toBe(true);
    expect(componentCss('hv-editor-dates')).toMatch(
      /:host\(\[mobile\]\) \.state \{[^}]*grid-template-columns: 1fr/,
    );
  });

  it('hands the dialog the item and the name typed so far', async () => {
    const item = makeItem({ id: '1', name: 'Multimeter' });
    const { el } = await mount(item, {}, { name: '  Fluke  ' });
    const popover = q(el, '[data-testid="editor-checkout"]') as HTMLElement & {
      item: Item | null;
      itemName: string;
    };

    expect(popover.item).toBe(item);
    expect(popover.itemName).toBe('Fluke');
  });

  describe('the check-out dialog', () => {
    it('reports whether it is open, and shuts from outside', async () => {
      const { el } = await mount(makeItem({ id: '1' }));
      expect(el.checkoutOpen).toBe(false);

      (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
      await el.updateComplete;
      expect(el.checkoutOpen).toBe(true);

      el.closeCheckout();
      await el.updateComplete;
      const popover = q(el, '[data-testid="editor-checkout"]') as Popover;
      await popover.updateComplete;
      expect(el.checkoutOpen).toBe(false);
      expect(popover.open).toBe(false);
    });

    it('sends the check-out to the form as a patch, and keeps the event from the host', async () => {
      const { el, changes } = await mount(makeItem({ id: '1' }));
      const host: string[] = [];
      document.body.addEventListener('check-out', () => host.push('check-out'));

      await checkOut(el);

      expect(changes).toEqual([{ checkedOut: true, dueDate: addDays(7) }]);
      expect(host).toEqual([]);
      expect(el.checkoutOpen).toBe(false);
    });

    it('closes on its own cancel without letting the event out', async () => {
      const { el, changes } = await mount(makeItem({ id: '1' }));
      const seen: string[] = [];
      document.body.addEventListener('cancel', () => seen.push('cancel'));

      (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
      await el.updateComplete;
      const popover = q(el, '[data-testid="editor-checkout"]') as Popover;
      await popover.updateComplete;
      popover.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
      await el.updateComplete;

      expect(el.checkoutOpen).toBe(false);
      expect(seen).toEqual([]);
      expect(changes).toEqual([]);
    });
  });

  it('sends the inspection date it cleared and the reminder halves it was typed', async () => {
    const { el, changes } = await mount(makeItem({ id: '1', inspection_date: '2027-03-01' }));

    (q(el, '[data-testid="editor-inspection-clear"]') as HTMLButtonElement).click();
    await type(el, 'editor-reminder-date', '2026-09-01');
    await type(el, 'editor-reminder-count', '3');
    await type(el, 'editor-reminder-count', '');

    expect(changes).toEqual([
      { inspectionDate: '' },
      { reminderDate: '2026-09-01' },
      { reminderCount: 3 },
      { reminderCount: null },
    ]);
  });
});

describe('hv-editor-dates: reminders', () => {
  const count = (el: HVEditorDates) => q(el, '[data-testid="editor-reminder-count"]') as HTMLInputElement;
  const unit = (el: HVEditorDates) => q(el, '[data-testid="editor-reminder-unit"]') as HTMLSelectElement;

  it('prefills a stored recurring reminder', async () => {
    const { el } = await mount(
      makeItem({
        id: '1',
        reminder_date: '2026-09-01',
        reminder_interval: { unit: 'months', count: 3 },
      }),
    );

    expect((q(el, '[data-testid="editor-reminder-date"]') as HTMLInputElement).value).toBe('2026-09-01');
    expect(count(el).value).toBe('3');
    expect(unit(el).value).toBe('months');
  });

  it('leaves the repeat blank and dead until a date is picked', async () => {
    const { el } = await mount(makeItem({ id: '1' }));
    expect(count(el).value).toBe('');
    expect(count(el).disabled).toBe(true);
    expect(unit(el).disabled).toBe(true);
    // A tooltip alone never reaches a phone, so the reason is on the page too.
    expect(q(el, '[data-testid="editor-reminder-hint"]')).toBeTruthy();

    await type(el, 'editor-reminder-date', '2026-09-01');
    expect(count(el).disabled).toBe(false);
    expect(unit(el).disabled).toBe(false);
    expect(q(el, '[data-testid="editor-reminder-hint"]')).toBe(null);
  });
});

describe('hv-editor-dates: geometry and type', () => {
  // Both boxes are caption + body and nothing else, so the hint belongs to the
  // field it explains rather than hanging under the box.
  it('puts the due-date hint inside the field it is about', async () => {
    const { el } = await mount(makeItem({ id: '1', checked_out: false }));
    const hint = q(el, '[data-testid="editor-due-hint"]');
    expect(hint).toBeTruthy();
    // The editor's cell around this element is out of reach from here, so the
    // box the hint and the field share is the check-out group.
    expect(hint?.closest('.group')?.querySelector('[data-testid="editor-due-date"]')).toBeTruthy();
  });

  it('drops the hint once there is a check-out to be due', async () => {
    const { el } = await mount(makeItem({ id: '1', checked_out: true }));
    expect(q(el, '[data-testid="editor-due-hint"]')).toBe(null);
  });
});

describe('hv-editor-dates: one label recipe', () => {
  it('gives every section label the shared recipe', async () => {
    const { el } = await mount(makeItem({ id: '1' }));
    for (const testid of ['editor-checkout-caption', 'editor-inspection-caption']) {
      expect(q(el, `[data-testid="${testid}"]`)?.classList.contains('hv-label'), testid).toBe(true);
    }
  });
});

describe('hv-editor-dates: one verb for checking out', () => {
  it('heads the box with the verb its own button uses', async () => {
    const { el } = await mount(makeItem({ id: '1' }));
    expect(q(el, '[data-testid="editor-checkout-caption"]')?.textContent?.trim()).toBe('Check out');
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent).toContain('Check out');
  });
});

// The quick offsets are worked out from today, so a form left open overnight
// has to move them.
describe('hv-editor-dates: the day turning over', () => {
  beforeEach(() => {
    // The clock is module-level and arms on its first subscriber, so every
    // element this file mounted earlier has to be disconnected before the fake
    // clock is installed.
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 23, 59, 58));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dates = (el: HVEditorDates) =>
    all(el, '[data-testid="editor-inspection-offset"]').map((b) => b.classList.contains('on'));

  it('moves the preset that matches the date once the day has passed', async () => {
    const { el } = await mount(null, {}, { inspectionDate: addDays(7) });
    expect(dates(el)).toEqual([true, false, false]);

    vi.advanceTimersByTime(3_000);
    await settle(el);

    expect(dates(el)).toEqual([false, false, false]);
  });

  it('leaves a disconnected element out of it', async () => {
    const { el } = await mount(null, {}, { inspectionDate: addDays(7) });
    el.remove();

    vi.advanceTimersByTime(3_000);
    await settle(el);

    expect(dates(el)).toEqual([true, false, false]);
  });
});

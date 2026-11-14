import { setLanguage, t } from '../i18n';
import { html, render } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import './hv-item-editor';
import {
  all,
  componentCss,
  defined,
  discardAsker,
  makeAttachment,
  makeItem,
  makeMediaBindings,
  mountComponent,
  q,
  settle,
  stubClipboard,
} from '../test.utils';
import type { ClipboardStub } from '../test.utils';
import { addDays } from '../ui/relative-time';
import type { HVItemEditor } from './hv-item-editor';
import type { HVEditorAttachments } from './hv-editor-attachments';
import type { HVEditorCategory } from './hv-editor-category';
import type { Item, ItemCreate, ItemUpdate, Location, LocationTreeNode } from '../store/types';

const garage: Location = {
  id: 'garage',
  name: 'Garage',
  parent_id: null,
  area_id: null,
  path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
};

const tree: LocationTreeNode[] = [
  {
    id: 'garage',
    name: 'Garage',
    parent_id: null,
    area_id: null,
    path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
    direct_item_count: 0,
    subtree_item_count: 0,
    children: [],
  },
];

async function mount(item: Item | null, props: Partial<HVItemEditor> = {}) {
  const { el } = await mountComponent<HVItemEditor>('hv-item-editor', {
    item,
    locationTree: tree,
    locations: [garage],
    categorySuggestions: ['Hardware', 'Tools'],
    tagSuggestions: ['metric', 'm4'],
    customFieldKeys: ['serial', 'warranty_until'],
    ...props,
  });
  return el;
}

/** The child elements that render some of the form's fields in their own shadow roots. */
const FIELD_CHILDREN = ['hv-editor-category', 'hv-editor-attachments'] as const;

/**
 * A field by test id, wherever the form draws it: in the editor's own shadow
 * root or one level down, in a child element's.
 */
function field<T extends HTMLElement = HTMLElement>(el: HVItemEditor, testid: string): T | null {
  const selector = `[data-testid="${testid}"]`;
  const own = q<T>(el, selector);
  if (own) return own;
  for (const tag of FIELD_CHILDREN) {
    const child = q(el, tag);
    const hit = child ? q<T>(child, selector) : null;
    if (hit) return hit;
  }
  return null;
}

/**
 * The editor as a host renders it: `keyed` by item id, so another id is
 * another element. `editor()` is whichever one is mounted now.
 */
async function keyedHost(initial: Item | null) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const show = async (item: Item | null) => {
    render(
      keyed(
        item?.id ?? null,
        html`<hv-item-editor
          .item=${item}
          .locationTree=${tree}
          .locations=${[garage]}
          .categorySuggestions=${['Hardware', 'Tools']}
        ></hv-item-editor>`,
      ),
      root,
    );
    await settle(root.querySelector('hv-item-editor') as HTMLElement);
  };
  await show(initial);
  return { show, editor: () => root.querySelector('hv-item-editor') as HVItemEditor };
}

/** jsdom lays out no shadow DOM, so layout rules are asserted on the sheet. */
const editorCss = () => {
  return componentCss('hv-item-editor');
};

async function type(el: HVItemEditor, testid: string, value: string) {
  const input = q(el, `[data-testid="${testid}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await el.updateComplete;
}

/** Press Check out and confirm the dialog it opens, with whatever it suggests. */
async function checkOut(el: HVItemEditor) {
  (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
  await el.updateComplete;
  const popover = q(el, '[data-testid="editor-checkout"]') as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await popover.updateComplete;
  (popover.shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
  await el.updateComplete;
  return popover;
}

/** The dialog behind a testid, awaited so its own render has run. */
async function dialog(el: HVItemEditor, testid: string) {
  const found = q(el, `[data-testid="${testid}"]`) as HTMLElement & {
    updateComplete: Promise<unknown>;
    open: boolean;
  };
  await found.updateComplete;
  return found;
}

function onSave(el: HVItemEditor) {
  const saves: {
    itemId: string | null;
    expectedVersion?: number;
    changes?: ItemUpdate;
    create?: ItemCreate;
  }[] = [];
  el.addEventListener('save', (e) => saves.push((e as CustomEvent).detail));
  return saves;
}

describe('hv-item-editor: field parity', () => {
  it('offers every field the modal it replaces had', async () => {
    const el = await mount(makeItem({ id: '1', name: 'Multimeter' }));
    for (const testid of [
      'editor-name',
      'editor-quantity',
      'editor-low-stock',
      'editor-description',
      'editor-category',
      'editor-status',
      'editor-tags',
      'editor-location',
      'editor-checked-out',
      'editor-due-date',
      'editor-inspection-date',
      'editor-cf-add',
    ]) {
      expect(field(el, testid), testid).toBeTruthy();
    }
  });

  it('prefills from the item and shows its version', async () => {
    const item = makeItem({ id: '1', name: 'Multimeter', quantity: 1, version: 9, category: 'Tools' });
    const el = await mount(item);
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('Multimeter');
    expect(field<HTMLInputElement>(el, 'editor-category')?.value).toBe('Tools');
    expect(q(el, '[data-testid="editor-version"]')?.textContent).toContain('v9');
    expect(q(el, '[data-testid="editor-heading"]')?.textContent).toContain('Multimeter — editing');
  });

  // The header chip said "Out", which reads as out of stock — the opposite of a
  // borrowed item that is still in the inventory. Every list and table already
  // said "Checked out"; this header and the detail sheet were the holdouts.
  it('names the check-out state the way every list does', async () => {
    const el = await mount(makeItem({ id: '1', checked_out: true, due_date: '2099-07-31' }));
    expect(q(el, '[data-testid="editor-out-chip"]')?.textContent?.trim()).toMatch(/^Checked out · due /);

    const late = await mount(makeItem({ id: '2', checked_out: true, due_date: '2020-01-01' }));
    expect(q(late, '[data-testid="editor-out-chip"]')?.textContent).toContain('Overdue');
  });

  it('opens empty as the add-item expander', async () => {
    const el = await mount(null);
    expect(q(el, '[data-testid="editor-heading"]')?.textContent).toContain('New item');
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('');
    expect(q(el, '[data-testid="editor-delete"]')).toBe(null);
  });

  it('only allows a due date while the item is checked out', async () => {
    const el = await mount(makeItem({ id: '1' }));
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).disabled).toBe(true);

    await checkOut(el);
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).disabled).toBe(false);
  });

  // The mobile sheet has asked for a due date, with quick offsets and a way to
  // decline one, since the revamp. The editor flipped a flag and left you to
  // find the date field yourself. Same component, both widths.
  it('asks for a due date through the same dialog the sheet uses', async () => {
    const el = await mount(makeItem({ id: '1', name: 'Multimeter', checked_out: false }));
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check out…');

    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const popover = q(el, '[data-testid="editor-checkout"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
      open: boolean;
    };
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
    const el = await mount(null);
    await type(el, 'editor-name', 'Torque wrench');
    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const popover = q(el, '[data-testid="editor-checkout"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await popover.updateComplete;
    expect(popover.shadowRoot?.querySelector('[data-testid="checkout-title"]')?.textContent).toContain(
      'Check out Torque wrench',
    );
  });

  it('takes no due date for an answer', async () => {
    const el = await mount(makeItem({ id: '1' }));
    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const popover = q(el, '[data-testid="editor-checkout"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await popover.updateComplete;
    (popover.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check in');
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).value).toBe('');
  });

  it('checks back in without asking anything', async () => {
    const el = await mount(makeItem({ id: '1', checked_out: true, due_date: '2099-01-01' }));
    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent?.trim()).toBe('Check out…');
  });

  // The field was already disabled, but a disabled date input keeps the
  // browser's own colour — against a dark HA theme it looked live, and the
  // `title` explaining it never reaches a phone.
  it('greys the due date out, and says why, while the item is not checked out', async () => {
    const el = await mount(makeItem({ id: '1', checked_out: false }));
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

    const css = componentCss('hv-item-editor');
    expect(css).toMatch(/\.hv-input:disabled \{[^}]*color: var\(--hv-text-tertiary\)/);
    expect(css).toMatch(/\.hv-input:disabled \{[^}]*-webkit-text-fill-color/);
  });

  // A switch says "this is a property, set it either way". Checking something
  // out is an act, and the detail sheet has always said so — same words, same
  // icons, so the two surfaces cannot teach different things.
  it('offers checking out as an action, in the same words the sheet uses', async () => {
    const el = await mount(makeItem({ id: '1', checked_out: false }));
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
    const el = await mount(makeItem({ id: '1' }));

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
    const el = await mount(makeItem({ id: '1' }));
    const caption = q(el, '[data-testid="editor-inspection-caption"]')?.textContent?.trim();
    expect(caption).toBe('Next inspection');
  });

  // An interval is known in weeks or months; a date three months out is
  // arithmetic. Same jumps as the check-out popover, since it is one gesture.
  it('offers the same quick offsets the check-out popover does', async () => {
    const el = await mount(makeItem({ id: '1', inspection_date: null }));
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
    const el = await mount(makeItem({ id: '1', inspection_date: null }));
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

  it('saves the date an offset picked', async () => {
    const el = await mount(makeItem({ id: 'item-1', inspection_date: null, version: 3 }));
    const saves = onSave(el);

    (all(el, '[data-testid="editor-inspection-offset"]')[0] as HTMLButtonElement).click();
    await el.updateComplete;
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]?.changes?.inspection_date).toBe(addDays(7));
  });

  // Every other way in is drawn on the box; the way back out was emptying the
  // field with the keyboard, which nobody finds by looking at it.
  it('takes the inspection date off again from a button beside the field', async () => {
    const el = await mount(makeItem({ id: 'item-1', inspection_date: '2027-03-01', version: 3 }));
    const saves = onSave(el);
    const dateInput = () => q(el, '[data-testid="editor-inspection-date"]') as HTMLInputElement;
    expect(dateInput().value).toBe('2027-03-01');

    const clear = q(el, '[data-testid="editor-inspection-clear"]') as HTMLButtonElement;
    expect(clear.getAttribute('aria-label')).toBe('Clear inspection date');
    clear.click();
    await el.updateComplete;

    expect(dateInput().value).toBe('');
    expect(el.dirty).toBe(true);

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.inspection_date).toBe(null);
  });

  // Disabled rather than absent, on the terms the due date and the repeat are:
  // a control that would do nothing keeps its place, so pressing it is not a
  // race against the row resizing under the pointer.
  it('leaves the remove button dead until there is a date to remove', async () => {
    const el = await mount(makeItem({ id: '1', inspection_date: null }));
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
    const el = await mount(makeItem({ id: '1', inspection_date: null }));
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
    const el = await mount(makeItem({ id: '1', inspection_date: '2027-03-01' }));

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
    const el = await mount(makeItem({ id: '1', checked_out: false }));
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
    const el = await mount(makeItem({ id: '1', checked_out: true, due_date: '2099-01-01' }));
    const body = q(el, '.checkout-body') as HTMLElement;
    expect([...body.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'editor-checked-out',
      null,
      'editor-due-date',
    ]);
  });
});

describe('hv-item-editor: saving', () => {
  it('sends a create payload with no item id', async () => {
    const el = await mount(null);
    const saves = onSave(el);

    await type(el, 'editor-name', 'M4 Screws');
    await type(el, 'editor-quantity', '340');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves).toHaveLength(1);
    expect(saves[0]?.itemId).toBe(null);
    expect(saves[0]?.create).toMatchObject({ name: 'M4 Screws', quantity: 340 });
  });

  it('offers the three statuses and carries the chosen one into the save', async () => {
    const el = await mount(makeItem({ id: 'item-1', name: 'A', status: 'ok' }));
    const saves = onSave(el);

    const select = q(el, '[data-testid="editor-status"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['ok', 'missing', 'needs_repair']);
    expect([...select.options].map((o) => o.text)).toEqual(['OK', 'Missing', 'Needs repair']);
    expect(select.value).toBe('ok');

    select.value = 'needs_repair';
    select.dispatchEvent(new Event('change'));
    await el.updateComplete;
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]?.changes?.status).toBe('needs_repair');
  });

  it('defaults a new item to ok and saves the picked status on create', async () => {
    const el = await mount(null);
    const saves = onSave(el);

    await type(el, 'editor-name', 'Ladder');
    const select = q(el, '[data-testid="editor-status"]') as HTMLSelectElement;
    expect(select.value).toBe('ok');
    select.value = 'missing';
    select.dispatchEvent(new Event('change'));
    await el.updateComplete;
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]?.create?.status).toBe('missing');
  });

  it('sends the expected version so a conflict surfaces as a conflict', async () => {
    const el = await mount(makeItem({ id: 'item-1', name: 'A', version: 9 }));
    const saves = onSave(el);

    await type(el, 'editor-name', 'B');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]).toMatchObject({ itemId: 'item-1', expectedVersion: 9 });
    expect(saves[0]?.changes?.name).toBe('B');
  });

  // The row under the form is live: another member's quantity change arrives as
  // a fresh `item` while the description is being typed, and the version it
  // carries is the one the save is checked against. So the save must send what
  // was typed here and nothing else — the form's own copy of their field would
  // be accepted and would undo them.
  it('sends the field the edit touched, not the copy the form was opened on', async () => {
    const el = await mount(makeItem({ id: 'item-1', name: 'A', quantity: 10, version: 2 }));
    const saves = onSave(el);

    await type(el, 'editor-description', 'mine');
    el.item = makeItem({ id: 'item-1', name: 'A', quantity: 15, version: 3 });
    await el.updateComplete;

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]).toMatchObject({ itemId: 'item-1', expectedVersion: 3 });
    expect(saves[0]?.changes).toEqual({ description: 'mine' });
  });

  it('blocks the save and shows the problem on the offending field', async () => {
    const el = await mount(null);
    const saves = onSave(el);

    await type(el, 'editor-quantity', '-3');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(saves).toEqual([]);
    expect(q(el, '[data-testid="editor-name-error"]')?.textContent).toContain('Name is required');
    expect(q(el, '[data-testid="editor-quantity-error"]')?.textContent).toContain("can't be negative");
  });

  it('clears a field error as soon as it is fixed', async () => {
    const el = await mount(null);
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-name-error"]')).toBeTruthy();

    await type(el, 'editor-name', 'Now valid');
    expect(q(el, '[data-testid="editor-name-error"]')).toBe(null);
  });

  it('saves on either modifier + Enter, and discards on Escape', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    const root = q(el, '[data-testid="item-editor"]') as HTMLElement;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    expect(saves).toHaveLength(1);

    // The PC chord is not a second-class citizen — the footer advertises it by
    // default, so it has to be the same binding.
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(saves).toHaveLength(2);

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancels).toBe(1);
  });

  // The hint names no key the keyboard in front of the user lacks — ⌘↵ on a PC
  // names nothing. jsdom reports no Apple platform, so this is the fallback
  // branch.
  it('names the save chord for the keyboard it can actually detect', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const hint = q(el, '[data-testid="editor-key-hint"]')?.textContent ?? '';
    // Esc asks whenever there is typing to lose, exactly as Cancel and the ✕
    // do, so the hint promises closing and not discarding.
    expect(hint).toContain('Esc closes');
    expect(hint).toContain('Ctrl+Enter saves');
    expect(hint).not.toContain('⌘');
  });

  // Neither shortcut exists on a phone: there is no Esc key and no Ctrl to hold,
  // so the footer was advertising two chords nobody holding the thing can press.
  it('drops the keyboard hint on a phone', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });
    expect(q(el, '[data-testid="editor-key-hint"]')).toBe(null);
    // The keydown handlers stay — a phone can be docked to a keyboard.
    const saves = onSave(el);
    (q(el, '[data-testid="item-editor"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(saves).toHaveLength(1);
  });

  // The auto margin that holds Cancel and Save against the right edge rides on
  // a spacer of its own: on the hint, hiding the hint drops them beside Delete.
  it('keeps Cancel and Save off the left edge once the hint is gone', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });
    const kids = [...(q(el, '.actions')?.children ?? [])];
    expect(kids.map((c) => c.getAttribute('data-testid') ?? c.className)).toEqual([
      'editor-delete',
      'spacer',
      'editor-cancel',
      'editor-save',
    ]);
    expect(editorCss()).toMatch(/\.actions \.spacer \{[^}]*margin-left: auto/);
  });

  // Measured at 375px in the panel's detail sheet: the row has 343px and the
  // three German labels plus their gaps want 352.2, so Save dropped onto a line
  // of its own at the left edge. The verb alone costs the row 78px.
  it('shows Delete as the bare verb on a phone and the whole phrase elsewhere', async () => {
    const narrow = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });
    const wide = await mount(makeItem({ id: '1', name: 'A' }));

    const label = (el: Element) => q(el, '[data-testid="editor-delete"]')?.textContent?.trim();
    expect(label(narrow)).toBe(t('hv.action.delete'));
    expect(label(wide)).toBe(t('hv.action.deleteItem'));
    expect(label(narrow)).not.toBe(label(wide));

    // Shorter on the screen, unchanged to a screen reader — on both branches,
    // so the name never depends on the width.
    for (const el of [narrow, wide]) {
      expect(q(el, '[data-testid="editor-delete"]')?.getAttribute('aria-label')).toBe(
        t('hv.action.deleteItem'),
      );
    }
  });

  // Three buttons in one row take one shape: a bordered pill beside two
  // borderless buttons reads as a third. The card's other destructive actions —
  // the detail sheet's own Delete item, the organize dialog's Delete — are all
  // borderless red.
  it('styles Delete like every other destructive action in the card', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect([...(q(el, '[data-testid="editor-delete"]')?.classList ?? [])]).toEqual([
      'hv-text-button',
      'danger',
    ]);
    // The same shared class as the Cancel beside it, so the two boxes match.
    expect(q(el, '[data-testid="editor-cancel"]')?.classList.contains('hv-text-button')).toBe(true);
    // Which only holds while the shared sheet is what dresses it.
    expect(editorCss()).toMatch(/\.hv-text-button\.danger \{[^}]*color: var\(--hv-error-soft\)/);
  });

  it('surfaces a server-side failure without losing the form', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { errorMessage: 'Storage is full' });
    expect(q(el, '[data-testid="editor-error"]')?.textContent).toContain('Storage is full');
  });
});

describe('hv-item-editor: location and tags', () => {
  // Location renders a pin and "No location" when nothing is set; Category beside
  // it drew an empty box with a bare chevron, which reads as broken rendering
  // rather than as nothing selected — loudest on the phone add-sheet.
  it('names the empty category the way the location field names an empty location', async () => {
    const el = await mount(makeItem({ id: '1', category: '' }));
    const category = field(el, 'editor-category') as HTMLInputElement;

    expect(category.value).toBe('');
    expect(category.placeholder).toBe('No category');
    expect(q(el, '[data-testid="editor-location"]')?.textContent).toContain('No location');
  });

  it('picks a location from a tree inside the form, never a second dialog', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    expect(q(el, '[data-testid="editor-location-tree"]')).toBe(null);

    (q(el, '[data-testid="editor-location"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const treeEl = el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    (
      treeEl.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await el.updateComplete;

    // Picked in place, and the tree closed again.
    expect(q(el, '[data-testid="editor-location"]')?.textContent).toContain('Garage');
    expect(el.shadowRoot?.querySelector('hv-location-tree')).toBe(null);

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.location_id).toBe('garage');
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the button in reading order.
  it('names the holder the location field discloses, open or shut', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const field = () => q(el, '[data-testid="editor-location"]') as HTMLButtonElement;
    const id = 'editor-location-tree-holder';

    expect(field().getAttribute('aria-controls')).toBe(id);
    expect(field().getAttribute('aria-expanded')).toBe('false');
    // The id has to resolve in both states — a button pointing at nothing
    // announces as controlling nothing — so the holder outlives the tree in it.
    const shut = el.shadowRoot?.getElementById(id);
    expect(shut, 'holder shut').toBeTruthy();
    expect(shut?.querySelector('hv-location-tree'), 'no tree while shut').toBe(null);

    field().click();
    await el.updateComplete;

    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(field().getAttribute('aria-controls')).toBe(id);
    expect(el.shadowRoot?.getElementById(id)?.querySelector('hv-location-tree')).toBeTruthy();
  });

  // The modal had a dedicated Clear button next to the location field; here the
  // same job belongs to the tree's own clear row, and it has to reach the save
  // payload as a null rather than being quietly dropped.
  //
  // That row is called "All items" in the sidebar, where clearing the location
  // does show every item. In a picker it assigns one, so the same wording
  // promised a set of items and produced an empty field instead.
  it('puts an item back to no location at all', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'garage' }));
    const saves = onSave(el);

    (q(el, '[data-testid="editor-location"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const treeEl = el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    const clearRow = treeEl.shadowRoot?.querySelector('[data-testid="tree-all"]') as HTMLButtonElement;
    expect(clearRow.textContent).toContain('No location');
    expect(clearRow.textContent).not.toContain('All items');
    clearRow.click();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-location"]')?.textContent).toContain('No location');

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.location_id).toBeNull();
  });

  it('marks the area behind the chosen location, apart from the path itself', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'garage' }), {
      locations: [{ ...garage, area_id: 'area-kitchen' }],
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });
    const field = q(el, '[data-testid="editor-location"]');
    expect(field?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(field?.querySelector('.value')?.textContent).toBe('Garage');
  });

  // Naming a root after the room it stands in is the ordinary thing a household
  // does, and the field then printed the same word twice with a chip's edge
  // between them. Same rule as the rows, the table cell and the sheet's crumb —
  // the picker elides too, and the pairing survives in the button's title.
  it('drops the area mark when the chosen path already opens with that name', async () => {
    const kitchen = { id: 'kitchen', name: 'Kitchen', parent_id: null, area_id: 'area-kitchen' };
    for (const path of ['Kitchen', 'Kitchen / Pantry']) {
      const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'kitchen' }), {
        locations: [
          {
            ...kitchen,
            path: { id_path: ['kitchen'], name_path: [], display_path: path, sort_key: '' },
          },
        ],
        areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
      });
      const field = q(el, '[data-testid="editor-location"]');
      const pretty = path.replace(' / ', ' › ');
      expect(field?.querySelector('.hv-area-chip'), path).toBe(null);
      expect(field?.querySelector('.value')?.textContent, path).toBe(pretty);
      expect(field?.getAttribute('title'), path).toBe(`Area: Kitchen · ${pretty}`);
      el.remove();
    }
  });

  it('keeps the mark when the area only reappears further down the path', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'kitchen' }), {
      locations: [
        {
          id: 'kitchen',
          name: 'Kitchen',
          parent_id: null,
          area_id: 'area-kitchen',
          path: {
            id_path: ['kitchen'],
            name_path: [],
            display_path: 'Cellar / Kitchen',
            sort_key: '',
          },
        },
      ],
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });
    const field = q(el, '[data-testid="editor-location"]');
    expect(field?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(field?.querySelector('.value')?.textContent).toBe('Cellar › Kitchen');
  });

  it('shows no area chip for a location in no area', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'garage' }), {
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });
    const field = q(el, '[data-testid="editor-location"]');
    expect(field?.querySelector('.hv-area-chip')).toBeNull();
    expect(field?.querySelector('.value')?.textContent).toBe('Garage');
  });

  it('edits tags as chips and lowercases them on commit', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', tags: ['metric'] }));
    const saves = onSave(el);
    const chips = el.shadowRoot?.querySelector('hv-chip-input') as HTMLElement;

    const input = chips.shadowRoot?.querySelector('[data-testid="chip-input"]') as HTMLInputElement;
    input.value = 'M4';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.tags).toEqual(['metric', 'm4']);
  });
});

// The combobox itself is `hv-editor-category`'s spec. What the form owes is
// the wiring: the suggestions go in, a pick lands in the save, and Escape
// takes the list back before the form.
describe('hv-item-editor: category picker', () => {
  const category = (el: HVItemEditor) => q(el, 'hv-editor-category') as HVEditorCategory;
  const inCategory = (el: HVItemEditor, testid: string) =>
    q(category(el), `[data-testid="${testid}"]`) as HTMLElement;

  it('hands the field the household categories and the phone flag', async () => {
    const el = await mount(null, { mobile: true });
    expect(category(el).suggestions).toEqual(['Hardware', 'Tools']);
    expect(category(el).hasAttribute('mobile')).toBe(true);
    // It sits in the grid as one cell, label and control together.
    expect(category(el).classList.contains('cell')).toBe(true);
  });

  it('saves a picked option', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    (inCategory(el, 'editor-category') as HTMLInputElement).focus();
    await settle(el);

    (all(category(el), '[data-testid="editor-category-option"]')[1] as HTMLButtonElement).click();
    await settle(el);

    expect((inCategory(el, 'editor-category') as HTMLInputElement).value).toBe('Tools');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.category).toBe('Tools');
  });

  it('saves what was typed, with the list narrowing on it', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    const input = inCategory(el, 'editor-category') as HTMLInputElement;
    input.focus();
    input.value = 'too';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await settle(el);

    expect(all(category(el), '[data-testid="editor-category-option"]').map((o) => o.dataset.value)).toEqual([
      'Tools',
    ]);
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.category).toBe('too');
  });

  it('closes the list on Escape in the field without discarding the edit', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });
    const input = inCategory(el, 'editor-category') as HTMLInputElement;
    input.focus();
    await settle(el);
    expect(category(el).open).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    await settle(el);
    expect(category(el).open).toBe(false);
    expect(cancels).toBe(0);
  });
});

describe('hv-item-editor: typed custom fields', () => {
  it('lists the fields of an item with the right editor per type', async () => {
    const el = await mount(
      makeItem({ id: '1', name: 'A', custom_fields: { serial: '44210', price: 189, calibrated: true } }),
    );
    const rows = all(el, '[data-testid="editor-cf-row"]');
    expect(rows).toHaveLength(3);

    const types = all(el, '[data-testid="editor-cf-type"]').map((s) => (s as HTMLSelectElement).value);
    expect(types).toEqual(['string', 'number', 'boolean']);
    // The boolean row is a switch, not a text box.
    expect(rows[2]?.querySelector('[data-testid="editor-cf-value"]')?.getAttribute('role')).toBe('switch');
  });

  it('puts the remove button right after the value it removes', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', custom_fields: { serial: '44210' } }));
    const row = q(el, '[data-testid="editor-cf-row"]') as HTMLElement;

    expect([...row.children].map((c) => c.getAttribute('data-testid'))).toEqual([
      'editor-cf-key',
      'editor-cf-type',
      'editor-cf-value',
      'editor-cf-remove',
    ]);
  });

  // Every host that can scroll the form puts the actions below the fold — the
  // card's list, the phone sheet, and the expanded view, which caps the form at
  // 70dvh — so the editor keeps them in reach itself rather than each host
  // growing a footer of its own.
  it('keeps Save and Cancel in reach on every host', async () => {
    const css = editorCss();

    // Sticky has to sit on the wrapping cell: an element sticks only within its
    // containing block, and the actions' parent is exactly as tall as they are.
    expect(css).toMatch(/[^)] \.actions-cell \{[^}]*position: sticky/);
    expect(css).toMatch(/[^)] \.actions-cell \{[^}]*bottom: -14px/);

    // The opaque bar bleeds past the form's side padding, or the rows it covers
    // show through in a strip either side of it.
    expect(css).toMatch(/[^)] \.actions-cell \{[^}]*margin: 0 -18px/);
    expect(css).toMatch(/[^)] \.actions-cell \{[^}]*padding: 10px 18px 14px/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.actions-cell \{[^}]*margin: 0 -16px/);

    // ...and the markup has to carry the class the rule needs, on both hosts.
    for (const mobile of [false, true]) {
      const el = await mount(makeItem({ id: '1' }), { mobile });
      const cell = q(el, '.actions-cell');
      expect(cell, `mobile=${mobile}`).toBeTruthy();
      expect(cell?.querySelector('[data-testid="editor-save"]')).toBeTruthy();
      expect(cell?.querySelector('[data-testid="editor-cancel"]')).toBeTruthy();
      el.remove();
    }
  });

  it('adds and removes rows', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect(all(el, '[data-testid="editor-cf-row"]')).toHaveLength(0);

    (q(el, '[data-testid="editor-cf-add"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(all(el, '[data-testid="editor-cf-row"]')).toHaveLength(1);

    (q(el, '[data-testid="editor-cf-remove"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(all(el, '[data-testid="editor-cf-row"]')).toHaveLength(0);
  });

  it('seeds a row from a key already in use elsewhere', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    (q(el, '[data-testid="editor-cf-key-hint"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect((q(el, '[data-testid="editor-cf-key"]') as HTMLInputElement).value).toBe('serial');
  });

  it('sends the unset so a removed key is actually cleared, and leaves the rest alone', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', custom_fields: { serial: 'x', gone: 'y' } }));
    const saves = onSave(el);

    const rows = all(el, '[data-testid="editor-cf-row"]');
    (
      defined(rows[1], 'second row').querySelector('[data-testid="editor-cf-remove"]') as HTMLButtonElement
    ).click();
    await el.updateComplete;

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.custom_fields_unset).toEqual(['gone']);
    expect(saves[0]?.changes?.custom_fields_set).toBeUndefined();
  });

  it('refuses to save a number field holding text', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', custom_fields: { price: 189 } }));
    const saves = onSave(el);

    const value = q(el, '[data-testid="editor-cf-value"]') as HTMLInputElement;
    value.value = 'not a number';
    value.dispatchEvent(new Event('input'));
    await el.updateComplete;

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(saves).toEqual([]);
    expect(q(el, '[data-testid="editor-cf-error"]')?.textContent).toContain('must be a number');
  });
});

describe('hv-item-editor: mobile layout', () => {
  // The wide form shows every field and is scrolled to the bottom; the phone
  // form is the same form in one column. A field the phone reaches only through
  // a control of its own is a field a household has to know is there.
  it('stacks every field into one column, with nothing to open first', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });

    for (const testid of [
      'editor-name',
      'editor-tags',
      'editor-description',
      'editor-due-date',
      'editor-inspection-date',
      'editor-reminder-date',
      'editor-cf-add',
    ]) {
      expect(q(el, `[data-testid="${testid}"]`), testid).toBeTruthy();
    }
    // Every one of them is there for the scroll, with no disclosure in front.
    expect(q(el, '[data-testid="editor-more-toggle"]')).toBe(null);
  });

  // The emptiest item is the one whose fields are easiest to leave out, and the
  // create form is where every one of them is first set.
  it('shows the same fields on a phone with nothing filled in yet', async () => {
    const el = await mount(null, { mobile: true });

    expect(q(el, '[data-testid="editor-description"]')).toBeTruthy();
    expect(q(el, '[data-testid="editor-inspection-date"]')).toBeTruthy();
    expect(q(el, '[data-testid="editor-cf-add"]')).toBeTruthy();
  });

  // The fields an edit is usually about come first and the rest follows, which
  // is the order the wide form reads in too.
  it('keeps the rarely-touched fields below the rest, in their order', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });

    const order = all(
      el,
      [
        '[data-testid="editor-name"]',
        '[data-testid="editor-description"]',
        '[data-testid="editor-inspection-date"]',
        '[data-testid="editor-cf-add"]',
      ].join(','),
    ).map((node) => node.dataset.testid);

    expect(order).toEqual(['editor-name', 'editor-description', 'editor-inspection-date', 'editor-cf-add']);
  });

  // The field is rendered at a different point in the grid on each width, from
  // one renderer: a label pointing at an id nothing carries names nothing.
  it('names the description field on both widths', async () => {
    for (const mobile of [true, false]) {
      const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile });
      const field = q(el, '[data-testid="editor-description"]') as HTMLTextAreaElement;

      expect(field.id, `mobile=${mobile}`).toBeTruthy();
      expect(q(el, `label[for="${field.id}"]`)?.textContent, `mobile=${mobile}`).toContain(
        t('hv.field.description'),
      );
      el.remove();
    }
  });
});

describe('hv-item-editor: dirty tracking', () => {
  it('reports clean until something changes', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect(el.dirty).toBe(false);
    await type(el, 'editor-name', 'B');
    expect(el.dirty).toBe(true);
  });

  // A different id is a new form, and so a new element: hosts render this one
  // keyed by item id (their own tests hold them to it). An id swapped under a
  // live form would save one item's typing onto another, so it is refused.
  it('refuses a different item under an open form', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    el.item = makeItem({ id: '2', name: 'C' });
    await expect(el.updateComplete).rejects.toThrow(/keyed by item id/);
  });

  it('starts clean for another item when rendered keyed by id, as hosts do', async () => {
    const host = await keyedHost(makeItem({ id: '1', name: 'A' }));
    const first = host.editor();
    await type(first, 'editor-name', 'B');
    expect(first.dirty).toBe(true);

    await host.show(makeItem({ id: '2', name: 'C' }));
    expect(host.editor()).not.toBe(first);
    expect(host.editor().dirty).toBe(false);
    expect((q(host.editor(), '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('C');
  });
});

describe('hv-item-editor: opening', () => {
  // The editor's own footer promises "Esc discards", but that is a keydown
  // handler on the editor root: it never fires while focus is still on the
  // page body, which is where it stayed when a row expanded.
  it('lands focus on the name field so Escape and typing work immediately', async () => {
    const el = await mount(makeItem({ name: 'Multimeter' }));
    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-name"]'));
  });

  it('discards on Escape once open, without a click first', async () => {
    const el = await mount(makeItem({ name: 'Multimeter' }));
    let cancelled = false;
    el.addEventListener('cancel', () => {
      cancelled = true;
    });
    el.shadowRoot?.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(cancelled).toBe(true);
  });

  it('focuses the name field for a new item too', async () => {
    const el = await mount(null);
    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-name"]'));
  });
});

// Escape-to-close-a-dropdown is muscle memory, so one Escape closes the
// dropdown and not the form and the typing with it.
describe('hv-item-editor: Escape takes back one thing at a time', () => {
  const esc = (el: HVItemEditor, from?: HTMLElement) =>
    (from ?? (q(el, '[data-testid="item-editor"]') as HTMLElement)).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );

  function onCancel(el: HVItemEditor) {
    const seen = { count: 0 };
    el.addEventListener('cancel', () => {
      seen.count += 1;
    });
    return seen;
  }

  // The arrow opens the list without taking focus, so Escape can come from
  // another field; the list still goes first.
  it('closes the category list before the form, wherever focus is', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);
    const category = q(el, 'hv-editor-category') as HVEditorCategory;
    (q(category, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    expect(category.open).toBe(true);

    esc(el, q(el, '[data-testid="editor-name"]') as HTMLElement);
    await settle(el);
    expect(category.open).toBe(false);
    expect(cancels.count).toBe(0);

    esc(el, q(el, '[data-testid="editor-name"]') as HTMLElement);
    expect(cancels.count).toBe(1);
  });

  it('closes the location picker and leaves the form standing', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);

    (q(el, '[data-testid="editor-location"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-location-tree"]')).toBeTruthy();

    esc(el);
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-location-tree"]')).toBe(null);
    expect(cancels.count).toBe(0);
    // And the control that opened it takes the focus back.
    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-location"]'));
  });

  // The popover renders in a shadow root of its own; without the key stopping
  // there it reached this form's handler too and closed both.
  it('closes the check-out popover and leaves the form standing', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);

    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const popover = (await dialog(el, 'editor-checkout')) as HTMLElement & { open: boolean };
    expect(popover.open).toBe(true);

    (popover.shadowRoot?.querySelector('[data-testid="checkout-popover"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(popover.open).toBe(false);
    expect(cancels.count).toBe(0);
  });

  it('asks before discarding a form that has been typed into', async () => {
    const host = discardAsker();
    const el = await mount(makeItem({ id: '1', name: 'A' }), { confirmDiscard: host.ask });
    const cancels = onCancel(el);
    await type(el, 'editor-name', 'A longer name');
    expect(el.dirty).toBe(true);

    esc(el);
    await el.updateComplete;

    expect(host.asked).toBe(1);
    expect(cancels.count).toBe(0);

    host.answer('discard');
    await el.updateComplete;
    expect(cancels.count).toBe(1);
  });
});

// Escape asked and the two buttons beside it did not, so the same decision had
// a cheap way out and an expensive one depending on which control was nearest.
describe('hv-item-editor: every close this form owns asks the same question', () => {
  const paths = ['editor-cancel', 'editor-close'] as const;

  /** A dirty form with a host standing by to answer for it. */
  async function dirtyForm() {
    const host = discardAsker();
    const el = await mount(makeItem({ id: '1', name: 'A' }), { confirmDiscard: host.ask });
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });
    await type(el, 'editor-name', 'A longer name');
    return { el, host, cancels: () => cancels };
  }

  it.each(paths)('%s asks before throwing typed edits away', async (testid) => {
    const { el, host, cancels } = await dirtyForm();

    (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
    await el.updateComplete;

    expect(host.asked).toBe(1);
    expect(cancels()).toBe(0);

    host.answer('discard');
    await el.updateComplete;
    expect(cancels()).toBe(1);
  });

  it.each(paths)('%s keeps the typing when the question is declined', async (testid) => {
    const { el, host, cancels } = await dirtyForm();

    (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
    await el.updateComplete;
    host.answer('keep');
    await el.updateComplete;

    expect(cancels()).toBe(0);
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('A longer name');
    // The question took focus out of the form, so declining it puts focus back.
    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-name"]'));
  });

  it.each(paths)('%s closes a clean form without asking', async (testid) => {
    const host = discardAsker();
    const el = await mount(makeItem({ id: '1', name: 'A' }), { confirmDiscard: host.ask });
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
    await el.updateComplete;

    expect(cancels).toBe(1);
    expect(host.asked).toBe(0);
  });
});

// The first minute of a fresh install: an item form whose most important field
// cannot be satisfied, and no way in sight to make it satisfiable.
describe('hv-item-editor: creating the first location from the picker', () => {
  const empty = { locationTree: [] as LocationTreeNode[], locations: [] as Location[] };

  const created: Location = {
    id: 'loc-new',
    name: 'Shed',
    parent_id: null,
    area_id: null,
    path: { id_path: ['loc-new'], name_path: ['Shed'], display_path: 'Shed', sort_key: 'shed' },
  };

  async function openTree(el: HVItemEditor) {
    (q(el, '[data-testid="editor-location"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const tree = el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await tree.updateComplete;
    return tree;
  }

  it('offers no create affordance when the host cannot run the command', async () => {
    const el = await mount(null, empty);
    const tree = await openTree(el);

    expect(tree.shadowRoot?.querySelector('[data-testid="tree-empty"]')).toBeTruthy();
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-create"]')).toBe(null);
  });

  it('creates the location and files the item in it', async () => {
    const names: string[] = [];
    const el = await mount(null, {
      ...empty,
      createLocation: async (name: string) => {
        names.push(name);
        return created;
      },
    });
    const saves = onSave(el);
    await type(el, 'editor-name', 'Ladder');
    const tree = await openTree(el);

    (tree.shadowRoot?.querySelector('[data-testid="tree-create"]') as HTMLButtonElement).click();
    await tree.updateComplete;
    const input = tree.shadowRoot?.querySelector('[data-testid="tree-create-name"]') as HTMLInputElement;
    input.value = 'Shed';
    input.dispatchEvent(new Event('input'));
    await tree.updateComplete;
    (tree.shadowRoot?.querySelector('[data-testid="tree-create-submit"]') as HTMLButtonElement).click();
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(names).toEqual(['Shed']);
    // Picked, and the picker closed behind it — the same shape as picking an
    // existing location.
    expect(el.shadowRoot?.querySelector('hv-location-tree')).toBe(null);
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.create?.location_id).toBe('loc-new');
  });

  /** Type a name into the empty picker's create row and submit it. */
  async function submitCreate(el: HVItemEditor, tree: HTMLElement, name: string) {
    (tree.shadowRoot?.querySelector('[data-testid="tree-create"]') as HTMLButtonElement).click();
    await (tree as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const input = tree.shadowRoot?.querySelector('[data-testid="tree-create-name"]') as HTMLInputElement;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    await (tree as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    (tree.shadowRoot?.querySelector('[data-testid="tree-create-submit"]') as HTMLButtonElement).click();
    for (let i = 0; i < 4; i += 1) await el.updateComplete;
  }

  // The inline expander reaches this form through a template callback `hv-list`
  // re-invokes only when one of its own properties changes. A location create
  // changes none of them, so `locations` can stay empty for as long as the form
  // is open — and the field would name nothing it had just filled.
  it('names the location it created even when the host list never catches up', async () => {
    const el = await mount(null, { ...empty, createLocation: async () => created });
    const tree = await openTree(el);
    await submitCreate(el, tree, 'Shed');

    expect(el.locations).toEqual([]);
    expect(q(el, '[data-testid="editor-location"]')?.textContent).toContain('Shed');
  });

  it('lists what it created when the picker is reopened', async () => {
    const el = await mount(null, { ...empty, createLocation: async () => created });
    await submitCreate(el, await openTree(el), 'Shed');
    const reopened = await openTree(el);

    // Still the empty state would offer to create the same name a second time.
    expect(reopened.shadowRoot?.querySelector('[data-testid="tree-empty"]')).toBe(null);
    expect(reopened.shadowRoot?.textContent).toContain('Shed');
  });

  it('does not double the row once the host list carries it too', async () => {
    const el = await mount(null, { ...empty, createLocation: async () => created });
    await submitCreate(el, await openTree(el), 'Shed');

    el.locations = [created];
    el.locationTree = [{ ...created, direct_item_count: 0, subtree_item_count: 0, children: [] }];
    await el.updateComplete;
    const reopened = await openTree(el);

    const rows = [...(reopened.shadowRoot?.querySelectorAll('[data-testid="tree-row"]') ?? [])];
    expect(rows.filter((r) => r.textContent?.includes('Shed'))).toHaveLength(1);
  });

  it('reports a refused name against the field instead of swallowing it', async () => {
    const el = await mount(null, {
      ...empty,
      createLocation: async () => {
        throw new Error('A location called Shed already exists');
      },
    });
    const tree = await openTree(el);

    (tree.shadowRoot?.querySelector('[data-testid="tree-create"]') as HTMLButtonElement).click();
    await tree.updateComplete;
    const input = tree.shadowRoot?.querySelector('[data-testid="tree-create-name"]') as HTMLInputElement;
    input.value = 'Shed';
    input.dispatchEvent(new Event('input'));
    await tree.updateComplete;
    (tree.shadowRoot?.querySelector('[data-testid="tree-create-submit"]') as HTMLButtonElement).click();
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(q(el, '[data-testid="editor-location-error"]')?.textContent).toContain('already exists');
    // The picker stays open so the name can be corrected where it was typed.
    expect(el.shadowRoot?.querySelector('hv-location-tree')).toBeTruthy();
  });
});

// Every host re-binds `.item` from a fresh lookup on each store broadcast, so
// an upload landing — or anyone else editing the same row — hands the open form
// a new object for the item it is already on.
describe('hv-item-editor: same-item refreshes', () => {
  /** The broadcast arriving: same id, new object, version moved on. */
  const refreshed = (el: HVItemEditor, partial: Partial<Item>) => {
    el.item = makeItem({ id: 'i-1', name: 'Drill', ...partial });
    return el.updateComplete;
  };

  it('keeps unsaved typing when the same item comes back with a new version', async () => {
    const el = await mount(makeItem({ id: 'i-1', name: 'Drill', version: 3 }));
    await type(el, 'editor-description', 'IMPORTANT NOTE typed but not yet saved');
    expect(el.dirty).toBe(true);

    await refreshed(el, { version: 4 });

    const description = q(el, '[data-testid="editor-description"]') as HTMLInputElement;
    expect(description.value).toBe('IMPORTANT NOTE typed but not yet saved');
    expect(el.dirty).toBe(true);
  });

  // The phone form renders the description from the other branch of the grid,
  // so it is worth its own pass: the typing has to survive the refresh there
  // as well, and be on screen rather than merely held in the model.
  it('keeps typing on the phone form when the same item comes back', async () => {
    const el = await mount(makeItem({ id: 'i-1', name: 'Drill', version: 3 }), { mobile: true });
    await type(el, 'editor-description', 'typed on a phone');

    await refreshed(el, { version: 4 });

    expect((q(el, '[data-testid="editor-description"]') as HTMLTextAreaElement)?.value).toBe(
      'typed on a phone',
    );
    expect(el.dirty).toBe(true);
  });

  // returned; saving against the older one would come back `conflict`.
  it('saves against the refreshed item once it has caught up with an upload', async () => {
    const media = makeMediaBindings({
      upload: async (itemId) => makeItem({ id: itemId, version: 7 }),
    });
    const el = await mount(makeItem({ id: 'i-1', name: 'Drill', version: 3 }), { media });

    const input = field(el, 'editor-photo-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'photo.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const saves = onSave(el);
    q(el, '[data-testid="editor-save"]')?.click();
    expect(saves[0]?.expectedVersion).toBe(7);

    await refreshed(el, { version: 9 });
    q(el, '[data-testid="editor-save"]')?.click();
    expect(saves[1]?.expectedVersion).toBe(9);
  });

  // The create form's hop from no id to a real one is a new form too. A host
  // closes the form on a landed create, so in practice nobody sees the hop; a
  // host that kept it open would get a fresh form with focus on the name.
  it('rebuilds the form when the create form saves into a real item', async () => {
    const host = await keyedHost(null);
    await type(host.editor(), 'editor-name', 'Drill');
    expect(host.editor().dirty).toBe(true);

    await host.show(makeItem({ id: 'i-1', name: 'Drill', version: 1 }));

    const el = host.editor();
    expect(el.dirty).toBe(false);
    const name = q(el, '[data-testid="editor-name"]') as HTMLInputElement;
    expect(name.value).toBe('Drill');
    expect(el.shadowRoot?.activeElement).toBe(name);
  });
});

describe('hv-item-editor: touch targets and the shared tally', () => {
  // The count beside a facet is declared once, in the shared sheet.
  it('prices its custom fields with the shared tally', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect(q(el, '[data-testid="editor-cf-tally"]')?.classList.contains('hv-tally')).toBe(true);
  });
});

/** The attachments element the editor renders, once it is there. */
const attachmentsOf = (el: HVItemEditor) =>
  defined(q<HVEditorAttachments>(el, 'hv-editor-attachments') ?? undefined, 'the attachments element');

describe('hv-item-editor: the attachments element', () => {
  const MEDIA_CONFIG = {
    picture_mime_types: ['image/png'],
    max_pictures_per_item: 4,
    max_attachment_bytes: 16,
  };

  const withPhoto = () =>
    makeItem({ id: 'i-1', name: 'Drill', attachments: [makeAttachment({ id: 'att-1' })] });

  /** Press a remove control inside the element and answer the guard it opens. */
  async function removeAttachment(el: HVItemEditor, testid: string, answer: 'confirm' | 'cancel') {
    const child = attachmentsOf(el);
    (q(child, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
    await child.updateComplete;
    const guard = q(child, '[data-testid="editor-remove-confirm"]') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await guard.updateComplete;
    (
      guard.shadowRoot?.querySelector(
        answer === 'confirm' ? '[data-testid="confirm-accept"]' : '[data-testid="confirm-cancel"]',
      ) as HTMLButtonElement
    ).click();
    await child.updateComplete;
  }

  const key = (k: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...init });

  it('hands the element the item, the bindings, the caps and the phone flag', async () => {
    const media = makeMediaBindings();
    const item = makeItem({ id: 'i-1', name: 'Drill', version: 3 });
    const el = await mount(item, { media, mediaConfig: MEDIA_CONFIG, mobile: true });
    await el.updateComplete;

    const child = attachmentsOf(el);
    expect(child.item).toBe(item);
    expect(child.media).toBe(media);
    expect(child.mediaConfig).toBe(MEDIA_CONFIG);
    expect(child.mobile).toBe(true);
    expect(child.hasAttribute('mobile')).toBe(true);

    // A host re-binds the editor's item on every broadcast; the element follows.
    const next = makeItem({ id: 'i-1', name: 'Drill', version: 4 });
    el.item = next;
    await el.updateComplete;
    expect(child.item).toBe(next);
  });

  it('leaves the phone flag off on a desktop form', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings(), mobile: false });

    expect(attachmentsOf(el).mobile).toBe(false);
  });

  it('draws no element on the create form, where there is no id to file against', async () => {
    const el = await mount(null, { media: makeMediaBindings() });

    expect(q(el, 'hv-editor-attachments')).toBeNull();
  });

  it('draws no element when the card carries no attachment support', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: null });

    expect(q(el, 'hv-editor-attachments')).toBeNull();
  });

  it('gives the element the two sections a gap of the grid, one cell wide', () => {
    const css = editorCss();

    expect(css).toMatch(/\.attachments \{[^}]*grid-column: 1 \/ -1[^}]*display: grid[^}]*gap: 12px/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.attachments \{[^}]*gap: 14px/);
  });

  it('puts focus back on the name when the element says it was stranded', async () => {
    const el = await mount(withPhoto(), { media: makeMediaBindings() });
    await el.updateComplete;
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).focus();
    const heard: Event[] = [];
    el.addEventListener('focus-stranded', (e) => heard.push(e));

    attachmentsOf(el).dispatchEvent(new CustomEvent('focus-stranded', { bubbles: true, composed: true }));

    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-name"]'));
    // The editor's own business: a host has no use for it.
    expect(heard).toEqual([]);
  });

  // The guard hands focus back to the removed tile's own remove button, which is
  // gone by the time the strip redraws; the form is where it belongs then.
  it('catches the focus a removed tile took with it', async () => {
    const media = makeMediaBindings({
      remove: async (itemId) => makeItem({ id: itemId, version: 9, attachments: [] }),
    });
    const el = await mount(withPhoto(), { media });
    await el.updateComplete;
    const child = attachmentsOf(el);
    // A press moves focus to the control pressed; jsdom's click does not.
    (q(child, '[data-testid="editor-photo-remove"]') as HTMLButtonElement).focus();

    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    for (let i = 0; i < 4; i += 1) await child.updateComplete;

    expect(all(child, '[data-testid="editor-photo"]')).toHaveLength(0);
    expect(document.activeElement).toBe(el);
    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-name"]'));
  });

  it('keeps the guard answers from reading as a close of the form', async () => {
    const el = await mount(withPhoto(), { media: makeMediaBindings() });
    await el.updateComplete;
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    await removeAttachment(el, 'editor-photo-remove', 'cancel');
    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    for (let i = 0; i < 3; i += 1) await attachmentsOf(el).updateComplete;

    expect(cancels).toBe(0);
  });

  it('closes the lightbox and leaves the form standing', async () => {
    const el = await mount(
      makeItem({
        id: 'i-1',
        name: 'Drill',
        attachments: [makeAttachment({ id: 'a' }), makeAttachment({ id: 'b' })],
      }),
      { media: makeMediaBindings() },
    );
    const child = attachmentsOf(el);
    await settle(el);
    await settle(child);
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    (all(child, '[data-testid="editor-photo-open"]')[0] as HTMLButtonElement).click();
    await settle(child);
    const lightbox = q<HTMLElement & { updateComplete?: Promise<unknown> }>(child, 'hv-lightbox');
    await lightbox?.updateComplete;
    (lightbox?.shadowRoot?.querySelector('[data-testid="lightbox-close"]') as HTMLButtonElement).click();
    await settle(child);
    await lightbox?.updateComplete;

    expect(lightbox?.shadowRoot?.querySelector('[data-testid="lightbox"]')).toBe(null);
    expect(cancels).toBe(0);
    expect(q(el, '[data-testid="item-editor"]')).toBeTruthy();
  });

  describe('Ctrl+Enter', () => {
    async function withGuardOpen() {
      const el = await mount(withPhoto(), { media: makeMediaBindings() });
      await el.updateComplete;
      const child = attachmentsOf(el);
      (q(child, '[data-testid="editor-photo-remove"]') as HTMLButtonElement).click();
      await child.updateComplete;
      const guard = q(child, '[data-testid="editor-remove-confirm"]') as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      await guard.updateComplete;
      const accept = guard.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLElement;
      return { el, accept, saves: onSave(el) };
    }

    it('does not save the form from inside the remove guard', async () => {
      const { el, accept, saves } = await withGuardOpen();

      accept.dispatchEvent(key('Enter', { ctrlKey: true }));
      accept.dispatchEvent(key('Enter', { metaKey: true }));
      await el.updateComplete;

      expect(saves).toHaveLength(0);
    });

    it('still saves from the name field', async () => {
      const { el, saves } = await withGuardOpen();

      (q(el, '[data-testid="editor-name"]') as HTMLElement).dispatchEvent(key('Enter', { ctrlKey: true }));

      expect(saves).toHaveLength(1);
    });

    it('lets other keys out of the guard to the host, which traps focus with them', async () => {
      const { el, accept } = await withGuardOpen();
      const heard: string[] = [];
      el.addEventListener('keydown', (e) => heard.push(e.key));

      accept.dispatchEvent(key('Tab'));

      expect(heard).toEqual(['Tab']);
    });
  });

  describe('a drop on the form', () => {
    const png = () => new File(['x'], 'photo.png', { type: 'image/png' });

    function dragEvent(type: string, files: File[]) {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', {
        value: { files, dropEffect: 'none' },
        configurable: true,
      });
      return e as DragEvent;
    }

    // A drop a few pixels wide of the target would otherwise replace the page with
    // the file and take the whole open form with it.
    it('swallows a drop that missed the targets', async () => {
      const media = makeMediaBindings();
      const el = await mount(makeItem({ id: 'i-1' }), { media });
      const root = q(el, '[data-testid="item-editor"]') as HTMLElement;

      const over = dragEvent('dragover', [png()]);
      root.dispatchEvent(over);
      const drop = dragEvent('drop', [png()]);
      root.dispatchEvent(drop);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(over.defaultPrevented).toBe(true);
      expect(drop.defaultPrevented).toBe(true);
      expect(media.uploads).toHaveLength(0);
    });

    // The form ends a drag the sections did not see the end of: the drop landed
    // beside them, and the section's outline would stay on.
    it('ends the outline a drag left on a section', async () => {
      const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
      const child = attachmentsOf(el);
      const photos = q(child, '[data-testid="editor-photos"]') as HTMLElement;

      photos.dispatchEvent(dragEvent('dragover', [png()]));
      await child.updateComplete;
      expect(photos.classList.contains('dropping')).toBe(true);

      (q(el, '[data-testid="item-editor"]') as HTMLElement).dispatchEvent(dragEvent('drop', [png()]));
      await child.updateComplete;

      expect(photos.classList.contains('dropping')).toBe(false);
    });
  });
});

// The create form has no PHOTOS section at all — an upload is filed against an
// item id and there is none yet. Unexplained, that reads as a missing feature.
describe('hv-item-editor: why attachments wait for the first save', () => {
  it('says so where the photo grid will be', async () => {
    const el = await mount(null, { media: makeMediaBindings() });

    expect(field(el, 'editor-photos')).toBe(null);
    expect(q(el, '[data-testid="editor-attachment-hint"]')?.textContent).toContain('Save the item first');
  });

  it('says nothing once the sections are actually there', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-attachment-hint"]')).toBe(null);
    expect(field(el, 'editor-photos')).toBeTruthy();
  });

  // A host that hands over no media bindings offers no attachments at any
  // point, so there is nothing to explain the absence of.
  it('stays quiet when the card carries no attachment support at all', async () => {
    const el = await mount(null);

    expect(q(el, '[data-testid="editor-attachment-hint"]')).toBe(null);
  });
});

describe('hv-item-editor: geometry and type', () => {
  // Both boxes are caption + body and nothing else, so the hint belongs to the
  // field it explains rather than hanging under the box.
  it('puts the due-date hint inside the field it is about', async () => {
    const el = await mount(makeItem({ id: '1', checked_out: false }));
    const hint = q(el, '[data-testid="editor-due-hint"]');
    expect(hint).toBeTruthy();
    expect(hint?.closest('.cell')?.querySelector('[data-testid="editor-due-date"]')).toBeTruthy();
  });

  it('drops the hint once there is a check-out to be due', async () => {
    const el = await mount(makeItem({ id: '1', checked_out: true }));
    expect(q(el, '[data-testid="editor-due-hint"]')).toBe(null);
  });
});

describe('hv-item-editor: one label recipe, one note size', () => {
  it('gives every section label the shared recipe', async () => {
    const el = await mount(makeItem({ id: '1' }));
    for (const testid of ['editor-checkout-caption', 'editor-inspection-caption']) {
      expect(q(el, `[data-testid="${testid}"]`)?.classList.contains('hv-label'), testid).toBe(true);
    }
  });

  // A note riding inside a label steps out of the label's uppercase treatment,
  // and the rule for that belongs in the stylesheet like every other.
  it('carries the tags note as a class, not an inline style', async () => {
    const el = await mount(makeItem({ id: '1' }));
    expect(el.shadowRoot?.innerHTML).not.toContain('style="text-transform');
    const note = el.shadowRoot?.querySelector('.label-note');
    expect(note?.textContent).toContain('always lowercase');
  });
});

// "0 of 2 keys in use" reads as a quota. There is none: the denominator was the
// count of distinct keys anywhere in the inventory, and the fallback made it
// the numerator whenever that lookup was empty, so it could only ever say
// "N of N".
describe('hv-item-editor: the custom-fields tally states a fact', () => {
  it('counts the fields that are set, and nothing else', async () => {
    const el = await mount(
      makeItem({ id: '1', custom_fields: { serial: 'A1', warranty_until: '2030-01-01' } }),
      { customFieldKeys: ['serial', 'warranty_until', 'voltage'] },
    );
    expect(q(el, '[data-testid="editor-cf-tally"]')?.textContent?.trim()).toBe('2 fields set');
  });

  it('says nothing about keys when the item has none', async () => {
    const el = await mount(makeItem({ id: '1', custom_fields: {} }), {
      customFieldKeys: ['serial', 'voltage'],
    });
    const tally = q(el, '[data-testid="editor-cf-tally"]')?.textContent?.trim();
    expect(tally).toBe('0 fields set');
    expect(tally).not.toContain('in use');
  });

  // The inventory-wide keys are still offered, framed as what they are.
  it('still offers the keys other items use', async () => {
    const el = await mount(makeItem({ id: '1', custom_fields: {} }), {
      customFieldKeys: ['serial', 'voltage'],
    });
    expect(q(el, '.key-hints')?.textContent).toContain('Key suggestions');
  });
});

describe('hv-item-editor: one verb for checking out', () => {
  it('heads the box with the verb its own button uses', async () => {
    const el = await mount(makeItem({ id: '1' }));
    expect(q(el, '[data-testid="editor-checkout-caption"]')?.textContent?.trim()).toBe('Check out');
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent).toContain('Check out');
  });
});

describe('hv-item-editor: reminders', () => {
  const count = (el: HVItemEditor) => q(el, '[data-testid="editor-reminder-count"]') as HTMLInputElement;
  const unit = (el: HVItemEditor) => q(el, '[data-testid="editor-reminder-unit"]') as HTMLSelectElement;

  it('prefills a stored recurring reminder', async () => {
    const el = await mount(
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
    const el = await mount(makeItem({ id: '1' }));
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

  it('saves the anchor and the interval in the one item write', async () => {
    const el = await mount(makeItem({ id: 'item-1', version: 3 }));
    const saves = onSave(el);

    await type(el, 'editor-reminder-date', '2026-09-01');
    await type(el, 'editor-reminder-count', '3');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]?.changes?.reminder_date).toBe('2026-09-01');
    expect(saves[0]?.changes?.reminder_interval).toEqual({ unit: 'months', count: 3 });
  });

  it('saves a date with no repeat as a one-off', async () => {
    const el = await mount(makeItem({ id: 'item-1', version: 3 }));
    const saves = onSave(el);

    await type(el, 'editor-reminder-date', '2026-09-01');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    // The item had no interval, so there is none to clear: the date alone says
    // one-off, and the write names only what this edit moved.
    expect(saves[0]?.changes).toEqual({ reminder_date: '2026-09-01' });
  });

  it('clears both halves when the date is cleared', async () => {
    const el = await mount(
      makeItem({
        id: 'item-1',
        version: 3,
        reminder_date: '2026-09-01',
        reminder_interval: { unit: 'months', count: 3 },
      }),
    );
    const saves = onSave(el);

    await type(el, 'editor-reminder-date', '');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]?.changes?.reminder_date).toBe(null);
    // Not just left as it was: the backend refuses an interval with no anchor.
    expect(saves[0]?.changes?.reminder_interval).toBe(null);
  });
});

describe('hv-item-editor: the id an automation names', () => {
  const UUID = '0f2c4a11-6b3d-4a5e-9c8f-2d1e0b7a4c63';
  const button = (el: HVItemEditor) => q<HTMLButtonElement>(el, '[data-testid="editor-copy-id"]')!;
  let clipboard: ClipboardStub;

  beforeEach(() => {
    clipboard = stubClipboard();
  });

  afterEach(() => clipboard());

  // The editor is the only surface a desktop gets: the detail sheet that also
  // prints the id opens on a card ≤600px and in the full view below 700px.
  it('prints the whole id of the item being edited', async () => {
    const el = await mount(makeItem({ id: UUID }));
    // Elided it would be unpastable, which is the only reason to print it.
    expect(q(el, '[data-testid="editor-id"]')?.textContent?.trim()).toBe(UUID);
  });

  // jsdom lays out no shadow DOM, so the rule is read off the stylesheet.
  it('offers the whole id to one tap rather than to a 36-character drag', async () => {
    await mount(makeItem({ id: UUID }));
    expect(editorCss()).toMatch(/\.id-row code \{[^}]*user-select: all/);
  });

  it('says nothing on the create form, which has no id yet', async () => {
    const el = await mount(null);
    expect(q(el, '[data-testid="editor-id"]')).toBeNull();
    expect(q(el, '[data-testid="editor-copy-id"]')).toBeNull();
  });

  // The action row is Delete, Cancel and Save, and at 375px those three have
  // 343px to spend — a fourth label there would take the row onto two lines.
  it('keeps the copy out of the phone action row', async () => {
    const el = await mount(makeItem({ id: UUID }), { mobile: true });
    expect(button(el).closest('.actions')).toBeNull();
  });

  // What raising the label takes and how it goes away are `CopyFlash`'s own
  // spec in `ui/clipboard.test.ts`. What the form owes is the wiring: the id it
  // is editing goes in, the label comes back off the controller, and the move
  // to another item takes it back — a label left standing would name the id of
  // the item before this one.
  it('copies the id it is editing', async () => {
    const el = await mount(makeItem({ id: UUID }));
    expect(button(el).textContent?.trim()).toBe('Copy');

    button(el).click();
    await settle(el);

    expect(clipboard.writes).toEqual([UUID]);
    expect(button(el).textContent?.trim()).toBe('Copied');
  });

  it('forgets the flash on the next item, which is a new form', async () => {
    const host = await keyedHost(makeItem({ id: UUID }));
    button(host.editor()).click();
    await settle(host.editor());
    expect(button(host.editor()).textContent?.trim()).toBe('Copied');

    await host.show(makeItem({ id: 'i-8' }));

    expect(q(host.editor(), '[data-testid="editor-id"]')?.textContent?.trim()).toBe('i-8');
    expect(button(host.editor()).textContent?.trim()).toBe('Copy');
  });
});

describe('hv-item-editor: the language in force', () => {
  it('labels its fields and refuses a save in German', async () => {
    setLanguage('de');
    const { el } = await mountComponent<HVItemEditor>('hv-item-editor', {
      item: null,
      locations: [garage],
      locationTree: tree,
    });
    await settle(el);
    expect(el.shadowRoot?.textContent).toContain('Menge');
    expect(el.shadowRoot?.textContent).toContain('Neuer Gegenstand');
    q<HTMLButtonElement>(el, '[data-testid="editor-save"]')?.click();
    await settle(el);
    // The message comes from `ui/item-form`, which the mechanism PR translated
    // — so this also proves the two halves speak the same language.
    expect(q(el, '[data-testid="editor-name-error"]')?.textContent).toContain('erforderlich');
  });
});

describe('hv-item-editor: the day turning over', () => {
  const mounted: HVItemEditor[] = [];

  beforeEach(() => {
    // The clock is module-level and arms on its first subscriber, so every
    // editor this file mounted earlier has to be disconnected before the fake
    // clock is installed.
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 23, 59, 58));
  });

  afterEach(() => {
    while (mounted.length) mounted.pop()?.remove();
    vi.useRealTimers();
  });

  async function mountAndTrack(item: Item) {
    const el = await mount(item);
    mounted.push(el);
    return el;
  }

  // A form left open overnight is the ordinary case on a phone, and its header
  // chip is read off the clock at render.
  it('calls a check-out overdue once its due date has passed', async () => {
    const el = await mountAndTrack(makeItem({ id: '1', checked_out: true, due_date: '2026-08-22' }));
    expect(q(el, '[data-testid="editor-out-chip"]')?.textContent).toContain('Checked out');

    vi.advanceTimersByTime(3_000);
    await settle(el);

    expect(q(el, '[data-testid="editor-out-chip"]')?.textContent).toContain('Overdue');
  });

  it('leaves a disconnected editor out of it', async () => {
    const el = await mountAndTrack(makeItem({ id: '1', checked_out: true, due_date: '2026-08-22' }));
    el.remove();

    vi.advanceTimersByTime(3_000);
    await settle(el);

    expect(q(el, '[data-testid="editor-out-chip"]')?.textContent).not.toContain('Overdue');
  });
});

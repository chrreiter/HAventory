import { setLanguage, t } from '../i18n';
import './hv-item-editor';
import {
  all,
  componentCss,
  makeAttachment,
  makeItem,
  makeManual,
  makeMediaBindings,
  mountComponent,
  q,
  settle,
  stubViewport,
} from '../test.utils';
// The clipboard itself is `ui/clipboard`'s own test; what the editor owes is
// asking the helper and believing its answer, which needs both answers.
vi.mock('../ui/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/clipboard')>()),
  copyText: vi.fn(async () => true),
}));
import { copyText } from '../ui/clipboard';
import { discardPrompt } from '../ui/discard';
import { MEDIA_NAME_TOKEN_PARAM, MEDIA_SIZE_PARAM, attachmentNameToken } from '../ui/media';
import { addDays } from '../ui/relative-time';
import type { HVItemEditor } from './hv-item-editor';
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

/** Press a remove control and answer the guard it opens. */
async function removeAttachment(el: HVItemEditor, testid: string, answer: 'confirm' | 'cancel') {
  (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
  await el.updateComplete;
  const guard = await dialog(el, 'editor-remove-confirm');
  (
    guard.shadowRoot?.querySelector(
      answer === 'confirm' ? '[data-testid="confirm-accept"]' : '[data-testid="confirm-cancel"]',
    ) as HTMLButtonElement
  ).click();
  await el.updateComplete;
}

function onSave(el: HVItemEditor) {
  const saves: { itemId: string | null; expectedVersion?: number; changes?: ItemUpdate; create?: ItemCreate }[] =
    [];
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
      expect(q(el, `[data-testid="${testid}"]`), testid).toBeTruthy();
    }
  });

  it('prefills from the item and shows its version', async () => {
    const item = makeItem({ id: '1', name: 'Multimeter', quantity: 1, version: 9, category: 'Tools' });
    const el = await mount(item);
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('Multimeter');
    expect((q(el, '[data-testid="editor-category"]') as HTMLInputElement).value).toBe('Tools');
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
    expect(all(el, '[data-testid="editor-inspection-offset"]').map((b) => b.textContent?.trim())).toEqual(
      ['+7 days', '+30 days', '+90 days'],
    );

    const dateInput = () => q(el, '[data-testid="editor-inspection-date"]') as HTMLInputElement;
    (all(el, '[data-testid="editor-inspection-offset"]')[1] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(dateInput().value).toBe(addDays(30));
    expect(all(el, '[data-testid="editor-inspection-offset"]')[1].classList.contains('on')).toBe(true);
  });

  it('takes an interval of your own behind +X days', async () => {
    const el = await mount(makeItem({ id: '1', inspection_date: null }));
    expect(q(el, '[data-testid="editor-inspection-custom"]')).toBe(null);

    (q(el, '[data-testid="editor-inspection-offset-custom"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const dateInput = () => q(el, '[data-testid="editor-inspection-date"]') as HTMLInputElement;
    expect(dateInput().value).toBe(addDays(14));

    const input = q(el, '[data-testid="editor-inspection-custom"]')?.querySelector(
      'input',
    ) as HTMLInputElement;
    input.value = '180';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(dateInput().value).toBe(addDays(180));
    // No preset can claim the date while the custom field owns it.
    expect(
      all(el, '[data-testid="editor-inspection-offset"]').some((b) => b.classList.contains('on')),
    ).toBe(false);

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

    expect(saves[0].changes?.inspection_date).toBe(addDays(7));
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
    expect(saves[0].itemId).toBe(null);
    expect(saves[0].create).toMatchObject({ name: 'M4 Screws', quantity: 340 });
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

    expect(saves[0].changes?.status).toBe('needs_repair');
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

    expect(saves[0].create?.status).toBe('missing');
  });

  it('sends the expected version so a conflict surfaces as a conflict', async () => {
    const el = await mount(makeItem({ id: 'item-1', name: 'A', version: 9 }));
    const saves = onSave(el);

    await type(el, 'editor-name', 'B');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]).toMatchObject({ itemId: 'item-1', expectedVersion: 9 });
    expect(saves[0].changes?.name).toBe('B');
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

  // The hint used to print ⌘↵ on every platform, naming a key a PC keyboard does
  // not have. jsdom reports no Apple platform, so this is the fallback branch.
  it('names the save chord for the keyboard it can actually detect', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const hint = q(el, '[data-testid="editor-key-hint"]')?.textContent ?? '';
    // Esc no longer discards: it asks whenever there is typing to lose, exactly
    // as Cancel and the ✕ do, so the hint stops promising the old outcome.
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

  // The auto margin that holds Cancel and Save against the right edge used to
  // ride on the hint, so hiding the hint dropped them back beside Delete.
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

    const label = (el: Element) =>
      q(el, '[data-testid="editor-delete"]')?.textContent?.trim();
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

  // Three buttons in one row, three shapes: measured at a 390px viewport in the
  // expanded view, Delete was 93x44 with a 1px border and a 999px radius, Cancel
  // beside it 64x44 borderless with an 8px radius, and Delete's 12.5px/400 text
  // matched neither. The card's other destructive actions — the detail sheet's
  // own Delete item, the organize dialog's Delete — are all borderless red.
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
    const category = q(el, '[data-testid="editor-category"]') as HTMLInputElement;

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
    expect(saves[0].changes?.location_id).toBe('garage');
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
    expect(saves[0].changes?.location_id).toBeNull();
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
    expect(saves[0].changes?.tags).toEqual(['metric', 'm4']);
  });
});

describe('hv-item-editor: category picker', () => {
  const options = (el: HVItemEditor) =>
    all(el, '[data-testid="editor-category-option"]').map((o) => o.dataset.value);

  /**
   * The listbox is the element the combobox names, so it stays put and empties
   * out instead of leaving — shut means hidden with nothing in it, not gone.
   */
  function expectListShut(el: HVItemEditor) {
    const list = q(el, '[data-testid="editor-category-list"]') as HTMLElement | null;
    expect(list).toBeTruthy();
    expect(list?.hidden).toBe(true);
    expect(list?.children).toHaveLength(0);
  }

  async function focusCategory(el: HVItemEditor) {
    const input = q(el, '[data-testid="editor-category"]') as HTMLInputElement;
    input.focus();
    await el.updateComplete;
    return input;
  }

  it('shows every existing category on focus, before a single keystroke', async () => {
    const el = await mount(null);
    expectListShut(el);

    await focusCategory(el);
    expect(options(el)).toEqual(['Hardware', 'Tools']);
  });

  // In flow the list grew its own grid cell, which grew the row, which
  // stretched the Location button beside it — the form came apart every time
  // the suggestions opened. Fixed, not absolute: the expanded view wraps the
  // whole form in an overflow-y:auto holder that would clip an absolute list.
  it('floats the list over the form instead of growing the row it sits in', async () => {
    const el = await mount(null);
    await focusCategory(el);

    const list = q(el, '[data-testid="editor-category-list"]');
    expect(list?.classList).toContain('floating');
    // Placed from a measurement, so it carries its own coordinates and stack.
    expect(list?.getAttribute('style')).toMatch(/left: -?\d+px/);
    expect(list?.getAttribute('style')).toMatch(/z-index: \d+/);

    const css = componentCss('hv-item-editor');
    expect(css).toMatch(/\.list-holder\.floating \{[^}]*position: fixed/);
    expect(css).toMatch(/\.tree-holder, \.list-holder \{[^}]*margin-top: 6px/);
  });

  // The combobox always named its listbox, but the listbox left the DOM with
  // the options — so while shut the name pointed at nothing.
  it('names a listbox that is there whether or not it is showing', async () => {
    const el = await mount(null);
    const input = () => q(el, '[data-testid="editor-category"]') as HTMLInputElement;
    const id = 'editor-category-list';

    expect(input().getAttribute('aria-controls')).toBe(id);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(el.shadowRoot?.getElementById(id), 'listbox shut').toBeTruthy();
    expectListShut(el);

    await focusCategory(el);

    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-controls')).toBe(id);
    const open = el.shadowRoot?.getElementById(id);
    expect(open?.getAttribute('role'), 'the popup itself, not a wrapper').toBe('listbox');
    expect(open?.hidden).toBe(false);
    expect(options(el)).toEqual(['Hardware', 'Tools']);
  });

  it('narrows the list while typing', async () => {
    const el = await mount(null);
    await focusCategory(el);

    await type(el, 'editor-category', 'too');
    expect(options(el)).toEqual(['Tools']);
  });

  it('reopens the full list from the arrow, whatever is typed', async () => {
    const el = await mount(null);
    await type(el, 'editor-category', 'too');
    expect(options(el)).toEqual(['Tools']);

    (q(el, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(options(el)).toEqual(['Hardware', 'Tools']);

    // The same button closes it again.
    (q(el, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expectListShut(el);
  });

  it('fills the field from a picked option and saves it', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    await focusCategory(el);

    (all(el, '[data-testid="editor-category-option"]')[1] as HTMLButtonElement).click();
    await el.updateComplete;

    expect((q(el, '[data-testid="editor-category"]') as HTMLInputElement).value).toBe('Tools');
    expectListShut(el);

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0].changes?.category).toBe('Tools');
  });

  it('picks with the keyboard and closes on Escape without discarding the edit', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });
    const input = await focusCategory(el);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await el.updateComplete;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await el.updateComplete;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    expect(input.value).toBe('Tools');

    (q(el, '[data-testid="editor-category-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expectListShut(el);
    expect(cancels).toBe(0);
  });

  it('says so when what you typed is a brand new category', async () => {
    const el = await mount(null);
    await type(el, 'editor-category', 'Camping');
    expect(options(el)).toEqual([]);
    expect(q(el, '[data-testid="editor-category-empty"]')?.textContent).toContain('Camping');
  });

  it('drops the arrow when there is nothing to list yet', async () => {
    const el = await mount(null, { categorySuggestions: [] });
    expect(q(el, '[data-testid="editor-category-toggle"]')).toBe(null);
    await focusCategory(el);
    expectListShut(el);
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
    expect(rows[2].querySelector('[data-testid="editor-cf-value"]')?.getAttribute('role')).toBe('switch');
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

  // The bar was pinned only when the card said "phone". Every host that can
  // scroll the form puts it below the fold — the card's list, the phone sheet,
  // and the expanded view, which caps the form at 70dvh — so the editor solves
  // it once for all of them instead of each host growing a footer of its own.
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

  it('sends set and unset so a removed key is actually cleared', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', custom_fields: { serial: 'x', gone: 'y' } }));
    const saves = onSave(el);

    const rows = all(el, '[data-testid="editor-cf-row"]');
    (rows[1].querySelector('[data-testid="editor-cf-remove"]') as HTMLButtonElement).click();
    await el.updateComplete;

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0].changes?.custom_fields_set).toEqual({ serial: 'x' });
    expect(saves[0].changes?.custom_fields_unset).toEqual(['gone']);
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
  it('hides the rarely-used half behind one More fields disclosure', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });

    // Primary fields stay visible...
    expect(q(el, '[data-testid="editor-name"]')).toBeTruthy();
    expect(q(el, '[data-testid="editor-tags"]')).toBeTruthy();
    // ...the rest is collapsed, not dropped.
    expect(q(el, '[data-testid="editor-description"]')).toBe(null);
    expect(q(el, '[data-testid="editor-cf-add"]')).toBe(null);

    (q(el, '[data-testid="editor-more-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-description"]')).toBeTruthy();
    expect(q(el, '[data-testid="editor-cf-add"]')).toBeTruthy();
    expect(q(el, '[data-testid="editor-inspection-date"]')).toBeTruthy();
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the toggle in reading order.
  it('names what More fields discloses, open or shut', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });
    const toggle = () => q(el, '[data-testid="editor-more-toggle"]') as HTMLButtonElement;
    const id = 'editor-more-fields';

    expect(toggle().getAttribute('aria-controls')).toBe(id);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // The id has to resolve in both states — a toggle pointing at nothing
    // announces as controlling nothing — so the holder outlives the fields.
    const shut = el.shadowRoot?.getElementById(id);
    expect(shut, 'holder shut').toBeTruthy();
    expect(shut?.children, 'no fields while shut').toHaveLength(0);

    toggle().click();
    await el.updateComplete;

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(id);
    const open = el.shadowRoot?.getElementById(id);
    expect(open?.querySelector('[data-testid="editor-description"]'), 'fields open inside it').toBeTruthy();
  });

  it('summarises what is inside the disclosure', async () => {
    const el = await mount(
      makeItem({ id: '1', name: 'A', description: 'x', due_date: '2026-07-31', custom_fields: { k: 1 } }),
      { mobile: true },
    );
    expect(q(el, '[data-testid="editor-more-toggle"]')?.textContent).toContain('description · dates · 1 custom');
  });

  it('names a reminder in the summary rather than folding it into "dates"', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', reminder_date: '2026-09-01' }), {
      mobile: true,
    });
    expect(q(el, '[data-testid="editor-more-toggle"]')?.textContent).toContain('reminder');
  });
});

describe('hv-item-editor: dirty tracking', () => {
  it('reports clean until something changes', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect(el.dirty).toBe(false);
    await type(el, 'editor-name', 'B');
    expect(el.dirty).toBe(true);
  });

  it('resets when a different item is loaded in', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    await type(el, 'editor-name', 'B');
    expect(el.dirty).toBe(true);

    el.item = makeItem({ id: '2', name: 'C' });
    await el.updateComplete;
    expect(el.dirty).toBe(false);
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
    el.shadowRoot
      ?.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(cancelled).toBe(true);
  });

  it('focuses the name field for a new item too', async () => {
    const el = await mount(null);
    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="editor-name"]'));
  });
});

// Escape-to-close-a-dropdown is muscle memory; here it used to cost the whole
// form, dropdown and typing together.
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
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);
    await type(el, 'editor-name', 'A longer name');
    expect(el.dirty).toBe(true);

    esc(el);
    await el.updateComplete;

    const guard = await dialog(el, 'editor-discard-confirm');
    expect(guard.open).toBe(true);
    expect(cancels.count).toBe(0);

    (guard.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(cancels.count).toBe(1);
  });




});

// Escape asked and the two buttons beside it did not, so the same decision had
// a cheap way out and an expensive one depending on which control was nearest.
describe('hv-item-editor: every close this form owns asks the same question', () => {
  const paths = ['editor-cancel', 'editor-close'] as const;

  it.each(paths)('%s asks before throwing typed edits away', async (testid) => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });
    await type(el, 'editor-name', 'A longer name');

    (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
    await el.updateComplete;

    const guard = await dialog(el, 'editor-discard-confirm');
    expect(guard.open).toBe(true);
    expect(guard.shadowRoot?.querySelector('[data-testid="confirm-message"]')?.textContent).toContain(
      discardPrompt().message,
    );
    expect(cancels).toBe(0);

    (guard.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(cancels).toBe(1);
  });

  it.each(paths)('%s keeps the typing when the question is declined', async (testid) => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });
    await type(el, 'editor-name', 'A longer name');

    (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
    await el.updateComplete;
    const guard = await dialog(el, 'editor-discard-confirm');
    (guard.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(cancels).toBe(0);
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('A longer name');
  });

  it.each(paths)('%s closes a clean form without asking', async (testid) => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
    await el.updateComplete;

    expect(cancels).toBe(1);
    expect((await dialog(el, 'editor-discard-confirm')).open).toBe(false);
  });

  // A host with somewhere to go afterwards asks this instead of firing `cancel`
  // blind: false means the form has taken the question on itself.
  it('reports whether a host may tear the form down', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect(el.requestClose()).toBe(true);

    await type(el, 'editor-name', 'A longer name');
    expect(el.requestClose()).toBe(false);
    await el.updateComplete;
    expect((await dialog(el, 'editor-discard-confirm')).open).toBe(true);
  });

  // Both dialogs are fixed to the window, so they take their phone form from the
  // viewport — the form's own `mobile` is the card element's width and would put
  // a bottom sheet on a desktop monitor whenever the card sat in a narrow column.
  it.each(['editor-discard-confirm', 'editor-remove-confirm'] as const)(
    '%s takes its phone form from the viewport, not the card',
    async (confirmId) => {
      for (const narrow of [true, false]) {
        const restore = stubViewport(narrow);
        try {
          const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: !narrow });
          expect((await dialog(el, confirmId)).hasAttribute('mobile')).toBe(narrow);
          el.remove();
        } finally {
          restore();
        }
      }
    },
  );
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
    expect(saves[0].create?.location_id).toBe('loc-new');
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

describe('hv-item-editor: pictures', () => {
  /** Drive the hidden file input the way a picker does. */
  function pick(el: HVItemEditor, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const png = (name = 'photo.png') => new File(['x'], name, { type: 'image/png' });

  const CONFIG = {
    picture_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    max_pictures_per_item: 2,
    max_attachment_bytes: 16,
  };

  it('shows no pictures section while creating an item', async () => {
    // An attachment is filed against an item id, and a new item has none.
    const el = await mount(null, { media: makeMediaBindings() });

    expect(q(el, '[data-testid="editor-photos"]')).toBeNull();
  });

  it('renders each attached picture with a remove button', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', name: 'Drill', attachments: [makeAttachment({ id: 'att-1' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);
    expect(q(el, '[data-testid="editor-photo-remove"]')?.getAttribute('aria-label')).toBe(
      'Remove Photo of Drill',
    );
  });

  // The tile is ~90px and the lightbox behind it is what shows the picture, so
  // the form asks the backend for the small form of every photo it lists.
  it('draws its picture tiles from the row-tile variant', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', name: 'Drill', attachments: [makeAttachment({ id: 'att-1' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    await el.updateComplete;

    const img = el.shadowRoot?.querySelector('[data-testid="editor-photo"] img');
    expect(img?.getAttribute('src')).toContain(`${MEDIA_SIZE_PARAM}=thumb`);
  });

  it('uploads a picked file and adopts the version the backend came back with', async () => {
    const media = makeMediaBindings({
      upload: async (itemId) =>
        makeItem({ id: itemId, version: 7, attachments: [makeAttachment({ id: 'att-new' })] }),
    });
    const el = await mount(makeItem({ id: 'i-1', version: 3 }), { media });

    pick(el, [png()]);
    // A macrotask, so the whole prepare-then-send chain drains first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
    expect(media.uploads[0].itemId).toBe('i-1');

    // The next save must carry the post-upload version, or the backend answers
    // `conflict` against a version the upload already moved past.
    const saves: CustomEvent[] = [];
    el.addEventListener('save', (e) => saves.push(e as CustomEvent));
    q(el, '[data-testid="editor-save"]')?.click();
    expect(saves[0].detail.expectedVersion).toBe(7);
  });

  it('renders per-file error text and leaves the other files alone', async () => {
    let seen = 0;
    const media = makeMediaBindings({
      upload: async (itemId) => {
        seen += 1;
        if (seen === 1) throw new Error('That file is not an image.');
        return makeItem({ id: itemId, version: 5 });
      },
    });
    const el = await mount(makeItem({ id: 'i-1', version: 1 }), { media });

    pick(el, [png('bad.png'), png('good.png')]);
    // A macrotask, so the whole sequential queue drains before the assertion.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const entries = all(el, '[data-testid="editor-upload"]');
    // The failed one stays with its message; the one that succeeded is gone.
    expect(entries).toHaveLength(1);
    expect(entries[0].dataset.state).toBe('error');
    expect(entries[0].textContent).toContain('bad.png');
    expect(entries[0].textContent).toContain('That file is not an image.');
    expect(media.uploads.map((u) => u.file.name)).toEqual(['bad.png', 'good.png']);
  });

  it('refuses an oversized file before it is sent', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [new File(['x'.repeat(64)], 'huge.png', { type: 'image/png' })]);
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('over the');
  });

  it('refuses a type the backend does not accept before it is sent', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [new File(['x'], 'drawing.svg', { type: 'image/svg+xml' })]);
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('not an accepted image');
  });

  it('refuses a file past the per-item cap before it is sent', async () => {
    const media = makeMediaBindings();
    const el = await mount(
      makeItem({
        id: 'i-1',
        attachments: [makeAttachment({ id: 'a' }), makeAttachment({ id: 'b' })],
      }),
      { media, mediaConfig: CONFIG },
    );

    pick(el, [png()]);
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('2 photos is the limit');
  });

  // Deleting an attachment destroys the only copy of the file, so it asks —
  // like every other destructive action on the card.
  it('removes a picture once the guard is answered, and adopts the returned item', async () => {
    const media = makeMediaBindings({
      remove: async (itemId) => makeItem({ id: itemId, version: 9, attachments: [] }),
    });
    const el = await mount(
      makeItem({ id: 'i-1', version: 4, attachments: [makeAttachment({ id: 'att-1' })] }),
      { media },
    );
    await el.updateComplete;

    (q(el, '[data-testid="editor-photo-remove"]') as HTMLButtonElement).click();
    await el.updateComplete;
    // Nothing is sent on the press itself.
    expect(media.removals).toEqual([]);
    expect((await dialog(el, 'editor-remove-confirm')).open).toBe(true);

    (
      (await dialog(el, 'editor-remove-confirm')).shadowRoot?.querySelector(
        '[data-testid="confirm-accept"]',
      ) as HTMLButtonElement
    ).click();
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.removals).toEqual([{ itemId: 'i-1', attachmentId: 'att-1' }]);
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(0);
  });

  it('keeps the picture when the guard is dismissed', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), {
      media,
    });
    await el.updateComplete;

    await removeAttachment(el, 'editor-photo-remove', 'cancel');
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    expect(media.removals).toEqual([]);
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);
  });

  // The guard sits outside the form's own event scope: a host closes the editor
  // on `cancel`, and answering "no, keep the photo" is not that.
  it('keeps its guard events to itself', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    await removeAttachment(el, 'editor-photo-remove', 'cancel');
    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    expect(cancels).toBe(0);
  });

  it('offers the camera from the same control that picks a file', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), {
      media: makeMediaBindings(),
      mediaConfig: CONFIG,
    });

    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.multiple).toBe(true);
    expect(input.getAttribute('accept')).toBe(CONFIG.picture_mime_types.join(','));
  });

  it('shows a placeholder rather than a broken image when signing fails', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }),
      { media: makeMediaBindings({ signFails: true }) },
    );
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    expect(q(el, '[data-testid="editor-photo-placeholder"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="editor-photo"] img')).toBeNull();
  });
});

describe('hv-item-editor: documents', () => {
  /** Drive the hidden document input the way a picker does. */
  function pick(el: HVItemEditor, files: File[]) {
    const input = q(el, '[data-testid="editor-manual-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const pdf = (name = 'manual.pdf') => new File(['x'], name, { type: 'application/pdf' });

  const CONFIG = {
    picture_mime_types: ['image/png'],
    max_pictures_per_item: 4,
    manual_mime_types: ['application/pdf'],
    max_manuals_per_item: 1,
    max_attachment_bytes: 16,
  };

  it('shows no documents section while creating an item', async () => {
    const el = await mount(null, { media: makeMediaBindings() });

    expect(q(el, '[data-testid="editor-documents"]')).toBeNull();
  });

  it('lists the manuals and leaves the pictures to the strip above', async () => {
    const el = await mount(
      makeItem({
        id: 'i-1',
        attachments: [makeAttachment({ id: 'p-1' }), makeManual({ id: 'm-1' })],
      }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    expect(all(el, '[data-testid="editor-document"]')).toHaveLength(1);
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);
  });

  it('uploads a picked file as a manual, not as a picture', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [pdf()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
    expect(media.uploads[0].kind).toBe('manual');
  });

  // A document comes off the file system; pointing the control at the camera
  // would put a photo of a page where the PDF should be.
  it('accepts documents only and never opens the camera', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), {
      media: makeMediaBindings(),
      mediaConfig: CONFIG,
    });

    const input = q(el, '[data-testid="editor-manual-input"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('application/pdf');
    expect(input.getAttribute('capture')).toBeNull();
  });

  it('refuses a document past its own per-item cap, not the photo one', async () => {
    const media = makeMediaBindings();
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }),
      { media, mediaConfig: CONFIG },
    );

    pick(el, [pdf()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('1 documents is the limit');
  });

  it('refuses a type the backend does not accept as a document', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain(
      'not an accepted document type',
    );
  });

  it('sends a document cap the config never mentioned to the backend to judge', async () => {
    // An older backend reports no document cap. Guessing one here would refuse
    // a file the server would have taken.
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }), {
      media,
      mediaConfig: { picture_mime_types: ['image/png'], max_pictures_per_item: 4, max_attachment_bytes: 16 },
    });

    pick(el, [pdf()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
  });

  it('retitles a document on change and adopts the item that comes back', async () => {
    const media = makeMediaBindings({
      retitle: async (itemId) =>
        makeItem({
          id: itemId,
          version: 6,
          attachments: [makeManual({ id: 'm-1', title: 'Dishwasher manual' })],
        }),
    });
    const el = await mount(
      makeItem({ id: 'i-1', version: 5, attachments: [makeManual({ id: 'm-1' })] }),
      { media },
    );
    await el.updateComplete;

    const field = q(el, '[data-testid="editor-document-title"]') as HTMLInputElement;
    field.value = '  Dishwasher manual  ';
    field.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.retitles).toEqual([
      { itemId: 'i-1', attachmentId: 'm-1', title: 'Dishwasher manual' },
    ]);
    // The retitle bumped the version, so the next save must carry the new one.
    const saves: CustomEvent[] = [];
    el.addEventListener('save', (e) => saves.push(e as CustomEvent));
    q(el, '[data-testid="editor-save"]')?.click();
    expect(saves[0].detail.expectedVersion).toBe(6);
  });

  it('shows the filename as the placeholder for an untitled document', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1', filename: 'scan_0142.pdf' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    const field = q(el, '[data-testid="editor-document-title"]') as HTMLInputElement;
    expect(field.getAttribute('placeholder')).toBe('scan_0142.pdf');
    expect(field.value).toBe('');
  });

  it('removes a document and adopts the returned item', async () => {
    const media = makeMediaBindings({
      remove: async (itemId) => makeItem({ id: itemId, version: 9, attachments: [] }),
    });
    const el = await mount(
      makeItem({ id: 'i-1', version: 4, attachments: [makeManual({ id: 'm-1' })] }),
      { media },
    );
    await el.updateComplete;

    await removeAttachment(el, 'editor-document-remove', 'confirm');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.removals).toEqual([{ itemId: 'i-1', attachmentId: 'm-1' }]);
    expect(all(el, '[data-testid="editor-document"]')).toHaveLength(0);
  });

  it('names the document in the guard, not the photo copy', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    (q(el, '[data-testid="editor-document-remove"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const guard = await dialog(el, 'editor-remove-confirm');

    expect(guard.shadowRoot?.querySelector('h2')?.textContent).toContain('document');
    expect(guard.shadowRoot?.querySelector('[data-testid="confirm-message"]')?.textContent).toContain(
      'deleted',
    );
  });

  it('names the file that failed rather than the section it came from', async () => {
    const media = makeMediaBindings({
      upload: async () => {
        throw new Error('That file is not a PDF.');
      },
    });
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    pick(el, [pdf('broken.pdf')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const entry = q(el, '[data-testid="editor-upload"]');
    expect(entry?.textContent).toContain('broken.pdf');
    expect(entry?.textContent).toContain('That file is not a PDF.');
  });
});

describe('hv-item-editor: opening a document', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serve(status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
  }

  // The detail sheet's read view is a phone surface; on a desktop this form is
  // the only place a manual is reachable at all.
  it('offers each document as a link to the signed URL', async () => {
    serve(206);
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1', title: 'Warranty' })] }),
      { media: makeMediaBindings() },
    );
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    const open = q(el, '[data-testid="editor-document-open"]') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe(
      `/api/haventory/media/i-1/m-1?${MEDIA_NAME_TOKEN_PARAM}=`
        + `${attachmentNameToken(makeManual({ id: 'm-1', title: 'Warranty' }))}&authSig=test`,
    );
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('aria-label')).toBe('Open Warranty');
  });

  it('replaces the link with the missing state when the file is gone', async () => {
    serve(404);
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }),
      { media: makeMediaBindings() },
    );
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(q(el, '[data-testid="editor-document-missing"]')).toBeTruthy();
    expect(q(el, '[data-testid="editor-document-open"]')).toBeNull();
    // The title stays editable: the metadata is still the item's to correct.
    expect(q(el, '[data-testid="editor-document-title"]')).toBeTruthy();
  });
});

describe('hv-item-editor: photo order and the cover', () => {
  function pick(el: HVItemEditor, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const png = (name = 'photo.png') => new File(['x'], name, { type: 'image/png' });

  const three = () => [
    makeAttachment({ id: 'a', order: 0 }),
    makeAttachment({ id: 'b', order: 1 }),
    makeAttachment({ id: 'c', order: 2 }),
  ];

  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('marks the first photo as the cover and offers no control to re-cover it', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    // One inert mark, on the photo the list row and detail header already show.
    expect(all(el, '[data-testid="editor-photo-cover"]')).toHaveLength(1);
    expect(all(el, '[data-testid="editor-photo-make-cover"]')).toHaveLength(2);
  });

  it('makes a photo the cover by moving it to position 0', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), { media });
    await el.updateComplete;

    all(el, '[data-testid="editor-photo-make-cover"]')[1].click();
    await drain();

    expect(media.reorders).toEqual([
      { itemId: 'i-1', kind: 'picture', attachmentIds: ['c', 'a', 'b'] },
    ]);
  });

  it('moves one photo a single place and names the whole order', async () => {
    // The backend refuses anything but a full permutation of the kind.
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), { media });
    await el.updateComplete;

    all(el, '[data-testid="editor-photo-later"]')[0].click();
    await drain();

    expect(media.reorders[0].attachmentIds).toEqual(['b', 'a', 'c']);
  });

  it('offers no move past either end', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    const earlier = all(el, '[data-testid="editor-photo-earlier"]') as HTMLButtonElement[];
    const later = all(el, '[data-testid="editor-photo-later"]') as HTMLButtonElement[];
    expect([earlier[0].disabled, earlier[2].disabled]).toEqual([true, false]);
    expect([later[0].disabled, later[2].disabled]).toEqual([false, true]);
  });

  it('shows no ordering controls for a single photo', async () => {
    // Nothing to order, and a lone photo is the cover by definition.
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'a' })] }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-photo-earlier"]')).toBeNull();
    expect(q(el, '[data-testid="editor-photo-cover"]')).toBeNull();
  });

  it('reports a refused reorder rather than leaving the strip silently unmoved', async () => {
    const media = makeMediaBindings({
      reorder: async () => {
        throw new Error('version conflict');
      },
    });
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), { media });
    await el.updateComplete;

    all(el, '[data-testid="editor-photo-later"]')[0].click();
    await drain();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('version conflict');
  });

  it('sends the failed file again on retry, without asking for it twice', async () => {
    // On a phone the original came from the camera and was never on disk, so
    // "pick it again" means retaking the photo.
    let attempts = 0;
    const media = makeMediaBindings({
      upload: async (itemId) => {
        attempts += 1;
        if (attempts === 1) throw new Error('Upload failed (503)');
        return makeItem({ id: itemId, version: 9 });
      },
    });
    const el = await mount(makeItem({ id: 'i-1', version: 2 }), { media });

    pick(el, [png('shelf.png')]);
    await drain();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-upload"]')?.dataset.state).toBe('error');

    q(el, '[data-testid="editor-upload-retry"]')?.click();
    await drain();
    await el.updateComplete;

    expect(media.uploads).toHaveLength(2);
    expect(media.uploads[1].file.name).toBe('shelf.png');
    // The entry clears once it lands, like any other successful upload.
    expect(q(el, '[data-testid="editor-upload"]')).toBeNull();
  });

  it('offers no retry for a failure that has no file behind it', async () => {
    const media = makeMediaBindings({
      remove: async () => {
        throw new Error('gone already');
      },
    });
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'a' })] }), {
      media,
    });
    await el.updateComplete;

    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    await drain();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('gone already');
    expect(q(el, '[data-testid="editor-upload-retry"]')).toBeNull();
  });
});

describe('hv-item-editor: shrinking a photo before it is sent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** jsdom has no image decoder and no 2D context; both are the seam. */
  function stubCanvas(encodedBytes: number) {
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 4032,
      height: 3024,
      close: () => undefined,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => undefined,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      callback(new Blob([new Uint8Array(encodedBytes)], { type }));
    });
  }

  function pick(el: HVItemEditor, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  function oversized(): File {
    const f = new File(['x'], 'IMG_0042.jpg', { type: 'image/jpeg' });
    Object.defineProperty(f, 'size', { value: 4 * 1024 * 1024 });
    return f;
  }

  const CONFIG = {
    picture_mime_types: ['image/jpeg'],
    max_pictures_per_item: 4,
    max_attachment_bytes: 1024,
  };

  // The whole point of the pass: a phone frame is several times the cap, so
  // without this the most ordinary way to add a photo is the one that fails.
  it('measures the cap against the shrunk file, so an oversized photo lands', async () => {
    stubCanvas(512);
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [oversized()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
    expect(media.uploads[0].file.size).toBe(512);
    expect(q(el, '[data-testid="editor-upload"]')).toBeNull();
  });

  it('still refuses a photo the shrink could not bring under the cap', async () => {
    stubCanvas(4096);
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [oversized()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('over the');
  });

  it('never re-encodes a document', async () => {
    stubCanvas(512);
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });
    const pdf = new File(['x'], 'manual.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 4 * 1024 * 1024 });

    const input = q(el, '[data-testid="editor-manual-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [pdf], configurable: true });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads[0].file).toBe(pdf);
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

  // On a phone the description lives behind the More fields disclosure, so the
  // refresh has to leave that open too or the typing survives out of sight.
  it('leaves the mobile disclosure open around the text it holds', async () => {
    const el = await mount(makeItem({ id: 'i-1', name: 'Drill', version: 3 }), { mobile: true });
    (q(el, '[data-testid="editor-more-toggle"]') as HTMLButtonElement).click();
    await el.updateComplete;
    await type(el, 'editor-description', 'typed on a phone');

    await refreshed(el, { version: 4 });

    expect((q(el, '[data-testid="editor-description"]') as HTMLInputElement)?.value).toBe(
      'typed on a phone',
    );
    expect(q(el, '[data-testid="editor-more-toggle"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('adopts the attachments the refreshed item carries', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', name: 'Drill', version: 3, attachments: [makeAttachment({ id: 'att-1' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);

    await refreshed(el, {
      version: 4,
      attachments: [makeAttachment({ id: 'att-1' }), makeAttachment({ id: 'att-2' })],
    });
    await el.updateComplete;

    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(2);
  });

  // The prop is the fresher copy the moment it reaches the version an upload
  // returned; saving against the older one would come back `conflict`.
  it('saves against the refreshed item once it has caught up with an upload', async () => {
    const media = makeMediaBindings({
      upload: async (itemId) => makeItem({ id: itemId, version: 7 }),
    });
    const el = await mount(makeItem({ id: 'i-1', name: 'Drill', version: 3 }), { media });

    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'photo.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const saves = onSave(el);
    q(el, '[data-testid="editor-save"]')?.click();
    expect(saves[0].expectedVersion).toBe(7);

    await refreshed(el, { version: 9 });
    q(el, '[data-testid="editor-save"]')?.click();
    expect(saves[1].expectedVersion).toBe(9);
  });

  it('rebuilds the form when the create form saves into a real item', async () => {
    const el = await mount(null);
    await type(el, 'editor-name', 'Drill');
    expect(el.dirty).toBe(true);

    await refreshed(el, { version: 1 });

    expect(el.dirty).toBe(false);
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('Drill');
  });
});

describe('hv-item-editor: upload errors outlive their siblings', () => {
  function pick(el: HVItemEditor, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const png = (name: string) => new File(['x'], name, { type: 'image/png' });

  /** Refuses anything named "broken", takes everything else. */
  async function mountWithOneRefusal() {
    const media = makeMediaBindings({
      upload: async (itemId, file) => {
        if (file.name.includes('broken')) {
          throw new Error('file content is not one of the accepted types');
        }
        return makeItem({ id: itemId, version: 5 });
      },
    });
    const el = await mount(makeItem({ id: 'i-1', version: 1 }), { media });

    pick(el, [png('broken.jpg'), png('photo-3-landscape.jpg')]);
    // A macrotask, so the whole sequential queue drains before the assertion.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The sibling's success reaches the card as a broadcast, and the host hands
    // the still-open editor a fresh object for the same item.
    el.item = makeItem({ id: 'i-1', version: 5 });
    await el.updateComplete;
    return el;
  }

  it('keeps the refused file reported after the item refreshes', async () => {
    const el = await mountWithOneRefusal();

    const entries = all(el, '[data-testid="editor-upload"]');
    expect(entries).toHaveLength(1);
    expect(entries[0].dataset.state).toBe('error');
    expect(entries[0].textContent).toContain('broken.jpg');
    expect(entries[0].textContent).toContain('not one of the accepted types');
    expect(q(el, '[data-testid="editor-upload-retry"]')).toBeTruthy();
  });

  it('clears exactly the row whose dismiss was pressed', async () => {
    const el = await mountWithOneRefusal();
    pick(el, [png('also-broken.jpg')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(all(el, '[data-testid="editor-upload"]')).toHaveLength(2);

    (all(el, '[data-testid="editor-upload-dismiss"]')[0] as HTMLButtonElement).click();
    await el.updateComplete;

    const left = all(el, '[data-testid="editor-upload"]');
    expect(left).toHaveLength(1);
    expect(left[0].textContent).toContain('also-broken.jpg');
  });

  // Nothing else clears the queue any more, so a row with no Retry — a failed
  // reorder or removal — would otherwise stay for the life of the form.
  it('offers a dismiss on an error row that carries no file to retry', async () => {
    const media = makeMediaBindings({
      remove: async () => {
        throw new Error('gone already');
      },
    });
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }),
      { media },
    );
    await el.updateComplete;

    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    for (let i = 0; i < 4; i += 1) await el.updateComplete;
    expect(q(el, '[data-testid="editor-upload-retry"]')).toBeNull();

    (q(el, '[data-testid="editor-upload-dismiss"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-upload"]')).toBeNull();
  });
});

// A multi-MB photo on a phone connection renders as one static word for twenty
// seconds unless something moves, and the queue that reported it sat two
// sections below the grid the user was watching.
describe('hv-item-editor: the upload queue reports where the work is', () => {
  function pick(el: HVItemEditor, testid: string, files: File[]) {
    const input = q(el, `[data-testid="${testid}"]`) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  /** Hold the upload open so the queue can be inspected mid-flight. */
  function stalledMedia() {
    return makeMediaBindings({ upload: () => new Promise<Item>(() => {}) });
  }

  it('files each queue under the section that started it', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: stalledMedia() });
    await el.updateComplete;

    pick(el, 'editor-photo-input', [new File(['x'], 'shelf.png', { type: 'image/png' })]);
    pick(el, 'editor-manual-input', [new File(['x'], 'manual.pdf', { type: 'application/pdf' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const lists = all(el, '[data-testid="editor-upload-list"]');
    expect(lists.map((l) => l.dataset.kind)).toEqual(['picture', 'manual']);
    expect(lists[0].textContent).toContain('shelf.png');
    expect(lists[0].textContent).not.toContain('manual.pdf');
    expect(lists[1].textContent).toContain('manual.pdf');
    // Each list sits inside the section whose picker filled it.
    expect(lists[0].closest('.cell')?.querySelector('[data-testid="editor-photos"]')).toBeTruthy();
    expect(lists[1].closest('.cell')?.querySelector('[data-testid="editor-documents"]')).toBeTruthy();
  });

  it('moves something while a file is in flight, and stops when it fails', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: stalledMedia() });
    await el.updateComplete;

    pick(el, 'editor-photo-input', [new File(['x'], 'shelf.png', { type: 'image/png' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const row = q(el, '[data-testid="editor-upload"]') as HTMLElement;
    expect(row.dataset.state).toBe('uploading');
    const bar = q(el, '[data-testid="editor-upload-progress"]') as HTMLElement;
    expect(bar).toBeTruthy();
    // Indeterminate on purpose: the WebSocket path reports no bytes sent, so
    // the bar must not carry a value it would have to invent.
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('drops the indicator once the row is an error someone has to read', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), {
      media: makeMediaBindings({
        upload: async () => {
          throw new Error('file content is not one of the accepted types');
        },
      }),
    });
    await el.updateComplete;

    pick(el, 'editor-photo-input', [new File(['x'], 'broken.jpg', { type: 'image/png' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect((q(el, '[data-testid="editor-upload"]') as HTMLElement).dataset.state).toBe('error');
    expect(q(el, '[data-testid="editor-upload-progress"]')).toBe(null);
  });

});

describe('hv-item-editor: touch targets and the shared tally', () => {

  // The count beside a facet is declared once, in the shared sheet.
  it('prices its custom fields with the shared tally', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect(q(el, '[data-testid="editor-cf-tally"]')?.classList.contains('hv-tally')).toBe(true);
  });
});

// The create form has no PHOTOS section at all — an upload is filed against an
// item id and there is none yet. Unexplained, that reads as a missing feature.
describe('hv-item-editor: why attachments wait for the first save', () => {
  it('says so where the photo grid will be', async () => {
    const el = await mount(null, { media: makeMediaBindings() });

    expect(q(el, '[data-testid="editor-photos"]')).toBe(null);
    expect(q(el, '[data-testid="editor-attachment-hint"]')?.textContent).toContain('Save the item first');
  });

  it('says nothing once the sections are actually there', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-attachment-hint"]')).toBe(null);
    expect(q(el, '[data-testid="editor-photos"]')).toBeTruthy();
  });

  // A host that hands over no media bindings offers no attachments at any
  // point, so there is nothing to explain the absence of.
  it('stays quiet when the card carries no attachment support at all', async () => {
    const el = await mount(null);

    expect(q(el, '[data-testid="editor-attachment-hint"]')).toBe(null);
  });
});

// jsdom builds a `DragEvent` with no `DataTransfer` behind it, so the files ride
// on a plain object. What is worth asserting here is the routing — which kind
// each dropped file becomes, and that nothing new appears on the upload path.
// The browser's own drag machinery is the handover's job.
describe('hv-item-editor: dropping files onto the editor', () => {
  const png = (name = 'photo.png') => new File(['x'], name, { type: 'image/png' });
  const pdf = (name = 'manual.pdf') => new File(['x'], name, { type: 'application/pdf' });

  function dragEvent(type: string, files: File[]) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', {
      value: { files, dropEffect: 'none' },
      configurable: true,
    });
    return e as DragEvent;
  }

  async function dropOn(el: HVItemEditor, testid: string, files: File[]) {
    const target = q(el, `[data-testid="${testid}"]`) as HTMLElement;
    target.dispatchEvent(dragEvent('drop', files));
    // A macrotask, so the prepare-then-send chain drains first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }

  it('attaches an image dropped on the photo strip as a photo', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-photos', [png()]);

    expect(media.uploads.map((u) => [u.file.name, u.kind])).toEqual([['photo.png', 'picture']]);
  });

  it('attaches a document dropped on the document list as a manual', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-documents', [pdf()]);

    expect(media.uploads.map((u) => [u.file.name, u.kind])).toEqual([['manual.pdf', 'manual']]);
  });

  // The file decides, not the cell it crossed: refusing a PDF because it landed
  // on the photo strip would be arguing with something the user can see.
  it('attaches a document dropped on the photo strip as a manual', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-photos', [pdf()]);

    expect(media.uploads.map((u) => u.kind)).toEqual(['manual']);
  });

  it('attaches an image dropped on the document list as a photo', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-documents', [png()]);

    expect(media.uploads.map((u) => u.kind)).toEqual(['picture']);
  });

  it('routes a mixed multi-file drop file by file', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-photos', [png('a.png'), pdf('b.pdf'), png('c.png')]);

    expect(media.uploads.map((u) => [u.file.name, u.kind])).toEqual([
      ['a.png', 'picture'],
      ['c.png', 'picture'],
      ['b.pdf', 'manual'],
    ]);
  });

  // The existing preflight is the one place that knows what the backend takes,
  // so a refused file is refused in the same words a picked one would be.
  it('sends a dropped file through the same preflight a picked one gets', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), {
      media,
      mediaConfig: {
        picture_mime_types: ['image/png'],
        manual_mime_types: ['application/pdf'],
        max_attachment_bytes: 16,
      } as HVItemEditor['mediaConfig'],
    });

    await dropOn(el, 'editor-documents', [new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('not an accepted');
  });

  it('cancels dragover so the browser does not navigate to the file', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
    const over = dragEvent('dragover', [png()]);

    (q(el, '[data-testid="editor-photos"]') as HTMLElement).dispatchEvent(over);

    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe('copy');
  });

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

  it('marks the section a drag is over, and unmarks it on the way out', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
    const photos = q(el, '[data-testid="editor-photos"]') as HTMLElement;

    photos.dispatchEvent(dragEvent('dragover', [png()]));
    await el.updateComplete;
    expect(photos.classList.contains('dropping')).toBe(true);

    photos.dispatchEvent(new Event('dragleave', { bubbles: true }));
    await el.updateComplete;
    expect(photos.classList.contains('dropping')).toBe(false);
  });

  // There is no drag on touch, so an over-state could only ever fire by accident
  // — the phone layout carries no target at all rather than one that declines.
  // The root guard stays: `mobile` is the card element's width, and a narrow
  // card in a desktop window still has a mouse with a file on the end of it.
  it('renders no drop target on a phone', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mobile: true });
    const photos = q(el, '[data-testid="editor-photos"]') as HTMLElement;

    photos.dispatchEvent(dragEvent('dragover', [png()]));
    await dropOn(el, 'editor-photos', [png()]);

    expect(photos.classList.contains('dropping')).toBe(false);
    expect(media.uploads).toHaveLength(0);
  });
});

// The form was authored for a 600–900px card and then given a 1080p surface to
// fill. Everything below is a measurement that stopped being true there.
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

  // A note riding inside a label needs to step out of the uppercase treatment;
  // it did that with the file's only inline style attribute.
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

// "Checkout" above a button reading "Check out…", in a card that says "Check
// out" everywhere else.
describe('hv-item-editor: one verb for checking out', () => {
  it('heads the box with the verb its own button uses', async () => {
    const el = await mount(makeItem({ id: '1' }));
    expect(q(el, '[data-testid="editor-checkout-caption"]')?.textContent?.trim()).toBe('Check out');
    expect(q(el, '[data-testid="editor-checked-out"]')?.textContent).toContain('Check out');
  });
});

// The form's thumbnails were 72px squares of a photo and nothing more: the
// lightbox existed on the phone's detail sheet and nowhere else, so on the card
// and the expanded view there was no way to see a photo at a useful size.
describe('hv-item-editor: photos open full-size', () => {
  const shots = () => [makeAttachment({ id: 'att-1' }), makeAttachment({ id: 'att-2' })];

  async function withPhotos() {
    const el = await mount(makeItem({ id: 'i-1', name: 'Drill', attachments: shots() }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;
    await el.updateComplete;
    return el;
  }

  const box = (el: HVItemEditor) =>
    q(el, 'hv-lightbox')?.shadowRoot?.querySelector('[data-testid="lightbox"]') as HTMLElement | null;

  const settleBox = async (el: HVItemEditor) => {
    await settle(el);
    await q<HTMLElement & { updateComplete?: Promise<unknown> }>(el, 'hv-lightbox')?.updateComplete;
  };

  it('opens the photo that was clicked', async () => {
    const el = await withPhotos();

    (all(el, '[data-testid="editor-photo-open"]')[1] as HTMLButtonElement).click();
    await settleBox(el);
    await settleBox(el);

    expect(box(el)?.getAttribute('aria-label')).toBe('Drill — photo 2 of 2');
  });

  it('names each thumbnail for the photo it opens', async () => {
    const el = await withPhotos();
    expect(all(el, '[data-testid="editor-photo-open"]').map((b) => b.getAttribute('aria-label'))).toEqual([
      'View Drill — photo 1 of 2',
      'View Drill — photo 2 of 2',
    ]);
  });

  it('closes again and leaves the form standing', async () => {
    const el = await withPhotos();
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    (all(el, '[data-testid="editor-photo-open"]')[0] as HTMLButtonElement).click();
    await settleBox(el);
    await settleBox(el);
    (
      q(el, 'hv-lightbox')?.shadowRoot?.querySelector('[data-testid="lightbox-close"]') as HTMLButtonElement
    ).click();
    await settleBox(el);

    expect(box(el)).toBe(null);
    // Escape inside the lightbox must not read as Escape on the form.
    expect(cancels).toBe(0);
    expect(q(el, '[data-testid="item-editor"]')).toBeTruthy();
  });

  // Without a signed URL there is no photo to open, only the camera placeholder.
  it('offers nothing to open where the URL has not arrived', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: shots() }), { media: null });
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-photo-open"]')).toBe(null);
  });
});

describe('hv-item-editor: reminders', () => {
  const count = (el: HVItemEditor) =>
    q(el, '[data-testid="editor-reminder-count"]') as HTMLInputElement;
  const unit = (el: HVItemEditor) =>
    q(el, '[data-testid="editor-reminder-unit"]') as HTMLSelectElement;

  it('prefills a stored recurring reminder', async () => {
    const el = await mount(
      makeItem({
        id: '1',
        reminder_date: '2026-09-01',
        reminder_interval: { unit: 'months', count: 3 },
      }),
    );

    expect((q(el, '[data-testid="editor-reminder-date"]') as HTMLInputElement).value).toBe(
      '2026-09-01',
    );
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

    expect(saves[0].changes?.reminder_date).toBe('2026-09-01');
    expect(saves[0].changes?.reminder_interval).toEqual({ unit: 'months', count: 3 });
  });

  it('saves a date with no repeat as a one-off', async () => {
    const el = await mount(makeItem({ id: 'item-1', version: 3 }));
    const saves = onSave(el);

    await type(el, 'editor-reminder-date', '2026-09-01');
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0].changes?.reminder_date).toBe('2026-09-01');
    expect(saves[0].changes?.reminder_interval).toBe(null);
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

    expect(saves[0].changes?.reminder_date).toBe(null);
    // Not just left as it was: the backend refuses an interval with no anchor.
    expect(saves[0].changes?.reminder_interval).toBe(null);
  });

});

describe('hv-item-editor: the id an automation names', () => {
  const UUID = '0f2c4a11-6b3d-4a5e-9c8f-2d1e0b7a4c63';
  const copy = vi.mocked(copyText);
  const button = (el: HVItemEditor) => q<HTMLButtonElement>(el, '[data-testid="editor-copy-id"]')!;

  beforeEach(() => {
    copy.mockReset();
    copy.mockResolvedValue(true);
  });

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

  it('copies the id and says so once the copy has happened', async () => {
    const el = await mount(makeItem({ id: UUID }));
    expect(button(el).textContent?.trim()).toBe('Copy');

    button(el).click();
    await settle(el);

    expect(copy).toHaveBeenCalledWith(UUID);
    expect(button(el).textContent?.trim()).toBe('Copied');
  });

  // Home Assistant on the LAN over plain http:// is not a secure context, and
  // an old browser there has no fallback either. "Copied" would name whatever
  // was on the clipboard before, so the value stays on screen and unclaimed.
  it('claims nothing when the browser refused the copy', async () => {
    copy.mockResolvedValue(false);
    const el = await mount(makeItem({ id: UUID }));

    button(el).click();
    await settle(el);

    expect(button(el).textContent?.trim()).toBe('Copy');
  });

  it('goes back to offering the copy a couple of seconds later', async () => {
    const el = await mount(makeItem({ id: UUID }));
    vi.useFakeTimers();
    try {
      button(el).click();
      await settle(el);
      expect(button(el).textContent?.trim()).toBe('Copied');

      await vi.advanceTimersByTimeAsync(2500);
      await el.updateComplete;
      expect(button(el).textContent?.trim()).toBe('Copy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets it copied when the form moves to another item', async () => {
    const el = await mount(makeItem({ id: UUID }));
    button(el).click();
    await settle(el);

    el.item = makeItem({ id: 'i-8' });
    await settle(el);

    expect(q(el, '[data-testid="editor-id"]')?.textContent?.trim()).toBe('i-8');
    expect(button(el).textContent?.trim()).toBe('Copy');
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

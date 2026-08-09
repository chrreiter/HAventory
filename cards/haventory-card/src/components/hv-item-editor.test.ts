import './hv-item-editor';
import { makeAttachment, makeItem, makeManual, makeMediaBindings } from '../test.utils';
import { MEDIA_NAME_TOKEN_PARAM, attachmentNameToken } from '../ui/media';
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
  const el = document.createElement('hv-item-editor') as HVItemEditor;
  el.item = item;
  el.locationTree = tree;
  el.locations = [garage];
  el.categorySuggestions = ['Hardware', 'Tools'];
  el.tagSuggestions = ['metric', 'm4'];
  el.customFieldKeys = ['serial', 'warranty_until'];
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVItemEditor, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVItemEditor, sel: string) =>
  [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

/** jsdom lays out no shadow DOM, so layout rules are asserted on the sheet. */
const editorCss = () => {
  const styles = (customElements.get('hv-item-editor') as typeof HVItemEditor).styles;
  return (Array.isArray(styles) ? styles : [styles])
    .map((s) => String(s.cssText))
    .join('\n')
    .replace(/\s+/g, ' ');
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
    expect(q(el, '[data-testid="editor-due-date"]')?.closest('.cell')?.classList).toContain('muted');
    expect(q(el, '[data-testid="editor-due-hint"]')?.textContent?.trim()).toBe(
      'A due date applies while the item is checked out.',
    );
    expect(q(el, '[data-testid="editor-due-date"]')?.getAttribute('title')).toBe(
      'A due date applies while the item is checked out.',
    );

    await checkOut(el);
    expect(q(el, '[data-testid="editor-due-date"]')?.closest('.cell')?.classList).not.toContain('muted');
    expect(q(el, '[data-testid="editor-due-hint"]')).toBe(null);

    const styles = (customElements.get('hv-item-editor') as typeof HVItemEditor).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
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
      '31',
      '90',
    ]);

    const dateInput = () => q(el, '[data-testid="editor-inspection-date"]') as HTMLInputElement;
    (all(el, '[data-testid="editor-inspection-offset"]')[1] as HTMLButtonElement).click();
    await el.updateComplete;
    expect(dateInput().value).toBe(addDays(31));
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

  it('stacks the checkout box on a phone rather than halving a date field', () => {
    const styles = (customElements.get('hv-item-editor') as typeof HVItemEditor).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');

    // Half of a 375px screen, minus the box padding, is under the ~140px a
    // native date input needs before it clips its own placeholder.
    expect(css).toMatch(/\.checkout-body \{[^}]*grid-template-columns: 1fr 1fr/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.checkout-body \{[^}]*grid-template-columns: 1fr;/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.state \{[^}]*grid-template-columns: 1fr;/);
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
    expect(hint).toContain('Esc discards');
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

  // Same phone, turned sideways: 760px wide, so the mobile property is false
  // and the expanded view drew the hint again — on a screen with no keyboard.
  it('drops the keyboard hint on any touch screen, however wide', () => {
    const css = editorCss();
    const block = /@media \(hover: none\), \(pointer: coarse\) \{(.*?\})\s*\}/.exec(css)?.[1] ?? '';
    expect(block, 'no coarse-pointer block in the editor stylesheet').not.toBe('');
    expect(block).toMatch(/\.actions \.hint \{[^}]*display: none/);
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
    expect(/\.actions \.hint \{([^}]*)\}/.exec(editorCss())?.[1]).not.toContain('margin-left');
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
    expect(editorCss()).not.toMatch(/\.delete \{/);
  });

  it('surfaces a server-side failure without losing the form', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { errorMessage: 'Storage is full' });
    expect(q(el, '[data-testid="editor-error"]')?.textContent).toContain('Storage is full');
  });
});

describe('hv-item-editor: location and tags', () => {
  it('picks a location from a tree inside the form, never a second dialog', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    expect(q(el, '[data-testid="editor-location-tree"]')).toBe(null);

    (q(el, '[data-testid="editor-location"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const treeEl = el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    (
      treeEl.shadowRoot?.querySelector('[data-testid="tree-select"][data-id="garage"]') as HTMLButtonElement
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

    const styles = (customElements.get('hv-item-editor') as typeof HVItemEditor).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
    expect(css).toMatch(/\.list-holder\.floating \{[^}]*position: fixed/);
    // The location tree is the opposite case — it is *meant* to open the form.
    expect(css).toMatch(/\.tree-holder, \.list-holder \{[^}]*margin-top: 6px/);
    expect(css).not.toMatch(/\.tree-holder[^{]*\{[^}]*position: fixed/);
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

  it('keeps Save and Cancel in reach on a phone', async () => {
    const styles = (customElements.get('hv-item-editor') as typeof HVItemEditor).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');

    // Sticky has to sit on the wrapping cell: an element sticks only within its
    // containing block, and `.actions`' parent is exactly as tall as it is.
    expect(css).toMatch(/:host\(\[mobile\]\) \.actions-cell \{[^}]*position: sticky/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.actions-cell \{[^}]*bottom: -14px/);
    expect(css).not.toMatch(/:host\(\[mobile\]\) \.actions \{[^}]*position: sticky/);

    // ...and the markup has to carry the class the rule needs.
    const el = await mount(makeItem({ id: '1' }), { mobile: true });
    const cell = q(el, '.actions-cell');
    expect(cell).toBeTruthy();
    expect(cell?.querySelector('[data-testid="editor-save"]')).toBeTruthy();
    expect(cell?.querySelector('[data-testid="editor-cancel"]')).toBeTruthy();
  });

  it('lays a row out from its own width, not from the card-wide mobile flag', () => {
    const styles = (customElements.get('hv-item-editor') as typeof HVItemEditor).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');

    // The editor is a desktop row in one host and a phone sheet in another, so
    // `mobile` (which describes the card) must not decide this layout.
    expect(css).toMatch(/\.custom \{[^}]*container-type: inline-size/);
    expect(css).not.toMatch(/:host\(\[mobile\]\) \.cf-row/);
    // Wide enough: key, type, value and the remove button share one line. The
    // remove column tracks the inherited touch target so the button and the
    // track it sits in cannot drift apart when the card is narrow.
    expect(css).toMatch(
      /\.cf-row \{[^}]*grid-template-columns: minmax\(0, 1\.2fr\) 110px minmax\(0, 1\.6fr\) var\(--hv-tap-min, 34px\)/,
    );
    expect(css).toMatch(/\.cf-remove \{[^}]*width: var\(--hv-tap-min, 30px\)/);
    // Too tight: the value drops under its key and remove spans both rows, so
    // it still reads as belonging to that field.
    expect(css).toMatch(
      /@container \(max-width: \d+px\) \{ \.cf-row \{[^}]*grid-template-areas: 'key type remove' 'value value remove'/,
    );
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

  // The fields are cells of the form's grid; a holder that laid itself out would
  // take their place in it and swallow the gaps between them.
  it('keeps the holder out of the grid its fields belong to', () => {
    expect(editorCss()).toMatch(/\.more-fields \{[^}]*display: contents/);
  });

  it('summarises what is inside the disclosure', async () => {
    const el = await mount(
      makeItem({ id: '1', name: 'A', description: 'x', due_date: '2026-07-31', custom_fields: { k: 1 } }),
      { mobile: true },
    );
    expect(q(el, '[data-testid="editor-more-toggle"]')?.textContent).toContain('description · dates · 1 custom');
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

  it('keeps the form when the discard guard is dismissed', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);
    await type(el, 'editor-name', 'A longer name');

    esc(el);
    await el.updateComplete;
    const guard = await dialog(el, 'editor-discard-confirm');
    (guard.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(cancels.count).toBe(0);
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('A longer name');
    expect(el.dirty).toBe(true);
  });

  it('closes a clean form on the spot, with nothing to ask about', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);

    esc(el);
    await el.updateComplete;

    expect(cancels.count).toBe(1);
    expect((await dialog(el, 'editor-discard-confirm')).open).toBe(false);
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

  it('leaves the motion to the people who asked for it', async () => {
    const css = editorCss();
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{ \.progress \.fill \{[^}]*animation:/);
    expect(css).toMatch(/@keyframes hv-upload-sweep/);
  });
});

describe('hv-item-editor: touch targets and the shared tally', () => {
  // WCAG 2.2 asks 24px of every pointer target; the remove X measured 22.
  it('gives the photo remove control the pointer minimum', () => {
    expect(editorCss()).toMatch(/\.photos \.remove \{[^}]*width: 24px;[^}]*height: 24px/);
  });

  it('grows the tile controls into a real strip on a phone', () => {
    const css = editorCss();
    expect(css).toMatch(/\.tile-controls \{[^}]*height: 24px/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.tile-controls \{[^}]*height: var\(--hv-tap-min, 24px\)/);
  });

  it('sizes the queue controls from the same token', () => {
    const css = editorCss();
    expect(css).toMatch(
      /\.upload-list li \.retry,\s*\.upload-list li \.dismiss \{[^}]*min-height: var\(--hv-tap-min, 24px\)/,
    );
  });

  // The count beside a facet is declared once, in the shared sheet.
  it('prices its custom fields with the shared tally', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    expect(q(el, '[data-testid="editor-cf-tally"]')?.classList.contains('hv-tally')).toBe(true);
    // This component's own sheet may place the tally and nothing more — size
    // and dimming belong to the one declaration in `base`.
    const styles = (customElements.get('hv-item-editor') as typeof HVItemEditor).styles;
    const own = String((styles as { cssText: string }[])[(styles as unknown[]).length - 1].cssText).replace(
      /\s+/g,
      ' ',
    );
    for (const [, body] of own.matchAll(/\.hv-tally[^{]*\{([^}]*)\}/g)) {
      expect(body).not.toMatch(/font-size|opacity|color/);
    }
    expect(own).not.toMatch(/\.custom-head \.tally\b/);
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

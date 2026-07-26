import './hv-item-editor';
import { makeItem } from '../test.utils';
import { addDays } from '../ui/relative-time';
import type { HVItemEditor } from './hv-item-editor';
import type { Item, ItemCreate, ItemUpdate, LocationTreeNode } from '../store/types';

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
  el.locations = [
    {
      id: 'garage',
      name: 'Garage',
      parent_id: null,
      area_id: null,
      path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
    },
  ];
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

  async function focusCategory(el: HVItemEditor) {
    const input = q(el, '[data-testid="editor-category"]') as HTMLInputElement;
    input.focus();
    await el.updateComplete;
    return input;
  }

  it('shows every existing category on focus, before a single keystroke', async () => {
    const el = await mount(null);
    expect(q(el, '[data-testid="editor-category-list"]')).toBe(null);

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
    expect(q(el, '[data-testid="editor-category-list"]')).toBe(null);
  });

  it('fills the field from a picked option and saves it', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    await focusCategory(el);

    (all(el, '[data-testid="editor-category-option"]')[1] as HTMLButtonElement).click();
    await el.updateComplete;

    expect((q(el, '[data-testid="editor-category"]') as HTMLInputElement).value).toBe('Tools');
    expect(q(el, '[data-testid="editor-category-list"]')).toBe(null);

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
    expect(q(el, '[data-testid="editor-category-list"]')).toBe(null);
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
    expect(q(el, '[data-testid="editor-category-list"]')).toBe(null);
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

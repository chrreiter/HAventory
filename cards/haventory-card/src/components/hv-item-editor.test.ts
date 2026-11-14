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
import type { HVEditorDates } from './hv-editor-dates';
import type { HVEditorLocation } from './hv-editor-location';
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
const FIELD_CHILDREN = [
  'hv-editor-category',
  'hv-editor-location',
  'hv-editor-dates',
  'hv-editor-attachments',
] as const;

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
  const input = field(el, testid) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await el.updateComplete;
}

/** Press Check out and confirm the dialog it opens, with whatever it suggests. */
async function checkOut(el: HVItemEditor) {
  (field(el, 'editor-checked-out') as HTMLButtonElement).click();
  await settle(el);
  const popover = field(el, 'editor-checkout') as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await popover.updateComplete;
  (popover.shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
  await settle(el);
  return popover;
}

/** The dialog behind a testid, awaited so its own render has run. */
async function dialog(el: HVItemEditor, testid: string) {
  const found = field(el, testid) as HTMLElement & {
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

  it('saves the date an offset picked', async () => {
    const el = await mount(makeItem({ id: 'item-1', inspection_date: null, version: 3 }));
    const saves = onSave(el);

    (
      all(
        q(el, 'hv-editor-dates') as HTMLElement,
        '[data-testid="editor-inspection-offset"]',
      )[0] as HTMLButtonElement
    ).click();
    await el.updateComplete;
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]?.changes?.inspection_date).toBe(addDays(7));
  });

  // Every other way in is drawn on the box; the way back out was emptying the
  // field with the keyboard, which nobody finds by looking at it.
  it('takes the inspection date off again from a button beside the field', async () => {
    const el = await mount(makeItem({ id: 'item-1', inspection_date: '2027-03-01', version: 3 }));
    const saves = onSave(el);
    const dateInput = () => field(el, 'editor-inspection-date') as HTMLInputElement;
    expect(dateInput().value).toBe('2027-03-01');

    const clear = field(el, 'editor-inspection-clear') as HTMLButtonElement;
    expect(clear.getAttribute('aria-label')).toBe('Clear inspection date');
    clear.click();
    await el.updateComplete;

    expect(dateInput().value).toBe('');
    expect(el.dirty).toBe(true);

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.inspection_date).toBe(null);
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
    expect(field(el, 'editor-location')?.textContent).toContain('No location');
  });

  /** The location child's open tree, which holds the rows a pick clicks. */
  const locationTree = (el: HVItemEditor) =>
    q(q(el, 'hv-editor-location') as HVEditorLocation, 'hv-location-tree') as HTMLElement;

  it('files a pick from the location field in the save', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);

    (field(el, 'editor-location') as HTMLButtonElement).click();
    await settle(el);
    (
      locationTree(el).shadowRoot?.querySelector(
        '[data-testid="tree-row"][data-id="garage"]',
      ) as HTMLButtonElement
    ).click();
    await settle(el);

    // The editor hears it back as the field's value, and the tree is shut again.
    expect(field(el, 'editor-location')?.textContent).toContain('Garage');
    expect(q(q(el, 'hv-editor-location') as HVEditorLocation, 'hv-location-tree')).toBe(null);

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.location_id).toBe('garage');
  });

  // The modal had a dedicated Clear button next to the location field; here the
  // same job belongs to the tree's own clear row, and it has to reach the save
  // payload as a null rather than being quietly dropped.
  it('puts an item back to no location at all', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'garage' }));
    const saves = onSave(el);

    (field(el, 'editor-location') as HTMLButtonElement).click();
    await settle(el);
    (locationTree(el).shadowRoot?.querySelector('[data-testid="tree-all"]') as HTMLButtonElement).click();
    await settle(el);

    expect(field(el, 'editor-location')?.textContent).toContain('No location');

    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.changes?.location_id).toBeNull();
  });

  it('hands the location field what it draws from', async () => {
    const createLocation = async () => garage;
    const areas = [{ id: 'area-kitchen', name: 'Kitchen' }];
    const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'garage' }), {
      areas,
      createLocation,
    });
    const child = q(el, 'hv-editor-location') as HVEditorLocation;

    expect(child.value).toBe('garage');
    expect(child.locations).toEqual([garage]);
    expect(child.locationTree).toEqual(tree);
    expect(child.areas).toBe(areas);
    expect(child.createLocation).toBe(createLocation);
    expect(child.classList.contains('cell') && child.classList.contains('span2')).toBe(true);
    expect(child.mobile).toBe(false);

    el.mobile = true;
    await settle(el);
    expect(child.mobile).toBe(true);
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
      expect(field(el, testid), testid).toBeTruthy();
    }
    // Every one of them is there for the scroll, with no disclosure in front.
    expect(q(el, '[data-testid="editor-more-toggle"]')).toBe(null);
  });

  // The emptiest item is the one whose fields are easiest to leave out, and the
  // create form is where every one of them is first set.
  it('shows the same fields on a phone with nothing filled in yet', async () => {
    const el = await mount(null, { mobile: true });

    expect(q(el, '[data-testid="editor-description"]')).toBeTruthy();
    expect(field(el, 'editor-inspection-date')).toBeTruthy();
    expect(q(el, '[data-testid="editor-cf-add"]')).toBeTruthy();
  });

  // The fields an edit is usually about come first and the rest follows, which
  // is the order the wide form reads in too.
  it('keeps the rarely-touched fields below the rest, in their order', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }), { mobile: true });

    // The inspection date is drawn inside the dates element, so its host stands
    // for it among the editor's own fields.
    const order = all(
      el,
      [
        '[data-testid="editor-name"]',
        '[data-testid="editor-description"]',
        'hv-editor-dates',
        '[data-testid="editor-cf-add"]',
      ].join(','),
    ).map((node) => node.dataset.testid ?? node.localName);

    expect(order).toEqual(['editor-name', 'editor-description', 'hv-editor-dates', 'editor-cf-add']);
    expect(field(el, 'editor-inspection-date')).toBe(
      q(q(el, 'hv-editor-dates') as HTMLElement, '[data-testid="editor-inspection-date"]'),
    );
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

    const child = q(el, 'hv-editor-location') as HVEditorLocation;

    (field(el, 'editor-location') as HTMLButtonElement).click();
    await settle(el);
    expect(field(el, 'editor-location-tree')).toBeTruthy();

    esc(el);
    await settle(el);

    expect(field(el, 'editor-location-tree')).toBe(null);
    expect(cancels.count).toBe(0);
    // And the control that opened it takes the focus back.
    expect(child.shadowRoot?.activeElement).toBe(field(el, 'editor-location'));
  });

  // The popover renders in a shadow root of its own; without the key stopping
  // there it reached this form's handler too and closed both.
  it('closes the check-out popover and leaves the form standing', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);

    (field(el, 'editor-checked-out') as HTMLButtonElement).click();
    await settle(el);
    const popover = (await dialog(el, 'editor-checkout')) as HTMLElement & { open: boolean };
    expect(popover.open).toBe(true);

    (popover.shadowRoot?.querySelector('[data-testid="checkout-popover"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(popover.open).toBe(false);
    expect(cancels.count).toBe(0);
  });

  // The editor asks the dates element what is open, in this order: the category
  // list, then the dialog, then the location picker, then the form.
  it('closes the check-out popover from the form root, before the form', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const cancels = onCancel(el);
    const dates = q(el, 'hv-editor-dates') as HVEditorDates;

    (field(el, 'editor-checked-out') as HTMLButtonElement).click();
    await settle(el);
    expect(dates.checkoutOpen).toBe(true);

    esc(el);
    await settle(el);
    expect(dates.checkoutOpen).toBe(false);
    expect(((await dialog(el, 'editor-checkout')) as HTMLElement & { open: boolean }).open).toBe(false);
    expect(cancels.count).toBe(0);

    esc(el);
    expect(cancels.count).toBe(1);
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
  const created: Location = {
    id: 'loc-new',
    name: 'Shed',
    parent_id: null,
    area_id: null,
    path: { id_path: ['loc-new'], name_path: ['Shed'], display_path: 'Shed', sort_key: 'shed' },
  };

  it('creates the location and files the item in it', async () => {
    const names: string[] = [];
    const el = await mount(null, {
      locationTree: [],
      locations: [],
      createLocation: async (name: string) => {
        names.push(name);
        return created;
      },
    });
    const saves = onSave(el);
    await type(el, 'editor-name', 'Ladder');

    (field(el, 'editor-location') as HTMLButtonElement).click();
    await settle(el);
    const tree = q(q(el, 'hv-editor-location') as HVEditorLocation, 'hv-location-tree') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await tree.updateComplete;
    (tree.shadowRoot?.querySelector('[data-testid="tree-create"]') as HTMLButtonElement).click();
    await tree.updateComplete;
    const input = tree.shadowRoot?.querySelector('[data-testid="tree-create-name"]') as HTMLInputElement;
    input.value = 'Shed';
    input.dispatchEvent(new Event('input'));
    await tree.updateComplete;
    (tree.shadowRoot?.querySelector('[data-testid="tree-create-submit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(names).toEqual(['Shed']);
    expect(field(el, 'editor-location-tree')).toBe(null);
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();
    expect(saves[0]?.create?.location_id).toBe('loc-new');
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

describe('hv-item-editor: one label recipe, one note size', () => {
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

describe('hv-item-editor: the dates element', () => {
  it('hands the element the whole form, the item and the phone flag', async () => {
    const item = makeItem({ id: '1', name: 'Multimeter', checked_out: true, due_date: '2099-01-01' });
    const el = await mount(item, { mobile: true });
    const dates = q(el, 'hv-editor-dates') as HVEditorDates;

    expect(dates.item).toBe(item);
    expect(dates.mobile).toBe(true);
    expect(dates.hasAttribute('mobile')).toBe(true);
    expect(dates.model.name).toBe('Multimeter');
    expect(dates.model.checkedOut).toBe(true);
    expect(dates.model.dueDate).toBe('2099-01-01');
    expect(dates.classList.contains('cell') && dates.classList.contains('span3')).toBe(true);

    await type(el, 'editor-name', 'Fluke');
    expect(dates.model.name).toBe('Fluke');
  });

  it('leaves the phone flag off on a desktop form', async () => {
    const el = await mount(makeItem({ id: '1' }));
    expect((q(el, 'hv-editor-dates') as HVEditorDates).mobile).toBe(false);
  });

  it('keeps the check-out dialog from reaching the host', async () => {
    const el = await mount(makeItem({ id: '1' }));
    const seen: string[] = [];
    el.addEventListener('check-out', () => seen.push('check-out'));
    el.addEventListener('cancel', () => seen.push('cancel'));

    await checkOut(el);

    expect(seen).toEqual([]);
  });

  it('saves a check-out with the due date it picked', async () => {
    const el = await mount(makeItem({ id: 'item-1', version: 3 }));
    const saves = onSave(el);

    await checkOut(el);
    (q(el, '[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(saves[0]?.changes?.checked_out).toBe(true);
    expect(saves[0]?.changes?.due_date).toBe(addDays(7));
  });
});

describe('hv-item-editor: reminders', () => {
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

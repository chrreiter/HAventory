import './hv-item-editor';
import { makeItem } from '../test.utils';
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

async function type(el: HVItemEditor, testid: string, value: string) {
  const input = q(el, `[data-testid="${testid}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
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

  it('opens empty as the add-item expander', async () => {
    const el = await mount(null);
    expect(q(el, '[data-testid="editor-heading"]')?.textContent).toContain('New item');
    expect((q(el, '[data-testid="editor-name"]') as HTMLInputElement).value).toBe('');
    expect(q(el, '[data-testid="editor-delete"]')).toBe(null);
  });

  it('only allows a due date while the item is checked out', async () => {
    const el = await mount(makeItem({ id: '1' }));
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).disabled).toBe(true);

    (q(el, '[data-testid="editor-checked-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect((q(el, '[data-testid="editor-due-date"]') as HTMLInputElement).disabled).toBe(false);
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

  it('saves on ⌘↵ and discards on Escape', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A' }));
    const saves = onSave(el);
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    const root = q(el, '[data-testid="item-editor"]') as HTMLElement;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    expect(saves).toHaveLength(1);

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancels).toBe(1);
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
  // same job belongs to the tree's own "All items" row, and it has to reach the
  // save payload as a null rather than being quietly dropped.
  it('puts an item back to no location at all', async () => {
    const el = await mount(makeItem({ id: '1', name: 'A', location_id: 'garage' }));
    const saves = onSave(el);

    (q(el, '[data-testid="editor-location"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const treeEl = el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    (treeEl.shadowRoot?.querySelector('[data-testid="tree-all"]') as HTMLButtonElement).click();
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

import './hv-organize-dialog';
import { makeMockHass, makeItem } from '../test.utils';
import { Store } from '../store/store';
import type { HVOrganizeDialog, OrganizeTab } from './hv-organize-dialog';
import type { Item, Location } from '../store/types';

function loc(id: string, name: string, parentId: string | null = null, areaId: string | null = null): Location {
  const display = parentId ? `${parentId} / ${name}` : name;
  return {
    id,
    name,
    parent_id: parentId,
    area_id: areaId,
    path: {
      id_path: parentId ? [parentId, id] : [id],
      name_path: parentId ? [parentId, name] : [name],
      display_path: display,
      sort_key: display.toLowerCase(),
    },
  };
}

async function mount(
  opts: { items?: Item[]; locations?: Location[]; tab?: OrganizeTab; mobile?: boolean } = {},
) {
  const hass = makeMockHass({ items: opts.items ?? [], locations: opts.locations ?? [] });
  const store = new Store(hass, { retryBaseMs: 0 });
  await store.init();

  const el = document.createElement('hv-organize-dialog') as HVOrganizeDialog;
  el.store = store;
  el.tab = opts.tab ?? 'locations';
  el.mobile = opts.mobile ?? false;
  el.open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  await el.updateComplete;
  return { el, store, hass, sr: el.shadowRoot as ShadowRoot };
}

const settle = async (el: HVOrganizeDialog) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

const q = (sr: ShadowRoot, sel: string) => sr.querySelector(sel) as HTMLElement | null;
const all = (sr: ShadowRoot, sel: string) => [...sr.querySelectorAll(sel)] as HTMLElement[];

describe('hv-organize-dialog: shell', () => {
  it('renders nothing when closed', async () => {
    const { el, sr } = await mount();
    el.open = false;
    await el.updateComplete;
    expect(q(sr, '[data-testid="organize-dialog"]')).toBe(null);
  });

  it('replaces three separate browsers with one tabbed dialog', async () => {
    const { sr } = await mount();
    expect(all(sr, '[data-testid="organize-tab"]').map((t) => t.dataset.tab)).toEqual([
      'locations',
      'categories',
      'tags',
    ]);
  });

  it('switches tabs and resets the filter with them', async () => {
    const { el, sr } = await mount();
    const filter = q(sr, '[data-testid="organize-filter"]') as HTMLInputElement;
    filter.value = 'gar';
    filter.dispatchEvent(new Event('input'));
    await settle(el);

    (q(sr, '[data-tab="tags"]') as HTMLButtonElement).click();
    await settle(el);
    expect(el.tab).toBe('tags');
    expect((q(sr, '[data-testid="organize-filter"]') as HTMLInputElement).value).toBe('');
  });

  it('closes from the ✕, the backdrop and Escape', async () => {
    for (const trigger of ['close', 'backdrop', 'escape'] as const) {
      const { el, sr } = await mount();
      let cancels = 0;
      el.addEventListener('cancel', () => {
        cancels += 1;
      });

      if (trigger === 'close') (q(sr, '[data-testid="organize-close"]') as HTMLButtonElement).click();
      else if (trigger === 'backdrop') (q(sr, '.backdrop') as HTMLElement).click();
      else
        (q(sr, '[data-testid="organize-dialog"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

      expect(cancels, trigger).toBe(1);
      el.remove();
    }
  });

  it('is a full-bleed page with a back arrow on mobile', async () => {
    const { sr } = await mount({ mobile: true });
    expect(q(sr, '[data-testid="organize-back"]')).toBeTruthy();
    expect(q(sr, '[data-testid="organize-close"]')).toBe(null);
  });
});

describe('hv-organize-dialog: locations', () => {
  const locations = [loc('garage', 'Garage', null, 'area-garage'), loc('shelf-a', 'Shelf A', 'garage')];

  it('lists the tree with counts and area chips', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    expect(tree.shadowRoot?.querySelector('[data-testid="tree-count"]')?.textContent?.trim()).toBe('1');
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-edit"]')).toBeTruthy();
  });

  it('edits a location in place and saves name, area and parent in one call', async () => {
    const { el, store, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="location-editor"]') as HTMLElement;
    expect(editor).toBeTruthy();
    const name = q(sr, '[data-testid="location-name"]') as HTMLInputElement;
    expect(name.value).toBe('Garage');
    name.value = 'Big Garage';
    name.dispatchEvent(new Event('input'));

    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.locationsFlatCache?.find((l) => l.id === 'garage')?.name).toBe('Big Garage');
    expect(q(sr, '[data-testid="location-editor"]')).toBe(null);
  });

  it('refuses to save a location with no name', async () => {
    const { el, sr } = await mount({ locations });
    (q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="location-error"]')?.textContent).toContain('needs a name');
  });

  it('creates a new location from the toolbar', async () => {
    const { el, store, sr } = await mount({ locations });
    (q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement).click();
    await settle(el);

    const name = q(sr, '[data-testid="location-name"]') as HTMLInputElement;
    name.value = 'Attic';
    name.dispatchEvent(new Event('input'));
    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.locationsFlatCache?.some((l) => l.name === 'Attic')).toBe(true);
  });

  it('excludes the location itself from its own parent picker, so no cycle is possible', async () => {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="location-parent"]') as HTMLButtonElement).click();
    await settle(el);

    const picker = q(sr, '[data-testid="location-parent-tree"]') as HTMLElement;
    const disabled = [...(picker.shadowRoot?.querySelectorAll('[data-testid="tree-row"][disabled]') ?? [])].map(
      (r) => (r as HTMLElement).dataset.id,
    );
    expect(disabled).toContain('garage');
  });

  it('guards a delete with an inline explanation, never a browser confirm', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { el, store, sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);

    const guard = q(sr, '[data-testid="location-guard"]');
    expect(guard?.textContent).toContain('still contains');
    expect(guard?.textContent).toContain('1 item');
    expect(guard?.textContent).toContain('1 sub-location');
    // Nothing was deleted.
    expect(store.state.value.locationsFlatCache).toHaveLength(2);
  });

  it('deletes an empty location without a guard', async () => {
    const { el, store, sr } = await mount({ locations: [loc('spare', 'Spare')] });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="spare"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="location-guard"]')).toBe(null);
    expect(store.state.value.locationsFlatCache).toHaveLength(0);
  });
});

describe('hv-organize-dialog: tags and categories', () => {
  const items = [
    makeItem({ id: '1', tags: ['battery', 'aa'], category: 'Consumables' }),
    makeItem({ id: '2', tags: ['batery'], category: 'Tools' }),
    makeItem({ id: '3', tags: ['batery'], category: 'Tools' }),
  ];

  it('lists values with counts, and links the count to the filtered list', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const rows = all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value);
    expect(rows).toEqual(['aa', 'batery', 'battery']);

    (all(sr, '[data-testid="value-count"]')[1] as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.filters.tags).toEqual(['batery']);
    expect(el.open).toBe(false);
  });

  it('filters the value list', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const filter = q(sr, '[data-testid="organize-filter"]') as HTMLInputElement;
    filter.value = 'bat';
    filter.dispatchEvent(new Event('input'));
    await settle(el);

    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).toEqual(['batery', 'battery']);
  });

  it('pre-fills the merge target with the closest existing value', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-target"]') as HTMLInputElement).value).toBe('battery');
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain(
      'Retags 2 items, then removes "batery"',
    );
  });

  it('merges a tag across every affected item', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    const tags = store.state.value.items.flatMap((i) => i.tags);
    expect(tags).not.toContain('batery');
    expect(tags.filter((t) => t === 'battery')).toHaveLength(3);
    expect(q(sr, '[data-testid="rewrite-label"]')?.textContent).toContain('2 of 2 rewritten');
  });

  it('will not apply a rename to the same value', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames a category across its items', async () => {
    const { el, store, sr } = await mount({ items, tab: 'categories' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'Tools')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    const target = q(sr, '[data-testid="value-target"]') as HTMLInputElement;
    target.value = 'Instruments';
    target.dispatchEvent(new Event('input'));
    await settle(el);
    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(store.state.value.items.filter((i) => i.category === 'Instruments')).toHaveLength(2);
  });

  it('reports the rows a rewrite could not touch', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const realBulk = store['ws'].bulk.bind(store['ws']);
    store['ws'].bulk = async (ops) => {
      const res = await realBulk(ops);
      const first = ops[0];
      res.results[first.op_id] = { success: false, error: { code: 'conflict', message: 'version conflict' } };
      return res;
    };

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="rewrite-failed"]')?.textContent).toContain('1 failed');
    expect(q(sr, '[data-testid="rewrite-failure"]')?.textContent).toContain('changed by another client');
  });

  it('confirms before removing a value from every item', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = q(sr, '[data-testid="organize-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    expect(confirm.shadowRoot?.textContent).toContain('Remove "batery" from 2 items?');

    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(store.state.value.items.flatMap((i) => i.tags)).not.toContain('batery');
  });

  it('says so when there is nothing to organize', async () => {
    const { sr } = await mount({ items: [], tab: 'tags' });
    expect(q(sr, '[data-testid="organize-empty"]')?.textContent).toContain('No tags in use yet');
  });
});

describe('hv-organize-dialog: mobile value actions', () => {
  const items = [makeItem({ id: '1', tags: ['batery'] }), makeItem({ id: '2', tags: ['battery'] })];

  it('replaces hover actions with a tap-to-open action sheet', async () => {
    const { el, sr } = await mount({ items, tab: 'tags', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    expect(row.querySelector('[data-testid="value-rename"]')).toBe(null);

    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = q(sr, '[data-testid="value-sheet"]') as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(sheet.querySelector('[data-testid="sheet-show"]')?.textContent).toContain('Show 1 items');
    // The merge row suggests the likely typo fix up front.
    expect(sheet.querySelector('[data-testid="sheet-merge-suggestion"]')?.textContent).toContain('battery');
  });

  it('opens the merge editor from the sheet', async () => {
    const { el, sr } = await mount({ items, tab: 'tags', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="sheet-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-editor"]') as HTMLElement).dataset.mode).toBe('merge');
    expect(q(sr, '[data-testid="value-sheet"]')).toBe(null);
  });
});

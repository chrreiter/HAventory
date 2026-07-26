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

    // The count names its unit here, exactly as the category and tag rows do.
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-count"]')?.textContent?.trim()).toBe(
      '1 item',
    );
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

  it('gives the create action the primary treatment', async () => {
    const { sr } = await mount({ locations });
    const button = q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement;
    // Outlined, it reads as secondary next to the filter box and gets missed.
    expect(button.classList.contains('hv-pill')).toBe(true);
    expect(button.classList.contains('outline')).toBe(false);
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

  // Re-parenting rides along with the rename in one `location/update`. The two
  // halves that matter — send the move only when the parent really changed, and
  // send an explicit null for "top level" — were asserted only by the POC's
  // location selector, which spoke to the host in `update-location` events.
  describe('re-parenting', () => {
    const tree = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage'), loc('attic', 'Attic')];

    async function editShelfA() {
      const ctx = await mount({ locations: tree });
      const calls: { id: string; changes: Record<string, unknown> }[] = [];
      const real = ctx.store.updateLocation.bind(ctx.store);
      ctx.store.updateLocation = (id, changes) => {
        calls.push({ id, changes: changes as Record<string, unknown> });
        return real(id, changes);
      };

      // The tree opens collapsed, so Shelf A is only reachable under Garage.
      const treeEl = q(ctx.sr, '[data-testid="organize-tree"]') as HTMLElement;
      (
        treeEl.shadowRoot?.querySelector(
          '[data-testid="tree-row"][data-id="garage"] [data-testid="tree-twisty"]',
        ) as HTMLButtonElement
      ).click();
      await settle(ctx.el);
      (
        treeEl.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="shelf-a"]') as HTMLButtonElement
      ).click();
      await settle(ctx.el);
      return { ...ctx, calls };
    }

    async function pickParent(el: HVOrganizeDialog, sr: ShadowRoot, testid: string) {
      (q(sr, '[data-testid="location-parent"]') as HTMLButtonElement).click();
      await settle(el);
      const picker = q(sr, '[data-testid="location-parent-tree"]') as HTMLElement;
      (picker.shadowRoot?.querySelector(testid) as HTMLButtonElement).click();
      await settle(el);
    }

    it('leaves the parent out of a rename that did not move anything', async () => {
      const { el, sr, calls } = await editShelfA();
      const name = q(sr, '[data-testid="location-name"]') as HTMLInputElement;
      name.value = 'Shelf B';
      name.dispatchEvent(new Event('input'));

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls).toHaveLength(1);
      expect(calls[0].changes.name).toBe('Shelf B');
      expect('newParentId' in calls[0].changes).toBe(false);
    });

    it('moves the subtree when a different parent is picked', async () => {
      const { el, sr, calls } = await editShelfA();
      await pickParent(el, sr, '[data-testid="tree-select"][data-id="attic"]');

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls[0].changes.newParentId).toBe('attic');
    });

    it('sends an explicit null when the location is moved to the top level', async () => {
      const { el, sr, calls } = await editShelfA();
      await pickParent(el, sr, '[data-testid="tree-all"]');

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls[0].changes.newParentId).toBeNull();
    });
  });

  it('drops a failed save off the screen when the dialog is reopened', async () => {
    const { el, store, sr } = await mount({ locations });
    store.updateLocation = () => Promise.reject(new Error('Location is busy'));

    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-error"]')?.textContent).toContain('Location is busy');

    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect(q(sr, '[data-testid="location-error"]')).toBe(null);
    expect(q(sr, '[data-testid="location-editor"]')).toBe(null);
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

  // A location row used to be the odd one out: its name did nothing and its
  // count was a muted number at the far edge, while a category row's count was
  // the way into the items.
  it('opens the items behind a location from its name or its count', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    for (const testid of ['tree-select', 'tree-count']) {
      const { el, store, sr } = await mount({ items, locations });
      const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
      let browsed = 0;
      el.addEventListener('browse', () => {
        browsed += 1;
      });

      (tree.shadowRoot?.querySelector(`[data-testid="${testid}"][data-id="garage"]`) as HTMLButtonElement).click();
      await settle(el);

      expect(store.state.value.filters.locationId, testid).toBe('garage');
      // Organizing happens full-screen; so should the list it hands back.
      expect(browsed, testid).toBe(1);
      expect(el.open, testid).toBe(false);
      el.remove();
    }
  });

  // Touch has no hover, so the row's icons would be unreachable — the value rows
  // already solved this with a ⋮ and a sheet.
  it('puts a location’s actions in a sheet on touch, like the value rows', async () => {
    const items = [makeItem({ id: '1', location_id: 'garage' })];
    const { el, sr } = await mount({ items, locations, mobile: true });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-edit"]')).toBe(null);

    (tree.shadowRoot?.querySelector('[data-testid="tree-more"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = q(sr, '[data-testid="location-sheet"]') as HTMLElement;
    expect(sheet.querySelector('[data-testid="location-sheet-show"]')?.textContent).toContain('Show 1 item');
    (sheet.querySelector('[data-testid="location-sheet-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-merge"]')).toBeTruthy();
    expect(q(sr, '[data-testid="location-sheet"]')).toBe(null);
  });

  it('merges a location: items move, children re-parent, the husk is deleted', async () => {
    const items = [
      makeItem({ id: '1', location_id: 'garage' }),
      makeItem({ id: '2', location_id: 'garage' }),
    ];
    const { el, store, sr } = await mount({
      items,
      locations: [...locations, loc('workshop', 'Workshop')],
    });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (tree.shadowRoot?.querySelector('[data-testid="tree-merge"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="merge-effect"]')?.textContent).toContain('Pick a location');

    (q(sr, '[data-testid="merge-target"]') as HTMLButtonElement).click();
    await settle(el);
    const picker = q(sr, '[data-testid="merge-target-tree"]') as HTMLElement;
    // The target cannot be inside what is being merged away — neither the
    // location itself nor anything under it.
    const disabled = () =>
      [...(picker.shadowRoot?.querySelectorAll('[data-testid="tree-row"][disabled]') ?? [])].map(
        (r) => (r as HTMLElement).dataset.id,
      );
    expect(disabled()).toContain('garage');
    (picker.shadowRoot?.querySelector('[data-testid="tree-twisty"]') as HTMLButtonElement).click();
    await settle(el);
    expect(disabled()).toEqual(expect.arrayContaining(['garage', 'shelf-a']));

    (picker.shadowRoot?.querySelector('[data-testid="tree-select"][data-id="workshop"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="merge-effect"]')?.textContent).toContain('2 items and 1 sub-location');

    (q(sr, '[data-testid="merge-apply"]') as HTMLButtonElement).click();
    for (let i = 0; i < 6; i += 1) await settle(el);

    expect(store.state.value.items.every((i) => i.location_id === 'workshop')).toBe(true);
    expect(store.state.value.locationsFlatCache?.find((l) => l.id === 'shelf-a')?.parent_id).toBe('workshop');
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === 'garage')).toBe(false);
    expect(q(sr, '[data-testid="rewrite-label"]')?.textContent?.trim()).toBe('Merged 2 items');
  });

  it('keeps the location when its items could not all be moved', async () => {
    const items = [makeItem({ id: '1', location_id: 'garage' })];
    const { el, store, sr } = await mount({
      items,
      locations: [...locations, loc('workshop', 'Workshop')],
    });
    // The batch reports per-operation failures rather than throwing.
    store.bulkExecute = async () => ({
      succeeded: [],
      failed: [
        {
          op: { op_id: 'x', kind: 'item_move', payload: { item_id: '1' } },
          error: { code: 'conflict', message: 'stale' },
          itemId: '1',
        },
      ],
      cancelled: false,
    });

    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-merge"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="merge-target"]') as HTMLButtonElement).click();
    await settle(el);
    const picker = q(sr, '[data-testid="merge-target-tree"]') as HTMLElement;
    (picker.shadowRoot?.querySelector('[data-testid="tree-select"][data-id="workshop"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="merge-apply"]') as HTMLButtonElement).click();
    for (let i = 0; i < 4; i += 1) await settle(el);

    // Deleting it would have failed anyway — say why instead.
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === 'garage')).toBe(true);
    expect(q(sr, '[data-testid="rewrite-error"]')?.textContent).toContain('was kept');
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

  async function create(el: HVOrganizeDialog, sr: ShadowRoot, name: string) {
    (q(sr, '[data-testid="organize-new-value"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="new-value-name"]') as HTMLInputElement;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    await settle(el);
    (q(sr, '[data-testid="new-value-create"]') as HTMLButtonElement).click();
    await settle(el);
  }

  it('names a new category, which then shows up as a suggestion', async () => {
    const { el, store, sr } = await mount({ items, tab: 'categories' });
    await create(el, sr, 'Spare parts');

    const rows = all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value);
    expect(rows).toEqual(['Consumables', 'Spare parts', 'Tools']);
    // Nothing to create server-side, so it has to be honest about that.
    expect(q(sr, '[data-testid="value-draft"]')?.textContent).toContain('not saved');
    expect(store.state.value.distinctValuesCache?.categories).toContainEqual({
      value: 'Spare parts',
      count: 0,
    });
  });

  it('names a new tag the way the backend would store it', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    await create(el, sr, 'Power Tools');
    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).toContain('power tools');
  });

  it('refuses a name that is already in use', async () => {
    const { el, sr } = await mount({ items, tab: 'categories' });
    await create(el, sr, 'tools');

    expect(q(sr, '[data-testid="new-value-error"]')?.textContent).toContain('already');
    expect(all(sr, '[data-testid="value-row"]')).toHaveLength(2);
  });

  it('discards a named value that never made it onto an item', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    await create(el, sr, 'seasonal');

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'seasonal')!;
    (row.querySelector('[data-testid="value-discard"]') as HTMLButtonElement).click();
    await settle(el);

    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).not.toContain('seasonal');
    expect(store.state.value.distinctValuesCache?.tags.map((t) => t.value)).not.toContain('seasonal');
  });

  it('offers no rename or merge on a value no item carries yet', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    await create(el, sr, 'seasonal');
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'seasonal')!;

    // Both rewrite every matching item, and there are none — they would look
    // like they worked and do nothing.
    expect(row.querySelector('[data-testid="value-rename"]')).toBe(null);
    expect(row.querySelector('[data-testid="value-merge"]')).toBe(null);
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
    // Said once, in the past tense: the count of both halves and the caveat
    // about partial application only matter when something actually failed.
    expect(q(sr, '[data-testid="rewrite-label"]')?.textContent?.trim()).toBe('Merged 2 items');
    expect(q(sr, '[data-testid="rewrite-status"]')?.textContent).not.toContain('one batch call');
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

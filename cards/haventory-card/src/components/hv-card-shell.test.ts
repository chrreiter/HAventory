import './hv-card-shell';
import { makeMockHass, makeItem } from '../test.utils';
import { Store } from '../store/store';
import type { HVCardShell } from './hv-card-shell';
import type { Item, Location } from '../store/types';

function loc(id: string, name: string, parentId: string | null = null): Location {
  const display = parentId ? `${parentId} / ${name}` : name;
  return {
    id,
    name,
    parent_id: parentId,
    area_id: null,
    path: {
      id_path: parentId ? [parentId, id] : [id],
      name_path: parentId ? [parentId, name] : [name],
      display_path: display,
      sort_key: display.toLowerCase(),
    },
  };
}

async function mountShell(opts: { items?: Item[]; locations?: Location[]; mobile?: boolean } = {}) {
  const hass = makeMockHass({ items: opts.items ?? [], locations: opts.locations ?? [] });
  const store = new Store(hass, { retryBaseMs: 0 });
  await store.init();

  const el = document.createElement('hv-card-shell') as HVCardShell;
  el.store = store;
  el.forceMobile = opts.mobile ?? false;
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, store, hass, sr: el.shadowRoot as ShadowRoot };
}

const settle = async (el: HVCardShell) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

describe('hv-card-shell: header', () => {
  it('shows the configured heading and the live stat badges', async () => {
    const items = [
      makeItem({ id: '1', name: 'AA Batteries', quantity: 2, low_stock_threshold: 8 }),
      makeItem({ id: '2', name: 'Impact Driver', checked_out: true }),
      makeItem({ id: '3', name: 'HDMI Cable' }),
    ];
    const { el, sr } = await mountShell({ items });
    el.heading = 'Inventory';
    await el.updateComplete;

    expect(sr.querySelector('[data-testid="card-title"]')?.textContent).toContain('Inventory');
    expect(sr.querySelector('[data-testid="badge-total"]')?.textContent).toContain('3 items');
    expect(sr.querySelector('[data-testid="badge-low"]')?.textContent).toContain('1 low');
    expect(sr.querySelector('[data-testid="badge-out"]')?.textContent).toContain('1 out');
  });

  it('hides a stat badge that would read zero', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    expect(sr.querySelector('[data-testid="badge-low"]')).toBe(null);
    expect(sr.querySelector('[data-testid="badge-out"]')).toBe(null);
  });

  it('makes the low badge a filter toggle, not just a number', async () => {
    const items = [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })];
    const { el, store, sr } = await mountShell({ items });

    (sr.querySelector('[data-testid="badge-low"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.lowStockOnly).toBe(true);

    (sr.querySelector('[data-testid="badge-low"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.lowStockOnly).toBe(false);
  });

  it('sends the checked-out badge to the checked-out filter', async () => {
    const items = [makeItem({ id: '1', checked_out: true })];
    const { el, store, sr } = await mountShell({ items });
    (sr.querySelector('[data-testid="badge-out"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.checkedOutOnly).toBe(true);
  });
});

describe('hv-card-shell: overflow menu', () => {
  it('collapses the secondary actions behind one trigger', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const menu = sr.querySelector('[data-testid="card-overflow"]') as HTMLElement;
    const trigger = menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement;

    expect(menu.shadowRoot?.querySelector('[data-testid="overflow-menu"]')).toBe(null);
    trigger.click();
    await settle(el);

    const ids = [...(menu.shadowRoot?.querySelectorAll('[data-testid="overflow-item"]') ?? [])].map(
      (b) => (b as HTMLElement).dataset.id,
    );
    expect(ids).toEqual([
      'select-items',
      'columns',
      'refresh',
      'export-all',
      'export-view',
      'import',
    ]);
  });

  it('handles Refresh itself and hands the rest to the host card', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const actions: string[] = [];
    el.addEventListener('menu-action', (e) => actions.push((e as CustomEvent).detail.id));

    let refreshed = 0;
    store.refreshAll = async () => {
      refreshed += 1;
    };

    const menu = sr.querySelector('[data-testid="card-overflow"]') as HTMLElement;
    const open = () =>
      (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    const pick = (id: string) =>
      (menu.shadowRoot?.querySelector(`[data-id="${id}"]`) as HTMLButtonElement).click();

    open();
    await settle(el);
    pick('refresh');
    await settle(el);
    expect(refreshed).toBe(1);
    expect(actions).toEqual([]);

    open();
    await settle(el);
    pick('import');
    await settle(el);
    expect(actions).toEqual(['import']);
  });

  it('disables "Export current view" until a filter is actually narrowing the list', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', category: 'Tools' })] });
    const menu = sr.querySelector('[data-testid="card-overflow"]') as HTMLElement;
    (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    await settle(el);
    expect(
      (menu.shadowRoot?.querySelector('[data-id="export-view"]') as HTMLButtonElement).disabled,
    ).toBe(true);

    store.setFilters({ category: 'Tools' });
    await settle(el);
    expect(
      (menu.shadowRoot?.querySelector('[data-id="export-view"]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('hv-card-shell: search and filters', () => {
  it('debounces the search before touching the store', async () => {
    const { store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const input = sr.querySelector('[data-testid="search-input"]') as HTMLInputElement;

    input.value = 'glue';
    input.dispatchEvent(new Event('input'));
    expect(store.state.value.filters.q).toBe('');

    await new Promise((r) => setTimeout(r, 250));
    expect(store.state.value.filters.q).toBe('glue');
  });

  it('puts the filtered total in the search placeholder', async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeItem({ id: `${i}` }));
    const { sr } = await mountShell({ items });
    const input = sr.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    expect(input.placeholder).toBe('Search 3 matching items…');
  });

  it('marks the filter button when any filter is on, and toggles the panel', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    expect(sr.querySelector('[data-testid="filter-active-dot"]')).toBe(null);
    expect(sr.querySelector('hv-filter-panel')).toBe(null);

    (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    const panel = sr.querySelector('hv-filter-panel') as HTMLElement;
    expect(panel.shadowRoot?.querySelector('[data-testid="filter-panel"]')).toBeTruthy();

    store.setFilters({ checkedOutOnly: true });
    await settle(el);
    expect(sr.querySelector('[data-testid="filter-active-dot"]')).toBeTruthy();
  });

  it('shows a removable chip per active filter and clears them', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', category: 'Tools' })] });
    store.setFilters({ category: 'Tools', checkedOutOnly: true });
    await settle(el);

    const chips = sr.querySelector('hv-filter-chips') as HTMLElement;
    const keys = [...(chips.shadowRoot?.querySelectorAll('[data-testid="filter-chip"]') ?? [])].map(
      (c) => (c as HTMLElement).dataset.key,
    );
    expect(keys).toEqual(['category', 'checkedOutOnly']);

    (chips.shadowRoot?.querySelector('[data-key="category"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.category).toBe(null);
    expect(store.state.value.filters.checkedOutOnly).toBe(true);

    (chips.shadowRoot?.querySelector('[data-testid="filter-chips-clear"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.checkedOutOnly).toBe(false);
  });
});

describe('hv-card-shell: list and footer', () => {
  it('shows skeleton rows before the first list resolves', async () => {
    const hass = makeMockHass({ items: [] });
    const store = new Store(hass, { retryBaseMs: 0 });
    const el = document.createElement('hv-card-shell') as HVCardShell;
    el.store = store;
    el.forceMobile = false;
    document.body.appendChild(el);
    await el.updateComplete;

    const list = el.shadowRoot?.querySelector('hv-list') as HTMLElement;
    expect(list.shadowRoot?.querySelector('[data-testid="list-skeleton"]')).toBeTruthy();
  });

  it('counts loaded rows against the filtered total', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const { sr } = await mountShell({ items });
    expect(sr.querySelector('[data-testid="showing-count"]')?.textContent).toContain('Showing 50 of 60');
  });

  it('says "filtered" only when a filter is on', async () => {
    const items = [makeItem({ id: '1', category: 'Tools' }), makeItem({ id: '2', category: 'Other' })];
    const { el, store, sr } = await mountShell({ items });
    expect(sr.querySelector('[data-testid="showing-count"]')?.textContent).not.toContain('filtered');

    store.setFilters({ category: 'Tools' });
    await settle(el);
    expect(sr.querySelector('[data-testid="showing-count"]')?.textContent).toContain('filtered');
  });

  it('adjusts quantity from the row stepper', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', quantity: 5 })] });
    const row = (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector(
      'hv-list-row',
    ) as HTMLElement;

    (row.shadowRoot?.querySelector('[data-testid="row-increment"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items[0].quantity).toBe(6);

    (row.shadowRoot?.querySelector('[data-testid="row-decrement"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items[0].quantity).toBe(5);
  });

  it('never sends a decrement that would take the quantity below zero', async () => {
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1', quantity: 0 })] });
    const row = (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector(
      'hv-list-row',
    ) as HTMLElement;

    (row.shadowRoot?.querySelector('[data-testid="row-decrement"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__calls).not.toContain('haventory/item/adjust_quantity');
    expect(store.state.value.errorQueue).toEqual([]);
  });

  it('confirms in-app before deleting, instead of window.confirm', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const row = (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector(
      'hv-list-row',
    ) as HTMLElement;

    (row.shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );
    await settle(el);

    const confirm = sr.querySelector('[data-testid="card-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    expect(confirm.shadowRoot?.textContent).toContain('Wood Glue');

    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items).toHaveLength(0);
  });

  it('names the empty state after why the list is empty', async () => {
    const locations = [loc('garage', 'Garage')];
    const { el, store, sr } = await mountShell({ items: [], locations });
    const list = () => sr.querySelector('hv-list') as HTMLElement;
    const kind = () =>
      (list().shadowRoot?.querySelector('[data-testid="list-empty"]') as HTMLElement)?.dataset.kind;

    expect(kind()).toBe('no-items');

    store.setFilters({ q: 'nothing' });
    await settle(el);
    expect(kind()).toBe('no-matches');

    store.setFilters({ ...store.state.value.filters, q: '', locationId: 'garage' });
    await settle(el);
    expect(kind()).toBe('empty-location');
  });

  it('offers a way out of the no-matches state', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    store.setFilters({ q: 'nothing at all' });
    await settle(el);

    const list = sr.querySelector('hv-list') as HTMLElement;
    (list.shadowRoot?.querySelector('[data-id="clear-filters"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.q).toBe('');
  });
});

describe('hv-card-shell: banners', () => {
  it('offers both recovery paths on a conflict', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'A' })] });
    store['pushError'](
      { code: 'conflict', message: 'version conflict' },
      { itemId: '1', changes: { name: 'B' } },
    );
    await settle(el);

    const banner = sr.querySelector('[data-testid="banner-entry"]') as HTMLElement;
    expect(banner.dataset.code).toBe('conflict');
    expect(sr.querySelector('[data-testid="banner-view-latest"]')).toBeTruthy();
    expect(sr.querySelector('[data-testid="banner-reapply"]')).toBeTruthy();

    (sr.querySelector('[data-testid="banner-dismiss"]') as HTMLButtonElement).click();
    await settle(el);
    expect(sr.querySelector('[data-testid="banner-entry"]')).toBe(null);
  });

  it('renders a plain error without the conflict actions', async () => {
    const { el, store, sr } = await mountShell({ items: [] });
    store['pushError']({ code: 'storage_error', message: 'disk full' });
    await settle(el);

    expect((sr.querySelector('[data-testid="banner-entry"]') as HTMLElement).dataset.code).toBe(
      'storage_error',
    );
    expect(sr.querySelector('[data-testid="banner-view-latest"]')).toBe(null);
  });
});

describe('hv-card-shell: mobile', () => {
  it('collapses the header and opens filters as a sheet', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });

    // Add becomes a circular icon button and the neutral count badge is dropped.
    expect((sr.querySelector('[data-testid="add-item"]') as HTMLElement).classList).toContain('round');
    expect(sr.querySelector('[data-testid="badge-total"]')).toBe(null);

    (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = sr.querySelector('[data-testid="filter-sheet"]') as HTMLElement & { open: boolean };
    expect(sheet.open).toBe(true);
    // The panel is inside the sheet, not inline on the card.
    const panel = sr.querySelector('hv-filter-panel') as HTMLElement;
    expect(panel.hasAttribute('mobile')).toBe(true);
    expect(panel.closest('hv-bottom-sheet')).toBeTruthy();
  });

  it('stages filters in the sheet and only applies them on commit', async () => {
    const items = [
      makeItem({ id: '1', category: 'Tools' }),
      makeItem({ id: '2', category: 'Hardware' }),
      makeItem({ id: '3', category: 'Hardware' }),
    ];
    const { el, store, sr } = await mountShell({ items, mobile: true });
    (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const panel = sr.querySelector('hv-filter-panel') as HTMLElement;
    (panel.shadowRoot?.querySelector('[data-value="Hardware"]') as HTMLButtonElement).click();
    await settle(el);

    // Staged only — the list has not moved.
    expect(store.state.value.filters.category).toBe(null);
    expect(store.state.value.items).toHaveLength(3);

    // ...and the apply button reports what committing would do.
    await new Promise((r) => setTimeout(r, 250));
    await el.updateComplete;
    const apply = sr.querySelector('[data-testid="sheet-apply"]') as HTMLButtonElement;
    expect(apply.textContent?.trim()).toBe('Show 2 items');

    apply.click();
    await settle(el);
    expect(store.state.value.filters.category).toBe('Hardware');
  });

  it('drops staged edits on cancel', async () => {
    const items = [makeItem({ id: '1', category: 'Tools' }), makeItem({ id: '2', category: 'Hardware' })];
    const { el, store, sr } = await mountShell({ items, mobile: true });
    (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const panel = sr.querySelector('hv-filter-panel') as HTMLElement;
    (panel.shadowRoot?.querySelector('[data-value="Hardware"]') as HTMLButtonElement).click();
    await settle(el);

    (sr.querySelector('[data-testid="sheet-cancel"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.category).toBe(null);

    // Reopening starts from the applied state, not the abandoned draft.
    (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    const chip = panel.shadowRoot?.querySelector('[data-value="Hardware"]') as HTMLElement;
    expect(chip.classList.contains('on')).toBe(false);
  });

  it('swaps the stepper for Check in on a checked-out row', async () => {
    const items = [makeItem({ id: '1', checked_out: true, due_date: '2026-07-28' })];
    const { el, store, sr } = await mountShell({ items, mobile: true });
    const row = (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector(
      'hv-list-row',
    ) as HTMLElement;

    expect(row.shadowRoot?.querySelector('[data-testid="row-stepper"]')).toBe(null);
    (row.shadowRoot?.querySelector('[data-testid="row-check-in"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items[0].checked_out).toBe(false);
  });
});

describe('hv-card-shell: inline editing', () => {
  const editor = (sr: ShadowRoot) =>
    (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector('hv-item-editor') as
      | (HTMLElement & { dirty: boolean })
      | null;
  const row = (sr: ShadowRoot, id: string) =>
    [...((sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelectorAll('hv-list-row') ?? [])]
      .map((r) => r as HTMLElement & { item: Item })
      .find((r) => r.item.id === id) ?? null;

  it('expands the row in place instead of opening a dialog', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'AA Batteries' })] });
    expect(editor(sr)).toBe(null);

    const r = row(sr, '1')!;
    (r.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(editor(sr)).toBeTruthy();
    expect(editor(sr)?.shadowRoot?.textContent).toContain('AA Batteries — editing');
    // The collapsed row is replaced by the expander, not duplicated.
    expect(row(sr, '1')).toBe(null);
  });

  it('pins an empty expander at the top for Add item', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
    await settle(el);

    expect(editor(sr)?.shadowRoot?.textContent).toContain('New item');
    // The existing row is still listed underneath.
    expect(row(sr, '1')).toBeTruthy();
  });

  it('saves an edit through the store and collapses', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Old' })] });
    (row(sr, '1')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const nameInput = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    nameInput.value = 'New';
    nameInput.dispatchEvent(new Event('input'));
    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items[0].name).toBe('New');
    expect(editor(sr)).toBe(null);
  });

  it('creates an item from the empty expander', async () => {
    const { el, store, sr } = await mountShell({ items: [] });
    (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
    await settle(el);

    const nameInput = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    nameInput.value = 'Brand new';
    nameInput.dispatchEvent(new Event('input'));
    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items.map((i) => i.name)).toContain('Brand new');
  });

  it('keeps the expander open when the save is rejected', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Old' })] });
    store['ws'].updateItem = async () => {
      throw { code: 'conflict', message: 'version conflict' };
    };

    (row(sr, '1')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const nameInput = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    nameInput.value = 'New';
    nameInput.dispatchEvent(new Event('input'));
    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(editor(sr)).toBeTruthy();
    expect(sr.querySelector('[data-testid="banner-entry"]')).toBeTruthy();
  });

  it('closes on cancel', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    (row(sr, '1')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);

    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-cancel"]') as HTMLButtonElement).click();
    await settle(el);
    expect(editor(sr)).toBe(null);
  });

  it('opens only one expander at a time', async () => {
    const items = [makeItem({ id: '1', name: 'One' }), makeItem({ id: '2', name: 'Two' })];
    const { el, sr } = await mountShell({ items });

    (row(sr, '1')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);
    (row(sr, '2')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editors = (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelectorAll(
      'hv-item-editor',
    );
    expect(editors).toHaveLength(1);
    expect(editor(sr)?.shadowRoot?.textContent).toContain('Two — editing');
  });

  it('asks before throwing away unsaved edits', async () => {
    const items = [makeItem({ id: '1', name: 'One' }), makeItem({ id: '2', name: 'Two' })];
    const { el, sr } = await mountShell({ items });

    (row(sr, '1')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const nameInput = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    nameInput.value = 'Edited';
    nameInput.dispatchEvent(new Event('input'));
    await settle(el);

    (row(sr, '2')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);

    // Still on the first item, with a prompt in the way.
    const confirm = sr.querySelector('[data-testid="card-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    expect(editor(sr)?.shadowRoot?.textContent).toContain('One — editing');

    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    expect(editor(sr)?.shadowRoot?.textContent).toContain('Two — editing');
  });

  it('deletes from inside the expander, via the same confirmation', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Doomed' })] });
    (row(sr, '1')!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);

    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-delete"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = sr.querySelector('[data-testid="card-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.items).toHaveLength(0);
    expect(editor(sr)).toBe(null);
  });
});

describe('hv-card-shell: mobile detail sheet', () => {
  const sheet = (sr: ShadowRoot) =>
    sr.querySelector('[data-testid="card-detail-sheet"]') as HTMLElement & { open: boolean; item: Item | null };
  const firstRow = (sr: ShadowRoot) =>
    (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector('hv-list-row') as HTMLElement;

  it('opens the sheet on tap instead of expanding the row', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'AA Batteries' })], mobile: true });
    expect(sheet(sr).open).toBe(false);

    (firstRow(sr).shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).click();
    await settle(el);

    expect(sheet(sr).open).toBe(true);
    expect(sheet(sr).item?.id).toBe('1');
    // No inline expander on touch.
    expect(
      (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector('hv-item-editor'),
    ).toBe(null);
  });

  it('is not rendered at all on desktop', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: false });
    expect(sr.querySelector('[data-testid="card-detail-sheet"]')).toBe(null);
  });

  it('drives quantity from the sheet hero', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', quantity: 5 })], mobile: true });
    (firstRow(sr).shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).click();
    await settle(el);

    (sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-increment"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items[0].quantity).toBe(6);
  });

  it('checks out from the sheet with no due date, which the API allows', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    (firstRow(sr).shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).click();
    await settle(el);

    (sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-check-out"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items[0].checked_out).toBe(true);
    expect(store.state.value.items[0].due_date).toBe(null);
  });

  it('saves an edit made in the sheet', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Old' })], mobile: true });
    (firstRow(sr).shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).click();
    await settle(el);

    (sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'New';
    name.dispatchEvent(new Event('input'));
    await settle(el);

    (sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(store.state.value.items[0].name).toBe('New');
  });

  it('deletes through the same confirmation and closes the sheet', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Doomed' })], mobile: true });
    (firstRow(sr).shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).click();
    await settle(el);

    (sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-delete"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = sr.querySelector('[data-testid="card-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.items).toHaveLength(0);
    expect(sheet(sr).open).toBe(false);
  });
});

describe('hv-card-shell: full view', () => {
  const fullView = (sr: ShadowRoot) =>
    sr.querySelector('[data-testid="card-full-view"]') as HTMLElement & { open: boolean };

  it('opens from the expand toggle and from the footer link', async () => {
    for (const testid of ['expand-toggle', 'open-full-view']) {
      const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
      expect(fullView(sr).open).toBe(false);

      (sr.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();
      await settle(el);
      expect(fullView(sr).open, testid).toBe(true);
      el.remove();
    }
  });

  it('closes back to the card', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    (sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const inner = fullView(sr).shadowRoot?.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement;
    inner.click();
    await settle(el);
    expect(fullView(sr).open).toBe(false);
  });

  it('has no expand affordance on mobile', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    expect(sr.querySelector('[data-testid="expand-toggle"]')).toBe(null);
    expect(sr.querySelector('[data-testid="open-full-view"]')).toBe(null);
  });

  it('routes the full view menu through the card, exactly once', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const seen: string[] = [];
    el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail.id));

    (sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const columnsBtn = fullView(sr).shadowRoot?.querySelector(
      '[data-testid="columns-expanded"]',
    ) as HTMLButtonElement;
    columnsBtn.click();
    await settle(el);

    expect(seen).toEqual(['columns']);
  });
});

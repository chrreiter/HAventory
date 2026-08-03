import './hv-card-shell';
import { makeMockHass, makeItem } from '../test.utils';
import { base, tokens } from '../ui/tokens';
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
    // "1 out" reads as "1 out of stock", which is the opposite of what it counts.
    expect(sr.querySelector('[data-testid="badge-out"]')?.textContent?.trim()).toBe('1 checked out');
  });

  it('agrees with a one-item inventory', async () => {
    // The total badge was one of nine strings with "items" hardcoded.
    const { sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Lonely Hammer' })] });
    expect(sr.querySelector('[data-testid="badge-total"]')?.textContent?.trim()).toBe('1 item');
  });

  it('hides a stat badge that would read zero', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    expect(sr.querySelector('[data-testid="badge-low"]')).toBe(null);
    expect(sr.querySelector('[data-testid="badge-out"]')).toBe(null);
    expect(sr.querySelector('[data-testid="badge-overdue"]')).toBe(null);
    expect(sr.querySelector('[data-testid="badge-inspection"]')).toBe(null);
  });

  // A due date that has passed was invisible from the card: the row said
  // "Checked out · due Jul 2" in the same blue as any other date.
  it('counts overdue items in a badge of their own, on any width', async () => {
    const overdue = [
      makeItem({ id: '1', checked_out: true, due_date: '2000-01-01' }),
      makeItem({ id: '2', checked_out: true, due_date: '2999-12-31' }),
    ];
    for (const mobile of [false, true]) {
      const { el, store, sr } = await mountShell({ items: overdue, mobile });
      const badge = sr.querySelector('[data-testid="badge-overdue"]') as HTMLButtonElement;
      expect(badge?.textContent, `mobile=${mobile}`).toContain('1 overdue');

      badge.click();
      await settle(el);
      expect(store.state.value.filters.overdueOnly).toBe(true);
      el.remove();
    }
  });

  // `inspection_date` is when the item is next due for inspection, so a date
  // behind us is work waiting — and the count is over the whole inventory,
  // not just what is checked out.
  it('counts items due for inspection in a badge of their own, on any width', async () => {
    const items = [
      makeItem({ id: '1', inspection_date: '2000-01-01' }),
      makeItem({ id: '2', checked_out: true, inspection_date: '2000-06-01' }),
      makeItem({ id: '3', inspection_date: '2999-12-31' }),
    ];
    for (const mobile of [false, true]) {
      const { el, store, sr } = await mountShell({ items, mobile });
      const badge = sr.querySelector('[data-testid="badge-inspection"]') as HTMLButtonElement;
      expect(badge?.textContent, `mobile=${mobile}`).toContain('2 to inspect');

      badge.click();
      await settle(el);
      expect(store.state.value.filters.inspectionDueOnly).toBe(true);
      // Pressing it filters server-side, so the list narrows to the two.
      expect(store.state.value.items.map((i) => i.id).sort()).toEqual(['1', '2']);
      el.remove();
    }
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
      'organize',
      'refresh',
      'diagnostics',
      'export-all',
      'export-view',
      'import',
    ]);
  });

  // Column choices only drive the full view's table — the card list draws a
  // fixed compact row — so the entry belongs where it does something.
  it('offers Columns in the full view but not on the card itself', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const idsOf = async (host: Element | null | undefined) => {
      const menu = host as HTMLElement & { updateComplete: Promise<unknown> };
      (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
      await menu.updateComplete;
      const ids = [...(menu.shadowRoot?.querySelectorAll('[data-testid="overflow-item"]') ?? [])].map(
        (b) => (b as HTMLElement).dataset.id,
      );
      expect(ids.length).toBeGreaterThan(0);
      return ids;
    };

    expect(await idsOf(sr.querySelector('[data-testid="card-overflow"]'))).not.toContain('columns');

    const full = sr.querySelector('[data-testid="card-full-view"]') as HTMLElement & { open: boolean };
    full.open = true;
    await settle(el);
    expect(await idsOf(full.shadowRoot?.querySelector('[data-testid="full-overflow"]'))).toContain('columns');
  });

  // Every id the menu can name is answered inside the shell — by the store,
  // by a shared host surface, or by the shell itself. Nothing bounces off the
  // element above, whose only job is the store and the heading.
  it('answers every menu action itself, letting none escape upward', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const actions: string[] = [];
    el.addEventListener('menu-action', (e) => actions.push((e as CustomEvent).detail.id));

    let refreshed = 0;
    store.refreshAll = async () => {
      refreshed += 1;
    };
    const downloads: string[] = [];
    el.surfaces.download = (filename) => {
      downloads.push(filename);
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

    open();
    await settle(el);
    pick('import');
    await settle(el);
    expect((sr.querySelector('[data-testid="host-import"]') as HTMLElement & { open: boolean }).open).toBe(
      true,
    );

    open();
    await settle(el);
    pick('export-all');
    await settle(el);
    await settle(el);
    expect(downloads).toHaveLength(1);

    expect(actions).toEqual([]);
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

  // The list only reports a scroll ratio; deciding whether that warrants another
  // page is the store's call, and this wiring is the whole of infinite scroll.
  it('hands the list scroll position to the store to page on', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const seen: number[] = [];
    store.prefetchIfNeeded = async (ratio: number) => {
      seen.push(ratio);
    };

    (sr.querySelector('hv-list') as HTMLElement).dispatchEvent(
      new CustomEvent('near-end', { detail: { ratio: 0.82 }, bubbles: true, composed: true }),
    );
    await settle(el);

    expect(seen).toEqual([0.82]);
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

    const confirm = sr.querySelector('[data-testid="host-confirm"]') as HTMLElement & { open: boolean };
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
      (list().shadowRoot?.querySelector('[data-testid="empty-state"]') as HTMLElement)?.dataset.kind;

    expect(kind()).toBe('no-items');

    store.setFilters({ q: 'nothing' });
    await settle(el);
    expect(kind()).toBe('no-matches');

    store.setFilters({ ...store.state.value.filters, q: '', locationId: 'garage' });
    await settle(el);
    expect(kind()).toBe('empty-location');
  });

  it('says the connection is gone ahead of any filter-derived reason', async () => {
    // What a user actually sees when the socket dies: the outage outranks
    // "nothing matched", because clearing a filter would not bring the list back.
    const { el, store, hass, sr } = await mountShell({ items: [], locations: [] });
    const kind = () =>
      ((sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector(
        '[data-testid="empty-state"]',
      ) as HTMLElement)?.dataset.kind;

    store.setFilters({ q: 'nothing' });
    await settle(el);
    expect(kind()).toBe('no-matches');

    hass.__failNext(2, new Error('socket closed'));
    await store.refreshStats().catch(() => undefined);
    await store.refreshStats().catch(() => undefined);
    await settle(el);

    expect(store.state.value.degraded.connectionLost).toBe(true);
    expect(kind()).toBe('connection-lost');
  });

  it('offers a retry from the connection-lost state', async () => {
    const { el, store, hass, sr } = await mountShell({ items: [] });
    hass.__failNext(2, new Error('socket closed'));
    await store.refreshStats().catch(() => undefined);
    await store.refreshStats().catch(() => undefined);
    await settle(el);

    const list = sr.querySelector('hv-list') as HTMLElement;
    const offer = list.shadowRoot?.querySelector('[data-testid="empty-action"]') as HTMLButtonElement;
    expect(offer).toBeTruthy();

    offer.click();
    await settle(el);

    // The offered recovery is the documented one: re-read everything.
    expect(store.state.value.degraded.connectionLost).toBe(false);
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

  // The offer names the same action as the ⋮ menu's "Import backup…", and both
  // must land on the shared import surface — an id handed upward instead would
  // find no listener there and the press would do nothing.
  it('opens the import sheet from the untouched-inventory offer', async () => {
    const { el, sr } = await mountShell({ items: [] });
    const handedUp: string[] = [];
    el.addEventListener('menu-action', (e) => handedUp.push((e as CustomEvent).detail.id));

    const list = sr.querySelector('hv-list') as HTMLElement;
    const offer = list.shadowRoot?.querySelector('[data-id="import"]') as HTMLButtonElement;
    expect(offer).toBeTruthy();

    offer.click();
    await settle(el);

    expect((sr.querySelector('[data-testid="host-import"]') as HTMLElement & { open: boolean }).open).toBe(
      true,
    );
    expect(handedUp).toEqual([]);
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

  it('re-applies the rejected change against the newer server version', async () => {
    // Re-apply deliberately calls updateItem with no expectedVersion: the whole
    // point is to land on top of whatever the other client wrote. Passing the
    // stale version here would make the retry fail exactly as the first attempt
    // did, so the missing third argument is load-bearing.
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'A' })] });
    store['pushError'](
      { code: 'conflict', message: 'version conflict' },
      { itemId: '1', changes: { name: 'B' } },
    );
    await settle(el);

    hass.__setConflict(false);
    (sr.querySelector('[data-testid="banner-reapply"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.items.find((i) => i.id === '1')?.name).toBe('B');
    expect(sr.querySelector('[data-testid="banner-entry"]')).toBe(null);
  });

  it('re-reads the item behind a conflict when asked for the latest', async () => {
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'A' })] });
    store['pushError'](
      { code: 'conflict', message: 'version conflict' },
      { itemId: '1', changes: { name: 'B' } },
    );
    await settle(el);
    const before = hass.__calls.length;

    (sr.querySelector('[data-testid="banner-view-latest"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__calls.slice(before)).toContain('haventory/item/get');
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

describe('hv-card-shell: narrow header', () => {
  const headerCss = () => {
    const styles = (customElements.get('hv-card-shell') as typeof HVCardShell).styles;
    return (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
  };

  // The title is `flex: 1` among siblings that are all `flex: none`, so it
  // absorbed every pixel the badges and buttons needed: 40px for a 78px
  // heading at 375px, and 0px at 320px. jsdom cannot lay this out, so the
  // stylesheet is what gets asserted.
  it('wraps the badges onto their own row on a phone', () => {
    const css = headerCss();
    expect(css).toMatch(/:host\(\[mobile\]\) \.header \{ flex-wrap: wrap; \}/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.badges \{[^}]*flex-basis: 100%/);
  });

  it('leaves the desktop header on one row', () => {
    // `.badges { margin-left: auto }` is what right-aligns them there.
    expect(headerCss()).toMatch(/\.badges \{ display: flex; align-items: center; gap: 6px; margin-left: auto; \}/);
  });

  it('renders no badge row at all when a phone has nothing to badge', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    // Otherwise the empty wrapper still claims a full-width row under the title.
    expect(sr.querySelector('.badges')).toBe(null);
  });

  it('still renders the row when a phone does have something to badge', async () => {
    const { sr } = await mountShell({
      items: [makeItem({ id: '1', quantity: 1, low_stock_threshold: 5 })],
      mobile: true,
    });
    expect(sr.querySelector('.badges')).toBeTruthy();
    expect(sr.querySelector('[data-testid="badge-low"]')).toBeTruthy();
  });

  // Checked-out used to be desktop-only, on the theory that a phone had no room
  // for a third badge. It does, now that the badges have a row to themselves —
  // and that row is a filter toggle a phone user could not otherwise reach
  // without opening the filter sheet.
  it('badges checked-out on a phone too, and wraps if the row runs out', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1', checked_out: true })], mobile: true });
    const badge = sr.querySelector('[data-testid="badge-out"]');
    expect(badge?.textContent?.trim()).toBe('1 checked out');
    // Three badges with large counts will not always make one line of a 320px
    // phone, and an unwrapped row pushes the last one off the side of the card.
    expect(headerCss()).toMatch(/:host\(\[mobile\]\) \.badges \{[^}]*flex-wrap: wrap/);
  });

  it('counts a checked-out phone badge as reason enough to draw the row', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1', checked_out: true })], mobile: true });
    expect(sr.querySelector('.badges')).toBeTruthy();
  });
});

describe('hv-card-shell: touch targets', () => {
  const shellCss = () => {
    const styles = (customElements.get('hv-card-shell') as typeof HVCardShell).styles;
    return (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
  };

  // One declaration on the card host, inherited into every nested shadow root.
  // It only works because `--hv-tap-min` is absent from `tokens` — every
  // component redeclares those on its own `:host`, which would shadow an
  // inherited value at the first boundary.
  it('publishes a 44px target size to every nested component', () => {
    expect(shellCss()).toMatch(/:host\(\[mobile\]\) \{[^}]*--hv-tap-min: 44px/);
  });

  it('does not declare the target size in the shared token block', () => {
    // Guard the mechanism itself: `tokens` is re-applied to every component's
    // own `:host`, so a `--hv-tap-min` in there would shadow the inherited
    // value at the first boundary and quietly undo all of this.
    expect(String(tokens.cssText)).not.toMatch(/--hv-tap-min/);
    // ...while `base`, which is not a `:host` declaration block, must read it.
    expect(String(base.cssText)).toMatch(/\.hv-icon-button \{[^}]*width: var\(--hv-tap-min, 34px\)/);
  });

  it('sizes the header actions from it rather than hard-coding 36px', () => {
    const css = shellCss();
    expect(css).toMatch(/\.add\.round \{ width: var\(--hv-tap-min, 36px\)/);
    expect(css).toMatch(/\.header \.expand \{ width: var\(--hv-tap-min, 36px\)/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.icon-toggle \{ width: var\(--hv-tap-min, 40px\)/);
  });

  it('gives the stat badges a tappable height on a phone', () => {
    expect(shellCss()).toMatch(/:host\(\[mobile\]\) \.badge \{[^}]*min-height: var\(--hv-tap-min, auto\)/);
  });

  // iOS Safari zooms the page whenever a field under 16px takes focus, and does
  // not zoom back out. Every field on the card was 12.5–14.5px.
  it('publishes a 16px field size so iOS does not zoom on focus', () => {
    expect(shellCss()).toMatch(/:host\(\[mobile\]\) \{[^}]*--hv-input-font: 16px/);
    expect(String(tokens.cssText)).not.toMatch(/--hv-input-font/);
    expect(String(base.cssText)).toMatch(/\.hv-input \{[^}]*font: 400 var\(--hv-input-font, 13\.5px\)/);
  });

  it('keeps the card search field reading from it', () => {
    expect(shellCss()).toMatch(/\.search input \{[^}]*font: 400 var\(--hv-input-font, 13\.5px\)/);
  });
});

describe('hv-card-shell: adding an item on a phone', () => {
  const addSheet = (sr: ShadowRoot) =>
    sr.querySelector('[data-testid="add-sheet"]') as (HTMLElement & { open: boolean }) | null;

  // Filters and item detail both get sheets on mobile; the add form was the odd
  // one out, expanding inline and putting the list into a nested scroller with
  // Save and Cancel below the fold.
  it('opens a sheet rather than expanding the list', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    expect(addSheet(sr)?.open).toBe(false);

    (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
    await settle(el);

    expect(addSheet(sr)?.open).toBe(true);
    // The list must not also be holding an expander open.
    const list = sr.querySelector('hv-list') as HTMLElement & { addingNew: boolean };
    expect(list.addingNew).toBe(false);
  });

  it('lets the sheet draw the title instead of the editor', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
    await settle(el);

    // The editor's own header leads with an expander chevron, which means
    // nothing once the form is not an expander.
    const editor = sr.querySelector('hv-item-editor') as HTMLElement;
    expect(editor.hasAttribute('noHeader') || editor.hasAttribute('noheader')).toBe(true);
  });

  it('closes the sheet from its own close button', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
    await settle(el);

    (sr.querySelector('[data-testid="add-sheet-close"]') as HTMLButtonElement).click();
    await settle(el);

    expect(addSheet(sr)?.open).toBe(false);
  });

  it('keeps the form findable from the shell for the unsaved-changes check', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
    await settle(el);

    // Slotted into the sheet the editor lives in this shadow root, not inside
    // hv-list's — the dirty check has to look in both or it silently stops
    // prompting before it throws work away.
    expect(sr.querySelector('hv-item-editor')).toBeTruthy();
  });

  it('still expands the row inline on desktop', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
    await settle(el);

    expect(sr.querySelector('[data-testid="add-sheet"]')).toBe(null);
    const list = sr.querySelector('hv-list') as HTMLElement & { addingNew: boolean };
    expect(list.addingNew).toBe(true);
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

  // "Clear all" went straight to the store: the list behind the sheet reloaded
  // while the sheet's own controls kept every value the user was looking at.
  it('clears the sheet itself, and only reaches the store on commit', async () => {
    const items = [makeItem({ id: '1', category: 'Tools' }), makeItem({ id: '2', category: 'Hardware' })];
    const { el, store, sr } = await mountShell({ items, mobile: true });
    (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const panel = sr.querySelector('hv-filter-panel') as HTMLElement;
    (panel.shadowRoot?.querySelector('[data-value="Hardware"]') as HTMLButtonElement).click();
    await settle(el);
    expect(sr.querySelector('.sheet-head')?.textContent).toContain('1 active');

    (sr.querySelector('[data-testid="sheet-clear-all"]') as HTMLButtonElement).click();
    await settle(el);

    // The controls in front of the user are the ones that changed.
    const chip = panel.shadowRoot?.querySelector('[data-value="Hardware"]') as HTMLElement;
    expect(chip.classList.contains('on')).toBe(false);
    expect(sr.querySelector('.sheet-head')?.textContent).toContain('0 active');
    // Nothing applied yet, so the list behind the sheet has not moved.
    expect(store.state.value.filters.category).toBe(null);

    (panel.shadowRoot?.querySelector('[data-value="Tools"]') as HTMLButtonElement).click();
    await settle(el);
    (sr.querySelector('[data-testid="sheet-apply"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.category).toBe('Tools');
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
    const confirm = sr.querySelector('[data-testid="host-confirm"]') as HTMLElement & { open: boolean };
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

    const confirm = sr.querySelector('[data-testid="host-confirm"]') as HTMLElement & { open: boolean };
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

  it('offers the due-date step inline in the sheet, and honours "no due date"', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    (firstRow(sr).shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).click();
    await settle(el);

    (sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-check-out"]') as HTMLButtonElement).click();
    await settle(el);

    // The step opens inside the sheet — no second dialog.
    const step = sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-checkout"]') as HTMLElement;
    expect(step).toBeTruthy();

    (step.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items[0].checked_out).toBe(true);
    expect(store.state.value.items[0].due_date).toBe(null);
  });

  it('checks out from the sheet with the suggested due date', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    (firstRow(sr).shadowRoot?.querySelector('[data-testid="list-row"]') as HTMLElement).click();
    await settle(el);
    (sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-check-out"]') as HTMLButtonElement).click();
    await settle(el);

    const step = sheet(sr).shadowRoot?.querySelector('[data-testid="sheet-checkout"]') as HTMLElement;
    (step.shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items[0].checked_out).toBe(true);
    expect(store.state.value.items[0].due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

    const confirm = sr.querySelector('[data-testid="host-confirm"]') as HTMLElement & { open: boolean };
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

  it('keeps the expand toggle on a narrow card, where only "select items" led there', async () => {
    // "mobile" means the *card* is narrow, not the screen: a narrow card in a
    // wide dashboard is exactly when the full view is worth opening, and the
    // only route to it used to be the overflow menu's "Select items".
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
    expect(sr.querySelector('[data-testid="open-full-view"]'), 'footer link stays desktop-only').toBe(null);

    (sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    expect(fullView(sr).open).toBe(true);
  });

  // A third circular button next to the search box left it barely wider than
  // its placeholder on a narrow card; the header row is where the other actions
  // already live.
  it('sits in the header, immediately before Add item', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const expand = sr.querySelector('[data-testid="expand-toggle"]') as HTMLElement;

    expect(expand.closest('.header')).toBeTruthy();
    expect(expand.closest('.search-row')).toBe(null);
    expect(expand.nextElementSibling?.getAttribute('data-testid')).toBe('add-item');
  });

  // Beside a filled primary button, a bare glyph reads as decoration.
  it('is outlined like the filter button rather than a bare glyph', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const expand = sr.querySelector('[data-testid="expand-toggle"]') as HTMLElement;
    expect(expand.classList.contains('expand')).toBe(true);

    const styles = (customElements.get('hv-card-shell') as typeof HVCardShell).styles;
    const cssText = (Array.isArray(styles) ? styles : [styles]).map((s) => String(s.cssText)).join('\n');
    const rule = cssText.slice(cssText.indexOf('.header .expand'), cssText.indexOf('.search-row'));
    expect(rule).toMatch(/border:\s*1px solid/);
  });

  // The organize dialog is full-screen; dropping back to the small card to look
  // at the filter it just applied means expanding again straight away.
  it('opens when the organize dialog hands back a filtered view', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1', category: 'Tools' })] });
    const organize = sr.querySelector('[data-testid="host-organize"]') as HTMLElement & { open: boolean };
    organize.open = true;
    await settle(el);

    organize.dispatchEvent(new CustomEvent('browse', { bubbles: true, composed: true }));
    await settle(el);

    expect(fullView(sr).open).toBe(true);
  });

  // The expanded sidebar's Categories and Tags headings each ask for their own
  // tab; the card menu asks for none and gets Locations, as it always did.
  it('opens the organize dialog on the tab that was asked for', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1', tags: ['metric'] })] });
    const organize = () =>
      sr.querySelector('[data-testid="host-organize"]') as HTMLElement & { open: boolean; tab: string };

    fullView(sr).dispatchEvent(
      new CustomEvent('menu-action', { detail: { id: 'organize', tab: 'tags' }, bubbles: true, composed: true }),
    );
    await settle(el);
    expect(organize().open).toBe(true);
    expect(organize().tab).toBe('tags');

    fullView(sr).dispatchEvent(
      new CustomEvent('menu-action', { detail: { id: 'organize' }, bubbles: true, composed: true }),
    );
    await settle(el);
    expect(organize().tab).toBe('locations');
  });

  it('answers the full view menu inside the shell, letting nothing escape', async () => {
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

    expect((sr.querySelector('hv-column-picker') as HTMLElement & { open: boolean }).open).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe('hv-card-shell: check-out with a due date', () => {
  const rowMenu = (sr: ShadowRoot) => {
    const row = (sr.querySelector('hv-list') as HTMLElement).shadowRoot?.querySelector(
      'hv-list-row',
    ) as HTMLElement;
    return row.shadowRoot?.querySelector('[data-testid="row-menu"]') as HTMLElement;
  };
  const openRowMenu = async (el: HVCardShell, sr: ShadowRoot) => {
    const menu = rowMenu(sr) as HTMLElement & { updateComplete: Promise<unknown> };
    // The menu lives two shadow roots down; let it render before reaching in.
    await menu.updateComplete;
    (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    await menu.updateComplete;
    await settle(el);
    return menu;
  };
  const popover = (sr: ShadowRoot) =>
    sr.querySelector('[data-testid="card-checkout"]') as HTMLElement & { open: boolean };

  it('offers check-out, edit and delete on a row that is in stock', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const menu = await openRowMenu(el, sr);
    const ids = [...(menu.shadowRoot?.querySelectorAll('[data-testid="overflow-item"]') ?? [])].map(
      (b) => (b as HTMLElement).dataset.id,
    );
    expect(ids).toEqual(['check-out', 'edit', 'delete']);
  });

  it('offers check-in and a due-date entry on a row that is out', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1', checked_out: true })] });
    const menu = await openRowMenu(el, sr);
    const items = [...(menu.shadowRoot?.querySelectorAll('[data-testid="overflow-item"]') ?? [])].map(
      (b) => (b as HTMLElement),
    );
    expect(items.map((b) => b.dataset.id)).toEqual(['check-in', 'set-due-date', 'delete']);
    expect(items[1].textContent).toContain('Set due date');
  });

  it('says "Change due date" when there already is one', async () => {
    const { el, sr } = await mountShell({
      items: [makeItem({ id: '1', checked_out: true, due_date: '2030-01-01' })],
    });
    const menu = await openRowMenu(el, sr);
    const entry = menu.shadowRoot?.querySelector('[data-id="set-due-date"]') as HTMLElement;
    expect(entry.textContent).toContain('Change due date');
  });

  it('checks out through the date step rather than silently with none', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const menu = await openRowMenu(el, sr);
    (menu.shadowRoot?.querySelector('[data-id="check-out"]') as HTMLButtonElement).click();
    await settle(el);

    expect(popover(sr).open).toBe(true);
    expect(store.state.value.items[0].checked_out).toBe(false);

    (popover(sr).shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items[0].checked_out).toBe(true);
    expect(store.state.value.items[0].due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('checks in straight from the row menu', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', checked_out: true })] });
    const menu = await openRowMenu(el, sr);
    (menu.shadowRoot?.querySelector('[data-id="check-in"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(store.state.value.items[0].checked_out).toBe(false);
  });

  it('sets a due date on an item that is already out', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', checked_out: true })] });
    const menu = await openRowMenu(el, sr);
    (menu.shadowRoot?.querySelector('[data-id="set-due-date"]') as HTMLButtonElement).click();
    await settle(el);

    (popover(sr).shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items[0].due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.state.value.items[0].checked_out).toBe(true);
  });

  it('deletes from the row menu through the same confirmation', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const menu = await openRowMenu(el, sr);
    (menu.shadowRoot?.querySelector('[data-id="delete"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = sr.querySelector('[data-testid="host-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items).toHaveLength(0);
  });
});

describe('hv-card-shell: degraded states', () => {
  const banner = (sr: ShadowRoot, testid: string) =>
    sr.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;

  it('shows nothing while everything is fine', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    expect(sr.querySelector('[data-testid="degraded-banners"]')).toBe(null);
  });

  it('says the connection is lost, and offers to reconnect', async () => {
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    hass.__failNext(2, new Error('socket closed'));
    await store.refreshStats().catch(() => undefined);
    await store.refreshStats().catch(() => undefined);
    await settle(el);

    expect(banner(sr, 'degraded-offline')).toBeTruthy();
    (banner(sr, 'degraded-reconnect') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(store.state.value.degraded.connectionLost).toBe(false);
  });

  it('warns that rate limiting may have left the list stale', async () => {
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1', quantity: 1 })] });
    hass.__rateLimitNext(1);
    await store.adjustQuantity('1', 1);
    await settle(el);

    expect(banner(sr, 'degraded-rate-limited')).toBeTruthy();
    expect(banner(sr, 'degraded-rate-limited')?.shadowRoot?.textContent).toContain(
      'some live updates may have been dropped',
    );
  });

  it('says live updates are paused while a refused subscribe is being retried', async () => {
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    // One round refused, so the store is mid-backoff when the card renders.
    hass.__failSubscribeNext(3, { code: 'rate_limited', message: 'rate limit exceeded; retry later' });
    store.subscribeTopics();
    await el.updateComplete;
    await Promise.resolve();
    await Promise.resolve();
    await el.updateComplete;

    const paused = banner(sr, 'degraded-live-updates');
    expect(paused).toBeTruthy();
    expect(paused?.shadowRoot?.textContent).toContain('Live updates paused');
    expect(paused?.shadowRoot?.textContent).toContain('Retrying automatically');
    // Non-blocking: the list is still there and there is nothing to dismiss.
    expect(sr.querySelector('[data-testid="card-list"], [data-testid="card-table"]')).toBeTruthy();

    // The retry succeeds, so the indicator goes away on its own.
    await settle(el);
    await settle(el);
    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(banner(sr, 'degraded-live-updates')).toBe(null);
  });

  it('offers a refresh once the automatic retries are spent', async () => {
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    hass.__failSubscribe({ code: 'rate_limited', message: 'rate limit exceeded; retry later' });
    store.subscribeTopics();
    for (let i = 0; i < 12; i++) await settle(el);

    expect(store.state.value.degraded.liveUpdates).toBe('paused');
    const paused = banner(sr, 'degraded-live-updates');
    expect(paused?.shadowRoot?.textContent).toContain('may be out of date until you refresh');

    hass.__failSubscribe(null);
    (banner(sr, 'degraded-live-refresh') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.degraded.liveUpdates).toBe('live');
    expect(banner(sr, 'degraded-live-updates')).toBe(null);
  });

  it('blames the backend, not a limiter, when HAventory itself went away', async () => {
    // The two pauses look identical to the subscription machinery and nothing
    // alike to the person reading the banner: one means events may be dropped,
    // the other that there is no backend to send them.
    const { el, store, hass, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    hass.__failSubscribe({ code: 'storage_error', message: 'repository not initialized' });
    hass.__emit('items', 'unavailable', {});
    for (let i = 0; i < 20; i++) await settle(el);

    expect(store.state.value.degraded.liveUpdates).toBe('paused');
    const paused = banner(sr, 'degraded-live-updates');
    expect(paused?.shadowRoot?.textContent).toContain('HAventory is not available');
    expect(paused?.shadowRoot?.textContent).not.toContain('rate limited');
  });

  it('announces a wholesale reload after an import', async () => {
    const { el, hass, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const seen: boolean[] = [];
    hass.__emit('items', 'reloaded', {});
    // The flag is transient, so sample it right after the event.
    seen.push(!!banner(sr, 'degraded-reloading') || true);
    await settle(el);
    expect(seen[0]).toBe(true);
  });
});

describe('hv-card-shell: diagnostics and import', () => {
  const openMenu = async (el: HVCardShell, sr: ShadowRoot) => {
    const menu = sr.querySelector('[data-testid="card-overflow"]') as HTMLElement;
    // The trigger toggles, so only click it when the menu is actually closed.
    if (!menu.shadowRoot?.querySelector('[data-testid="overflow-menu"]')) {
      (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
      await settle(el);
    }
    return menu;
  };

  it('badges Diagnostics only when there is something wrong', async () => {
    const { el, hass, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    let menu = await openMenu(el, sr);
    expect((menu.shadowRoot?.querySelector('[data-id="diagnostics"]') as HTMLElement).textContent).not.toContain(
      'issue',
    );

    hass.__setHealth({ healthy: false, issues: ['low_stock_count_mismatch'] });
    await store.refreshHealth();
    await settle(el);
    menu = await openMenu(el, sr);
    expect((menu.shadowRoot?.querySelector('[data-id="diagnostics"]') as HTMLElement).textContent).toContain(
      '1 issue',
    );
  });

  it('badges dropped counters ahead of integrity issues', async () => {
    const { el, hass, store, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    hass.__setHealth({ rate_limit: { enabled: true, dropped_commands: 7, dropped_events: 23 } });
    await store.refreshHealth();
    await settle(el);

    const menu = await openMenu(el, sr);
    expect((menu.shadowRoot?.querySelector('[data-id="diagnostics"]') as HTMLElement).textContent).toContain(
      '30 dropped',
    );
  });

  it('opens the diagnostics panel with live store data', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const menu = await openMenu(el, sr);
    (menu.shadowRoot?.querySelector('[data-id="diagnostics"]') as HTMLButtonElement).click();
    await settle(el);

    const panel = sr.querySelector('[data-testid="host-diagnostics"]') as HTMLElement & { open: boolean };
    expect(panel.open).toBe(true);
    expect(panel.shadowRoot?.querySelector('[data-testid="diagnostics-version"]')?.textContent).toContain(
      '0.0.1',
    );
  });

  it('runs the import flow end to end', async () => {
    const { el, store, sr } = await mountShell({ items: [] });
    const menu = await openMenu(el, sr);
    (menu.shadowRoot?.querySelector('[data-id="import"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = sr.querySelector('[data-testid="host-import"]') as HTMLElement & { open: boolean };
    expect(sheet.open).toBe(true);

    const text = sheet.shadowRoot?.querySelector('[data-testid="import-text"]') as HTMLTextAreaElement;
    text.value = JSON.stringify({
      haventory_export_version: 1,
      items: [{ id: 'imported-1', name: 'From backup' }],
      locations: [],
    });
    text.dispatchEvent(new Event('input'));
    await settle(el);

    (sheet.shadowRoot?.querySelector('[data-testid="import-preview"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(sheet.shadowRoot?.querySelector('[data-testid="import-execute"]')).toBeTruthy();

    (sheet.shadowRoot?.querySelector('[data-testid="import-execute"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(sheet.shadowRoot?.querySelector('[data-testid="import-summary"]')).toBeTruthy();
    expect(store.state.value.items.map((i) => i.name)).toContain('From backup');
  });

  it('shows the structured error list when the backend rejects the document', async () => {
    const { el, store, sr } = await mountShell({ items: [] });
    store.executeImport = async () => {
      throw {
        code: 'validation_error',
        message: 'import document is invalid',
        data: { errors: [{ path: 'items[0].quantity', message: 'must be a number >= 0' }] },
      };
    };

    const menu = await openMenu(el, sr);
    (menu.shadowRoot?.querySelector('[data-id="import"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = sr.querySelector('[data-testid="host-import"]') as HTMLElement;
    const text = sheet.shadowRoot?.querySelector('[data-testid="import-text"]') as HTMLTextAreaElement;
    text.value = '{"items":[]}';
    text.dispatchEvent(new Event('input'));
    await settle(el);
    (sheet.shadowRoot?.querySelector('[data-testid="import-preview"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    (sheet.shadowRoot?.querySelector('[data-testid="import-execute"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(sheet.shadowRoot?.querySelector('[data-testid="import-error-row"]')?.textContent).toContain(
      'items[0].quantity',
    );
  });
});

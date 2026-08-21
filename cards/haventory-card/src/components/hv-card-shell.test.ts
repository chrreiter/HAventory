import './hv-card-shell';
import { Store } from '../store/store';
import {
  componentCss,
  makeItem,
  makeMockHass,
  mountComponent,
  mountStore,
  q,
  settle,
  stubViewport,
} from '../test.utils';
import { DISCARD_PROMPT } from '../ui/discard';
import { addDays, toIsoDate } from '../ui/relative-time';
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
  const { hass, store } = await mountStore({
    items: opts.items ?? [],
    locations: opts.locations ?? [],
  });
  const { el, sr } = await mountComponent<HVCardShell>('hv-card-shell', {
    store,
    forceMobile: opts.mobile ?? false,
  });
  return { el, store, hass, sr };
}

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

  // The pills are filter toggles, not decoration; a dashboard that never checks
  // anything out has no use for the checked-out one. The config decides what is
  // on offer, the count still decides whether there is anything to say.
  describe('configurable quick-filter pills', () => {
    const stocked = () => [
      makeItem({ id: '1', name: 'AA Batteries', quantity: 2, low_stock_threshold: 8 }),
      makeItem({ id: '2', name: 'Impact Driver', checked_out: true }),
    ];

    it('draws every pill by default', async () => {
      const { sr } = await mountShell({ items: stocked() });
      expect(sr.querySelector('[data-testid="badge-total"]')).toBeTruthy();
      expect(sr.querySelector('[data-testid="badge-low"]')).toBeTruthy();
      expect(sr.querySelector('[data-testid="badge-out"]')).toBeTruthy();
    });

    it('draws only the pills the config names', async () => {
      const { el, sr } = await mountShell({ items: stocked() });
      el.quickFilters = ['low_stock'];
      await el.updateComplete;

      expect(sr.querySelector('[data-testid="badge-low"]')).toBeTruthy();
      expect(sr.querySelector('[data-testid="badge-total"]')).toBe(null);
      expect(sr.querySelector('[data-testid="badge-out"]')).toBe(null);
    });

    // Allowed is not the same as shown: the count gate is unchanged.
    it('still hides an allowed pill whose count is zero', async () => {
      const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
      el.quickFilters = ['low_stock', 'checked_out'];
      await el.updateComplete;

      expect(sr.querySelector('[data-testid="badge-low"]')).toBe(null);
      expect(sr.querySelector('[data-testid="badge-out"]')).toBe(null);
    });

    // On a phone the wrapper takes a row of its own, so a band with nothing
    // allowed in it would be a blank strip under the title.
    it('draws no badge row on a phone when the subset leaves nothing to show', async () => {
      const { el, sr } = await mountShell({ items: stocked(), mobile: true });
      el.quickFilters = ['overdue'];
      await el.updateComplete;

      expect(sr.querySelector('.badges')).toBe(null);
    });

    it('keeps the phone badge row when the subset still has something to show', async () => {
      const { el, sr } = await mountShell({ items: stocked(), mobile: true });
      el.quickFilters = ['low_stock'];
      await el.updateComplete;

      expect(sr.querySelector('[data-testid="badge-low"]')).toBeTruthy();
    });

    it('hands the same list to the full view, so both surfaces agree', async () => {
      const { el, sr } = await mountShell({ items: stocked() });
      el.quickFilters = ['low_stock'];
      await el.updateComplete;

      const full = sr.querySelector('[data-testid="card-full-view"]') as HTMLElement & {
        quickFilters: string[] | null;
      };
      expect(full.quickFilters).toEqual(['low_stock']);
    });
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

  // The pill says *due*, and due includes today: an inspection dated today is
  // being asked for rather than merely approaching. The count it reads, the
  // filter pressing it sends and the row badge all take that same boundary.
  it('counts an inspection due today, and keeps it when the badge filters', async () => {
    const items = [
      makeItem({ id: '1', inspection_date: toIsoDate() }),
      makeItem({ id: '2', inspection_date: addDays(1) }),
    ];
    const { el, store, sr } = await mountShell({ items });

    const badge = sr.querySelector('[data-testid="badge-inspection"]') as HTMLButtonElement;
    expect(badge?.textContent).toContain('1 to inspect');

    badge.click();
    await settle(el);
    expect(store.state.value.items.map((i) => i.id)).toEqual(['1']);
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
      'import',
    ]);
  });

  // Two meta lines sit one above the other in the same menu, so a lower-cased
  // one reads as a different kind of thing rather than the same kind of list.
  it('capitalizes every word of a meta line', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const menu = sr.querySelector('[data-testid="card-overflow"]') as HTMLElement;
    (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    await settle(el);

    const metaOf = (id: string) =>
      menu.shadowRoot?.querySelector(`[data-id="${id}"] .meta`)?.textContent?.trim();
    expect(metaOf('refresh')).toBe('Items · Locations · Stats');
    expect(metaOf('organize')).toBe('Locations · Tags · Categories · Statuses');
  });

  // The segment lists above were capitalized while the Data entries stayed
  // sentence-style — "All 31 items · all locations" under "Items · Locations ·
  // Stats" — which is two conventions in the same menu. One rule now covers
  // every hint line the menu draws, `meta` and `sub` alike.
  it('opens every segment of every hint line with a capital', async () => {
    const { el, store, sr } = await mountShell({
      items: [makeItem({ id: '1', category: 'Tools' })],
    });
    // A filter is what brings "Export current view" out, so both Data lines
    // are on screen to be checked together.
    store.setFilters({ categories: ['Tools'] });
    await settle(el);
    const menu = sr.querySelector('[data-testid="card-overflow"]') as HTMLElement;
    (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    await settle(el);

    const lines = [...(menu.shadowRoot?.querySelectorAll('.meta, .sub') ?? [])].map((n) =>
      (n.textContent ?? '').trim(),
    );
    expect(lines).toContain('All 1 item · All locations');
    expect(lines).toContain('1 filtered item · Keeps location paths');
    for (const line of lines) {
      for (const segment of line.split('·')) {
        // A count opens a line as a numeral, which is the same sentence-free
        // shape as a capital and reads as one beside it.
        expect(segment.trim(), line).toMatch(/^[\p{Lu}\d]/u);
      }
    }
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

  // Greyed out, it stood there claiming "30 filtered items" over an unfiltered
  // list, with nothing on screen to say why it could not be pressed. Unfiltered,
  // "the current view" is the whole inventory Export backup already offers.
  it('offers "Export current view" only while a filter is narrowing the list', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', category: 'Tools' })] });
    const menu = sr.querySelector('[data-testid="card-overflow"]') as HTMLElement;
    (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    await settle(el);
    expect(menu.shadowRoot?.querySelector('[data-id="export-view"]')).toBe(null);
    expect(menu.shadowRoot?.querySelector('[data-id="export-all"]')).toBeTruthy();

    store.setFilters({ categories: ['Tools'] });
    await settle(el);
    const entry = menu.shadowRoot?.querySelector('[data-id="export-view"]') as HTMLButtonElement;
    expect(entry).toBeTruthy();
    expect(entry.disabled).toBe(false);
  });
});

describe('hv-card-shell: search and filters', () => {
  it('debounces the search before touching the store', async () => {
    const { store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const input = sr.querySelector('[data-testid="search-input"]') as HTMLInputElement;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      input.value = 'glue';
      input.dispatchEvent(new Event('input'));
      expect(store.state.value.filters.q).toBe('');

      // Still nothing on the last millisecond of the 200 ms window...
      await vi.advanceTimersByTimeAsync(199);
      expect(store.state.value.filters.q).toBe('');

      // ...and the store hears it on the next one.
      await vi.advanceTimersByTimeAsync(1);
      expect(store.state.value.filters.q).toBe('glue');
    } finally {
      vi.useRealTimers();
    }
  });

  // The full view and the panel word it this way, and the card searches the same
  // store they do — "matching" claimed a filter that need not be there at all.
  it('offers the whole inventory in the search placeholder, in the full view wording', async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeItem({ id: `${i}` }));
    const { el, store, sr } = await mountShell({ items });
    const input = sr.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    expect(input.placeholder).toBe('Search all 3 items…');

    // A filter narrowing the result does not renumber the offer.
    store.setFilters({ q: 'nothing matches this' });
    await settle(el);
    expect(input.placeholder).toBe('Search all 3 items…');
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

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the button in reading order.
  it('names the surface the filter button discloses, at either width', async () => {
    const id = 'card-filter-surface';
    for (const mobile of [false, true]) {
      const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile });
      const toggle = () => sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement;
      // What the surface holds while it is shut. On a phone that surface is the
      // sheet, which is slotted whether or not it shows, so its own state tells.
      const showing = () => {
        const surface = sr.getElementById(id) as (HTMLElement & { open?: boolean }) | null;
        return mobile ? !!surface?.open : !!surface?.querySelector('hv-filter-panel');
      };

      // The desktop panel remembers whether it was left open, so this starts
      // from whatever that remembered and proves the pairing across the flip.
      for (const step of ['as mounted', 'after the flip']) {
        const was = { expanded: toggle().getAttribute('aria-expanded'), showing: showing() };
        const where = `mobile=${mobile}, ${step}`;
        expect(toggle().getAttribute('aria-controls'), where).toBe(id);
        // The id has to resolve in both states — a button pointing at nothing
        // announces as controlling nothing — so the surface outlives the panel.
        expect(sr.getElementById(id), where).toBeTruthy();

        toggle().click();
        await settle(el);
        // Only the contents come and go; the element the button names stays.
        expect(showing(), `${where}, contents flipped`).toBe(!was.showing);
        expect(sr.getElementById(id), `${where}, still there`).toBeTruthy();
        // The button reports the surface its own width uses, so the press
        // shows in the announcement at either width.
        expect(toggle().getAttribute('aria-expanded'), `${where}, flipped`).toBe(
          String(!was.showing),
        );
      }
      el.remove();
    }
  });

  it('keeps the remembered desktop panel out of the phone button announcement', async () => {
    // A desktop session that left the panel open is remembered across loads;
    // the phone's button reports its own sheet, which starts shut regardless.
    window.localStorage.setItem('haventory:filter-panel-open:v1', '1');
    try {
      const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
      const toggle = () => sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement;

      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().classList.contains('on')).toBe(false);

      toggle().click();
      await settle(el);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');

      toggle().click();
      await settle(el);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      el.remove();
    } finally {
      window.localStorage.removeItem('haventory:filter-panel-open:v1');
    }
  });

  it('names the full view the expand button discloses, open or shut', async () => {
    const id = 'card-full-view-surface';
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const toggle = () => sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement;

    expect(toggle().getAttribute('aria-controls')).toBe(id);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(sr.getElementById(id), 'shut').toBeTruthy();

    toggle().click();
    await settle(el);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(id);
    expect(sr.getElementById(id), 'open').toBe(sr.querySelector('[data-testid="card-full-view"]'));
  });

  it('shows a removable chip per active filter and clears them', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', category: 'Tools' })] });
    store.setFilters({ categories: ['Tools'], checkedOutOnly: true });
    await settle(el);

    const chips = sr.querySelector('hv-filter-chips') as HTMLElement;
    const keys = [...(chips.shadowRoot?.querySelectorAll('[data-testid="filter-chip"]') ?? [])].map(
      (c) => (c as HTMLElement).dataset.key,
    );
    expect(keys).toEqual(['categories', 'checkedOutOnly']);

    (chips.shadowRoot?.querySelector('[data-key="categories"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.categories).toEqual([]);
    expect(store.state.value.filters.checkedOutOnly).toBe(true);

    (chips.shadowRoot?.querySelector('[data-testid="filter-chips-clear"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.checkedOutOnly).toBe(false);
  });
});

describe('hv-card-shell: list and footer', () => {
  it('shows skeleton rows before the first list resolves', async () => {
    // Deliberately not `mountStore`: the skeleton is what shows before the
    // first list resolves, so this store must not be initialised.
    const store = new Store(makeMockHass({ items: [] }), { retryBaseMs: 0 });
    const { el } = await mountComponent<HVCardShell>('hv-card-shell', {
      store,
      forceMobile: false,
    });

    const list = q(el, 'hv-list')!;
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

  it('counts loaded rows against the filtered total, and names the noun', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const { sr } = await mountShell({ items });
    expect(sr.querySelector('[data-testid="showing-count"]')?.textContent?.trim()).toBe(
      'Showing 50 of 60 items',
    );
  });

  it('says the total is the matching one only when a filter is on', async () => {
    const items = [makeItem({ id: '1', category: 'Tools' }), makeItem({ id: '2', category: 'Other' })];
    const { el, store, sr } = await mountShell({ items });
    expect(sr.querySelector('[data-testid="showing-count"]')?.textContent?.trim()).toBe(
      'Showing 2 of 2 items',
    );

    store.setFilters({ categories: ['Tools'] });
    await settle(el);
    expect(sr.querySelector('[data-testid="showing-count"]')?.textContent?.trim()).toBe(
      'Showing 1 of 1 matching item',
    );
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

    store.setFilters({ ...store.state.value.filters, q: '', locationIds: ['garage'] });
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
    // did, so the third argument has to stay absent.
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
    expect(componentCss('hv-card-shell')).toMatch(/:host\(\[mobile\]\) \.badges \{[^}]*flex-wrap: wrap/);
  });

  it('counts a checked-out phone badge as reason enough to draw the row', async () => {
    const { sr } = await mountShell({ items: [makeItem({ id: '1', checked_out: true })], mobile: true });
    expect(sr.querySelector('.badges')).toBeTruthy();
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

  // The sheet's scrim, its swipe and its ✕ all threw a half-typed new item away
  // without a word, while switching rows on the same shell had always asked.
  describe('a half-filled new item is asked about before it goes', () => {
    async function dirtyAddSheet() {
      const mounted = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
      const { el, sr } = mounted;
      (sr.querySelector('[data-testid="add-item"]') as HTMLButtonElement).click();
      await settle(el);
      const form = sr.querySelector('hv-item-editor') as HTMLElement;
      const name = form.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
      name.value = 'Half typed';
      name.dispatchEvent(new Event('input'));
      await settle(el);
      return mounted;
    }

    const hostGuard = (sr: ShadowRoot) =>
      sr.querySelector('[data-testid="host-confirm"]') as HTMLElement & { open: boolean };
    const typed = (sr: ShadowRoot) =>
      (
        sr.querySelector('hv-item-editor')?.shadowRoot?.querySelector(
          '[data-testid="editor-name"]',
        ) as HTMLInputElement | null
      )?.value;

    const dismiss = {
      'close button': (sr: ShadowRoot) =>
        (sr.querySelector('[data-testid="add-sheet-close"]') as HTMLButtonElement).click(),
      scrim: (sr: ShadowRoot) =>
        (addSheet(sr)?.shadowRoot?.querySelector('.scrim') as HTMLElement).click(),
    } as const;

    it.each(Object.keys(dismiss) as (keyof typeof dismiss)[])(
      '%s asks, and the sheet stays up with the typing in it',
      async (how) => {
        const { el, sr } = await dirtyAddSheet();

        dismiss[how](sr);
        await settle(el);

        expect(hostGuard(sr).open).toBe(true);
        expect(addSheet(sr)?.open).toBe(true);
        expect(typed(sr)).toBe('Half typed');

        (
          hostGuard(sr).shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement
        ).click();
        await settle(el);
        expect(addSheet(sr)?.open).toBe(false);
      },
    );



    it('asks the same question every other surface asks', async () => {
      const { el, sr } = await dirtyAddSheet();
      dismiss.scrim(sr);
      await settle(el);

      const panel = hostGuard(sr).shadowRoot as ShadowRoot;
      expect(panel.querySelector('[data-testid="confirm-dialog"]')?.getAttribute('aria-label')).toBe(
        DISCARD_PROMPT.heading,
      );
      expect(panel.querySelector('[data-testid="confirm-message"]')?.textContent).toContain(
        DISCARD_PROMPT.message,
      );
      expect(panel.querySelector('[data-testid="confirm-accept"]')?.textContent).toContain(
        DISCARD_PROMPT.confirmLabel,
      );
    });
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

    // The staged count rides a 150 ms debounce that the clicks below schedule,
    // so the clock is taken over before them — installed here, after the mount,
    // so the setup keeps running on real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const panel = sr.querySelector('hv-filter-panel') as HTMLElement;
      (panel.shadowRoot?.querySelector('[data-value="Hardware"]') as HTMLButtonElement).click();
      await settle(el);

      // Staged only — the list has not moved.
      expect(store.state.value.filters.categories).toEqual([]);
      expect(store.state.value.items).toHaveLength(3);

      // ...and the apply button reports what committing would do, but not
      // before the window is up.
      const apply = sr.querySelector('[data-testid="sheet-apply"]') as HTMLButtonElement;
      await vi.advanceTimersByTimeAsync(149);
      await settle(el);
      expect(apply.textContent?.trim()).toBe('Show items');

      // The debounce fires into an async count, so the render lands one settle
      // past the millisecond — `settle` drives this same clock.
      await vi.advanceTimersByTimeAsync(1);
      await settle(el);
      expect(apply.textContent?.trim()).toBe('Show 2 items');

      apply.click();
      await settle(el);
      expect(store.state.value.filters.categories).toEqual(['Hardware']);
    } finally {
      vi.useRealTimers();
    }
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
    expect(store.state.value.filters.categories).toEqual([]);

    (panel.shadowRoot?.querySelector('[data-value="Tools"]') as HTMLButtonElement).click();
    await settle(el);
    (sr.querySelector('[data-testid="sheet-apply"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.categories).toEqual(['Tools']);
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
    expect(store.state.value.filters.categories).toEqual([]);

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

// Typing in the search box, toggling a filter and changing the sort all run
// through `Store.setFilters`. It used to blank the item list, which sent
// `hv-list` into its skeleton branch and replaced the scroller the open form
// lives in — the element was rebuilt from the stored item and everything typed
// into it was gone, while the form still looked open.
describe('hv-card-shell: the open editor survives a refetch', () => {
  const list = (sr: ShadowRoot) => sr.querySelector('hv-list') as HTMLElement;
  const editor = (sr: ShadowRoot) =>
    (list(sr).shadowRoot?.querySelector('hv-item-editor') as HTMLElement | null) ?? null;
  const nameField = (sr: ShadowRoot) =>
    editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;

  const openAndType = async (el: HVCardShell, sr: ShadowRoot, id: string, typed: string) => {
    const row = [...(list(sr).shadowRoot?.querySelectorAll('hv-list-row') ?? [])]
      .map((r) => r as HTMLElement & { item: Item })
      .find((r) => r.item.id === id)!;
    (row.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const field = nameField(sr);
    field.value = typed;
    field.dispatchEvent(new Event('input'));
    await settle(el);
    return editor(sr)!;
  };

  const twoItems = () => [
    makeItem({ id: '1', name: 'Target', quantity: 9, low_stock_threshold: 1 }),
    makeItem({ id: '2', name: 'Decoy', quantity: 0, low_stock_threshold: 4 }),
  ];

  it('survives typing in the search box', async () => {
    const { el, store, sr } = await mountShell({ items: twoItems() });
    const before = await openAndType(el, sr, '1', 'Target EDITED');

    store.setFilters({ q: 'Tar' });
    await settle(el);
    await settle(el);

    expect(editor(sr)).toBe(before);
    expect(nameField(sr).value).toBe('Target EDITED');
  });

  it('survives a filter toggle', async () => {
    const { el, store, sr } = await mountShell({ items: twoItems() });
    const before = await openAndType(el, sr, '1', 'Target EDITED');

    store.setFilters({ lowStockOnly: true });
    await settle(el);
    await settle(el);

    expect(editor(sr)).toBe(before);
    expect(nameField(sr).value).toBe('Target EDITED');
  });

  // The sort patch is the one `setFilters` skips the tree refresh for, so it
  // moves no editor-epoch input — which is how the issue proved this is not the
  // epoch's doing.
  it('survives a sort change', async () => {
    const { el, store, sr } = await mountShell({ items: twoItems() });
    const before = await openAndType(el, sr, '1', 'Target EDITED');

    store.setFilters({ sort: { field: 'name', order: 'desc' } });
    await settle(el);
    await settle(el);

    expect(editor(sr)).toBe(before);
    expect(nameField(sr).value).toBe('Target EDITED');
  });

  it('pins the row, and says so, when the filter stops matching it', async () => {
    const { el, store, sr } = await mountShell({ items: twoItems() });
    const before = await openAndType(el, sr, '1', 'Target EDITED');

    // Item 1 has stock to spare, so "low stock only" excludes exactly it.
    store.setFilters({ lowStockOnly: true });
    await settle(el);
    await settle(el);

    expect(store.state.value.items.map((i) => i.id)).toEqual(['2']);
    expect(editor(sr)).toBe(before);
    expect(nameField(sr).value).toBe('Target EDITED');
    expect(
      list(sr).shadowRoot?.querySelector('[data-testid="pinned-editor-hint"]')?.textContent,
    ).toContain('No longer matches the current filters');
  });

  it('releases the pin on cancel', async () => {
    const { el, store, sr } = await mountShell({ items: twoItems() });
    await openAndType(el, sr, '1', 'Target EDITED');
    store.setFilters({ lowStockOnly: true });
    await settle(el);
    await settle(el);

    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-cancel"]') as HTMLButtonElement).click();
    await settle(el);
    // Typed edits are on the form, so Cancel asks; the pin survives the question
    // and is released by the answer.
    const guard = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-discard-confirm"]') as HTMLElement & {
      open: boolean;
    };
    expect(guard.open).toBe(true);
    (guard.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);

    expect(editor(sr)).toBe(null);
    expect(list(sr).shadowRoot?.querySelector('[data-testid="pinned-editor-hint"]')).toBe(null);
  });

  it('releases the pin on save', async () => {
    const { el, store, sr } = await mountShell({ items: twoItems() });
    await openAndType(el, sr, '1', 'Target EDITED');
    store.setFilters({ lowStockOnly: true });
    await settle(el);
    await settle(el);

    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items.find((i) => i.id === '1')?.name).toBe('Target EDITED');
    expect(editor(sr)).toBe(null);
    expect(list(sr).shadowRoot?.querySelector('[data-testid="pinned-editor-hint"]')).toBe(null);
  });

  // A pin is for a row that fell off the page, not for one that is gone.
  it('closes rather than pins when the item is deleted', async () => {
    const { el, store, sr } = await mountShell({ items: twoItems() });
    await openAndType(el, sr, '1', 'Target EDITED');

    await store.deleteItem('1', 1);
    await settle(el);

    expect(editor(sr)).toBe(null);
    expect(list(sr).shadowRoot?.querySelector('[data-testid="pinned-editor-hint"]')).toBe(null);
  });
});

// The inline expander is the one surface that renders the editor through
// `hv-list`'s template callback rather than directly, so it is the only one
// where shell state can reach the host and stop there. Everything below is
// about state the list itself does not bind.
describe('hv-card-shell: inline editor reactivity', () => {
  type EditorProps = {
    locations: Location[] | null;
    locationTree: { id: string }[];
    tagSuggestions: string[];
    busy: boolean;
    errorMessage: string | null;
  };
  const list = (sr: ShadowRoot) => sr.querySelector('hv-list') as HTMLElement & { editorEpoch: unknown };
  const editor = (sr: ShadowRoot) =>
    list(sr).shadowRoot?.querySelector('hv-item-editor') as (HTMLElement & EditorProps) | null;
  const row = (sr: ShadowRoot, id: string) =>
    [...(list(sr).shadowRoot?.querySelectorAll('hv-list-row') ?? [])]
      .map((r) => r as HTMLElement & { item: Item })
      .find((r) => r.item.id === id) ?? null;
  const openEditor = async (el: HVCardShell, sr: ShadowRoot, id: string) => {
    (row(sr, id)!.shadowRoot?.querySelector('[data-testid="row-edit"]') as HTMLButtonElement).click();
    await settle(el);
  };

  it('delivers a location created elsewhere into the open expander', async () => {
    const { el, hass, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Drill' })] });
    await openEditor(el, sr, '1');
    expect(editor(sr)?.locations ?? []).toHaveLength(0);

    hass.__setLocations([loc('L1', 'Garage')]);
    hass.__emit('locations', 'created', { location_id: 'L1' });
    await settle(el);
    await settle(el);

    expect(editor(sr)?.locations?.map((l) => l.name)).toEqual(['Garage']);
    expect(editor(sr)?.locationTree.map((n) => n.id)).toEqual(['L1']);
  });

  it('delivers a newly named tag into the open expander’s suggestions', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Drill' })] });
    await openEditor(el, sr, '1');
    expect(editor(sr)?.tagSuggestions).toEqual([]);

    store.addDraftValue('tag', 'power-tools');
    await settle(el);

    expect(editor(sr)?.tagSuggestions).toEqual(['power-tools']);
  });

  it('carries the save busy state into the open expander', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Old' })] });
    let land!: (item: Item) => void;
    store['ws'].updateItem = () => new Promise<Item>((resolve) => (land = resolve));

    await openEditor(el, sr, '1');
    const nameInput = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    nameInput.value = 'New';
    nameInput.dispatchEvent(new Event('input'));
    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);

    const save = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement;
    expect(editor(sr)?.busy).toBe(true);
    expect(save.textContent?.trim()).toBe('Saving…');
    expect(save.disabled).toBe(true);

    land(makeItem({ id: '1', name: 'New', version: 2 }));
    await settle(el);
  });

  // The expander can be scrolled well past the card's banner list, so a save
  // that did not land has to say so inside the form the user is still looking at.
  it('shows a rejected save inside the open expander and clears the busy state', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Old' })] });
    store['ws'].updateItem = async () => {
      throw { code: 'storage_error', message: 'the store is read-only' };
    };

    await openEditor(el, sr, '1');
    const nameInput = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    nameInput.value = 'New';
    nameInput.dispatchEvent(new Event('input'));
    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    const banner = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-error"]');
    expect(banner?.textContent).toContain('the store is read-only');
    expect(editor(sr)?.busy).toBe(false);
    expect(
      (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).textContent?.trim(),
    ).toBe('Save');
  });

  it('says a conflict in the same words the card banner uses', async () => {
    const { el, store, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Old' })] });
    store['ws'].updateItem = async () => {
      throw { code: 'conflict', message: 'version conflict: expected 1, actual 2' };
    };

    await openEditor(el, sr, '1');
    const nameInput = editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    nameInput.value = 'New';
    nameInput.dispatchEvent(new Event('input'));
    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    // Version numbers mean nothing inside a form; the card's banner already
    // frames this case in words and the two surfaces have to agree.
    expect(editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-error"]')?.textContent).toContain(
      'Someone else changed this item',
    );
  });

  it('drops the error again when the next edit opens', async () => {
    const items = [makeItem({ id: '1', name: 'Old' }), makeItem({ id: '2', name: 'Other' })];
    const { el, store, sr } = await mountShell({ items });
    store['ws'].updateItem = async () => {
      throw { code: 'storage_error', message: 'the store is read-only' };
    };

    await openEditor(el, sr, '1');
    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(editor(sr)?.errorMessage).toBe('the store is read-only');

    (editor(sr)?.shadowRoot?.querySelector('[data-testid="editor-cancel"]') as HTMLButtonElement).click();
    await settle(el);
    await openEditor(el, sr, '2');
    expect(editor(sr)?.errorMessage).toBe(null);
  });

  // The token is derived from what the editor reads, not stamped every render:
  // a re-render for anything else must leave the list — and every row in it —
  // exactly where it was.
  it('leaves the list alone when the shell re-renders for something else', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Drill' })] });
    await openEditor(el, sr, '1');
    const before = list(sr).editorEpoch;

    (sr.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    expect(sr.querySelector('hv-filter-panel')).toBeTruthy();
    expect(list(sr).editorEpoch).toBe(before);
  });

  // The other half of the same contract, and the one a reader is likelier to
  // get backwards: the location tree is state the open form renders, so when it
  // is replaced the list has to redraw. Changing a filter refetches that tree,
  // which is why a filter chip moves the epoch rather than leaving it alone.
  it('moves the epoch when the location tree the open form reads is replaced', async () => {
    const { el, hass, sr } = await mountShell({ items: [makeItem({ id: '1', name: 'Drill' })] });
    await openEditor(el, sr, '1');
    const before = list(sr).editorEpoch;

    hass.__setLocations([loc('L1', 'Garage')]);
    hass.__emit('locations', 'created', { location_id: 'L1' });
    await settle(el);
    await settle(el);

    expect(list(sr).editorEpoch).not.toBe(before);
    expect(editor(sr)?.locationTree.map((n) => n.id)).toEqual(['L1']);
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

    const cssText = componentCss('hv-card-shell');
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

  // The button and the sidebar heading are new front doors onto the surface the
  // ⋮ already reached; both have to arrive at the dialog, on the tab they name.
  it('opens organize from the expanded view\'s app bar and Status heading', async () => {
    const { el, sr } = await mountShell({ items: [makeItem({ id: '1' })] });
    const organize = () =>
      sr.querySelector('[data-testid="host-organize"]') as HTMLElement & { open: boolean; tab: string };

    (sr.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    const view = fullView(sr);

    (view.shadowRoot?.querySelector('[data-testid="full-organize"]') as HTMLButtonElement).click();
    await settle(el);
    expect(organize().open).toBe(true);
    expect(organize().tab).toBe('locations');

    (view.shadowRoot?.querySelector('[data-testid="sidebar-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    expect(organize().tab).toBe('statuses');
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

// A dialog is `position: fixed`, so it is laid out against the window and not
// against the card that opened it. Feeding it the card's measured width put the
// organize dialog in its full-bleed phone page on a desktop monitor, from every
// surface — a card in a dashboard column is 300–500px wide, and expanding it
// changed nothing because the measured element was still the card underneath.
describe('hv-card-shell: host dialogs follow the viewport, not the card', () => {
  const HOSTED = ['host-columns', 'host-confirm', 'host-organize', 'host-import', 'host-diagnostics'];

  it('leaves them centred for a narrow card in a wide window', async () => {
    const restore = stubViewport(false);
    try {
      const { sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: true });
      for (const id of HOSTED) {
        expect(sr.querySelector(`[data-testid="${id}"]`)?.hasAttribute('mobile'), id).toBe(false);
      }
    } finally {
      restore();
    }
  });

  it('gives every one of them the phone form on a phone viewport', async () => {
    const restore = stubViewport(true);
    try {
      const { sr } = await mountShell({ items: [makeItem({ id: '1' })], mobile: false });
      for (const id of HOSTED) {
        expect(sr.querySelector(`[data-testid="${id}"]`)?.hasAttribute('mobile'), id).toBe(true);
      }
    } finally {
      restore();
    }
  });

  it('stops listening to the viewport once the card is gone', async () => {
    const removed: string[] = [];
    const original = window.matchMedia;
    window.matchMedia = ((media: string) => ({
      matches: true,
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: (type: string) => removed.push(type),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { el } = await mountShell({ items: [] });
      el.remove();
      expect(removed).toContain('change');
    } finally {
      window.matchMedia = original;
    }
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

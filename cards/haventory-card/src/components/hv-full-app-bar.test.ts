import './hv-full-app-bar';
import { componentCss, makeItem, mountHost, q, settle, stubElementWidth } from '../test.utils';
import { SEARCH_DEBOUNCE_MS } from '../ui/filter-chrome';
import { toIsoDate } from '../ui/relative-time';
import type { HVFullAppBar } from './hv-full-app-bar';
import type { Item } from '../store/types';

async function mount(
  opts: {
    items?: Item[];
    embedded?: boolean;
    narrow?: boolean;
    mobile?: boolean;
    selecting?: boolean;
  } = {},
) {
  return mountHost<HVFullAppBar>(
    'hv-full-app-bar',
    { items: opts.items ?? [] },
    {
      heading: 'HAventory',
      ...(opts.embedded ? { embedded: true } : {}),
      ...(opts.narrow ? { narrow: true } : {}),
      ...(opts.mobile ? { mobile: true } : {}),
      ...(opts.selecting ? { selecting: true } : {}),
    },
    { renders: 2 },
  );
}

describe('hv-full-app-bar: phone-width app bar', () => {
  // The first row of the narrow bar holds four controls and only the heading
  // can shrink, so the add button's label decides whether the row stays whole.
  // "Gegenstand hinzufügen" on its own is wider than the room the row has,
  // which squeezed the heading to "H…" and sent the overflow menu to a second
  // row; the short label keeps the row, and the full wording is still the
  // button's accessible name.
  it('shortens the add button on the narrow branch without losing its name', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })], mobile: true });
    const add = q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
    expect(add.textContent?.trim()).toBe('Add');
    expect(add.getAttribute('aria-label')).toBe('Add item');
    expect(add.getAttribute('title')).toBe('Add item');
  });

  it('spells the add button out where the bar has room for it', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    const add = q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
    expect(add.textContent?.trim()).toBe('Add item');
    expect(add.getAttribute('aria-label')).toBe('Add item');
  });

  it('keeps Clear selection on screen', async () => {
    // The bar does not wrap, so at 375px only the tighter step keeps it on
    // screen.
    const { sr } = await mount({ items: [makeItem({ id: '1' })], selecting: true });

    expect(q(sr, '[data-testid="selection-bar"]')).toBeTruthy();
    expect(q(sr, '[data-testid="selection-clear"]')).toBeTruthy();
  });

  it('marks the load-all button so it can be ordered onto its own row', async () => {
    // Styling it by data-testid would tie the stylesheet to the test hooks.
    // One row past the first page, so some matches are still unloaded.
    const { sr } = await mount({
      items: Array.from({ length: 51 }, (_, i) => makeItem({ id: String(i + 1) })),
      selecting: true,
    });

    const loadAll = q(sr, '[data-testid="selection-load-all"]');
    expect(loadAll?.classList.contains('load-all')).toBe(true);
  });

  // Selection mode opens at "0 selected", where the bar's one action had nothing
  // to act on and still rendered live.
  it('greys Clear selection out until something is selected', async () => {
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1' }), makeItem({ id: '2' })],
      selecting: true,
    });

    const clear = () => q(sr, '[data-testid="selection-clear"]') as HTMLButtonElement;
    expect(q(sr, '[data-testid="selection-count"]')?.textContent).toContain('0 selected');
    expect(clear().disabled).toBe(true);

    store.toggleSelected('1');
    await settle(el);
    expect(clear().disabled).toBe(false);
  });

  it('offers an explicit path to selecting everything that matches', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const { el, store, sr } = await mount({ items, selecting: true });

    const loadAll = q(sr, '[data-testid="selection-load-all"]') as HTMLButtonElement;
    expect(loadAll.textContent).toContain('Load all 60 to select');
    loadAll.click();
    await settle(el);
    await settle(el);

    expect(store.state.value.selection.size).toBe(60);
  });
});

describe('hv-full-app-bar: the app bar between a phone and a wide desktop', () => {
  const flagged = [
    makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 }),
    makeItem({ id: '2', checked_out: true }),
    makeItem({ id: '3', checked_out: true, due_date: '2020-01-01' }),
  ];

  // The bar reads the width of the element it sits in, and jsdom has no layout:
  // its ResizeObserver never calls anyone back. The stub reports one width the
  // moment the bar starts observing, so it is installed around the mount.
  async function mountAt(width: number, opts: Parameters<typeof mount>[0] = {}) {
    const restore = stubElementWidth(width);
    try {
      return await mount(opts);
    } finally {
      restore();
    }
  }

  // The stylesheet has exactly two conditional blocks, so "up to the next one"
  // is the whole of the first and everything after the second.
  function mediaBlock(at: string): string {
    const css = componentCss('hv-full-app-bar');
    const start = css.indexOf(at);
    expect(start).toBeGreaterThan(-1);
    const rest = css.slice(start + at.length);
    const end = rest.indexOf('@media');
    return end === -1 ? rest : rest.slice(0, end);
  }

  it('holds the quick-filter pills in one strip that scrolls rather than wraps', async () => {
    const { sr } = await mount({ items: flagged });
    const strip = q(sr, '[data-testid="full-pills"]') as HTMLElement;
    expect(strip).toBeTruthy();
    expect(strip.querySelector('[data-testid="full-badge-low"]')).toBeTruthy();
    expect(strip.querySelector('[data-testid="full-badge-out"]')).toBeTruthy();
    expect(strip.parentElement?.classList.contains('appbar')).toBe(true);

    const css = componentCss('hv-full-app-bar');
    expect(css).toMatch(/\.appbar \.pills \{[^}]*flex-wrap: nowrap/);
    expect(css).toMatch(/\.appbar \.pills \{[^}]*overflow-x: auto/);
  });

  // An empty strip is still a flex item with a gap in front of it.
  it('leaves the strip out when no count has anything to report', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect(q(sr, '[data-testid="full-pills"]')).toBe(null);
  });

  it('keeps the bar to one row above the phone breakpoint', async () => {
    const wide = mediaBlock('@media (min-width: 701px)');
    expect(wide).not.toMatch(/\.appbar \{[^}]*flex-wrap: wrap/);
    // Selection mode reuses the bar for a sentence and two labelled buttons,
    // and goes on wrapping — nothing there is stranded by a second line.
    expect(wide).toMatch(/\.appbar\.selecting \{[^}]*flex-wrap: wrap/);
    // The phone branch keeps its own three rows, pills included.
    const phone = mediaBlock('@media (max-width: 700px)');
    expect(phone).toMatch(/\.appbar \{[^}]*flex-wrap: wrap/);
    expect(phone).toMatch(/\.appbar \.pills \{[^}]*flex-wrap: wrap/);
  });

  it('drops the add button to its icon on a tight bar without losing its name', async () => {
    const label = (sr: ShadowRoot) =>
      (q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement).querySelector('.add-label') as HTMLElement;

    const roomy = await mountAt(1400, { items: flagged });
    expect(label(roomy.sr).classList.contains('hv-sr-only')).toBe(false);

    const { sr } = await mountAt(1000, { items: flagged });
    const add = q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
    expect(label(sr).classList.contains('hv-sr-only')).toBe(true);
    expect(add.getAttribute('aria-label')).toBe('Add item');
    expect(add.getAttribute('title')).toBe('Add item');
    expect(add.textContent?.trim()).toBe('Add item');
  });

  it('lowers the search box floor only on the tightest step', async () => {
    const bar = (sr: ShadowRoot) => q(sr, '.appbar') as HTMLElement;

    expect(bar((await mountAt(1400, { items: flagged })).sr).classList.contains('tight')).toBe(false);

    const tight = bar((await mountAt(1000, { items: flagged })).sr);
    expect(tight.classList.contains('tight')).toBe(true);
    expect(tight.classList.contains('tighter')).toBe(false);

    expect(bar((await mountAt(880, { items: flagged })).sr).classList.contains('tighter')).toBe(true);

    expect(componentCss('hv-full-app-bar')).toMatch(/\.appbar\.tighter \.search \{[^}]*min-width: 200px/);
  });

  // A phone-width viewport is the narrow branch's, and it dresses the same
  // controls its own way — a measured width must not step on it.
  it('leaves the phone bar to the narrow branch', async () => {
    const { sr } = await mountAt(375, { items: flagged, mobile: true });
    expect((q(sr, '.appbar') as HTMLElement).classList.contains('tight')).toBe(false);
    const add = q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
    expect(add.textContent?.trim()).toBe('Add');
    expect(add.querySelector('.add-label')?.classList.contains('hv-sr-only')).toBe(false);
  });

  // Negative space is shared by shrink × basis, so a shrinkable heading takes a
  // slice of every pixel the bar is over — and a slice of a fraction of a pixel
  // is enough for the ellipsis to fire. At a 900px window in German the bar read
  // "HAvento…" while the strip still had 188 of its 335px showing.
  it('elides the heading at its own cap rather than at the first pixel of overflow', () => {
    const wide = mediaBlock('@media (min-width: 701px)');
    expect(wide).toMatch(/\.appbar h2 \{[^}]*flex: none/);
    expect(wide).toMatch(/\.appbar h2 \{[^}]*max-width:/);
    expect(wide).toMatch(/\.appbar h2 \{[^}]*text-overflow: ellipsis/);
    // The strip is still what gives first, and the phone branch keeps the
    // stretching heading its own row was written for.
    expect(wide).toMatch(/\.appbar \.pills \{[^}]*flex-shrink: 100/);
    expect(mediaBlock('@media (max-width: 700px)')).toMatch(/\.appbar h2 \{[^}]*flex: 1/);
  });

  // Both bars carried a spacer that the blanket rule hid at every width, so it
  // drew nothing anywhere.
  it('carries no spacer in the app bar, in either mode', async () => {
    const { el, sr } = await mount({ items: flagged });
    expect((q(sr, '.appbar') as HTMLElement).querySelector('.spacer')).toBe(null);

    el.selecting = true;
    await settle(el);
    expect((q(sr, '[data-testid="selection-bar"]') as HTMLElement).querySelector('.spacer')).toBe(null);

    expect(componentCss('hv-full-app-bar')).not.toMatch(/\.appbar \.spacer/);
  });

  it('puts Clear selection at the right edge above the phone breakpoint', async () => {
    const { sr } = await mount({ items: flagged, selecting: true });

    // Styling it by data-testid would tie the stylesheet to the test hooks.
    const clear = q(sr, '[data-testid="selection-clear"]') as HTMLButtonElement;
    expect(clear.classList.contains('clear')).toBe(true);
    expect(mediaBlock('@media (min-width: 701px)')).toMatch(
      /\.appbar\.selecting \.clear \{[^}]*margin-left: auto/,
    );
    // Below it the count's flex:1 already holds the buttons at the edge, and an
    // auto margin on a row that wraps is a phantom item.
    expect(mediaBlock('@media (max-width: 700px)')).not.toMatch(/\.clear \{[^}]*margin-left: auto/);
  });
});

describe('hv-full-app-bar: the narrow-mode sidebar affordance', () => {
  it('leads the app bar with a menu button when embedded and narrow', async () => {
    const { sr } = await mount({ embedded: true, narrow: true });
    const bar = q(sr, '.appbar') as HTMLElement;
    expect(bar.firstElementChild?.getAttribute('data-testid')).toBe('panel-menu');
  });

  it('offers no menu button when the sidebar is already showing', async () => {
    const { sr } = await mount({ embedded: true });
    expect(q(sr, '[data-testid="panel-menu"]')).toBe(null);
  });

  // Narrow is Home Assistant's flag, so it means nothing to the card's overlay —
  // which has its own close button in that slot.
  it('offers no menu button in the overlay variant', async () => {
    const { sr } = await mount({ narrow: true });
    expect(q(sr, '[data-testid="panel-menu"]')).toBe(null);
    expect(q(sr, '[data-testid="expand-toggle"]')).toBeTruthy();
  });

  // `home-assistant-main` listens for this by name and toggles its drawer; with
  // no detail it flips whatever the drawer is currently doing.
  it('asks Home Assistant to toggle its menu', async () => {
    const { el, sr } = await mount({ embedded: true, narrow: true });
    const seen: Event[] = [];
    const onToggle = (e: Event) => seen.push(e);
    window.addEventListener('hass-toggle-menu', onToggle);

    (q(sr, '[data-testid="panel-menu"]') as HTMLButtonElement).click();
    window.removeEventListener('hass-toggle-menu', onToggle);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.composed).toBe(true);
    expect(seen[0]?.bubbles).toBe(true);
    expect((seen[0] as CustomEvent).detail).toBeUndefined();
    el.remove();
  });
});

describe('hv-full-app-bar: app bar filters', () => {
  const flagged = [
    makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 }),
    makeItem({ id: '2', checked_out: true }),
    makeItem({ id: '3', checked_out: true, due_date: '2020-01-01' }),
  ];

  it('filters from the stat pills', async () => {
    const { el, store, sr } = await mount({ items: flagged });

    (q(sr, '[data-testid="full-badge-low"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.lowStockOnly).toBe(true);

    (q(sr, '[data-testid="full-badge-out"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.checkedOutOnly).toBe(true);
  });

  // The card has carried an overdue badge all along; this bar had low and
  // checked-out only, so the one state worth interrupting for was the one it
  // would not show.
  it('carries the overdue count too, and filters on it', async () => {
    const { el, store, sr } = await mount({ items: flagged });
    const pill = q(sr, '[data-testid="full-badge-overdue"]') as HTMLButtonElement;
    expect(pill?.textContent).toContain('1 overdue');

    pill.click();
    await settle(el);
    expect(store.state.value.filters.overdueOnly).toBe(true);
    expect(q(sr, '[data-testid="full-badge-overdue"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  // The bar's chips are the fixed chore/state vocabulary, all of them derived
  // from the item. A status is the household's own word in the household's own
  // colour, so pricing one here rendered it as a chore in the bar's amber and
  // kept saying "missing" after the household had renamed and recoloured it.
  // The sidebar facet and the filter chips own status navigation.
  it('prices no status in the app bar, whatever the counts carry', async () => {
    const statuses = [
      makeItem({ id: '1', status: 'missing' }),
      makeItem({ id: '2', status: 'needs_repair' }),
      makeItem({ id: '3', status: 'ok', quantity: 0, low_stock_threshold: 5 }),
    ];
    const { sr } = await mount({ items: statuses });

    expect(sr.querySelectorAll('[data-testid="full-badge-status"]')).toHaveLength(0);
    // The derived exceptions stay: dropping the two status pills is not a
    // retreat from pricing the bar.
    expect(q(sr, '[data-testid="full-badge-low"]')).toBeTruthy();
  });

  it('drops the overdue pill when nothing is overdue', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1', checked_out: true })] });
    expect(q(sr, '[data-testid="full-badge-overdue"]')).toBe(null);
    expect(q(sr, '[data-testid="full-badge-out"]')).toBeTruthy();
  });

  // An inspection that has come due is independent of any check-out, so the
  // pill counts shelved items the overdue pill never sees — and *due* takes
  // today with it, so an item dated today is in the count and in the filter.
  it('carries the inspection count, and filters the list on it', async () => {
    const due = [
      makeItem({ id: '1', inspection_date: '2000-01-01' }),
      makeItem({ id: '2', inspection_date: '2999-12-31' }),
      makeItem({ id: '3', inspection_date: toIsoDate() }),
    ];
    const { el, store, sr } = await mount({ items: due });
    const pill = q(sr, '[data-testid="full-badge-inspection"]') as HTMLButtonElement;
    expect(pill?.textContent).toContain('2 to inspect');
    expect(q(sr, '[data-testid="full-badge-overdue"]')).toBe(null);

    pill.click();
    await settle(el);
    expect(store.state.value.filters.inspectionDueOnly).toBe(true);
    expect(q(sr, '[data-testid="full-badge-inspection"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(store.state.value.items.map((i) => i.id).sort()).toEqual(['1', '3']);
  });

  it('drops the inspection pill when nothing is due', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1', inspection_date: '2999-12-31' })] });
    expect(q(sr, '[data-testid="full-badge-inspection"]')).toBe(null);
  });

  // One vocabulary on both surfaces: the card hands its `quick_filters` config
  // down, and the panel — which has no YAML — takes the default of all of them.
  // Which pills a config leaves is `renderStatBadges`' arithmetic, pinned in
  // ui/stat-badges.test.ts.

  // "82 out" reads as "82 out of stock", which is the opposite of what it counts.
  it('spells out what the checked-out pill counts', async () => {
    const { sr } = await mount({ items: flagged });
    expect(q(sr, '[data-testid="full-badge-out"]')?.textContent?.trim()).toBe('2 checked out');
  });
});

describe('hv-full-app-bar: search box', () => {
  // It copied the store's query only on opening, so a search cleared while it
  // was up (a chip, the filter panel's Clear) left the old text in the box.
  it('empties the search box when the search is cleared while it is open', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Hammer' })] });
    const input = q(sr, '[data-testid="full-search"]') as HTMLInputElement;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      input.value = 'hammer';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
      await settle(el);
      expect(store.state.value.filters.q).toBe('hammer');

      store.setFilters({ q: '' });
      await settle(el);
      expect(input.value).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

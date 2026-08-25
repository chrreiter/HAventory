import './hv-full-view';
import { componentCss, discardAsker, makeItem, mountHost, q, settle, stubViewport } from '../test.utils';
import { deepActiveElement, deepFocusables } from '../ui/dialog-focus';
import { toIsoDate } from '../ui/relative-time';
import type { HVFullView } from './hv-full-view';
import type { Item, Location, StatusDefinition } from '../store/types';

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

/**
 * Every mount stands a host beside the surface, the way the card and the panel
 * do: the discard dialog is the host's, and a surface mounted without one would
 * answer its own question by not asking it.
 */
async function mount(
  opts: {
    items?: Item[];
    locations?: Location[];
    areas?: { id: string; name: string }[];
    statuses?: StatusDefinition[];
    embedded?: boolean;
    narrow?: boolean;
  } = {},
) {
  const host = discardAsker();
  const mounted = await mountHost<HVFullView>(
    'hv-full-view',
    {
      items: opts.items ?? [],
      locations: opts.locations ?? [],
      areas: opts.areas ?? [],
      ...(opts.statuses ? { statuses: opts.statuses } : {}),
    },
    {
      columns: ['quantity', 'category'],
      confirmDiscard: host.ask,
      ...(opts.embedded ? { embedded: true } : {}),
      ...(opts.narrow ? { narrow: true } : {}),
      open: true,
    },
    { renders: 2 },
  );
  return { ...mounted, host };
}

describe('hv-full-view: phone-width app bar', () => {
  // The first row of the narrow bar holds four controls and only the heading
  // can shrink, so the add button's label decides whether the row stays whole.
  // "Gegenstand hinzufügen" on its own is wider than the room the row has,
  // which squeezed the heading to "H…" and sent the overflow menu to a second
  // row; the short label keeps the row, and the full wording is still the
  // button's accessible name.
  it('shortens the add button on the narrow branch without losing its name', async () => {
    const restore = stubViewport(true);
    try {
      const { sr } = await mount({ items: [makeItem({ id: '1' })] });
      const add = q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
      expect(add.textContent?.trim()).toBe('Add');
      expect(add.getAttribute('aria-label')).toBe('Add item');
      expect(add.getAttribute('title')).toBe('Add item');
    } finally {
      restore();
    }
  });

  it('spells the add button out where the bar has room for it', async () => {
    const restore = stubViewport(false);
    try {
      const { sr } = await mount({ items: [makeItem({ id: '1' })] });
      const add = q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
      expect(add.textContent?.trim()).toBe('Add item');
      expect(add.getAttribute('aria-label')).toBe('Add item');
    } finally {
      restore();
    }
  });

  // The crumb and its count can fill a phone-width row on their own. The
  // filter toggle and the column picker then have to move down together:
  // as separate flex items the picker wrapped alone under the toggle.
  it('moves the filter toggle and the column picker as one unit', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    const toggle = q(sr, '[data-testid="full-filters-toggle"]') as HTMLElement;
    const columns = q(sr, '[data-testid="columns-expanded"]') as HTMLElement;
    expect(toggle.parentElement).toBe(columns.parentElement);
    expect(toggle.parentElement?.classList.contains('context-actions')).toBe(true);
    expect(toggle.parentElement?.parentElement?.classList.contains('context')).toBe(true);
    expect(componentCss('hv-full-view')).toMatch(/\.context-actions \{[^}]*margin-left: auto/);
  });

  it('keeps the apply button out of the scroll, where the count is visible', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const scroll = q(sr, '.panel-scroll') as HTMLElement;
    expect(scroll?.querySelector('[data-testid="full-filter-panel"]')).toBeTruthy();
    // The commit row is a sibling of the scroll box, not inside it, so the
    // count on the apply button stays visible while the filters move.
    expect(scroll.querySelector('.panel-foot')).toBe(null);
    expect(componentCss('hv-full-view')).toMatch(/\.panel-foot \{[^}]*flex: none/);
  });

  it('keeps Clear selection on screen', async () => {
    // The bar does not wrap, so at 375px only the tighter step keeps it on
    // screen.
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    el.startSelecting = true;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await settle(el);

    expect(q(sr, '[data-testid="selection-bar"]')).toBeTruthy();
    expect(q(sr, '[data-testid="selection-clear"]')).toBeTruthy();
  });

  it('marks the load-all button so it can be ordered onto its own row', async () => {
    // Styling it by data-testid would tie the stylesheet to the test hooks.
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1' }), makeItem({ id: '2' })],
    });
    store.state.value.total = 99;
    el.startSelecting = true;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await settle(el);

    const loadAll = q(sr, '[data-testid="selection-load-all"]');
    expect(loadAll?.classList.contains('load-all')).toBe(true);
  });

  // Selection mode opens at "0 selected", where the bar's one action had nothing
  // to act on and still rendered live.
  it('greys Clear selection out until something is selected', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' }), makeItem({ id: '2' })] });
    el.startSelecting = true;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await settle(el);

    const clear = () => q(sr, '[data-testid="selection-clear"]') as HTMLButtonElement;
    expect(q(sr, '[data-testid="selection-count"]')?.textContent).toContain('0 selected');
    expect(clear().disabled).toBe(true);

    store.toggleSelected('1');
    await settle(el);
    expect(clear().disabled).toBe(false);
  });
});

describe('hv-full-view: the app bar between a phone and a wide desktop', () => {
  const flagged = [
    makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 }),
    makeItem({ id: '2', checked_out: true }),
    makeItem({ id: '3', checked_out: true, due_date: '2020-01-01' }),
  ];

  // The bar reads its own width, and jsdom has no layout — its ResizeObserver
  // stub never calls anyone back. The width the observer would report is handed
  // to the same entry point instead; the pixel measurements come from a browser.
  function measure(el: HVFullView, width: number) {
    (el as unknown as { _setBarWidth(width: number): void })._setBarWidth(width);
  }

  // The stylesheet has exactly two conditional blocks, so "up to the next one"
  // is the whole of the first and everything after the second.
  function mediaBlock(at: string): string {
    const css = componentCss('hv-full-view');
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

    const css = componentCss('hv-full-view');
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
    const { el, sr } = await mount({ items: flagged });
    const add = () => q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
    const label = () => add().querySelector('.add-label') as HTMLElement;

    measure(el, 1400);
    await settle(el);
    expect(label().classList.contains('hv-sr-only')).toBe(false);

    measure(el, 1000);
    await settle(el);
    expect(label().classList.contains('hv-sr-only')).toBe(true);
    expect(add().getAttribute('aria-label')).toBe('Add item');
    expect(add().getAttribute('title')).toBe('Add item');
    expect(add().textContent?.trim()).toBe('Add item');
  });

  it('lowers the search box floor only on the tightest step', async () => {
    const { el, sr } = await mount({ items: flagged });
    const bar = () => q(sr, '.appbar') as HTMLElement;

    measure(el, 1400);
    await settle(el);
    expect(bar().classList.contains('tight')).toBe(false);

    measure(el, 1000);
    await settle(el);
    expect(bar().classList.contains('tight')).toBe(true);
    expect(bar().classList.contains('tighter')).toBe(false);

    measure(el, 880);
    await settle(el);
    expect(bar().classList.contains('tighter')).toBe(true);

    expect(componentCss('hv-full-view')).toMatch(/\.appbar\.tighter \.search \{[^}]*min-width: 200px/);
  });

  // A phone-width viewport is the narrow branch's, and it dresses the same
  // controls its own way — a measured width must not step on it.
  it('leaves the phone bar to the narrow branch', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: flagged });
      measure(el, 375);
      await settle(el);
      expect((q(sr, '.appbar') as HTMLElement).classList.contains('tight')).toBe(false);
      const add = q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement;
      expect(add.textContent?.trim()).toBe('Add');
      expect(add.querySelector('.add-label')?.classList.contains('hv-sr-only')).toBe(false);
    } finally {
      restore();
    }
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

    el.startSelecting = true;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await settle(el);
    expect((q(sr, '[data-testid="selection-bar"]') as HTMLElement).querySelector('.spacer')).toBe(null);

    const css = componentCss('hv-full-view');
    expect(css).not.toMatch(/\.appbar \.spacer/);
    // The phone panel's commit row is where the class still earns its keep.
    expect(css).toMatch(/\.spacer \{[^}]*margin-left: auto/);
  });

  it('puts Clear selection at the right edge above the phone breakpoint', async () => {
    const { el, sr } = await mount({ items: flagged });
    el.startSelecting = true;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await settle(el);

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

describe('hv-full-view: shell', () => {
  it('renders nothing when closed', async () => {
    const { el, sr } = await mount();
    el.open = false;
    await el.updateComplete;
    expect(q(sr, '[data-testid="full-view"]')).toBe(null);
  });

  it('is a modal dialog with the coloured app bar as the mode signal', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    const shell = q(sr, '[data-testid="full-view"]') as HTMLElement;
    expect(shell.getAttribute('role')).toBe('dialog');
    expect(shell.getAttribute('aria-modal')).toBe('true');
    expect(q(sr, '.appbar')).toBeTruthy();
  });

  it('closes from the app bar, the backdrop and Escape', async () => {
    for (const trigger of ['button', 'backdrop', 'escape'] as const) {
      const { el, sr } = await mount();
      let closes = 0;
      el.addEventListener('close', () => {
        closes += 1;
      });

      if (trigger === 'button') (q(sr, '[data-testid="expand-toggle"]') as HTMLButtonElement).click();
      else if (trigger === 'backdrop') (q(sr, '.backdrop') as HTMLElement).click();
      else
        (q(sr, '[data-testid="full-view"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

      expect(closes, `close via ${trigger}`).toBe(1);
      expect(el.open).toBe(false);
      el.remove();
    }
  });

  it('keeps the expand-toggle testid the POC card used', async () => {
    const { sr } = await mount();
    expect(q(sr, '[data-testid="expand-toggle"]')).toBeTruthy();
  });
});

// The same surface, hosted by a Home Assistant panel rather than by the card.
// It is a page there: nothing sits behind it, it has nowhere to close to, and
// it shares the tab order and the Escape key with the rest of the frontend.
describe('hv-full-view: embedded', () => {
  it('renders neither backdrop nor focus sentinels', async () => {
    const { sr } = await mount({ embedded: true });
    expect(q(sr, '.backdrop')).toBe(null);
    expect(sr.querySelectorAll('.sentinel')).toHaveLength(0);
  });

  it('drops the dialog semantics but keeps the surface', async () => {
    const { sr } = await mount({ embedded: true, items: [makeItem({ id: '1' })] });
    const shell = q(sr, '[data-testid="full-view"]') as HTMLElement;
    expect(shell.hasAttribute('role')).toBe(false);
    expect(shell.hasAttribute('aria-modal')).toBe(false);
    expect(shell.getAttribute('aria-label')).toBe('HAventory');
    expect(q(sr, '.appbar')).toBeTruthy();
    expect(q(sr, '[data-testid="full-table"]')).toBeTruthy();
    expect(q(sr, '[data-testid="full-sidebar"]')).toBeTruthy();
  });

  it('has no close button — a page has nowhere to close to', async () => {
    const { sr } = await mount({ embedded: true });
    expect(q(sr, '[data-testid="expand-toggle"]')).toBe(null);
  });

  // Swallowing Escape here would take the key away from whatever Home Assistant
  // has open over the panel.
  it('ignores Escape, and lets it through', async () => {
    const { el, sr } = await mount({ embedded: true });
    let closes = 0;
    el.addEventListener('close', () => {
      closes += 1;
    });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (q(sr, '[data-testid="full-view"]') as HTMLElement).dispatchEvent(event);
    await el.updateComplete;

    expect(closes).toBe(0);
    expect(el.open).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not pull focus into itself the way a dialog does', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { el } = await mount({ embedded: true });
    await el.updateComplete;

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('leaves the overlay variant modal', async () => {
    const { sr } = await mount();
    const shell = q(sr, '[data-testid="full-view"]') as HTMLElement;
    expect(shell.getAttribute('role')).toBe('dialog');
    expect(shell.getAttribute('aria-modal')).toBe('true');
    expect(q(sr, '.backdrop')).toBeTruthy();
    expect(sr.querySelectorAll('.sentinel')).toHaveLength(2);
    expect(q(sr, '[data-testid="expand-toggle"]')).toBeTruthy();
  });

  // The trap's two ends came from a query rooted in this shadow root, which
  // stops at every `hv-*` boundary below it. The rows, the sidebar tree and the
  // editor were all past one, so "last focusable" landed in the middle of the
  // surface and Tab walked out through everything behind it.
  it('bounces off the end of the trap into a child component, not out of it', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' }), makeItem({ id: '2' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    const rows = [...(table.shadowRoot?.querySelectorAll('[data-testid="table-row"]') ?? [])];
    // The row menu is the row's last control, and its trigger lives one shadow
    // root deeper still — which is the case this test exists for.
    const lastMenu = rows[rows.length - 1]
      .querySelector('[data-testid="table-row-menu"]')
      ?.shadowRoot?.querySelector('.trigger');

    // Shift+Tab off the front lands on the leading sentinel, which sends focus
    // to the last thing inside the trap.
    (sr.querySelector('.sentinel') as HTMLElement).focus();
    await el.updateComplete;

    expect(deepActiveElement()).toBe(lastMenu);
  });

  it('opens on the first control of the surface, not on something nested in it', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect(deepActiveElement()).toBe(q(sr, '[data-testid="expand-toggle"]'));
  });
});

describe('hv-full-view: the narrow-mode sidebar affordance', () => {
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
    expect(seen[0].composed).toBe(true);
    expect(seen[0].bubbles).toBe(true);
    expect((seen[0] as CustomEvent).detail).toBeUndefined();
    el.remove();
  });
});

describe('hv-full-view: sidebar', () => {
  const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage'), loc('kitchen', 'Kitchen')];

  it('renders the real tree with the backend counts', async () => {
    const items = [
      makeItem({ id: '1', location_id: 'garage' }),
      makeItem({ id: '2', location_id: 'shelf-a' }),
      makeItem({ id: '3', location_id: null }),
    ];
    const { sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="sidebar-tree"]') as HTMLElement;

    const rows = [...(tree.shadowRoot?.querySelectorAll('[data-testid="tree-row"]') ?? [])];
    expect(rows.map((r) => (r as HTMLElement).dataset.id)).toEqual(['garage', 'kitchen']);
    // Garage holds one directly plus one on Shelf A.
    expect(rows[0].querySelector('[data-testid="tree-count"]')?.textContent?.trim()).toBe('2');
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-all"]')?.textContent).toContain('All items');
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-orphans"]')?.textContent).toContain('1');
  });

  it('drives the area filter from a sidebar area header', async () => {
    // Browsing is the one surface where an area row means something to press:
    // the item filter already takes an area, so the header is a way into it.
    const areaLocations = [{ ...loc('garage', 'Garage'), area_id: 'area-garage' }, loc('kitchen', 'Kitchen')];
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'garage' })],
      locations: areaLocations,
      areas: [{ id: 'area-garage', name: 'Garage' }],
    });
    const tree = q(sr, '[data-testid="sidebar-tree"]') as HTMLElement;

    const head = tree.shadowRoot?.querySelector('[data-testid="tree-area-select"]') as HTMLButtonElement;
    expect(head).toBeTruthy();
    head.click();
    await settle(el);
    expect(store.state.value.filters.areaId).toBe('area-garage');
  });

  it('assigns only real locations from the pickers, never an area', async () => {
    const areaLocations = [{ ...loc('garage', 'Garage'), area_id: 'area-garage' }];
    const { el, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'garage' })],
      locations: areaLocations,
      areas: [{ id: 'area-garage', name: 'Garage' }],
    });
    (q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    (editor.shadowRoot?.querySelector('[data-testid="editor-location"]') as HTMLButtonElement).click();
    await settle(el);

    const picker = editor.shadowRoot?.querySelector('[data-testid="editor-location-tree"]') as HTMLElement;
    const head = picker.shadowRoot?.querySelector('[data-testid="tree-area-head"]');
    expect(head, 'the picker groups by area too').toBeTruthy();
    expect(picker.shadowRoot?.querySelector('[data-testid="tree-area-select"]')).toBe(null);
  });

  it('drives the location filter from the tree', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' })], locations });
    const tree = q(sr, '[data-testid="sidebar-tree"]') as HTMLElement;

    (tree.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.locationIds).toEqual(['garage']);

    (tree.shadowRoot?.querySelector('[data-testid="tree-orphans"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.orphansOnly).toBe(true);
    expect(store.state.value.filters.locationIds).toEqual([]);
  });

  // The tree is the sidebar's own multi-select; a second pick has to add to the
  // first, the way a category row does, or the two halves of one column
  // disagree about what picking means.
  it('accumulates locations in the tree and clears them from "All items"', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' })], locations });
    const tree = q(sr, '[data-testid="sidebar-tree"]') as HTMLElement;
    const row = (id: string) =>
      tree.shadowRoot?.querySelector(`[data-testid="tree-row"][data-id="${id}"]`) as HTMLButtonElement;

    row('garage').click();
    await settle(el);
    row('kitchen').click();
    await settle(el);
    expect(store.state.value.filters.locationIds).toEqual(['garage', 'kitchen']);
    expect(row('garage').classList).toContain('selected');
    expect(row('kitchen').classList).toContain('selected');

    // Pressing a selected one takes it back out…
    row('garage').click();
    await settle(el);
    expect(store.state.value.filters.locationIds).toEqual(['kitchen']);

    // …and "All items" clears the selection in one press.
    (tree.shadowRoot?.querySelector('[data-testid="tree-all"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.locationIds).toEqual([]);
  });

  it('creates a location inline, under the current selection', async () => {
    const { el, store, sr } = await mount({ items: [], locations });
    store.setFilters({ locationIds: ['garage'] });
    await settle(el);

    (q(sr, '[data-testid="sidebar-new-location"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="sidebar-new-location-name"]') as HTMLInputElement;
    input.value = 'Shelf C';
    (q(sr, '[data-testid="sidebar-new-location-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    const created = store.state.value.locationsFlatCache?.find((l) => l.name === 'Shelf C');
    expect(created).toBeTruthy();
    expect(created?.parent_id).toBe('garage');
  });

  it('reports a failed create inline instead of throwing it away', async () => {
    const { el, store, sr } = await mount({ items: [], locations });
    store.createLocation = async () => {
      throw { code: 'validation_error', message: 'name already used here' };
    };

    (q(sr, '[data-testid="sidebar-new-location"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="sidebar-new-location-name"]') as HTMLInputElement;
    input.value = 'Garage';
    (q(sr, '[data-testid="sidebar-new-location-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="sidebar-location-error"]')?.textContent).toContain('name already used here');
  });

  // One event, one sentence: the editor's inline creator reports a failure the
  // backend put no message on in these words too, and a reader who meets it on
  // both surfaces meets the same wording.
  it('falls back to the card own sentence when the failure carries no message', async () => {
    const { el, store, sr } = await mount({ items: [], locations });
    store.createLocation = async () => {
      throw { code: 'storage_error' };
    };

    (q(sr, '[data-testid="sidebar-new-location"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="sidebar-new-location-name"]') as HTMLInputElement;
    input.value = 'Shelf C';
    (q(sr, '[data-testid="sidebar-new-location-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="sidebar-location-error"]')?.textContent).toContain(
      'The location could not be created.',
    );
  });
});

// The sidebar held locations and nothing else. An inventory with a handful of
// them, or one browsed with every root collapsed, left most of a 264px column
// empty while the two other facets people navigate by sat inside the filter
// panel behind a button.
describe('hv-full-view: sidebar facets', () => {
  const faceted = [
    makeItem({ id: '1', category: 'Tools', tags: ['metric', 'heavy'] }),
    makeItem({ id: '2', category: 'Tools', tags: ['metric'] }),
    makeItem({ id: '3', category: 'Cleaning', tags: [] }),
  ];
  const rows = (sr: ShadowRoot, section: string) =>
    [...sr.querySelectorAll(`[data-testid="sidebar-${section}-row"]`)] as HTMLElement[];

  // A facet row and a location row are the same control in two shadow roots,
  // one list under the other in the same column, and they had drifted apart on
  // both height and label inset. The row that carries the shared class is what
  // makes them one; the slot is what holds the inset, so it is reserved on a
  // row with nothing to put in it rather than left out.
  it('draws a facet row as the shared browse row, slot and all', async () => {
    const { el, sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });
    const all = [...rows(sr, 'categories'), ...rows(sr, 'tags')];

    for (const row of all) {
      expect(row.classList, row.dataset.value).toContain('hv-browse-row');
      const lead = row.querySelector('.hv-browse-row-lead');
      expect(lead, row.dataset.value).toBeTruthy();
      expect(lead?.classList.contains('placeholder'), row.dataset.value).toBe(true);
      expect(row.querySelector('.hv-browse-row-label')?.textContent).toBe(row.dataset.value);
    }

    rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.click();
    await settle(el);
    const picked = rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')!;
    // Picked, the same slot holds the check — the label does not move sideways.
    expect(picked.querySelector('.hv-browse-row-lead')?.classList.contains('placeholder')).toBe(false);
    expect(picked.querySelector('.hv-browse-row-lead svg')).toBeTruthy();
  });

  it('lists categories and tags with their counts, locations still first', async () => {
    const { sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });

    expect(rows(sr, 'categories').map((r) => r.dataset.value)).toEqual(['Cleaning', 'Tools']);
    expect(rows(sr, 'categories')[1].textContent).toContain('2');
    expect(rows(sr, 'tags').map((r) => r.dataset.value)).toEqual(['heavy', 'metric']);
    expect(q(sr, '[data-testid="sidebar-tags-tally"]')?.textContent?.trim()).toBe('2');

    // Locations keeps the top of the column.
    const heads = [...sr.querySelectorAll('.sidebar-head .section-toggle')] as HTMLElement[];
    expect(heads.map((h) => h.dataset.testid)).toEqual([
      'sidebar-toggle-locations',
      'sidebar-toggle-status',
      'sidebar-toggle-categories',
      'sidebar-toggle-tags',
    ]);
  });

  // One sidebar column, one meaning for the grey number: with a filter on, the
  // location rows read "matches / total" and these two read whole-inventory
  // counts that never moved.
  it('reads matches over total once a filter is narrowing the list', async () => {
    const checkedOut = [
      makeItem({ id: '1', category: 'Tools', tags: ['metric'], checked_out: true }),
      makeItem({ id: '2', category: 'Tools', tags: ['metric'] }),
      makeItem({ id: '3', category: 'Cleaning', tags: [] }),
    ];
    const { el, store, sr } = await mount({ items: checkedOut });
    const tally = (section: string, value: string) =>
      rows(sr, section)
        .find((r) => r.dataset.value === value)
        ?.querySelector('.hv-tally')
        ?.textContent?.trim();

    // Unfiltered, a bare total.
    expect(tally('categories', 'Tools')).toBe('2');

    store.setFilters({ checkedOutOnly: true });
    await vi.waitUntil(() => store.state.value.distinctValuesCache?.categories[0]?.matching_count !== undefined);
    await settle(el);

    expect(tally('categories', 'Tools')).toBe('1 / 2');
    expect(tally('categories', 'Cleaning')).toBe('0 / 1');
    expect(tally('tags', 'metric')).toBe('1 / 2');
    // The heading still counts rows rather than matches — it says how many
    // categories there are, and none of them went away.
    expect(q(sr, '[data-testid="sidebar-categories-tally"]')?.textContent?.trim()).toBe('2');
  });

  it('puts a clipped facet name in reach of a pointer', async () => {
    const { sr } = await mount({ items: faceted });
    const row = rows(sr, 'categories').find((r) => r.dataset.value === 'Cleaning');
    // The label clips with an ellipsis and appears nowhere else in the sidebar.
    expect(row?.querySelector('.label')?.getAttribute('title')).toBe('Cleaning');
  });

  it('filters to one category and clears it on a second press', async () => {
    const { el, store, sr } = await mount({ items: faceted });

    rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.click();
    await settle(el);
    expect(store.state.value.filters.categories).toEqual(['Tools']);
    expect(rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.classList).toContain(
      'selected',
    );

    rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.click();
    await settle(el);
    expect(store.state.value.filters.categories).toEqual([]);
  });

  // The sidebar and the filter panel are one control in two places, so a
  // category row that replaced the selection while the panel's chip added to it
  // would make "picked" mean two things.
  it('accumulates categories rather than replacing the selection', async () => {
    const { el, store, sr } = await mount({ items: faceted });

    rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.click();
    await settle(el);
    rows(sr, 'categories').find((r) => r.dataset.value === 'Cleaning')?.click();
    await settle(el);
    expect(store.state.value.filters.categories).toEqual(['Tools', 'Cleaning']);
    // Both rows read as picked, and the list keeps every row it had.
    for (const value of ['Tools', 'Cleaning']) {
      expect(rows(sr, 'categories').find((r) => r.dataset.value === value)?.classList).toContain(
        'selected',
      );
    }

    rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.click();
    await settle(el);
    expect(store.state.value.filters.categories).toEqual(['Cleaning']);
  });

  // No Any/All control beside categories or locations, unlike tags: an item
  // carries one of each, so a selection of several can only mean OR.
  it('offers no match mode for categories, however many are picked', async () => {
    const { el, store, sr } = await mount({ items: faceted });
    rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.click();
    await settle(el);
    rows(sr, 'categories').find((r) => r.dataset.value === 'Cleaning')?.click();
    await settle(el);

    expect(store.state.value.filters.categories).toHaveLength(2);
    expect(q(sr, '[data-testid="sidebar-categories-mode"]')).toBe(null);
  });

  // Tags are a set for a different reason: an item carries several, so any/all
  // is a real question there and not here.
  it('accumulates tags rather than replacing the selection', async () => {
    const { el, store, sr } = await mount({ items: faceted });

    rows(sr, 'tags').find((r) => r.dataset.value === 'metric')?.click();
    await settle(el);
    rows(sr, 'tags').find((r) => r.dataset.value === 'heavy')?.click();
    await settle(el);
    expect(store.state.value.filters.tags).toEqual(['metric', 'heavy']);

    rows(sr, 'tags').find((r) => r.dataset.value === 'metric')?.click();
    await settle(el);
    expect(store.state.value.filters.tags).toEqual(['heavy']);
  });

  // The sidebar accumulated tags but never said which way they combined, so a
  // mode set to "all" in the filter panel silently governed every tag picked
  // here. Only shown from the second tag on — that is when the two differ.
  it('shows the tag match mode once two tags are selected', async () => {
    const { el, store, sr } = await mount({ items: faceted });
    expect(q(sr, '[data-testid="sidebar-tags-mode"]')).toBe(null);

    rows(sr, 'tags').find((r) => r.dataset.value === 'metric')?.click();
    await settle(el);
    expect(q(sr, '[data-testid="sidebar-tags-mode"]'), 'one tag needs no mode').toBe(null);

    rows(sr, 'tags').find((r) => r.dataset.value === 'heavy')?.click();
    await settle(el);
    const modes = [...sr.querySelectorAll('[data-testid="sidebar-tags-mode"]')] as HTMLElement[];
    expect(modes.map((m) => m.dataset.mode)).toEqual(['any', 'all']);
    expect(modes[0].classList.contains('on')).toBe(true);

    modes[1].click();
    await settle(el);
    expect(store.state.value.filters.tagsMode).toBe('all');
    expect(
      (sr.querySelectorAll('[data-testid="sidebar-tags-mode"]')[1] as HTMLElement).getAttribute('aria-checked'),
    ).toBe('true');
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the heading in reading order.
  it('names the panel each heading discloses, open or shut', async () => {
    const { el, sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });
    const toggle = (section: string) =>
      q(sr, `[data-testid="sidebar-toggle-${section}"]`) as HTMLButtonElement;

    for (const section of ['locations', 'status', 'categories', 'tags']) {
      const id = `sidebar-section-${section}`;
      expect(toggle(section).getAttribute('aria-controls'), section).toBe(id);
      expect(toggle(section).getAttribute('aria-expanded'), `${section} open`).toBe('true');
      // The id has to resolve in both states — a control pointing at nothing
      // announces as controlling nothing.
      expect(sr.getElementById(id), `${section} open`).toBeTruthy();

      toggle(section).click();
      await settle(el);

      expect(toggle(section).getAttribute('aria-expanded'), `${section} shut`).toBe('false');
      expect(toggle(section).getAttribute('aria-controls'), `${section} shut`).toBe(id);
      expect(sr.getElementById(id), `${section} shut`).toBeTruthy();

      toggle(section).click();
      await settle(el);
    }
  });

  it('collapses a section from its heading, keeping the heading reachable', async () => {
    const { el, sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });
    const toggle = q(sr, '[data-testid="sidebar-toggle-tags"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    await settle(el);

    expect(rows(sr, 'tags')).toEqual([]);
    expect(q(sr, '[data-testid="sidebar-toggle-tags"]')?.getAttribute('aria-expanded')).toBe('false');
    // Only that section went; the others are untouched.
    expect(rows(sr, 'categories').length).toBe(2);
    expect(q(sr, '[data-testid="sidebar-tree"]')).toBeTruthy();
  });

  it('reopens a collapsed Locations section rather than hiding the new-name field in it', async () => {
    const { el, sr } = await mount({ items: [], locations: [loc('garage', 'Garage')] });
    (q(sr, '[data-testid="sidebar-toggle-locations"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="sidebar-tree"]')).toBe(null);

    (q(sr, '[data-testid="sidebar-new-location"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="sidebar-new-location-name"]')).toBeTruthy();
    expect(q(sr, '[data-testid="sidebar-tree"]')).toBeTruthy();
  });

  // Locations was the odd one out: a "+" where the other two headings carry a
  // number, so the section you can add to was the one you could not size up.
  it('states how many locations there are, at every depth', async () => {
    const { sr } = await mount({
      items: faceted,
      locations: [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage'), loc('kitchen', 'Kitchen')],
    });
    expect(q(sr, '[data-testid="sidebar-locations-tally"]')?.textContent?.trim()).toBe('3');
    // …and the "+" is still there beside it.
    expect(q(sr, '[data-testid="sidebar-new-location"]')).toBeTruthy();
  });

  // Locations could be added to from its heading and the other two could not,
  // so the one section with a "+" was the only facet you could create without
  // going to find the organize dialog yourself.
  it('offers a create action on every heading, not just Locations', async () => {
    const { el, sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });
    const seen: { id: string; tab?: string }[] = [];
    el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail));

    expect(q(sr, '[data-testid="sidebar-new-location"]')).toBeTruthy();
    (q(sr, '[data-testid="sidebar-new-categories"]') as HTMLButtonElement).click();
    (q(sr, '[data-testid="sidebar-new-tags"]') as HTMLButtonElement).click();

    // A category exists through the items using it, so this opens Organize on
    // the matching tab rather than inventing a second place to create one.
    expect(seen).toEqual([
      { id: 'organize', tab: 'categories' },
      { id: 'organize', tab: 'tags' },
    ]);
    expect(q(sr, '[data-testid="sidebar-new-tags"]')?.getAttribute('title')).toBe('New tag…');
  });

  // Status was the fourth facet and the only heading with nothing on it, so the
  // one vocabulary a household actually defines was the one you could not reach
  // from the sidebar that shows it.
  it('offers the same create action on the Status heading', async () => {
    const { el, sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });
    const seen: { id: string; tab?: string }[] = [];
    el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail));

    (q(sr, '[data-testid="sidebar-new-status"]') as HTMLButtonElement).click();

    expect(seen).toEqual([{ id: 'organize', tab: 'statuses' }]);
    expect(q(sr, '[data-testid="sidebar-new-status"]')?.getAttribute('title')).toBe('New status…');
  });

  it('says so when a facet has nothing in it yet', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1', category: null, tags: [] })] });
    // Worded as the organize dialog words it: a category exists through the
    // items using it, so "in use" is the honest phrasing in both places.
    expect(q(sr, '[data-testid="sidebar-categories-empty"]')?.textContent?.trim()).toBe(
      'No categories in use yet',
    );
    // Captions take no full stop; prose notes do.
    expect(q(sr, '[data-testid="sidebar-tags-empty"]')?.textContent?.trim()).toBe('No tags in use yet');
  });
});

describe('hv-full-view: sidebar status', () => {
  const flagged = [
    makeItem({ id: '1', status: 'missing' }),
    makeItem({ id: '2', status: 'needs_repair' }),
    makeItem({ id: '3', status: 'needs_repair' }),
    makeItem({ id: '4' }),
  ];
  const rows = (sr: ShadowRoot) =>
    [...sr.querySelectorAll('[data-testid="sidebar-status-row"]')] as HTMLElement[];
  const tallies = (sr: ShadowRoot) =>
    rows(sr).map((r) => r.querySelector('.hv-tally')?.textContent?.trim() ?? null);

  // Every row is priced from the per-slug map, so the facet says what the
  // backend says rather than what the facet can derive.
  it('lists the three statuses with their counts', async () => {
    const { sr } = await mount({ items: flagged });
    expect(rows(sr).map((r) => r.dataset.value)).toEqual(['ok', 'missing', 'needs_repair']);
    expect(tallies(sr)).toEqual(['1', '1', '2']);
  });

  // Each slug is priced on its own: inheriting "everything that is not missing
  // or needs_repair" lets an empty status claim the whole inventory and then
  // show no rows when it is clicked.
  it('prices a household vocabulary per slug, including one nothing carries', async () => {
    const statuses: StatusDefinition[] = [
      { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
      { slug: 'lent_out', label: 'Lent out', order: 1, color: 'blue', icon: 'hand' },
      { slug: 'in_transit', label: 'In transit', order: 2, color: 'blue_strong', icon: 'truck' },
    ];
    const items = [
      makeItem({ id: '1', status: 'lent_out' }),
      makeItem({ id: '2', status: 'lent_out' }),
      makeItem({ id: '3' }),
      makeItem({ id: '4' }),
      makeItem({ id: '5' }),
    ];
    const { sr } = await mount({ items, statuses });

    expect(rows(sr).map((r) => r.dataset.value)).toEqual(['ok', 'lent_out', 'in_transit']);
    expect(tallies(sr)).toEqual(['3', '2', '0']);
  });

  it('filters to one status and clears it on a second press', async () => {
    const { el, store, sr } = await mount({ items: flagged });
    const missing = () => rows(sr).find((r) => r.dataset.value === 'missing');

    missing()?.click();
    await settle(el);
    expect(store.state.value.filters.status).toBe('missing');
    expect(missing()?.classList).toContain('selected');

    missing()?.click();
    await settle(el);
    expect(store.state.value.filters.status).toBe(null);
  });

  // Single-select, because the backend filter takes exactly one status — so a
  // second pick replaces the first rather than adding to it, as category does.
  it('replaces the selection rather than accumulating it', async () => {
    const { el, store, sr } = await mount({ items: flagged });

    rows(sr).find((r) => r.dataset.value === 'missing')?.click();
    await settle(el);
    rows(sr).find((r) => r.dataset.value === 'needs_repair')?.click();
    await settle(el);

    expect(store.state.value.filters.status).toBe('needs_repair');
    expect(
      rows(sr)
        .filter((r) => r.classList.contains('selected'))
        .map((r) => r.dataset.value),
    ).toEqual(['needs_repair']);
  });

  // A backend too old to send the map still prices the two flagged built-ins in
  // their own fields; the default is not knowable there, and stays unpriced
  // rather than being derived from the halves that did arrive.
  it('falls back to the legacy fields when the per-slug map is absent', async () => {
    const { el, store, sr } = await mount({ items: flagged });
    const counts = store.state.value.statsCounts as unknown as Record<string, unknown>;
    delete counts.status_counts;
    el.requestUpdate();
    await settle(el);

    expect(tallies(sr)).toEqual([null, '1', '2']);
  });

  it('drops every tally when the backend prices no statuses at all', async () => {
    const { el, store, sr } = await mount({ items: flagged });
    const counts = store.state.value.statsCounts as unknown as Record<string, unknown>;
    delete counts.status_counts;
    delete counts.missing_count;
    delete counts.needs_repair_count;
    el.requestUpdate();
    await settle(el);

    expect(tallies(sr)).toEqual([null, null, null]);
  });

  // Categories and tags tally how many rows they hold; here that number counts
  // the household's vocabulary, not the inventory the facet navigates.
  it('heads the section without a tally', async () => {
    const { sr } = await mount({ items: flagged });
    expect(q(sr, '[data-testid="sidebar-status-tally"]')).toBe(null);
    expect(q(sr, '[data-testid="sidebar-toggle-status"]')?.textContent).toContain('Status');
  });
});

describe('hv-full-view: context bar and table', () => {
  it('breadcrumbs the selected location with its filtered count', async () => {
    const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage')];
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { el, store, sr } = await mount({ items, locations });

    expect(q(sr, '[data-testid="full-breadcrumb"]')?.textContent).toContain('All items');

    store.setFilters({ locationIds: ['shelf-a'] });
    await settle(el);
    const crumb = q(sr, '[data-testid="full-breadcrumb"]')?.textContent?.replace(/\s+/g, ' ');
    expect(crumb).toContain('garage › Shelf A');
    // One item is one item, not "1 items".
    expect(crumb).toContain('1 item');
  });

  it('marks the area behind the crumb, where a segment span would read as part of the path', async () => {
    const locations = [
      { ...loc('garage', 'Garage'), area_id: 'area-kitchen' },
      loc('shelf-a', 'Shelf A', 'garage'),
    ];
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'shelf-a' })],
      locations,
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });

    store.setFilters({ locationIds: ['shelf-a'] });
    await settle(el);
    const crumb = q(sr, '[data-testid="full-breadcrumb"]');
    expect(crumb?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(crumb?.textContent?.replace(/\s+/g, ' ')).toContain('garage › Shelf A');
  });

  // Browsing into a root named after its own room must not write the room
  // twice — "Kitchen  Kitchen › Pantry". The crumb elides like every other
  // surface that marks an area, and the pairing stays in the title.
  it('drops the area mark when the crumb already opens with the area name', async () => {
    const kitchen = { ...loc('kitchen', 'Kitchen'), area_id: 'area-kitchen' };
    const pantry: Location = {
      ...loc('pantry', 'Pantry', 'kitchen'),
      path: {
        id_path: ['kitchen', 'pantry'],
        name_path: ['Kitchen', 'Pantry'],
        display_path: 'Kitchen / Pantry',
        sort_key: '',
      },
    };
    for (const [id, path] of [
      ['kitchen', 'Kitchen'],
      ['pantry', 'Kitchen › Pantry'],
    ]) {
      const { el, store, sr } = await mount({
        items: [makeItem({ id: '1', location_id: id })],
        locations: [kitchen, pantry],
        areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
      });
      store.setFilters({ locationIds: [id] });
      await settle(el);

      const crumb = q(sr, '[data-testid="full-breadcrumb"]');
      expect(crumb?.querySelector('.hv-area-chip'), path).toBe(null);
      expect(crumb?.textContent?.replace(/\s+/g, ' ').trim(), path).toContain(path);
      expect(crumb?.getAttribute('title'), path).toBe(`Area: Kitchen · ${path}`);
      el.remove();
    }
  });

  it('leaves the crumb of an arealess tree exactly as it was', async () => {
    const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage')];
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'shelf-a' })],
      locations,
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });

    store.setFilters({ locationIds: ['shelf-a'] });
    await settle(el);
    expect(q(sr, '[data-testid="full-breadcrumb"]')?.querySelector('.hv-area-chip')).toBeNull();
  });

  it('sorts from the table headers', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;

    (table.shadowRoot?.querySelector('[data-field="name"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.sort).toEqual({ field: 'name', order: 'asc' });
  });

  it('adjusts quantity from the table row actions', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', quantity: 5 })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;

    (table.shadowRoot?.querySelector('[data-testid="table-increment"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items[0].quantity).toBe(6);
  });

  it('opens the filter panel from the Filters button', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect(sr.querySelector('hv-filter-panel')).toBe(null);

    (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    expect(sr.querySelector('hv-filter-panel')).toBeTruthy();
  });

  it('hands the column picker up to the host card', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const seen: string[] = [];
    el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail.id));

    (q(sr, '[data-testid="columns-expanded"]') as HTMLButtonElement).click();
    expect(seen).toEqual(['columns']);
  });

  // Organizing was reachable only from inside the ⋮ menu, on the surface where
  // there is room for a button — so the one place with space for it was the one
  // place that hid it. The menu entry stays; the hosts' menu-order pins hold it.
  it('opens Organize from a button on the app bar', async () => {
    for (const embedded of [false, true]) {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      el.embedded = embedded;
      await settle(el);
      const seen: unknown[] = [];
      el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail));

      const button = q(sr, '[data-testid="full-organize"]') as HTMLButtonElement;
      expect(button, embedded ? 'embedded' : 'modal').toBeTruthy();
      expect(button.getAttribute('aria-label')).toBe('Organize');
      button.click();

      // No tab named: Organize opens on its default, Locations.
      expect(seen).toEqual([{ id: 'organize' }]);
      el.remove();
    }
  });

  // The same sentence the card's footer prints: one fact, one phrasing, and it
  // names what it is counting.
  it('counts loaded rows against the filtered total, in the words the card uses', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const { el, store, sr } = await mount({ items });
    expect(q(sr, '[data-testid="full-footer"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Showing 50 of 60 items · scroll to load more',
    );

    store.setFilters({ q: 'i1' });
    await settle(el);
    await settle(el);
    expect(q(sr, '[data-testid="full-footer"]')?.textContent).toContain('matching item');
  });
});

// The card's list named the situation, explained it and offered a way out. This
// table answered with one bare sentence and nothing to press — on the surface
// with a sidebar, an app-bar search and a filter panel, where you are most
// likely to filter yourself down to nothing.
describe('hv-full-view: empty table', () => {
  it('offers a way out of an over-filtered table', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    store.setFilters({ q: 'nothing matches this' });
    await settle(el);
    await settle(el);

    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    expect(table.shadowRoot?.querySelector('[data-testid="table-empty"]')).toBeTruthy();
    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('no-matches');
    expect(empty.textContent).toContain('No items match these filters');

    (q(sr, '[data-testid="empty-action"][data-id="clear-filters"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.q).toBe('');
  });

  it('treats a lone location filter as an empty location, and offers to fill it', async () => {
    const { el, store, sr } = await mount({ items: [], locations: [loc('garage', 'Garage')] });
    store.setFilters({ locationIds: ['garage'] });
    await settle(el);
    await settle(el);

    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('empty-location');
    expect(empty.textContent).toContain('Nothing in Garage');

    (q(sr, '[data-testid="empty-action"][data-id="add-item"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();
  });

  it('names an untouched inventory rather than the filters', async () => {
    const { sr } = await mount({ items: [] });
    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('no-items');
    expect(empty.textContent).toContain('No items yet');
  });

  it('waits for the fetch instead of blaming the filters for the gap', async () => {
    // Changing a filter clears the rows and asks for the next page, so between
    // the two the table has nothing to show and no answer yet. Filling that gap
    // with "No items match these filters" and a Clear all button blames a
    // filter nothing has been counted for.
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    store.setFilters({ q: 'wood' });
    await el.updateComplete;

    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('loading');
    expect(empty.textContent).toContain('Loading items');
    expect(q(sr, '[data-testid="empty-action"]')).toBe(null);

    await settle(el);
    await settle(el);
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    expect(table.shadowRoot?.querySelector('[data-testid="table-row"]')).toBeTruthy();
  });
});

describe('hv-full-view: editing', () => {
  it('edits in place above the table', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;

    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    expect(editor).toBeTruthy();
    expect(editor.shadowRoot?.textContent).toContain('Wood Glue — editing');
  });

  it('adds an item from the app bar', async () => {
    const { el, store, sr } = await mount({ items: [] });
    (q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'From full view';
    name.dispatchEvent(new Event('input'));
    (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items.map((i) => i.name)).toContain('From full view');
    expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
  });

  // Without this the editor renders `.item` as null once the row is gone —
  // and a null item is the create form. On the panel there is no shell to
  // clean up after the editor, so the view closes it itself.
  it('closes the editor when the item being edited is deleted', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();

    await store.deleteItem('1', 1);
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
  });

  it('keeps the editor open when some other item is deleted', async () => {
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Wood Glue' }), makeItem({ id: '2', name: 'Clamps' })],
    });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();

    await store.deleteItem('2', 1);
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();
  });

  // A row that stops matching is not a row that stopped existing: the typed
  // edits are still worth saving, so the form is pinned and says why.
  it('pins the editor when a filter change drops the item from the list', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement & { item: { name: string } | null };
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'Wood Glue EDITED';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(el);

    store.setFilters({ q: 'matches nothing at all' });
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBe(editor);
    expect(editor.item?.name).toBe('Wood Glue');
    expect(
      (editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement).value,
    ).toBe('Wood Glue EDITED');
    expect(q(sr, '[data-testid="pinned-editor-hint"]')?.textContent).toContain(
      'No longer matches the current filters',
    );
  });

  // This surface fills the screen, so the card's banner list is not behind it:
  // without a sentence inside the form the user is left with a form that did not
  // close and no account of why.
  describe('a rejected save', () => {
    const openEditor = async (el: HVFullView, sr: ShadowRoot) => {
      const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
      (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
      await settle(el);
      return q(sr, '[data-testid="full-editor"]') as HTMLElement & { busy: boolean };
    };
    const save = async (el: HVFullView, sr: ShadowRoot) => {
      const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
      const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
      name.value = 'New';
      name.dispatchEvent(new Event('input'));
      (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);
    };
    const errorText = (sr: ShadowRoot) =>
      (q(sr, '[data-testid="full-editor"]') as HTMLElement | null)?.shadowRoot?.querySelector(
        '[data-testid="editor-error"]',
      )?.textContent;

    it('names itself inside the open form and clears the busy state', async () => {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      store['ws'].updateItem = async () => {
        throw { code: 'storage_error', message: 'the store is read-only' };
      };

      const editor = await openEditor(el, sr);
      await save(el, sr);

      expect(errorText(sr)).toContain('the store is read-only');
      expect(editor.busy).toBe(false);
      expect(
        (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).textContent?.trim(),
      ).toBe('Save');
    });

    // Version numbers say nothing to someone looking at a form, and the two
    // hosts of the editor share the sentence rather than each writing one.
    it('says a conflict in the same words the card does', async () => {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      store['ws'].updateItem = async () => {
        throw { code: 'conflict', message: 'version conflict: expected 1, actual 2' };
      };

      await openEditor(el, sr);
      await save(el, sr);

      expect(errorText(sr)).toContain('Someone else changed this item');
    });

    it('clears once the save lands', async () => {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      const reject = async () => {
        throw { code: 'storage_error', message: 'the store is read-only' };
      };
      store['ws'].updateItem = reject;

      await openEditor(el, sr);
      await save(el, sr);
      expect(errorText(sr)).toContain('the store is read-only');

      store['ws'].updateItem = async (id: string) => ({ ...makeItem({ id, name: 'New' }), version: 2 });
      await save(el, sr);

      expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
    });

    it('drops the error again when the next edit opens', async () => {
      const { el, store, sr, host } = await mount({
        items: [makeItem({ id: '1', name: 'Old' }), makeItem({ id: '2', name: 'Other' })],
      });
      store['ws'].updateItem = async () => {
        throw { code: 'storage_error', message: 'the store is read-only' };
      };

      await openEditor(el, sr);
      await save(el, sr);
      expect(errorText(sr)).toContain('the store is read-only');

      const rows = [
        ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
          '[data-testid="table-edit"]',
        ) ?? []),
      ] as HTMLButtonElement[];
      rows[rows.length - 1].click();
      await settle(el);
      // The refused save left the typed name in the form, so the switch asks
      // before it takes it away.
      expect(host.asked).toBe(1);
      host.answer('discard');
      await settle(el);

      expect(q(sr, '[data-testid="full-editor"]')?.shadowRoot?.textContent).toContain('Other — editing');
      expect(errorText(sr)).toBeUndefined();
    });
  });

  it('releases the pin when the editor is cancelled', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    store.setFilters({ q: 'matches nothing at all' });
    await settle(el);
    await settle(el);
    expect(q(sr, '[data-testid="pinned-editor-hint"]')).toBeTruthy();

    q(sr, '[data-testid="full-editor"]')?.dispatchEvent(
      new CustomEvent('cancel', { bubbles: true, composed: true }),
    );
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
    expect(q(sr, '[data-testid="pinned-editor-hint"]')).toBe(null);
  });

});

// Switching rows, the backdrop and Escape all wiped a form mid-sentence. The
// card's row switch had asked since it shipped; this surface asked nowhere.
describe('hv-full-view: leaving a dirty form always asks', () => {
  /** Open the first row's editor and type into it. */
  async function dirtyEditor(items: Item[]) {
    const mounted = await mount({ items });
    const { el, sr } = mounted;
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'Typed but unsaved';
    name.dispatchEvent(new Event('input'));
    await settle(el);
    return mounted;
  }

  const editorName = (sr: ShadowRoot) =>
    (
      (q(sr, '[data-testid="full-editor"]') as HTMLElement | null)?.shadowRoot?.querySelector(
        '[data-testid="editor-name"]',
      ) as HTMLInputElement | null
    )?.value;

  const two = () => [makeItem({ id: '1', name: 'First' }), makeItem({ id: '2', name: 'Second' })];

  /** Every way out of the open form on this surface. */
  const leave = {
    'row switch': (sr: ShadowRoot) => {
      const rows = [
        ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
          '[data-testid="table-edit"]',
        ) ?? []),
      ] as HTMLButtonElement[];
      rows[rows.length - 1].click();
    },
    backdrop: (sr: ShadowRoot) => (q(sr, '.backdrop') as HTMLElement).click(),
    escape: (sr: ShadowRoot) =>
      (q(sr, '[data-testid="full-view"]') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    close: (sr: ShadowRoot) => (q(sr, '[data-testid="expand-toggle"]') as HTMLButtonElement).click(),
  } as const;

  it.each(Object.keys(leave) as (keyof typeof leave)[])(
    '%s asks first and changes nothing until it is answered',
    async (how) => {
      const { el, sr, host } = await dirtyEditor(two());
      let closes = 0;
      el.addEventListener('close', () => {
        closes += 1;
      });

      leave[how](sr);
      await settle(el);

      expect(host.asked).toBe(1);
      expect(closes).toBe(0);
      expect(el.open).toBe(true);
      expect(editorName(sr)).toBe('Typed but unsaved');
    },
  );



  it('opens the other row once the discard is confirmed', async () => {
    const { el, sr, host } = await dirtyEditor(two());

    leave['row switch'](sr);
    await settle(el);
    host.answer('discard');
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')?.shadowRoot?.textContent).toContain('Second — editing');
    expect(editorName(sr)).toBe('Second');
  });

  it.each(['backdrop', 'escape', 'close'] as const)(
    'closes the view once %s is confirmed',
    async (how) => {
      const { el, sr, host } = await dirtyEditor(two());
      let closes = 0;
      el.addEventListener('close', () => {
        closes += 1;
      });

      leave[how](sr);
      await settle(el);
      host.answer('discard');
      await settle(el);

      expect(closes).toBe(1);
      expect(el.open).toBe(false);
    },
  );

  it('leaves a clean form without a word', async () => {
    const { el, sr, host } = await mount({ items: two() });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    leave['row switch'](sr);
    await settle(el);

    expect(host.asked).toBe(0);
    expect(editorName(sr)).toBe('Second');
  });

  // The panel has no backdrop, no Escape and no close button, but it switches
  // rows in the same table.
  it('asks on a row switch in the embedded panel too', async () => {
    const { el, sr, host } = await mount({ items: two(), embedded: true });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const name = (q(sr, '[data-testid="full-editor"]') as HTMLElement).shadowRoot?.querySelector(
      '[data-testid="editor-name"]',
    ) as HTMLInputElement;
    name.value = 'Typed but unsaved';
    name.dispatchEvent(new Event('input'));
    await settle(el);

    leave['row switch'](sr);
    await settle(el);

    expect(host.asked).toBe(1);
    expect(editorName(sr)).toBe('Typed but unsaved');
  });

  // The form inside asks through the same host, so this surface's ways out and
  // the form's own Cancel cannot become two different questions.
  it('hands the form the same asker it uses itself', async () => {
    const { sr, host } = await dirtyEditor(two());
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement & { confirmDiscard: unknown };
    expect(editor.confirmDiscard).toBe(host.ask);
  });

  it('keeps the form when the question is declined', async () => {
    const { el, sr, host } = await dirtyEditor(two());

    leave.backdrop(sr);
    await settle(el);
    host.answer('keep');
    await settle(el);

    expect(el.open).toBe(true);
    expect(editorName(sr)).toBe('Typed but unsaved');
  });
});

// This surface switches its own layout on a media query, but its two biggest
// children switch theirs on a `mobile` property that only the card ever set —
// so at 375px the expanded view drew the editor's three-column desktop grid in
// 156px + 78px + 78px, with "Low-stock at" wrapping over its own field.
describe('hv-full-view: phone-width children', () => {
  it('tells the item editor when it is on a phone', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [] });
      (q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement).click();
      await settle(el);
      expect(q(sr, '[data-testid="full-editor"]')?.hasAttribute('mobile')).toBe(true);
    } finally {
      restore();
    }
  });

  it('leaves the editor on its desktop layout at desktop widths', async () => {
    const restore = stubViewport(false);
    try {
      const { el, sr } = await mount({ items: [] });
      (q(sr, '[data-testid="full-add-item"]') as HTMLButtonElement).click();
      await settle(el);
      expect(q(sr, '[data-testid="full-editor"]')?.hasAttribute('mobile')).toBe(false);
    } finally {
      restore();
    }
  });

  // The table is scrolled sideways at this width, so its LOCATION column is off
  // the screen — and a wrapped path there was still setting the row's height.
  // The table cannot read the media query itself; this is where it learns.
  it('tells the table when it is on a phone', async () => {
    for (const narrow of [true, false]) {
      const restore = stubViewport(narrow);
      try {
        const { sr } = await mount({ items: [makeItem({ id: '1' })] });
        expect(q(sr, '[data-testid="full-table"]')?.hasAttribute('narrow'), String(narrow)).toBe(narrow);
      } finally {
        restore();
      }
    }
  });

  // The panel stages its edits on a phone and drops its own footer, expecting
  // its host to provide one. Telling it "phone" without that would stage every
  // edit with no way to apply it.
  it('stages the phone filter panel behind a commit row', async () => {
    const restore = stubViewport(true);
    try {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      expect(panel.hasAttribute('mobile')).toBe(true);
      expect(q(sr, '[data-testid="full-panel-foot"]')).toBeTruthy();

      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      // Staged, not applied.
      expect(store.state.value.filters.lowStockOnly).toBe(false);

      (q(sr, '[data-testid="full-panel-apply"]') as HTMLButtonElement).click();
      await settle(el);
      expect(store.state.value.filters.lowStockOnly).toBe(true);
      // Applying closes the panel, as it does in the card's filter sheet.
      expect(q(sr, '[data-testid="full-filter-panel"]')).toBe(null);
    } finally {
      restore();
    }
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the button in reading order.
  it('names the holder the Filters button discloses, open or shut', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const toggle = () => q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement;
    const id = 'full-view-filter-panel';

    expect(toggle().getAttribute('aria-controls')).toBe(id);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // The id has to resolve in both states — a button pointing at nothing
    // announces as controlling nothing — so the holder outlives the panel.
    const shut = sr.getElementById(id);
    expect(shut, 'holder shut').toBeTruthy();
    expect(shut?.querySelector('[data-testid="full-filter-panel"]'), 'no panel while shut').toBe(null);

    toggle().click();
    await settle(el);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(id);
    expect(sr.getElementById(id)?.querySelector('[data-testid="full-filter-panel"]')).toBeTruthy();
  });

  // The holder sets a display of its own, which outranks the browser's rule for
  // [hidden] — without this it would lay out its padding while empty.
  it('takes the shut holder out of the layout it would otherwise pad', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect((sr.getElementById('full-view-filter-panel') as HTMLElement).hidden).toBe(true);
    expect(componentCss('hv-full-view')).toMatch(/\.panel-holder\[hidden\] \{[^}]*display: none/);

    (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    expect((sr.getElementById('full-view-filter-panel') as HTMLElement).hidden).toBe(false);
  });

  it('keeps the desktop panel live-applying, with no commit row', async () => {
    const restore = stubViewport(false);
    try {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      expect(panel.hasAttribute('mobile')).toBe(false);
      expect(q(sr, '[data-testid="full-panel-foot"]')).toBe(null);

      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      expect(store.state.value.filters.lowStockOnly).toBe(true);
    } finally {
      restore();
    }
  });

  // Three controls on one 375px row is one too many for a language that spells
  // `hv.action.clearAll` in two long words: the clear button broke over two
  // lines and stacked the primary button's count sentence over three. The
  // card's filter sheet already carries the clear in a head row; this is that
  // shape.
  it('carries the clear-all in a head row and leaves the phone footer two buttons', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const head = q(sr, '[data-testid="full-panel-head"]') as HTMLElement;
      expect(head).toBeTruthy();
      expect(head.querySelector('[data-testid="full-panel-clear"]')).toBeTruthy();

      const foot = q(sr, '[data-testid="full-panel-foot"]') as HTMLElement;
      expect([...foot.querySelectorAll('button')].map((b) => b.dataset.testid)).toEqual([
        'full-panel-cancel',
        'full-panel-apply',
      ]);
      // The head is read before the filters it clears, so it sits above the
      // scroll box rather than after it.
      expect(head.nextElementSibling?.classList.contains('panel-scroll')).toBe(true);
    } finally {
      restore();
    }
  });

  it('clears the staged set from the moved clear button, and counts what is staged', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const count = () => (q(sr, '[data-testid="full-panel-count"]') as HTMLElement).textContent?.trim();
      expect(count()).toBe('0 active');

      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      expect(count()).toBe('1 active');

      (q(sr, '[data-testid="full-panel-clear"]') as HTMLButtonElement).click();
      await settle(el);
      expect(count()).toBe('0 active');
      expect(
        (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLElement).getAttribute(
          'aria-pressed',
        ),
      ).toBe('false');
    } finally {
      restore();
    }
  });

  // Turn the phone sideways with the panel open and the panel drops its own
  // draft, because it is no longer the surface that stages one. A staged set
  // held across that flip would leave the head row counting filters the
  // controls under it no longer carry.
  it('drops the staged set when the viewport stops being narrow', async () => {
    // The stub is the restore, and it announces the flip.
    const viewport = stubViewport(true);
    try {
      const { el, sr } = await mount({
        items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })],
      });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const count = () => (q(sr, '[data-testid="full-panel-count"]') as HTMLElement).textContent?.trim();
      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      expect(count()).toBe('1 active');

      viewport.announce(false);
      await settle(el);
      expect(q(sr, '[data-testid="full-panel-head"]'), 'no phone head row on a desktop width').toBe(null);

      viewport.announce(true);
      await settle(el);
      expect(count()).toBe('0 active');
    } finally {
      viewport();
    }
  });

  it('leaves the desktop panel without a head row', async () => {
    const restore = stubViewport(false);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      expect(q(sr, '[data-testid="full-panel-head"]')).toBe(null);
      expect(q(sr, '[data-testid="full-panel-clear"]')).toBe(null);
    } finally {
      restore();
    }
  });

  // The ⋮ menu carries "Columns…" on every host, so the phone toolbar can drop
  // the icon button and keep its remaining controls on one row.
  it('drops the column picker button on a phone', async () => {
    const restore = stubViewport(true);
    try {
      const { sr } = await mount({ items: [makeItem({ id: '1' })] });
      expect(q(sr, '[data-testid="columns-expanded"]')).toBe(null);
    } finally {
      restore();
    }
  });

  it('keeps the column picker button where the row has room for it', async () => {
    const restore = stubViewport(false);
    try {
      const { sr } = await mount({ items: [makeItem({ id: '1' })] });
      expect(q(sr, '[data-testid="columns-expanded"]')).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe('hv-full-view: app bar filters', () => {
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

describe('hv-full-view: selection and bulk actions', () => {
  const bulkBar = (sr: ShadowRoot) => sr.querySelector('[data-testid="full-bulk-bar"]') as HTMLElement;
  const table = (sr: ShadowRoot) => sr.querySelector('[data-testid="full-table"]') as HTMLElement;

  async function enterSelection(el: HVFullView, sr: ShadowRoot) {
    const menu = sr.querySelector('[data-testid="full-overflow"]') as HTMLElement;
    (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    await settle(el);
    (menu.shadowRoot?.querySelector('[data-id="select-items"]') as HTMLButtonElement).click();
    await settle(el);
  }

  const withSelectEntry = { entries: [{ id: 'select-items', label: 'Select items…' }] };

  it('swaps the app bar for the selection bar', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    expect(q(sr, '[data-testid="selection-bar"]')).toBe(null);

    await enterSelection(el, sr);
    expect(q(sr, '[data-testid="selection-bar"]')).toBeTruthy();
    // The normal app bar is gone, not stacked.
    expect(q(sr, '[data-testid="full-add-item"]')).toBe(null);
  });

  it('counts the selection honestly against the filtered total', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const { el, store, sr } = await mount({ items });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="selection-count"]')?.textContent).toContain('50 selected');
    expect(q(sr, '[data-testid="selection-subcount"]')?.textContent).toContain('of 60 matching');
    // And it says out loud that select-all only covered what is loaded.
    expect(q(sr, '[data-testid="selection-honesty"]')?.textContent).toContain(
      'Select-all covers loaded rows only',
    );
    expect(store.state.value.selection.size).toBe(50);
  });

  it('offers an explicit path to selecting everything that matches', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const { el, store, sr } = await mount({ items });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    const loadAll = q(sr, '[data-testid="selection-load-all"]') as HTMLButtonElement;
    expect(loadAll.textContent).toContain('Load all 60 to select');
    loadAll.click();
    await settle(el);
    await settle(el);

    expect(store.state.value.selection.size).toBe(60);
  });

  it('runs a bulk move and reports it', async () => {
    const locations = [loc('workshop', 'Workshop')];
    const items = [makeItem({ id: '1' }), makeItem({ id: '2' })];
    const { el, store, sr } = await mount({ items, locations });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);

    const bar = bulkBar(sr);
    (bar.shadowRoot?.querySelector('[data-testid="bulk-action"][data-action="move"]') as HTMLButtonElement).click();
    await settle(el);
    const tree = bar.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="workshop"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items.every((i) => i.location_id === 'workshop')).toBe(true);
    expect(bar.shadowRoot?.querySelector('[data-testid="bulk-result-summary"]')?.textContent).toContain(
      '2 of 2 succeeded',
    );
  });

  it('keeps the failures listed and the selection narrowed to them', async () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2', name: 'Stubborn' })];
    const { el, store, sr } = await mount({ items });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);

    // One of the two rows refuses.
    const realBulk = store['ws'].bulk.bind(store['ws']);
    store['ws'].bulk = async (ops) => {
      const res = await realBulk(ops);
      const doomed = ops.find((o) => o.payload.item_id === '2');
      if (doomed) {
        res.results[doomed.op_id] = {
          success: false,
          error: { code: 'conflict', message: 'version conflict' },
        };
      }
      return res;
    };

    const bar = bulkBar(sr);
    (bar.shadowRoot?.querySelector('[data-action="check-in"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(bar.shadowRoot?.querySelector('[data-testid="bulk-result-summary"]')?.textContent).toContain(
      '1 of 2 succeeded',
    );
    expect(bar.shadowRoot?.querySelector('[data-testid="bulk-failure"]')?.textContent).toContain('Stubborn');
    expect([...store.state.value.selection]).toEqual(['2']);
  });

  // A batch is asked for a due date exactly as a single row is: firing on the
  // press with no date means a bulk check-out can never go overdue.
  describe('bulk check-out asks for a due date, once', () => {
    async function selectTwoAndCheckOut() {
      const items = [makeItem({ id: '1' }), makeItem({ id: '2' })];
      const mounted = await mount({ items });
      const { el, sr } = mounted;
      el.menuEntries = withSelectEntry.entries;
      await settle(el);
      await enterSelection(el, sr);

      (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
      await settle(el);
      (bulkBar(sr).shadowRoot?.querySelector('[data-action="check-out"]') as HTMLButtonElement).click();
      await settle(el);

      const popover = q(sr, '[data-testid="full-bulk-checkout"]') as HTMLElement & {
        open: boolean;
        inline: boolean;
        touch: boolean;
      };
      return { ...mounted, popover };
    }

    // Opened by a bar at the foot of the table, so it has no body to be a step
    // inside of and stays a centred dialog. That says nothing about how big its
    // controls should be: on the narrow branch a finger has to hit them.
    it('takes finger-sized controls on the narrow branch and stays a centred dialog', async () => {
      for (const narrow of [false, true]) {
        const restore = stubViewport(narrow);
        try {
          const { el, popover } = await selectTwoAndCheckOut();
          const where = `narrow=${narrow}`;
          expect(popover.open, where).toBe(true);
          expect(popover.inline, where).toBe(false);
          expect(popover.touch, where).toBe(narrow);
          expect(
            popover.shadowRoot?.querySelector('.scrim')?.classList.contains('dim'),
            where,
          ).toBe(true);
          el.remove();
        } finally {
          restore();
        }
      }
    });

    it('opens one popover for the whole selection and applies the date to every row', async () => {
      const { el, store, popover } = await selectTwoAndCheckOut();
      expect(popover.open).toBe(true);
      // One question, named for what it covers.
      expect(popover.shadowRoot?.querySelector('[data-testid="checkout-title"]')?.textContent).toContain(
        'Check out 2 items',
      );
      // Nothing has run yet.
      expect(store.state.value.items.some((i) => i.checked_out)).toBe(false);

      const date = popover.shadowRoot?.querySelector(
        '[data-testid="checkout-date"] input',
      ) as HTMLInputElement;
      date.value = '2031-04-05';
      date.dispatchEvent(new Event('input', { bubbles: true }));
      await settle(el);
      (popover.shadowRoot?.querySelector('[data-testid="checkout-confirm"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.map((i) => [i.checked_out, i.due_date])).toEqual([
        [true, '2031-04-05'],
        [true, '2031-04-05'],
      ]);
    });

    it('honours the explicit no-date choice', async () => {
      const { el, store, popover } = await selectTwoAndCheckOut();
      (popover.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.every((i) => i.checked_out && i.due_date === null)).toBe(true);
    });

    it('checks nothing out when the question is cancelled', async () => {
      const { el, store, popover } = await selectTwoAndCheckOut();
      (popover.shadowRoot?.querySelector('[data-testid="checkout-cancel"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.some((i) => i.checked_out)).toBe(false);
    });

    // Nothing to ask about, so nothing is asked.
    it('leaves bulk check-in immediate', async () => {
      const items = [makeItem({ id: '1', checked_out: true }), makeItem({ id: '2', checked_out: true })];
      const { el, store, sr } = await mount({ items });
      el.menuEntries = withSelectEntry.entries;
      await settle(el);
      await enterSelection(el, sr);

      (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
      await settle(el);
      (bulkBar(sr).shadowRoot?.querySelector('[data-action="check-in"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.every((i) => !i.checked_out)).toBe(true);
    });
  });

  it('confirms a bulk delete and warns about checked-out items', async () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2', checked_out: true })];
    const { el, store, sr } = await mount({ items });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);

    (bulkBar(sr).shadowRoot?.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = q(sr, '[data-testid="bulk-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    expect(confirm.shadowRoot?.textContent).toContain('Delete 2 items?');
    const warning = confirm.shadowRoot?.querySelector('[data-testid="confirm-warning"]') as HTMLElement;
    expect(warning.shadowRoot?.textContent).toContain('1 of them is checked out');

    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(store.state.value.items).toHaveLength(0);
  });

  // This view's own confirm belongs to the same family as the dialogs the host
  // owns: one width flips every overlay, so a phone never shows a centred box
  // over sheets.
  it('raises its delete confirm as a sheet on a phone viewport', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      el.menuEntries = withSelectEntry.entries;
      await settle(el);
      await enterSelection(el, sr);

      (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
      await settle(el);
      (bulkBar(sr).shadowRoot?.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
      await settle(el);

      expect(q(sr, '[data-testid="bulk-confirm"]')?.hasAttribute('mobile')).toBe(true);
    } finally {
      restore();
    }
  });

  it('leaves everything alone when the delete is cancelled', async () => {
    const items = [makeItem({ id: '1' })];
    const { el, store, sr } = await mount({ items });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);
    (bulkBar(sr).shadowRoot?.querySelector('[data-action="delete"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = q(sr, '[data-testid="bulk-confirm"]') as HTMLElement & { open: boolean };
    (confirm.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.items).toHaveLength(1);
  });

  it('exits selection mode and clears the selection', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' })] });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.selection.size).toBe(1);

    (q(sr, '[data-testid="exit-selection"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.selection.size).toBe(0);
    expect(q(sr, '[data-testid="selection-bar"]')).toBe(null);
    expect(q(sr, '[data-testid="full-add-item"]')).toBeTruthy();
  });
});

// A lost connection, paused live updates and a refused operation showed on the
// card and nowhere else — and this surface and the panel are the ones that fill
// the screen, so the card's copy is not behind them to be read.
describe('hv-full-view: failures are visible here too', () => {
  const banner = (sr: ShadowRoot, testid: string) => q(sr, `[data-testid="${testid}"]`);

  it('says nothing while everything is fine', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect(banner(sr, 'degraded-banners')).toBe(null);
    expect(banner(sr, 'banners')).toBe(null);
  });

  it('says the connection is lost and asks its host for the re-read', async () => {
    const { el, store, hass, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const actions: string[] = [];
    el.addEventListener('menu-action', (e) => actions.push((e as CustomEvent).detail.id));

    hass.__failNext(2, new Error('socket closed'));
    await store.refreshStats().catch(() => undefined);
    await store.refreshStats().catch(() => undefined);
    await settle(el);

    expect(banner(sr, 'degraded-offline')).toBeTruthy();
    (banner(sr, 'degraded-reconnect') as HTMLButtonElement).click();
    // The dialogs and the re-read live in the host's HostSurfaces, and both
    // hosts already answer this entry.
    expect(actions).toEqual(['refresh']);
  });

  it('carries the error queue with its conflict actions', async () => {
    const { el, store, hass, sr } = await mount({ items: [makeItem({ id: '1', name: 'A' })] });
    store['pushError']({ code: 'conflict', message: 'version conflict' }, { itemId: '1', changes: { name: 'B' } });
    await settle(el);

    expect((banner(sr, 'banner-entry') as HTMLElement).dataset.code).toBe('conflict');
    expect(banner(sr, 'banner-view-latest')).toBeTruthy();

    hass.__setConflict(false);
    (banner(sr, 'banner-reapply') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.items.find((i) => i.id === '1')?.name).toBe('B');
    expect(banner(sr, 'banner-entry')).toBe(null);
  });

  it('dismisses a plain error, which carries no conflict actions', async () => {
    const { el, store, sr } = await mount({ items: [] });
    store['pushError']({ code: 'storage_error', message: 'disk full' });
    await settle(el);

    expect(banner(sr, 'banner-view-latest')).toBe(null);
    (banner(sr, 'banner-dismiss') as HTMLButtonElement).click();
    await settle(el);
    expect(banner(sr, 'banner-entry')).toBe(null);
  });

  // The panel renders nothing but this component's embedded variant, so this is
  // the only place its banners can come from.
  it('renders them in the embedded variant the panel uses', async () => {
    const { el, store, sr } = await mount({ items: [], embedded: true });
    store['pushError']({ code: 'storage_error', message: 'disk full' });
    await settle(el);

    expect(banner(sr, 'banner-entry')?.shadowRoot?.textContent).toContain('disk full');
  });

  // Two ways of saying a save failed would be one too many. The sentence in the
  // form is the save's; the queue carries everything with nowhere else to be.
  it('leaves the open form to speak for a refused save', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
    store['ws'].updateItem = async () => {
      throw { code: 'storage_error', message: 'the store is read-only' };
    };
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(
      (q(sr, '[data-testid="full-editor"]') as HTMLElement).shadowRoot?.querySelector(
        '[data-testid="editor-error"]',
      )?.textContent,
    ).toContain('the store is read-only');
    // And the queue still holds it, so dismissing the form does not lose it.
    expect(banner(sr, 'banner-entry')).toBeTruthy();
  });
});

// The table's rows had a Delete key and no visible equivalent, and none of the
// three actions the card's rows offer.
describe('hv-full-view: table row actions', () => {
  const pick = (sr: ShadowRoot, id: string, row = 0) => {
    const menus = [
      ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
        '[data-testid="table-row-menu"]',
      ) ?? []),
    ];
    menus[row].dispatchEvent(new CustomEvent('select', { detail: { id }, bubbles: true, composed: true }));
  };

  it('checks an item back in', async () => {
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Drill', checked_out: true })],
    });

    pick(sr, 'check-in');
    await settle(el);

    expect(store.state.value.items.find((i) => i.id === '1')?.checked_out).toBe(false);
  });

  it('asks for a due date before checking out, and applies the one picked', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });

    pick(sr, 'check-out');
    await settle(el);
    const popover = q(sr, '[data-testid="full-checkout"]') as HTMLElement & { open: boolean };
    expect(popover.open).toBe(true);

    (popover.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    await settle(el);

    expect(popover.open).toBe(false);
    expect(store.state.value.items.find((i) => i.id === '1')?.checked_out).toBe(true);
  });

  // The popover's inline step is a static card meant to sit inside the body of
  // the surface that opened it — and this call site is a sibling at the end of
  // the shell with no body around it, so the step landed stranded and unscrimmed
  // at the foot of the page. Anchoring is no better here: the ⋮ it would hang
  // from sits in a column the table scrolls sideways out of view. It presents
  // the way the bulk popover does. How big its controls are is a separate ask,
  // which is why `touch` follows the narrow branch while the placement does not.
  it('presents the single-row check-out centred and scrimmed at every width', async () => {
    for (const narrow of [false, true]) {
      const restore = stubViewport(narrow);
      try {
        const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
        pick(sr, 'check-out');
        await settle(el);

        const popover = q(sr, '[data-testid="full-checkout"]') as HTMLElement & {
          open: boolean;
          inline: boolean;
          touch: boolean;
          anchor: DOMRect | null;
        };
        const where = `narrow=${narrow}`;
        expect(popover.open, where).toBe(true);
        expect(popover.inline, where).toBe(false);
        expect(popover.touch, where).toBe(narrow);
        expect(popover.anchor, where).toBe(null);

        const scrim = popover.shadowRoot?.querySelector('.scrim');
        expect(scrim?.classList.contains('dim'), where).toBe(true);
        const card = popover.shadowRoot?.querySelector('[data-testid="checkout-popover"]');
        expect(card?.getAttribute('style'), where).toContain('left: 50%');

        el.remove();
      } finally {
        restore();
      }
    }
  });

  it('sets a due date on an item already out', async () => {
    const { el, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Drill', checked_out: true })],
    });

    pick(sr, 'set-due-date');
    await settle(el);

    const popover = q(sr, '[data-testid="full-checkout"]') as HTMLElement & {
      open: boolean;
      mode: string;
    };
    expect(popover.open).toBe(true);
    expect(popover.mode).toBe('set-due-date');
  });

  it('hands Delete to the host, which owns the confirmation', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
    const asked: { itemId: string; name: string }[] = [];
    el.addEventListener('request-delete', (e) => asked.push((e as CustomEvent).detail));

    pick(sr, 'delete');
    await settle(el);

    expect(asked).toEqual([{ itemId: '1', name: 'Drill' }]);
  });

  it('opens the form from the menu, through the same dirty guard as a row click', async () => {
    const { el, sr, host } = await mount({
      items: [makeItem({ id: '1', name: 'First' }), makeItem({ id: '2', name: 'Second' })],
    });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const name = (q(sr, '[data-testid="full-editor"]') as HTMLElement).shadowRoot?.querySelector(
      '[data-testid="editor-name"]',
    ) as HTMLInputElement;
    name.value = 'Typed but unsaved';
    name.dispatchEvent(new Event('input'));
    await settle(el);

    pick(sr, 'edit', 1);
    await settle(el);

    expect(host.asked).toBe(1);
  });
});

// The card answers a tap on a row with the detail sheet; this surface answered
// it with the edit form, so the sidebar page at phone width had no read view at
// all — the table it would have been is off the side of the screen.
describe('hv-full-view: the detail sheet is the narrow read view', () => {
  const sheet = (sr: ShadowRoot) =>
    q(sr, '[data-testid="full-detail-sheet"]') as
      | (HTMLElement & { open: boolean; item: Item | null; updateComplete: Promise<unknown> })
      | null;
  const openRow = async (el: HVFullView, sr: ShadowRoot, index = 0) => {
    const rows = [
      ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
        '[data-testid="table-row"]',
      ) ?? []),
    ] as HTMLElement[];
    rows[index].click();
    await settle(el);
    await settle(el);
  };

  it('opens the sheet on a row tap, not the form', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
      await openRow(el, sr);

      expect(sheet(sr)?.open).toBe(true);
      expect(sheet(sr)?.item?.name).toBe('Drill');
      expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
    } finally {
      restore();
    }
  });

  it('puts Edit one tap deeper, inside the sheet', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
      await openRow(el, sr);

      const inner = sheet(sr)!;
      (inner.shadowRoot?.querySelector('[data-testid="sheet-edit"]') as HTMLButtonElement).click();
      await inner.updateComplete;

      expect(inner.shadowRoot?.querySelector('[data-testid="sheet-editor"]')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('saves through the surface that owns the store', async () => {
    const restore = stubViewport(true);
    try {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      await openRow(el, sr);

      const inner = sheet(sr)!;
      (inner.shadowRoot?.querySelector('[data-testid="sheet-edit"]') as HTMLButtonElement).click();
      await inner.updateComplete;
      const editor = inner.shadowRoot?.querySelector('[data-testid="sheet-editor"]') as HTMLElement;
      const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
      name.value = 'New';
      name.dispatchEvent(new Event('input'));
      await inner.updateComplete;
      (inner.shadowRoot?.querySelector('[data-testid="sheet-save"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.find((i) => i.id === '1')?.name).toBe('New');
    } finally {
      restore();
    }
  });

  it('closes the sheet when the item it shows is deleted', async () => {
    const restore = stubViewport(true);
    try {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
      await openRow(el, sr);
      expect(sheet(sr)?.open).toBe(true);

      const item = store.state.value.items[0];
      await store.deleteItem(item.id, item.version);
      await settle(el);

      expect(sheet(sr)?.open).toBe(false);
    } finally {
      restore();
    }
  });

  // The table is its own read surface at a width that can show it, and the row
  // says most of what the sheet would.
  it('keeps the inline form on a desktop viewport', async () => {
    const restore = stubViewport(false);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
      await openRow(el, sr);

      expect(q(sr, '[data-testid="full-detail-sheet"]')).toBe(null);
      expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();
    } finally {
      restore();
    }
  });
});

// Every status, category and tag row was a tab stop of its own, so the walk
// from the search box to the first table row grew with the household's
// vocabulary: 184 presses on a seeded install, 122 of them labels. Each list is
// now one stop with the arrows moving inside it, the shape the locations tree
// already carries.
describe('hv-full-view: one tab stop per facet list', () => {
  const faceted = [
    makeItem({ id: '1', category: 'Cleaning', tags: ['heavy'] }),
    makeItem({ id: '2', category: 'Garden', tags: ['metric'] }),
    makeItem({ id: '3', category: 'Tools', tags: ['sharp'] }),
    makeItem({ id: '4', category: 'Tools', tags: ['worn'] }),
  ];
  const SECTIONS = ['status', 'categories', 'tags'];

  const rows = (sr: ShadowRoot, section: string) =>
    [...sr.querySelectorAll(`[data-testid="sidebar-${section}-row"]`)] as HTMLElement[];
  const stops = (sr: ShadowRoot, section: string) =>
    rows(sr, section)
      .filter((r) => r.getAttribute('tabindex') === '0')
      .map((r) => r.dataset.value);
  const focused = (sr: ShadowRoot) => (sr.activeElement as HTMLElement | null)?.dataset.value;
  const press = async (el: HTMLElement, sr: ShadowRoot, key: string) => {
    sr.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    await settle(el);
  };

  it('leaves one row of each list in the tab order and takes the rest out', async () => {
    const { sr } = await mount({ items: faceted });

    for (const section of SECTIONS) {
      const list = rows(sr, section);
      expect(list.length, section).toBeGreaterThan(2);
      expect(stops(sr, section), section).toHaveLength(1);
      expect(
        list.filter((r) => r.getAttribute('tabindex') === '-1').length,
        section,
      ).toBe(list.length - 1);
    }
  });

  it('names each list as a group, so the stop announces what it is inside', async () => {
    const { sr } = await mount({ items: faceted });

    const group = (section: string) => q(sr, `#sidebar-section-${section}`);
    expect(group('status')?.getAttribute('role')).toBe('group');
    expect(group('status')?.getAttribute('aria-label')).toBe('Status');
    expect(group('categories')?.getAttribute('aria-label')).toBe('Categories');
    expect(group('tags')?.getAttribute('aria-label')).toBe('Tags');
  });

  it('moves the stop and the focus with the arrows, and stops at both ends', async () => {
    const { el, sr } = await mount({ items: faceted });
    rows(sr, 'tags')[0].focus();

    await press(el, sr, 'ArrowDown');
    expect(focused(sr)).toBe('metric');
    expect(stops(sr, 'tags')).toEqual(['metric']);

    await press(el, sr, 'ArrowUp');
    expect(focused(sr)).toBe('heavy');
    // The top is the top: Up does not wrap round to the last label.
    await press(el, sr, 'ArrowUp');
    expect(focused(sr)).toBe('heavy');

    await press(el, sr, 'End');
    expect(focused(sr)).toBe('worn');
    await press(el, sr, 'ArrowDown');
    expect(focused(sr)).toBe('worn');
    expect(stops(sr, 'tags')).toEqual(['worn']);

    await press(el, sr, 'Home');
    expect(focused(sr)).toBe('heavy');
  });

  it('moves only inside the list the key came from', async () => {
    const { el, sr } = await mount({ items: faceted });
    rows(sr, 'categories')[0].focus();

    await press(el, sr, 'End');

    expect(stops(sr, 'categories')).toEqual(['Tools']);
    // The other two lists still hold their own first row.
    expect(stops(sr, 'tags')).toEqual(['heavy']);
    expect(stops(sr, 'status')).toEqual(['ok']);
  });

  // Pressed twice a category row ends up unselected, so what holds the stop
  // afterwards can only be the press itself.
  it('leaves the stop where a click put it', async () => {
    const { el, sr } = await mount({ items: faceted });
    const third = () => rows(sr, 'categories')[2];

    third().click();
    await settle(el);
    third().click();
    await settle(el);

    expect(rows(sr, 'categories').map((r) => r.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
    ]);
    expect(stops(sr, 'categories')).toEqual(['Tools']);
  });

  it('hands the stop to the selected row when the row holding it is drawn away', async () => {
    const { el, store, sr } = await mount({ items: faceted });
    rows(sr, 'tags')[0].click();
    await settle(el);
    rows(sr, 'tags')[0].focus();
    await press(el, sr, 'ArrowDown');
    expect(stops(sr, 'tags')).toEqual(['metric']);

    const cache = store.state.value.distinctValuesCache!;
    cache.tags = cache.tags.filter((v) => v.value !== 'metric');
    el.requestUpdate();
    await settle(el);

    expect(stops(sr, 'tags')).toEqual(['heavy']);
  });

  it('falls back to the first row when nothing is selected either', async () => {
    const { el, store, sr } = await mount({ items: faceted });
    rows(sr, 'tags')[0].focus();
    await press(el, sr, 'End');
    expect(stops(sr, 'tags')).toEqual(['worn']);

    const cache = store.state.value.distinctValuesCache!;
    cache.tags = cache.tags.filter((v) => v.value !== 'worn');
    el.requestUpdate();
    await settle(el);

    expect(stops(sr, 'tags')).toEqual(['heavy']);
  });

  it('gives a section that has just been reopened exactly one stop', async () => {
    const { el, sr } = await mount({ items: faceted });
    const toggle = () => q(sr, '[data-testid="sidebar-toggle-tags"]') as HTMLButtonElement;

    toggle().click();
    await settle(el);
    expect(rows(sr, 'tags')).toHaveLength(0);

    toggle().click();
    await settle(el);
    expect(stops(sr, 'tags')).toHaveLength(1);
  });

  // The measurement the issue is about: the walk grew with the household's
  // vocabulary, so a sidebar holding 40 labels offered 40 more stops than one
  // holding 3. Both now offer the same number.
  it('holds the sidebar walk steady as the vocabulary grows', async () => {
    const vocabulary = (size: number) =>
      Array.from({ length: size }, (_, i) =>
        makeItem({ id: `i${i}`, category: `Category ${i}`, tags: [`tag-${i}`] }),
      );
    const small = await mount({ items: vocabulary(3) });
    const large = await mount({ items: vocabulary(40) });
    const walk = (sr: ShadowRoot) =>
      deepFocusables(q(sr, '[data-testid="full-sidebar"]')).length;

    expect(rows(large.sr, 'tags')).toHaveLength(40);
    expect(walk(large.sr)).toBe(walk(small.sr));
    // Not a vacuous match: the sidebar does still offer its headings, its
    // three "+" buttons, the locations tree and one stop per facet list.
    // 13 stops either way as this is written; with every row back in the tab
    // order the same two sidebars offered 19 and 93. The bounds are what the
    // claim needs — a sidebar that had stopped drawing its facets would match
    // itself at zero.
    expect(walk(small.sr)).toBeGreaterThan(6);
    expect(walk(small.sr)).toBeLessThan(20);
  });

  // The heading, its "+" and the any/all pair are one stop each and stay that
  // way: a section is reached, opened and added to without the arrows.
  it('leaves the section heading and its actions as tab stops', async () => {
    const { sr } = await mount({ items: faceted });

    for (const testid of [
      'sidebar-toggle-status',
      'sidebar-new-status',
      'sidebar-toggle-categories',
      'sidebar-new-categories',
      'sidebar-toggle-tags',
      'sidebar-new-tags',
    ]) {
      expect(q(sr, `[data-testid="${testid}"]`)?.getAttribute('tabindex'), testid).toBe(null);
    }
  });
});

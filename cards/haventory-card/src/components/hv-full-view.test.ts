import './hv-full-view';
import { NARROW_QUERY } from './hv-full-view';
import { makeMockHass, makeItem } from '../test.utils';
import { Store } from '../store/store';
import type { HVFullView } from './hv-full-view';
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

async function mount(
  opts: {
    items?: Item[];
    locations?: Location[];
    areas?: { id: string; name: string }[];
    embedded?: boolean;
    narrow?: boolean;
  } = {},
) {
  const hass = makeMockHass({
    items: opts.items ?? [],
    locations: opts.locations ?? [],
    areas: opts.areas ?? [],
  });
  const store = new Store(hass, { retryBaseMs: 0 });
  await store.init();

  const el = document.createElement('hv-full-view') as HVFullView;
  el.store = store;
  el.columns = ['quantity', 'category'];
  if (opts.embedded) el.embedded = true;
  if (opts.narrow) el.narrow = true;
  el.open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  await el.updateComplete;
  return { el, store, hass, sr: el.shadowRoot as ShadowRoot };
}

const settle = async (el: HVFullView) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

const q = (sr: ShadowRoot, sel: string) => sr.querySelector(sel) as HTMLElement | null;

/** jsdom lays out no shadow DOM, so layout rules are asserted on the stylesheet. */
const fullCss = () => {
  const styles = (customElements.get('hv-full-view') as typeof HVFullView).styles;
  return (Array.isArray(styles) ? styles : [styles])
    .map((s) => String(s.cssText))
    .join('\n')
    .replace(/\s+/g, ' ');
};

describe('hv-full-view: phone-width app bar', () => {
  // Everything responsive in this component lives in one media query, because
  // the surface is fixed to the viewport rather than sized by the card.
  const narrow = () => {
    const css = fullCss();
    const start = css.indexOf('@media (max-width: 700px)');
    expect(start, 'no narrow-viewport block').toBeGreaterThan(-1);
    return css.slice(start);
  };

  // At 375px the bar laid out to 634px inside a 375px page that had no
  // horizontal scroll, so Add item, the count pills and the ⋮ were unreachable.
  it('lets the bar wrap instead of running off the end', () => {
    expect(narrow()).toMatch(/\.appbar \{[^}]*flex-wrap: wrap/);
  });

  it('lets the search field shrink to nothing at phone widths', () => {
    // `flex: 1` alone leaves min-width at auto, so the field refuses to
    // compress below its content and shoves its siblings off the bar. The
    // desktop block puts a floor back under it — see the wide-bar describe.
    expect(fullCss()).toMatch(/\.appbar \.search \{[^}]*min-width: 0/);
  });

  it('lets the heading give way rather than the controls after it', () => {
    const css = narrow();
    expect(css).toMatch(/\.appbar h2 \{[^}]*flex: 1/);
    expect(css).toMatch(/\.appbar h2 \{[^}]*text-overflow: ellipsis/);
  });

  it('drops the search and the pills onto later rows', () => {
    const css = narrow();
    expect(css).toMatch(/\.appbar \.search \{[^}]*order: 1/);
    expect(css).toMatch(/\.appbar \.pill \{[^}]*order: 2/);
    // An auto margin cannot push anything once the row wraps.
    expect(css).toMatch(/\.appbar \.spacer \{ display: none; \}/);
  });

  // With a 200px basis the search shared its line with whichever pills fit —
  // at 390px "102 low" rode up beside it while the other two sat on a row of
  // their own, so the three counts read as two unrelated groups.
  it('gives the search a row to itself so no count pill rides beside it', () => {
    expect(narrow()).toMatch(/\.appbar \.search \{[^}]*flex: 1 0 100%/);
    // A basis is a content-box width, so without this the field came out 24px
    // wider than the line it fills and hung off the right edge of the bar.
    expect(fullCss()).toMatch(/\.appbar \.search \{[^}]*box-sizing: border-box/);
  });

  // The bar came to 178px of a 844px screen: 16px search text and three 44px
  // pills, all of it above the list it belongs to.
  it('reads at the size of the rows it searches', () => {
    // 13.5px is hv-data-table's .row — another shadow root, so the size is
    // repeated rather than shared.
    expect(narrow()).toMatch(/\.appbar \.search input \{[^}]*font-size: 13\.5px/);
    expect(narrow()).not.toMatch(/\.appbar \.search input \{[^}]*min-height: var\(--hv-tap-min/);
  });

  // The panel is ~1600px of form in one column. The shell is fixed to the
  // viewport and clips, and nothing in this column was a scroll container, so
  // on a 756px screen 1138px of it was unreachable — including the apply
  // button, which measured 1039px below the bottom edge — and the table under
  // it was squeezed to zero height.
  // Not in the narrow block: the ceiling belongs at every width. Sideways, the
  // same phone is 760px wide and the panel opened 1007px tall in a 400px
  // screen — 751px of it below a fold nothing could scroll past — and a
  // 1280x900 desktop was losing the surface's own footer the same way.
  it('gives the filter panel a ceiling and something to scroll', () => {
    const css = fullCss();
    const rule = /\.panel-holder \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/flex-direction: column/);
    expect(rule).toMatch(/max-height: min\(\d+dvh, calc\(100% - \d+px\)\)/);
    expect(css).toMatch(/\.panel-scroll \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.panel-scroll \{[^}]*min-height: 0/);
    // The ceiling has to hold on a landscape phone, where the column is 336px
    // tall: 80dvh of 400 is 320, so the second term is what bounds it.
    const [, dvh, reserved] = /max-height: min\((\d+)dvh, calc\(100% - (\d+)px\)\)/.exec(rule) ?? [];
    expect(Math.min((Number(dvh) / 100) * 400, 336 - Number(reserved))).toBeLessThanOrEqual(336 - 68 - 41);
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
    expect(fullCss()).toMatch(/\.panel-foot \{[^}]*flex: none/);
  });

  it('keeps the count pills shorter than the actions above them', () => {
    const css = narrow();
    expect(css).toMatch(/\.appbar \.pill \{[^}]*min-height: 30px/);
    expect(css).not.toMatch(/\.appbar \.pill \{[^}]*min-height: var\(--hv-tap-min/);
    // The bar's actual actions keep the full target.
    expect(css).toMatch(/\.appbar \.ghost,\s*\.appbar \.add \{[^}]*min-height: var\(--hv-tap-min/);
  });

  it('sizes its own touch targets rather than inheriting the card its opener had', () => {
    // On the shell, not the app bar: the table, its sort headers and the
    // context bar are on this surface too and need the same sizing.
    expect(narrow()).toMatch(/\.shell \{[^}]*--hv-tap-min: 44px/);
    expect(narrow()).toMatch(/\.shell \{[^}]*--hv-input-font: 16px/);
  });

  // Selection mode reuses the same bar. `.subcount` was the only shrinkable
  // item among flex:none siblings, so it collapsed to its longest word and
  // stacked "of 556 / matching / the / current / filter" down five lines.
  it('gives the selection subtitle a line instead of a column', () => {
    const css = narrow();
    expect(css).toMatch(/\.appbar\.selecting \.subcount \{[^}]*flex-basis: 100%/);
    expect(css).toMatch(/\.appbar\.selecting \.count \{[^}]*flex: 1/);
  });

  it('keeps Clear selection on screen', async () => {
    // It measured 380..490 in a 375px viewport before the bar could wrap.
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
});

// The search is the only item on the bar that can shrink — every pill, the
// title and both trailing buttons are flex:none — so each pill added comes out
// of it. With all six showing it collapsed to "Search all 1(" in a 1024px
// content area, which is what this block exists to stop.
describe('hv-full-view: wide app bar', () => {
  const wide = () => {
    const css = fullCss();
    const start = css.indexOf('@media (min-width: 701px)');
    expect(start, 'no wide-viewport block').toBeGreaterThan(-1);
    // Stop at the phone block so a rule from it can never satisfy these.
    const end = css.indexOf('@media (max-width: 700px)', start);
    return end > start ? css.slice(start, end) : css.slice(start);
  };

  // The complement of NARROW_QUERY: the two blocks must not both apply, and
  // must not leave a width where neither does.
  it('picks up exactly where the phone block leaves off', () => {
    expect(NARROW_QUERY).toBe('(max-width: 700px)');
    expect(fullCss()).toContain('@media (min-width: 701px)');
  });

  it('puts a floor under the search rather than letting the pills eat it', () => {
    expect(wide()).toMatch(/\.appbar \.search \{[^}]*min-width: 260px/);
  });

  it('lets the bar take a second line once the pills stop fitting', () => {
    expect(wide()).toMatch(/\.appbar \{[^}]*flex-wrap: wrap/);
  });

  // A spacer can only push on the line it is on, so once the bar wraps it holds
  // the first line open while the actions land left-aligned under the title.
  it('carries the right-alignment on the actions, not on a spacer', () => {
    expect(wide()).toMatch(/\.appbar \.spacer \{[^}]*display: none/);
    expect(wide()).toMatch(/\.appbar \.add \{[^}]*margin-left: auto/);
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

  it('is sized by its host rather than by the viewport', () => {
    const css = fullCss();
    expect(css).toContain(':host([embedded]) { display: block; height: 100%; }');
    expect(css).toContain(
      ':host([embedded]) .shell { position: relative; inset: auto; height: 100%; box-shadow: none; }',
    );
  });

  // The embedded rules override the shell's box and nothing else: the grid rows
  // and the sideways pan are what the layout inside depends on.
  it('keeps the shell a two-row grid that can be panned sideways', () => {
    const css = fullCss();
    expect(css).toContain('.shell { position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr;');
    expect(css).toContain('overflow-x: auto;');
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

    (tree.shadowRoot?.querySelector('[data-testid="tree-select"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.locationId).toBe('garage');

    (tree.shadowRoot?.querySelector('[data-testid="tree-orphans"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.orphansOnly).toBe(true);
    expect(store.state.value.filters.locationId).toBe(null);
  });

  it('creates a location inline, under the current selection', async () => {
    const { el, store, sr } = await mount({ items: [], locations });
    store.setFilters({ locationId: 'garage' });
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
    expect(store.state.value.filters.category).toBe('Tools');
    expect(rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.classList).toContain('on');

    rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.click();
    await settle(el);
    expect(store.state.value.filters.category).toBe(null);
  });

  // Category is one value and tags are a set, because that is what the backend
  // does with them — so the rows behave differently on purpose.
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

  it('lines the three tallies up in one column', () => {
    // The Locations heading ends in a button and the other two in nothing, so
    // without a reserved slot its number sits an icon-button's width inboard.
    expect(fullCss()).toMatch(/\.head-action \{[^}]*width: var\(--hv-tap-min, 34px\)/);
    expect(fullCss()).toMatch(/\.head-action \{[^}]*flex: none/);
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
    rows(sr).map((r) => r.querySelector('.tally')?.textContent?.trim() ?? null);

  // The counts payload prices only the two flagged states; OK is the rest of
  // the inventory, which is the one number here that has to be derived.
  it('lists the three statuses with their counts', async () => {
    const { sr } = await mount({ items: flagged });
    expect(rows(sr).map((r) => r.dataset.value)).toEqual(['ok', 'missing', 'needs_repair']);
    expect(tallies(sr)).toEqual(['1', '1', '2']);
  });

  it('filters to one status and clears it on a second press', async () => {
    const { el, store, sr } = await mount({ items: flagged });
    const missing = () => rows(sr).find((r) => r.dataset.value === 'missing');

    missing()?.click();
    await settle(el);
    expect(store.state.value.filters.status).toBe('missing');
    expect(missing()?.classList).toContain('on');

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
    expect(rows(sr).filter((r) => r.classList.contains('on')).map((r) => r.dataset.value)).toEqual([
      'needs_repair',
    ]);
  });

  // An older backend sends neither count. Then no row claims a number, rather
  // than every row claiming one derived from the halves that did arrive.
  it('drops every tally when the backend prices no statuses', async () => {
    const { el, store, sr } = await mount({ items: flagged });
    const counts = store.state.value.statsCounts as unknown as Record<string, unknown>;
    delete counts.missing_count;
    delete counts.needs_repair_count;
    el.requestUpdate();
    await settle(el);

    expect(tallies(sr)).toEqual([null, null, null]);
  });

  // Categories and tags tally how many rows they hold; this section always
  // holds three, so the same number in that slot would be noise.
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

    store.setFilters({ locationId: 'shelf-a' });
    await settle(el);
    const crumb = q(sr, '[data-testid="full-breadcrumb"]')?.textContent?.replace(/\s+/g, ' ');
    expect(crumb).toContain('garage › Shelf A');
    // One item is one item — the crumb used to say "1 items".
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

    store.setFilters({ locationId: 'shelf-a' });
    await settle(el);
    const crumb = q(sr, '[data-testid="full-breadcrumb"]');
    expect(crumb?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(crumb?.textContent?.replace(/\s+/g, ' ')).toContain('garage › Shelf A');
  });

  it('leaves the crumb of an arealess tree exactly as it was', async () => {
    const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage')];
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'shelf-a' })],
      locations,
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });

    store.setFilters({ locationId: 'shelf-a' });
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

  it('counts loaded rows against the filtered total', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}` }));
    const { sr } = await mount({ items });
    expect(q(sr, '[data-testid="full-footer"]')?.textContent).toContain('Showing 50 of 60');
    expect(q(sr, '[data-testid="full-footer"]')?.textContent).toContain('scroll to load more');
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
    store.setFilters({ locationId: 'garage' });
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

  it('closes the editor when a filter change drops the item from the list', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    store.setFilters({ q: 'matches nothing at all' });
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
  });

  // The form sits in a column flex beside a table that wants every pixel. An
  // `overflow-y: auto` box has an automatic minimum size of zero, so the form
  // was free to be squeezed — it opened about 130px tall, a field and a half,
  // and never came near the ceiling meant to bound it.
  it('refuses to be squeezed by the table below it', () => {
    const rule = /\.editor-holder \{([^}]*)\}/.exec(fullCss())?.[1] ?? '';
    expect(rule, 'no .editor-holder rule').not.toBe('');
    expect(rule).toMatch(/flex: none/);
    // A ceiling is still wanted — the form is taller than a short viewport.
    expect(rule).toMatch(/max-height: min\(\d+dvh/);
    expect(rule).toMatch(/overflow-y: auto/);
  });

  // The app bar's minimum is 778px — close, title, the search box's own floor,
  // three pills, Add item, the ⋮ — so a 760px landscape phone was 18px short of
  // the layout. Hidden on both axes, those 18px could not be reached: the ⋮ was
  // sliced in half and the editor's Save sat flush against the screen edge.
  it('can be panned sideways when the layout is wider than the screen', () => {
    const rule = /\.shell \{([^}]*)\}/.exec(fullCss())?.[1] ?? '';
    expect(rule, 'no .shell rule').not.toBe('');
    expect(rule).toMatch(/overflow-x: auto/);
    // Vertical stays clipped: the surface is the viewport, and the boxes
    // inside it (the form holder, the filter panel, the table) scroll
    // themselves.
    expect(rule).toMatch(/overflow-y: hidden/);
    expect(rule).not.toMatch(/overflow: hidden/);
    // Without this a pan that runs out of surface scrolls the dashboard behind.
    expect(rule).toMatch(/overscroll-behavior: contain/);
  });

  // Turn a phone on its side and the viewport is 400px tall, not 844. The app
  // bar (64), the context bar (68) and the footer (41) leave 227px; a 70dvh
  // ceiling asked for 280, so the holder ran past the bottom of a shell that
  // clips and cannot scroll — the footer and the sticky Save/Cancel bar were
  // both off the screen with no gesture that could reach them.
  it('leaves the footer its room on a landscape phone', () => {
    const rule = /\.editor-holder \{([^}]*)\}/.exec(fullCss())?.[1] ?? '';
    const ceiling = /max-height: min\((\d+)dvh, calc\(100% - (\d+)px\)\)/.exec(rule);
    expect(ceiling, `ceiling ignores the room the column has: ${rule}`).not.toBe(null);

    // Measured against the column, not the viewport, so however the app bar
    // lays out is already priced in. What is reserved is what sits inside this
    // column around the form: the context bar and the footer.
    const reserved = Number(ceiling?.[2]);
    expect(reserved).toBeGreaterThanOrEqual(109);

    // 400px landscape: the column is 336 tall, so the form stops at 220 and
    // both the sticky action bar and the footer stay on the screen.
    const column = 400 - 64;
    expect(Math.min((Number(ceiling?.[1]) / 100) * 400, column - reserved)).toBeLessThanOrEqual(
      column - 68 - 41,
    );
  });
});

// This surface switches its own layout on a media query, but its two biggest
// children switch theirs on a `mobile` property that only the card ever set —
// so at 375px the expanded view drew the editor's three-column desktop grid in
// 156px + 78px + 78px, with "Low-stock at" wrapping over its own field.
describe('hv-full-view: phone-width children', () => {
  /** jsdom's matchMedia always reports false, so the breakpoint is stubbed. */
  const stubViewport = (matches: boolean) => {
    const original = window.matchMedia;
    window.matchMedia = ((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  };

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
    expect(fullCss()).toMatch(/\.panel-holder\[hidden\] \{[^}]*display: none/);

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

  // The bar priced every derived exception — low, overdue, due for inspection,
  // checked out — and none of the stored one, so the two flags a person sets by
  // hand were the only ones with no way back to them from here.
  it('carries the two flagged statuses, and filters on them', async () => {
    const statuses = [
      makeItem({ id: '1', status: 'missing' }),
      makeItem({ id: '2', status: 'needs_repair' }),
      makeItem({ id: '3', status: 'needs_repair' }),
      makeItem({ id: '4' }),
    ];
    const pill = (sr: ShadowRoot, value: string) =>
      sr.querySelector(`[data-testid="full-badge-status"][data-value="${value}"]`) as HTMLButtonElement;
    const { el, store, sr } = await mount({ items: statuses });

    expect(pill(sr, 'missing').textContent?.replace(/\s+/g, ' ').trim()).toBe('1 missing');
    expect(pill(sr, 'needs_repair').textContent?.replace(/\s+/g, ' ').trim()).toBe('2 needs repair');

    pill(sr, 'missing').click();
    await settle(el);
    expect(store.state.value.filters.status).toBe('missing');
    expect(pill(sr, 'missing').getAttribute('aria-pressed')).toBe('true');

    pill(sr, 'missing').click();
    await settle(el);
    expect(store.state.value.filters.status).toBe(null);
  });

  // Single-select, so the two pills are mutually exclusive — pressing one while
  // the other is on replaces it rather than asking for items that are both.
  it('replaces the active status pill rather than adding to it', async () => {
    const statuses = [makeItem({ id: '1', status: 'missing' }), makeItem({ id: '2', status: 'needs_repair' })];
    const pill = (sr: ShadowRoot, value: string) =>
      sr.querySelector(`[data-testid="full-badge-status"][data-value="${value}"]`) as HTMLButtonElement;
    const { el, store, sr } = await mount({ items: statuses });

    pill(sr, 'missing').click();
    await settle(el);
    pill(sr, 'needs_repair').click();
    await settle(el);

    expect(store.state.value.filters.status).toBe('needs_repair');
    expect(pill(sr, 'missing').getAttribute('aria-pressed')).toBe('false');
    expect(pill(sr, 'needs_repair').getAttribute('aria-pressed')).toBe('true');
  });

  // "OK" is not an exception, and on a healthy inventory a status pill at all
  // would be the loudest thing on a bar with nothing to report.
  it('drops each status pill when nothing carries that flag', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1', status: 'missing' })] });
    expect(q(sr, '[data-testid="full-badge-status"][data-value="missing"]')).toBeTruthy();
    expect(q(sr, '[data-testid="full-badge-status"][data-value="needs_repair"]')).toBe(null);
    expect(q(sr, '[data-testid="full-badge-status"][data-value="ok"]')).toBe(null);
  });

  it('drops the overdue pill when nothing is overdue', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1', checked_out: true })] });
    expect(q(sr, '[data-testid="full-badge-overdue"]')).toBe(null);
    expect(q(sr, '[data-testid="full-badge-out"]')).toBeTruthy();
  });

  // An inspection that has come due is independent of any check-out, so the
  // pill counts shelved items the overdue pill never sees.
  it('carries the inspection count, and filters the list on it', async () => {
    const due = [
      makeItem({ id: '1', inspection_date: '2000-01-01' }),
      makeItem({ id: '2', inspection_date: '2999-12-31' }),
    ];
    const { el, store, sr } = await mount({ items: due });
    const pill = q(sr, '[data-testid="full-badge-inspection"]') as HTMLButtonElement;
    expect(pill?.textContent).toContain('1 to inspect');
    expect(q(sr, '[data-testid="full-badge-overdue"]')).toBe(null);

    pill.click();
    await settle(el);
    expect(store.state.value.filters.inspectionDueOnly).toBe(true);
    expect(q(sr, '[data-testid="full-badge-inspection"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(store.state.value.items.map((i) => i.id)).toEqual(['1']);
  });

  it('drops the inspection pill when nothing is due', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1', inspection_date: '2999-12-31' })] });
    expect(q(sr, '[data-testid="full-badge-inspection"]')).toBe(null);
  });

  // "82 out" reads as "82 out of stock", which is the opposite of what it counts.
  it('spells out what the checked-out pill counts', async () => {
    const { sr } = await mount({ items: flagged });
    expect(q(sr, '[data-testid="full-badge-out"]')?.textContent?.trim()).toBe('2 checked out');
  });

  // Three identically washed pills said nothing apart. The card's hues carry the
  // meaning; the fills are solid rather than the card's pale tints, because a
  // tint over this already-coloured bar is unreadable in dark mode.
  it('colours low and overdue the way the card does', () => {
    const css = fullCss();
    expect(css).toMatch(/\.appbar \.pill\.low \{[^}]*background: var\(--hv-amber\)/);
    expect(css).toMatch(/\.appbar \.pill\.overdue \{[^}]*background: var\(--hv-error\)/);
  });

  it('debounces the app bar search', async () => {
    const { store, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const input = q(sr, '[data-testid="full-search"]') as HTMLInputElement;
    input.value = 'glue';
    input.dispatchEvent(new Event('input'));
    expect(store.state.value.filters.q).toBe('');

    await new Promise((r) => setTimeout(r, 250));
    expect(store.state.value.filters.q).toBe('glue');
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
    (tree.shadowRoot?.querySelector('[data-testid="tree-select"][data-id="workshop"]') as HTMLButtonElement).click();
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

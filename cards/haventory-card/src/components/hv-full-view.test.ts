import './hv-full-view';
import { makeMockHass, makeItem, stubViewport } from '../test.utils';
import { deepActiveElement } from '../ui/dialog-focus';
import { DISCARD_PROMPT } from '../ui/discard';
import { NARROW_QUERY } from '../ui/responsive';
import { Store } from '../store/store';
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
  const hass = makeMockHass({
    items: opts.items ?? [],
    locations: opts.locations ?? [],
    areas: opts.areas ?? [],
    ...(opts.statuses ? { statuses: opts.statuses } : {}),
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
    // And outside the query, where the card's own idea of narrow used to reach
    // in: an overlay renders inside hv-card-shell's tree, which declares both
    // of these for a card measured at 600px or under — an ordinary dashboard
    // column on a desktop. The guaranteed-invalid value rather than a number,
    // so each consumer keeps the size it was written with.
    const shell = /\.shell \{([^}]*)\}/.exec(fullCss())?.[1] ?? '';
    expect(shell).toMatch(/--hv-tap-min: initial/);
    expect(shell).toMatch(/--hv-input-font: initial/);
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
    expect(rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.classList).toContain(
      'selected',
    );

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
    rows(sr).map((r) => r.querySelector('.hv-tally')?.textContent?.trim() ?? null);

  // Every row is priced from the per-slug map, so the facet says what the
  // backend says rather than what the facet can derive.
  it('lists the three statuses with their counts', async () => {
    const { sr } = await mount({ items: flagged });
    expect(rows(sr).map((r) => r.dataset.value)).toEqual(['ok', 'missing', 'needs_repair']);
    expect(tallies(sr)).toEqual(['1', '1', '2']);
  });

  // The audit's fixture in miniature: custom slugs used to inherit "everything
  // that is not missing or needs_repair", so an empty status claimed the whole
  // inventory and then showed no rows when it was clicked.
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

      // No tab named: Organize opens where it always did, on Locations.
      expect(seen).toEqual([{ id: 'organize' }]);
      el.remove();
    }
  });

  // The same sentence the card's footer prints — the two used to phrase one
  // fact two ways, and neither named what it was counting.
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

  it('waits for the fetch instead of blaming the filters for the gap', async () => {
    // Changing a filter clears the rows and asks for the next page, so between
    // the two the table has nothing to show and no answer yet. It used to fill
    // that gap with "No items match these filters" and a Clear all button,
    // against a filter nothing had been counted for.
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
      const { el, store, sr } = await mount({
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
      const guard = q(sr, '[data-testid="full-discard-confirm"]') as HTMLElement & { open: boolean };
      expect(guard.open).toBe(true);
      (guard.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
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

  const guard = (sr: ShadowRoot) =>
    q(sr, '[data-testid="full-discard-confirm"]') as HTMLElement & { open: boolean };
  const answer = (sr: ShadowRoot, which: 'confirm-accept' | 'confirm-cancel') =>
    (guard(sr).shadowRoot?.querySelector(`[data-testid="${which}"]`) as HTMLButtonElement).click();
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
      const { el, sr } = await dirtyEditor(two());
      let closes = 0;
      el.addEventListener('close', () => {
        closes += 1;
      });

      leave[how](sr);
      await settle(el);

      expect(guard(sr).open).toBe(true);
      expect(closes).toBe(0);
      expect(el.open).toBe(true);
      expect(editorName(sr)).toBe('Typed but unsaved');
    },
  );

  it.each(Object.keys(leave) as (keyof typeof leave)[])(
    '%s keeps the typing when the question is declined',
    async (how) => {
      const { el, sr } = await dirtyEditor(two());

      leave[how](sr);
      await settle(el);
      answer(sr, 'confirm-cancel');
      await settle(el);

      expect(guard(sr).open).toBe(false);
      expect(el.open).toBe(true);
      expect(editorName(sr)).toBe('Typed but unsaved');
    },
  );

  it('opens the other row once the discard is confirmed', async () => {
    const { el, sr } = await dirtyEditor(two());

    leave['row switch'](sr);
    await settle(el);
    answer(sr, 'confirm-accept');
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')?.shadowRoot?.textContent).toContain('Second — editing');
    expect(editorName(sr)).toBe('Second');
  });

  it.each(['backdrop', 'escape', 'close'] as const)(
    'closes the view once %s is confirmed',
    async (how) => {
      const { el, sr } = await dirtyEditor(two());
      let closes = 0;
      el.addEventListener('close', () => {
        closes += 1;
      });

      leave[how](sr);
      await settle(el);
      answer(sr, 'confirm-accept');
      await settle(el);

      expect(closes).toBe(1);
      expect(el.open).toBe(false);
    },
  );

  it('leaves a clean form without a word', async () => {
    const { el, sr } = await mount({ items: two() });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    leave['row switch'](sr);
    await settle(el);

    expect(guard(sr).open).toBe(false);
    expect(editorName(sr)).toBe('Second');
  });

  // The panel has no backdrop, no Escape and no close button, but it switches
  // rows in the same table.
  it('asks on a row switch in the embedded panel too', async () => {
    const { el, sr } = await mount({ items: two(), embedded: true });
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

    expect(guard(sr).open).toBe(true);
    expect(editorName(sr)).toBe('Typed but unsaved');
  });

  it('asks the same question the form asks itself', async () => {
    const { el, sr } = await dirtyEditor(two());
    leave.backdrop(sr);
    await settle(el);

    const panel = guard(sr).shadowRoot as ShadowRoot;
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

  // One vocabulary on both surfaces: the card hands its `quick_filters` config
  // down, and the panel — which has no YAML — takes the default of all of them.
  describe('the dashboard\'s pill choice', () => {
    const stocked = () => [
      makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 }),
      makeItem({ id: '2', checked_out: true }),
    ];

    it('draws every pill by default', async () => {
      const { sr } = await mount({ items: stocked() });
      expect(q(sr, '[data-testid="full-badge-low"]')).toBeTruthy();
      expect(q(sr, '[data-testid="full-badge-out"]')).toBeTruthy();
    });

    it('draws only the pills the config names', async () => {
      const { el, sr } = await mount({ items: stocked() });
      el.quickFilters = ['low_stock'];
      await el.updateComplete;

      expect(q(sr, '[data-testid="full-badge-low"]')).toBeTruthy();
      expect(q(sr, '[data-testid="full-badge-out"]')).toBe(null);
    });

    it('still hides an allowed pill whose count is zero', async () => {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      el.quickFilters = ['low_stock', 'checked_out'];
      await el.updateComplete;

      expect(q(sr, '[data-testid="full-badge-low"]')).toBe(null);
      expect(q(sr, '[data-testid="full-badge-out"]')).toBe(null);
    });
  });

  // "82 out" reads as "82 out of stock", which is the opposite of what it counts.
  it('spells out what the checked-out pill counts', async () => {
    const { sr } = await mount({ items: flagged });
    expect(q(sr, '[data-testid="full-badge-out"]')?.textContent?.trim()).toBe('2 checked out');
  });

  // The card's hues carry the meaning on this bar too, but the fills are solid
  // rather than the card's pale tints, because a tint over an already-coloured
  // bar is unreadable in dark mode.
  it('colours low and overdue the way the card does', () => {
    const css = fullCss();
    expect(css).toMatch(/\.appbar \.hv-chip\.warning \{[^}]*background: var\(--hv-amber\)/);
    expect(css).toMatch(/\.appbar \.hv-chip\.error \{[^}]*background: var\(--hv-error\)/);
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

  // Bulk check-out used to fire on the press with no due date at all, so a
  // batch could never go overdue while a single row was always asked.
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

      const popover = q(sr, '[data-testid="full-bulk-checkout"]') as HTMLElement & { open: boolean };
      return { ...mounted, popover };
    }

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
    const { el, sr } = await mount({
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

    expect((q(sr, '[data-testid="full-discard-confirm"]') as HTMLElement & { open: boolean }).open).toBe(
      true,
    );
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

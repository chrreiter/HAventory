import './hv-full-sidebar';
import { defined, makeItem, mountHost, q, settle } from '../test.utils';
import { deepFocusables } from '../ui/dialog-focus';
import type { HvEvent } from '../events';
import type { HVFullSidebar, SidebarSection } from './hv-full-sidebar';
import type { DistinctValues, Item, Location, StatusDefinition } from '../store/types';
import type { Store } from '../store/store';

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
  } = {},
) {
  return mountHost<HVFullSidebar>(
    'hv-full-sidebar',
    {
      items: opts.items ?? [],
      locations: opts.locations ?? [],
      areas: opts.areas ?? [],
      ...(opts.statuses ? { statuses: opts.statuses } : {}),
    },
    { sections: { locations: true, status: true, categories: true, tags: true } },
    { renders: 2 },
  );
}

/**
 * Stands in for the full view, which owns which sections are open: it applies
 * each request the sidebar sends and returns them in order.
 */
function follow(el: HVFullSidebar) {
  const asked: { section: SidebarSection; open: boolean }[] = [];
  el.addEventListener('toggle-section', (e) => {
    const { section, open } = (e as HvEvent<'hv-full-sidebar', 'toggle-section'>).detail;
    asked.push({ section, open });
    el.sections = { ...el.sections, [section]: open };
  });
  return asked;
}

describe('hv-full-sidebar: locations', () => {
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
    expect(rows[0]?.querySelector('[data-testid="tree-count"]')?.textContent?.trim()).toBe('2');
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
describe('hv-full-sidebar: facets', () => {
  const faceted = [
    makeItem({ id: '1', category: 'Tools', tags: ['metric', 'heavy'] }),
    makeItem({ id: '2', category: 'Tools', tags: ['metric'] }),
    makeItem({ id: '3', category: 'Cleaning', tags: [] }),
  ];
  const rows = (sr: ShadowRoot, section: string) =>
    [...sr.querySelectorAll(`[data-testid="sidebar-${section}-row"]`)] as HTMLElement[];
  /** Press the facet row carrying `value` and let the sidebar settle. */
  async function pickFacet(el: HVFullSidebar, sr: ShadowRoot, section: string, value: string) {
    rows(sr, section)
      .find((r) => r.dataset.value === value)
      ?.click();
    await settle(el);
  }

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

    await pickFacet(el, sr, 'categories', 'Tools');
    const picked = rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')!;
    // Picked, the same slot holds the check — the label does not move sideways.
    expect(picked.querySelector('.hv-browse-row-lead')?.classList.contains('placeholder')).toBe(false);
    expect(picked.querySelector('.hv-browse-row-lead svg')).toBeTruthy();
  });

  it('lists categories and tags with their counts, locations still first', async () => {
    const { sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });

    expect(rows(sr, 'categories').map((r) => r.dataset.value)).toEqual(['Cleaning', 'Tools']);
    expect(rows(sr, 'categories')[1]?.textContent).toContain('2');
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
    await vi.waitUntil(
      () => store.state.value.distinctValuesCache?.categories[0]?.matching_count !== undefined,
    );
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

    await pickFacet(el, sr, 'categories', 'Tools');
    expect(store.state.value.filters.categories).toEqual(['Tools']);
    expect(rows(sr, 'categories').find((r) => r.dataset.value === 'Tools')?.classList).toContain('selected');

    await pickFacet(el, sr, 'categories', 'Tools');
    expect(store.state.value.filters.categories).toEqual([]);
  });

  // The sidebar and the filter panel are one control in two places, so a
  // category row that replaced the selection while the panel's chip added to it
  // would make "picked" mean two things.
  it('accumulates categories rather than replacing the selection', async () => {
    const { el, store, sr } = await mount({ items: faceted });

    await pickFacet(el, sr, 'categories', 'Tools');
    await pickFacet(el, sr, 'categories', 'Cleaning');
    expect(store.state.value.filters.categories).toEqual(['Tools', 'Cleaning']);
    // Both rows read as picked, and the list keeps every row it had.
    for (const value of ['Tools', 'Cleaning']) {
      expect(rows(sr, 'categories').find((r) => r.dataset.value === value)?.classList).toContain('selected');
    }

    await pickFacet(el, sr, 'categories', 'Tools');
    expect(store.state.value.filters.categories).toEqual(['Cleaning']);
  });

  // No Any/All control beside categories or locations, unlike tags: an item
  // carries one of each, so a selection of several can only mean OR.
  it('offers no match mode for categories, however many are picked', async () => {
    const { el, store, sr } = await mount({ items: faceted });
    await pickFacet(el, sr, 'categories', 'Tools');
    await pickFacet(el, sr, 'categories', 'Cleaning');

    expect(store.state.value.filters.categories).toHaveLength(2);
    expect(q(sr, '[data-testid="sidebar-categories-mode"]')).toBe(null);
  });

  // Tags are a set for a different reason: an item carries several, so any/all
  // is a real question there and not here.
  it('accumulates tags rather than replacing the selection', async () => {
    const { el, store, sr } = await mount({ items: faceted });

    await pickFacet(el, sr, 'tags', 'metric');
    await pickFacet(el, sr, 'tags', 'heavy');
    expect(store.state.value.filters.tags).toEqual(['metric', 'heavy']);

    await pickFacet(el, sr, 'tags', 'metric');
    expect(store.state.value.filters.tags).toEqual(['heavy']);
  });

  // The sidebar accumulated tags but never said which way they combined, so a
  // mode set to "all" in the filter panel silently governed every tag picked
  // here. Only shown from the second tag on — that is when the two differ.
  it('shows the tag match mode once two tags are selected', async () => {
    const { el, store, sr } = await mount({ items: faceted });
    expect(q(sr, '[data-testid="sidebar-tags-mode"]')).toBe(null);

    await pickFacet(el, sr, 'tags', 'metric');
    expect(q(sr, '[data-testid="sidebar-tags-mode"]'), 'one tag needs no mode').toBe(null);

    await pickFacet(el, sr, 'tags', 'heavy');
    const modes = [...sr.querySelectorAll('[data-testid="sidebar-tags-mode"]')] as HTMLElement[];
    expect(modes.map((m) => m.dataset.mode)).toEqual(['any', 'all']);
    expect(modes[0]?.classList.contains('on')).toBe(true);

    defined(modes[1], 'second mode').click();
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
    follow(el);
    const toggle = (section: string) => q(sr, `[data-testid="sidebar-toggle-${section}"]`) as HTMLButtonElement;

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
    const asked = follow(el);
    const toggle = q(sr, '[data-testid="sidebar-toggle-tags"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    await settle(el);
    expect(asked).toEqual([{ section: 'tags', open: false }]);

    expect(rows(sr, 'tags')).toEqual([]);
    expect(q(sr, '[data-testid="sidebar-toggle-tags"]')?.getAttribute('aria-expanded')).toBe('false');
    // Only that section went; the others are untouched.
    expect(rows(sr, 'categories').length).toBe(2);
    expect(q(sr, '[data-testid="sidebar-tree"]')).toBeTruthy();
  });

  it('reopens a collapsed Locations section rather than hiding the new-name field in it', async () => {
    const { el, sr } = await mount({ items: [], locations: [loc('garage', 'Garage')] });
    const asked = follow(el);
    (q(sr, '[data-testid="sidebar-toggle-locations"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="sidebar-tree"]')).toBe(null);

    (q(sr, '[data-testid="sidebar-new-location"]') as HTMLButtonElement).click();
    await settle(el);
    expect(asked.at(-1)).toEqual({ section: 'locations', open: true });

    expect(q(sr, '[data-testid="sidebar-new-location-name"]')).toBeTruthy();
    expect(q(sr, '[data-testid="sidebar-tree"]')).toBeTruthy();
  });

  // The tally counts every depth, and it sits beside the "+" rather than in
  // place of it.
  it('states how many locations there are, at every depth', async () => {
    const { sr } = await mount({
      items: faceted,
      locations: [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage'), loc('kitchen', 'Kitchen')],
    });
    expect(q(sr, '[data-testid="sidebar-locations-tally"]')?.textContent?.trim()).toBe('3');
    // …and the "+" is still there beside it.
    expect(q(sr, '[data-testid="sidebar-new-location"]')).toBeTruthy();
  });

  it('offers a create action on every heading, not just Locations', async () => {
    const { el, sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });
    const seen: unknown[] = [];
    el.addEventListener('organize', (e) => seen.push((e as CustomEvent).detail));

    expect(q(sr, '[data-testid="sidebar-new-location"]')).toBeTruthy();
    (q(sr, '[data-testid="sidebar-new-categories"]') as HTMLButtonElement).click();
    (q(sr, '[data-testid="sidebar-new-tags"]') as HTMLButtonElement).click();

    // A category exists through the items using it, so this opens Organize on
    // the matching tab rather than inventing a second place to create one.
    expect(seen).toEqual([{ tab: 'categories' }, { tab: 'tags' }]);
    expect(q(sr, '[data-testid="sidebar-new-tags"]')?.getAttribute('title')).toBe('New tag…');
  });

  // Status is the one vocabulary a household defines itself, so its heading
  // offers the same way in as the other three.
  it('offers the same create action on the Status heading', async () => {
    const { el, sr } = await mount({ items: faceted, locations: [loc('garage', 'Garage')] });
    const seen: unknown[] = [];
    el.addEventListener('organize', (e) => seen.push((e as CustomEvent).detail));

    (q(sr, '[data-testid="sidebar-new-status"]') as HTMLButtonElement).click();

    expect(seen).toEqual([{ tab: 'statuses' }]);
    expect(q(sr, '[data-testid="sidebar-new-status"]')?.getAttribute('title')).toBe('New status…');
  });
});

describe('hv-full-sidebar: status', () => {
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

    rows(sr)
      .find((r) => r.dataset.value === 'missing')
      ?.click();
    await settle(el);
    rows(sr)
      .find((r) => r.dataset.value === 'needs_repair')
      ?.click();
    await settle(el);

    expect(store.state.value.filters.status).toBe('needs_repair');
    expect(
      rows(sr)
        .filter((r) => r.classList.contains('selected'))
        .map((r) => r.dataset.value),
    ).toEqual(['needs_repair']);
  });

  // Categories and tags tally how many rows they hold; here that number counts
  // the household's vocabulary, not the inventory the facet navigates.
  it('heads the section without a tally', async () => {
    const { sr } = await mount({ items: flagged });
    expect(q(sr, '[data-testid="sidebar-status-tally"]')).toBe(null);
    expect(q(sr, '[data-testid="sidebar-toggle-status"]')?.textContent).toContain('Status');
  });

  /** The backend's matching count for a slug, once a priced answer has landed. */
  const matchingOf = (store: Store, slug: string) =>
    store.state.value.distinctValuesCache?.statuses?.find((e) => e.value === slug)?.matching_count;

  // The category and location rows beside these read matches over total under
  // a filter, so a status row keeping its whole-inventory number disagreed
  // with the list it sits next to.
  it('reads matches over total once a filter is narrowing the list', async () => {
    const statuses: StatusDefinition[] = [
      { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
      { slug: 'missing', label: 'Missing', order: 1, color: 'amber', icon: 'alert' },
      { slug: 'lent_out', label: 'Lent out', order: 2, color: 'blue', icon: 'hand' },
    ];
    const items = [
      makeItem({ id: '1', status: 'missing', checked_out: true }),
      makeItem({ id: '2', status: 'missing' }),
      makeItem({ id: '3', checked_out: true }),
      makeItem({ id: '4' }),
    ];
    const { el, store, sr } = await mount({ items, statuses });
    expect(tallies(sr)).toEqual(['2', '2', '0']);

    store.setFilters({ checkedOutOnly: true });
    await vi.waitUntil(() => matchingOf(store, 'ok') !== undefined);
    await settle(el);
    // Nothing carries "lent out", so the answer has no entry for it: 0 matches.
    expect(tallies(sr)).toEqual(['1 / 2', '1 / 2', '0 / 0']);

    store.setFilters({ checkedOutOnly: false });
    await vi.waitUntil(
      () => store.state.value.distinctValuesCache?.statuses?.[0]?.matching_count === undefined,
    );
    await settle(el);
    expect(tallies(sr)).toEqual(['2', '2', '0']);
  });

  // Priced against its own selection, every other status would read 0 the
  // moment one is picked. The category rows still narrow to the pick.
  it('leaves the selected status out of the status matches but not the category ones', async () => {
    const items = [
      makeItem({ id: '1', status: 'missing', category: 'Tools' }),
      makeItem({ id: '2', category: 'Tools' }),
      makeItem({ id: '3', category: 'Books' }),
      makeItem({ id: '4', status: 'needs_repair', category: 'Books' }),
    ];
    const { el, store, sr } = await mount({ items });
    const categoryTally = (value: string) =>
      sr
        .querySelector(`[data-testid="sidebar-categories-row"][data-value="${value}"] .hv-tally`)
        ?.textContent?.trim();

    rows(sr)
      .find((r) => r.dataset.value === 'missing')
      ?.click();
    await vi.waitUntil(() => matchingOf(store, 'ok') !== undefined);
    await settle(el);
    // The status is the only filter, so the status rows are priced against
    // nothing and match in full; the request was still a priced one.
    expect(tallies(sr)).toEqual(['2 / 2', '1 / 1', '1 / 1']);
    expect(categoryTally('Tools')).toBe('1 / 2');
    expect(categoryTally('Books')).toBe('0 / 2');

    // The mock's search reads the category, so this keeps the two Tools items.
    store.setFilters({ q: 'tools' });
    await vi.waitUntil(() => matchingOf(store, 'needs_repair') === 0);
    await settle(el);
    expect(tallies(sr)).toEqual(['1 / 2', '1 / 1', '0 / 1']);
    expect(categoryTally('Tools')).toBe('1 / 2');
  });

  // Across an upgrade's restart the card can be talking to a backend that
  // sends no statuses; the rows then keep the numbers they always had.
  it('keeps plain totals when the answer carries no statuses', async () => {
    const { el, store, hass, sr } = await mount({ items: flagged });
    const original = hass.callWS.bind(hass);
    hass.callWS = (async (msg: Record<string, unknown>) => {
      const result = await original(msg);
      if (String(msg.type) !== 'haventory/distinct_values') return result;
      const older = { ...(result as DistinctValues) };
      delete older.statuses;
      return older;
    }) as typeof hass.callWS;

    store.setFilters({ checkedOutOnly: true });
    await vi.waitUntil(() => store.state.value.distinctValuesCache?.statuses === undefined);
    await settle(el);
    expect(tallies(sr)).toEqual(['1', '1', '2']);
  });
});

describe('hv-full-sidebar: one tab stop per facet list', () => {
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
    sr.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await settle(el);
  };

  it('leaves one row of each list in the tab order and takes the rest out', async () => {
    const { sr } = await mount({ items: faceted });

    for (const section of SECTIONS) {
      const list = rows(sr, section);
      expect(list.length, section).toBeGreaterThan(2);
      expect(stops(sr, section), section).toHaveLength(1);
      expect(list.filter((r) => r.getAttribute('tabindex') === '-1').length, section).toBe(list.length - 1);
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
    defined(rows(sr, 'tags')[0], 'first tags row').focus();

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
    defined(rows(sr, 'categories')[0], 'first categories row').focus();

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
    const third = () => defined(rows(sr, 'categories')[2], 'third category row');

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
    defined(rows(sr, 'tags')[0], 'first tags row').click();
    await settle(el);
    defined(rows(sr, 'tags')[0], 'first tags row').focus();
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
    defined(rows(sr, 'tags')[0], 'first tags row').focus();
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
    follow(el);
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
    const walk = (sr: ShadowRoot) => deepFocusables(sr).length;

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

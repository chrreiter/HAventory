import './hv-filter-panel';
import type { HVFilterPanel } from './hv-filter-panel';
import { defaultFilters } from '../store/store';
import type { DistinctValues, Location, LocationTreeNode, StatusDefinition, StoreFilters } from '../store/types';

const distinct: DistinctValues = {
  categories: [
    { value: 'Hardware', count: 96 },
    { value: 'Tools', count: 54 },
    { value: 'Consumables', count: 41 },
    { value: 'Adhesives', count: 12 },
    { value: 'Cables', count: 7 },
  ],
  tags: [
    { value: 'metric', count: 61 },
    { value: 'm4', count: 38 },
    { value: 'wood', count: 22 },
  ],
  custom_field_keys: ['serial'],
};

const tree: LocationTreeNode[] = [
  {
    id: 'garage',
    name: 'Garage',
    parent_id: null,
    area_id: null,
    path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
    direct_item_count: 1,
    subtree_item_count: 3,
    children: [
      {
        id: 'shelf-a',
        name: 'Shelf A',
        parent_id: 'garage',
        area_id: null,
        path: {
          id_path: ['garage', 'shelf-a'],
          name_path: ['Garage', 'Shelf A'],
          display_path: 'Garage / Shelf A',
          sort_key: 'garage/shelf a',
        },
        direct_item_count: 2,
        subtree_item_count: 2,
        children: [],
      },
    ],
  },
];

async function mount(filters: Partial<StoreFilters> = {}, props: Partial<HVFilterPanel> = {}) {
  const el = document.createElement('hv-filter-panel') as HVFilterPanel;
  el.filters = { ...defaultFilters(), ...filters };
  el.distinct = distinct;
  el.locationTree = tree;
  el.areas = [{ id: 'area-garage', name: 'Garage' }];
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function changes(el: HVFilterPanel) {
  const seen: Partial<StoreFilters>[] = [];
  el.addEventListener('change', (e) => seen.push((e as CustomEvent).detail));
  return seen;
}

const q = (el: HVFilterPanel, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement;
const all = (el: HVFilterPanel, sel: string) => [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];
const label = (el: HVFilterPanel, testid: string) =>
  (q(el, `[data-testid="${testid}"]`).textContent ?? '').replace(/\s+/g, ' ').trim();

/** The flat cache behind `tree`, where only the root carries the area. */
const nestedLocations = (areaId: string | null): Location[] => [
  {
    id: 'garage',
    name: 'Garage',
    parent_id: null,
    area_id: areaId,
    path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
  },
  {
    id: 'shelf-a',
    name: 'Shelf A',
    parent_id: 'garage',
    area_id: null,
    path: {
      id_path: ['garage', 'shelf-a'],
      name_path: ['Garage', 'Shelf A'],
      display_path: 'Garage / Shelf A',
      sort_key: 'garage/shelf a',
    },
  },
];

describe('hv-filter-panel: category', () => {
  it('shows counted chips and collapses the tail behind More…', async () => {
    const el = await mount();
    expect(all(el, '[data-testid="filter-category"]').map((c) => c.dataset.value)).toEqual([
      'Hardware',
      'Tools',
      'Consumables',
      'Adhesives',
    ]);
    const more = q(el, '[data-testid="filter-category-more"]');
    expect(more.textContent).toContain('1');

    more.click();
    await el.updateComplete;
    expect(all(el, '[data-testid="filter-category"]')).toHaveLength(5);
  });

  // The group headings are the only thing separating the two runs of chips, and
  // a value used as both a category and a tag appears in each of them.
  it('tells a category chip from a tag chip without the group heading', async () => {
    const el = await mount();
    const category = q(el, '[data-testid="filter-category"]');
    const tag = q(el, '[data-testid="filter-tag"]');

    expect(tag.classList.contains('tag')).toBe(true);
    expect(category.classList.contains('tag')).toBe(false);
    expect(tag.querySelector('.hv-tag-mark')?.textContent).toBe('#');
    expect(category.querySelector('.hv-tag-mark')).toBe(null);
    // Pressable chips read as an outline until they are applied, so the mark is
    // the whole distinction here — the fill says "picked", not "tag".
    expect(tag.classList.contains('toggle')).toBe(true);
  });

  // A chip carries both marks once it is applied, and the check has to stay the
  // leading one: it reports the state, the # only names the facet.
  it('keeps the applied check ahead of the tag mark', async () => {
    const el = await mount();
    el.filters = { ...el.filters, tags: ['metric'] };
    await el.updateComplete;
    const tag = q(el, '[data-testid="filter-tag"][data-value="metric"]');

    expect(tag.getAttribute('aria-pressed')).toBe('true');
    expect(tag.querySelector('svg')).toBeTruthy();
    expect(tag.textContent?.replace(/\s+/g, ' ').trim()).toBe('#metric 61');
    const marks = [...tag.querySelectorAll('svg, .hv-tag-mark')].map((n) => n.tagName.toLowerCase());
    expect(marks[0]).toBe('svg');
  });

  it('accumulates categories and takes one back out when picked again', async () => {
    const el = await mount();
    const seen = changes(el);
    (q(el, '[data-value="Hardware"]') as HTMLButtonElement).click();
    expect(seen).toEqual([{ categories: ['Hardware'] }]);

    el.filters = { ...el.filters, categories: ['Hardware'] };
    await el.updateComplete;
    (q(el, '[data-value="Hardware"]') as HTMLButtonElement).click();
    expect(seen[1]).toEqual({ categories: [] });
  });
});

describe('hv-filter-panel: status', () => {
  it('offers every status as a single-select chip that toggles off when re-picked', async () => {
    const el = await mount();
    expect(all(el, '[data-testid="filter-status"]').map((c) => c.dataset.value)).toEqual([
      'ok',
      'missing',
      'needs_repair',
    ]);

    const seen = changes(el);
    (q(el, '[data-testid="filter-status"][data-value="missing"]') as HTMLButtonElement).click();
    expect(seen).toEqual([{ status: 'missing' }]);

    el.filters = { ...el.filters, status: 'missing' };
    await el.updateComplete;
    (q(el, '[data-testid="filter-status"][data-value="missing"]') as HTMLButtonElement).click();
    expect(seen[1]).toEqual({ status: null });
  });

  // Every chip priced, so a user picking what to filter by can see which
  // statuses hold anything — the SHOW ONLY row above has always done this.
  it('prices every status from the per-slug counts, zeroes included', async () => {
    const statuses: StatusDefinition[] = [
      { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
      { slug: 'lent_out', label: 'Lent out', order: 1, color: 'blue', icon: 'hand' },
      { slug: 'in_transit', label: 'In transit', order: 2, color: 'blue_strong', icon: 'truck' },
    ];
    const el = await mount(
      {},
      {
        statuses,
        counts: {
          items_total: 998,
          low_stock_count: 0,
          checked_out_count: 0,
          locations_total: 0,
          no_location_count: 0,
          status_counts: { ok: 856, lent_out: 100, in_transit: 0 },
        },
      },
    );
    const chips = all(el, '[data-testid="filter-status"]');
    expect(chips.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual([
      'OK 856',
      'Lent out 100',
      'In transit 0',
    ]);
  });

  // A backend too old to send the per-slug map still prices the two flagged
  // built-ins in their own fields; nothing else is knowable there.
  it('prices only the two flagged statuses when the per-slug map is absent', async () => {
    const el = await mount(
      {},
      {
        counts: {
          items_total: 10,
          low_stock_count: 0,
          checked_out_count: 0,
          missing_count: 2,
          needs_repair_count: 1,
          locations_total: 0,
          no_location_count: 0,
        },
      },
    );
    const chips = all(el, '[data-testid="filter-status"]');
    expect(chips.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual([
      'OK',
      'Missing 2',
      'Needs repair 1',
    ]);
  });

  // A chosen status shows its own colour; the rest stay outlines, so the row
  // reads as choices rather than as facts. The default never fills, because
  // "OK" is not a state worth marking.
  it('fills a selected status with its own tone and leaves the default plain', async () => {
    const el = await mount({ status: 'needs_repair' });
    const chip = q(el, '[data-testid="filter-status"][data-value="needs_repair"]');
    expect(chip.classList.contains('on')).toBe(true);
    expect(chip.classList.contains('tone-amber')).toBe(true);
    expect(
      q(el, '[data-testid="filter-status"][data-value="ok"]').classList.contains('tone-green'),
    ).toBe(false);
  });

  // A household colour outside the ten has no class to carry it, so the chip
  // takes it inline — and an unselected one still must not be painted.
  it('fills a selected status in a literal colour, and only while selected', async () => {
    const statuses: StatusDefinition[] = [
      { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
      { slug: 'sold', label: 'Verkauft', order: 1, color: '#2f6f4f', icon: 'box' },
    ];
    const on = q(
      await mount({ status: 'sold' }, { statuses }),
      '[data-testid="filter-status"][data-value="sold"]',
    );
    expect(on.style.getPropertyValue('--hv-status-bg')).toBe('#2f6f4f');
    expect(on.style.getPropertyValue('--hv-status-fg')).toBe('#ffffff');

    const off = q(await mount({}, { statuses }), '[data-testid="filter-status"][data-value="sold"]');
    expect(off.getAttribute('style')).toBeNull();
  });
});

// The panel is a household surface: a hint that names how the backend stores a
// value, or where a count came from, tells a user nothing they can act on.
describe('hv-filter-panel: hints', () => {
  it('says what the control does, in words a household uses', async () => {
    const el = await mount();
    const hints = all(el, '.hint').map((h) => h.textContent?.trim());

    // Several picked categories can only mean OR — an item carries one — so
    // the hint says which reading applies, where tags offer the choice.
    expect(hints).toContain('Any of the picked categories');
    expect(hints).toContain('Tags are always lowercase');
    expect(hints.join(' ')).not.toMatch(/distinct values|on commit|Stored lowercase/);
  });
});

describe('hv-filter-panel: tags', () => {
  it('multi-selects tags and switches between any and all', async () => {
    const el = await mount();
    const seen = changes(el);

    (q(el, '[data-testid="filter-tag"][data-value="metric"]') as HTMLButtonElement).click();
    expect(seen[0]).toEqual({ tags: ['metric'] });

    el.filters = { ...el.filters, tags: ['metric'] };
    await el.updateComplete;
    (q(el, '[data-testid="filter-tag"][data-value="m4"]') as HTMLButtonElement).click();
    expect(seen[1]).toEqual({ tags: ['metric', 'm4'] });

    (q(el, '[data-testid="filter-tags-mode"][data-mode="all"]') as HTMLButtonElement).click();
    expect(seen[2]).toEqual({ tagsMode: 'all' });
  });

  it('lowercases a typed tag on commit, matching how the backend stores it', async () => {
    const el = await mount();
    const seen = changes(el);
    const input = q(el, '[data-testid="filter-tag-add"]').querySelector('input') as HTMLInputElement;

    input.value = '  Metric-Fine  ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(seen[0]).toEqual({ tags: ['metric-fine'] });
  });

  it('ignores a duplicate or empty typed tag', async () => {
    const el = await mount({ tags: ['metric'] });
    const seen = changes(el);
    const input = q(el, '[data-testid="filter-tag-add"]').querySelector('input') as HTMLInputElement;

    input.value = 'metric';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(seen).toEqual([]);
  });

  it('still shows a selected tag no item currently carries', async () => {
    const el = await mount({ tags: ['nobody-uses-this'] });
    const values = all(el, '[data-testid="filter-tag"]').map((c) => c.dataset.value);
    expect(values).toContain('nobody-uses-this');
  });

  // An auto margin parked Any/All against the right rim of the panel. On the
  // expanded view that is over a screen's width from the word "Tags" and sits
  // directly above an unrelated row, so what it applied to was anyone's guess.
  it('keeps the any/all toggle beside its own heading', async () => {
    const el = await mount();
    const segmented = q(el, '[data-testid="filter-tags-mode"]').parentElement as HTMLElement;

    expect(segmented.style.marginLeft).toBe('');
    // Immediately after the heading it qualifies, in the same head row.
    const head = segmented.parentElement as HTMLElement;
    expect(head.classList.contains('group-head')).toBe(true);
    expect(head.firstElementChild?.textContent?.trim()).toBe('Tags');
    expect(head.firstElementChild?.nextElementSibling).toBe(segmented);
  });
});

describe('hv-filter-panel: show only vs sort', () => {
  // Sort is a daily toggle and the tag cloud renders every tag the household
  // has, so on a phone anything under it is several screens into the sheet.
  it('puts sort above the tag cloud', async () => {
    const el = await mount();
    const headings = all(el, '.hv-label').map((s) => s.textContent?.trim());

    expect(headings).toEqual(['Where', 'Category', 'Show only', 'Status', 'Changed', 'Sort', 'Tags']);
  });

  it('keeps low-stock-only and low-stock-first as separate controls', async () => {
    const el = await mount();
    const seen = changes(el);

    (q(el, '[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="filter-low-stock-first"]') as HTMLButtonElement).click();

    expect(seen).toEqual([{ lowStockOnly: true }, { lowStockFirst: true }]);
  });

  // These four were the only facet controls in the card with no number beside
  // them — and the renderer already had a slot for one, filled with a hardcoded
  // null, while both app bars printed the very same counts a few pixels away.
  it('states how many items each Show-only facet would keep', async () => {
    const el = await mount(
      {},
      {
        counts: {
          items_total: 556,
          locations_total: 26,
          low_stock_count: 102,
          checked_out_count: 82,
          overdue_count: 32,
          no_location_count: 26,
        },
      },
    );
    const tallyOf = (testid: string) =>
      q(el, `[data-testid="${testid}"]`).querySelector('.hv-tally')?.textContent?.trim();

    expect(tallyOf('filter-low-stock-only')).toBe('102');
    expect(tallyOf('filter-checked-out')).toBe('82');
    expect(tallyOf('filter-overdue')).toBe('32');
    expect(tallyOf('filter-orphans')).toBe('26');
  });

  it('prints no tally at all when the counts have not arrived', async () => {
    const el = await mount();
    expect(q(el, '[data-testid="filter-low-stock-only"]').querySelector('.hv-tally')).toBe(null);
  });

  it('carries the same tallies into the phone layout', async () => {
    const el = await mount(
      {},
      {
        mobile: true,
        counts: {
          items_total: 9,
          locations_total: 2,
          low_stock_count: 4,
          checked_out_count: 3,
          overdue_count: 1,
          no_location_count: 2,
        },
      },
    );
    expect(q(el, '[data-testid="filter-overdue"]').textContent).toContain('1');
    expect(q(el, '[data-testid="filter-orphans"]').textContent).toContain('2');
  });

  it('offers every sort field the backend supports', async () => {
    const el = await mount();
    const options = [...q(el, '[data-testid="filter-sort-field"]').querySelectorAll('option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual([
      'updated_at',
      'created_at',
      'name',
      'quantity',
      'due_date',
      'inspection_date',
    ]);
  });

  it('labels the direction for the field being sorted', async () => {
    const el = await mount();
    expect(q(el, '[data-order="desc"]').textContent?.trim()).toBe('Newest');

    el.filters = { ...el.filters, sort: { field: 'name', order: 'asc' } };
    await el.updateComplete;
    expect(q(el, '[data-order="desc"]').textContent?.trim()).toBe('Descending');
  });

  it('changes sort direction without changing the field', async () => {
    const el = await mount({ sort: { field: 'name', order: 'asc' } });
    const seen = changes(el);
    (q(el, '[data-order="desc"]') as HTMLButtonElement).click();
    expect(seen[0]).toEqual({ sort: { field: 'name', order: 'desc' } });
  });
});

describe('hv-filter-panel: dates and location', () => {
  it('turns a date input into the ISO instant the backend compares against', async () => {
    const el = await mount();
    const seen = changes(el);
    const input = q(el, '[data-testid="filter-updated-date"]').querySelector(
      'input',
    ) as HTMLInputElement;

    input.value = '2026-07-01';
    input.dispatchEvent(new Event('change'));
    expect(seen[0]).toEqual({ updatedAfter: '2026-07-01T00:00:00Z' });

    input.value = '';
    input.dispatchEvent(new Event('change'));
    expect(seen[1]).toEqual({ updatedAfter: null });
  });

  it('picks a location from a real tree, in place', async () => {
    const el = await mount();
    const seen = changes(el);
    expect(el.shadowRoot?.querySelector('[data-testid="filter-location-tree"]')).toBe(null);

    (q(el, '[data-testid="filter-location"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const tree = () => el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement | null;
    (tree()?.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="garage"]') as HTMLButtonElement).click();
    expect(seen[0]).toEqual({ locationIds: ['garage'] });

    // Adding to a selection means picking again, so the tree stays open.
    await el.updateComplete;
    expect(tree()).not.toBe(null);

    // "All items" is the pick that finishes the job, so it closes the tree.
    (tree()?.shadowRoot?.querySelector('[data-testid="tree-all"]') as HTMLButtonElement).click();
    expect(seen[1]).toEqual({ locationIds: [] });
    await el.updateComplete;
    expect(tree()).toBe(null);
  });

  // The sidebar accumulates locations; a panel that replaced on every click
  // would disagree with it about what "picked" means.
  it('accumulates locations and takes one back out on a second press', async () => {
    const el = await mount();
    const seen = changes(el);
    (q(el, '[data-testid="filter-location"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const inTree = (sel: string) =>
      (el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement)?.shadowRoot?.querySelector(
        sel,
      ) as HTMLButtonElement;
    const row = (id: string) => inTree(`[data-testid="tree-row"][data-id="${id}"]`);

    // Shelf A is a child, so its row only exists once Garage is expanded.
    inTree('[data-testid="tree-twisty"]').click();
    await el.updateComplete;

    row('garage').click();
    el.filters = { ...el.filters, locationIds: ['garage'] };
    await el.updateComplete;
    row('shelf-a').click();
    expect(seen[1]).toEqual({ locationIds: ['garage', 'shelf-a'] });

    el.filters = { ...el.filters, locationIds: ['garage', 'shelf-a'] };
    await el.updateComplete;
    row('garage').click();
    expect(seen[2]).toEqual({ locationIds: ['shelf-a'] });
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the chip in reading order.
  it('names the holder the location chip discloses, open or shut', async () => {
    const el = await mount();
    const chip = () => q(el, '[data-testid="filter-location"]') as HTMLButtonElement;
    const id = 'filter-location-tree-holder';

    expect(chip().getAttribute('aria-controls')).toBe(id);
    expect(chip().getAttribute('aria-expanded')).toBe('false');
    // The id has to resolve in both states — a control pointing at nothing
    // announces as controlling nothing — so the holder outlives the tree in it.
    const shut = el.shadowRoot?.getElementById(id);
    expect(shut, 'holder shut').toBeTruthy();
    expect(shut?.querySelector('hv-location-tree'), 'no tree while shut').toBe(null);

    chip().click();
    await el.updateComplete;

    expect(chip().getAttribute('aria-expanded')).toBe('true');
    expect(chip().getAttribute('aria-controls')).toBe(id);
    const open = el.shadowRoot?.getElementById(id);
    expect(open?.querySelector('hv-location-tree'), 'tree open inside the holder').toBeTruthy();
  });

  it('names the picked location on the chip', async () => {
    const el = await mount(
      { locationIds: ['shelf-a'] },
      {
        locations: [
          {
            id: 'shelf-a',
            name: 'Shelf A',
            parent_id: 'garage',
            area_id: null,
            path: {
              id_path: ['garage', 'shelf-a'],
              name_path: ['Garage', 'Shelf A'],
              display_path: 'Garage / Shelf A',
              sort_key: 'garage/shelf a',
            },
          },
        ],
      },
    );
    expect(q(el, '[data-testid="filter-location"]').textContent).toContain('Garage › Shelf A');
  });

  it('names the area the picked location inherits, matching the chip row wording', async () => {
    const el = await mount(
      { locationIds: ['shelf-a'] },
      { locations: nestedLocations('area-kitchen'), areas: [{ id: 'area-kitchen', name: 'Kitchen' }] },
    );
    expect(label(el, 'filter-location')).toContain('Area: Kitchen · Garage › Shelf A');
  });

  // A root named after its own room made the field read "Area: Garage · Garage
  // › Shelf A". The same elision the chip beside a path takes.
  it('drops the area when the picked path opens with that name', async () => {
    const el = await mount({ locationIds: ['shelf-a'] }, { locations: nestedLocations('area-garage') });
    expect(label(el, 'filter-location')).toContain('Garage › Shelf A');
    expect(label(el, 'filter-location')).not.toContain('Area:');
  });

  it('leaves a location in no area labelled exactly as before', async () => {
    const el = await mount({ locationIds: ['shelf-a'] }, { locations: nestedLocations(null) });
    expect(label(el, 'filter-location')).toContain('Garage › Shelf A');
    expect(label(el, 'filter-location')).not.toContain('Area:');
  });

  it('says nothing about an area while no location is picked', async () => {
    const el = await mount({}, { locations: nestedLocations('area-garage') });
    expect(label(el, 'filter-location')).toContain('Any location');
    expect(label(el, 'filter-location')).not.toContain('Area:');
  });
});

describe('hv-filter-panel: footer and staging', () => {
  it('summarises how many filters are on and how many items match', async () => {
    const el = await mount({ categories: ['Hardware'], checkedOutOnly: true }, { total: 38, grandTotal: 250 });
    expect(q(el, '[data-testid="filter-summary"]').textContent).toContain('2 filters active');
    expect(q(el, '[data-testid="filter-summary"]').textContent).toContain('38 of 250 match');
  });

  it('hides the footer on mobile, where the sheet owns those controls', async () => {
    const el = await mount({}, { mobile: true });
    expect(el.shadowRoot?.querySelector('[data-testid="filter-summary"]')).toBe(null);
  });

  it('stages instead of applying in mobile mode, and reports the draft', async () => {
    const el = await mount({}, { mobile: true });
    const applied: unknown[] = [];
    const staged: StoreFilters[] = [];
    el.addEventListener('change', () => applied.push(true));
    el.addEventListener('stage', (e) => staged.push((e as CustomEvent).detail.filters));

    (q(el, '[data-value="Hardware"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(applied).toEqual([]);
    expect(staged[0].categories).toEqual(['Hardware']);
    expect(el.working.categories).toEqual(['Hardware']);
  });

  it('emits the whole draft on apply, and forgets it on reset', async () => {
    const el = await mount({}, { mobile: true });
    const applies: StoreFilters[] = [];
    el.addEventListener('apply', (e) => applies.push((e as CustomEvent).detail));

    (q(el, '[data-value="Tools"]') as HTMLButtonElement).click();
    await el.updateComplete;
    el.apply();
    expect(applies[0].categories).toEqual(['Tools']);

    (q(el, '[data-value="Tools"]') as HTMLButtonElement).click();
    await el.updateComplete;
    el.resetDraft();
    await el.updateComplete;
    expect(el.working.categories).toEqual([]);
  });

  // Clearing used to go straight to the store: the list behind the sheet
  // reloaded while every control in the sheet kept its old value.
  it('clears the staged draft, not the applied filters', async () => {
    const el = await mount(
      { categories: ['Hardware'], tags: ['metric'], lowStockOnly: true },
      { mobile: true },
    );
    const applied: unknown[] = [];
    const staged: StoreFilters[] = [];
    el.addEventListener('change', () => applied.push(true));
    el.addEventListener('stage', (e) => staged.push((e as CustomEvent).detail.filters));

    el.clearAll();
    await el.updateComplete;

    expect(applied).toEqual([]);
    expect(el.working).toMatchObject({ categories: [], tags: [], lowStockOnly: false });
    expect(staged[0]).toMatchObject({ categories: [], tags: [], lowStockOnly: false });
    // Every chip in the sheet is visibly off again.
    expect(all(el, '[data-testid="filter-category"].on')).toEqual([]);

    // Still staged: the filters only reach the store on apply.
    const applies: StoreFilters[] = [];
    el.addEventListener('apply', (e) => applies.push((e as CustomEvent).detail));
    el.apply();
    expect(applies[0]).toMatchObject({ categories: [], tags: [], lowStockOnly: false });
  });

  it('keeps the chosen sort when clearing', async () => {
    const el = await mount({ categories: ['Tools'], sort: { field: 'name', order: 'asc' } }, { mobile: true });
    el.clearAll();
    await el.updateComplete;
    expect(el.working.sort).toEqual({ field: 'name', order: 'asc' });
  });

  it('still asks the host to clear when it applies live (desktop)', async () => {
    const el = await mount({ categories: ['Tools'] });
    let cleared = 0;
    el.addEventListener('clear-filters', () => {
      cleared += 1;
    });
    (q(el, '[data-testid="filter-clear-all"]') as HTMLButtonElement).click();
    expect(cleared).toBe(1);
  });
});

describe('hv-filter-panel: native control affordances', () => {
  // The sort field draws its own chevron next to the <select>. Without
  // resetting the UA appearance the browser draws a second one beside it.
  it('suppresses the browser-drawn arrow on selects it decorates itself', () => {
    const sheet = (customElements.get('hv-filter-panel') as typeof HVFilterPanel).styles;
    const cssText = (Array.isArray(sheet) ? sheet : [sheet]).map((s) => String(s.cssText)).join('\n');
    const selectRule = cssText.slice(cssText.indexOf('.field select'));
    expect(selectRule).toContain('appearance: none');
  });

  // The drawn chevron used to be a sibling of a select only as wide as its own
  // text, so clicking the arrow — the obvious target — did nothing at all.
  it('lets the select own the whole field, chevron included', async () => {
    const el = await mount();
    for (const testid of ['filter-sort-field', 'filter-area']) {
      const field = q(el, `[data-testid="${testid}"]`);
      expect(field.classList.contains('select-field')).toBe(true);
      expect(field.querySelector('.chevron')).not.toBe(null);
    }

    const sheet = (customElements.get('hv-filter-panel') as typeof HVFilterPanel).styles;
    const cssText = (Array.isArray(sheet) ? sheet : [sheet]).map((s) => String(s.cssText)).join('\n');
    const chevronRule = cssText.slice(cssText.indexOf('.field .chevron'));
    expect(chevronRule).toContain('pointer-events: none');
  });

  // "Updated ≥" flips the comparison, but it was drawn as a plain caption with a
  // hover wash: the only clue it could be pressed arrived after the pointer was
  // already on it, and a touch screen never provided that clue at all.
  it('draws the comparison flip as a control at rest, not only on hover', () => {
    const sheet = (customElements.get('hv-filter-panel') as typeof HVFilterPanel).styles;
    const cssText = (Array.isArray(sheet) ? sheet : [sheet])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');

    const rule = /\.field \.direction \{([^}]*)\}/.exec(cssText)?.[1] ?? '';
    expect(rule, 'no .field .direction rule').not.toBe('');
    expect(rule).toMatch(/border: 1px solid/);
    expect(rule).not.toMatch(/border: none/);
    expect(rule).toMatch(/background: var\(--hv-surface\)/);
    // Hover still adds emphasis; it is no longer the only state that has any.
    expect(cssText).toMatch(/\.field \.direction:hover \{[^}]*border-color/);
  });

  // On a phone the fields took --hv-input-font (16px on this surface) while the
  // chips beside them are 13.5px, so the area select — the one full-width
  // control in the panel — was the largest text on the page. Desktop has always
  // matched its chips at 12.5px.
  it('sizes its fields like the chips beside them, in both layouts', () => {
    const sheet = (customElements.get('hv-filter-panel') as typeof HVFilterPanel).styles;
    const css = (Array.isArray(sheet) ? sheet : [sheet])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');

    // The selector is matched as a literal, so every regex metacharacter in it
    // has to reach the pattern escaped — the backslash included, or an escape
    // introduced here would itself be read as syntax.
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const size = (selector: string) => {
      const rule = new RegExp(`${escapeRe(selector)} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      return /font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/.exec(rule)?.[1] ?? null;
    };

    expect(size('.field')).toBe(size('.chip'));
    expect(size(':host([mobile]) .field')).toBe(size(':host([mobile]) .chip'));
    expect(size(':host([mobile]) .field')).toBe('13.5');
    // The one exception, and why: a text box iOS would zoom the page for.
    expect(css).toMatch(/:host\(\[mobile\]\) \.field input\[type='search'\] \{[^}]*var\(--hv-input-font/);
  });
});

describe('hv-filter-panel: changed', () => {
  // Two bare date inputs side by side are indistinguishable: the only labels
  // used to be screen-reader-only, so a sighted user could not tell which one
  // filtered on updated and which on created.
  it('labels each date filter visibly, not only for screen readers', async () => {
    const el = await mount();

    const visibleText = (host: HTMLElement) =>
      [...host.querySelectorAll('button, span')]
        .filter((s) => !s.classList.contains('hv-sr-only'))
        .map((s) => s.textContent?.trim())
        .join(' ');

    expect(visibleText(q(el, '[data-testid="filter-updated-date"]'))).toMatch(/updated/i);
    expect(visibleText(q(el, '[data-testid="filter-created-date"]'))).toMatch(/created/i);
  });

  it('keeps the two date inputs wired to their own filter keys', async () => {
    const el = await mount();
    const seen = changes(el);

    const updatedInput = q(el, '[data-testid="filter-updated-date"] input') as HTMLInputElement;
    updatedInput.value = '2026-07-01';
    updatedInput.dispatchEvent(new Event('change'));

    const createdInput = q(el, '[data-testid="filter-created-date"] input') as HTMLInputElement;
    createdInput.value = '2026-06-01';
    createdInput.dispatchEvent(new Event('change'));

    expect(seen[0]).toMatchObject({ updatedAfter: '2026-07-01T00:00:00Z' });
    expect(seen[1]).toMatchObject({ createdAfter: '2026-06-01T00:00:00Z' });
  });

  // "Since" and "before" are the same row asked in two directions.
  it('flips a date row from ≥ to ≤ and back, carrying the value across', async () => {
    const el = await mount({ updatedAfter: '2026-07-01T00:00:00Z' });
    const seen = changes(el);
    const direction = () => q(el, '[data-testid="filter-updated-direction"]') as HTMLButtonElement;

    expect(direction().dataset.direction).toBe('after');
    expect(direction().textContent).toContain('≥');

    direction().click();
    expect(seen[0]).toEqual({ updatedAfter: null, updatedBefore: '2026-07-01T00:00:00Z' });

    // Re-mount as the store would, with the flipped filter applied.
    const flipped = await mount({ updatedBefore: '2026-07-01T00:00:00Z' });
    const flippedDirection = q(flipped, '[data-testid="filter-updated-direction"]') as HTMLButtonElement;
    expect(flippedDirection.dataset.direction).toBe('before');
    expect(flippedDirection.textContent).toContain('≤');

    // The input now edits the `before` bound rather than the `after` one.
    const seenFlipped = changes(flipped);
    const input = q(flipped, '[data-testid="filter-updated-date"] input') as HTMLInputElement;
    input.value = '2026-06-01';
    input.dispatchEvent(new Event('change'));
    expect(seenFlipped[0]).toEqual({ updatedBefore: '2026-06-01T00:00:00Z' });
  });

  it('flips an empty row without filtering on nothing', async () => {
    const el = await mount();
    const seen = changes(el);
    (q(el, '[data-testid="filter-created-direction"]') as HTMLButtonElement).click();
    await el.updateComplete;

    // The row remembers the flip so the next date lands on the right bound…
    const direction = q(el, '[data-testid="filter-created-direction"]') as HTMLButtonElement;
    expect(direction.dataset.direction).toBe('before');
    // …but there is nothing to filter on yet, so the list is left alone.
    expect(seen).toEqual([]);

    const input = q(el, '[data-testid="filter-created-date"] input') as HTMLInputElement;
    input.value = '2026-06-01';
    input.dispatchEvent(new Event('change'));
    expect(seen[0]).toEqual({ createdBefore: '2026-06-01T00:00:00Z' });
  });
});

describe('hv-filter-panel: overdue', () => {
  it('offers overdue alongside the other show-only filters', async () => {
    const el = await mount();
    const seen = changes(el);
    (q(el, '[data-testid="filter-overdue"]') as HTMLButtonElement).click();
    expect(seen[0]).toEqual({ overdueOnly: true });
  });
});

describe('hv-filter-panel: inspection due', () => {
  // The sort menu is the one place the field is named rather than described,
  // so it has to carry the same forward-looking wording as the editor.
  it('names the inspection sort field for the date it holds', async () => {
    const el = await mount();
    const labels = [...q(el, '[data-testid="filter-sort-field"]').querySelectorAll('option')].map(
      (o) => (o as HTMLOptionElement).textContent?.trim(),
    );
    expect(labels).toContain('Next inspection');
    expect(labels).not.toContain('Inspection date');
  });

  it('offers the filter on both widths, tallied from the backend count', async () => {
    for (const mobile of [false, true]) {
      const el = await mount(
        {},
        {
          mobile,
          counts: {
            items_total: 9,
            locations_total: 2,
            low_stock_count: 4,
            checked_out_count: 3,
            overdue_count: 1,
            inspection_overdue_count: 5,
            no_location_count: 2,
          },
        },
      );
      const chip = q(el, '[data-testid="filter-inspection-due"]');
      expect(chip.textContent, `mobile=${mobile}`).toContain('Inspection due');
      expect(chip.textContent, `mobile=${mobile}`).toContain('5');

      // The phone branch stages its edits behind the "Show N items" row; the
      // desktop one applies straight away.
      const applied: Partial<StoreFilters>[] = [];
      el.addEventListener('change', (e) => applied.push((e as CustomEvent).detail));
      el.addEventListener('stage', (e) =>
        applied.push((e as CustomEvent).detail.filters as StoreFilters),
      );
      (chip as HTMLButtonElement).click();
      expect(applied[0], `mobile=${mobile}`).toMatchObject({ inspectionDueOnly: true });
      el.remove();
    }
  });
});

/**
 * The seven chips that hold a filter's on/off state, and the filter that turns
 * each one on. The location chip and "More…" are not among them: the first is a
 * disclosure that names the location it holds, the second only reveals the rest
 * of the category tail.
 */
const STATEFUL_CHIPS: { name: string; sel: string; on: Partial<StoreFilters> }[] = [
  {
    name: 'category',
    sel: '[data-testid="filter-category"][data-value="Hardware"]',
    on: { categories: ['Hardware'] },
  },
  { name: 'tag', sel: '[data-testid="filter-tag"][data-value="metric"]', on: { tags: ['metric'] } },
  { name: 'low stock', sel: '[data-testid="filter-low-stock-only"]', on: { lowStockOnly: true } },
  { name: 'checked out', sel: '[data-testid="filter-checked-out"]', on: { checkedOutOnly: true } },
  { name: 'overdue', sel: '[data-testid="filter-overdue"]', on: { overdueOnly: true } },
  {
    name: 'inspection due',
    sel: '[data-testid="filter-inspection-due"]',
    on: { inspectionDueOnly: true },
  },
  { name: 'no location', sel: '[data-testid="filter-orphans"]', on: { orphansOnly: true } },
];

describe('hv-filter-panel: pressed state', () => {
  // Colour was the whole signal on the desktop panel, so a screen reader could
  // not tell an active filter from an inactive one — while the same facets
  // announced their state in the sheet, on both app bars and in the sidebar.
  it('announces every chip pressed or not, on both widths', async () => {
    for (const mobile of [false, true]) {
      for (const chip of STATEFUL_CHIPS) {
        const off = await mount({}, { mobile });
        expect(
          q(off, chip.sel).getAttribute('aria-pressed'),
          `${chip.name} off, mobile=${mobile}`,
        ).toBe('false');
        off.remove();

        const on = await mount(chip.on, { mobile });
        expect(
          q(on, chip.sel).getAttribute('aria-pressed'),
          `${chip.name} on, mobile=${mobile}`,
        ).toBe('true');
        on.remove();
      }
    }
  });

  it('keeps the announced state in step with the paint, chip for chip', async () => {
    for (const mobile of [false, true]) {
      const el = await mount(
        { categories: ['Tools'], tags: ['m4'], overdueOnly: true, includeSubtree: true },
        { mobile },
      );
      // Every toggle in the panel paints itself, rows included: a row is a chip
      // in another shape, not a checkbox that paints a box inside it.
      const painted = (b: HTMLElement) => b.classList.contains('on');
      const toggles = all(el, 'button.chip, button.check').filter(
        (b) => b.dataset.testid !== 'filter-location' && b.dataset.testid !== 'filter-category-more',
      );

      expect(toggles.length, `mobile=${mobile}`).toBeGreaterThanOrEqual(STATEFUL_CHIPS.length);
      for (const toggle of toggles) {
        expect(toggle.getAttribute('aria-pressed'), `${toggle.dataset.testid}, mobile=${mobile}`).toBe(
          String(painted(toggle)),
        );
      }
      // Not vacuous: this mount has some on and some off.
      const states = toggles.map((t) => t.getAttribute('aria-pressed'));
      expect(states, `mobile=${mobile}`).toContain('true');
      expect(states, `mobile=${mobile}`).toContain('false');
      el.remove();
    }
  });

  // The rows announce as toggle buttons but drew a checkbox's box, which left
  // the sheet as the one surface where the paint and the announcement disagreed.
  it('paints every row as a chip rather than a checkbox, at both widths', async () => {
    const ROWS = ['filter-include-subtree', 'filter-low-stock-first', 'filter-low-stock-only'];
    for (const mobile of [false, true]) {
      const el = await mount({ lowStockOnly: true, includeSubtree: true, lowStockFirst: true }, { mobile });
      for (const testid of ROWS) {
        const row = q(el, `[data-testid="${testid}"]`);
        // "Low stock" is a chip on a desktop and a row in the sheet; the other
        // two are rows at both widths.
        if (!mobile && testid === 'filter-low-stock-only') continue;
        const where = `${testid}, mobile=${mobile}`;
        expect(row.classList.contains('chip'), where).toBe(true);
        expect(row.querySelector('.box'), where).toBe(null);
        expect(row.querySelector('.mark'), where).toBeTruthy();
      }
      el.remove();
    }
  });

  // The sheet carried `warning` at rest, where `.hv-chip.warning` paints the
  // amber fill on its own — so a phone showed "Filters — 0 active" above three
  // chips that looked applied. The desktop chip beside it only pairs the hue
  // with `on`.
  it('tints a warning chip when it is selected, never at rest', async () => {
    const el = await mount({}, { mobile: true });
    const chipOf = (testid: string) => q(el, `[data-testid="${testid}"]`);

    for (const testid of ['filter-low-stock-only', 'filter-overdue', 'filter-inspection-due']) {
      expect(chipOf(testid).classList.contains('warning'), testid).toBe(false);
    }

    (chipOf('filter-low-stock-only') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(chipOf('filter-low-stock-only').classList.contains('warning')).toBe(true);
    expect(chipOf('filter-low-stock-only').classList.contains('on')).toBe(true);
    expect(chipOf('filter-overdue').classList.contains('warning')).toBe(false);
  });

  // The row's on state has to be the shared chip's on state, not a second set
  // of colours that happens to look similar.
  it('takes its on state from the shared chip rule, warning variant included', () => {
    const sheet = (customElements.get('hv-filter-panel') as typeof HVFilterPanel).styles;
    const css = (Array.isArray(sheet) ? sheet : [sheet])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');

    expect(css).toMatch(/\.hv-chip\.toggle\.on \{[^}]*background: var\(--hv-primary-tint\)/);
    expect(css).toMatch(/\.hv-chip\.toggle\.warning\.on \{[^}]*background: var\(--hv-warn-bg\)/);
    // No rule of its own to drift from those, and no checkbox box left to draw.
    expect(css).not.toMatch(/[^-]\.chip\.on \{/);
    expect(css).not.toMatch(/\.check\.on \{/);
    expect(css).not.toMatch(/\.box[ .{]/);
  });

  it('reserves the mark so a row keeps its label in place as it is pressed', async () => {
    const el = await mount({}, { mobile: true });
    const row = q(el, '[data-testid="filter-low-stock-only"]');
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(row.querySelector('.mark'), 'off rows still hold the slot open').toBeTruthy();

    const el2 = await mount({ lowStockOnly: true }, { mobile: true });
    expect(q(el2, '[data-testid="filter-low-stock-only"]').querySelector('.mark svg')).toBeTruthy();

    const sheet = (customElements.get('hv-filter-panel') as typeof HVFilterPanel).styles;
    const css = (Array.isArray(sheet) ? sheet : [sheet])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
    expect(css).toMatch(/\.check \.mark \{[^}]*width: 12px/);
    expect(css).toMatch(/:host\(\[mobile\]\) \.check \.mark \{[^}]*width: 15px/);
  });

  it('flips as the filter is applied, not only on mount', async () => {
    const el = await mount();
    const chip = () => q(el, '[data-testid="filter-overdue"]');
    expect(chip().getAttribute('aria-pressed')).toBe('false');

    (chip() as HTMLButtonElement).click();
    // Desktop applies through the host, which hands the new filters back down.
    el.filters = { ...el.filters, overdueOnly: true };
    await el.updateComplete;
    expect(chip().getAttribute('aria-pressed')).toBe('true');
  });

  it('presses a selected tag no item currently carries', async () => {
    const el = await mount({ tags: ['nobody-uses-this'] });
    expect(
      q(el, '[data-testid="filter-tag"][data-value="nobody-uses-this"]').getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
  });

  it('marks the two toggle rows too, on both widths', async () => {
    for (const mobile of [false, true]) {
      const fresh = await mount({}, { mobile });
      const state = (el: HVFilterPanel, testid: string) =>
        q(el, `[data-testid="${testid}"]`).getAttribute('aria-pressed');

      // Sub-locations are included by default; low-stock-first is not.
      expect(state(fresh, 'filter-include-subtree'), `mobile=${mobile}`).toBe('true');
      expect(state(fresh, 'filter-low-stock-first'), `mobile=${mobile}`).toBe('false');
      fresh.remove();

      const flipped = await mount({ includeSubtree: false, lowStockFirst: true }, { mobile });
      expect(state(flipped, 'filter-include-subtree'), `mobile=${mobile}`).toBe('false');
      expect(state(flipped, 'filter-low-stock-first'), `mobile=${mobile}`).toBe('true');
      flipped.remove();
    }
  });

  // One vocabulary for the whole card: the same facet must not be a checkbox in
  // the sheet and a toggle button on the panel.
  it('leaves no control announcing as a checkbox', async () => {
    for (const mobile of [false, true]) {
      const el = await mount({}, { mobile });
      expect(all(el, '[role="checkbox"]'), `mobile=${mobile}`).toEqual([]);
      // Tag match mode and sort direction are radiogroups, where aria-checked
      // is the right word for the same idea.
      const checked = all(el, '[aria-checked]').filter((n) => n.getAttribute('role') !== 'radio');
      expect(checked, `mobile=${mobile}`).toEqual([]);
      el.remove();
    }
  });
});

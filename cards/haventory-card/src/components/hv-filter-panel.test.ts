import './hv-filter-panel';
import type { HVFilterPanel } from './hv-filter-panel';
import { defaultFilters } from '../store/store';
import type { DistinctValues, LocationTreeNode, StoreFilters } from '../store/types';

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

  it('is single-select and toggles off when picked again', async () => {
    const el = await mount();
    const seen = changes(el);
    (q(el, '[data-value="Hardware"]') as HTMLButtonElement).click();
    expect(seen).toEqual([{ category: 'Hardware' }]);

    el.filters = { ...el.filters, category: 'Hardware' };
    await el.updateComplete;
    (q(el, '[data-value="Hardware"]') as HTMLButtonElement).click();
    expect(seen[1]).toEqual({ category: null });
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
});

describe('hv-filter-panel: show only vs sort', () => {
  it('keeps low-stock-only and low-stock-first as separate controls', async () => {
    const el = await mount();
    const seen = changes(el);

    (q(el, '[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="filter-low-stock-first"]') as HTMLButtonElement).click();

    expect(seen).toEqual([{ lowStockOnly: true }, { lowStockFirst: true }]);
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
    const input = q(el, '[data-testid="filter-updated-after"]').querySelector(
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

    const treeEl = el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    (treeEl.shadowRoot?.querySelector('[data-testid="tree-select"][data-id="garage"]') as HTMLButtonElement).click();
    expect(seen[0]).toEqual({ locationId: 'garage' });

    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('hv-location-tree')).toBe(null);
  });

  it('names the picked location on the chip', async () => {
    const el = await mount(
      { locationId: 'shelf-a' },
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
});

describe('hv-filter-panel: footer and staging', () => {
  it('summarises how many filters are on and how many items match', async () => {
    const el = await mount({ category: 'Hardware', checkedOutOnly: true }, { total: 38, grandTotal: 250 });
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
    expect(staged[0].category).toBe('Hardware');
    expect(el.working.category).toBe('Hardware');
  });

  it('emits the whole draft on apply, and forgets it on reset', async () => {
    const el = await mount({}, { mobile: true });
    const applies: StoreFilters[] = [];
    el.addEventListener('apply', (e) => applies.push((e as CustomEvent).detail));

    (q(el, '[data-value="Tools"]') as HTMLButtonElement).click();
    await el.updateComplete;
    el.apply();
    expect(applies[0].category).toBe('Tools');

    (q(el, '[data-value="Tools"]') as HTMLButtonElement).click();
    await el.updateComplete;
    el.resetDraft();
    await el.updateComplete;
    expect(el.working.category).toBe(null);
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
});

describe('hv-filter-panel: changed since', () => {
  // Two bare date inputs side by side are indistinguishable: the only labels
  // used to be screen-reader-only, so a sighted user could not tell which one
  // filtered on updated and which on created.
  it('labels each date filter visibly, not only for screen readers', async () => {
    const el = await mount();
    const updated = q(el, '[data-testid="filter-updated-after"]');
    const created = q(el, '[data-testid="filter-created-after"]');

    const visibleText = (host: HTMLElement) =>
      [...host.querySelectorAll('span')]
        .filter((s) => !s.classList.contains('hv-sr-only'))
        .map((s) => s.textContent?.trim())
        .join(' ');

    expect(visibleText(updated)).toMatch(/updated/i);
    expect(visibleText(created)).toMatch(/created/i);
  });

  it('keeps the two date inputs wired to their own filter keys', async () => {
    const el = await mount();
    const seen = changes(el);

    const updatedInput = q(el, '[data-testid="filter-updated-after"] input') as HTMLInputElement;
    updatedInput.value = '2026-07-01';
    updatedInput.dispatchEvent(new Event('change'));

    const createdInput = q(el, '[data-testid="filter-created-after"] input') as HTMLInputElement;
    createdInput.value = '2026-06-01';
    createdInput.dispatchEvent(new Event('change'));

    expect(seen[0]).toMatchObject({ updatedAfter: '2026-07-01T00:00:00Z' });
    expect(seen[1]).toMatchObject({ createdAfter: '2026-06-01T00:00:00Z' });
  });
});

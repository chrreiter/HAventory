import { describe, it, expect, afterEach } from 'vitest';
import './hv-filter-chips';
import { chipsFor, clearedValueFor } from './hv-filter-chips';
import { defaultFilters } from '../store/store';
import type { Location, StoreFilters } from '../store/types';

type Chips = HTMLElement & {
  filters: StoreFilters;
  locations: Location[] | null;
  areas: { id: string; name: string }[];
  updateComplete?: Promise<unknown>;
};

function loc(id: string, name: string, displayPath: string, extra: Partial<Location> = {}): Location {
  return {
    id,
    name,
    parent_id: null,
    area_id: null,
    path: { id_path: [id], name_path: [name], display_path: displayPath, sort_key: displayPath.toLowerCase() },
    ...extra,
  };
}

/** A shelf inside a garage, where only the garage carries the area. */
const nested = (areaId: string | null): Location[] => [
  loc('garage', 'Garage', 'Garage', { area_id: areaId }),
  loc('shelf', 'Shelf A', 'Garage / Shelf A', { parent_id: 'garage' }),
];

async function mount(props: Partial<Chips>): Promise<Chips> {
  const el = document.createElement('hv-filter-chips') as Chips;
  Object.assign(el, props);
  document.body.appendChild(el);
  await customElements.whenDefined('hv-filter-chips');
  if (el.updateComplete) await el.updateComplete;
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

const chipKeys = (el: Chips) =>
  [...(el.shadowRoot?.querySelectorAll('[data-testid="filter-chip"]') ?? [])].map(
    (n) => (n as HTMLElement).dataset.key,
  );
const chipLabels = (el: Chips) =>
  [...(el.shadowRoot?.querySelectorAll('[data-testid="filter-chip"]') ?? [])].map((n) =>
    (n.textContent ?? '').trim(),
  );

describe('chipsFor', () => {
  it('produces nothing for an untouched filter set', () => {
    expect(chipsFor(defaultFilters())).toEqual([]);
  });

  it('names the location by its path, punctuated the way the rest of the card does', () => {
    const filters = { ...defaultFilters(), locationId: 'shelf', includeSubtree: false };
    const [chip] = chipsFor(filters, { locations: [loc('shelf', 'Shelf A', 'Garage / Shelf A')] });
    expect(chip.label).toBe('Garage › Shelf A');
  });

  it('marks a subtree scope on the location chip', () => {
    const filters = { ...defaultFilters(), locationId: 'shelf', includeSubtree: true };
    const [chip] = chipsFor(filters, { locations: [loc('shelf', 'Shelf A', 'Garage / Shelf A')] });
    expect(chip.label).toBe('Garage › Shelf A + sub');
  });

  it('falls back to a generic label when the location is not in the cache', () => {
    const filters = { ...defaultFilters(), locationId: 'gone', includeSubtree: false };
    expect(chipsFor(filters, { locations: [] })[0].label).toBe('Location');
  });

  it('names the area a location inherits from its tree, in the chip row own wording', () => {
    const filters = { ...defaultFilters(), locationId: 'shelf', includeSubtree: false };
    const [chip] = chipsFor(filters, {
      locations: nested('a1'),
      areas: [{ id: 'a1', name: 'Kitchen' }],
    });
    expect(chip.label).toBe('Area: Kitchen · Garage › Shelf A');
  });

  it('keeps the subtree marker last, behind the area and the path', () => {
    const filters = { ...defaultFilters(), locationId: 'shelf', includeSubtree: true };
    const [chip] = chipsFor(filters, {
      locations: nested('a1'),
      areas: [{ id: 'a1', name: 'Kitchen' }],
    });
    expect(chip.label).toBe('Area: Kitchen · Garage › Shelf A + sub');
  });

  it('leaves a location in no area labelled exactly as before', () => {
    const filters = { ...defaultFilters(), locationId: 'shelf', includeSubtree: false };
    expect(chipsFor(filters, { locations: nested(null), areas: [] })[0].label).toBe('Garage › Shelf A');
  });

  it('names an area the registry has dropped by its id, so the chip never reads as arealess', () => {
    const filters = { ...defaultFilters(), locationId: 'shelf', includeSubtree: false };
    expect(chipsFor(filters, { locations: nested('a-gone'), areas: [] })[0].label).toBe(
      'Area: a-gone · Garage › Shelf A',
    );
  });

  it('resolves an area name, falling back to its id', () => {
    const filters = { ...defaultFilters(), areaId: 'a1' };
    expect(chipsFor(filters, { areas: [{ id: 'a1', name: 'Kitchen' }] })[0].label).toBe('Area: Kitchen');
    expect(chipsFor(filters, { areas: [] })[0].label).toBe('Area: a1');
  });

  it('says which way multiple tags combine', () => {
    const any = { ...defaultFilters(), tags: ['a', 'b'], tagsMode: 'any' as const };
    const all = { ...defaultFilters(), tags: ['a', 'b'], tagsMode: 'all' as const };
    expect(chipsFor(any)[0].label).toBe('any of: a, b');
    expect(chipsFor(all)[0].label).toBe('all of: a, b');
  });

  it('keeps low-stock-only and low-stock-first as separate chips', () => {
    // One is a filter, the other an ordering hint — merging them would make the
    // ordering un-clearable on its own.
    const filters = { ...defaultFilters(), lowStockOnly: true, lowStockFirst: true };
    const keys = chipsFor(filters).map((c) => c.key);
    expect(keys).toContain('lowStockOnly');
    expect(keys).toContain('lowStockFirst');
  });

  it('tones the two warning filters differently from the rest', () => {
    const filters = { ...defaultFilters(), lowStockOnly: true, overdueOnly: true, checkedOutOnly: true };
    const byKey = Object.fromEntries(chipsFor(filters).map((c) => [c.key, c.tone]));
    expect(byKey).toMatchObject({ lowStockOnly: 'warning', overdueOnly: 'warning', checkedOutOnly: 'primary' });
  });

  // Pressing the app-bar pill sets a server-side filter; without a chip the
  // list would be narrowed with nothing on screen saying so, and no way back
  // except finding the pill again.
  it('shows the inspection filter as its own removable chip', () => {
    const chips = chipsFor({ ...defaultFilters(), inspectionDueOnly: true });
    expect(chips).toEqual([{ key: 'inspectionDueOnly', label: 'Inspection due', tone: 'warning' }]);
  });

  it('names the status filter, with the warning tone on the flagged values only', () => {
    expect(chipsFor({ ...defaultFilters(), status: 'missing' })).toEqual([
      { key: 'status', label: 'Status: Missing', tone: 'warning' },
    ]);
    expect(chipsFor({ ...defaultFilters(), status: 'needs_repair' })).toEqual([
      { key: 'status', label: 'Status: Needs repair', tone: 'warning' },
    ]);
    expect(chipsFor({ ...defaultFilters(), status: 'ok' })).toEqual([
      { key: 'status', label: 'Status: OK', tone: 'primary' },
    ]);
  });

  it('emits one chip per date bound so a range can be half-undone', () => {
    const filters = {
      ...defaultFilters(),
      updatedAfter: '2026-07-01T00:00:00Z',
      updatedBefore: '2026-07-31T00:00:00Z',
    };
    const keys = chipsFor(filters).map((c) => c.key);
    expect(keys).toEqual(['updatedAfter', 'updatedBefore']);
  });

  it('formats a date bound from the date half of the timestamp', () => {
    const filters = { ...defaultFilters(), createdAfter: '2026-07-31T13:45:12.000Z' };
    expect(chipsFor(filters)[0].label).toMatch(/^Created ≥ /);
    expect(chipsFor(filters)[0].label).not.toContain('13:45');
  });
});

describe('clearedValueFor', () => {
  it('clears a text filter to an empty string, not null', () => {
    expect(clearedValueFor('q')).toEqual({ q: '' });
  });

  it('clears tags to an empty array', () => {
    expect(clearedValueFor('tags')).toEqual({ tags: [] });
  });

  it('clears the nullable filters to null', () => {
    for (const key of ['areaId', 'locationId', 'status', 'category', 'updatedAfter', 'createdAfter', 'updatedBefore', 'createdBefore'] as const) {
      expect(clearedValueFor(key)).toEqual({ [key]: null });
    }
  });

  it('clears the boolean toggles to false', () => {
    for (const key of ['checkedOutOnly', 'orphansOnly', 'lowStockOnly', 'lowStockFirst', 'overdueOnly', 'inspectionDueOnly'] as const) {
      expect(clearedValueFor(key)).toEqual({ [key]: false });
    }
  });
});

describe('hv-filter-chips', () => {
  it('renders nothing before it has a filter set', async () => {
    const el = await mount({});
    expect(el.shadowRoot?.querySelector('[data-testid="filter-chips"]')).toBeNull();
  });

  it('renders nothing when no filter is active', async () => {
    const el = await mount({ filters: defaultFilters() });
    expect(el.shadowRoot?.querySelector('[data-testid="filter-chips"]')).toBeNull();
  });

  it('draws one chip per active filter plus a clear-all', async () => {
    const el = await mount({
      filters: { ...defaultFilters(), q: 'drill', category: 'Hardware', overdueOnly: true },
    });
    expect(chipKeys(el)).toEqual(['q', 'category', 'overdueOnly']);
    expect(chipLabels(el)[0]).toContain('"drill"');
    expect(el.shadowRoot?.querySelector('[data-testid="filter-chips-clear"]')).not.toBeNull();
  });

  it('hands the host the patch that clears the chip it was given', async () => {
    const el = await mount({ filters: { ...defaultFilters(), category: 'Hardware' } });
    let detail: { key: string; patch: Partial<StoreFilters> } | null = null;
    el.addEventListener('remove-filter', (e) => {
      detail = (e as CustomEvent).detail;
    });

    (el.shadowRoot?.querySelector('[data-testid="filter-chip"]') as HTMLButtonElement).click();

    expect(detail).toEqual({ key: 'category', patch: { category: null } });
  });

  it('asks the host to clear everything', async () => {
    const el = await mount({ filters: { ...defaultFilters(), q: 'x' } });
    let fired = 0;
    el.addEventListener('clear-filters', () => { fired += 1; });

    (el.shadowRoot?.querySelector('[data-testid="filter-chips-clear"]') as HTMLButtonElement).click();

    expect(fired).toBe(1);
  });

  it('gives every chip an accessible name saying what it clears', async () => {
    const el = await mount({ filters: { ...defaultFilters(), overdueOnly: true } });
    const chip = el.shadowRoot?.querySelector('[data-testid="filter-chip"]') as HTMLElement;
    expect(chip.getAttribute('aria-label')).toBe('Clear filter Overdue');
  });
});

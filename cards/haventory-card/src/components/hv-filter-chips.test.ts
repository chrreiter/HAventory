import { describe, it, expect, afterEach } from 'vitest';
import './hv-filter-chips';
import { chipsFor, clearedValueFor } from './hv-filter-chips';
import { defaultFilters } from '../store/store';
import type { Location, StatusDefinition, StoreFilters } from '../store/types';

type Chips = HTMLElement & {
  filters: StoreFilters;
  locations: Location[] | null;
  statuses: StatusDefinition[] | null;
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

  // Browsing a root named after its own room wrote the room twice on one chip:
  // "Area: Garage · Garage › Shelf A + sub". The area drops out when the path
  // has already said it, the way the chip beside a path does.
  it('drops the area from the chip when the path opens with that name', () => {
    for (const [subtree, label] of [
      [false, 'Garage › Shelf A'],
      [true, 'Garage › Shelf A + sub'],
    ] as const) {
      const filters = { ...defaultFilters(), locationId: 'shelf', includeSubtree: subtree };
      const [chip] = chipsFor(filters, { locations: nested('a1'), areas: [{ id: 'a1', name: 'Garage' }] });
      expect(chip.label, `subtree=${subtree}`).toBe(label);
    }
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
    expect(chipsFor(any)[0].label).toBe('any of: #a, #b');
    expect(chipsFor(all)[0].label).toBe('all of: #a, #b');
  });

  // Nothing above this row says which filter a chip clears, so a bare value
  // could be the category, the location or the search box. Every facet that
  // would otherwise print one names itself.
  it('names the facet on a chip that would otherwise be a bare value', () => {
    const filters = { ...defaultFilters(), category: 'Hardware', tags: ['metric'] };
    expect(chipsFor(filters).map((c) => c.label)).toEqual(['Category: Hardware', 'any of: #metric']);
  });

  // The mark is the same one the tag chips wear, so the two surfaces read as
  // one vocabulary rather than two spellings of it.
  it('marks a single tag the way a tag chip is marked', () => {
    const filters = { ...defaultFilters(), tags: ['metric'] };
    expect(chipsFor(filters)[0].label).toBe('any of: #metric');
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

  // Amber means "chore" everywhere else on the card, so painting every
  // non-default status with it said something about the household's vocabulary
  // that the household never said.
  it('names the status filter and carries the status own tone, not the chore hue', () => {
    expect(chipsFor({ ...defaultFilters(), status: 'missing' })).toEqual([
      {
        key: 'status',
        label: 'Status: Missing',
        tone: 'primary',
        toneClass: 'tone-amber',
        toneStyle: undefined,
      },
    ]);
    expect(chipsFor({ ...defaultFilters(), status: 'ok' })).toEqual([
      {
        key: 'status',
        label: 'Status: OK',
        tone: 'primary',
        toneClass: 'tone-green',
        toneStyle: undefined,
      },
    ]);
  });

  it('takes the tone from the household definitions when they have answered', () => {
    const statuses: StatusDefinition[] = [
      { slug: 'sold', label: 'Verkauft', order: 3, color: 'blue_strong', icon: 'box' },
    ];
    expect(chipsFor({ ...defaultFilters(), status: 'sold' }, { statuses })).toEqual([
      {
        key: 'status',
        label: 'Status: Verkauft',
        tone: 'primary',
        toneClass: 'tone-blue-strong',
        toneStyle: undefined,
      },
    ]);
  });

  // A colour outside the ten reaches the chip as the fill itself; the class is
  // empty, so nothing resolves against the theme for this one chip.
  it('carries a literal colour as an inline declaration instead of a tone', () => {
    const statuses: StatusDefinition[] = [
      { slug: 'sold', label: 'Verkauft', order: 3, color: '#2f6f4f', icon: 'box' },
    ];
    expect(chipsFor({ ...defaultFilters(), status: 'sold' }, { statuses })[0]).toMatchObject({
      toneClass: '',
      toneStyle: '--hv-status-bg:#2f6f4f;--hv-status-fg:#ffffff',
    });
  });

  // A slug this card has not been told about — an import defined it, or another
  // client created it since `haventory/config` was last read.
  it('falls back to the neutral tone for a status it has no definition for', () => {
    expect(chipsFor({ ...defaultFilters(), status: 'no_such' })[0]).toMatchObject({
      label: 'Status: no_such',
      toneClass: 'tone-neutral',
    });
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

  // The status chip is the one on this row whose colour is the household's, so
  // it is drawn as the same status chip the rows below carry rather than out of
  // the fixed primary/warning pair every other applied filter uses.
  it('draws the status chip in the status vocabulary and the rest in the fixed one', async () => {
    const el = await mount({
      filters: { ...defaultFilters(), status: 'sold', overdueOnly: true },
      statuses: [{ slug: 'sold', label: 'Verkauft', order: 3, color: 'green_strong', icon: 'box' }],
    });
    const chips = [...(el.shadowRoot?.querySelectorAll('[data-testid="filter-chip"]') ?? [])];
    const status = chips.find((c) => (c as HTMLElement).dataset.key === 'status') as HTMLElement;
    const overdue = chips.find((c) => (c as HTMLElement).dataset.key === 'overdueOnly') as HTMLElement;

    expect([...status.classList]).toEqual(['hv-status-chip', 'chip', 'tone-green-strong']);
    expect(status.classList.contains('warning')).toBe(false);
    expect([...overdue.classList]).toEqual(['hv-chip', 'chip', 'warning']);
  });

  it('paints a status filter chip in a household literal colour', async () => {
    const el = await mount({
      filters: { ...defaultFilters(), status: 'sold' },
      statuses: [{ slug: 'sold', label: 'Verkauft', order: 3, color: '#2f6f4f', icon: 'box' }],
    });
    const status = el.shadowRoot?.querySelector(
      '[data-testid="filter-chip"][data-key="status"]',
    ) as HTMLElement;

    // Still the status chip rather than the fixed vocabulary — the colour just
    // arrives by the other route.
    expect(status.classList.contains('hv-status-chip')).toBe(true);
    expect(status.style.getPropertyValue('--hv-status-bg')).toBe('#2f6f4f');
    expect(status.style.getPropertyValue('--hv-status-fg')).toBe('#ffffff');
  });

  it('still hands the host the patch that clears a status chip', async () => {
    const el = await mount({ filters: { ...defaultFilters(), status: 'missing' } });
    let detail: { key: string; patch: Partial<StoreFilters> } | null = null;
    el.addEventListener('remove-filter', (e) => {
      detail = (e as CustomEvent).detail;
    });

    (el.shadowRoot?.querySelector('[data-testid="filter-chip"]') as HTMLButtonElement).click();

    expect(detail).toEqual({ key: 'status', patch: { status: null } });
  });

  it('gives every chip an accessible name saying what it clears', async () => {
    const el = await mount({ filters: { ...defaultFilters(), overdueOnly: true } });
    const chip = el.shadowRoot?.querySelector('[data-testid="filter-chip"]') as HTMLElement;
    expect(chip.getAttribute('aria-label')).toBe('Clear filter Overdue');
  });
});

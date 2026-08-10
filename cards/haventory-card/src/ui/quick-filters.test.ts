import { describe, it, expect } from 'vitest';
import { QUICK_FILTER_KEYS, normalizeQuickFilters, quickFilterAllowed } from './quick-filters';

describe('normalizeQuickFilters', () => {
  it('reads an omitted key as "no choice made"', () => {
    expect(normalizeQuickFilters(undefined)).toBe(null);
    expect(normalizeQuickFilters(null)).toBe(null);
  });

  // A dashboard must not break on a value this card does not understand — the
  // same philosophy setConfig already applies to every other key.
  it('reads garbage as "no choice made" rather than throwing', () => {
    expect(normalizeQuickFilters('low_stock')).toBe(null);
    expect(normalizeQuickFilters(42)).toBe(null);
    expect(normalizeQuickFilters({ low_stock: true })).toBe(null);
  });

  it('keeps the known names, in the order given, deduped', () => {
    expect(normalizeQuickFilters(['overdue', 'total', 'overdue'])).toEqual(['overdue', 'total']);
  });

  it('drops unknown entries without dropping the list', () => {
    expect(normalizeQuickFilters(['low_stock', 'bogus', 7, null])).toEqual(['low_stock']);
  });

  // An empty list is a choice — "offer none" — and is not the same as omitting
  // the key, which offers all.
  it('honours an explicit empty list', () => {
    expect(normalizeQuickFilters([])).toEqual([]);
  });

  it('accepts every name it documents', () => {
    expect(normalizeQuickFilters([...QUICK_FILTER_KEYS])).toEqual([...QUICK_FILTER_KEYS]);
  });
});

describe('quickFilterAllowed', () => {
  it('allows everything when nothing was configured', () => {
    for (const key of QUICK_FILTER_KEYS) expect(quickFilterAllowed(null, key)).toBe(true);
  });

  it('allows only what the list names', () => {
    expect(quickFilterAllowed(['low_stock'], 'low_stock')).toBe(true);
    expect(quickFilterAllowed(['low_stock'], 'overdue')).toBe(false);
    expect(quickFilterAllowed([], 'total')).toBe(false);
  });
});

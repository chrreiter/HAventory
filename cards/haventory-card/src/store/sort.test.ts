import { DEFAULT_SORT, getDefaultOrderFor } from './sort';
import type { SortField } from './types';

// Every surface that lets you choose a sort field — the filter panel's select
// and the full-view table's column headers — opens that field on the direction
// this table names. It used to be asserted only through the POC search bar.
describe('getDefaultOrderFor', () => {
  it('opens a name or a count smallest-first, so A and 0 lead', () => {
    expect(getDefaultOrderFor('name')).toBe('asc');
    expect(getDefaultOrderFor('quantity')).toBe('asc');
    // A path is text too, and reading a location-ordered list top-down is what
    // sorting by it is for.
    expect(getDefaultOrderFor('location')).toBe('asc');
  });

  it('opens a deadline soonest-first, because the urgent end is what you came for', () => {
    expect(getDefaultOrderFor('due_date')).toBe('asc');
    expect(getDefaultOrderFor('inspection_date')).toBe('asc');
  });

  it('opens a timestamp newest-first', () => {
    expect(getDefaultOrderFor('updated_at')).toBe('desc');
    expect(getDefaultOrderFor('created_at')).toBe('desc');
  });

  it('answers for every field the backend can sort by', () => {
    const fields: SortField[] = [
      'updated_at',
      'created_at',
      'name',
      'quantity',
      'due_date',
      'inspection_date',
      'location',
    ];
    for (const field of fields) {
      expect(['asc', 'desc'], field).toContain(getDefaultOrderFor(field));
    }
  });
});

describe('DEFAULT_SORT', () => {
  it('lands on most-recently-updated first', () => {
    expect(DEFAULT_SORT).toEqual({ field: 'updated_at', order: 'desc' });
  });
});

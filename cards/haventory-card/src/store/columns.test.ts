import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLUMN_DEFS,
  COLUMN_PREFS_STORAGE_KEY,
  DEFAULT_COLUMNS,
  loadColumnPrefs,
  normalizeColumns,
  saveColumnPrefs,
  tableTemplateFor,
} from './columns';

describe('columns model', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('normalizes to canonical order, dedupes, and drops unknown keys', () => {
    expect(normalizeColumns(['location', 'quantity', 'quantity', 'bogus', 'tags']))
      .toEqual(['quantity', 'location', 'tags']);
    expect(normalizeColumns('nope')).toEqual([]);
    expect(normalizeColumns(undefined)).toEqual([]);
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMNS);
  });

  // A fresh browser shows the whole record; thinning it down is the picker's job.
  it('defaults to every column', () => {
    expect(DEFAULT_COLUMNS).toEqual(COLUMN_DEFS.map((c) => c.key));
  });

  it('round-trips a saved selection (normalized)', () => {
    saveColumnPrefs(['tags', 'due_date', 'quantity']);
    expect(loadColumnPrefs()).toEqual(['quantity', 'tags', 'due_date']);
  });

  it('falls back to defaults on corrupt stored JSON', () => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, '{not valid json');
    expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMNS);
  });

  it('sanitizes unknown keys out of a stored selection', () => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ expanded: ['bogus', 'tags'] }));
    expect(loadColumnPrefs()).toEqual(['tags']);
  });

  // Preferences written by the POC card carried a `standard` set beside this
  // one. Nothing renders it now, so it is read straight past rather than
  // migrated — the selection that survives still comes back intact.
  it('reads a selection stored alongside the retired standard set', () => {
    localStorage.setItem(
      COLUMN_PREFS_STORAGE_KEY,
      JSON.stringify({ standard: ['quantity'], expanded: ['category', 'updated_at'] }),
    );
    expect(loadColumnPrefs()).toEqual(['category', 'updated_at']);
  });

  it('falls back when the stored object names no selection at all', () => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ standard: ['quantity'] }));
    expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMNS);
  });

  // The API cannot order by status, so the header must stay inert rather than
  // look clickable — the same reason category, location and tags have none.
  it('offers the status column without a sort field', () => {
    const col = COLUMN_DEFS.find((c) => c.key === 'status');
    expect(col?.label).toBe('Status');
    expect(col?.sortField).toBeUndefined();
    expect(normalizeColumns(['status'])).toEqual(['status']);
  });

  // Status sits beside Qty: both describe the item itself, ahead of where it is
  // filed and when it is due.
  it('orders status second, right after quantity', () => {
    expect(COLUMN_DEFS.map((c) => c.key).slice(0, 3)).toEqual(['quantity', 'status', 'category']);
  });

  // "Inspected" read as the date of the last inspection; the field holds the
  // next one due, which is what every other surface now says.
  it('labels the inspection column for the date it holds', () => {
    const col = COLUMN_DEFS.find((c) => c.key === 'inspection_date');
    expect(col?.label).toBe('Next inspection');
    expect(col?.sortField).toBe('inspection_date');
  });
});

/**
 * Sum the smallest width each track can take: the first argument of a
 * `minmax()`, or the whole track when it is a fixed pixel size. A grid cannot
 * lay out narrower than this, and below it the tracks overflow the container
 * instead of shrinking — which is why `hv-data-table` has to scroll sideways.
 */
function minWidthOf(template: string): number {
  return template
    .split(/\s+(?![^(]*\))/)
    .map((track) => Number(/^minmax\((\d+)px,/.exec(track)?.[1] ?? /^(\d+)px$/.exec(track)?.[1] ?? 0))
    .reduce((a, b) => a + b, 0);
}

describe('table column widths', () => {
  // Pinned as a number so that adding a column, or widening one, shows up here
  // as a deliberate change rather than as another phone-width overflow.
  it('cannot lay the default table out narrower than a phone', () => {
    expect(minWidthOf(tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false }))).toBe(1132);
    expect(minWidthOf(tableTemplateFor([...DEFAULT_COLUMNS], { selectable: true }))).toBe(1172);
  });

  it('only fits a phone when almost every column is turned off', () => {
    // Name (180) + Qty (70) + the actions gutter (110). That clears 375px with
    // 15px to spare and still overflows a 320px screen — so trimming columns
    // was never a reliable answer, and it would have discarded a choice the
    // user made. The table scrolls sideways instead.
    expect(minWidthOf(tableTemplateFor(['quantity'], { selectable: false }))).toBe(360);
  });
});

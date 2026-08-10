import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLUMN_DEFS,
  COLUMN_PREFS_STORAGE_KEY,
  DEFAULT_COLUMNS,
  SELECT_COLUMN_WIDTH,
  canonicalOrder,
  loadColumnPrefs,
  moveColumn,
  normalizeColumns,
  saveColumnPrefs,
  tableTemplateFor,
} from './columns';
import type { ColumnKey } from './columns';

describe('columns model', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The order is the user's: the picker moves a column and stores where it
  // landed, so normalizing can only validate and dedupe, never re-sort.
  it('keeps the given order, dedupes, and drops unknown keys', () => {
    expect(normalizeColumns(['location', 'quantity', 'quantity', 'bogus', 'tags']))
      .toEqual(['location', 'quantity', 'tags']);
    expect(normalizeColumns('nope')).toEqual([]);
    expect(normalizeColumns(undefined)).toEqual([]);
  });

  it('restores the canonical order on request, keeping only the chosen columns', () => {
    expect(canonicalOrder(['tags', 'quantity', 'location'])).toEqual(['quantity', 'location', 'tags']);
    expect(canonicalOrder(['tags', 'bogus' as ColumnKey])).toEqual(['tags']);
  });

  describe('moveColumn', () => {
    it('swaps a column with its neighbour', () => {
      expect(moveColumn(['quantity', 'status', 'tags'], 'status', -1)).toEqual([
        'status',
        'quantity',
        'tags',
      ]);
      expect(moveColumn(['quantity', 'status', 'tags'], 'status', 1)).toEqual([
        'quantity',
        'tags',
        'status',
      ]);
    });

    it('refuses to move past either end, or to move a column that is off', () => {
      expect(moveColumn(['quantity', 'status'], 'quantity', -1)).toEqual(['quantity', 'status']);
      expect(moveColumn(['quantity', 'status'], 'status', 1)).toEqual(['quantity', 'status']);
      expect(moveColumn(['quantity', 'status'], 'tags', -1)).toEqual(['quantity', 'status']);
    });
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMNS);
  });

  // A fresh browser shows the whole record; thinning it down is the picker's job.
  it('defaults to every column', () => {
    expect(DEFAULT_COLUMNS).toEqual(COLUMN_DEFS.map((c) => c.key));
  });

  it('round-trips a saved order', () => {
    saveColumnPrefs(['tags', 'due_date', 'quantity']);
    expect(loadColumnPrefs()).toEqual(['tags', 'due_date', 'quantity']);
  });

  // Selections written before ordering existed were already canonical, so they
  // load as the same table they described.
  it('reads a selection stored before ordering existed unchanged', () => {
    localStorage.setItem(
      COLUMN_PREFS_STORAGE_KEY,
      JSON.stringify({ expanded: ['quantity', 'category', 'updated_at'] }),
    );
    expect(loadColumnPrefs()).toEqual(['quantity', 'category', 'updated_at']);
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

/** The growth factor of a track: the `fr` in a `minmax()`, or 0 for a fixed one. */
function growthOf(template: string, index: number): number {
  const track = template.split(/\s+(?![^(]*\))/)[index];
  return Number(/,\s*([\d.]+)fr\)$/.exec(track)?.[1] ?? 0);
}

describe('table column widths', () => {
  // Pinned as a number so that adding a column, or widening one, shows up here
  // as a deliberate change rather than as another phone-width overflow.
  it('cannot lay the default table out narrower than a phone', () => {
    expect(minWidthOf(tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false }))).toBe(1178);
    expect(minWidthOf(tableTemplateFor([...DEFAULT_COLUMNS], { selectable: true }))).toBe(1218);
  });

  it('only fits a phone when almost every column is turned off', () => {
    // Name (220) + Qty (70) + the actions gutter (140). That overflows a 375px
    // screen on its own — so trimming columns was never a reliable answer, and
    // it would have discarded a choice the user made. The table scrolls
    // sideways instead, and pins the name column while it does.
    expect(minWidthOf(tableTemplateFor(['quantity'], { selectable: false }))).toBe(430);
  });

  // With every column on, the flexible tracks all sit at their floor and the
  // name loses to a column of tags: the audit frame read "Kärc…" beside two
  // full tag chips. The name also carries the inline Low and Checked-out chips,
  // which take their width before it gets any.
  it('floors the name column above every flexible column beside it', () => {
    const template = tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false });
    const tracks = template.split(/\s+(?![^(]*\))/);
    const nameMin = Number(/^minmax\((\d+)px,/.exec(tracks[0])![1]);
    const flexible = tracks
      .slice(1)
      .map((t) => Number(/^minmax\((\d+)px,/.exec(t)?.[1] ?? 0))
      .filter((min) => min > 0);

    expect(flexible.length).toBe(3);
    for (const min of flexible) expect(nameMin).toBeGreaterThan(min);
  });

  // Free width goes to the name first: a row identified by its tags and not by
  // its name cannot be scanned.
  it('grows the name column faster than the tags column', () => {
    const template = tableTemplateFor(['category', 'location', 'tags'], { selectable: false });
    // 0 is the name; the tags track is the last flexible one before the gutter.
    expect(growthOf(template, 0)).toBeGreaterThan(growthOf(template, 3));
    expect(growthOf(template, 3)).toBe(1);
  });

  // The pinned name cell offsets itself by the checkbox track, and an offset
  // that disagreed with the template would sit over the checkboxes or short of
  // them.
  it('leads a selectable table with the track the sticky offset is built from', () => {
    expect(tableTemplateFor([], { selectable: true }).startsWith(`${SELECT_COLUMN_WIDTH} `)).toBe(
      true,
    );
    expect(tableTemplateFor([], { selectable: false }).startsWith('minmax(')).toBe(true);
  });
});

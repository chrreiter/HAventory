import { describe, it, expect, beforeEach } from 'vitest';
import { setLanguage } from '../i18n';
import {
  COLUMN_DEFS,
  columnLabel,
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
import { ROW_THUMB_SIZE } from '../ui/media';

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
  // Reminder is the one column that starts off: the panel's grid at 1920 is
  // already spent, and one more fixed track puts Location and Tags on their
  // floors. Every other column is on, which is what makes them discoverable.
  it('defaults to every column but Reminder', () => {
    expect(DEFAULT_COLUMNS).toEqual(
      COLUMN_DEFS.map((c) => c.key).filter((key) => key !== 'reminder_date'),
    );
    expect(DEFAULT_COLUMNS).not.toContain('reminder_date');
  });

  // Off by default is not absent: the picker still offers it, or there would be
  // no way to switch it on.
  it('still offers Reminder as a column that can be chosen', () => {
    expect(COLUMN_DEFS.map((c) => c.key)).toContain('reminder_date');
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
  // look clickable — the same reason category and tags have none.
  it('offers the status column without a sort field', () => {
    const col = COLUMN_DEFS.find((c) => c.key === 'status');
    expect(columnLabel('status')).toBe('Status');
    expect(col?.sortField).toBeUndefined();
    expect(normalizeColumns(['status'])).toEqual(['status']);
  });

  // The backend orders on the item's own denormalized location path, so this is
  // the one of the three that can carry a sort control.
  it('gives the location column the sort field the backend answers to', () => {
    const col = COLUMN_DEFS.find((c) => c.key === 'location');
    expect(columnLabel('location')).toBe('Location');
    expect(col?.sortField).toBe('location');
    // Category and tags still have none: nothing on the item sorts them.
    for (const key of ['category', 'tags'] as const) {
      expect(COLUMN_DEFS.find((c) => c.key === key)?.sortField).toBeUndefined();
    }
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
    expect(columnLabel('inspection_date')).toBe('Next inspection');
    expect(col?.sortField).toBe('inspection_date');
  });

  // The label is the one thing about a column that is not the same in every
  // language, which is why it is a lookup rather than a field on the record.
  it('names every column in the language in force', () => {
    setLanguage('de');
    expect(COLUMN_DEFS.map((c) => columnLabel(c.key))).toEqual([
      'Menge',
      'Status',
      'Kategorie',
      'Ort',
      'Labels',
      'Fällig',
      'Nächste Prüfung',
      'Erinnerung',
      'Geändert',
    ]);
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

/**
 * The widths a grid would give these tracks inside a content box of
 * `contentWidth`, so the distribution can be asserted as pixels rather than as
 * a set of `fr` numbers whose outcome nobody can read off the template.
 *
 * jsdom lays nothing out, so this is the sizing algorithm itself: the leftover
 * space after the fixed tracks and the gaps is shared out in proportion to the
 * flex factors, and a flexible track whose share comes out under its floor is
 * frozen at the floor and the rest shared again without it. That freezing is
 * the whole mechanism here — it is why a growth factor alone says nothing about
 * who actually ends up with the surplus.
 *
 * A box narrower than the template's minimum returns the floors, which is the
 * overflow the table answers by scrolling sideways.
 */
function resolveTracks(template: string, contentWidth: number, gap = 8): number[] {
  const tracks = template.split(/\s+(?![^(]*\))/).map((t) => {
    const flexible = /^minmax\((\d+)px,\s*([\d.]+)fr\)$/.exec(t);
    return flexible
      ? { min: Number(flexible[1]), flex: Number(flexible[2]) }
      : { min: Number(/^(\d+)px$/.exec(t)![1]), flex: 0 };
  });
  const space = contentWidth - gap * (tracks.length - 1);
  const frozen = tracks.map((t) => t.flex === 0);
  for (;;) {
    const taken = tracks.reduce((sum, t, i) => sum + (frozen[i] ? t.min : 0), 0);
    const flexSum = tracks.reduce((sum, t, i) => sum + (frozen[i] ? 0 : t.flex), 0);
    if (flexSum === 0) return tracks.map((t) => t.min);
    const fr = (space - taken) / flexSum;
    const starved = tracks.findIndex((t, i) => !frozen[i] && t.min > t.flex * fr);
    if (starved < 0) return tracks.map((t, i) => (frozen[i] ? t.min : t.flex * fr));
    frozen[starved] = true;
  }
}

/** The resolved width of one column of the default table. */
function widthOf(contentWidth: number, key: ColumnKey): number {
  const columns = [...DEFAULT_COLUMNS];
  const widths = resolveTracks(
    tableTemplateFor(columns, { selectable: false }),
    contentWidth,
  );
  // 0 is the name; the chosen columns follow it in order, then the gutter.
  return widths[1 + columns.indexOf(key)];
}

/** The resolved width of the name column of the default table. */
function nameWidthOf(contentWidth: number): number {
  return resolveTracks(tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false }), contentWidth)[0];
}

/**
 * What the sidebar panel at 1920 leaves the table's grid, measured on a real
 * instance: HA's docked sidebar takes 256px and the full view's locations rail
 * another 264, which puts the table's box at 1400 and its content box — inside
 * the row's own 20px padding either side — here.
 */
const PANEL_GRID_AT_1920 = 1360;

/**
 * An ordinary name, in pixels. Measured in the row's own 13.5px/500 text: a
 * 32-character name draws 223px and a 28-character one 189px, so ~7px a
 * character, and the ~35 characters an ordinary household item needs come to
 * about this.
 */
const ORDINARY_NAME_WIDTH = 245;

describe('table column widths', () => {
  // Pinned as a number so that adding a column, or widening one, shows up here
  // as a deliberate change rather than as another phone-width overflow.
  it('cannot lay the default table out narrower than a phone', () => {
    expect(minWidthOf(tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false }))).toBe(1254);
    expect(minWidthOf(tableTemplateFor([...DEFAULT_COLUMNS], { selectable: true }))).toBe(1294);
  });

  it('only fits a phone when almost every column is turned off', () => {
    // Name (250) + Qty (70) + the actions gutter (140). That overflows a 375px
    // screen on its own — so trimming columns was never a reliable answer, and
    // it would have discarded a choice the user made. The table scrolls
    // sideways instead, and pins the name column while it does.
    expect(minWidthOf(tableTemplateFor(['quantity'], { selectable: false }))).toBe(460);
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

  // A name is one line of text with an end to it; a path and a tag set are not.
  // So the name is served first through the floors and stops there, and the
  // growth factors hand what is left to the two columns that can still use it.
  it('grows the wrapping columns at least as fast as the name', () => {
    const template = tableTemplateFor(['category', 'location', 'tags'], { selectable: false });
    // 0 is the name, then category, location and tags in order.
    expect(growthOf(template, 2)).toBeGreaterThanOrEqual(growthOf(template, 0));
    expect(growthOf(template, 3)).toBeGreaterThanOrEqual(growthOf(template, 0));
    expect(growthOf(template, 1)).toBeLessThan(growthOf(template, 2));
  });

  // The measurement behind this: at 1920 with all eight columns on and room to
  // spare, Location sat on a 110px floor showing an area mark and three letters
  // of a five-segment path, and Tags showed one chip of six cut in half — while
  // the name track, on 3fr against everyone else's 1fr, took the surplus it had
  // no use for. Pixels rather than fr numbers, because which track a factor
  // actually feeds depends on who freezes at their floor first.
  it('hands a wide table its surplus width to wrap paths and tags with', () => {
    // The sidebar panel at 1920, give or take the HA sidebar's own width.
    expect(widthOf(1560, 'location')).toBeGreaterThan(230);
    expect(widthOf(1560, 'tags')).toBeGreaterThan(230);
    // A five-segment path and a six-chip tag set have a use for every one of
    // those pixels; a name that is already whole does not.
    expect(widthOf(1560, 'location')).toBeGreaterThan(widthOf(1560, 'category'));
    expect(widthOf(1560, 'tags')).toBeGreaterThan(widthOf(1560, 'category'));
  });

  // The panel is where the full column set is actually read, and there the
  // fixed columns take enough that every flexible track sits on its floor —
  // the growth factors never get a say. So the name's floor is the whole
  // answer to whether a name ends or elides: at 220 a 32-character one needed
  // 223px and lost its last three characters to an ellipsis, beside a Due and
  // an Updated column holding nothing but "—".
  it('renders an ordinary name whole at the width the sidebar panel gets', () => {
    expect(nameWidthOf(PANEL_GRID_AT_1920)).toBeGreaterThanOrEqual(ORDINARY_NAME_WIDTH);
  });

  // The panel is also where the whole default set has to fit, and it does, with
  // room over — which is what keeps Location and Tags off their floors and the
  // table free of a sideways scroll at the width it is most often read at.
  //
  // That room is smaller than a row's leading thumbnail, which is why the name
  // column's floor is not widened to hold one: the picture comes out of the
  // name's own floor on the rows that have a picture, rather than out of every
  // row's Location and Tags. See NAME_COLUMN_SIZE.
  it('fits the whole default set inside the box the sidebar panel gives it', () => {
    const template = tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false });
    const gaps = 8 * (template.split(/\s+(?![^(]*\))/).length - 1);
    const slack = PANEL_GRID_AT_1920 - (minWidthOf(template) + gaps);
    expect(slack).toBeGreaterThan(0);
    expect(slack).toBeLessThan(ROW_THUMB_SIZE + 8);
  });

  // The name is fed from Category, the flexible column carrying one word, and
  // not from the two whose content has no natural end: at the same width they
  // stay above their floors, so a path still breaks between segments and a tag
  // set still wraps whole chips.
  it('leaves Location and Tags growing while the name takes its floor', () => {
    expect(widthOf(PANEL_GRID_AT_1920, 'location')).toBeGreaterThan(150);
    expect(widthOf(PANEL_GRID_AT_1920, 'tags')).toBeGreaterThan(150);
    expect(widthOf(PANEL_GRID_AT_1920, 'category')).toBeLessThan(
      widthOf(PANEL_GRID_AT_1920, 'location'),
    );
  });

  // Between the two the name is still served before either of them grows: it
  // reaches its floor while they are still on theirs.
  it('serves the name to its floor before the surplus moves on', () => {
    const tracks = resolveTracks(
      tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false }),
      1400,
    );
    expect(tracks[0]).toBeGreaterThanOrEqual(220);
    expect(widthOf(1400, 'location')).toBeGreaterThan(170);
    expect(widthOf(1400, 'tags')).toBeGreaterThan(170);
  });

  // Narrower than the template's own minimum every track sits on its floor and
  // the table scrolls sideways — the same answer as before, with Location and
  // Tags standing on floors that hold a segment and a chip rather than a stub
  // of one.
  it('puts every track on its floor once the table is scrolling', () => {
    const template = tableTemplateFor([...DEFAULT_COLUMNS], { selectable: false });
    const tracks = resolveTracks(template, 1016);
    expect(tracks).toEqual([250, 70, 112, 92, 140, 130, 100, 124, 96, 140]);
    expect(tracks.reduce((a, b) => a + b, 0)).toBe(minWidthOf(template));
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

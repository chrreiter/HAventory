import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLUMN_PREFS_STORAGE_KEY,
  DEFAULT_COLUMNS,
  loadColumnPrefs,
  normalizeColumns,
  saveColumnPrefs,
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
});

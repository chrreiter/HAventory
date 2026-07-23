import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLUMN_PREFS_STORAGE_KEY,
  DEFAULT_COLUMN_PREFS,
  gridTemplateFor,
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

  it('builds a grid template with name + columns + actions', () => {
    expect(gridTemplateFor(['quantity'], { compact: true }))
      .toBe('minmax(120px, 2fr) 50px 120px');
    expect(gridTemplateFor(['quantity', 'category', 'location'], { compact: false }))
      .toBe('minmax(120px, 2fr) 50px minmax(80px, 1fr) minmax(100px, 2fr) 160px');
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
  });

  it('round-trips saved preferences (normalized)', () => {
    saveColumnPrefs({ standard: ['category', 'quantity'], expanded: ['tags', 'due_date'] });
    expect(loadColumnPrefs()).toEqual({
      standard: ['quantity', 'category'],
      expanded: ['tags', 'due_date'],
    });
  });

  it('falls back to defaults on corrupt stored JSON', () => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, '{not valid json');
    expect(loadColumnPrefs()).toEqual(DEFAULT_COLUMN_PREFS);
  });

  it('fills a missing view from defaults and sanitizes unknown keys', () => {
    localStorage.setItem(
      COLUMN_PREFS_STORAGE_KEY,
      JSON.stringify({ standard: ['bogus', 'tags'] }),
    );
    const prefs = loadColumnPrefs();
    expect(prefs.standard).toEqual(['tags']);
    expect(prefs.expanded).toEqual(DEFAULT_COLUMN_PREFS.expanded);
  });
});

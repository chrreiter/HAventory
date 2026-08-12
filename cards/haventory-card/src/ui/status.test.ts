import { describe, expect, it } from 'vitest';
import { render } from 'lit';
import type { StatsCounts, StatusDefinition } from '../store/types';
import {
  BUILT_IN_STATUSES,
  DEFAULT_STATUS,
  isHexColor,
  itemStatus,
  knownIcon,
  renderStatusChip,
  slugFromLabel,
  statusCount,
  statusIconName,
  statusLabel,
  statusList,
  statusTone,
} from './status';

const CUSTOM: StatusDefinition[] = [
  { slug: 'ok', label: 'Fine', order: 0, color: 'green', icon: 'check' },
  { slug: 'lent_out', label: 'Lent out', order: 1, color: 'blue_strong', icon: 'hand' },
];

describe('ui/status: the vocabulary', () => {
  it('falls back to the built-ins until the backend has answered', () => {
    expect(statusList(null)).toBe(BUILT_IN_STATUSES);
    expect(statusList(undefined)).toBe(BUILT_IN_STATUSES);
    expect(statusList([])).toBe(BUILT_IN_STATUSES);
  });

  it('prefers the backend copy even for the built-in slugs', () => {
    // A household can rename "OK"; the local copy must not win over that.
    expect(statusLabel('ok', CUSTOM)).toBe('Fine');
  });

  it('reads an absent status as the default', () => {
    expect(itemStatus({ status: undefined })).toBe(DEFAULT_STATUS);
    expect(itemStatus({ status: 'lent_out' })).toBe('lent_out');
  });
});

describe('ui/status: rendering a slug', () => {
  it('labels a custom status from the definitions', () => {
    expect(statusLabel('lent_out', CUSTOM)).toBe('Lent out');
  });

  // Reachable today: an import can define a status, and another client can
  // create one after this card last read haventory/config.
  it('falls back to the slug for a status it has not been told about', () => {
    expect(statusLabel('mystery', CUSTOM)).toBe('mystery');
    expect(statusLabel('mystery', null)).toBe('mystery');
  });

  it('maps a stored colour onto the chip modifier, underscores and all', () => {
    expect(statusTone('lent_out', CUSTOM)).toEqual({
      toneClass: 'tone-blue-strong',
      toneStyle: undefined,
    });
    expect(statusTone('ok', CUSTOM)).toEqual({ toneClass: 'tone-green', toneStyle: undefined });
  });

  it('paints an unknown slug neutral rather than leaving it unstyled', () => {
    expect(statusTone('mystery', CUSTOM)).toEqual({
      toneClass: 'tone-neutral',
      toneStyle: undefined,
    });
  });

  // A household's own colour has no token to name, so it arrives as the fill
  // itself. The two paths are exclusive: a class would resolve against the
  // theme, which is exactly what a literal colour is asking not to do.
  it('hands a literal colour over as an inline declaration, not a class', () => {
    const hex: StatusDefinition[] = [
      { slug: 'lent_out', label: 'Lent out', order: 0, color: '#2f6f4f', icon: 'hand' },
    ];
    expect(statusTone('lent_out', hex)).toEqual({
      toneClass: '',
      toneStyle: '--hv-status-bg:#2f6f4f;--hv-status-fg:#ffffff',
    });
  });

  it('knows a literal colour from a token', () => {
    expect(isHexColor('#2f6f4f')).toBe(true);
    expect(isHexColor('#2F6F4F')).toBe(true);
    expect(isHexColor('amber_strong')).toBe(false);
    // Neither shorthand nor a named CSS colour: the backend accepts one
    // spelling, and anything else would be painted as a fill the browser
    // silently drops.
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('rebeccapurple')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it('resolves a glyph the bundle carries', () => {
    expect(statusIconName('lent_out', CUSTOM)).toBe('hand');
  });

  it('returns null for a glyph the bundle does not carry', () => {
    // The chip keeps its label and colour; only the mark is missing.
    const exotic: StatusDefinition[] = [
      { slug: 'x', label: 'X', order: 0, color: 'red', icon: 'not-a-glyph' },
    ];
    expect(statusIconName('x', exotic)).toBeNull();
    expect(statusIconName('mystery', CUSTOM)).toBeNull();
  });

  // The organize dialog's swatches paint the glyph being chosen, so they narrow
  // a stored name the same way a chip does rather than trusting it.
  it('narrows a bare icon name to one the bundle carries', () => {
    expect(knownIcon('hand')).toBe('hand');
    expect(knownIcon('not-a-glyph')).toBeNull();
    expect(knownIcon(undefined)).toBeNull();
    expect(knownIcon(null)).toBeNull();
  });
});

describe('ui/status: deriving a slug from a label', () => {
  it('strips accents rather than turning them into separators', () => {
    // NFKD splits the mark off the letter; without the strip the label would
    // slug to "caf_" and a household writing an automation would never guess it.
    expect(slugFromLabel('Café', CUSTOM)).toBe('cafe');
    expect(slugFromLabel('Zu verschenken', CUSTOM)).toBe('zu_verschenken');
    expect(slugFromLabel('Ausgeliehen — Nachbarn', CUSTOM)).toBe('ausgeliehen_nachbarn');
  });

  it('never mints an empty identifier', () => {
    expect(slugFromLabel('', CUSTOM)).toBe('status');
    expect(slugFromLabel('   ', CUSTOM)).toBe('status');
    expect(slugFromLabel('!!!', CUSTOM)).toBe('status');
  });

  it('caps the identifier at 64 characters', () => {
    expect(slugFromLabel('a'.repeat(80), CUSTOM)).toBe('a'.repeat(64));
  });

  it('walks the suffix past every slug already taken', () => {
    const taken: StatusDefinition[] = [
      ...CUSTOM,
      { slug: 'lent_out_2', label: 'Lent out (again)', order: 2, color: 'blue', icon: 'hand' },
    ];
    expect(slugFromLabel('Lent out', taken)).toBe('lent_out_3');
  });

  it('derives against the built-ins until the backend has answered', () => {
    expect(slugFromLabel('OK', null)).toBe('ok_2');
    expect(slugFromLabel('Lent out', null)).toBe('lent_out');
  });
});

describe('ui/status: pricing a slug', () => {
  const base: StatsCounts = {
    items_total: 998,
    low_stock_count: 0,
    checked_out_count: 0,
    locations_total: 0,
    no_location_count: 0,
  };

  it('reads the per-slug map, zeroes included', () => {
    const counts: StatsCounts = {
      ...base,
      missing_count: 3,
      needs_repair_count: 3,
      status_counts: { ok: 856, missing: 3, needs_repair: 3, lent_out: 100, in_transit: 0 },
    };
    expect(statusCount(counts, 'ok')).toBe(856);
    expect(statusCount(counts, 'lent_out')).toBe(100);
    // The one the old derivation reported as 998.
    expect(statusCount(counts, 'in_transit')).toBe(0);
  });

  // The map prices every defined slug, so a slug missing from one that arrived
  // is a status nothing defines — the vocabulary and the counts are a moment
  // out of step, and no number is honest where a zero would look measured.
  it('reports nothing for a slug the map that arrived does not carry', () => {
    const counts: StatsCounts = { ...base, status_counts: { ok: 998 } };
    expect(statusCount(counts, 'mystery')).toBeNull();
  });

  it('falls back to the legacy fields for exactly the two flagged built-ins', () => {
    const counts: StatsCounts = { ...base, missing_count: 3, needs_repair_count: 4 };
    expect(statusCount(counts, 'missing')).toBe(3);
    expect(statusCount(counts, 'needs_repair')).toBe(4);
    // Not derivable from the two halves that arrived, so it is not derived.
    expect(statusCount(counts, 'ok')).toBeNull();
    expect(statusCount(counts, 'lent_out')).toBeNull();
  });

  it('prices nothing when the payload carries neither shape', () => {
    expect(statusCount(base, 'ok')).toBeNull();
    expect(statusCount(base, 'missing')).toBeNull();
  });

  it('prices nothing before any counts have arrived', () => {
    expect(statusCount(null, 'ok')).toBeNull();
    expect(statusCount(undefined, 'missing')).toBeNull();
  });
});

describe('renderStatusChip', () => {
  function chipOf(slug: string, defs: StatusDefinition[] | null = CUSTOM) {
    const host = document.createElement('div');
    render(renderStatusChip(slug, defs), host);
    return host.querySelector('.hv-status-chip');
  }

  it('paints the tone from the definition and names the status', () => {
    const chip = chipOf('lent_out');
    expect(chip?.classList.contains('tone-blue-strong')).toBe(true);
    expect(chip?.getAttribute('style')).toBeNull();
    expect(chip?.textContent?.trim()).toBe('Lent out');
    expect(chip?.querySelector('svg')?.getAttribute('data-icon')).toBe('hand');
  });

  it('paints a literal colour inline, with the ink derived from it', () => {
    const chip = chipOf('lent_out', [
      { slug: 'lent_out', label: 'Lent out', order: 0, color: '#ffe082', icon: 'hand' },
    ]);
    const style = chip as HTMLElement | null;
    expect(style?.style.getPropertyValue('--hv-status-bg')).toBe('#ffe082');
    expect(style?.style.getPropertyValue('--hv-status-fg')).toBe('#000000');
    // No tone class to fight the inline declaration for the same two
    // properties.
    expect([...(chip?.classList ?? [])].filter((c) => c.startsWith('tone-'))).toEqual([]);
  });

  // A cell's own text-overflow cannot reach inside an inline-flex chip, so a
  // label longer than its column hard-cut mid-word. The wrapper is what the
  // shared rule in ui/chip.ts elides — and every surface that chips a status
  // gets it from here rather than restating it.
  it('wraps the label so it can elide inside a narrow cell', () => {
    const label = chipOf('lent_out')?.querySelector('.hv-chip-text');
    expect(label?.textContent).toBe('Lent out');
    // The glyph stays outside it: a chip that elided its own mark would be
    // eliding the half that costs nothing to keep.
    expect(label?.querySelector('svg')).toBe(null);
  });

  it('wraps a label it has no definition for just the same', () => {
    // An import can define a status this card has not been told about yet.
    expect(chipOf('mystery')?.querySelector('.hv-chip-text')?.textContent).toBe('mystery');
  });
});

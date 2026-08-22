import '../components/hv-data-table';
import '../components/hv-detail-sheet';
import '../components/hv-list-row';
import { componentCss } from '../test.utils';

/**
 * One tone for a date that has passed, wherever the card prints a bare one.
 *
 * The three surfaces each draw the same item — a table cell, a phone row's one
 * line, a fact in the detail sheet — and each used to pick its own colour, so
 * the same passed date read as red in one column and amber in the next. Beside
 * a word ("Overdue", "Inspection due") a second hue reinforces something the
 * text has already said; on a bare date it *is* the message, and a two-hue
 * vocabulary there claims a ranking of urgency the card never explains.
 *
 * Held here rather than in each component's own tests because the rule is that
 * the three agree: a check inside one file passes while the other two drift.
 */

/** A component's rules with comments dropped — they quote selectors and commas. */
function rulesOf(tag: string): string {
  return componentCss(tag).replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** The `color` of the rule whose selector list holds `selector`. */
function colorFor(tag: string, selector: string): string | null {
  for (const rule of rulesOf(tag).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1].split(',').some((s) => s.trim() === selector)) continue;
    const color = rule[2].match(/(?:^|;)\s*color:\s*([^;]+)/);
    if (color) return color[1].trim();
  }
  return null;
}

describe('a date that has passed reads the same on every surface', () => {
  const SURFACES: [tag: string, selector: string, what: string][] = [
    ['hv-data-table', '.cell.due.overdue', 'the table’s Due cell'],
    ['hv-data-table', '.cell.inspection.due', 'the table’s Next inspection cell'],
    ['hv-data-table', '.cell.reminder.due', 'the table’s Reminder cell'],
    ['hv-list-row', '.secondary.overdue', 'the compact row’s line'],
    ['hv-detail-sheet', '.fact .value.late', 'the detail sheet’s fact'],
  ];

  for (const [tag, selector, what] of SURFACES) {
    it(`paints ${what} in --hv-error`, () => {
      expect(colorFor(tag, selector), `${tag} ${selector}`).toBe('var(--hv-error)');
    });
  }

  // --hv-warn-deep is the ink for text laid on --hv-warn-bg — a banner, a chip,
  // the diagnostics panel. Two of these surfaces used it on their own plain
  // background, which is the drift only a light theme showed: #7a4d00 there
  // against #b26b00 in the table, for one and the same fact.
  it('leaves the on-tint amber to the fills that carry it', () => {
    for (const tag of ['hv-list-row', 'hv-detail-sheet']) {
      const dateRules = rulesOf(tag)
        .split('}')
        .filter((r) => /\.overdue|\.late/.test(r.split('{')[0] ?? ''));
      expect(dateRules.length, tag).toBeGreaterThan(0);
      expect(dateRules.join('}'), tag).not.toMatch(/--hv-warn-deep/);
    }
  });

  // A flagged status is the one thing on the phone row that is not a date, so
  // it keeps amber — the plain-surface one, not the on-tint ink.
  it('keeps a flagged status out of the vocabulary', () => {
    expect(colorFor('hv-list-row', '.secondary.flagged')).toBe('var(--hv-warn)');
  });
});

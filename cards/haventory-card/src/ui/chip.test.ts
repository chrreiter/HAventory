import { describe, expect, it } from 'vitest';
import type { CSSResult } from 'lit';
import { chip } from './chip';
import { base, tokens } from './tokens';

import '../components/hv-card-shell';
import '../components/hv-chip-input';
import '../components/hv-data-table';
import '../components/hv-detail-sheet';
import '../components/hv-filter-chips';
import '../components/hv-filter-panel';
import '../components/hv-full-view';
import '../components/hv-item-editor';
import '../components/hv-list-row';
import '../components/hv-location-tree';
import '../components/hv-organize-dialog';

/** Every surface that marks something with a chip. */
const CHIPPED = [
  'hv-card-shell',
  'hv-chip-input',
  'hv-data-table',
  'hv-detail-sheet',
  'hv-filter-chips',
  'hv-filter-panel',
  'hv-full-view',
  'hv-item-editor',
  'hv-list-row',
  'hv-location-tree',
  'hv-organize-dialog',
];

function sheetsOf(tag: string): CSSResult[] {
  const ctor = customElements.get(tag) as { styles?: CSSResult | CSSResult[] } | undefined;
  if (!ctor?.styles) throw new Error(`${tag} has no styles`);
  return Array.isArray(ctor.styles) ? ctor.styles : [ctor.styles];
}

/** A component's own block — the last fragment, after the shared ones. */
function ownCss(tag: string): string {
  const sheets = sheetsOf(tag);
  return String(sheets[sheets.length - 1].cssText).replace(/\s+/g, ' ');
}

describe('ui/chip: the shared fragment', () => {
  it('reaches every surface that draws a chip', () => {
    for (const tag of CHIPPED) {
      expect(sheetsOf(tag), tag).toContain(chip);
    }
  });

  it('takes its metrics from tokens, so a theme can move them in one place', () => {
    const css = String(chip.cssText).replace(/\s+/g, ' ');
    expect(css).toMatch(/font-size: var\(--hv-chip-font-size\)/);
    expect(css).toMatch(/padding: var\(--hv-chip-padding\)/);
    expect(css).toMatch(/border-radius: var\(--hv-radius-chip\)/);
    expect(String(tokens.cssText)).toMatch(/--hv-chip-font-size: [\d.]+px/);
    expect(String(tokens.cssText)).toMatch(/--hv-chip-padding: /);
  });

  it('carries the four fills the card marks things with, and a pressable variant', () => {
    const css = String(chip.cssText).replace(/\s+/g, ' ');
    expect(css).toMatch(/\.hv-chip\.state \{[^}]*var\(--hv-primary-tint\)/);
    expect(css).toMatch(/\.hv-chip\.warning \{[^}]*var\(--hv-warn-bg\)/);
    expect(css).toMatch(/\.hv-chip\.error \{[^}]*var\(--hv-error-bg\)/);
    // No fill of its own, so its label is read against the page — which is why
    // it takes the secondary ink and not the tertiary grey.
    expect(css).toMatch(
      /\.hv-chip\.quiet, \.hv-area-chip\.quiet \{[^}]*background: none[^}]*color: var\(--hv-text-secondary\)/,
    );
    expect(css).toMatch(/\.hv-chip\.toggle \{[^}]*cursor: pointer/);
  });

  // --hv-primary-darker on --hv-primary-tint measures 4.26:1, under the 4.5:1
  // a 12px label asks. Both fills that pair with that tint take the ink minted
  // for it; tone-contrast.test.ts checks the ratio the token resolves to.
  it('inks every tint-backed fill with the ink minted for that tint', () => {
    const css = String(chip.cssText).replace(/\s+/g, ' ');
    for (const selector of ['\\.hv-chip\\.state', '\\.hv-chip\\.toggle\\.on']) {
      expect(css, selector).toMatch(
        new RegExp(`${selector} \\{[^}]*background: var\\(--hv-primary-tint\\)[^}]*color: var\\(--hv-on-primary-tint\\)`),
      );
    }
    expect(css).not.toMatch(/--hv-primary-darker/);
  });

  // The whole point of the fragment: one size, not eleven. A component that
  // sets its own has a reason, and there are exactly two — see below.
  it('leaves no component restating the chip metrics it already provides', () => {
    for (const tag of CHIPPED) {
      const css = ownCss(tag);
      // Nothing re-rounds a chip or repaints the neutral fill locally.
      expect(css, tag).not.toMatch(/\.(low-badge|out-chip|status-chip|inspect-chip|value-chip)\b/);
    }
  });

  it('is overridden only where a chip must match something beside it', () => {
    // A form's values read at the size of the form's own fields...
    expect(ownCss('hv-filter-panel')).toMatch(/\.chip \{[^}]*font-size: 12\.5px/);
    // ...and a tree's band label at the size of the rows it heads.
    expect(ownCss('hv-location-tree')).toMatch(
      /\.area-name \.hv-area-chip, \.area-none \{ font-size: inherit/,
    );
    // Every other surface takes the shared size untouched.
    for (const tag of CHIPPED.filter((t) => t !== 'hv-filter-panel' && t !== 'hv-location-tree')) {
      expect(ownCss(tag), tag).not.toMatch(/\.(hv-)?chip[^{]*\{[^}]*font-size/);
    }
  });

  // `vertical-align` centres an inline box on the parent's x-height, which is
  // the middle of lowercase text and not the middle of the line — so a chip
  // beside a path sat ~1.4px low. Only a flex row centres the two exactly.
  it('centres a chip against the text it shares a line with', () => {
    const css = String(chip.cssText).replace(/\s+/g, ' ');
    expect(css).toMatch(/\.hv-chip-line \{[^}]*display: flex/);
    expect(css).toMatch(/\.hv-chip-line \{[^}]*align-items: center/);
  });

  it('puts every chip that heads a line of text on that row', () => {
    for (const tag of ['hv-data-table', 'hv-detail-sheet', 'hv-full-view', 'hv-list-row']) {
      expect(ownCss(tag), tag).toMatch(/\.hv-chip-line-text/);
    }
  });

  // text-overflow does nothing on a flex container, so a path left on the row
  // itself would hard-cut mid-character with no ellipsis to say so.
  it('moves the elision onto the text when the row becomes a flex box', () => {
    for (const tag of ['hv-data-table', 'hv-detail-sheet', 'hv-list-row']) {
      expect(ownCss(tag), tag).toMatch(
        /\.hv-chip-line-text \{[^}]*text-overflow: ellipsis[^}]*\}/,
      );
    }
  });

  // An area is marked one way wherever the card marks one, and that mark is not
  // one of the generic fills — it keeps its own glyph and its own class.
  it('shares the metrics with the area chip without folding it in', () => {
    const css = String(chip.cssText).replace(/\s+/g, ' ');
    expect(css).toMatch(/\.hv-chip, \.hv-area-chip, \.hv-status-chip \{/);
    expect(css).not.toMatch(/\.hv-area-chip\.(state|warning|error)/);
  });

  // A status carries a colour the household picked, so it must not reach for the
  // fills above — those mean something fixed, and a green "OK" beside an amber
  // "Low stock" would read as two points on one scale.
  it('keeps the status chip out of the semantic hue vocabulary', () => {
    const css = String(chip.cssText).replace(/\s+/g, ' ');
    expect(css).not.toMatch(/\.hv-status-chip\.(state|warning|error|quiet)/);
    for (const hue of ['neutral', 'green', 'blue', 'amber', 'red']) {
      expect(css, hue).toMatch(new RegExp(`\\.hv-status-chip\\.tone-${hue} \\{`));
      expect(css, hue).toMatch(new RegExp(`\\.hv-status-chip\\.tone-${hue}-strong \\{`));
    }
  });

  // A strong fill is one hue in both themes, so the ink that reads on it is
  // fixed too. A light-dark() pair there flips the ink while the fill stays put
  // — which is how white ends up on amber at 1.9:1.
  it('gives every strong tone a fill and an ink that do not follow the theme', () => {
    const css = String(tokens.cssText).replace(/\s+/g, ' ');
    for (const hue of ['neutral', 'green', 'blue', 'amber', 'red']) {
      for (const part of ['bg', 'fg']) {
        const declared = new RegExp(`--hv-tone-${hue}-strong-${part}: ([^;]+);`).exec(css);
        expect(declared, `${hue}-strong-${part}`).not.toBeNull();
        expect(declared?.[1], `${hue}-strong-${part}`).not.toMatch(/light-dark\(/);
      }
    }
  });
});

/**
 * The count beside a facet's name. Not a chip — it appears inside chips, on
 * sidebar rows and on checkbox rows alike — but it shares the chip fragment's
 * rule: one declaration, and no surface restating it in its own block.
 */
describe('ui/tokens: the shared tally', () => {
  it('declares the tally once, in the fragment every surface takes', () => {
    const css = String(base.cssText).replace(/\s+/g, ' ');
    expect(css).toMatch(/\.hv-tally \{[^}]*font-size: [\d.]+px/);
    // Dimmed against whatever ink surrounds it, so it survives a filled status
    // chip where a fixed grey would drop out of the household's own tone.
    expect(css).toMatch(/\.hv-tally \{[^}]*opacity: /);
    expect(css).not.toMatch(/\.hv-tally \{[^}]*color: /);
  });

  it('leaves the surfaces that price a facet restating nothing but position', () => {
    for (const tag of ['hv-filter-panel', 'hv-full-view']) {
      const css = ownCss(tag);
      // The old local rules, in the shapes that disagreed on size and dimming.
      expect(css, tag).not.toMatch(/\.chip \.tally\b/);
      expect(css, tag).not.toMatch(/\.value-row \.tally\b/);
      // A rule keyed on `.hv-tally` may only place it, never re-size or re-ink it.
      for (const [, body] of css.matchAll(/\.hv-tally[^{]*\{([^}]*)\}/g)) {
        expect(body, `${tag}: ${body}`).not.toMatch(/font-size|opacity|color/);
      }
    }
  });
});

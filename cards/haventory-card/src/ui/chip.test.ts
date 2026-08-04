import { describe, expect, it } from 'vitest';
import type { CSSResult } from 'lit';
import { chip } from './chip';
import { tokens } from './tokens';

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
    expect(css).toMatch(/\.hv-chip\.quiet, \.hv-area-chip\.quiet \{/);
    expect(css).toMatch(/\.hv-chip\.toggle \{[^}]*cursor: pointer/);
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

  // An area is marked one way wherever the card marks one, and that mark is not
  // one of the generic fills — it keeps its own glyph and its own class.
  it('shares the metrics with the area chip without folding it in', () => {
    const css = String(chip.cssText).replace(/\s+/g, ' ');
    expect(css).toMatch(/\.hv-chip, \.hv-area-chip \{/);
    expect(css).not.toMatch(/\.hv-area-chip\.(state|warning|error)/);
  });
});

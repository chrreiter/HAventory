import '../components/hv-card-shell';
import '../components/hv-confirm';
import '../components/hv-detail-sheet';
import '../components/hv-diagnostics-panel';
import '../components/hv-filter-chips';
import '../components/hv-filter-panel';
import '../components/hv-import-sheet';
import '../components/hv-location-tree';
import { base } from './tokens';
import type { CSSResult } from 'lit';

/**
 * One recipe per shape, across every surface that draws it.
 *
 * The dialog that commits had been hand-rolled in six components and the
 * "Clear all" text button in three, each a few pixels and a shade off its
 * siblings — two of the latter visible at once on a filtered card. These pins
 * are what stops the next dialog from adding a seventh: the shared rules live
 * in `base`, and a private copy of one is a regression, not a style.
 */

type StyledElement = { styles: CSSResult | CSSResult[] };

function cssOf(tag: string): string {
  const styles = (customElements.get(tag) as unknown as StyledElement).styles;
  return (Array.isArray(styles) ? styles : [styles])
    .map((s) => String(s.cssText))
    .join('\n')
    .replace(/\s+/g, ' ');
}

/** Each retired variant, by the selector it was written as. */
const RETIRED_PRIMARIES: [tag: string, selector: string][] = [
  ['hv-confirm', '.confirm {'],
  ['hv-import-sheet', '.primary {'],
  ['hv-diagnostics-panel', '.primary {'],
  ['hv-detail-sheet', '.actions .primary {'],
  ['hv-location-tree', '.create-submit {'],
];

const CLEAR_ALL_HOSTS = ['hv-card-shell', 'hv-filter-chips', 'hv-filter-panel'];

describe('shared button recipes', () => {
  it('declares the filled primary, its danger fill and its touch size once', () => {
    const css = String(base.cssText).replace(/\s+/g, ' ');
    expect(css).toMatch(/\.hv-pill \{[^}]*background: var\(--hv-primary\)/);
    expect(css).toMatch(/\.hv-pill\.danger \{[^}]*background: var\(--hv-error\)/);
    expect(css).toMatch(/\.hv-pill\.large \{[^}]*min-height: 48px/);
  });

  it.each(RETIRED_PRIMARIES)('%s no longer carries its own %s', (tag, selector) => {
    expect(cssOf(tag)).not.toContain(selector);
  });

  // The one that survives as a selector keeps its layout only: the sheet footer
  // stretches its committing action across the remaining width, and that is not
  // something the shared recipe can know.
  it('leaves the filter sheet footer nothing but the stretch', () => {
    expect(cssOf('hv-card-shell')).toContain('.sheet-footer .apply { flex: 1; }');
  });

  it.each(CLEAR_ALL_HOSTS)('%s draws Clear all with the shared text button', (tag) => {
    const css = cssOf(tag);
    expect(css).not.toMatch(/\.clear-all \{/);
    // The shell keeps a `.link` for the footer's way into the expanded view,
    // which is sized to a 12px footer rather than to a control row.
    if (tag !== 'hv-card-shell') expect(css).not.toMatch(/\.link \{/);
  });
});

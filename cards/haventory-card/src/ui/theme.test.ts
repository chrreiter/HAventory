import { css } from 'lit';
import { luminanceOf, schemeForSurface, resolveColorScheme } from './theme';
import { tokens } from './tokens';

describe('luminanceOf', () => {
  it('reads the rgb()/rgba() forms getComputedStyle returns', () => {
    expect(luminanceOf('rgb(255, 255, 255)')).toBeCloseTo(1, 3);
    expect(luminanceOf('rgb(0, 0, 0)')).toBeCloseTo(0, 3);
    expect(luminanceOf('rgba(28, 28, 28, 1)')).toBeLessThan(0.1);
  });

  it('reads 3- and 6-digit hex', () => {
    expect(luminanceOf('#fff')).toBeCloseTo(1, 3);
    expect(luminanceOf('#1c1c1c')).toBeLessThan(0.1);
    expect(luminanceOf('  #FFFFFF ')).toBeCloseTo(1, 3);
  });

  it('returns null for anything it cannot resolve', () => {
    // An unresolved var() is the common case: HA has not painted a theme yet.
    expect(luminanceOf('var(--card-background-color)')).toBeNull();
    expect(luminanceOf('')).toBeNull();
    expect(luminanceOf('transparent')).toBeNull();
    expect(luminanceOf('rgba(0, 0, 0, 0)')).toBeNull();
  });
});

describe('schemeForSurface', () => {
  it('classifies HA default light and dark card backgrounds', () => {
    expect(schemeForSurface('#ffffff')).toBe('light');
    expect(schemeForSurface('rgb(28, 28, 28)')).toBe('dark');
    expect(schemeForSurface('#111111')).toBe('dark');
  });

  it('classifies mid-tone third-party theme surfaces by luminance', () => {
    expect(schemeForSurface('rgb(38, 50, 56)')).toBe('dark'); // blue-grey 900
    expect(schemeForSurface('rgb(236, 239, 241)')).toBe('light'); // blue-grey 50
  });

  it('gives up rather than guessing when the colour is unusable', () => {
    expect(schemeForSurface('transparent')).toBeNull();
    expect(schemeForSurface('')).toBeNull();
  });
});

describe('resolveColorScheme', () => {
  const styleOf = (vars: Record<string, string>) =>
    ({ getPropertyValue: (n: string) => vars[n] ?? '' }) as CSSStyleDeclaration;

  it('reads the card background Home Assistant writes for the active theme', () => {
    expect(resolveColorScheme(styleOf({ '--card-background-color': '#1c1c1c' }))).toBe('dark');
    expect(resolveColorScheme(styleOf({ '--card-background-color': '#fff' }))).toBe('light');
  });

  it('falls back through the surface variables in order', () => {
    expect(resolveColorScheme(styleOf({ '--ha-card-background': 'rgb(28, 28, 28)' }))).toBe('dark');
    expect(resolveColorScheme(styleOf({ '--primary-background-color': '#fafafa' }))).toBe('light');
    // the most specific usable value wins
    expect(
      resolveColorScheme(
        styleOf({ '--card-background-color': '#fff', '--primary-background-color': '#111' }),
      ),
    ).toBe('light');
  });

  it('skips variables that are unset or transparent', () => {
    expect(
      resolveColorScheme(
        styleOf({ '--card-background-color': 'transparent', '--primary-background-color': '#111' }),
      ),
    ).toBe('dark');
  });

  it('returns null when no theme is readable, so the OS default stands', () => {
    expect(resolveColorScheme(styleOf({}))).toBeNull();
  });
});

describe('tokens', () => {
  // The regression this guards: dark values used to sit behind
  // @media (prefers-color-scheme: dark), which is the OS preference — not the
  // Home Assistant theme. A user on a light HA theme with a dark OS got dark
  // chips and near-black dividers on a white card.
  it('does not gate dark values on the OS colour-scheme preference', () => {
    expect(tokens.cssText).not.toContain('prefers-color-scheme');
  });

  it('expresses theme-dependent values with light-dark()', () => {
    expect(tokens.cssText).toContain('light-dark(');
  });

  it('still collapses motion under prefers-reduced-motion', () => {
    expect(tokens.cssText).toContain('prefers-reduced-motion');
  });

  it('is a plain style fragment that only declares custom properties', () => {
    expect(tokens).toBeInstanceOf(css``.constructor);
    // every declaration inside :host must be a custom property
    const hostBlock = tokens.cssText
      .slice(tokens.cssText.indexOf('{') + 1, tokens.cssText.indexOf('}'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const decls = hostBlock
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
    expect(decls.length).toBeGreaterThan(20);
    for (const decl of decls) {
      expect(decl.startsWith('--')).toBe(true);
    }
  });
});

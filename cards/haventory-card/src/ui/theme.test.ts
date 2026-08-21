import { luminanceOf, schemeForSurface, resolveColorScheme } from './theme';

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

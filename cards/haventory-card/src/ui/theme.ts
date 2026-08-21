/**
 * Deciding whether the card is painted on a light or a dark surface.
 *
 * Home Assistant's dark mode is a frontend setting, not an OS one: a user can
 * run a dark HA theme on a light desktop, or the reverse. Keying the card's
 * dark values off `prefers-color-scheme` therefore mixes the two palettes —
 * near-black dividers on a white card, pale-amber badges no one can read.
 *
 * There is no CSS variable that says "this theme is dark", so we read the
 * surface the card actually paints on and classify it. The answer is published
 * as `color-scheme` on the card host, which
 *   * `light-dark()` in `tokens` resolves against, and
 *   * the browser uses to paint native controls (select arrows, date pickers),
 *     which would otherwise stay light-on-dark.
 *
 * `color-scheme` is inherited, so setting it once on the outermost host reaches
 * every `hv-*` component without threading anything through them.
 */

import { SURFACE_VARS } from '../ha-contract';

/** Alpha below this reads as "nothing painted here" rather than a real colour. */
const MIN_OPAQUE_ALPHA = 0.1;

/** Surfaces at or below this relative luminance are treated as dark. */
const DARK_THRESHOLD = 0.4;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

function channelToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance (0 = black, 1 = white) of a CSS colour, or `null`
 * when the value is not a resolvable opaque colour — an unresolved `var()`, an
 * empty string, or anything fully transparent.
 */
export function luminanceOf(cssColor: string): number | null {
  const value = cssColor.trim();
  if (!value) return null;

  let r: number;
  let g: number;
  let b: number;

  if (HEX.test(value)) {
    const hex = value.slice(1);
    const wide = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    r = parseInt(wide.slice(0, 2), 16);
    g = parseInt(wide.slice(2, 4), 16);
    b = parseInt(wide.slice(4, 6), 16);
  } else {
    const m = RGB.exec(value);
    if (!m) return null;
    const alphaRaw = m[4];
    const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
    if (!Number.isFinite(alpha) || alpha < MIN_OPAQUE_ALPHA) return null;
    r = Number(m[1]);
    g = Number(m[2]);
    b = Number(m[3]);
  }

  if (![r, g, b].every((c) => Number.isFinite(c))) return null;
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** `'dark'` / `'light'` for a surface colour, or `null` when it is unusable. */
export function schemeForSurface(cssColor: string): 'light' | 'dark' | null {
  const lum = luminanceOf(cssColor);
  if (lum === null) return null;
  return lum <= DARK_THRESHOLD ? 'dark' : 'light';
}

/**
 * The theme variables that describe the surface the card sits on, most specific
 * first. These are the same ones `--hv-surface` binds to, and they are declared
 * with the rest of the card's Home Assistant contact surface in `ha-contract`.
 */
export { SURFACE_VARS };

/**
 * The scheme implied by an element's resolved theme variables, or `null` when
 * none of them carry a usable colour — in which case the caller should leave
 * `color-scheme` alone so the OS preference keeps deciding.
 *
 * Custom properties inherit from `<html>`, where Home Assistant writes the
 * active theme, so reading them off the card host needs no probe element.
 */
export function resolveColorScheme(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): 'light' | 'dark' | null {
  for (const name of SURFACE_VARS) {
    const scheme = schemeForSurface(style.getPropertyValue(name) ?? '');
    if (scheme) return scheme;
  }
  return null;
}

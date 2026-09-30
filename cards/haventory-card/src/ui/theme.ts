/**
 * Whether the card is painted on a light or a dark surface. HA's dark mode is a
 * frontend setting, not the OS's, and no variable says "this theme is dark", so
 * the surface colour itself is classified and published as `color-scheme`.
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
 * The scheme implied by an element's resolved surface variables, or `null` when
 * none carries a usable colour, which leaves the OS preference deciding.
 */
export function resolveColorScheme(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): 'light' | 'dark' | null {
  for (const name of SURFACE_VARS) {
    const scheme = schemeForSurface(style.getPropertyValue(name));
    if (scheme) return scheme;
  }
  return null;
}

import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';
import { STATUS_COLORS } from './status';

/**
 * Every status tone has to stay readable, in both themes.
 *
 * A chip's label is 12px, so WCAG AA asks 4.5:1 — and half the tones are drawn
 * as a translucent tint, whose declared colour is not the colour anyone sees.
 * Each one is composited onto the surface it sits on before being measured,
 * which is what the eye does and what a plain reading of the token does not.
 *
 * This is checked against the token text rather than a rendered page because
 * jsdom computes no colours: it would report the `var(...)` back unresolved.
 */

const source = tokens.cssText;

/** The page under a chip: the card's own surface, per --hv-surface. */
const SURFACE = { light: [255, 255, 255], dark: [28, 28, 28] } as const;

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

function declarations(): Map<string, string> {
  const out = new Map<string, string>();
  // Strip comments first: they quote token names and hex values freely.
  for (const m of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

function parseColor(text: string): Rgba {
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const n = rgba[1].split(',').map((p) => Number(p.trim()));
    return [n[0], n[1], n[2], n[3] ?? 1];
  }
  throw new Error(`cannot parse colour: ${text}`);
}

/** Resolve one token to a colour, following var()/light-dark() for one theme. */
function resolve(name: string, theme: 'light' | 'dark', decls: Map<string, string>, seen = 0): Rgba {
  if (seen > 12) throw new Error(`token cycle at ${name}`);
  const value = decls.get(name);
  if (value === undefined) throw new Error(`undeclared token ${name}`);
  return resolveValue(value, theme, decls, seen);
}

function resolveValue(value: string, theme: 'light' | 'dark', decls: Map<string, string>, seen = 0): Rgba {
  const text = value.trim();

  const lightDark = text.match(/^light-dark\(([\s\S]+)\)$/);
  if (lightDark) {
    const [light, dark] = splitTop(lightDark[1]);
    return resolveValue(theme === 'light' ? light : dark, theme, decls, seen + 1);
  }

  const variable = text.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/);
  if (variable) {
    // The fallback is what ships: an HA theme may or may not set the outer one,
    // and the fallback is the value this card guarantees.
    if (variable[2] !== undefined) return resolveValue(variable[2], theme, decls, seen + 1);
    return resolve(variable[1], theme, decls, seen + 1);
  }

  return parseColor(text);
}

/** Split a comma list at depth zero, so nested functions stay intact. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

const over = (fg: Rgba, bg: Rgb): Rgb =>
  fg[3] >= 1
    ? [fg[0], fg[1], fg[2]]
    : ([0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3]))) as Rgb);

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('status tone contrast', () => {
  const decls = declarations();

  it('declares a background and a foreground for every colour the backend accepts', () => {
    for (const color of STATUS_COLORS) {
      const base = `--hv-tone-${color.replace(/_/g, '-')}`;
      expect(decls.has(`${base}-bg`), `${base}-bg is missing`).toBe(true);
      expect(decls.has(`${base}-fg`), `${base}-fg is missing`).toBe(true);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const color of STATUS_COLORS) {
      it(`${color} clears WCAG AA in the ${theme} theme`, () => {
        const base = `--hv-tone-${color.replace(/_/g, '-')}`;
        const surface = SURFACE[theme] as unknown as Rgb;
        const fill = over(resolve(`${base}-bg`, theme, decls), surface);
        const ink = over(resolve(`${base}-fg`, theme, decls), fill);
        const ratio = contrast(fill, ink);
        expect(
          ratio,
          `${color} (${theme}) is ${ratio.toFixed(2)}:1 — chip text is 12px, so AA asks 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('resolves a translucent tint against the surface rather than reading it as opaque', () => {
    // Guards the harness itself: amber's dark tint is 14% over the dark surface,
    // so a reader that ignored alpha would measure a completely different colour.
    const fill = over(resolve('--hv-tone-amber-bg', 'dark', decls), SURFACE.dark as unknown as Rgb);
    expect(fill).toEqual([60, 47, 29]);
  });
});

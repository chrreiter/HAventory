import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import type { Item, StatsCounts, StatusColor, StatusDefinition } from '../store/types';
import { ICONS, icon } from './icons';
import type { IconName } from './icons';

/**
 * One vocabulary for the item status wherever a surface names it — filter
 * chips, row badges, the editor's select — so a slug never renders with two
 * different labels.
 *
 * A household defines its own statuses, so the labels, colours and glyphs come
 * from `haventory/config` rather than from constants here. Every function below
 * therefore takes the definitions the store holds. What stays local is the
 * fallback: the built-in three, which is what an absent `statuses` section has
 * meant since schema v6 and what a backend too old to report them still means.
 */

/** What an item carries when nothing set its status. */
export const DEFAULT_STATUS = 'ok';

/**
 * The built-in vocabulary, matching what the backend seeds. Used only until
 * `haventory/config` answers — after that the store's copy wins, including for
 * these three, because a household may have renamed or recoloured them.
 */
export const BUILT_IN_STATUSES: readonly StatusDefinition[] = [
  { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
  { slug: 'missing', label: 'Missing', order: 1, color: 'amber', icon: 'alert' },
  { slug: 'needs_repair', label: 'Needs repair', order: 2, color: 'amber', icon: 'wrench' },
];

/**
 * Every colour a status may take: five hues, each in a light and a strong form.
 * Ordered hue-major so the two intensities of a hue stay adjacent: the picker
 * lays the swatches out as a wrapping row, and a neighbouring pair reads as one
 * hue at two strengths wherever the line happens to break. Pinned to the
 * backend's `STATUS_COLORS` by `tests/test_frontend_registration.py` — the
 * backend refuses a value outside its own list, and neither side can see the
 * other.
 */
export const STATUS_COLORS: readonly StatusColor[] = [
  'neutral',
  'neutral_strong',
  'green',
  'green_strong',
  'blue',
  'blue_strong',
  'amber',
  'amber_strong',
  'red',
  'red_strong',
];

/** Every glyph a status may take, pinned to the backend's `STATUS_ICONS`. */
export const STATUS_ICONS: readonly IconName[] = [
  'check',
  'alert',
  'wrench',
  'hand',
  'box',
  'truck',
  'clock',
  'cancel',
  'star',
  'help',
];

/** Definitions to render from: the backend's, or the built-ins until it answers. */
export function statusList(
  defs: readonly StatusDefinition[] | null | undefined,
): readonly StatusDefinition[] {
  return defs && defs.length > 0 ? defs : BUILT_IN_STATUSES;
}

/** An item's status; absent (older backend payloads) reads as the default. */
export function itemStatus(item: Pick<Item, 'status'>): string {
  return item.status ?? DEFAULT_STATUS;
}

function definitionOf(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): StatusDefinition | undefined {
  return statusList(defs).find((d) => d.slug === slug);
}

/**
 * Display label for a slug.
 *
 * Falls back to the slug itself rather than rendering nothing: an item can
 * carry a status this card has not been told about — an import defines one, or
 * another client created one since `haventory/config` was last read.
 */
export function statusLabel(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): string {
  return definitionOf(slug, defs)?.label ?? slug;
}

/**
 * How many items carry a slug, or `null` when the payload cannot say.
 *
 * One reading for every surface that prices a status — the sidebar facet, the
 * filter chips, the organize tab — because three surfaces deriving the same
 * number three ways is three chances to disagree with the backend.
 *
 * `status_counts` prices every *defined* slug, `ok` included, so a slug absent
 * from a map that arrived names a status nothing defines: the card's
 * vocabulary and its counts are momentarily out of step, and `null` (no tally)
 * is the honest reading rather than a `0` that looks measured. A backend too
 * old to send the map still prices the two flagged built-ins in their own
 * fields; no other slug is knowable there.
 *
 * `null` means "no number to show", never "zero" — a caller that wants a zero
 * instead says so at its own call site.
 */
export function statusCount(
  counts: StatsCounts | null | undefined,
  slug: string,
): number | null {
  const perSlug = counts?.status_counts;
  if (perSlug) return perSlug[slug] ?? null;
  if (slug === 'missing') return counts?.missing_count ?? null;
  if (slug === 'needs_repair') return counts?.needs_repair_count ?? null;
  return null;
}

/** A stored colour that is a literal rather than one of the tone tokens. */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Whether a stored colour is a `#rrggbb` literal, the form the backend allows. */
export function isHexColor(value: string | null | undefined): boolean {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/** One channel of a hex colour, linearized as WCAG defines it. */
function channelLuminance(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The ink that reads on an arbitrary fill: whichever of black and white has the
 * greater WCAG contrast against it.
 *
 * The only colour maths in the card, and deliberately the only place any of it
 * happens — every other foreground is a token paired with its fill by hand. A
 * pair, not a spectrum: the fill is a household's free choice, so the ink has
 * to be derived from the fill alone, and the two extremes are what a derivation
 * can reach for.
 *
 * No colour needs refusing because of it. The worst possible fill is the one
 * where both ratios meet, at 4.58:1 — above the 4.5:1 the ten tokens were
 * picked to clear — so every hex a household can enter is legible.
 */
export function inkOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance =
    0.2126 * channelLuminance((value >> 16) & 0xff) +
    0.7152 * channelLuminance((value >> 8) & 0xff) +
    0.0722 * channelLuminance(value & 0xff);
  const onBlack = (luminance + 0.05) / 0.05;
  const onWhite = 1.05 / (luminance + 0.05);
  return onBlack >= onWhite ? '#000000' : '#ffffff';
}

/**
 * The inline declaration that paints a chip in a literal colour.
 *
 * Custom properties rather than `background`/`color` directly, because that is
 * what `.hv-status-chip` reads: a tone class sets the same two, so a token and
 * a literal arrive by one route and a hover or a border mixed from them keeps
 * working either way.
 */
export function hexToneStyle(hex: string): string {
  return `--hv-status-bg:${hex};--hv-status-fg:${inkOn(hex)}`;
}

/** How a status chip is painted: a class for a token, inline properties for a hex. */
export interface StatusTone {
  /** A `tone-*` class for `chip.ts` to match, or `''` when the colour is a literal. */
  toneClass: string;
  /** Inline custom properties for a literal colour, or `undefined` for a token. */
  toneStyle: string | undefined;
}

/**
 * How to paint a slug: exactly one of a tone class and an inline declaration.
 *
 * A token becomes `tone-amber-strong` — stored as `amber_strong`, kebab-cased
 * because that is how `chip.ts` spells its selectors — and resolves against the
 * active Home Assistant theme. A `#rrggbb` literal cannot resolve against
 * anything, so it arrives as the fill itself plus the ink derived from it, and
 * that one chip looks the same in every theme.
 *
 * Both halves have to reach the element: a caller that keeps the class and
 * drops the style paints a literal-coloured status as a plain neutral chip.
 */
export function statusTone(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): StatusTone {
  const color = definitionOf(slug, defs)?.color ?? 'neutral';
  if (isHexColor(color)) return { toneClass: '', toneStyle: hexToneStyle(color) };
  return { toneClass: `tone-${color.replace(/_/g, '-')}`, toneStyle: undefined };
}

/**
 * A stored icon name narrowed to one this bundle carries, or null.
 *
 * `IconName` is a compile-time set and a stored icon is just a string — an
 * import or a newer backend can name a glyph this bundle has never heard of —
 * so anything read back from a definition has to pass through here before it
 * can be rendered.
 */
export function knownIcon(name: string | null | undefined): IconName | null {
  return name != null && name in ICONS ? (name as IconName) : null;
}

/**
 * The glyph for a slug, or null when it names one this bundle does not carry.
 *
 * Null renders no glyph, which is the right outcome: the chip still carries its
 * label and its colour.
 */
export function statusIconName(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): IconName | null {
  return knownIcon(definitionOf(slug, defs)?.icon);
}

/**
 * A slug from a label: lowercase, ASCII letters/digits/underscores, and never
 * one the vocabulary already carries.
 *
 * The user never types this — a household should not have to think about the
 * identifier — but it is what `services.yaml` and an export document carry, so
 * the editor shows it beside the label for anyone writing an automation.
 *
 * The numeric suffix is a backstop against the backend refusing a slug already
 * taken, not the answer to a duplicate label: two statuses named the same thing
 * are indistinguishable in every chip on the card, so the editor warns about
 * that separately rather than leaving this walk to resolve it silently.
 */
export function slugFromLabel(
  label: string,
  defs: readonly StatusDefinition[] | null | undefined,
): string {
  const base =
    label
      .normalize('NFKD')
      // The combining marks NFKD just split off; stripping them is what turns
      // "Ausgeliehen" with an umlaut into ASCII rather than into underscores.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'status';
  const taken = new Set(statusList(defs).map((d) => d.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 61)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The status mark, wherever the card shows one — a table cell, a row badge, a
 * detail sheet. One renderer so the colour, the glyph and the label cannot
 * drift apart between surfaces, the same reason `renderAreaChip` exists.
 *
 * The glyph is decorative: it repeats what the label already says, and a status
 * whose icon this bundle does not carry simply renders without one.
 *
 * The label is wrapped rather than left as a bare text node so it can elide:
 * the chip is an inline-flex box, and a cell's own `text-overflow` cannot reach
 * inside one — a household label longer than its column hard-cut mid-word. The
 * rule lives in `ui/chip.ts`, so every surface that chips a status inherits it.
 */
export function renderStatusChip(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
  options: { testid?: string } = {},
): TemplateResult {
  const glyph = statusIconName(slug, defs);
  const tone = statusTone(slug, defs);
  return html`<span
    class="hv-status-chip ${tone.toneClass}"
    style=${ifDefined(tone.toneStyle)}
    data-testid=${ifDefined(options.testid)}
    >${glyph ? icon(glyph, 12) : null}<span class="hv-chip-text"
      >${statusLabel(slug, defs)}</span
    ></span
  >`;
}

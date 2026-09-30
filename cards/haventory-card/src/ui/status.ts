import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import type { Item, StatsCounts, StatusColor, StatusDefinition } from '../store/types';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { ICONS, icon } from './icons';
import type { IconName } from './icons';
import { luminanceOf } from './theme';

/**
 * One vocabulary for the item status wherever a surface names it. A household
 * defines its own statuses, so every function takes the store's definitions,
 * falling back to the built-in three until `haventory/config` answers.
 */

/** What an item carries when nothing set its status. */
export const DEFAULT_STATUS = 'ok';

/**
 * The backend's seed, held to it by `tests/test_frontend_registration.py`. Its
 * labels are also the English `displayLabel` measures a rename against.
 */
export const BUILT_IN_STATUSES: readonly StatusDefinition[] = [
  { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
  { slug: 'missing', label: 'Missing', order: 1, color: 'amber', icon: 'alert' },
  { slug: 'needs_repair', label: 'Needs repair', order: 2, color: 'amber', icon: 'wrench' },
];

/** The key each built-in slug is printed under while nobody has renamed it. */
const BUILT_IN_LABEL_KEYS: ReadonlyMap<string, TranslationKey> = new Map<string, TranslationKey>([
  ['ok', 'hv.status.ok'],
  ['missing', 'hv.status.missing'],
  ['needs_repair', 'hv.status.needs_repair'],
]);

/** The English seeded per built-in slug, which is what a rename is measured against. */
const SEEDED_LABELS: ReadonlyMap<string, string> = new Map(
  BUILT_IN_STATUSES.map((d) => [d.slug, d.label]),
);

/**
 * Every colour a status may take, hue-major so a hue's two strengths stay
 * adjacent in the picker. Pinned to the backend's `STATUS_COLORS` by
 * `tests/test_frontend_registration.py`.
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

/** An item's status; absent reads as the default. */
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
 * What a definition reads as on screen. A built-in still carrying its seeded
 * English prints in the reader's language; any other label, renamed built-ins
 * included, prints as stored. Display only: nothing is written back.
 */
export function displayLabel(def: StatusDefinition): string {
  const key = BUILT_IN_LABEL_KEYS.get(def.slug);
  if (key === undefined || def.label !== SEEDED_LABELS.get(def.slug)) return def.label;
  return t(key);
}

/** Display label for a slug, or the slug itself for a status the card has not been told about. */
export function statusLabel(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): string {
  const def = definitionOf(slug, defs);
  return def ? displayLabel(def) : slug;
}

/**
 * How many items carry a slug, for every surface that prices a status. `null`
 * means no number to show, never zero: a slug the map lacks is one the counts
 * do not define yet. Without the map, only the two flagged built-ins are known.
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

/**
 * Black or white, whichever has the greater WCAG contrast on a `#rrggbb` fill.
 * The worst case is 4.58:1, so every hex a household can enter is legible.
 */
export function inkOn(hex: string): string {
  const luminance = luminanceOf(hex) ?? 0;
  const onBlack = (luminance + 0.05) / 0.05;
  const onWhite = 1.05 / (luminance + 0.05);
  return onBlack >= onWhite ? '#000000' : '#ffffff';
}

/** A literal colour as the same two custom properties a tone class sets. */
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
 * How to paint a slug: a kebab-cased `tone-*` class for a token, or an inline
 * style for a `#rrggbb` literal. A caller must apply both halves.
 */
export function statusTone(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): StatusTone {
  const color = definitionOf(slug, defs)?.color ?? 'neutral';
  if (isHexColor(color)) return { toneClass: '', toneStyle: hexToneStyle(color) };
  return { toneClass: `tone-${color.replace(/_/g, '-')}`, toneStyle: undefined };
}

/** A stored icon name narrowed to one this bundle carries, or null. */
export function knownIcon(name: string | null | undefined): IconName | null {
  return name != null && name in ICONS ? (name as IconName) : null;
}

/** The glyph for a slug, or null, which renders the chip without one. */
export function statusIconName(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): IconName | null {
  return knownIcon(definitionOf(slug, defs)?.icon);
}

/**
 * A slug from a label: lowercase ASCII letters, digits and underscores, with a
 * numeric suffix when the vocabulary already carries it.
 */
export function slugFromLabel(
  label: string,
  defs: readonly StatusDefinition[] | null | undefined,
): string {
  const base =
    label
      .normalize('NFKD')
      // Strip the combining marks NFKD split off, so "ä" becomes "a".
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
 * The status mark wherever the card shows one. The glyph is decorative; the
 * label has its own element so `ui/chip` can elide it.
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

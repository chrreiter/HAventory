import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { TemplateResult } from 'lit';
import type { Item, StatusDefinition } from '../store/types';
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
 * The chip modifier for a slug's colour, e.g. `tone-amber-strong`.
 *
 * Stored as `amber_strong`; the class is the same token in kebab case, because
 * that is how `chip.ts` spells its selectors.
 */
export function statusToneClass(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): string {
  const color = definitionOf(slug, defs)?.color ?? 'neutral';
  return `tone-${color.replace(/_/g, '-')}`;
}

/**
 * The glyph for a slug, or null when it names one this bundle does not carry.
 *
 * `IconName` is a compile-time set and a stored icon is just a string, so the
 * lookup has to narrow it. Null renders no glyph, which is the right outcome:
 * the chip still carries its label and its colour.
 */
export function statusIconName(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
): IconName | null {
  const name = definitionOf(slug, defs)?.icon;
  return name !== undefined && name in ICONS ? (name as IconName) : null;
}

/**
 * The status mark, wherever the card shows one — a table cell, a row badge, a
 * detail sheet. One renderer so the colour, the glyph and the label cannot
 * drift apart between surfaces, the same reason `renderAreaChip` exists.
 *
 * The glyph is decorative: it repeats what the label already says, and a status
 * whose icon this bundle does not carry simply renders without one.
 */
export function renderStatusChip(
  slug: string,
  defs: readonly StatusDefinition[] | null | undefined,
  options: { testid?: string } = {},
): TemplateResult {
  const glyph = statusIconName(slug, defs);
  return html`<span
    class="hv-status-chip ${statusToneClass(slug, defs)}"
    data-testid=${ifDefined(options.testid)}
    >${glyph ? icon(glyph, 12) : null}${statusLabel(slug, defs)}</span
  >`;
}

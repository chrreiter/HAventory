import type { TranslationKey } from '../i18n';
import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { tokens, base } from '../ui/tokens';
import { TAG_MARK, chip } from '../ui/chip';
import { locationPathParts, pathLabel } from '../ui/location-path';
import { icon } from '../ui/icons';
import { formatDate } from '../ui/relative-time';
import { statusLabel, statusTone } from '../ui/status';
import type { Location, StatusDefinition, StoreFilters } from '../store/types';

/** Which filter a chip clears. Matches the keys of `StoreFilters`. */
export type FilterChipKey =
  | 'q'
  | 'areaId'
  | 'locationIds'
  | 'checkedOutOnly'
  | 'orphansOnly'
  | 'lowStockOnly'
  | 'lowStockFirst'
  | 'overdueOnly'
  | 'inspectionDueOnly'
  | 'status'
  | 'categories'
  | 'tags'
  | 'updatedAfter'
  | 'createdAfter'
  | 'updatedBefore'
  | 'createdBefore';

export interface FilterChip {
  key: FilterChipKey;
  label: string;
  tone: 'primary' | 'warning';
  /**
   * How the one chip whose colour a household picks rather than the card is
   * painted: a `tone-*` class, an inline declaration for a literal colour, or
   * both fields empty for every other chip. Either half present replaces
   * `tone` entirely — the two palettes are deliberately disjoint (see
   * `ui/chip.ts`), so a chip cannot carry one of each.
   */
  toneClass?: string;
  /** Inline custom properties for a status painted in a literal colour. */
  toneStyle?: string;
}

/**
 * Build the chip row from filter state. Both the card and the full view render
 * <hv-filter-chips>, so an active filter reads identically on either surface.
 */
export function chipsFor(
  filters: StoreFilters,
  ctx: {
    locations?: Location[] | null;
    areas?: { id: string; name: string }[] | null;
    statuses?: StatusDefinition[] | null;
  } = {},
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.q) chips.push({ key: 'q', label: `"${filters.q}"`, tone: 'primary' });

  if (filters.locationIds.length) {
    const locations = ctx.locations ?? [];
    // A chip is already the smallest thing on this row, so the area is named in
    // words rather than nested in a chip of its own — the same "Area: X" the
    // area filter's own chip prints two lines down. It drops out when the path
    // opens with it, as the chip beside a path does.
    const paths = filters.locationIds.map((id) =>
      pathLabel(
        locationPathParts(
          locations.find((l) => l.id === id),
          locations,
          ctx.areas ?? [],
          t('hv.chips.locationFallback'),
        ),
      ),
    );
    // One chip for the whole selection, the way the tag chip below carries every
    // selected tag: the row counts narrowings, not values, and "+ sub" applies
    // to all of them at once.
    const joined = paths.join(', ');
    chips.push({
      key: 'locationIds',
      label: filters.includeSubtree ? t('hv.chips.plusSub', { paths: joined }) : joined,
      tone: 'primary',
    });
  }
  if (filters.areaId) {
    const area = (ctx.areas ?? []).find((a) => a.id === filters.areaId);
    chips.push({
      key: 'areaId',
      label: t('hv.chips.area', { name: area?.name ?? filters.areaId }),
      tone: 'primary',
    });
  }
  // This row has no headings above it, so every chip on it has to name its own
  // facet: a bare "Hardware" could be a category, a location or the search
  // text. The facets that read as a bare value say so in words, the way Area
  // and Status already do; tags carry the same mark they wear as chips, so the
  // two vocabularies agree.
  if (filters.categories.length)
    chips.push({
      key: 'categories',
      label: t(filters.categories.length > 1 ? 'hv.chips.categories' : 'hv.chips.category', {
        values: filters.categories.join(', '),
      }),
      tone: 'primary',
    });
  if (filters.tags.length) {
    const joined = filters.tags.map((t) => `${TAG_MARK}${t}`).join(', ');
    chips.push({
      key: 'tags',
      label: t(filters.tagsMode === 'all' ? 'hv.chips.tagsAll' : 'hv.chips.tagsAny', {
        values: joined,
      }),
      tone: 'primary',
    });
  }
  // Deliberately distinct chips: one is a filter, one is an ordering.
  if (filters.lowStockOnly)
    chips.push({ key: 'lowStockOnly', label: t('hv.chips.lowStockOnly'), tone: 'warning' });
  if (filters.lowStockFirst)
    chips.push({ key: 'lowStockFirst', label: t('hv.chips.lowStockFirst'), tone: 'primary' });
  if (filters.checkedOutOnly)
    chips.push({ key: 'checkedOutOnly', label: t('hv.term.checkedOut'), tone: 'primary' });
  if (filters.overdueOnly)
    chips.push({ key: 'overdueOnly', label: t('hv.term.overdue'), tone: 'warning' });
  if (filters.inspectionDueOnly)
    chips.push({ key: 'inspectionDueOnly', label: t('hv.term.inspectionDue'), tone: 'warning' });
  if (filters.status) {
    const tone = statusTone(filters.status, ctx.statuses);
    chips.push({
      key: 'status',
      label: t('hv.chips.status', { label: statusLabel(filters.status, ctx.statuses) }),
      // The status the household chose, in the colour the household gave it —
      // the same chip the rows below this one carry. `tone` is the fallback for
      // a consumer that reads neither of the two below.
      tone: 'primary',
      toneClass: tone.toneClass,
      toneStyle: tone.toneStyle,
    });
  }
  if (filters.orphansOnly)
    chips.push({ key: 'orphansOnly', label: t('hv.term.noLocation'), tone: 'primary' });
  // One chip per bound rather than one per field: each is separately clearable,
  // so a range narrowed too far can be half-undone.
  const dateChips: [FilterChipKey, string | null, TranslationKey][] = [
    ['updatedAfter', filters.updatedAfter, 'hv.chips.updatedAfter'],
    ['updatedBefore', filters.updatedBefore, 'hv.chips.updatedBefore'],
    ['createdAfter', filters.createdAfter, 'hv.chips.createdAfter'],
    ['createdBefore', filters.createdBefore, 'hv.chips.createdBefore'],
  ];
  for (const [key, value, prefix] of dateChips) {
    if (value)
      chips.push({
        key,
        label: t('hv.chips.dated', {
          prefix: t(prefix),
          date: formatDate(value.slice(0, 10)),
        }),
        tone: 'primary',
      });
  }
  return chips;
}

/** The value that clears a chip's filter. */
export function clearedValueFor(key: FilterChipKey): Partial<StoreFilters> {
  switch (key) {
    case 'q':
      return { q: '' };
    case 'tags':
      return { tags: [] };
    // The multi-select facets clear to an empty selection, not to null: an
    // empty list is how "not narrowing by this" is spelled end to end.
    case 'locationIds':
      return { locationIds: [] };
    case 'categories':
      return { categories: [] };
    case 'areaId':
    case 'status':
    case 'updatedAfter':
    case 'createdAfter':
    case 'updatedBefore':
    case 'createdBefore':
      return { [key]: null } as Partial<StoreFilters>;
    default:
      return { [key]: false } as Partial<StoreFilters>;
  }
}

/** Removable chips for every active filter, plus a clear-all affordance. */
@customElement('hv-filter-chips')
export class HVFilterChips extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      /* Each of these removes the filter it names, so the trailing × is part of
         the target and the chip carries a little more room on that side. */
      .chip {
        padding-right: 6px;
      }
      .chip:hover {
        opacity: 0.85;
      }
      /*
       * A chip names a narrowing; it is not where the value is read. Nothing
       * caps what a household can put into one — a search term, a run of tags,
       * a path several levels deep — and this row shares a phone-width line
       * with the filter toggle, so one uncapped chip takes the row away from
       * the controls beside it. The whole text stays on the title and on the
       * accessible name.
       *
       * The elision belongs on the label rather than on the chip: the chip is
       * an inline-flex container, so text-overflow on it would do nothing and
       * the trailing × has to stay outside the clipped box to remain visible.
       */
      .chip > .hv-chip-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 20ch;
      }
      .chip svg {
        opacity: 0.8;
      }
    `,
  ];

  @property({ attribute: false }) filters!: StoreFilters;
  @property({ attribute: false }) locations: Location[] | null = null;
  /** The status vocabulary from `haventory/config`; the built-ins stand in
   * until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];

  render() {
    if (!this.filters) return null;
    const chips = chipsFor(this.filters, {
      locations: this.locations,
      areas: this.areas,
      statuses: this.statuses,
    });
    if (!chips.length) return null;
    return html`
      <div class="row" data-testid="filter-chips">
        ${chips.map(
          (entry) => html`<button
            class=${entry.toneClass !== undefined
              ? `hv-status-chip chip ${entry.toneClass}`
              : `hv-chip chip ${entry.tone === 'warning' ? 'warning' : 'state'}`}
            style=${ifDefined(entry.toneStyle)}
            data-testid="filter-chip"
            data-key=${entry.key}
            title=${entry.label}
            aria-label=${`Clear filter ${entry.label}`}
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('remove-filter', {
                  detail: { key: entry.key, patch: clearedValueFor(entry.key) },
                  bubbles: true,
                  composed: true,
                }),
              )}
          >
            <span class="hv-chip-text">${entry.label}</span>${icon('close', 15)}
          </button>`,
        )}
        <button
          class="hv-text-button"
          data-testid="filter-chips-clear"
          @click=${() =>
            this.dispatchEvent(new CustomEvent('clear-filters', { bubbles: true, composed: true }))}
        >
          ${t('hv.action.clearAll')}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-filter-chips': HVFilterChips;
  }
}

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
  /** A status chip's household tone class, which replaces `tone` (see `ui/chip.ts`). */
  toneClass?: string;
  /** Inline custom properties for a status painted in a literal colour. */
  toneStyle?: string;
}

/** Build the chip row from filter state, for the card and the full view alike. */
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
    // The area in words, not a nested chip; it drops out when the path opens with it.
    const paths = filters.locationIds.map((id) =>
      pathLabel(
        locationPathParts(
          locations.find((l) => l.id === id),
          locations,
          ctx.areas ?? [],
          t('hv.field.location'),
        ),
      ),
    );
    // One chip for the whole selection, as for tags; "+ sub" applies to all of it.
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
      label: t('hv.area.prefix', { name: area?.name ?? filters.areaId }),
      tone: 'primary',
    });
  }
  // The row has no headings, so each chip names its own facet.
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
  // Low stock as a filter and as an ordering are two distinct chips.
  const flags: [FilterChipKey & keyof StoreFilters, TranslationKey, FilterChip['tone']][] = [
    ['lowStockOnly', 'hv.chips.lowStockOnly', 'warning'],
    ['lowStockFirst', 'hv.term.lowStockFirst', 'primary'],
    ['checkedOutOnly', 'hv.term.checkedOut', 'primary'],
    ['overdueOnly', 'hv.term.overdue', 'warning'],
    ['inspectionDueOnly', 'hv.term.inspectionDue', 'warning'],
  ];
  for (const [key, label, tone] of flags) if (filters[key]) chips.push({ key, label: t(label), tone });
  if (filters.status) {
    const tone = statusTone(filters.status, ctx.statuses);
    chips.push({
      key: 'status',
      label: t('hv.chips.status', { label: statusLabel(filters.status, ctx.statuses) }),
      // In the household's own colour; `tone` is the fallback.
      tone: 'primary',
      toneClass: tone.toneClass,
      toneStyle: tone.toneStyle,
    });
  }
  if (filters.orphansOnly)
    chips.push({ key: 'orphansOnly', label: t('hv.term.noLocation'), tone: 'primary' });
  // One chip per bound, so a range can be half-undone.
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
    // An empty list, not null, is how the multi-select facets say "not narrowing".
    case 'tags':
    case 'locationIds':
    case 'categories':
      return { [key]: [] };
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
      /* The trailing × is part of the target. */
      .chip {
        padding-right: 6px;
      }
      .chip:hover {
        opacity: 0.85;
      }
      /* Capped, with the whole text on the title and the accessible name. On the
         label, since text-overflow does nothing on the inline-flex chip. */
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
  /** The status vocabulary from `haventory/config`; the built-ins stand in until it answers. */
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
            aria-label=${t('hv.action.clearFilter', { label: entry.label })}
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

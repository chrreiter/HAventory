import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { locationPathParts, pathTitle } from '../ui/location-path';
import { icon } from '../ui/icons';
import { formatDate } from '../ui/relative-time';
import { statusLabel } from '../ui/status';
import type { Location, StoreFilters } from '../store/types';

/** Which filter a chip clears. Matches the keys of `StoreFilters`. */
export type FilterChipKey =
  | 'q'
  | 'areaId'
  | 'locationId'
  | 'checkedOutOnly'
  | 'orphansOnly'
  | 'lowStockOnly'
  | 'lowStockFirst'
  | 'overdueOnly'
  | 'inspectionDueOnly'
  | 'status'
  | 'category'
  | 'tags'
  | 'updatedAfter'
  | 'createdAfter'
  | 'updatedBefore'
  | 'createdBefore';

export interface FilterChip {
  key: FilterChipKey;
  label: string;
  tone: 'primary' | 'warning';
}

/**
 * Build the chip row from filter state. Both the card and the full view render
 * <hv-filter-chips>, so an active filter reads identically on either surface.
 */
export function chipsFor(
  filters: StoreFilters,
  ctx: { locations?: Location[] | null; areas?: { id: string; name: string }[] | null } = {},
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.q) chips.push({ key: 'q', label: `"${filters.q}"`, tone: 'primary' });

  if (filters.locationId) {
    const locations = ctx.locations ?? [];
    const loc = locations.find((l) => l.id === filters.locationId);
    // A chip is already the smallest thing on this row, so the area is named in
    // words rather than nested in a chip of its own — the same "Area: X" the
    // area filter's own chip prints two lines down.
    const path = pathTitle(locationPathParts(loc, locations, ctx.areas ?? [], 'Location'));
    chips.push({
      key: 'locationId',
      label: filters.includeSubtree ? `${path} + sub` : path,
      tone: 'primary',
    });
  }
  if (filters.areaId) {
    const area = (ctx.areas ?? []).find((a) => a.id === filters.areaId);
    chips.push({ key: 'areaId', label: `Area: ${area?.name ?? filters.areaId}`, tone: 'primary' });
  }
  if (filters.category) chips.push({ key: 'category', label: filters.category, tone: 'primary' });
  if (filters.tags.length) {
    const joined = filters.tags.join(', ');
    chips.push({
      key: 'tags',
      label: filters.tagsMode === 'all' ? `all of: ${joined}` : `any of: ${joined}`,
      tone: 'primary',
    });
  }
  // Deliberately distinct chips: one is a filter, one is an ordering.
  if (filters.lowStockOnly) chips.push({ key: 'lowStockOnly', label: 'Low stock only', tone: 'warning' });
  if (filters.lowStockFirst) chips.push({ key: 'lowStockFirst', label: 'Low stock first', tone: 'primary' });
  if (filters.checkedOutOnly) chips.push({ key: 'checkedOutOnly', label: 'Checked out', tone: 'primary' });
  if (filters.overdueOnly) chips.push({ key: 'overdueOnly', label: 'Overdue', tone: 'warning' });
  if (filters.inspectionDueOnly)
    chips.push({ key: 'inspectionDueOnly', label: 'Inspection due', tone: 'warning' });
  if (filters.status)
    chips.push({
      key: 'status',
      label: `Status: ${statusLabel(filters.status)}`,
      // OK is the unremarkable state; the two flagged values carry the warning tone.
      tone: filters.status === 'ok' ? 'primary' : 'warning',
    });
  if (filters.orphansOnly) chips.push({ key: 'orphansOnly', label: 'No location', tone: 'primary' });
  // One chip per bound rather than one per field: each is separately clearable,
  // so a range narrowed too far can be half-undone.
  const dateChips: [FilterChipKey, string | null, string][] = [
    ['updatedAfter', filters.updatedAfter, 'Updated ≥'],
    ['updatedBefore', filters.updatedBefore, 'Updated ≤'],
    ['createdAfter', filters.createdAfter, 'Created ≥'],
    ['createdBefore', filters.createdBefore, 'Created ≤'],
  ];
  for (const [key, value, prefix] of dateChips) {
    if (value) chips.push({ key, label: `${prefix} ${formatDate(value.slice(0, 10))}`, tone: 'primary' });
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
    case 'areaId':
    case 'locationId':
    case 'status':
    case 'category':
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
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: none;
        border-radius: var(--hv-radius-chip);
        padding: 4px 9px 4px 11px;
        font: 500 12px var(--hv-font);
        color: var(--hv-primary-darker);
        background: var(--hv-primary-tint);
      }
      .chip.warning {
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
      }
      .chip:hover {
        opacity: 0.85;
      }
      .chip svg {
        opacity: 0.8;
      }
      .clear-all {
        border: none;
        background: none;
        font: 500 12px var(--hv-font);
        color: var(--hv-text-secondary);
        padding: 4px 6px;
      }
      .clear-all:hover {
        color: var(--hv-primary-dark);
      }
    `,
  ];

  @property({ attribute: false }) filters!: StoreFilters;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];

  render() {
    if (!this.filters) return null;
    const chips = chipsFor(this.filters, { locations: this.locations, areas: this.areas });
    if (!chips.length) return null;
    return html`
      <div class="row" data-testid="filter-chips">
        ${chips.map(
          (chip) => html`<button
            class="chip ${chip.tone === 'warning' ? 'warning' : ''}"
            data-testid="filter-chip"
            data-key=${chip.key}
            aria-label=${`Clear filter ${chip.label}`}
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('remove-filter', {
                  detail: { key: chip.key, patch: clearedValueFor(chip.key) },
                  bubbles: true,
                  composed: true,
                }),
              )}
          >
            ${chip.label}${icon('close', 15)}
          </button>`,
        )}
        <button
          class="clear-all"
          data-testid="filter-chips-clear"
          @click=${() =>
            this.dispatchEvent(new CustomEvent('clear-filters', { bubbles: true, composed: true }))}
        >
          Clear all
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

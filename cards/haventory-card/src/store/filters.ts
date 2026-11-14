import type { ItemFilter, StoreFilters } from './types';
import { DEFAULT_SORT } from './sort';

/** Translate the card's filter state into the backend's `ItemFilter`. */
export function toWireFilter(filters: StoreFilters): ItemFilter {
  const filter: ItemFilter = {
    q: filters.q || undefined,
    area_id: filters.areaId || undefined,
    location_ids: filters.locationIds.length ? [...filters.locationIds] : undefined,
    // Sent explicitly: the list defaults it to false, subscriptions to true.
    include_subtree: filters.includeSubtree,
    checked_out: filters.checkedOutOnly || undefined,
    low_stock_only: filters.lowStockOnly || undefined,
    low_stock_first: filters.lowStockFirst || undefined,
    orphaned_only: filters.orphansOnly || undefined,
    overdue_only: filters.overdueOnly || undefined,
    inspection_due_only: filters.inspectionDueOnly || undefined,
    reminder_due_only: filters.reminderDueOnly || undefined,
    status: filters.status ?? undefined,
    categories: filters.categories.length ? [...filters.categories] : undefined,
    updated_after: filters.updatedAfter || undefined,
    created_after: filters.createdAfter || undefined,
    updated_before: filters.updatedBefore || undefined,
    created_before: filters.createdBefore || undefined,
  };
  if (filters.tags.length) {
    if (filters.tagsMode === 'all') filter.tags_all = [...filters.tags];
    else filter.tags_any = [...filters.tags];
  }
  return filter;
}

/** The filter state a freshly-mounted card starts from. */
export function defaultFilters(): StoreFilters {
  return {
    q: '',
    areaId: null,
    locationIds: [],
    includeSubtree: true,
    checkedOutOnly: false,
    lowStockFirst: false,
    orphansOnly: false,
    lowStockOnly: false,
    overdueOnly: false,
    inspectionDueOnly: false,
    reminderDueOnly: false,
    status: null,
    categories: [],
    tags: [],
    tagsMode: 'any',
    updatedAfter: null,
    createdAfter: null,
    updatedBefore: null,
    createdBefore: null,
    sort: DEFAULT_SORT,
  };
}

/** The single location the view is pointed at; null for none or several. */
export function soleLocationId(filters: StoreFilters): string | null {
  return filters.locationIds.length === 1 ? (filters.locationIds[0] ?? null) : null;
}

/** Whether two selections name the same values, order included. */
export function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** How many filters (ignoring sort) are narrowing the list right now. */
export function activeFilterCount(filters: StoreFilters): number {
  let n = 0;
  if (filters.q) n += 1;
  if (filters.areaId) n += 1;
  if (filters.locationIds.length) n += 1;
  if (filters.checkedOutOnly) n += 1;
  if (filters.orphansOnly) n += 1;
  if (filters.lowStockOnly) n += 1;
  if (filters.lowStockFirst) n += 1;
  if (filters.overdueOnly) n += 1;
  if (filters.inspectionDueOnly) n += 1;
  if (filters.reminderDueOnly) n += 1;
  if (filters.status) n += 1;
  if (filters.categories.length) n += 1;
  if (filters.tags.length) n += 1;
  if (filters.updatedAfter) n += 1;
  if (filters.createdAfter) n += 1;
  if (filters.updatedBefore) n += 1;
  if (filters.createdBefore) n += 1;
  return n;
}

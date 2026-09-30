import type { Sort, SortField, SortOrder } from './types';

/** The order a sort field opens in: a timestamp newest first, everything else ascending. */
export function getDefaultOrderFor(field: SortField): SortOrder {
  return field === 'updated_at' || field === 'created_at' ? 'desc' : 'asc';
}

export const DEFAULT_SORT: Sort = { field: 'updated_at', order: 'desc' };

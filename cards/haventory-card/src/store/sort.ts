import type { Sort, SortField, SortOrder } from './types';

/**
 * Returns the default sort order for a given sort field.
 * - name, quantity: ascending (human-friendly)
 * - created_at, updated_at: descending (newest first)
 */
export function getDefaultOrderFor(field: SortField): SortOrder {
  if (field === 'name' || field === 'quantity') return 'asc';
  return 'desc';
}

/** Default sort used across the UI. */
export const DEFAULT_SORT: Sort = { field: 'updated_at', order: 'desc' };

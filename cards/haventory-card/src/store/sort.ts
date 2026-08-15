import type { Sort, SortField, SortOrder } from './types';

/**
 * Returns the default sort order for a given sort field.
 * - name, quantity, location: ascending (human-friendly)
 * - due_date, inspection_date, reminder_date: ascending (soonest first; undated last)
 * - created_at, updated_at: descending (newest first)
 *
 * `location` opens ascending for the reason `name` does — a path is text, and
 * a list of them read top-down is what "sorted by location" means. Items filed
 * nowhere land at the end either way.
 */
export function getDefaultOrderFor(field: SortField): SortOrder {
  if (
    field === 'name' ||
    field === 'quantity' ||
    field === 'due_date' ||
    field === 'inspection_date' ||
    field === 'reminder_date' ||
    field === 'location'
  )
    return 'asc';
  return 'desc';
}

/** Default sort used across the UI. */
export const DEFAULT_SORT: Sort = { field: 'updated_at', order: 'desc' };

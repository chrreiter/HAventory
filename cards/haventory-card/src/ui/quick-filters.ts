/**
 * Which quick-filter pills a dashboard offers; `null` means every pill. This
 * only decides what is allowed: a pill whose count is zero is still not drawn.
 */

export const QUICK_FILTER_KEYS = [
  'total',
  'low_stock',
  'overdue',
  'inspection_due',
  'reminder_due',
  'checked_out',
] as const;

export type QuickFilterKey = (typeof QUICK_FILTER_KEYS)[number];

/**
 * Read the `quick_filters` config value. Anything but a list reads as not
 * configured, unknown names are dropped, and an explicit `[]` is honoured.
 */
export function normalizeQuickFilters(value: unknown): QuickFilterKey[] | null {
  if (!Array.isArray(value)) return null;
  const known = new Set<unknown>(QUICK_FILTER_KEYS);
  return [...new Set(value.filter((entry): entry is QuickFilterKey => known.has(entry)))];
}

/** True when this pill may be drawn at all — the count still has the last word. */
export function quickFilterAllowed(allowed: QuickFilterKey[] | null, key: QuickFilterKey): boolean {
  return allowed === null || allowed.includes(key);
}

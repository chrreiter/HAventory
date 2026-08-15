/**
 * Which quick-filter pills a dashboard offers.
 *
 * The pills are filter toggles, not decoration, and a dashboard that never
 * checks anything out has no use for the checked-out one. The card config names
 * the pills it wants; `null` — the omitted key — means every pill, which is what
 * every existing dashboard gets.
 *
 * This only decides what is *allowed*. Whether an allowed pill actually shows is
 * still the count's call: a pill reading "0 low" was never drawn and is not
 * drawn now. Both surfaces read the same list, so the card and the full view
 * offer one vocabulary rather than two.
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
 * Read the `quick_filters` config value.
 *
 * Anything that is not a list of known names reads as "not configured" rather
 * than as an error: a dashboard must not break on a key this card does not
 * understand, which is the same philosophy `setConfig` already applies to every
 * other key. An explicit empty list is a choice, though, and is honoured.
 */
export function normalizeQuickFilters(value: unknown): QuickFilterKey[] | null {
  if (!Array.isArray(value)) return null;
  const known = new Set<string>(QUICK_FILTER_KEYS);
  const out: QuickFilterKey[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !known.has(entry)) continue;
    if (!out.includes(entry as QuickFilterKey)) out.push(entry as QuickFilterKey);
  }
  return out;
}

/** True when this pill may be drawn at all — the count still has the last word. */
export function quickFilterAllowed(allowed: QuickFilterKey[] | null, key: QuickFilterKey): boolean {
  return allowed === null || allowed.includes(key);
}

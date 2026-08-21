/**
 * Turn the backend's health payload into something a person can read.
 *
 * `haventory/health` returns `issues` as bare string codes, repeated once per
 * offending entity — e.g. three items pointing at a deleted location produce
 * `['item_references_missing_location', ...]` three times. The diagnostics panel
 * needs one card per distinct problem with a count, so dedupe and count here.
 */

import { tn } from '../i18n';
import type { PluralKey } from '../i18n';

export interface HealthIssueSummary {
  /** The raw backend code, kept so the panel can still show it verbatim. */
  code: string;
  /** How many times the backend reported it (≈ how many entities are affected). */
  count: number;
  /** Human sentence; falls back to the raw code for unknown/new codes. */
  message: string;
}

/**
 * Known codes from `_collect_item_issues` / `_collect_index_issues` in `ws.py`,
 * each mapped to the counted pair that says it in words.
 *
 * A code with no entry here is surfaced as-is rather than swallowed — a new
 * backend check should still be visible, in whatever language, before anyone
 * has got round to writing a sentence for it.
 */
const MESSAGE_KEYS = {
  item_id_key_mismatch: 'hv.health.itemIdKeyMismatch',
  item_references_missing_location: 'hv.health.itemReferencesMissingLocation',
  item_missing_from_items_by_location_index: 'hv.health.itemMissingFromLocationIndex',
  checked_out_item_missing_from_index: 'hv.health.checkedOutItemMissingFromIndex',
  non_checked_out_item_present_in_index: 'hv.health.nonCheckedOutItemInIndex',
  low_stock_item_missing_from_index: 'hv.health.lowStockItemMissingFromIndex',
  non_low_stock_item_present_in_index: 'hv.health.nonLowStockItemInIndex',
  tags_index_references_unknown_item_ids: 'hv.health.tagsIndexUnknownItems',
  category_index_references_unknown_item_ids: 'hv.health.categoryIndexUnknownItems',
  checked_out_index_references_unknown_item_ids: 'hv.health.checkedOutIndexUnknownItems',
  low_stock_index_references_unknown_item_ids: 'hv.health.lowStockIndexUnknownItems',
  items_by_location_index_references_unknown_item_ids: 'hv.health.locationIndexUnknownItems',
  items_by_location_references_missing_location: 'hv.health.locationIndexMissingLocation',
  items_by_location_bucket_mismatch: 'hv.health.locationBucketMismatch',
  location_id_key_mismatch: 'hv.health.locationIdKeyMismatch',
  items_total_count_mismatch: 'hv.health.itemsTotalMismatch',
  locations_total_count_mismatch: 'hv.health.locationsTotalMismatch',
  checked_out_count_mismatch: 'hv.health.checkedOutCountMismatch',
  low_stock_count_mismatch: 'hv.health.lowStockCountMismatch',
} as const satisfies Record<string, PluralKey>;

/**
 * Collapse a raw `issues` array into one entry per distinct code, preserving
 * first-seen order so the panel is stable across refreshes.
 */
export function summarizeIssues(issues: readonly string[] | null | undefined): HealthIssueSummary[] {
  if (!issues?.length) return [];
  const counts = new Map<string, number>();
  for (const raw of issues) {
    const code = String(raw);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].map(([code, count]) => {
    const key = (MESSAGE_KEYS as Record<string, PluralKey | undefined>)[code];
    return { code, count, message: key ? tn(key, count) : code };
  });
}

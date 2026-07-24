/**
 * Turn the backend's health payload into something a person can read.
 *
 * `haventory/health` returns `issues` as bare string codes, repeated once per
 * offending entity — e.g. three items pointing at a deleted location produce
 * `['item_references_missing_location', ...]` three times. The diagnostics panel
 * needs one card per distinct problem with a count, so dedupe and count here.
 */

export interface HealthIssueSummary {
  /** The raw backend code, kept so the panel can still show it verbatim. */
  code: string;
  /** How many times the backend reported it (≈ how many entities are affected). */
  count: number;
  /** Human sentence; falls back to the raw code for unknown/new codes. */
  message: string;
}

/**
 * Known codes from `_collect_item_issues` / `_collect_index_issues` in `ws.py`.
 * `{n}` is replaced with the occurrence count. Unknown codes are surfaced as-is
 * rather than swallowed — a new backend check should still be visible.
 */
const MESSAGES: Record<string, string> = {
  item_id_key_mismatch: '{n} item(s) are stored under a key that does not match their id.',
  item_references_missing_location:
    '{n} item(s) reference a location that no longer exists — they appear under "No location".',
  item_missing_from_items_by_location_index: '{n} item(s) are missing from the location index.',
  checked_out_item_missing_from_index: '{n} checked-out item(s) are missing from the checked-out index.',
  non_checked_out_item_present_in_index: '{n} item(s) are in the checked-out index but are not checked out.',
  low_stock_item_missing_from_index: '{n} low-stock item(s) are missing from the low-stock index.',
  non_low_stock_item_present_in_index: '{n} item(s) are in the low-stock index but are not low on stock.',
  tags_index_references_unknown_item_ids: 'The tag index references {n} item(s) that no longer exist.',
  category_index_references_unknown_item_ids: 'The category index references {n} item(s) that no longer exist.',
  checked_out_index_references_unknown_item_ids:
    'The checked-out index references {n} item(s) that no longer exist.',
  low_stock_index_references_unknown_item_ids: 'The low-stock index references {n} item(s) that no longer exist.',
  items_by_location_index_references_unknown_item_ids:
    'The location index references {n} item(s) that no longer exist.',
  items_by_location_references_missing_location: 'The location index has {n} bucket(s) for missing locations.',
  items_by_location_bucket_mismatch: '{n} location bucket(s) disagree with the items they hold.',
  location_id_key_mismatch: '{n} location(s) are stored under a key that does not match their id.',
  items_total_count_mismatch: 'The cached item total disagrees with the stored items.',
  locations_total_count_mismatch: 'The cached location total disagrees with the stored locations.',
  checked_out_count_mismatch: 'The cached checked-out count disagrees with the stored items.',
  low_stock_count_mismatch: 'The cached low-stock count disagrees with the stored items.',
};

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
  return [...counts.entries()].map(([code, count]) => ({
    code,
    count,
    message: MESSAGES[code]?.replace('{n}', String(count)) ?? code,
  }));
}

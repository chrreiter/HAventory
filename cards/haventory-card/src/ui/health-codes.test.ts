import { summarizeIssues } from './health-codes';

describe('summarizeIssues', () => {
  it('returns nothing for a healthy payload', () => {
    expect(summarizeIssues([])).toEqual([]);
    expect(summarizeIssues(null)).toEqual([]);
    expect(summarizeIssues(undefined)).toEqual([]);
  });

  it('collapses a repeated code into one entry with a count', () => {
    // ws.py emits this code once per offending item, not deduped.
    const out = summarizeIssues([
      'item_references_missing_location',
      'item_references_missing_location',
      'item_references_missing_location',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('item_references_missing_location');
    expect(out[0].count).toBe(3);
    expect(out[0].message).toContain('3 item(s) reference a location that no longer exists');
  });

  it('keeps distinct codes in first-seen order', () => {
    const out = summarizeIssues(['low_stock_count_mismatch', 'item_id_key_mismatch', 'low_stock_count_mismatch']);
    expect(out.map((i) => i.code)).toEqual(['low_stock_count_mismatch', 'item_id_key_mismatch']);
    expect(out[0].count).toBe(2);
  });

  it('surfaces an unknown code verbatim rather than swallowing it', () => {
    const out = summarizeIssues(['some_future_backend_check']);
    expect(out[0].message).toBe('some_future_backend_check');
    expect(out[0].count).toBe(1);
  });
});

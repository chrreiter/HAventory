import { describe, it, expect } from 'vitest';
import { ITEM_STATUSES, itemStatus, statusLabel } from './status';
import { makeItem } from '../test.utils';

describe('itemStatus', () => {
  it('reads the stored status when present', () => {
    expect(itemStatus(makeItem({ status: 'missing' }))).toBe('missing');
    expect(itemStatus(makeItem({ status: 'needs_repair' }))).toBe('needs_repair');
  });

  it('treats an absent status as ok, like a payload from an older backend', () => {
    expect(itemStatus(makeItem())).toBe('ok');
  });
});

describe('statusLabel', () => {
  it('names every status the backend accepts', () => {
    expect(ITEM_STATUSES.map(statusLabel)).toEqual(['OK', 'Missing', 'Needs repair']);
  });
});

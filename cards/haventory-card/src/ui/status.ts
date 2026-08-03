import type { Item, ItemStatus } from '../store/types';

/**
 * One vocabulary for the item status wherever a surface names it — filter
 * chips, row badges, the editor's select — so "needs_repair" never renders
 * with two different labels.
 */

/** Every status the backend accepts, in display order. */
export const ITEM_STATUSES: readonly ItemStatus[] = ['ok', 'missing', 'needs_repair'];

/** An item's status; absent (older backend payloads) reads as `ok`. */
export function itemStatus(item: Pick<Item, 'status'>): ItemStatus {
  return item.status ?? 'ok';
}

const LABELS: Record<ItemStatus, string> = {
  ok: 'OK',
  missing: 'Missing',
  needs_repair: 'Needs repair',
};

export function statusLabel(status: ItemStatus): string {
  return LABELS[status];
}

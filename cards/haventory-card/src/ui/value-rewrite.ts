import { tn } from '../i18n';
import { makeBulkOp } from '../store/store';
import { normalizeTags } from './item-form';
import type { BulkOperation, Item, ItemFilter } from '../store/types';

/**
 * Tag and category rename / merge / delete as batch rewrites of the items that
 * carry them; there is no endpoint for either. Each op carries the item's
 * `expected_version`, so a row changed mid-rewrite comes back as a conflict.
 */

export type ValueKind = 'tag' | 'category';

/** The list filter that finds every item carrying a value. */
export function filterForValue(kind: ValueKind, value: string): ItemFilter {
  return kind === 'tag' ? { tags_any: [value] } : { category: value };
}

/** Rewrite `from` to `to` (null removes it); an item that would not change gets no op. */
export function rewriteOps(
  kind: ValueKind,
  items: readonly Item[],
  from: string,
  to: string | null,
): BulkOperation[] {
  const ops: BulkOperation[] = [];
  for (const item of items) {
    if (kind === 'tag') {
      const target = to ? to.trim().toLowerCase() : null;
      const source = from.trim().toLowerCase();
      if (!item.tags.some((t) => t.toLowerCase() === source)) continue;
      const kept = item.tags.filter((t) => t.toLowerCase() !== source);
      const next = normalizeTags(target ? [...kept, target] : kept);
      if (next.join(' ') === normalizeTags(item.tags).join(' ')) continue;
      ops.push(
        makeBulkOp('item_update', { item_id: item.id, tags: next, expected_version: item.version }),
      );
    } else {
      const next = to?.trim() || null;
      if ((item.category ?? null) === next) continue;
      ops.push(
        makeBulkOp('item_update', { item_id: item.id, category: next, expected_version: item.version }),
      );
    }
  }
  return ops;
}

/** Human summary of what a rewrite is about to do. */
export function describeRewrite(
  kind: ValueKind,
  count: number,
  from: string,
  to: string | null,
): string {
  if (to === null) {
    return kind === 'tag'
      ? tn('hv.rewrite.tag.remove', count, { from })
      : tn('hv.rewrite.category.clear', count);
  }
  if (kind === 'tag') return tn('hv.rewrite.tag.retag', count, { from });
  return tn('hv.rewrite.category.set', count, { to });
}

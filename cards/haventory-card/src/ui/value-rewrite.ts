import { makeBulkOp } from '../store/store';
import { plural } from './plural';
import type { BulkOperation, Item, ItemFilter } from '../store/types';

/**
 * Tag and category rename / merge / delete, as batch rewrites.
 *
 * There is no rename or merge endpoint — the backend stores tags and categories
 * on the items themselves. So every one of these is "fetch the affected items,
 * then rewrite them in one batch", which is why the organize dialog needs the
 * same progress and partial-failure treatment as bulk actions.
 *
 * Each op carries the item's `expected_version`, so a row someone else changed
 * mid-rewrite comes back as a conflict rather than silently losing their edit.
 */

export type ValueKind = 'tag' | 'category';

/** The list filter that finds every item carrying a value. */
export function filterForValue(kind: ValueKind, value: string): ItemFilter {
  return kind === 'tag' ? { tags_any: [value] } : { category: value };
}

/** Tags as the backend keeps them: lowercase, deduplicated, original order. */
function normalize(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * Rewrite `from` to `to` on every given item. A null `to` removes the value —
 * that is what "delete this tag" means when tags live on items.
 *
 * Items that would not actually change produce no operation, so a rewrite never
 * bumps a version for nothing.
 */
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
      const next = normalize(target ? [...kept, target] : kept);
      if (next.join(' ') === normalize(item.tags).join(' ')) continue;
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
  const noun = plural(count, 'item');
  if (to === null) {
    return kind === 'tag'
      ? `Removes "${from}" from ${count} ${noun}.`
      : `Clears the category on ${count} ${noun}.`;
  }
  if (kind === 'tag') return `Retags ${count} ${noun}, then removes "${from}".`;
  return `Recategorises ${count} ${noun} as "${to}".`;
}

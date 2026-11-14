import { t } from '../i18n';
import { errorCode } from './error-queue';
import { serverErrorText } from './server-error';
import type { Run } from './connection-health';
import type { BulkFailure, BulkOperation, BulkResults, Item } from './types';

/** Operations per `haventory/items/bulk` call, so progress and cancel work per chunk. */
export const BULK_CHUNK_SIZE = 25;

let bulkOpSeq = 0;

/** Build a batch operation with an `op_id` unique for the process: the backend refuses a call that repeats one. */
export function makeBulkOp(kind: BulkOperation['kind'], payload: Record<string, unknown>): BulkOperation {
  bulkOpSeq += 1;
  const target = typeof payload.item_id === 'string' ? payload.item_id : 'op';
  return { op_id: `${kind}:${target}:${bulkOpSeq}`, kind, payload };
}

/** The item a batch operation targets, or null when its payload names none. */
export function opTargetId(op: BulkOperation): string | null {
  const id = op.payload?.item_id;
  return typeof id === 'string' ? id : null;
}

function unknownBulkError(message = t('hv.store.operationFailed')) {
  return { code: 'unknown_error', message };
}

export interface BulkOptions {
  chunkSize?: number;
  /** Called after every chunk with cumulative counts. */
  onProgress?: (done: number, total: number, failed: number) => void;
  /** Checked between chunks; the in-flight chunk always completes. */
  isCancelled?: () => boolean;
}

/**
 * Send `ops` to the backend a chunk at a time, collecting what succeeded and
 * what failed. Each succeeded item goes to `deps.apply` as its chunk lands.
 */
export async function runBulk(
  ops: BulkOperation[],
  opts: BulkOptions,
  deps: {
    run: Run;
    send: (chunk: BulkOperation[]) => Promise<BulkResults>;
    apply: (item: Item) => void;
  },
): Promise<{ succeeded: Item[]; failed: BulkFailure[]; cancelled: boolean; succeededOpIds: Set<string> }> {
  const chunkSize = Math.max(1, opts.chunkSize ?? BULK_CHUNK_SIZE);
  const succeeded: Item[] = [];
  const failed: BulkFailure[] = [];
  const succeededOpIds = new Set<string>();
  let done = 0;
  let cancelled = false;

  for (let i = 0; i < ops.length; i += chunkSize) {
    if (opts.isCancelled?.()) {
      cancelled = true;
      break;
    }
    const chunk = ops.slice(i, i + chunkSize);
    const byId = new Map(chunk.map((op) => [op.op_id, op]));
    try {
      const { results } = await deps.run(() => deps.send(chunk));
      for (const [opId, result] of Object.entries(results)) {
        const op = byId.get(opId);
        if (result.success) {
          succeededOpIds.add(opId);
          // `item_delete` succeeds with a null result.
          if (result.result) {
            succeeded.push(result.result);
            deps.apply(result.result);
          }
        } else if (op) {
          failed.push({ op, error: result.error ?? unknownBulkError(), itemId: opTargetId(op) });
        }
      }
      // A conforming server answers every op_id, and refuses the whole call
      // when one repeats. An op left unanswered all the same (a backend of
      // another version, a cut frame) is reported rather than dropped from
      // both lists.
      for (const op of chunk) {
        if (!(op.op_id in results)) {
          failed.push({
            op,
            error: unknownBulkError(t('hv.store.noResult')),
            itemId: opTargetId(op),
          });
        }
      }
    } catch (err) {
      // The whole call failed (envelope validation, transport). Attribute it
      // to each op in the chunk.
      const error = {
        code: errorCode(err),
        message: serverErrorText(err, t('hv.store.batchFailed')),
      };
      for (const op of chunk) failed.push({ op, error, itemId: opTargetId(op) });
    }
    done += chunk.length;
    opts.onProgress?.(done, ops.length, failed.length);
  }
  return { succeeded, failed, cancelled, succeededOpIds };
}

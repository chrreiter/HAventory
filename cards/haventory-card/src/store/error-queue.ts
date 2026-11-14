import { t } from '../i18n';
import { serverErrorText } from './server-error';
import { Slice } from './slice';
import type { ErrorEntry, ItemUpdate, StoreState } from './types';

/**
 * Code for a failure that never reached a server: HA wraps those with a numeric
 * code of its own, and they say nothing about the request itself.
 */
export const TRANSPORT_ERROR_CODE = 'connection_lost';

/** A string code means a server answered; anything else never reached one. */
export function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && code ? code : TRANSPORT_ERROR_CODE;
}

export type ErrorsSlice = Pick<StoreState, 'errorQueue'>;

/** What a refused write carries so a conflict banner can offer the edit again. */
export interface ErrorDetails {
  itemId?: string;
  changes?: ItemUpdate;
}

/** The failures the card shows as banners, oldest first, until each is dismissed. */
export class ErrorQueue {
  readonly slice = new Slice<ErrorsSlice>({ errorQueue: [] });

  push(err: unknown, details?: ErrorDetails) {
    const anyErr = err as { message?: unknown; context?: unknown; data?: unknown } | undefined;
    const code = errorCode(err);
    const transport = code === TRANSPORT_ERROR_CODE;
    // One transport entry stands for every call an outage fails.
    if (transport && this.slice.value.errorQueue.some((e) => e.code === TRANSPORT_ERROR_CODE)) return;
    const entry: ErrorEntry = {
      id: `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      code,
      // A transport rejection carries no text worth showing.
      message: transport ? t('hv.store.transportError') : serverErrorText(err, t('hv.store.unknownError')),
      context: (anyErr?.context ?? anyErr?.data ?? undefined) as Record<string, unknown> | undefined,
      kind: code === 'conflict' ? 'conflict' : 'error',
      itemId: details?.itemId,
      changes: details?.changes,
    };
    this.slice.set({ errorQueue: [...this.slice.value.errorQueue, entry] });
  }

  dismiss(id: string) {
    this.slice.set({ errorQueue: this.slice.value.errorQueue.filter((e) => e.id !== id) });
  }
}

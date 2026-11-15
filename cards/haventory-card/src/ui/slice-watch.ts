import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { Store } from '../store/store';
import type { StoreState } from '../store/types';

/**
 * Re-render `host` when one of the store slices it reads moves, for as long as
 * it is connected. A host re-attached after a while away renders once on the way
 * in, since the slices kept moving while it was gone.
 */
export class SliceWatch implements ReactiveController {
  private _store?: Store;
  private _off?: () => void;

  constructor(
    private readonly _host: ReactiveControllerHost & { readonly store?: Store },
    private readonly _slices: readonly (keyof Store['slices'])[],
  ) {
    _host.addController(this);
  }

  /** The store's state as the host renders it, or null before a store is set. */
  get state(): StoreState | null {
    return this._host.store?.state.value ?? null;
  }

  hostConnected(): void {
    this._sync();
    this._host.requestUpdate();
  }

  hostUpdate(): void {
    this._sync();
  }

  hostDisconnected(): void {
    this._off?.();
    this._off = undefined;
    this._store = undefined;
  }

  private _sync() {
    const store = this._host.store;
    if (store === this._store) return;
    this._off?.();
    this._store = store;
    this._off = store?.watch(this._slices, () => this._host.requestUpdate());
  }
}

import type { ReactiveControllerHost } from 'lit';

/**
 * A controller's own UI state, held so that every change renders. `value` is
 * read-only to the type checker; `set` is the one way to change it, and it asks
 * the host for an update when a patched key holds a new value. Lit batches the
 * requests, so several `set` calls in one synchronous run render once, and a
 * `set` from `willUpdate` joins the update already under way.
 */
export class HostState<T extends object> {
  private current: T;

  constructor(
    private readonly host: ReactiveControllerHost,
    initial: T,
  ) {
    this.current = { ...initial };
  }

  get value(): Readonly<T> {
    return this.current;
  }

  set(patch: Partial<T>): void {
    const keys = Object.keys(patch) as (keyof T)[];
    if (keys.every((key) => Object.is(this.current[key], patch[key]))) return;
    this.current = { ...this.current, ...patch };
    this.host.requestUpdate();
  }
}

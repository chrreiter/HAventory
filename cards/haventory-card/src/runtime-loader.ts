/**
 * The one door to the lazy runtime. The first HAventory element to reach the
 * page starts the download; every later one shares the same promise, and once
 * it has settled `loadedRuntime()` hands the module over synchronously.
 */

export type Runtime = typeof import('./runtime');

let loaded: Runtime | undefined;
let pending: Promise<Runtime> | undefined;

export function loadRuntime(): Promise<Runtime> {
  pending ??= import('./runtime').then(
    (rt) => (loaded = rt),
    (err: unknown) => {
      // Forgotten so the next element to connect tries again: a dropped
      // connection is the usual cause. A chunk this page's entry names but the
      // server no longer has means the integration was upgraded under an open
      // tab, and only a reload brings the entry and its chunks back together.
      pending = undefined;
      console.error('HAventory could not load its card code; reload the page if it was just updated.', err);
      throw err;
    },
  );
  return pending;
}

/** The runtime, if it has finished loading. */
export function loadedRuntime(): Runtime | undefined {
  return loaded;
}

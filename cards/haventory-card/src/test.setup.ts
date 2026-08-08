import { afterAll } from 'vitest';

// Minimal polyfills for jsdom environment used in Vitest.
// `ui/responsive.ts` observes the card element's own width, so jsdom needs a
// ResizeObserver it does not ship.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || (RO as unknown as typeof ResizeObserver);

/*
 * Card code deliberately schedules work that outlives a single test —
 * `register.ts` re-asserts the custom-element definition every 250 ms for 15 s,
 * because Home Assistant swaps `window.customElements` while it boots. jsdom is
 * torn down as soon as a spec file finishes, and a tick landing after that
 * reaches a window whose globals are gone: vitest reports the ReferenceError as
 * an *uncaught exception* and exits non-zero with every test passing. The
 * scheduling is correct, so the suite is what has to stop it — every interval,
 * not just that one, since the same tick can come from any module a spec loads.
 */
const liveIntervals = new Set<number>();
const scheduleInterval = window.setInterval.bind(window);
const cancelInterval = window.clearInterval.bind(window);

window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const id = scheduleInterval(handler, timeout, ...args);
  liveIntervals.add(id);
  return id;
}) as typeof window.setInterval;

window.clearInterval = ((id?: number) => {
  if (id !== undefined) liveIntervals.delete(id);
  cancelInterval(id);
}) as typeof window.clearInterval;

/** Cancel every interval still pending in this spec file's window. */
export function stopPendingIntervals(): void {
  for (const id of liveIntervals) cancelInterval(id);
  liveIntervals.clear();
}

/** How many intervals the sweep is currently holding. */
export function pendingIntervalCount(): number {
  return liveIntervals.size;
}

// Per spec file, immediately before the environment goes away. Fake timers
// install their own `setInterval` over the wrapper above and clean up after
// themselves, so what reaches here is the real-timer work only.
afterAll(() => {
  stopPendingIntervals();
});

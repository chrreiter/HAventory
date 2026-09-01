import { afterAll, beforeEach } from 'vitest';
import { setLanguage } from './i18n';

/*
 * The card's language is a module singleton, and a spec file shares one module
 * registry across its tests — so a test that switches to German leaves every
 * test after it in German. Reset before each, which also means a spec need only
 * say `setLanguage('de')` and not clean up after itself.
 */
beforeEach(() => {
  setLanguage('en');
});

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

/*
 * A `setTimeout` still pending when the environment goes away fails exactly the
 * same way an interval does, so it is swept the same way. One difference decides
 * the shape: a timeout fires once and is then gone, and nothing tells the set
 * that. The wrapper therefore wraps the handler and drops the id as it runs, so
 * the set holds what is still pending rather than every zero-delay wait the
 * spec file has ever made.
 */
const liveTimeouts = new Set<number>();
const scheduleTimeout = window.setTimeout.bind(window);
const cancelTimeout = window.clearTimeout.bind(window);

window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  // A string handler would have to be wrapped through `eval` to learn when it
  // fired; nothing here schedules one, so it is passed straight through.
  if (typeof handler !== 'function') return scheduleTimeout(handler, timeout, ...args);
  let id = 0;
  id = scheduleTimeout(
    (...fired: unknown[]) => {
      liveTimeouts.delete(id);
      handler(...fired);
    },
    timeout,
    ...args,
  );
  liveTimeouts.add(id);
  return id;
}) as typeof window.setTimeout;

window.clearTimeout = ((id?: number) => {
  if (id !== undefined) liveTimeouts.delete(id);
  cancelTimeout(id);
}) as typeof window.clearTimeout;

/** Cancel every timeout still pending in this spec file's window. */
export function stopPendingTimeouts(): void {
  for (const id of liveTimeouts) cancelTimeout(id);
  liveTimeouts.clear();
}

// Per spec file, immediately before the environment goes away. Fake timers
// install their own timer functions over the wrappers above and clean up after
// themselves, so what reaches here is the real-timer work only.
afterAll(() => {
  stopPendingIntervals();
  stopPendingTimeouts();
});

/**
 * One timer for "the day has turned over", shared by everything that renders a
 * date.
 *
 * Every date predicate in the card — `isOverdue`, `isDue`, `isReminderDue` —
 * reads the clock at render time and is otherwise a pure function of the item,
 * so nothing re-renders when the only thing that changed is the date. A card
 * left open on a wall tablet therefore showed yesterday's chips until somebody
 * edited something, while the sensors on the same dashboard had rolled over at
 * midnight. Subscribers here get one callback per day boundary and re-render;
 * the predicates keep reading the clock and need no argument threaded to them.
 *
 * One module-level timer rather than one per component: a list is a few hundred
 * rows, and a few hundred timers all firing at the same instant is a stall for
 * an event nobody sees.
 */

import { toIsoDate } from './relative-time';

/**
 * How long after midnight the tick lands. A timer is allowed to fire a hair
 * early, and one that woke at 23:59:59.998 would read the old day, notify
 * nobody and re-arm — correct, but a second of chips nobody asked for.
 */
const SETTLE_MS = 1_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
/** The day the subscribers were last told about, as `YYYY-MM-DD`. */
let day = '';

/**
 * Milliseconds until just after the next local midnight.
 *
 * Built from the date parts, the way `toIsoDate` reads them, rather than by
 * adding 24 hours: the day a clock change makes 23 or 25 hours long is exactly
 * the one where the two answers differ, and the parts give the household's own
 * midnight in either case.
 */
function msUntilNextDay(now: number): number {
  const d = new Date(now);
  const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return nextMidnight - now + SETTLE_MS;
}

function notifyIfDayChanged(): void {
  const today = toIsoDate();
  if (today === day) return;
  day = today;
  // A copy: a subscriber may unsubscribe from inside its own callback.
  for (const listener of [...listeners]) listener();
}

function arm(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(tick, msUntilNextDay(Date.now()));
}

function tick(): void {
  timer = undefined;
  if (listeners.size === 0) return;
  notifyIfDayChanged();
  arm();
}

/**
 * A device that slept through midnight wakes with a timer that fired late, or
 * that a background tab throttled into not firing at all. Becoming visible is
 * the moment the stale render is about to be looked at, so the day is compared
 * again there and the deadline re-armed.
 */
function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return;
  notifyIfDayChanged();
  arm();
}

function stop(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

/**
 * Call `cb` shortly after each local midnight, for as long as the returned
 * unsubscribe has not been called. Nothing is scheduled while nobody is
 * listening, and the last unsubscribe clears both the timer and the listener.
 */
export function onDayChange(cb: () => void): () => void {
  if (listeners.size === 0) {
    day = toIsoDate();
    document.addEventListener('visibilitychange', onVisibilityChange);
    arm();
  }
  listeners.add(cb);

  let live = true;
  return () => {
    // Guarded: a component that disconnects twice would otherwise drop a
    // listener a later subscriber had added under the same identity.
    if (!live) return;
    live = false;
    listeners.delete(cb);
    if (listeners.size === 0) stop();
  };
}

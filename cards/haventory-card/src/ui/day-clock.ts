/**
 * One module-level timer for "the day has turned over", shared by everything
 * that renders a date. The date predicates read the clock at render time, so
 * without a tick a card left open shows yesterday's chips; one timer rather
 * than one per row, which would all fire at the same instant.
 */

import { toIsoDate } from './relative-time';

/** Lands after midnight, since a timer may fire a hair early and read the old day. */
const SETTLE_MS = 1_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
/** The day the subscribers were last told about, as `YYYY-MM-DD`. */
let day = '';

/** From the date parts, not +24 h, which is wrong on a 23- or 25-hour DST day. */
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
  clearTimeout(timer);
  timer = setTimeout(tick, msUntilNextDay(Date.now()));
}

function tick(): void {
  timer = undefined;
  if (listeners.size === 0) return;
  notifyIfDayChanged();
  arm();
}

/** A device that slept through midnight, or a throttled tab, catches up on becoming visible. */
function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return;
  notifyIfDayChanged();
  arm();
}

function stop(): void {
  clearTimeout(timer);
  timer = undefined;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

/** Call `cb` shortly after each local midnight until unsubscribed; nothing runs with no listener. */
export function onDayChange(cb: () => void): () => void {
  if (listeners.size === 0) {
    day = toIsoDate();
    document.addEventListener('visibilitychange', onVisibilityChange);
    arm();
  }
  listeners.add(cb);

  let live = true;
  return () => {
    // A second call must not drop a listener re-added under the same identity.
    if (!live) return;
    live = false;
    listeners.delete(cb);
    if (listeners.size === 0) stop();
  };
}

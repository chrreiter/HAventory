import { onDayChange } from './day-clock';

/**
 * The clock is module state shared by every subscriber, so each case has to
 * leave it empty: a listener left behind would be re-armed by the next case's
 * first subscribe and fire into a finished test.
 */
const cleanups: (() => void)[] = [];

function subscribe(cb: () => void): () => void {
  const unsub = onDayChange(cb);
  cleanups.push(unsub);
  return unsub;
}

/** Local time, because the day the card renders is the browser's own. */
function at(y: number, m: number, d: number, hh: number, mm: number, ss: number): Date {
  return new Date(y, m - 1, d, hh, mm, ss);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
});

describe('onDayChange', () => {
  it('fires once just after the next local midnight', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 59, 58));
    const seen = vi.fn();
    subscribe(seen);

    vi.advanceTimersByTime(3_000);

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('goes on firing, one call per day', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 59, 58));
    const seen = vi.fn();
    subscribe(seen);

    vi.advanceTimersByTime(3_000);
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000);

    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('says nothing before midnight', () => {
    vi.setSystemTime(at(2026, 8, 22, 12, 0, 0));
    const seen = vi.fn();
    subscribe(seen);

    vi.advanceTimersByTime(11 * 60 * 60 * 1_000);

    expect(seen).not.toHaveBeenCalled();
  });

  it('stops at unsubscribe, and leaves no timer behind', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 59, 58));
    const seen = vi.fn();
    const unsub = subscribe(seen);

    unsub();
    vi.advanceTimersByTime(3_000);

    expect(seen).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the timer for the subscribers that remain', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 59, 58));
    const gone = vi.fn();
    const stays = vi.fn();
    const unsub = subscribe(gone);
    subscribe(stays);

    unsub();
    vi.advanceTimersByTime(3_000);

    expect(gone).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(1);
  });

  it('catches up on becoming visible, for a device that slept through midnight', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 0, 0));
    const seen = vi.fn();
    subscribe(seen);

    // Asleep: the clock moved but the timer did not run.
    vi.setSystemTime(at(2026, 8, 23, 7, 0, 0));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('says nothing on a visibility change inside the same day', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 0, 0));
    const seen = vi.fn();
    subscribe(seen);

    vi.setSystemTime(at(2026, 8, 22, 23, 30, 0));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(seen).not.toHaveBeenCalled();
  });

  it('does not fire twice for one day when the wake beat the timer', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 59, 58));
    const seen = vi.fn();
    subscribe(seen);

    vi.setSystemTime(at(2026, 8, 23, 0, 0, 30));
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000);

    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('a stale unsubscribe does not cancel an identical later subscription', () => {
    vi.setSystemTime(at(2026, 8, 22, 23, 59, 58));
    // Two hosts can hand in the same function — a module-level handler, or the
    // same component reconnected — and the second subscription is live.
    const shared = vi.fn();
    const stale = subscribe(shared);
    stale();
    subscribe(shared);

    stale();
    vi.advanceTimersByTime(3_000);

    expect(shared).toHaveBeenCalledTimes(1);
  });
});

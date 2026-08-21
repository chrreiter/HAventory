import { describe, it, expect, vi } from 'vitest';
import {
  pendingIntervalCount,
  pendingTimeoutCount,
  stopPendingIntervals,
  stopPendingTimeouts,
} from './test.setup';
import { defineCardElement } from './register';

// The suite's own guard rail: an interval that survives its spec file ticks
// into a torn-down jsdom, where vitest counts the ReferenceError as an uncaught
// exception and fails the run with every test passing.
describe('the pending-interval sweep', () => {
  it('stops a swept interval from firing again', async () => {
    const tick = vi.fn();
    window.setInterval(tick, 1);

    stopPendingIntervals();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(tick).not.toHaveBeenCalled();
  });

  it('tracks the card registration recheck and clears it', () => {
    const before = pendingIntervalCount();

    defineCardElement('hv-sweep-probe', class extends HTMLElement {});

    expect(pendingIntervalCount()).toBe(before + 1);
    stopPendingIntervals();
    expect(pendingIntervalCount()).toBe(0);
  });

  it('forgets an interval its owner cleared', () => {
    stopPendingIntervals();

    const timer = window.setInterval(() => {}, 1000);
    expect(pendingIntervalCount()).toBe(1);
    window.clearInterval(timer);

    expect(pendingIntervalCount()).toBe(0);
  });
});

// A `setTimeout` pending at teardown fails the same way an interval does, and
// unlike an interval it also has to leave the set on its own when it fires.
describe('the pending-timeout sweep', () => {
  it('stops a swept timeout from firing', async () => {
    const tick = vi.fn();
    window.setTimeout(tick, 1);

    stopPendingTimeouts();
    // Scheduled after the sweep, so this wait is not the one being cancelled.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(tick).not.toHaveBeenCalled();
  });

  it('forgets a timeout that already fired, without anyone clearing it', async () => {
    stopPendingTimeouts();

    await new Promise((resolve) => setTimeout(resolve, 1));

    // The wait above scheduled one timeout and it has run: only the timeout
    // that is still pending — none — may be counted. Left to the id alone, the
    // set would grow by one for every zero-delay wait a spec file makes.
    expect(pendingTimeoutCount()).toBe(0);
  });

  it('forgets a timeout its owner cleared', () => {
    stopPendingTimeouts();

    const timer = window.setTimeout(() => {}, 1000);
    expect(pendingTimeoutCount()).toBe(1);
    window.clearTimeout(timer);

    expect(pendingTimeoutCount()).toBe(0);
  });

  it('hands the handler the arguments it was scheduled with', () => {
    // The wrapper calls the handler itself, so the extra arguments only survive
    // if it passes them on.
    const seen: unknown[] = [];
    window.setTimeout((...args: unknown[]) => seen.push(...args), 1, 'a', 2);

    return vi.waitFor(() => expect(seen).toEqual(['a', 2]));
  });
});

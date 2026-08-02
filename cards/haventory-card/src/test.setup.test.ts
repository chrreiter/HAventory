import { describe, it, expect, vi } from 'vitest';
import { pendingIntervalCount, stopPendingIntervals } from './test.setup';
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

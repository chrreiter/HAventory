import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce';

// The unit under test *is* a timer, so every case here drives a fake clock:
// waiting out a real 50 ms window can only ever assert "by now", while advancing
// to the millisecond before and the millisecond itself asserts the delay. There
// is no async setup in this file for the fake clock to interfere with, so it is
// installed for the whole describe rather than per test.
describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays function execution by specified ms', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced();
    await vi.advanceTimersByTimeAsync(49);
    expect(fn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent calls', async () => {
    // Multiple rapid calls should only result in one execution, and each call
    // starts the window again rather than shortening it.
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced();
    await vi.advanceTimersByTimeAsync(30);
    debounced(); // Reset timer
    await vi.advanceTimersByTimeAsync(30);
    debounced(); // Reset timer again

    // 60 ms of calls, and nothing has fired: the window is measured from the
    // last one.
    await vi.advanceTimersByTimeAsync(49);
    expect(fn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to wrapped function', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('arg1', 42, { key: 'value' });
    await vi.advanceTimersByTimeAsync(50);

    expect(fn).toHaveBeenCalledWith('arg1', 42, { key: 'value' });
  });

  it('uses arguments from last call when debouncing', async () => {
    // When multiple calls happen, only the last arguments should be used.
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('first');
    debounced('second');
    debounced('third');

    await vi.advanceTimersByTimeAsync(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });
});

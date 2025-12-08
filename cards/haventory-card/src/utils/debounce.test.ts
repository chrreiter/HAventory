import { describe, it, expect, vi } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
  it('delays function execution by specified ms', async () => {
    // Function should not be called until delay has passed
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 60));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent calls', async () => {
    // Multiple rapid calls should only result in one execution
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced();
    await new Promise((r) => setTimeout(r, 30));
    debounced(); // Reset timer
    await new Promise((r) => setTimeout(r, 30));
    debounced(); // Reset timer again

    // Should not have been called yet
    expect(fn).not.toHaveBeenCalled();

    // Wait for final debounce to complete
    await new Promise((r) => setTimeout(r, 60));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to wrapped function', async () => {
    // Arguments should be preserved and passed to the original function
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('arg1', 42, { key: 'value' });
    await new Promise((r) => setTimeout(r, 60));

    expect(fn).toHaveBeenCalledWith('arg1', 42, { key: 'value' });
  });

  it('uses arguments from last call when debouncing', async () => {
    // When multiple calls happen, only the last arguments should be used
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('first');
    debounced('second');
    debounced('third');

    await new Promise((r) => setTimeout(r, 60));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });
});

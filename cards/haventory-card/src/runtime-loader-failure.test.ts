import { vi } from 'vitest';

// A chunk the server no longer has: what an upgrade leaves an open tab holding.
vi.mock('./runtime', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

describe('a runtime that will not load', () => {
  it('reports it, and lets the next element try again', async () => {
    const { loadRuntime, loadedRuntime } = await import('./runtime-loader');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(loadRuntime()).rejects.toThrow();
    await expect(loadRuntime()).rejects.toThrow();

    expect(loadedRuntime()).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

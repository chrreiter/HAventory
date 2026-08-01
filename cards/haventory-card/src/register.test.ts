import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineCardElement } from './register';

// Home Assistant replaces window.customElements during boot; these cover the
// definition landing in whichever registry the dashboard ends up reading.

const realRegistry = window.customElements;

function useRegistry(get: () => CustomElementConstructor | undefined = () => undefined) {
  const define = vi.fn();
  Object.defineProperty(window, 'customElements', {
    value: { define, get: vi.fn(get) } as unknown as CustomElementRegistry,
    configurable: true,
    writable: true,
  });
  return define;
}

afterEach(() => {
  Object.defineProperty(window, 'customElements', {
    value: realRegistry,
    configurable: true,
    writable: true,
  });
  vi.useRealTimers();
});

class Dummy extends HTMLElement {}

describe('defineCardElement', () => {
  it('defines the element in the registry that is current at call time', () => {
    const define = useRegistry();

    defineCardElement('hv-test-card', Dummy);

    expect(define).toHaveBeenCalledWith('hv-test-card', Dummy);
  });

  it('re-defines into a registry the frontend swaps in afterwards', () => {
    vi.useFakeTimers();
    useRegistry();
    defineCardElement('hv-test-card', Dummy);

    const afterSwap = useRegistry();
    vi.advanceTimersByTime(300);

    expect(afterSwap).toHaveBeenCalledWith('hv-test-card', Dummy);
  });

  it('re-defines once and then stops re-checking', () => {
    vi.useFakeTimers();
    useRegistry();
    defineCardElement('hv-test-card', Dummy);

    const afterSwap = useRegistry();
    vi.advanceTimersByTime(300);
    vi.advanceTimersByTime(10_000);

    expect(afterSwap).toHaveBeenCalledTimes(1);
  });

  it('leaves a definition the new registry already has alone', () => {
    vi.useFakeTimers();
    useRegistry();
    defineCardElement('hv-test-card', Dummy);

    const afterSwap = useRegistry(() => Dummy);
    vi.advanceTimersByTime(300);

    expect(afterSwap).not.toHaveBeenCalled();
  });

  it('gives up re-checking once the window has elapsed', () => {
    vi.useFakeTimers();
    useRegistry();
    defineCardElement('hv-test-card', Dummy);

    vi.advanceTimersByTime(20_000);
    const afterLateSwap = useRegistry();
    vi.advanceTimersByTime(1_000);

    expect(afterLateSwap).not.toHaveBeenCalled();
  });
});

// Both of the bundle's Home Assistant-facing elements go through the helper
// above. A bare `customElements.define` would land in whichever registry
// happened to be current and stay there.
describe('the elements Home Assistant instantiates', () => {
  it.each([
    ['./index', 'haventory-card'],
    ['./haventory-panel', 'haventory-panel'],
  ])('registers %s through defineCardElement', async (module, tag) => {
    vi.resetModules();
    const define = useRegistry();

    await import(module);

    expect(define.mock.calls.map(([name]) => name)).toContain(tag);
  });
});

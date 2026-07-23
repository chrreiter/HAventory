// Minimal polyfills for jsdom environment used in Vitest
// Virtualizer depends on ResizeObserver
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || (RO as unknown as typeof ResizeObserver);

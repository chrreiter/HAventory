// Minimal polyfills for jsdom environment used in Vitest
// Virtualizer depends on ResizeObserver
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error global assignment for test env
globalThis.ResizeObserver = globalThis.ResizeObserver || (RO as unknown as typeof ResizeObserver);

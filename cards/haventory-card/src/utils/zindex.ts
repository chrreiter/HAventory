const Z_BASE_START = 10000;
const Z_INCREMENT = 2;
const GLOBAL_KEY = '__haventoryZBase';

declare global {
  interface Window {
    [GLOBAL_KEY]?: number;
  }
}

/**
 * The next base z-index for a modal, so the last one opened sits on top.
 *
 * Allocated in pairs: the backdrop takes this value and the surface takes
 * base + 1. The counter lives on `window` because each card instance has its
 * own module scope but they share one stacking context.
 */
export function nextZBase(): number {
  const stored = window[GLOBAL_KEY];
  const next = (typeof stored === 'number' ? stored : Z_BASE_START) + Z_INCREMENT;
  window[GLOBAL_KEY] = next;
  return next;
}

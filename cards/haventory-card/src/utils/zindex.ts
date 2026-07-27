const Z_BASE_START = 10000;
const Z_INCREMENT = 2;
const GLOBAL_KEY = '__haventoryZBase';

/**
 * The next base z-index for a modal, so the last one opened sits on top.
 *
 * Allocated in pairs: the backdrop takes this value and the surface takes
 * base + 1. The counter lives on `window` because each card instance has its
 * own module scope but they share one stacking context.
 */
export function nextZBase(): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const current: number = typeof w[GLOBAL_KEY] === 'number' ? w[GLOBAL_KEY] : Z_BASE_START;
  const next = current + Z_INCREMENT;
  w[GLOBAL_KEY] = next;
  return next;
}

// Simple global z-index allocator so the last opened modal sits on top.
// Allocates pairs (backdrop, surface) using base and base+1.

const Z_BASE_START = 10000;
const Z_INCREMENT = 2;
const GLOBAL_KEY = '__haventoryZBase';

/**
 * Returns the next base z-index to use for a modal.
 * The backdrop should use this value; the surface should use base + 1.
 */
export function nextZBase(): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const current: number = typeof w[GLOBAL_KEY] === 'number' ? w[GLOBAL_KEY] : Z_BASE_START;
  const next = current + Z_INCREMENT;
  w[GLOBAL_KEY] = next;
  return next;
}

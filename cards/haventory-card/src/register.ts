/**
 * Custom element registration that survives Home Assistant's registry swap.
 *
 * The frontend installs its own CustomElementRegistry while it boots, and a
 * definition made before that stays behind where the dashboard never looks.
 * The bundle can evaluate on either side of the swap, so the definition is
 * re-asserted whenever the current registry is not the one it was made in.
 */

const RECHECK_INTERVAL_MS = 250;
const RECHECK_WINDOW_MS = 15_000;

export function defineCardElement(tag: string, ctor: CustomElementConstructor): void {
  let registeredIn: CustomElementRegistry | undefined;

  const register = (): boolean => {
    const registry = customElements;
    if (registry === registeredIn) return false;
    if (!registry.get(tag)) registry.define(tag, ctor);
    registeredIn = registry;
    return true;
  };

  register();

  if (typeof window === 'undefined') return;

  // The swap happens once, so stop at the first change; the window bounds a cold start.
  const until = Date.now() + RECHECK_WINDOW_MS;
  const timer = window.setInterval(() => {
    if (register() || Date.now() >= until) window.clearInterval(timer);
  }, RECHECK_INTERVAL_MS);
}

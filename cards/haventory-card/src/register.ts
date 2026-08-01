/**
 * Custom element registration that survives Home Assistant's registry swap.
 *
 * The frontend installs its own CustomElementRegistry while it boots. A
 * definition made before that swap stays behind in the registry it replaced,
 * where the dashboard never looks, and the card renders as a "custom element
 * doesn't exist" error instead. Which side of the swap a module lands on is
 * decided by how quickly the browser fetches it — as an extra module URL the
 * card can evaluate either side, and engines disagree about which — so the
 * definition is re-asserted whenever the current registry is no longer the one
 * it was made in.
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

  // The swap happens once, during boot, so the first change observed is also
  // the last: re-assert there and stop. The window bounds the wait on a cold
  // start, where the frontend takes seconds to come up.
  const until = Date.now() + RECHECK_WINDOW_MS;
  const timer = window.setInterval(() => {
    if (register() || Date.now() >= until) window.clearInterval(timer);
  }, RECHECK_INTERVAL_MS);
}

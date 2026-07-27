import type { Location } from '../store/types';

/**
 * How the card writes a location path.
 *
 * The backend stores `display_path` slash-separated ("Garage / Shelf A"); every
 * surface that shows one renders it with "›" instead. Keeping that in one place
 * is the whole point — four components print location paths and the separator is
 * a presentation choice none of them owns.
 */
export function prettyPath(path: string): string {
  return path.replace(/\s*\/\s*/g, ' › ');
}

/**
 * A location's full path for display, or `fallback` when there is no location.
 *
 * Falls back to the bare `name` when the backend sent no path — which happens
 * for a root, where the name *is* the path.
 */
export function locationLabel(loc: Location | null | undefined, fallback: string): string {
  if (!loc) return fallback;
  return prettyPath(loc.path?.display_path ?? loc.name);
}

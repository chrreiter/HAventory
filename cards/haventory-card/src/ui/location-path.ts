import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { icon } from './icons';
import { areaNameById, effectiveAreaIdForLocation } from './area';
import type { AreaRef, Item, Location } from '../store/types';

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

/**
 * Where something is, in the two parts every surface renders differently: the
 * HA area gets the chip below, the path gets whatever type the surface uses.
 */
export interface PathParts {
  /** Resolved area name, or null when the location belongs to no area. */
  areaName: string | null;
  path: string;
}

/**
 * An item's area and path. The area needs no lookup beyond the name: the backend
 * resolves `effective_area_id` per item and ships it on every one.
 *
 * The path is empty for an item filed nowhere, leaving each surface its own
 * wording for that ("No location", "—").
 */
export function itemPathParts(item: Item, areas: readonly AreaRef[]): PathParts {
  return {
    areaName: areaNameById(areas, item.effective_area_id),
    path: prettyPath(item.location_path?.display_path ?? ''),
  };
}

/**
 * A location's area and path. Unlike an item, a location carries no resolved
 * area, so this walks its ancestors for one.
 */
export function locationPathParts(
  loc: Location | null | undefined,
  locations: readonly Location[],
  areas: readonly AreaRef[],
  fallback: string,
): PathParts {
  return {
    areaName: loc ? areaNameById(areas, effectiveAreaIdForLocation(locations, loc.id)) : null,
    path: locationLabel(loc, fallback),
  };
}

/**
 * The same two parts as one string, for a `title` attribute — where the chip's
 * glyph cannot go and the area has to say its own name.
 */
export function pathTitle(parts: PathParts): string {
  return [parts.areaName ? `Area: ${parts.areaName}` : '', parts.path].filter(Boolean).join(' · ');
}

/**
 * The area beside a path, rendered so it cannot be mistaken for one of the
 * path's own segments. Renders nothing when there is no area, so a caller can
 * embed it unguarded.
 *
 * The glyph carries that distinction visually and is decorative, so the word
 * "Area" is spelled out for anyone who cannot see it.
 */
export function renderAreaChip(areaName: string | null): TemplateResult | null {
  if (!areaName) return null;
  return html`<span class="hv-area-chip" data-testid="area-chip"
    >${icon('home', 12)}<span class="hv-sr-only">Area: </span>${areaName}</span
  >`;
}

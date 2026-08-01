import type { AreaRef, Location } from '../store/types';

/**
 * Resolving the HA area behind a location, the way the backend does.
 *
 * Items arrive with `effective_area_id` already resolved, so item-facing
 * surfaces only need the id-to-name half. Location-facing ones (pickers, filter
 * chips, tree grouping) have a location and must resolve the area themselves.
 */

/**
 * An area's display name, or the raw id when the area cache has no entry for it.
 *
 * A stale id still names something: HA can drop an area from its registry while
 * locations continue to reference it, and a blank there would read as "no area"
 * — the one thing it is not.
 */
export function areaNameById(
  areas: readonly AreaRef[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return areas.find((a) => a.id === id)?.name ?? id;
}

/**
 * The area a location belongs to: the first non-null `area_id` from the location
 * up through its ancestors.
 *
 * Mirrors the backend's own resolution. Assigning an area moves it to the root
 * of the location's tree and clears it from every node below, so a nested
 * location's area is never stored on the location itself.
 */
export function effectiveAreaIdForLocation(
  locations: readonly Location[],
  id: string | null,
): string | null {
  if (!id) return null;
  const byId = new Map(locations.map((l) => [l.id, l]));
  let cursor: string | null = id;
  // No honest walk visits more nodes than exist, so a longer one is a parent
  // cycle: bail out with no area rather than spinning.
  for (let step = 0; cursor !== null && step <= byId.size; step += 1) {
    const loc: Location | undefined = byId.get(cursor);
    if (!loc) return null;
    const area = loc.area_id ?? null;
    if (area !== null) return area;
    cursor = loc.parent_id;
  }
  return null;
}

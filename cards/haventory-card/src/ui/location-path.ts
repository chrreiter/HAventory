import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { icon } from './icons';
import { areaNameById, effectiveAreaIdForLocation } from './area';
import type { AreaRef, Item, Location } from '../store/types';

/** The backend stores `display_path` slash-separated; every surface shows it with "›". */
export const PATH_SEPARATOR = ' › ';

export function prettyPath(path: string): string {
  return path.replace(/\s*\/\s*/g, PATH_SEPARATOR);
}

/** A location's full path for display, or `fallback` when there is no location. */
export function locationLabel(loc: Location | null | undefined, fallback: string): string {
  if (!loc) return fallback;
  return prettyPath(loc.path?.display_path ?? loc.name);
}

/** Where something is: the HA area (drawn as a chip) and the path. */
export interface PathParts {
  /** Resolved area name, or null when the location belongs to no area. */
  areaName: string | null;
  path: string;
}

/** An item's area (resolved per item by the backend) and path, empty when filed nowhere. */
export function itemPathParts(item: Item, areas: readonly AreaRef[]): PathParts {
  return {
    areaName: areaNameById(areas, item.effective_area_id),
    path: prettyPath(item.location_path?.display_path ?? ''),
  };
}

/** A location's area, walked up its ancestors, and path. */
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

/** Both parts as one string for a `title`, which never elides the area. */
export function pathTitle(parts: PathParts): string {
  return [parts.areaName ? t('hv.area.prefix', { name: parts.areaName }) : '', parts.path]
    .filter(Boolean)
    .join(' · ');
}

/** Both parts as a visible label, dropping an area the path already names (see `areaMarkName`). */
export function pathLabel(parts: PathParts): string {
  return pathTitle({ ...parts, areaName: areaMarkName(parts.areaName, parts.path) });
}

/**
 * A path as one element per segment, so a surface can break it between names
 * rather than mid-word. The separator rides inside the segment ahead of it, so
 * no line opens with a lone "›"; `.hv-path-sep` must protect its spaces.
 */
export function renderPathSegments(path: string): TemplateResult[] {
  const segments = path.split(PATH_SEPARATOR);
  return segments.map(
    (segment, i) =>
      html`<span class="hv-path-seg"
        >${segment}${i < segments.length - 1
          ? html`<span class="hv-path-sep">${PATH_SEPARATOR}</span>`
          : null}</span
      >`,
  );
}

/**
 * Drop the middle of a long path so the root and the leaf survive one phone
 * line (about 200px, which three segments already overrun).
 */
export function elidePath(path: string, maxSegments = 2): string {
  const segments = path.split(PATH_SEPARATOR);
  if (segments.length <= maxSegments) return path;
  return `${segments[0]}${PATH_SEPARATOR}…${PATH_SEPARATOR}${segments[segments.length - 1]}`;
}

/**
 * A one-line location with the area elided as its leading segment, then taken
 * back off for the caller to mark rather than punctuate. An area name containing
 * ` › ` cannot be taken off safely, so the whole string comes back as `rest`.
 */
export function elideMobilePath(
  areaName: string | null,
  path: string,
): { area: string | null; rest: string } {
  const composed = elidePath([areaName, path].filter(Boolean).join(PATH_SEPARATOR));
  if (!areaName) return { area: null, rest: composed };
  if (composed === areaName) return { area: areaName, rest: '' };
  const prefix = `${areaName}${PATH_SEPARATOR}`;
  if (!composed.startsWith(prefix)) return { area: null, rest: composed };
  return { area: areaName, rest: composed.slice(prefix.length) };
}

/** The area worth marking beside a path, or null when the path's root already names it. */
export function areaMarkName(areaName: string | null, path: string): string | null {
  if (!areaName) return null;
  return path.split(PATH_SEPARATOR)[0].trim() === areaName.trim() ? null : areaName;
}

/**
 * The area beside a path, marked so it is not read as a segment; nothing when
 * there is no area. The name has its own element so `ui/chip` can elide it.
 */
export function renderAreaChip(areaName: string | null): TemplateResult | null {
  if (!areaName) return null;
  return html`<span class="hv-area-chip" data-testid="area-chip"
    >${icon('home', 12)}<span class="hv-sr-only">${t('hv.area.srPrefix')}</span
    ><span class="hv-chip-text">${areaName}</span></span
  >`;
}

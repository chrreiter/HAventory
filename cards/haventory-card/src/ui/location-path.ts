import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
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
/** What a path is written with once `prettyPath` has been over it. */
export const PATH_SEPARATOR = ' › ';

export function prettyPath(path: string): string {
  return path.replace(/\s*\/\s*/g, PATH_SEPARATOR);
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
  return [parts.areaName ? t('hv.area.prefix', { name: parts.areaName }) : '', parts.path]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The same two parts for a label the reader sees, where the area is dropped once
 * the path has already said it — the rule `areaMarkName` applies to the chip,
 * applied to the surfaces that name the area in words instead of a chip.
 *
 * The two are a pair and differ in exactly that: a `title` is where the unelided
 * pairing lives, so it never elides, and a label beside it does.
 */
export function pathLabel(parts: PathParts): string {
  return pathTitle({ ...parts, areaName: areaMarkName(parts.areaName, parts.path) });
}

/**
 * A path as one element per segment, for a surface that gives it more than one
 * line rather than cutting it off at the edge of its box.
 *
 * A path elided as plain text breaks wherever the pixels run out, which leaves
 * a stub of a location name — "Küc…" — that names nothing a reader can act on.
 * One element per segment gives the surface a set of places it is allowed to
 * break, and its own CSS decides whether they wrap or shrink.
 *
 * The separator travels *inside* the segment ahead of it, so a break can never
 * open a line with a lone "›". It keeps its spaces so the path still reads as
 * one string when copied or announced, and the surface styling `.hv-path-sep`
 * has to protect those spaces where a break would otherwise drop them.
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
 * Drop the middle of a long path so both ends survive one line.
 *
 * A path reads root-first and clips from the right, so on a phone the half that
 * goes is the half worth keeping: "Workshop › Parts Cabinet › Drawer A › Small
 * Bin" rendered as "Workshop › Parts Cabinet › D…", naming the room but not the
 * drawer or the bin the item is actually in. The root still says which room and
 * the leaf says where in it; the ancestors between them are what a phone can
 * afford to lose, and the detail sheet still shows the path in full.
 *
 * Two, not three: a phone row has about 200px for this line, and a real
 * three-segment path ("Workshop › Parts Cabinet › Drawer A", plus a category
 * after it) needs well over that — so at three it still clipped the leaf off
 * the end, which is the whole thing this is here to prevent.
 *
 * The counterpart to {@link renderPathSegments}: a surface that can give a path
 * more than one line keeps every segment, one that has exactly one elides here.
 */
export function elidePath(path: string, maxSegments = 2): string {
  const segments = path.split(PATH_SEPARATOR);
  if (segments.length <= maxSegments) return path;
  return `${segments[0]}${PATH_SEPARATOR}…${PATH_SEPARATOR}${segments[segments.length - 1]}`;
}

/**
 * A one-line location, with the area separated back out of the front of it.
 *
 * The area has to travel through `elidePath` as the leading segment — that is
 * the half the elision keeps — but it is Home Assistant's, not one of our
 * locations, and the `›` after it reads as though it were one. So the line is
 * composed and elided exactly as it is shown, then the leading segment is taken
 * back off for the caller to mark instead of punctuate.
 *
 * An area name that itself contains ` › ` lands as two segments and the elided
 * string no longer starts with it. Then there is nothing safe to mark and the
 * whole string comes back as `rest`, which renders as the line always did
 * rather than putting the mark on the wrong words.
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

/**
 * The area worth marking beside a path, or nothing.
 *
 * Naming a root location after the area it stands in is the most natural thing
 * a household does — an area "Kitchen" holding a location "Kitchen" — and the
 * surface then prints the same word twice with only a chip's edge between them.
 * When the path's first segment already is the area, the path has said it, and
 * the mark is dropped. The full pairing survives in the `title`, which is where
 * the unelided truth lives either way.
 *
 * Every surface that hangs an area chip beside a path goes through this, so the
 * mark says the same thing on a card row as in the full view's table.
 */
export function areaMarkName(areaName: string | null, path: string): string | null {
  if (!areaName) return null;
  return path.split(PATH_SEPARATOR)[0].trim() === areaName.trim() ? null : areaName;
}

/**
 * The area beside a path, rendered so it cannot be mistaken for one of the
 * path's own segments. Renders nothing when there is no area, so a caller can
 * embed it unguarded.
 *
 * The glyph carries that distinction visually and is decorative, so the word
 * "Area" is spelled out for anyone who cannot see it.
 *
 * The name sits in its own element because a household writes it and it can
 * outrun the box the chip lands in: that element is what the shared rule in
 * `ui/chip` elides, and text-overflow has nothing to act on without it.
 */
export function renderAreaChip(areaName: string | null): TemplateResult | null {
  if (!areaName) return null;
  return html`<span class="hv-area-chip" data-testid="area-chip"
    >${icon('home', 12)}<span class="hv-sr-only">${t('hv.area.srPrefix')}</span
    ><span class="hv-chip-text">${areaName}</span></span
  >`;
}

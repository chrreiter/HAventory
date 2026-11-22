/**
 * How a `hass.language` tag picks a language, apart from the dictionaries
 * themselves: the entry picks the loader's copy with it before the catalogs
 * have loaded, so this module imports none of them.
 */

/** The language every dictionary is complete for, and the fallback for the rest. */
export const FALLBACK_LANGUAGE = 'en';

/** Exact tag first, then the primary subtag, then English. */
export function resolveTag(tag: string | null | undefined, known: Readonly<Record<string, unknown>>): string {
  if (!tag) return FALLBACK_LANGUAGE;
  const exact = tag.toLowerCase();
  if (exact in known) return exact;
  const primary = exact.split('-')[0];
  if (primary && primary in known) return primary;
  return FALLBACK_LANGUAGE;
}

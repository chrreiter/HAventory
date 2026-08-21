/**
 * The card's copy, in one place per language.
 *
 * Home Assistant tells a card which language the user reads in `hass.language`,
 * and that is the only input: there is no per-card language option, because a
 * dashboard is read by the same person who set the profile.
 *
 * A module singleton rather than a Lit context or a threaded property. Half the
 * card's copy lives in plain functions with no host element — `ui/empty-state`,
 * `ui/health-codes`, `ui/plural`, `describeFailure` in `hv-bulk-bar` — and a
 * context cannot reach any of them without a signature change at every call
 * site. The language is fixed for the lifetime of a page, so a singleton gives
 * up nothing: `setLanguage` reports whether the value actually moved, and the
 * two hosts call `requestUpdate()` when it did.
 *
 * Adding a language is one file here and one `translations/<tag>.json` for the
 * backend; `CONTRIBUTING.md` carries the recipe.
 */

import { en } from './en';
import type { Dictionary, PluralKey, TranslationKey } from './en';
import { de } from './de';

export type { Dictionary, PluralKey, TranslationKey };

/** What a placeholder may be filled with. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/**
 * Every dictionary this bundle carries, keyed by lower-case BCP-47 tag.
 *
 * Lower-case because `resolveLanguage` compares against a lower-cased tag: Home
 * Assistant sends `de-CH` and a registry keyed `de-ch` is what lets a regional
 * dictionary be found by an exact match rather than only through its primary
 * subtag.
 */
export const DICTIONARIES: Readonly<Record<string, Dictionary>> = { en, de };

/** The language every dictionary is complete for, and the fallback for the rest. */
export const FALLBACK_LANGUAGE = 'en';

/**
 * The dictionary a Home Assistant language tag resolves to.
 *
 * Exact tag first, then the primary subtag, then English: a user reading
 * `de-CH` gets the German dictionary rather than falling all the way back, and
 * a tag nothing here carries degrades to a language that is complete instead of
 * to a screen of keys.
 */
export function resolveLanguage(tag: string | null | undefined): string {
  if (!tag) return FALLBACK_LANGUAGE;
  const exact = tag.toLowerCase();
  if (exact in DICTIONARIES) return exact;
  const primary = exact.split('-')[0];
  if (primary && primary in DICTIONARIES) return primary;
  return FALLBACK_LANGUAGE;
}

let current = FALLBACK_LANGUAGE;
let active: Dictionary = en;

/**
 * Point the card at a language.
 *
 * Returns whether the resolved language changed, so a host can re-render on the
 * one `set hass` that moves it and not on the hundreds that do not.
 */
export function setLanguage(tag: string | null | undefined): boolean {
  const next = resolveLanguage(tag);
  if (next === current) return false;
  current = next;
  active = DICTIONARIES[next] ?? en;
  return true;
}

/** The resolved language in force, never a tag no dictionary answers to. */
export function language(): string {
  return current;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fill `{name}` placeholders from `params`.
 *
 * A placeholder with no parameter is left standing rather than blanked: a
 * sentence with a visible `{count}` in it names the bug, where a sentence
 * quietly missing its number reads as finished copy that says the wrong thing.
 */
function interpolate(template: string, params: TranslationParams): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * One string, in the language in force.
 *
 * A key the active dictionary has not translated falls through to English
 * rather than rendering the key itself: a partial dictionary — which is what a
 * community contribution is on the day it arrives — then shows a mixed screen
 * instead of `hv.item.save`.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = active[key] ?? en[key];
  return params ? interpolate(template, params) : template;
}

/**
 * One counted string, in the language in force.
 *
 * Two forms, `<key>.one` and `<key>.other`, because that is the split English
 * and German share for every noun the card counts. `Intl.PluralRules` would add
 * a category axis every dictionary has to fill and answer a question neither of
 * these two languages asks.
 *
 * `count` is passed through as a parameter, so a form can place the number
 * wherever its language puts it — or leave it out, which is what "täglich" for
 * "every 1 days" does.
 */
export function tn(key: PluralKey, count: number, params?: TranslationParams): string {
  const form = `${key}.${count === 1 ? 'one' : 'other'}` as TranslationKey;
  return t(form, { count, ...params });
}

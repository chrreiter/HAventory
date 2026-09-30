/**
 * The card's copy, one dictionary per language, chosen by `hass.language`.
 *
 * A module singleton rather than a Lit context, because much of the copy lives
 * in plain functions with no host element. The language is fixed for a page's
 * lifetime; `setLanguage` reports a change so the two hosts can re-render.
 * `CONTRIBUTING.md` → "Adding a language" carries the recipe.
 */

import { en } from './en';
import type { CompleteDictionary, Dictionary, PluralForm, PluralKey, TranslationKey } from './en';
import { de } from './de';

export type { CompleteDictionary, Dictionary, PluralForm, PluralKey, TranslationKey };

export type TranslationParams = Readonly<Record<string, string | number>>;

/** Keyed by lower-case BCP-47 tag, so a regional `de-CH` can match exactly. */
export const DICTIONARIES: Readonly<Record<string, Dictionary>> = { en, de };

/** The language every dictionary is complete for, and the fallback for the rest. */
export const FALLBACK_LANGUAGE = 'en';

/** Exact tag first, then the primary subtag, then English. */
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

/** Point the card at a language; returns whether the resolved language changed. */
export function setLanguage(tag: string | null | undefined): boolean {
  const next = resolveLanguage(tag);
  if (next === current) return false;
  current = next;
  active = DICTIONARIES[next] ?? en;
  return true;
}

/** The resolved language in force. */
export function language(): string {
  return current;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Fill `{name}` placeholders; one with no parameter is left standing so the bug shows. */
function interpolate(template: string, params: TranslationParams): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** One string in the language in force; an untranslated key falls through to English. */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = active[key] ?? en[key];
  return params ? interpolate(template, params) : template;
}

/**
 * One counted string. `Intl.PluralRules` picks `<key>.<category>`, falling back
 * to `<key>.other` and then English. `count` is a parameter, so a form may place
 * the number anywhere or leave it out.
 */
export function tn(key: PluralKey, count: number, params?: TranslationParams): string {
  const form = `${key}.${new Intl.PluralRules(language()).select(count)}` as PluralForm;
  const other = `${key}.other` as const;
  const template = active[form] ?? active[other] ?? (en as Dictionary)[form] ?? en[other];
  return interpolate(template, { count, ...params });
}

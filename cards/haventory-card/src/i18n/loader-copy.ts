import type { TranslationKey } from './en';
import { FALLBACK_LANGUAGE, resolveTag } from './resolve';

/**
 * What a host's placeholder says once the runtime will not load.
 *
 * The catalogs are in the runtime chunk, the file that failed when this text
 * shows, and importing a dictionary here would pull it whole into the core
 * chunk every Home Assistant page loads. So the build copies every key under
 * `hv.loader.` out of each registered dictionary into `__HV_LOADER_COPY__`
 * (`vite.config.ts`), and this module reads that copy.
 */
export type LoaderKey = Extract<TranslationKey, `hv.loader.${string}`>;

/** Per language tag, the loader strings its dictionary carries. */
type LoaderCopy = Readonly<Record<string, Partial<Record<LoaderKey, string>>>>;

declare const __HV_LOADER_COPY__: LoaderCopy;

/**
 * One loader string in the language `tag` resolves to, chosen by the rule
 * `t()`'s dictionary is, and English where that language has not reached it.
 */
export function loaderText(key: LoaderKey, tag: string | null | undefined): string {
  const copy = __HV_LOADER_COPY__;
  return copy[resolveTag(tag, copy)]?.[key] ?? copy[FALLBACK_LANGUAGE]?.[key] ?? key;
}

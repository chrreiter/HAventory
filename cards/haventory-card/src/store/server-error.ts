/**
 * The words for a refusal the backend sent.
 *
 * Every error envelope carries an English `message`. One the backend can name
 * also carries `translation_domain`, `translation_key` and
 * `translation_placeholders`, under the names Home Assistant's own envelope
 * uses, and the card keeps a sentence for each key under `hv.serverError.*`.
 */

import { en } from '../i18n/en';
import { t } from '../i18n';
import type { TranslationKey, TranslationParams } from '../i18n';

/** The integration's own domain; another one's key is not this catalog's to read. */
const SERVER_ERROR_DOMAIN = 'haventory';

/**
 * What a rejected call says, in the language in force.
 *
 * A refusal whose key this catalog knows reads from it, filled with the
 * server's placeholders. Anything else shows the server's English `message`,
 * and a rejection with neither shows `fallback`, so a key from a newer backend
 * never reaches the screen as a key.
 */
export function serverErrorText(err: unknown, fallback: string): string {
  const e = err as
    | {
        message?: unknown;
        translation_domain?: unknown;
        translation_key?: unknown;
        translation_placeholders?: unknown;
      }
    | null
    | undefined;
  const raw = e?.translation_key;
  const domain = e?.translation_domain;
  if (typeof raw === 'string' && (domain === undefined || domain === SERVER_ERROR_DOMAIN)) {
    const key = `hv.serverError.${raw}`;
    if (key in en) {
      const placeholders = e?.translation_placeholders;
      const params = placeholders && typeof placeholders === 'object' ? (placeholders as TranslationParams) : {};
      return t(key as TranslationKey, params);
    }
  }
  const message = e?.message;
  return typeof message === 'string' && message ? message : fallback;
}

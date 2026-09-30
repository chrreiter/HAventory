/**
 * The card's count strings, one dictionary pair per noun. A count inside a
 * sentence gets a key for the whole sentence instead.
 */

import { tn } from '../i18n';
import type { PluralKey } from '../i18n';

/** Every noun the card counts, read off the `hv.count.*` keys. */
export type CountNoun = {
  [K in PluralKey]: K extends `hv.count.${infer Noun}` ? Noun : never;
}[PluralKey];

/** The count and its noun: `counted(1, 'item')` → "1 item". */
export function counted(count: number, noun: CountNoun): string {
  return tn(`hv.count.${noun}`, count);
}

/**
 * The line under a list saying how much of the set is on screen, shared by the
 * card and the expanded view. `total` counts the filter's matches, null until
 * priced. A total behind the loaded rows (an event added one since) cannot be
 * true, so then only the rows on screen are counted.
 */
export function showingCount(
  loaded: number,
  total: number | null | undefined,
  filtered = false,
): string {
  if (total === null || total === undefined || total < loaded) {
    return tn('hv.list.showingAll', loaded);
  }
  return tn(filtered ? 'hv.list.showingOfMatching' : 'hv.list.showingOf', total, { loaded });
}

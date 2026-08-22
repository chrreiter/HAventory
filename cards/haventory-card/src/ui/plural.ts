/**
 * The card's count strings.
 *
 * Roughly half of them agreed with their number and half did not: the location
 * tree said "1 item" while the bulk bar, three components away, said "Move 1
 * items to" — and the organize dialog managed both, on adjacent rows. Every one
 * of those was a hand-written `n === 1 ? '' : 's'`, so the drift was inevitable
 * rather than careless.
 *
 * The forms now come from the dictionaries, one pair per noun, which is also
 * the only way a language that does not build its plural by appending a letter
 * can have one. A count *inside* a sentence does not come through here at all —
 * it gets a key for the whole sentence, because where the number sits and what
 * the verb does with it are the sentence's business, not the noun's.
 */

import { tn } from '../i18n';
import type { PluralKey } from '../i18n';

/**
 * Every noun the card counts on its own, read off the key universe — so a
 * `hv.count.*` pair added to the dictionaries is immediately callable, and one
 * removed stops compiling at its call sites.
 */
export type CountNoun = {
  [K in PluralKey]: K extends `hv.count.${infer Noun}` ? Noun : never;
}[PluralKey];

/** The count and its noun: `counted(1, 'item')` → "1 item". */
export function counted(count: number, noun: CountNoun): string {
  return tn(`hv.count.${noun}`, count);
}

/**
 * The line under a list saying how much of the set is on screen.
 *
 * The card and the expanded view report the same fact about the same store, so
 * they say it in the same words — and the words name what is being counted,
 * which a bare "Showing 50 of 60" never did. `total` is what matches the active
 * filters, so with any of them on the noun says so; null means the server has
 * not priced the set yet. A surface may append its own suffix (the expanded
 * view offers "scroll to load more"), but not rephrase this.
 *
 * The two numbers are read at different moments — the total off a list reply,
 * the rows including whatever a subscription event has added since — so they
 * can disagree, and a total behind the rows would print a line that cannot be
 * true ("Showing 1 of 0 matching items"). Then the count of what is on screen
 * is the part still worth saying, and the claim about the match set is dropped
 * rather than repaired with a number nothing stands behind.
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

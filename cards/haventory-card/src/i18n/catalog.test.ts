import { DICTIONARIES } from './index';
import { en } from './en';

const enKeys = new Set<string>(Object.keys(en));
const PLACEHOLDER = /\{(\w+)\}/g;

/** Every category `Intl.PluralRules` can name, which is what a key may end in. */
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** The counted keys, by base: everything English writes an `.other` for. */
const PLURAL_BASES = new Set(
  [...enKeys].filter((key) => key.endsWith('.other')).map((key) => key.slice(0, -'.other'.length)),
);

/** A key's base and category, or null when it is not a counted form at all. */
function pluralForm(key: string): { base: string; category: string } | null {
  const cut = key.lastIndexOf('.');
  const base = key.slice(0, cut);
  const category = key.slice(cut + 1);
  if (!CATEGORIES.includes(category) || !PLURAL_BASES.has(base)) return null;
  return { base, category };
}

/**
 * The English a dictionary's value stands in for.
 *
 * A language may carry a category English does not — Polish needs `few` — and
 * the English it replaces is then the `.other` form, which is what `tn` would
 * have fallen back to.
 */
function englishFor(key: string): string | undefined {
  if (enKeys.has(key)) return en[key as keyof typeof en];
  const form = pluralForm(key);
  return form ? en[`${form.base}.other` as keyof typeof en] : undefined;
}

function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER)].map((m) => m[1]));
}

/**
 * Languages that claim to answer every key, and are checked for it.
 *
 * A dictionary outside this list may be half-finished — `t` falls through to
 * English — and is still held to the checks below that apply to any dictionary.
 */
const COMPLETE = ['de'];

/**
 * Per language, the values that are identical to the English on purpose.
 *
 * Some words are the same in both languages — a product name, a borrowed term,
 * a symbol — and those are listed here so that being identical is a decision
 * somebody took rather than a key pasted across and forgotten.
 */
const IDENTICAL_TO_ENGLISH: Readonly<Record<string, readonly string[]>> = {
  de: [
    // Loan words and international terms German uses unchanged.
    'hv.bottomSheet.label',
    'hv.editor.type.string',
    'hv.surfaces.badge.offline',
    'hv.field.name',
    'hv.field.status',
    'hv.term.id',
    // Nothing but placeholders and punctuation — there is no word to move.
    'hv.editor.upload.progress',
    'hv.sheet.updatedValue',
    'hv.chips.status',
    'hv.chips.dated',
    'hv.diagnostics.noIssuesDetail',
  ],
};

describe('the key universe', () => {
  it('answers every counted key with `.other`', () => {
    // `tn` asks `Intl.PluralRules` for a category and falls back to `.other`,
    // then to English. A base English writes no `.other` for is a string that
    // renders as nothing at the count nobody tested with.
    for (const key of enKeys) {
      const cut = key.lastIndexOf('.');
      if (!CATEGORIES.includes(key.slice(cut + 1))) continue;
      expect([key, enKeys.has(`${key.slice(0, cut)}.other`)]).toEqual([key, true]);
    }
  });
});

describe.each(Object.entries(DICTIONARIES).filter(([tag]) => tag !== 'en'))(
  'the %s dictionary',
  (tag, dictionary) => {
    it('carries no key English has dropped', () => {
      // A rename leaves the old key behind in every other dictionary, where it
      // is dead weight nothing reads and nothing else notices. A counted form
      // English has no word for — Polish `few` — is not one of those.
      const orphans = Object.keys(dictionary).filter(
        (key) => !enKeys.has(key) && !pluralForm(key),
      );
      expect(orphans).toEqual([]);
    });

    it('repeats the placeholders of the English it replaces', () => {
      // A typo'd placeholder renders literally in the middle of a sentence,
      // and a dropped one silently loses the number the sentence is about.
      for (const [key, value] of Object.entries(dictionary)) {
        expect([key, [...placeholders(value as string)].sort()]).toEqual([
          key,
          [...placeholders(englishFor(key) ?? '')].sort(),
        ]);
      }
    });

    it('translates every string rather than copying the English', () => {
      const untranslated = Object.entries(dictionary)
        .filter(([key, value]) => value === englishFor(key))
        .map(([key]) => key);
      expect(untranslated.sort()).toEqual([...(IDENTICAL_TO_ENGLISH[tag] ?? [])].sort());
    });
  },
);

describe.each(COMPLETE)('the %s dictionary', (tag) => {
  it('is complete', () => {
    // Not implied by the type: `CompleteDictionary` is what makes an omission a
    // compile error, and this is what makes it a red test for anyone reading
    // the suite rather than the compiler output. A counted key is owed `.other`
    // and nothing else — a language that does not inflect the noun writes one
    // form, and `tn` reaches it for every count.
    const dictionary = DICTIONARIES[tag];
    const missing = [...enKeys].filter((key) => {
      if (key in dictionary) return false;
      const form = pluralForm(key);
      return !form || form.category === 'other';
    });
    expect(missing).toEqual([]);
  });
});

import { DICTIONARIES } from './index';
import { en } from './en';
import { de } from './de';

const enKeys = new Set(Object.keys(en));
const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER)].map((m) => m[1]));
}

describe('the key universe', () => {
  it('pairs every counted key', () => {
    // `tn` builds `<key>.one` / `<key>.other` at the call site, so a pair with
    // one half missing is a string that renders as nothing at the count nobody
    // tested with.
    for (const key of enKeys) {
      if (key.endsWith('.one')) expect(enKeys).toContain(`${key.slice(0, -4)}.other`);
      if (key.endsWith('.other')) expect(enKeys).toContain(`${key.slice(0, -6)}.one`);
    }
  });
});

describe.each(Object.entries(DICTIONARIES).filter(([tag]) => tag !== 'en'))(
  'the %s dictionary',
  (_tag, dictionary) => {
    it('carries no key English has dropped', () => {
      // A rename leaves the old key behind in every other dictionary, where it
      // is dead weight nothing reads and nothing else notices.
      expect(Object.keys(dictionary).filter((key) => !enKeys.has(key))).toEqual([]);
    });

    it('repeats the placeholders of the English it replaces', () => {
      // A typo'd placeholder renders literally in the middle of a sentence,
      // and a dropped one silently loses the number the sentence is about.
      for (const [key, value] of Object.entries(dictionary)) {
        const english = en[key as keyof typeof en];
        expect([key, [...placeholders(value as string)].sort()]).toEqual([
          key,
          [...placeholders(english)].sort(),
        ]);
      }
    });
  },
);

describe('the German dictionary', () => {
  it('is complete', () => {
    // Not implied by the type: `Record<TranslationKey, string>` is what makes
    // an omission a compile error, and this is what makes it a red test for
    // anyone reading the suite rather than the compiler output.
    expect(Object.keys(de).sort()).toEqual([...enKeys].sort());
  });

  it('translates every string rather than copying the English', () => {
    // Some words are the same in both languages — a product name, a borrowed
    // term, a symbol — and those are listed here so that being identical is a
    // decision somebody took rather than a key pasted across and forgotten.
    const SAME_IN_BOTH: string[] = [];
    const untranslated = Object.entries(de)
      .filter(([key, value]) => value === en[key as keyof typeof en])
      .map(([key]) => key);
    expect(untranslated.sort()).toEqual(SAME_IN_BOTH.sort());
  });
});

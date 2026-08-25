import { DICTIONARIES, language, resolveLanguage, setLanguage, t, tn } from './index';
import type { Dictionary, PluralKey } from './index';
import { en } from './en';

describe('resolveLanguage', () => {
  it('takes an exact tag', () => {
    expect(resolveLanguage('de')).toBe('de');
    expect(resolveLanguage('DE')).toBe('de');
  });

  it('falls back through the primary subtag', () => {
    // Home Assistant reports a regional profile as `de-CH`; nothing here
    // carries one, and Swiss German readers get German rather than English.
    expect(resolveLanguage('de-CH')).toBe('de');
  });

  it('falls back to English for anything else', () => {
    expect(resolveLanguage('sv')).toBe('en');
    expect(resolveLanguage('')).toBe('en');
    expect(resolveLanguage(null)).toBe('en');
    expect(resolveLanguage(undefined)).toBe('en');
  });
});

describe('setLanguage', () => {
  it('reports only the changes, so a host re-renders once and not on every hass', () => {
    expect(setLanguage('de')).toBe(true);
    expect(setLanguage('de')).toBe(false);
    // Two tags that resolve to the same dictionary are not a change either.
    expect(setLanguage('de-AT')).toBe(false);
    expect(setLanguage('en')).toBe(true);
  });

  it('reports what it resolved to, never the tag it was handed', () => {
    setLanguage('de-CH');
    expect(language()).toBe('de');
  });
});

describe('t', () => {
  it('answers in the language in force', () => {
    expect(t('hv.action.refresh')).toBe('Refresh');
    setLanguage('de');
    expect(t('hv.action.refresh')).toBe('Aktualisieren');
  });

  it('fills placeholders', () => {
    expect(t('hv.empty.emptyLocation.headline', { location: 'Garage' })).toBe('Nothing in Garage');
    expect(t('hv.form.error.nameTooLong', { max: 200 })).toBe('Name is limited to 200 characters.');
  });

  it('leaves a placeholder standing when nothing fills it', () => {
    // Visible in the UI on purpose: a sentence quietly missing its number
    // reads as finished copy that says the wrong thing.
    expect(t('hv.empty.emptyLocation.headline')).toBe('Nothing in {location}');
  });

  it('falls back to English for a key a dictionary has not reached yet', () => {
    // What a community dictionary looks like on the day it arrives: a handful
    // of keys, and everything else still English rather than `hv.action.retry`
    // printed on a button.
    const partial: Dictionary = { 'hv.action.refresh': 'Rafraîchir' };
    (DICTIONARIES as Record<string, Dictionary>).fr = partial;
    try {
      setLanguage('fr');
      expect(t('hv.action.refresh')).toBe('Rafraîchir');
      expect(t('hv.action.retry')).toBe('Try again');
    } finally {
      delete (DICTIONARIES as Record<string, Dictionary>).fr;
    }
  });
});

describe('tn', () => {
  it('picks the form the count asks for', () => {
    expect(tn('hv.count.item', 1)).toBe('1 item');
    expect(tn('hv.count.item', 0)).toBe('0 items');
    expect(tn('hv.count.item', 2)).toBe('2 items');
  });

  it('lets a form place the number where its language puts it, or leave it out', () => {
    setLanguage('de');
    expect(tn('hv.reminder.every.days', 1)).toBe('täglich');
    expect(tn('hv.reminder.every.days', 3)).toBe('alle 3 Tage');
  });

  it('carries extra parameters into the chosen form', () => {
    expect(tn('hv.rewrite.tag.remove', 2, { from: 'winter' })).toBe(
      'Removes "winter" from 2 items.',
    );
  });

  it('renders every counted string the way a one/other split rendered it', () => {
    // `Intl.PluralRules` is a wider mechanism than the two forms it reads, and
    // the point of it is a language whose rules differ. For a language whose
    // rules agree with the split — which is every language shipping today —
    // nothing may move, so this walks every registered dictionary and every
    // counted key at the three counts that separate the two forms.
    const bases = [...new Set(Object.keys(en).filter((key) => key.endsWith('.other')))].map(
      (key) => key.slice(0, -'.other'.length) as PluralKey,
    );
    for (const [tag, dictionary] of Object.entries(DICTIONARIES)) {
      const rules = new Intl.PluralRules(tag);
      setLanguage(tag);
      for (const count of [0, 1, 2]) {
        if (rules.select(count) !== (count === 1 ? 'one' : 'other')) continue;
        for (const base of bases) {
          const half = `${base}.${count === 1 ? 'one' : 'other'}`;
          const before = (dictionary[half as keyof Dictionary] ??
            dictionary[`${base}.other` as keyof Dictionary] ??
            en[half as keyof typeof en]) as string;
          expect([tag, half, tn(base, count)]).toEqual([
            tag,
            half,
            before.replace('{count}', String(count)),
          ]);
        }
      }
    }
    setLanguage('en');
  });

  it('asks the language which form a count wants, not English', () => {
    // French counts zero as singular. Nothing about that is knowable from the
    // English pair, which is the whole reason the categories come from `Intl`.
    const fr: Dictionary = {
      'hv.count.item.one': '{count} objet',
      'hv.count.item.other': '{count} objets',
    };
    withDictionary('fr', fr, () => {
      expect(tn('hv.count.item', 0)).toBe('0 objet');
      expect(tn('hv.count.item', 2)).toBe('2 objets');
    });
  });

  it('reaches a category no English key has', () => {
    // Polish splits where English does not: `few` for 2–4, `many` above it.
    // The dictionary type has to admit the form or this cannot be written.
    const pl: Dictionary = {
      'hv.count.item.one': '{count} przedmiot',
      'hv.count.item.few': '{count} przedmioty',
      'hv.count.item.many': '{count} przedmiotów',
      'hv.count.item.other': '{count} przedmiotu',
    };
    withDictionary('pl', pl, () => {
      expect(tn('hv.count.item', 1)).toBe('1 przedmiot');
      expect(tn('hv.count.item', 3)).toBe('3 przedmioty');
      expect(tn('hv.count.item', 9)).toBe('9 przedmiotów');
    });
  });

  it('falls back to `.other` for a category the language writes no form for', () => {
    // What a language that does not inflect the noun writes: one form, reached
    // at every count, instead of the same string twice.
    const fr: Dictionary = { 'hv.count.item.other': '{count} objet' };
    withDictionary('fr', fr, () => {
      expect(tn('hv.count.item', 1)).toBe('1 objet');
      expect(tn('hv.count.item', 2)).toBe('2 objet');
    });
  });

  it('falls back to English for a counted key a dictionary has not reached', () => {
    withDictionary('fr', { 'hv.count.item.other': '{count} objet' }, () => {
      expect(tn('hv.count.tag', 2)).toBe('2 tags');
    });
  });
});

/** Register a dictionary for the body of one test, then take it away again. */
function withDictionary(tag: string, dictionary: Dictionary, body: () => void): void {
  (DICTIONARIES as Record<string, Dictionary>)[tag] = dictionary;
  try {
    setLanguage(tag);
    body();
  } finally {
    delete (DICTIONARIES as Record<string, Dictionary>)[tag];
    setLanguage('en');
  }
}

import { DICTIONARIES, language, resolveLanguage, setLanguage, t, tn } from './index';
import type { Dictionary } from './index';

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
});

import { setLanguage } from '../i18n';
import { counted, showingCount } from './plural';

describe('counted', () => {
  it('prints the number with its noun', () => {
    // "Move 1 items to" is the string this exists to prevent.
    expect(counted(1, 'item')).toBe('1 item');
    expect(counted(0, 'item')).toBe('0 items');
    expect(counted(556, 'item')).toBe('556 items');
    expect(counted(1, 'subLocation')).toBe('1 sub-location');
  });

  it('takes the noun from the dictionary, irregular plurals included', () => {
    expect(counted(1, 'category')).toBe('1 category');
    expect(counted(11, 'category')).toBe('11 categories');
  });

  it('counts in the language in force', () => {
    setLanguage('de');
    expect(counted(1, 'item')).toBe('1 Gegenstand');
    expect(counted(3, 'item')).toBe('3 Gegenstände');
    // German builds no plural for this one, which a derived `+ 's'` could not
    // have expressed.
    expect(counted(3, 'filter')).toBe('3 Filter');
  });
});

describe('showingCount', () => {
  it('names what is on screen against what matches', () => {
    expect(showingCount(50, 60)).toBe('Showing 50 of 60 items');
    expect(showingCount(50, 60, true)).toBe('Showing 50 of 60 matching items');
    expect(showingCount(1, 1)).toBe('Showing 1 of 1 item');
  });

  it('drops the total the server has not priced yet', () => {
    expect(showingCount(12, null)).toBe('Showing 12 items');
    expect(showingCount(1, undefined)).toBe('Showing 1 item');
  });

  it('inflects the noun after "von" in German', () => {
    setLanguage('de');
    // Dative plural — the form a derived plural could never have produced.
    expect(showingCount(50, 60)).toBe('50 von 60 Gegenständen werden angezeigt');
    expect(showingCount(12, null)).toBe('12 Gegenstände werden angezeigt');
  });
});

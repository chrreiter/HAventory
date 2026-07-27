import { closestMatch, editDistance } from './fuzzy';

describe('editDistance', () => {
  it('handles identity, empties and single edits', () => {
    expect(editDistance('battery', 'battery')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('batery', 'battery')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('closestMatch', () => {
  it('suggests the typo fix the merge sheet pre-fills', () => {
    expect(closestMatch('batery', ['battery', 'metric', 'm4', 'wood'])).toBe('battery');
  });

  it('never suggests the value itself', () => {
    expect(closestMatch('battery', ['battery'])).toBe(null);
  });

  it('declines when nothing is close enough', () => {
    expect(closestMatch('battery', ['hardware', 'consumables'])).toBe(null);
  });

  it('is case-insensitive but returns the candidate as stored', () => {
    expect(closestMatch('BATERY', ['Battery'])).toBe('Battery');
  });

  it('returns null for empty input or no candidates', () => {
    expect(closestMatch('', ['battery'])).toBe(null);
    expect(closestMatch('   ', ['battery'])).toBe(null);
    expect(closestMatch('battery', [])).toBe(null);
  });
});

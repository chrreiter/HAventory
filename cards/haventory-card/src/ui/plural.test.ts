import { counted, plural } from './plural';

describe('plural', () => {
  it('agrees with the count', () => {
    expect(plural(1, 'item')).toBe('item');
    expect(plural(0, 'item')).toBe('items');
    expect(plural(2, 'item')).toBe('items');
  });

  it('takes an explicit plural for irregular nouns', () => {
    expect(plural(1, 'category', 'categories')).toBe('category');
    expect(plural(11, 'category', 'categories')).toBe('categories');
  });
});

describe('counted', () => {
  it('prints the number with its noun', () => {
    // "Move 1 items to" is the string this exists to prevent.
    expect(counted(1, 'item')).toBe('1 item');
    expect(counted(0, 'item')).toBe('0 items');
    expect(counted(556, 'item')).toBe('556 items');
    expect(counted(1, 'sub-location')).toBe('1 sub-location');
  });
});

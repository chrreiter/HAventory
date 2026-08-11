import { customFieldLabel } from './field-label';

describe('customFieldLabel', () => {
  it('writes a snake_case key as a sentence', () => {
    expect(customFieldLabel('purchase_price')).toBe('Purchase price');
    expect(customFieldLabel('serial_number')).toBe('Serial number');
  });

  it('takes dashes and runs of separators too', () => {
    expect(customFieldLabel('warranty-until')).toBe('Warranty until');
    expect(customFieldLabel('bought__from')).toBe('Bought from');
    expect(customFieldLabel('_notes_')).toBe('Notes');
  });

  // The household wrote the key; only the first letter is ours to raise.
  it('leaves the capitals the household chose alone', () => {
    expect(customFieldLabel('SKU')).toBe('SKU');
    expect(customFieldLabel('model_EAN')).toBe('Model EAN');
    expect(customFieldLabel('Purchase price')).toBe('Purchase price');
  });

  it('keeps a key it cannot make a label out of', () => {
    expect(customFieldLabel('___')).toBe('___');
    expect(customFieldLabel('')).toBe('');
  });
});

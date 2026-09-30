/**
 * A custom field's key, written for a read-only surface; editing surfaces show
 * the key exactly as typed. Separators become spaces and the first letter is
 * raised, nothing else, so an initialism like "SKU" survives. A key with no
 * letters left keeps its raw form.
 */
export function customFieldLabel(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!words) return key;
  return words[0].toUpperCase() + words.slice(1);
}

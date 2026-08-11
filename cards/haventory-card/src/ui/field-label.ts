/**
 * A custom field's key, written for reading.
 *
 * The key is the identity: it is what the item stores, what an export document
 * carries and what an automation names, so every surface that *edits* a field
 * shows it exactly as typed. A surface that only *reads* one is under no such
 * obligation, and "purchase_price 64.57" in a list beside "Due" and "Next
 * inspection" reads as debug output rather than as a fact about the item.
 *
 * Separators become spaces and the first letter is raised; nothing else is
 * touched. Lower-casing the rest would rewrite an initialism the household
 * chose — "SKU" is not "Sku" — and splitting runs of capitals would guess at
 * where the words are. A key with no letters left after the separators go
 * (`"___"`) keeps its raw form, because a blank label names nothing.
 */
export function customFieldLabel(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!words) return key;
  return words[0].toUpperCase() + words.slice(1);
}

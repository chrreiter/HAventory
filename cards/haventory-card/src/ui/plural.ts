/**
 * English pluralization for the card's count strings.
 *
 * Roughly half of them agreed with their number and half did not: the location
 * tree said "1 item" while the bulk bar, three components away, said "Move 1
 * items to" — and the organize dialog managed both, on adjacent rows. Every one
 * of those was a hand-written `n === 1 ? '' : 's'`, so the drift was inevitable
 * rather than careless.
 *
 * Irregular nouns take an explicit plural: `counted(n, 'category', 'categories')`.
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** The count and its noun: `counted(1, 'item')` → "1 item". */
export function counted(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

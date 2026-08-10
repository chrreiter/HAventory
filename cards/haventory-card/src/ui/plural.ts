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

/**
 * The line under a list saying how much of the set is on screen.
 *
 * The card and the expanded view report the same fact about the same store, so
 * they say it in the same words — and the words name what is being counted,
 * which a bare "Showing 50 of 60" never did. `total` is what matches the active
 * filters, so with any of them on the noun says so; null means the server has
 * not priced the set yet. A surface may append its own suffix (the expanded
 * view offers "scroll to load more"), but not rephrase this.
 */
export function showingCount(loaded: number, total: number | null | undefined, filtered = false): string {
  if (total === null || total === undefined) return `Showing ${counted(loaded, 'item')}`;
  return `Showing ${loaded} of ${counted(total, filtered ? 'matching item' : 'item')}`;
}

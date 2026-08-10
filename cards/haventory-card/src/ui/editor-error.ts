import type { ErrorEntry } from '../store/types';

/**
 * What an open editor says about a save that did not land.
 *
 * A conflict's own message names version numbers, which say nothing to someone
 * looking at a form; the card's banner already frames that case in words and
 * carries the ways out of it, so the form repeats that sentence rather than
 * giving a second, differently worded account of the same event.
 *
 * Shared, because both hosts of the editor answer the same question and a form
 * that named the failure differently depending on which surface it was open on
 * would be describing the surface, not the failure.
 */
export function editorErrorText(entry: ErrorEntry): string {
  return entry.kind === 'conflict' ? 'Someone else changed this item.' : entry.message;
}

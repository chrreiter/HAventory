/**
 * Nearest-neighbour suggestion for the tag/category merge flow.
 *
 * Mock 3b pre-fills "Merge into…" with the closest existing tag so the common
 * case — fixing a typo like `batery` → `battery` — is a single tap.
 */

/** Levenshtein distance with a single rolling row. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * The closest candidate to `value`, or null when nothing is close enough.
 *
 * "Close enough" is a distance of at most a third of the longer string (min 1),
 * which catches single-character typos and transpositions without proposing an
 * unrelated tag. `value` itself is never suggested.
 */
export function closestMatch(value: string, candidates: readonly string[]): string | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;

  let best: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const other = candidate.trim().toLowerCase();
    if (!other || other === needle) continue;
    const distance = editDistance(needle, other);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (best === null) return null;
  const threshold = Math.max(1, Math.floor(Math.max(needle.length, best.length) / 3));
  return bestDistance <= threshold ? best : null;
}

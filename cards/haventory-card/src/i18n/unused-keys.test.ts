import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { en } from './en';

/**
 * A key nothing reads is a key every language still has to carry.
 *
 * `catalog.test.ts` checks that a key is translated, paired and placeholder-
 * clean; none of that notices a key no source file reaches. Such a key costs a
 * line in every dictionary, a row in every wording review, and its share of the
 * bundle, for a string that never renders — and two of them sat in both
 * dictionaries for a release before anyone looked.
 */

const SRC = join(__dirname, '..');

/**
 * Prefixes a call site completes at run time, and what completes them.
 *
 * A prefix is a hole in the sweep below — every key under it counts as read —
 * so it is written down here rather than taken from whatever the regex happens
 * to find, and the second test fails when the tree grows one this list does not
 * name.
 */
const COMPUTED_PREFIXES = [
  // `counted(n, noun)` over `CountNoun`, itself read off the key universe.
  'hv.count.',
  // The one namespace three call sites complete: `columnLabel(key)` over
  // `ColumnKey`, the sort select over `SORT_FIELDS`, the organize dialog's
  // tabs over `OrganizeTab`.
  'hv.field.',
  // The organize dialog's rewrite progress line — one prefix per stage,
  // completed with the operation being run.
  'hv.organize.rewrite.running.',
  'hv.organize.rewrite.nothing.',
  'hv.organize.rewrite.partial.',
  'hv.organize.rewrite.done.',
  // The editor's repeat unit and its upload states.
  'hv.editor.unit.',
  'hv.editor.upload.state.',
];

/** Every source the card ships, minus the dictionaries, which name every key. */
function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : sourceFiles(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    if (entry.name.startsWith('test.')) return [];
    return [path];
  });
}

const sources = sourceFiles().map((path) => readFileSync(path, 'utf8'));
const matches = (pattern: RegExp) =>
  new Set(sources.flatMap((source) => [...source.matchAll(pattern)].map((m) => m[1])));

const literals = matches(/['"`](hv\.[\w.]+)['"`]/g);
const prefixes = matches(/`(hv\.[\w.]*)\$\{/g);

/** The counted keys, by base — `tn` is called with the base, not the form. */
const bases = new Set(
  Object.keys(en)
    .filter((key) => key.endsWith('.other'))
    .map((key) => key.slice(0, -'.other'.length)),
);

function isRead(key: string): boolean {
  if (literals.has(key)) return true;
  if (COMPUTED_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  const base = key.slice(0, key.lastIndexOf('.'));
  return bases.has(base) && literals.has(base);
}

describe('every key in the catalog', () => {
  it('is reached from a source file', () => {
    expect(Object.keys(en).filter((key) => !isRead(key))).toEqual([]);
  });

  it('is reached by its own name or by a prefix this test knows about', () => {
    expect([...prefixes].sort()).toEqual([...COMPUTED_PREFIXES].sort());
  });
});

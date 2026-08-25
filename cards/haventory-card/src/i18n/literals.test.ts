import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy written into a template instead of read through `t()`.
 *
 * Such a string is English in every language, and no other test sees it: the
 * catalog tests check the keys that exist, never the words that never became
 * one. An accessible name is the easiest of them to miss — it is drawn
 * nowhere, so only a screen reader ever says it out loud.
 */

const SRC = join(__dirname, '..');

/** Every source the card ships. A test file may write whatever it asserts on. */
function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    if (entry.name.startsWith('test.')) return [];
    return [path];
  });
}

const relative = (path: string) => path.slice(SRC.length + 1).replace(/\\/g, '/');
const sources = sourceFiles().map((path) => [relative(path), readFileSync(path, 'utf8')] as const);

function offenders(pattern: RegExp): string[] {
  return sources.flatMap(([name, source]) =>
    [...source.matchAll(pattern)].map((match) => `${name}: ${match[0].trim()}`),
  );
}

describe('the card says nothing in English by hand', () => {
  it('builds no accessible name out of a sentence', () => {
    // A template literal opening with a capital letter is copy; `t(...)`, a
    // property and an interpolated value all open with something else.
    expect(offenders(/aria-label=\$\{`[A-Z][^`]*`/g)).toEqual([]);
  });
});

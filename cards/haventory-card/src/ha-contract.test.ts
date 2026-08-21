import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HA_THEME_VARS, SURFACE_VARS, registerCustomCard } from './ha-contract';

/**
 * The contract in `ha-contract.ts` is only worth writing if it stays true, and
 * the only thing that can keep it true is a sweep of the sources. These read
 * the tree the way `tests/test_min_ha_version.py` reads it for the Home
 * Assistant floor: enumerate what may name a thing, and fail when something
 * else does.
 */

const SRC = join(__dirname);

function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.endsWith('.test.ts')) return [];
    if (entry.name.startsWith('test.')) return [];
    return [path];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const relative = (path: string) => path.slice(SRC.length + 1).replace(/\\/g, '/');

/**
 * The sweeps below are about what the card *renders*, and a comment renders
 * nothing — `ui/icons` names `<ha-icon>` to explain why the glyphs are inlined
 * instead, which is the rule being kept rather than broken. The `[^:]` guard
 * keeps a `https://` inside a string from swallowing the rest of its line.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the Home Assistant contact surface', () => {
  // The value of this row of the contract is that it is empty. HA's frontend
  // components are registered lazily inside its own bundle, are not published
  // for card authors, and are not versioned — and none of them exists in jsdom,
  // so one rendered here would break after a user's upgrade rather than in CI.
  // It did happen: the card editor rendered `ha-form` for one text field for a
  // release, which is the shape of regression this exists to catch.
  it('renders no ha-* element anywhere in the card', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      const source = code(read(path));
      // A tag being opened, not a word: `<ha-form`, `</ha-dialog>`,
      // `document.createElement('ha-selector')`.
      const matches = [
        ...source.matchAll(/<\/?ha-[a-z0-9-]+/g),
        ...source.matchAll(/createElement\(\s*['"`]ha-[a-z0-9-]+/g),
      ];
      for (const match of matches) offenders.push(`${relative(path)}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  // Every one of these is read with a fallback of its own, which is what makes
  // a renamed Home Assistant variable cost the binding and not the card. A
  // binding added without a line in the contract would be a dependency nobody
  // had recorded — so this sweeps every source file, not only `ui/tokens`.
  it('binds no Home Assistant theme variable the contract does not name', () => {
    const bound = new Set<string>();
    for (const path of sourceFiles()) {
      for (const match of code(read(path)).matchAll(/var\((--[a-z0-9_-]+)/gi)) {
        // The card's own tokens are not Home Assistant's.
        if (!match[1].startsWith('--hv-')) bound.add(match[1]);
      }
    }
    expect([...bound].sort()).toEqual([...HA_THEME_VARS].sort());
  });

  it('probes the surface with variables the contract names', () => {
    for (const name of SURFACE_VARS) expect(HA_THEME_VARS).toContain(name);
  });

  // `callWS` and `subscribeMessage` are Home Assistant's, so the card names
  // them in one place and every caller goes through the wrappers there. A
  // second call site is a second thing to find when an upgrade breaks one.
  it('reaches Home Assistant through the contract and nowhere else', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      if (relative(path) === 'ha-contract.ts') continue;
      const source = code(read(path));
      for (const match of source.matchAll(/\.callWS\b|\.connection\.subscribeMessage\b|window\.customCards/g)) {
        offenders.push(`${relative(path)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('registerCustomCard', () => {
  beforeEach(() => {
    delete window.customCards;
  });

  it("adds the entry Home Assistant's picker reads", () => {
    registerCustomCard({ type: 'haventory-card', name: 'HAventory', description: 'x' });
    expect(window.customCards).toEqual([
      { type: 'haventory-card', name: 'HAventory', description: 'x' },
    ]);
  });

  // The bundle can be evaluated twice on one page — a Lovelace resource and an
  // extra module URL are the same file loaded two ways — and a second entry
  // would show the card twice in the picker.
  it('does not add the same card twice', () => {
    registerCustomCard({ type: 'haventory-card', name: 'HAventory', description: 'x' });
    registerCustomCard({ type: 'haventory-card', name: 'HAventory', description: 'x' });
    expect(window.customCards).toHaveLength(1);
  });

  // The list belongs to the instance, not to this card.
  it("leaves another card's entry alone", () => {
    const other = { type: 'other-card', name: 'Other', description: 'y' };
    window.customCards = [other];
    registerCustomCard({ type: 'haventory-card', name: 'HAventory', description: 'x' });
    expect(window.customCards[0]).toBe(other);
    expect(window.customCards).toHaveLength(2);
  });
});

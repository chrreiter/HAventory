/**
 * The HAventory mark, published to Home Assistant as a custom icon set.
 *
 * A `panel_custom` sidebar icon is a *string*, so artwork can only reach the
 * sidebar through HA's icon registry: `ha-icon` resolves any prefix outside
 * `mdi:` against `window.customIcons`, and registering here is what makes the
 * backend's `PANEL_ICON` — `haventory:logo` — resolvable. The sidebar cannot
 * ask for it before its panel list arrives over the websocket, which is well
 * after this bundle (loaded on every page as an extra module) has evaluated.
 */

/** Prefix of the icon string: the integration domain, so nothing else claims it. */
export const HAVENTORY_ICONSET = 'haventory';

/** The one glyph in the set. */
export const HAVENTORY_ICON_NAME = 'logo';

/** What the backend registers as the panel's `sidebar_icon`. */
export const HAVENTORY_PANEL_ICON = `${HAVENTORY_ICONSET}:${HAVENTORY_ICON_NAME}`;

export const HAVENTORY_MARK_VIEW_BOX = '0 0 512 512';

// The house, clockwise.
const HOUSE =
  'M242.17,54.89 A22,22 0 0 1 269.83,54.89 L457.83,206.89 A22,22 0 0 1 466,224 ' +
  'L466,430 A22,22 0 0 1 444,452 L68,452 A22,22 0 0 1 46,430 L46,224 ' +
  'A22,22 0 0 1 54.17,206.89 Z';

// The three crates, counter-clockwise, which is what cuts them out of the house.
const CRATES = [
  'M214,174 A14,14 0 0 0 200,188 V264 A14,14 0 0 0 214,278 H298 ' +
    'A14,14 0 0 0 312,264 V188 A14,14 0 0 0 298,174 Z',
  'M148,294 A14,14 0 0 0 134,308 V384 A14,14 0 0 0 148,398 H232 ' +
    'A14,14 0 0 0 246,384 V308 A14,14 0 0 0 232,294 Z',
  'M280,294 A14,14 0 0 0 266,308 V384 A14,14 0 0 0 280,398 H364 ' +
    'A14,14 0 0 0 378,384 V308 A14,14 0 0 0 364,294 Z',
];

// The three handle slots, clockwise again, which fills them back in inside the
// crates.
const HANDLES = [
  'M237,202 H275 A9,9 0 0 1 275,220 H237 A9,9 0 0 1 237,202 Z',
  'M171,322 H209 A9,9 0 0 1 209,340 H171 A9,9 0 0 1 171,322 Z',
  'M303,322 H341 A9,9 0 0 1 341,340 H303 A9,9 0 0 1 303,322 Z',
];

/**
 * The mark as a single path.
 *
 * `ha-svg-icon` renders one `<path d>` and sets no `fill-rule`, so the default
 * `nonzero` decides what is solid: a subpath is a hole only when it is wound
 * against the shape enclosing it. Reversing any of the three groups above turns
 * the crates back into solid blocks.
 *
 * `docs/assets/social-preview.html` draws the same outline, wound the other way
 * for `fill-rule="evenodd"`, under which winding means nothing. The two
 * spellings are not interchangeable — taking that one for this file fills the
 * crates in. `tests/test_brand_assets.py` normalises both to one winding and
 * fails if the outlines diverge, and separately pins each file's winding to the
 * rule it is written for. The brand artwork under `docs/assets/brand/` is
 * rendered from the constants here, so it is not a third place to edit.
 */
export const HAVENTORY_MARK_PATH = [HOUSE, ...CRATES, ...HANDLES].join(' ');

interface CustomIcon {
  path: string;
  viewBox?: string;
}

interface CustomIconHelpers {
  getIcon: (name: string) => Promise<CustomIcon>;
  getIconList?: () => Promise<{ name: string }[]>;
}

declare global {
  interface Window {
    customIcons?: Record<string, CustomIconHelpers>;
  }
}

/**
 * Publish the mark under the `haventory:` prefix.
 *
 * Idempotent, and safe whichever side of the frontend's own boot this runs on.
 */
export function registerBrandIcon(): void {
  if (typeof window === 'undefined') return;

  // Mutate, never replace: the frontend captures this object once, when it
  // first imports its icon module, and reads every later lookup off that same
  // reference — a fresh object here would never be consulted.
  const registry = (window.customIcons ??= {});

  registry[HAVENTORY_ICONSET] = {
    // Every name in the set answers with the mark. HA calls this without
    // handling a rejection, so a mistyped icon renders the logo rather than
    // raising an unhandled rejection inside the frontend.
    getIcon: () =>
      Promise.resolve({ path: HAVENTORY_MARK_PATH, viewBox: HAVENTORY_MARK_VIEW_BOX }),
    getIconList: () => Promise.resolve([{ name: HAVENTORY_ICON_NAME }]),
  };
}

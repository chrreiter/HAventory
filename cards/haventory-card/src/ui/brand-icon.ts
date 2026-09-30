/**
 * The HAventory mark as a custom icon set. A sidebar icon is a string, and
 * `ha-icon` resolves a non-`mdi:` prefix against `window.customIcons`, which
 * is what makes the backend's `PANEL_ICON` (`haventory:logo`) resolvable.
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
 * The mark as a single path. `ha-svg-icon` sets no `fill-rule`, so under
 * `nonzero` the winding above is what cuts the holes. `social-preview.html`
 * draws the same outline for `evenodd`, so the two are not interchangeable;
 * `tests/test_brand_assets.py` pins both, and the images under
 * `custom_components/haventory/brand/` are rendered from these constants.
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

/** Publish the mark under the `haventory:` prefix; idempotent. */
export function registerBrandIcon(): void {
  if (typeof window === 'undefined') return;

  // Mutate, never replace: the frontend keeps the reference it captured first.
  const registry = (window.customIcons ??= {});

  registry[HAVENTORY_ICONSET] = {
    // Every name answers with the mark: HA does not handle a rejection here.
    getIcon: () =>
      Promise.resolve({ path: HAVENTORY_MARK_PATH, viewBox: HAVENTORY_MARK_VIEW_BOX }),
    getIconList: () => Promise.resolve([{ name: HAVENTORY_ICON_NAME }]),
  };
}

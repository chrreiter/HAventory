import {
  HAVENTORY_ICONSET,
  HAVENTORY_ICON_NAME,
  HAVENTORY_MARK_PATH,
  HAVENTORY_MARK_VIEW_BOX,
  HAVENTORY_PANEL_ICON,
  registerBrandIcon,
} from './brand-icon';

afterEach(() => {
  delete window.customIcons;
});

// Everything here is a contract with the Home Assistant frontend: the shape it
// reads icon sets out of, and the winding its single-path renderer needs.
describe('the HAventory icon set', () => {
  it('answers a lookup with the mark and its viewBox', async () => {
    registerBrandIcon();

    const set = window.customIcons?.[HAVENTORY_ICONSET];
    expect(set).toBeTruthy();
    await expect(set!.getIcon(HAVENTORY_ICON_NAME)).resolves.toEqual({
      path: HAVENTORY_MARK_PATH,
      viewBox: HAVENTORY_MARK_VIEW_BOX,
    });
  });

  it('is the icon string the backend registers for the panel', () => {
    expect(HAVENTORY_PANEL_ICON).toBe(`${HAVENTORY_ICONSET}:${HAVENTORY_ICON_NAME}`);
  });

  it('lists its glyph for the icon picker', async () => {
    registerBrandIcon();

    const set = window.customIcons![HAVENTORY_ICONSET];
    await expect(set.getIconList?.()).resolves.toEqual([{ name: HAVENTORY_ICON_NAME }]);
  });

  it('resolves an unknown name rather than rejecting', async () => {
    registerBrandIcon();

    const set = window.customIcons![HAVENTORY_ICONSET];
    await expect(set.getIcon('nonesuch')).resolves.toHaveProperty('path', HAVENTORY_MARK_PATH);
  });

  it('adds to the registry the frontend already made, keeping its identity', () => {
    const existing = {};
    window.customIcons = existing;

    registerBrandIcon();

    expect(window.customIcons).toBe(existing);
  });

  it('leaves another integration set alone', () => {
    const other = { getIcon: () => Promise.resolve({ path: 'M0,0' }) };
    window.customIcons = { other };

    registerBrandIcon();

    expect(window.customIcons.other).toBe(other);
    expect(window.customIcons[HAVENTORY_ICONSET]).toBeTruthy();
  });

  it('creates the registry when the frontend has not', () => {
    expect(window.customIcons).toBeUndefined();

    registerBrandIcon();

    expect(Object.keys(window.customIcons!)).toEqual([HAVENTORY_ICONSET]);
  });

  it('registering twice leaves one entry', () => {
    registerBrandIcon();
    registerBrandIcon();

    expect(Object.keys(window.customIcons!)).toEqual([HAVENTORY_ICONSET]);
  });
});

describe('the mark path', () => {
  // `ha-svg-icon` sets no fill-rule, so nonzero decides: the crates are holes
  // only while they run against the house, and the handle slots are solid only
  // while they run with it. Reverse a group and the mark fills in.
  const subpaths = HAVENTORY_MARK_PATH.split('Z').slice(0, -1);

  it('is one house, three crates and three handle slots', () => {
    expect(subpaths).toHaveLength(7);
    expect(HAVENTORY_MARK_PATH.trimEnd().endsWith('Z')).toBe(true);
  });

  it('winds the crates against the house that encloses them', () => {
    const [house, ...rest] = subpaths;
    const crates = rest.slice(0, 3);
    const handles = rest.slice(3);

    expect(house).toContain('A22,22 0 0 1');
    expect(house).not.toContain('A22,22 0 0 0');
    for (const crate of crates) {
      expect(crate).toContain('A14,14 0 0 0');
      expect(crate).not.toContain('A14,14 0 0 1');
    }
    for (const handle of handles) {
      expect(handle).toContain('A9,9 0 0 1');
      expect(handle).not.toContain('A9,9 0 0 0');
    }
  });
});

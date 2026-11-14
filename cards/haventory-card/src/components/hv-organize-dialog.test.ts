import { setLanguage } from '../i18n';
import './hv-organize-dialog';
import { all, makeItem, mountHost, q, settle } from '../test.utils';
import { HVOrganizeDialog } from './hv-organize-dialog';
import type { OrganizeTab } from './hv-organize-dialog';
import type { AreaRef, Item, Location } from '../store/types';

function loc(id: string, name: string, parentId: string | null = null, areaId: string | null = null): Location {
  const display = parentId ? `${parentId} / ${name}` : name;
  return {
    id,
    name,
    parent_id: parentId,
    area_id: areaId,
    path: {
      id_path: parentId ? [parentId, id] : [id],
      name_path: parentId ? [parentId, name] : [name],
      display_path: display,
      sort_key: display.toLowerCase(),
    },
  };
}

/** The registry every area-facing test picks from; empty is its own case. */
const AREAS = [
  { id: 'area-garage', name: 'Garage area' },
  { id: 'area-kitchen', name: 'Kitchen' },
];

async function mount(
  opts: {
    items?: Item[];
    locations?: Location[];
    areas?: AreaRef[];
    tab?: OrganizeTab;
    mobile?: boolean;
  } = {},
) {
  return mountHost<HVOrganizeDialog>(
    'hv-organize-dialog',
    {
      items: opts.items ?? [],
      locations: opts.locations ?? [],
      areas: opts.areas ?? AREAS,
    },
    { tab: opts.tab ?? 'locations', mobile: opts.mobile ?? false, open: true },
    { renders: 2 },
  );
}

describe('hv-organize-dialog: shell', () => {
  it('renders nothing when closed', async () => {
    const { el, sr } = await mount();
    el.open = false;
    await el.updateComplete;
    expect(q(sr, '[data-testid="organize-dialog"]')).toBe(null);
  });

  it('replaces four separate browsers with one tabbed dialog', async () => {
    const { sr } = await mount();
    expect(all(sr, '[data-testid="organize-tab"]').map((t) => t.dataset.tab)).toEqual([
      'locations',
      'categories',
      'tags',
      'statuses',
    ]);
  });

  it('switches tabs and resets the filter with them', async () => {
    const { el, sr } = await mount();
    const locations = q(sr, 'hv-organize-locations') as HTMLElement;
    const filter = q(locations.shadowRoot as ShadowRoot, '[data-testid="organize-filter"]') as HTMLInputElement;
    filter.value = 'gar';
    filter.dispatchEvent(new Event('input'));
    await settle(el);

    (q(sr, '[data-tab="tags"]') as HTMLButtonElement).click();
    await settle(el);
    expect(el.tab).toBe('tags');
    const tab = q(sr, 'hv-organize-values') as HTMLElement;
    expect((q(tab.shadowRoot as ShadowRoot, '[data-testid="organize-filter"]') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('browses to a picked count and closes', async () => {
    const items = [
      makeItem({ id: '1', tags: ['battery', 'aa'] }),
      makeItem({ id: '2', tags: ['batery'] }),
      makeItem({ id: '3', tags: ['batery'] }),
    ];
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const tab = q(sr, 'hv-organize-values') as HTMLElement;
    expect(all(tab.shadowRoot as ShadowRoot, '[data-testid="value-row"]').map((r) => r.dataset.value)).toEqual([
      'aa',
      'batery',
      'battery',
    ]);
    let dismissed = 0;
    el.addEventListener('cancel', () => {
      dismissed += 1;
    });

    (all(tab.shadowRoot as ShadowRoot, '[data-testid="value-count"]')[1] as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.filters.tags).toEqual(['batery']);
    expect(dismissed).toBe(1);
  });

  it('closes from the ✕, the backdrop and Escape', async () => {
    for (const trigger of ['close', 'backdrop', 'escape'] as const) {
      const { el, sr } = await mount();
      let cancels = 0;
      el.addEventListener('cancel', () => {
        cancels += 1;
      });

      if (trigger === 'close') (q(sr, '[data-testid="organize-close"]') as HTMLButtonElement).click();
      else if (trigger === 'backdrop') (q(sr, '.backdrop') as HTMLElement).click();
      else
        (q(sr, '[data-testid="organize-dialog"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

      expect(cancels, trigger).toBe(1);
      el.remove();
    }
  });

  it('is a full-bleed page with a back arrow on mobile', async () => {
    const { sr } = await mount({ mobile: true });
    expect(q(sr, '[data-testid="organize-back"]')).toBeTruthy();
    expect(q(sr, '[data-testid="organize-close"]')).toBe(null);
  });

  // The surface answered to three names — "Organize…" in the menu, "Organize
  // inventory" on a wide screen and "Organize" on a narrow one — so the heading
  // never confirmed which thing the menu entry had opened.
  it('calls itself Organize at every width', async () => {
    for (const mobile of [false, true]) {
      const { el, sr } = await mount({ mobile });
      expect(q(sr, 'h2')?.textContent?.trim(), `mobile=${mobile}`).toBe('Organize');
      expect(q(sr, '[data-testid="organize-dialog"]')?.getAttribute('aria-label')).toBe('Organize');
      el.remove();
    }
  });

  // Each opening builds the tabs afresh, so nothing half-done in one outlives it.
  it('drops a failed save off the screen when the dialog is reopened', async () => {
    const locations = [loc('garage', 'Garage', null, 'area-garage'), loc('shelf-a', 'Shelf A', 'garage')];
    const { el, store, sr } = await mount({ locations });
    store.updateLocation = () => Promise.reject(new Error('Location is busy'));

    const tab = () => q(sr, 'hv-organize-locations') as HTMLElement;
    const tabRoot = () => tab().shadowRoot as ShadowRoot;
    const tree = q(tabRoot(), '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);
    (q(tabRoot(), '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(tabRoot(), '[data-testid="location-error"]')?.textContent).toContain('Location is busy');
    const before = tab();

    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect(tab()).not.toBe(before);
    expect(q(tabRoot(), '[data-testid="location-error"]')).toBe(null);
    expect(q(tabRoot(), '[data-testid="location-editor"]')).toBe(null);
  });
});

// Every disclosure renders after the row that opened it, inside a `.body` that
// scrolls, so one opened from a row near the bottom lands below the fold and
// the tap reads as having done nothing.
describe('hv-organize-dialog: disclosures come into view', () => {
  const items = [
    makeItem({ id: '1', location_id: 'shelf-a', tags: ['battery'], category: 'Tools' }),
    makeItem({ id: '2', tags: ['aa'], category: 'Consumables', status: 'missing' }),
  ];

  // jsdom performs no layout and implements no `scrollIntoView`, so these pin
  // the call and its options; whether the element ends up visible is a live
  // check.
  type Scrollable = { scrollIntoView?: (options?: unknown) => void };
  let scrolls: { el: Element; options: unknown }[] = [];
  beforeEach(() => {
    scrolls = [];
    (Element.prototype as Scrollable).scrollIntoView = function (this: Element, options?: unknown) {
      scrolls.push({ el: this, options });
    };
  });
  afterEach(() => {
    delete (Element.prototype as Scrollable).scrollIntoView;
    document.body.innerHTML = '';
  });

  // The statuses tab keeps a half-typed status across a tab switch and a close,
  // and coming back to the tab brings it into view again. Re-opening the dialog
  // is DialogFocus's moment instead: it puts focus on the panel, and the
  // carried-over disclosure must not pull it away.
  it('moves nothing when the dialog re-opens with a disclosure still expanded', async () => {
    const { el, sr } = await mount({ tab: 'statuses', items });
    const tab = q(sr, 'hv-organize-statuses') as HTMLElement;
    const editor = () => q(tab.shadowRoot as ShadowRoot, '[data-testid="status-editor"]');
    (q(tab.shadowRoot as ShadowRoot, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(tab);
    expect(scrolls).toHaveLength(1);

    for (const name of ['locations', 'statuses']) {
      (q(sr, `[data-tab="${name}"]`) as HTMLButtonElement).click();
      await settle(el);
    }
    expect(q(sr, 'hv-organize-statuses')).toBe(tab);
    expect(editor()).not.toBe(null);
    expect(scrolls).toHaveLength(2);

    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect(editor()).not.toBe(null);
    expect(scrolls).toHaveLength(2);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="organize-dialog"]'));
  });
});

describe('hv-organize-dialog: the language in force', () => {
  it('names its four tabs in German', async () => {
    setLanguage('de');
    const { el } = await mount();
    const tabs = all<HTMLElement>(el, '[data-testid="organize-tab"]').map((b) => (b.textContent ?? '').trim());
    expect(tabs).toEqual(['Orte', 'Kategorien', 'Labels', 'Status']);
  });
});

import './haventory-panel';
import { makeMockHass, makeItem, stubViewport } from './test.utils';
import { COLUMN_PREFS_STORAGE_KEY, DEFAULT_COLUMNS } from './store/columns';
import type { HAventoryPanel } from './haventory-panel';

type Panel = HAventoryPanel & { updateComplete: Promise<unknown> };
type FullView = HTMLElement & {
  store?: unknown;
  heading: string;
  columns: string[];
  embedded: boolean;
  open: boolean;
  narrow: boolean;
};

async function mountPanel(
  opts: {
    items?: ReturnType<typeof makeItem>[];
    cardTitle?: string;
    config?: Record<string, unknown> | null;
    narrow?: boolean;
    withHass?: boolean;
  } = {},
) {
  const el = document.createElement('haventory-panel') as Panel;
  document.body.appendChild(el);
  await customElements.whenDefined('haventory-panel');
  if (opts.config !== undefined) el.panel = { config: opts.config };
  if (opts.narrow) el.narrow = true;
  if (opts.withHass !== false) {
    el.hass = makeMockHass({ items: opts.items ?? [], cardTitle: opts.cardTitle });
  }
  await el.updateComplete;
  const sr = el.shadowRoot as ShadowRoot;
  return { el, sr, view: () => sr.querySelector('[data-testid="panel-full-view"]') as FullView };
}

const settle = async (el: Panel) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

// `haventory-panel` is what Home Assistant's custom-panel loader instantiates.
// It is the card's sibling host: same store lifecycle, same browser-owned
// surfaces, with the extended view embedded rather than thrown over the page.
describe('haventory-panel: the surface', () => {
  it('renders the extended view embedded and already open', async () => {
    const { view } = await mountPanel();
    expect(view()).toBeTruthy();
    expect(view().embedded).toBe(true);
    expect(view().open).toBe(true);
  });

  it('forwards the frontend narrow flag so the view can offer the menu button', async () => {
    const { view } = await mountPanel({ narrow: true });
    expect(view().narrow).toBe(true);
  });

  it('leaves narrow off by default', async () => {
    const { view } = await mountPanel();
    expect(view().narrow).toBe(false);
  });
});

describe('haventory-panel: heading', () => {
  it('takes the title the panel was registered with', async () => {
    const { view } = await mountPanel({ config: { title: 'Garage' }, cardTitle: 'Pantry' });
    expect(view().heading).toBe('Garage');
  });

  it('falls back to the integration name when the panel carries no title', async () => {
    const { el, view } = await mountPanel({ config: {}, cardTitle: 'Pantry' });
    await settle(el);
    expect(view().heading).toBe('Pantry');
  });

  it('falls back when there is no panel object at all', async () => {
    const { el, view } = await mountPanel({ cardTitle: 'Pantry' });
    await settle(el);
    expect(view().heading).toBe('Pantry');
  });

  it('ignores a title that is not a string', async () => {
    const { el, view } = await mountPanel({ config: { title: 42 }, cardTitle: 'Pantry' });
    await settle(el);
    expect(view().heading).toBe('Pantry');
  });

  it('shows the default before anything has answered', async () => {
    const { view } = await mountPanel({ withHass: false });
    expect(view().heading).toBe('HAventory');
  });
});

describe('haventory-panel: store lifecycle', () => {
  it('builds the store from hass and hands it to the view', async () => {
    const { view } = await mountPanel({ items: [makeItem({ id: '1', name: 'Hammer' })] });
    expect(view().store).toBeTruthy();
  });

  it('renders without a store until hass arrives', async () => {
    const { el, view } = await mountPanel({ withHass: false });
    expect(view().store).toBeUndefined();

    el.hass = makeMockHass({ items: [] });
    await settle(el);
    expect(view().store).toBeTruthy();
  });

  // Home Assistant hands a fresh `hass` object down on every state change; a
  // store rebuilt each time would drop the subscriptions and the loaded page.
  it('keeps the same store across hass updates', async () => {
    const { el } = await mountPanel();
    const first = (el as unknown as { store: unknown }).store;

    el.hass = makeMockHass({ items: [makeItem({ id: '2' })] });
    await settle(el);

    expect((el as unknown as { store: unknown }).store).toBe(first);
  });

  it('drops its state subscription when it leaves the DOM, and takes it back', async () => {
    const { el } = await mountPanel();
    el.remove();
    await el.updateComplete;
    expect((el as unknown as { _storeUnsub?: unknown })._storeUnsub).toBeUndefined();

    document.body.appendChild(el);
    await el.updateComplete;
    expect((el as unknown as { _storeUnsub?: unknown })._storeUnsub).toBeTruthy();
  });
});

describe('haventory-panel: host-owned surfaces', () => {
  const raise = (view: FullView, id: string) =>
    view.dispatchEvent(new CustomEvent('menu-action', { detail: { id }, bubbles: true, composed: true }));

  it('opens the column picker when the view asks for it, and persists the choice', async () => {
    const { el, sr, view } = await mountPanel();
    const picker = () => sr.querySelector('hv-column-picker') as HTMLElement & { open: boolean };
    expect(picker().open).toBe(false);

    raise(view(), 'columns');
    await settle(el);
    expect(picker().open).toBe(true);

    picker().dispatchEvent(
      new CustomEvent('change', { detail: { columns: ['location'] }, bubbles: true, composed: true }),
    );
    await settle(el);

    expect(view().columns).toEqual(['location']);
    expect(JSON.parse(localStorage.getItem(COLUMN_PREFS_STORAGE_KEY) ?? '{}')).toEqual({
      expanded: ['location'],
    });
  });

  it('starts the table from the columns saved last time', async () => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ expanded: ['category'] }));
    const { view } = await mountPanel();
    expect(view().columns).toEqual(['category']);
  });

  it('closes the picker on cancel without changing anything', async () => {
    const { el, sr, view } = await mountPanel();
    raise(view(), 'columns');
    await settle(el);

    sr.querySelector('hv-column-picker')!.dispatchEvent(
      new CustomEvent('cancel', { bubbles: true, composed: true }),
    );
    await settle(el);

    expect((sr.querySelector('hv-column-picker') as HTMLElement & { open: boolean }).open).toBe(false);
    expect(view().columns).toEqual([...DEFAULT_COLUMNS]);
  });

  it('downloads an export for the scope the menu asked for', async () => {
    for (const [id, scope] of [
      ['export-all', 'all'],
      ['export-view', 'view'],
    ] as const) {
      const { el, view } = await mountPanel({ items: [makeItem({ id: '1' })] });
      const downloads: { filename: string; text: string }[] = [];
      el.surfaces.download = (filename, text) => {
        downloads.push({ filename, text });
      };
      const scopes: unknown[] = [];
      const store = (el as unknown as { store: { exportDocument: (s: unknown) => Promise<unknown> } }).store;
      const real = store.exportDocument.bind(store);
      store.exportDocument = (s: unknown) => {
        scopes.push(s);
        return real(s);
      };

      raise(view(), id);
      await settle(el);
      await settle(el);

      expect(scopes, id).toEqual([scope]);
      expect(downloads, id).toHaveLength(1);
      expect(downloads[0].filename, id).toMatch(/^haventory-export-.*\.json$/);
      document.body.innerHTML = '';
    }
  });

  it('keeps the panel up when an export fails', async () => {
    const { el, view } = await mountPanel();
    const store = (el as unknown as { store: { exportDocument: () => Promise<unknown> } }).store;
    store.exportDocument = () => Promise.reject(new Error('storage_error'));

    raise(view(), 'export-all');
    await settle(el);
    await settle(el);

    expect(view()).toBeTruthy();
  });

  it('refreshes the caches when the menu asks', async () => {
    const { el, view } = await mountPanel();
    const store = (el as unknown as { store: { refreshAll: () => Promise<unknown> } }).store;
    let refreshes = 0;
    store.refreshAll = () => {
      refreshes += 1;
      return Promise.resolve();
    };

    raise(view(), 'refresh');
    await settle(el);

    expect(refreshes).toBe(1);
  });

  it('does nothing for an action no surface here owns', async () => {
    const { el, sr, view } = await mountPanel();
    raise(view(), 'not-a-surface');
    await settle(el);

    expect((sr.querySelector('hv-column-picker') as HTMLElement & { open: boolean }).open).toBe(false);
    expect(view()).toBeTruthy();
  });
});

describe('haventory-panel: the shared dialog surfaces', () => {
  const raise = (view: FullView, detail: Record<string, unknown>) =>
    view.dispatchEvent(new CustomEvent('menu-action', { detail, bubbles: true, composed: true }));
  const dialog = (sr: ShadowRoot, testid: string) =>
    sr.querySelector(`[data-testid="${testid}"]`) as HTMLElement & { open: boolean; tab?: string };

  it('confirms a delete raised by the view, then sends the version-checked delete', async () => {
    const { el, sr, view } = await mountPanel({ items: [makeItem({ id: '1', name: 'Hammer' })] });
    await settle(el);
    const deletes: unknown[][] = [];
    const store = (el as unknown as { store: { deleteItem: (...args: unknown[]) => Promise<void> } }).store;
    store.deleteItem = (...args: unknown[]) => {
      deletes.push(args);
      return Promise.resolve();
    };

    view().dispatchEvent(
      new CustomEvent('request-delete', { detail: { itemId: '1' }, bubbles: true, composed: true }),
    );
    await settle(el);

    const confirm = dialog(sr, 'host-confirm');
    expect(confirm.open).toBe(true);
    expect((confirm as unknown as { heading: string }).heading).toContain('Hammer');
    expect(deletes).toEqual([]);

    confirm.dispatchEvent(new CustomEvent('confirm', { bubbles: true, composed: true }));
    await settle(el);

    expect(deletes).toEqual([['1', 1]]);
    expect(dialog(sr, 'host-confirm').open).toBe(false);
  });

  it('lets a cancelled delete change nothing', async () => {
    const { el, sr, view } = await mountPanel({ items: [makeItem({ id: '1', name: 'Hammer' })] });
    await settle(el);
    const deletes: unknown[] = [];
    const store = (el as unknown as { store: { deleteItem: (...args: unknown[]) => Promise<void> } }).store;
    store.deleteItem = (...args: unknown[]) => {
      deletes.push(args);
      return Promise.resolve();
    };

    view().dispatchEvent(
      new CustomEvent('request-delete', { detail: { itemId: '1' }, bubbles: true, composed: true }),
    );
    await settle(el);
    dialog(sr, 'host-confirm').dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    await settle(el);

    expect(dialog(sr, 'host-confirm').open).toBe(false);
    expect(deletes).toEqual([]);
  });

  it('ignores a delete for an item that is already gone', async () => {
    const { el, sr, view } = await mountPanel();
    view().dispatchEvent(
      new CustomEvent('request-delete', { detail: { itemId: 'ghost' }, bubbles: true, composed: true }),
    );
    await settle(el);
    expect(dialog(sr, 'host-confirm').open).toBe(false);
  });

  // The sidebar's "+" beside Categories and Tags names this action with a tab.
  it('opens the organize dialog on the tab that was asked for', async () => {
    const { el, sr, view } = await mountPanel({ items: [makeItem({ id: '1', tags: ['metric'] })] });
    raise(view(), { id: 'organize', tab: 'tags' });
    await settle(el);
    expect(dialog(sr, 'host-organize').open).toBe(true);
    expect(dialog(sr, 'host-organize').tab).toBe('tags');
  });

  it('defaults the organize dialog to Locations when no tab is named', async () => {
    const { el, sr, view } = await mountPanel();
    raise(view(), { id: 'organize' });
    await settle(el);
    expect(dialog(sr, 'host-organize').tab).toBe('locations');
  });

  it('opens the import sheet from the fresh-install empty state', async () => {
    const { el, sr, view } = await mountPanel({ items: [] });
    await settle(el);

    // The offer is real UI inside the view, not a synthetic event: what a fresh
    // install sees first has to actually work here.
    const offer = view().shadowRoot?.querySelector(
      '[data-testid="empty-action"][data-id="import"]',
    ) as HTMLButtonElement;
    expect(offer).toBeTruthy();
    offer.click();
    await settle(el);

    expect(dialog(sr, 'host-import').open).toBe(true);
  });

  it('opens diagnostics from the menu', async () => {
    const { el, sr, view } = await mountPanel();
    raise(view(), { id: 'diagnostics' });
    await settle(el);
    expect(dialog(sr, 'host-diagnostics').open).toBe(true);
  });

  // The panel used to hold its own `matchMedia` subscription and hand the answer
  // to the dialogs; it now shares the one the surfaces keep, so the page and the
  // card agree at a single width without either owning the query.
  it('hands every dialog the phone form on a phone viewport', async () => {
    const restore = stubViewport(true);
    try {
      const { sr } = await mountPanel();
      for (const id of ['host-columns', 'host-confirm', 'host-organize', 'host-import', 'host-diagnostics']) {
        expect(dialog(sr, id).hasAttribute('mobile'), id).toBe(true);
      }
    } finally {
      restore();
    }
  });

  it('keeps them centred on a desktop viewport', async () => {
    const restore = stubViewport(false);
    try {
      const { sr } = await mountPanel();
      for (const id of ['host-columns', 'host-confirm', 'host-organize', 'host-import', 'host-diagnostics']) {
        expect(dialog(sr, id).hasAttribute('mobile'), id).toBe(false);
      }
    } finally {
      restore();
    }
  });
});

describe('haventory-panel: the ⋮ menu', () => {
  const ids = (view: FullView) =>
    ((view as unknown as { menuEntries: { id?: string }[] }).menuEntries ?? [])
      .map((e) => e.id)
      .filter(Boolean);

  // One builder serves the card's full view and the panel, so the two hosts
  // cannot drift apart on what the menu offers.
  it('offers the same entries as the card full view', async () => {
    const { view } = await mountPanel();
    expect(ids(view())).toEqual([
      'select-items',
      'organize',
      'columns',
      'refresh',
      'diagnostics',
      'export-all',
      'export-view',
      'import',
    ]);
  });

  // The filtered export would be the whole inventory again, so it stays out of
  // reach until a filter is on — same rule the card's menu follows.
  it('disables the filtered export until something is filtered', async () => {
    const { el, view } = await mountPanel({ items: [makeItem({ id: '1', name: 'Hammer' })] });
    await settle(el);
    const entry = () =>
      (view() as unknown as { menuEntries: { id?: string; disabled?: boolean }[] }).menuEntries.find(
        (e) => e.id === 'export-view',
      );
    expect(entry()?.disabled).toBe(true);

    const store = (el as unknown as { store: { setFilters: (p: unknown) => void } }).store;
    store.setFilters({ q: 'hammer' });
    await settle(el);

    expect(entry()?.disabled).toBe(false);
  });
});

// The panel renders nothing but the embedded full view, so a failure that is
// invisible there is invisible on the whole sidebar page.
describe('haventory-panel: failures reach the page', () => {
  it('shows a refused operation on the page itself', async () => {
    const { el, view } = await mountPanel({ items: [makeItem({ id: '1' })] });
    const store = view().store as { pushError: (e: { code: string; message: string }) => void };
    store.pushError({ code: 'storage_error', message: 'disk full' });
    await settle(el);

    const entry = view().shadowRoot?.querySelector('[data-testid="banner-entry"]') as HTMLElement | null;
    expect(entry?.shadowRoot?.textContent).toContain('disk full');
    // What the banner's actions do is pinned in hv-full-view's own suite; what
    // matters here is that the panel has them at all.
    expect(view().shadowRoot?.querySelector('[data-testid="banner-dismiss"]')).toBeTruthy();
  });
});

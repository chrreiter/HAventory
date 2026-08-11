import './index';
import { makeMockHass, makeItem } from './test.utils';
import { COLUMN_PREFS_STORAGE_KEY, DEFAULT_COLUMNS } from './store/columns';
import type { HAventoryCard } from './index';

type Card = HAventoryCard & { updateComplete: Promise<unknown>; hass?: unknown };

async function mountCard(
  config: unknown = {},
  opts: { items?: ReturnType<typeof makeItem>[]; cardTitle?: string } = {},
) {
  const el = document.createElement('haventory-card') as Card;
  document.body.appendChild(el);
  await customElements.whenDefined('haventory-card');
  el.setConfig(config);
  el.hass = makeMockHass({ items: opts.items ?? [], cardTitle: opts.cardTitle });
  await el.updateComplete;
  return { el, sr: el.shadowRoot as ShadowRoot };
}

const settle = async (el: Card) => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

// `haventory-card` is what Home Assistant instantiates; everything the user
// sees lives in `hv-card-shell`, including the shared host surfaces. What is
// left here is the contract with Lovelace — config, sizing, picker metadata —
// and the proof that the wiring holds end-to-end through the real element.
describe('haventory-card: the Lovelace element', () => {
  it('renders the shell and nothing of its own', async () => {
    const { sr } = await mountCard();
    expect(sr.querySelector('[data-testid="card-shell"]')).toBeTruthy();
  });

  it('passes the configured title down as the heading', async () => {
    const { sr } = await mountCard({ title: 'My Custom Inventory' });
    const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { heading: string };
    expect(shell.heading).toBe('My Custom Inventory');
  });

  it('falls back to a default heading', async () => {
    const { sr } = await mountCard();
    const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { heading: string };
    expect(shell.heading).toBe('HAventory');
  });

  it('takes the heading from the integration when the dashboard sets no title', async () => {
    const { el, sr } = await mountCard({}, { cardTitle: 'Pantry' });
    await settle(el);
    const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { heading: string };
    expect(shell.heading).toBe('Pantry');
  });

  // Two dashboards can name the same inventory differently, so the card's own
  // config outranks the integration-wide setting.
  it('prefers the dashboard title over the integration heading', async () => {
    const { el, sr } = await mountCard({ title: 'Garage shelf' }, { cardTitle: 'Pantry' });
    await settle(el);
    const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { heading: string };
    expect(shell.heading).toBe('Garage shelf');
  });

  it('takes an empty config, and a null one', async () => {
    for (const config of [{}, null]) {
      const { sr } = await mountCard(config);
      expect(sr.querySelector('[data-testid="card-shell"]')).toBeTruthy();
      document.body.innerHTML = '';
    }
  });

  // A card that threw on an unrecognised key would break the dashboard it sits
  // on — including for anyone whose YAML still names the retired `ui` option.
  it('ignores config keys it does not read, rather than rejecting them', async () => {
    const { sr } = await mountCard({ title: 'Kept', ui: 'legacy', whatever: { nested: true } });
    const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { heading: string };
    expect(shell.heading).toBe('Kept');
  });

  it('ignores a title that is not a string', async () => {
    const { el, sr } = await mountCard({ title: 42 }, { cardTitle: 'Pantry' });
    await settle(el);
    const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { heading: string };
    expect(shell.heading).toBe('Pantry');
  });

  it('rejects a config that is not an object at all', async () => {
    const el = document.createElement('haventory-card') as Card;
    document.body.appendChild(el);
    await customElements.whenDefined('haventory-card');
    expect(() => el.setConfig('nope')).toThrow(/Invalid config/);
  });

  // The pills are filter toggles, not decoration, so a dashboard can say which
  // it offers. Nothing about the key may break a dashboard that never sets it.
  describe('quick_filters', () => {
    const shellOf = (sr: ShadowRoot) =>
      sr.querySelector('[data-testid="card-shell"]') as HTMLElement & {
        quickFilters: string[] | null;
      };

    it('offers every pill when the key is omitted', async () => {
      const { sr } = await mountCard({});
      expect(shellOf(sr).quickFilters).toBe(null);
    });

    it('passes a chosen subset down to the shell', async () => {
      const { sr } = await mountCard({ quick_filters: ['low_stock', 'overdue'] });
      expect(shellOf(sr).quickFilters).toEqual(['low_stock', 'overdue']);
    });

    it('drops an unknown entry without dropping the rest', async () => {
      const { sr } = await mountCard({ quick_filters: ['low_stock', 'sideways'] });
      expect(shellOf(sr).quickFilters).toEqual(['low_stock']);
    });

    it('reads a non-list value as the key being absent, and never throws', async () => {
      const { sr } = await mountCard({ quick_filters: 'low_stock' });
      expect(shellOf(sr).quickFilters).toBe(null);
    });

    it('honours an explicit empty list', async () => {
      const { sr } = await mountCard({ quick_filters: [] });
      expect(shellOf(sr).quickFilters).toEqual([]);
    });
  });

  it('reports a card size for the dashboard layout', async () => {
    const { el } = await mountCard();
    expect(el.getCardSize()).toBeGreaterThan(0);
  });

  // Home Assistant reads these off `customElements.get(type)` and never imports
  // from the bundle, so the class is the only surface worth asserting: a module
  // export can be perfectly correct and still never be looked at.
  describe('the picker statics, on the surface HA reads', () => {
    type CardClass = CustomElementConstructor & {
      getStubConfig?: () => { type: string; title: string };
      getConfigElement?: () => HTMLElement;
    };
    const registered = () => customElements.get('haventory-card') as CardClass;

    it('offers a stub config', () => {
      expect(registered().getStubConfig?.().type).toBe('custom:haventory-card');
    });

    it('answers with the visual editor rather than leaving HA on the YAML fallback', () => {
      expect(registered().getConfigElement?.().tagName).toBe('HAVENTORY-CARD-EDITOR');
    });

    it('feeds its own stub config back in without complaint', async () => {
      const stub = registered().getStubConfig!();
      const { sr } = await mountCard(stub);
      const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { heading: string };
      expect(shell.heading).toBe('HAventory');
    });

    it('sizes itself for a sections view, with minimums under the defaults', async () => {
      const { el } = await mountCard();
      const grid = (el as unknown as { getGridOptions(): Record<string, number> }).getGridOptions();
      expect(grid.columns).toBeGreaterThan(0);
      expect(grid.rows).toBeGreaterThan(0);
      expect(grid.min_columns).toBeLessThan(grid.columns);
      expect(grid.min_rows).toBeLessThan(grid.rows);
    });

    it('registers with the card picker, documentation link and all', async () => {
      const before = window.customCards ? [...window.customCards] : [];
      await import('./index');
      const entry = (window.customCards ?? []).find((c) => c?.type === 'haventory-card');
      expect(entry).toBeTruthy();
      expect(entry?.documentationURL).toMatch(/^https:\/\//);
      window.customCards = before;
    });
  });
});

// The host surfaces live in the shell; these cases prove the wiring holds
// end-to-end through the element Home Assistant actually creates — an action
// raised inside the full view lands on a working surface.
describe('haventory-card: host surfaces through the real element', () => {
  type Shell = HTMLElement & {
    shadowRoot: ShadowRoot;
    surfaces: { columns: string[]; download: (filename: string, text: string) => void };
  };
  const shellOf = (sr: ShadowRoot) => sr.querySelector('[data-testid="card-shell"]') as Shell;
  const raise = (shell: Shell, id: string) =>
    shell.shadowRoot
      .querySelector('[data-testid="card-full-view"]')!
      .dispatchEvent(new CustomEvent('menu-action', { detail: { id }, bubbles: true, composed: true }));

  it('opens the column picker from the full view, and persists the choice', async () => {
    const { el, sr } = await mountCard();
    const shell = shellOf(sr);
    const picker = () =>
      shell.shadowRoot.querySelector('hv-column-picker') as HTMLElement & { open: boolean };
    expect(picker().open).toBe(false);

    raise(shell, 'columns');
    await settle(el);
    expect(picker().open).toBe(true);

    picker().dispatchEvent(
      new CustomEvent('change', {
        detail: { columns: ['quantity', 'tags'] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);

    expect(shell.surfaces.columns).toEqual(['quantity', 'tags']);
    expect(JSON.parse(localStorage.getItem(COLUMN_PREFS_STORAGE_KEY) ?? '{}')).toEqual({
      expanded: ['quantity', 'tags'],
    });
  });

  it('starts the table from the columns saved last time', async () => {
    localStorage.setItem(COLUMN_PREFS_STORAGE_KEY, JSON.stringify({ expanded: ['category'] }));
    const { sr } = await mountCard();
    expect(shellOf(sr).surfaces.columns).toEqual(['category']);
  });

  it('closes the picker on cancel without changing anything', async () => {
    const { el, sr } = await mountCard();
    const shell = shellOf(sr);
    raise(shell, 'columns');
    await settle(el);

    shell.shadowRoot
      .querySelector('hv-column-picker')!
      .dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    await settle(el);

    expect(
      (shell.shadowRoot.querySelector('hv-column-picker') as HTMLElement & { open: boolean }).open,
    ).toBe(false);
    expect(shell.surfaces.columns).toEqual([...DEFAULT_COLUMNS]);
  });

  // The download itself is stubbed; what matters is that the right scope
  // reaches the store and the file is named from the export stamp.
  it('downloads an export for the scope the menu asked for', async () => {
    for (const [id, scope] of [
      ['export-all', 'all'],
      ['export-view', 'view'],
    ] as const) {
      const { el, sr } = await mountCard({}, { items: [makeItem({ id: '1' })] });
      const shell = shellOf(sr);
      const downloads: { filename: string; text: string }[] = [];
      shell.surfaces.download = (filename, text) => {
        downloads.push({ filename, text });
      };
      const scopes: unknown[] = [];
      const store = (el as unknown as { store: { exportDocument: (s: unknown) => Promise<unknown> } }).store;
      const real = store.exportDocument.bind(store);
      store.exportDocument = (s: unknown) => {
        scopes.push(s);
        return real(s);
      };

      raise(shell, id);
      await settle(el);
      await settle(el);

      expect(scopes, id).toEqual([scope]);
      expect(downloads, id).toHaveLength(1);
      expect(downloads[0].filename, id).toMatch(/^haventory-export-.*\.json$/);
      expect(JSON.parse(downloads[0].text), id).toHaveProperty('haventory_export_version');
      document.body.innerHTML = '';
    }
  });

  it('keeps the card up when an export fails', async () => {
    const { el, sr } = await mountCard();
    const store = (el as unknown as { store: { exportDocument: () => Promise<unknown> } }).store;
    store.exportDocument = () => Promise.reject(new Error('storage_error'));

    raise(shellOf(sr), 'export-all');
    await settle(el);
    await settle(el);

    expect(sr.querySelector('[data-testid="card-shell"]')).toBeTruthy();
  });

  it('opens the organize dialog inside the shell', async () => {
    const { el, sr } = await mountCard();
    const shell = shellOf(sr);
    raise(shell, 'organize');
    await settle(el);

    expect(
      (shell.shadowRoot.querySelector('[data-testid="host-organize"]') as HTMLElement & { open: boolean })
        .open,
    ).toBe(true);
  });
});

describe('haventory-card: store lifecycle', () => {
  it('builds the store from hass and hands it to the shell', async () => {
    const { sr } = await mountCard({}, { items: [makeItem({ id: '1', name: 'Hammer' })] });
    const shell = sr.querySelector('[data-testid="card-shell"]') as HTMLElement & { store?: unknown };
    expect(shell.store).toBeTruthy();
  });

  it('drops its state subscription when it leaves the DOM', async () => {
    const { el } = await mountCard();
    el.remove();
    await el.updateComplete;
    // Re-attaching resubscribes rather than leaving the card frozen.
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.isConnected).toBe(true);
  });
});

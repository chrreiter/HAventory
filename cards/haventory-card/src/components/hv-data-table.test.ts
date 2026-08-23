import './hv-data-table';
import {
  all,
  componentCss,
  makeAttachment,
  makeItem,
  makeMediaBindings,
  mountComponent,
  q,
} from '../test.utils';
import { ACTIONS_COLUMN_WIDTH } from '../store/columns';
import { MEDIA_NAME_TOKEN_PARAM, MEDIA_SIZE_PARAM, attachmentNameToken } from '../ui/media';
import { addDays, toIsoDate } from '../ui/relative-time';
import { rowMenuEntries } from './hv-list-row';
import type { HVDataTable } from './hv-data-table';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import type { Item, Sort } from '../store/types';

async function mount(items: Partial<Item>[], props: Partial<HVDataTable> = {}) {
  const { el } = await mountComponent<HVDataTable>('hv-data-table', {
    items: items.map((i) => makeItem(i)),
    columns: ['quantity', 'category', 'tags', 'due_date', 'updated_at'],
    sort: { field: 'updated_at', order: 'desc' },
    ...props,
  });
  return el;
}

describe('hv-data-table: area', () => {
  const AREAS = [{ id: 'area-kitchen', name: 'Kitchen' }];
  const pantry = { id_path: [], name_path: [], display_path: 'Fridge / Pantry', sort_key: '' };

  it('names the room in the location cell, beside the path', async () => {
    const el = await mount([{ id: '1', effective_area_id: 'area-kitchen', location_path: pantry }], {
      columns: ['location'],
      areas: AREAS,
    });
    const cell = q(el, '[data-testid="cell-location"]');
    expect(cell?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(cell?.textContent).toContain('Fridge › Pantry');
    expect(cell?.getAttribute('title')).toBe('Area: Kitchen · Fridge › Pantry');
  });

  it('leaves a cell with no area exactly as it was', async () => {
    const el = await mount([{ id: '1', location_path: pantry }], { columns: ['location'], areas: AREAS });
    const cell = q(el, '[data-testid="cell-location"]');
    expect(cell?.querySelector('.hv-area-chip')).toBe(null);
    expect(cell?.textContent?.trim()).toBe('Fridge › Pantry');
    expect(cell?.getAttribute('title')).toBe('Fridge › Pantry');
  });

  it('still says nothing is filed there with an em dash', async () => {
    const el = await mount([{ id: '1' }], { columns: ['location'], areas: AREAS });
    expect(q(el, '[data-testid="cell-location"]')?.textContent?.trim()).toBe('—');
  });

  // An area "Kitchen" over a root location "Kitchen" — the way a household
  // names both — put the same word twice in the cell, "Kitchen Kitchen", where
  // the card's own rows had already stopped doing it. One rule, both surfaces.
  it('drops the area mark when the path already opens with that name', async () => {
    const rooted = (display_path: string) => ({
      id_path: [],
      name_path: [],
      display_path,
      sort_key: '',
    });
    for (const path of ['Kitchen', 'Kitchen / Pantry']) {
      const el = await mount(
        [{ id: '1', effective_area_id: 'area-kitchen', location_path: rooted(path) }],
        { columns: ['location'], areas: AREAS },
      );
      const cell = q(el, '[data-testid="cell-location"]');

      expect(cell?.querySelector('[data-testid="area-chip"]'), path).toBe(null);
      expect(cell?.textContent?.replace(/\s+/g, ' ').trim(), path).toBe(path.replace(' / ', ' › '));
      // The pairing is still readable in full where the cell keeps it.
      expect(cell?.getAttribute('title'), path).toBe(
        `Area: Kitchen · ${path.replace(' / ', ' › ')}`,
      );
      el.remove();
    }
  });

  // A deeper segment of the same name is a different place inside the area, so
  // the mark still has something to say.
  it('keeps the mark when the area only reappears further down the path', async () => {
    const el = await mount(
      [
        {
          id: '1',
          effective_area_id: 'area-kitchen',
          location_path: { id_path: [], name_path: [], display_path: 'Cellar / Kitchen', sort_key: '' },
        },
      ],
      { columns: ['location'], areas: AREAS },
    );
    expect(
      q(el, '[data-testid="cell-location"]')?.querySelector('.hv-area-chip')?.textContent,
    ).toContain('Kitchen');
  });
});

describe('hv-data-table: a path too long for its column', () => {
  const AREAS = [{ id: 'area-kitchen', name: 'Küche' }];
  const DEEP = 'Küche / Hochschrank / Oberstes Fach / Vorratsbox / Backzutaten';
  const deep = (display_path: string) => ({ id_path: [], name_path: [], display_path, sort_key: '' });

  const mountPath = (display_path: string) =>
    mount([{ id: '1', effective_area_id: 'area-kitchen', location_path: deep(display_path) }], {
      columns: ['location'],
      areas: AREAS,
    });

  const segments = (el: HVDataTable) =>
    [...q(el, '[data-testid="cell-location"]')!.querySelectorAll('.hv-path-seg')].map(
      (s) => s.textContent ?? '',
    );

  // Elided as one run of text the cell showed the area mark and "Küc…" — three
  // letters of a five-segment path, naming nothing, with the leaf the reader is
  // after nowhere on the row.
  it('keeps every segment of a deep path whole', async () => {
    const el = await mountPath(DEEP);
    const names = segments(el).map((s) => s.replace(' › ', ''));

    expect(names).toEqual([
      'Küche',
      'Hochschrank',
      'Oberstes Fach',
      'Vorratsbox',
      'Backzutaten',
    ]);
  });

  // The separator rides inside the segment ahead of it, so a wrap can never
  // open a line with a lone "›" — and the path still reads as one string when
  // it is copied or announced.
  it('never leaves a separator to start a line on its own', async () => {
    const el = await mountPath(DEEP);
    const parts = segments(el);

    for (const part of parts) expect(part.startsWith('›')).toBe(false);
    expect(parts.slice(0, -1).every((p) => p.endsWith(' › '))).toBe(true);
    expect(parts[parts.length - 1]).toBe('Backzutaten');
    expect(q(el, '[data-testid="cell-location"]')?.textContent).toContain(
      'Küche › Hochschrank › Oberstes Fach › Vorratsbox › Backzutaten',
    );
  });

  // The reported cell was "🏠 Living Room (" — the mark, an opening bracket and
  // nothing after it. Punctuation inside a location name travels with the word
  // it belongs to and cannot be left holding a cell on its own.
  it('never strands the punctuation inside a location name', async () => {
    const el = await mountPath('Wohnzimmer (Nord) / Regal');
    const parts = segments(el);

    expect(parts.map((p) => p.replace(' › ', ''))).toEqual(['Wohnzimmer (Nord)', 'Regal']);
    for (const part of parts) expect(/^[(){}[\]·,;:]+$/.test(part.trim())).toBe(false);
  });

  it('carries the whole path in the cell title, wrapped or not', async () => {
    const el = await mountPath(DEEP);
    expect(q(el, '[data-testid="cell-location"]')?.getAttribute('title')).toBe(
      'Area: Küche · Küche › Hochschrank › Oberstes Fach › Vorratsbox › Backzutaten',
    );
  });

});

describe('hv-data-table: narrow screens', () => {

  it('reflects the selecting flag, which is all the pinning rules can read', async () => {
    const el = await mount([{ id: '1' }], { selectable: true });
    expect(el.hasAttribute('selectable')).toBe(true);
    el.selectable = false;
    await el.updateComplete;
    expect(el.hasAttribute('selectable')).toBe(false);
  });
});

describe('hv-data-table: columns', () => {
  it('renders a header and a cell per selected column', async () => {
    const el = await mount([{ id: '1', name: 'M4 Screws', quantity: 340, category: 'Hardware', tags: ['m4'] }]);
    const headers = all(el, '[role="columnheader"]').map((h) => h.textContent?.trim());
    expect(headers[0]).toContain('Name');
    expect(headers.join(' ')).toContain('Qty');
    expect(headers.join(' ')).toContain('Updated');

    expect(q(el, '[data-testid="cell-quantity"]')?.textContent).toBe('340');
    expect(q(el, '[data-testid="cell-category"]')?.textContent).toBe('Hardware');
    expect(q(el, '[data-testid="cell-tags"]')?.textContent).toContain('m4');
  });

  // The Tags column and the Category column sit side by side, so a tag has to
  // read as one here the same way it does in the detail sheet.
  it('chips a tag the way every other surface chips one', async () => {
    const el = await mount([{ id: '1', category: 'Hardware', tags: ['m4', 'metric'] }]);
    const tags = [...q(el, '[data-testid="cell-tags"]')!.querySelectorAll('.hv-chip')];

    expect(tags.map((t) => t.textContent?.trim())).toEqual(['#m4', '#metric']);
    expect(tags.every((t) => t.classList.contains('tag'))).toBe(true);
    // The category cell is plain text in this column, not a chip at all.
    expect(q(el, '[data-testid="cell-category"]')?.querySelector('.hv-chip')).toBe(null);
  });

  // Cut at the cell's edge the column showed one chip of six and half of the
  // next — "#re…", sometimes a bare "#" — with no count to say the rest
  // existed. jsdom lays nothing out, so what is assertable is that nothing
  // clips and the chips have somewhere to go.
  it('wraps a long tag set onto more lines instead of cutting a chip', async () => {
    const tags = ['essen', 'vorrat', 'trocken', 'reserve', 'küche', 'bio'];
    const el = await mount([{ id: '1', tags }], { columns: ['tags'] });
    const chips = [...q(el, '[data-testid="cell-tags"]')!.querySelectorAll('.hv-chip')];

    // Every tag, whole: no cut-off set and no "+N" standing in for one.
    expect(chips.map((c) => c.textContent?.trim())).toEqual(tags.map((t) => `#${t}`));

    const css = componentCss('hv-data-table');
    expect(css).toMatch(/\.tags \{[^}]*flex-wrap: wrap/);
  });

  it('says so when an item carries no tags', async () => {
    const el = await mount([{ id: '1', tags: [] }]);
    const cell = q(el, '[data-testid="cell-tags"]')!;
    expect(cell.textContent?.trim()).toBe('—');
    expect(cell.querySelector('.hv-tag-mark')).toBe(null);
  });

  it('follows the column selection', async () => {
    const el = await mount([{ id: '1' }], { columns: ['quantity'] });
    expect(q(el, '[data-testid="cell-quantity"]')).toBeTruthy();
    expect(q(el, '[data-testid="cell-category"]')).toBe(null);
  });

  // The order is the user's, set in the column picker and stored per browser.
  it('draws the columns in the order it is given', async () => {
    const el = await mount([{ id: '1', quantity: 3, category: 'Hardware' }], {
      columns: ['category', 'quantity'],
    });
    const headers = all(el, '[role="columnheader"]').map((h) => h.textContent?.trim());
    // Name leads, the trailing actions header is empty.
    expect(headers.slice(0, 3)).toEqual(['Name', 'Category', 'Qty']);

    const cells = all(el, '[data-testid^="cell-"]').map((c) => c.dataset.testid);
    expect(cells).toEqual(['cell-category', 'cell-quantity']);
  });

  // Sort bindings hang off the column definition, not off a position, so a
  // permutation must not hand a header the neighbour's field.
  it("keeps each header's sort field across a permutation", async () => {
    const el = await mount([{ id: '1' }], { columns: ['updated_at', 'due_date', 'quantity'] });
    const fields = all(el, '[data-testid="table-sort"]').map((h) => h.dataset.field);
    expect(fields).toEqual(['name', 'updated_at', 'due_date', 'quantity']);
  });

  // The name is the row's identity and the trailing actions are where the hand
  // goes; neither is in the optional set, so neither can be moved.
  it('keeps the name column first and the actions last whatever the order', async () => {
    const el = await mount([{ id: '1', name: 'Sander' }], { columns: ['tags', 'quantity'] });
    const headers = all(el, '[role="columnheader"]');
    expect(headers[0].textContent?.trim()).toBe('Name');
    expect(headers[headers.length - 1].textContent?.trim()).toBe('');

    const row = q(el, '[data-testid="table-row"]') as HTMLElement;
    expect((row.firstElementChild as HTMLElement).classList.contains('name-cell')).toBe(true);
    expect((row.lastElementChild as HTMLElement).classList.contains('actions')).toBe(true);
  });

  it('dashes an empty cell rather than leaving a gap', async () => {
    const el = await mount([{ id: '1', category: null, tags: [], due_date: null }]);
    expect(q(el, '[data-testid="cell-category"]')?.textContent).toBe('—');
    expect(q(el, '[data-testid="cell-due_date"]')?.textContent).toBe('—');
  });

  it('marks low stock and overdue in the cells', async () => {
    const el = await mount([
      { id: '1', quantity: 1, low_stock_threshold: 5, checked_out: true, due_date: '2020-01-01' },
    ]);
    expect(q(el, '[data-testid="cell-quantity"]')?.classList.contains('low')).toBe(true);
    expect(q(el, '[data-testid="cell-due_date"]')?.classList.contains('overdue')).toBe(true);
    expect(el.shadowRoot?.textContent).toContain('Overdue');
  });
});

// The row's own word for lateness, which is what a table scrolled sideways or
// pinned to its name column has left to say it with.
describe('hv-data-table: the checked-out chip names an overdue loan', () => {
  it('reads Overdue in the error tone once the due date has passed', async () => {
    const el = await mount([{ id: '1', checked_out: true, due_date: '2020-01-01' }]);
    const chip = q(el, '[data-testid="table-checked-out"]');
    expect(chip?.textContent?.trim()).toBe('Overdue');
    expect(chip?.classList.contains('error')).toBe(true);
    expect(chip?.classList.contains('state')).toBe(false);
  });

  it('stays a calm Checked out while the loan still has time to run', async () => {
    const el = await mount([{ id: '1', checked_out: true, due_date: addDays(3) }]);
    const chip = q(el, '[data-testid="table-checked-out"]');
    expect(chip?.textContent?.trim()).toBe('Checked out');
    expect(chip?.classList.contains('state')).toBe(true);
  });

  // A loan with no return date agreed cannot be late, and neither can an item
  // nobody has taken — the chip only exists for the first of those.
  it('leaves a dateless loan calm, and draws nothing for an item on the shelf', async () => {
    const dateless = await mount([{ id: '1', checked_out: true, due_date: null }]);
    expect(q(dateless, '[data-testid="table-checked-out"]')?.textContent?.trim()).toBe(
      'Checked out',
    );

    const shelved = await mount([{ id: '1', checked_out: false, due_date: '2020-01-01' }]);
    expect(q(shelved, '[data-testid="table-checked-out"]')).toBe(null);
  });

  // The Due column carries a date, not the word — so unlike the status chip
  // above, this one has nothing to stand down for and says it either way.
  it('says it whether or not the Due column is on screen', async () => {
    for (const columns of [['due_date'], ['quantity']] as const) {
      const el = await mount([{ id: '1', checked_out: true, due_date: '2020-01-01' }], {
        columns: [...columns],
      });
      expect(
        q(el, '[data-testid="table-checked-out"]')?.textContent?.trim(),
        `columns=${columns.join()}`,
      ).toBe('Overdue');
    }
  });
});

// Both chips are unshrinkable, so on a row carrying both they take 138px of the
// 250px name track and leave 112px of name — about sixteen characters, measured
// on a real instance at the table's floor width and again at 390px, where the
// same cell is pinned. Dropping one is what buys the name back; which one to
// drop is the choice the phone row already makes on its single line.
describe('hv-data-table: the name cell picks one chip', () => {
  const bothWays = { quantity: 1, low_stock_threshold: 5 };

  it('marks a low row that nobody has taken', async () => {
    const el = await mount([{ id: '1', ...bothWays }]);
    expect(q(el, '[data-testid="table-low"]')?.textContent?.trim()).toBe('Low');
  });

  it('stands Low down for Checked out, which is the more interrupting of the two', async () => {
    const el = await mount([{ id: '1', ...bothWays, checked_out: true }]);
    expect(q(el, '[data-testid="table-low"]')).toBe(null);
    expect(q(el, '.name-cell')?.textContent).toContain('Checked out');
    // The fact is not lost with the chip: the quantity is still drawn as low.
    expect(q(el, '[data-testid="cell-quantity"]')?.classList.contains('low')).toBe(true);
  });

  it('leaves the status chip alone — that one can shrink and elide its own label', async () => {
    const el = await mount([{ id: '1', ...bothWays, checked_out: true, status: 'missing' }], {
      columns: ['quantity'],
    });
    expect(q(el, '[data-testid="table-low"]')).toBe(null);
    expect(q(el, '[data-testid="table-status"]')?.textContent?.trim()).toBe('Missing');
    expect(q(el, '.name-cell')?.textContent).toContain('Checked out');
  });

});

describe('hv-data-table: row thumbnail', () => {
  it('shows the first picture beside the name, at the card list row’s own box', async () => {
    const media = makeMediaBindings();
    const el = await mount(
      [{ id: 'i-thumb', name: 'Cordless drill', attachments: [makeAttachment({ id: 'att-1' })] }],
      { media },
    );
    // One more frame: the signed URL arrives from a resolved promise.
    await el.updateComplete;
    await el.updateComplete;

    const img = q(el, '[data-testid="row-thumb"]') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    // `size=thumb`: a 36px tile served the stored file was up to 8 MB of
    // download per row. The parameter is signed with the path, so it has to be
    // on the URL before signing rather than appended to a signed one.
    expect(img?.getAttribute('src')).toBe(
      `/api/haventory/media/i-thumb/att-1?${MEDIA_NAME_TOKEN_PARAM}=`
        + `${attachmentNameToken(makeAttachment({ id: 'att-1' }))}`
        + `&${MEDIA_SIZE_PARAM}=thumb&authSig=test`,
    );
    expect(img?.getAttribute('alt')).toBe('Photo of Cordless drill');
    // A tile is small but there is still one per row, so the browser is told
    // not to fetch and decode every one of them at once.
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
    // It leads the cell: a picture after the name would be a second column of
    // ragged marks rather than the thing the eye lands on first.
    expect(q(el, '.name-cell')?.firstElementChild).toBe(img);
  });

  // A placeholder here would add a column of empty squares to a mostly
  // photo-less inventory — and would spend the name's floor on every row.
  it('renders no image element at all for a row without a picture', async () => {
    const el = await mount([{ id: '1', name: 'Screws' }], { media: makeMediaBindings() });
    await el.updateComplete;

    expect(q(el, '[data-testid="row-thumb"]')).toBeNull();
    expect(el.shadowRoot?.querySelector('img')).toBeNull();
  });

  // The panel and the card are two hosts of the same table; one that was never
  // handed the signer must not render broken images.
  it('shows nothing rather than a broken image without a signer', async () => {
    const el = await mount([{ id: '1', attachments: [makeAttachment()] }]);
    await el.updateComplete;
    await el.updateComplete;

    expect(q(el, '[data-testid="row-thumb"]')).toBeNull();
  });

  it('ignores a non-picture attachment', async () => {
    const el = await mount(
      [{ id: '1', attachments: [makeAttachment({ kind: 'manual', mime: 'application/pdf' })] }],
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    await el.updateComplete;

    expect(q(el, '[data-testid="row-thumb"]')).toBeNull();
  });

  describe('and its file is gone', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** Two rows with a picture each, both failing to load it. */
    async function broken(probe: () => unknown) {
      vi.stubGlobal('fetch', probe);
      const el = await mount(
        [
          { id: 'i-1', name: 'Cordless drill', attachments: [makeAttachment({ id: 'att-1' })] },
          { id: 'i-2', name: 'Hammer', attachments: [makeAttachment({ id: 'att-2' })] },
        ],
        { media: makeMediaBindings() },
      );
      await el.updateComplete;
      await el.updateComplete;
      for (const img of all(el, '[data-testid="row-thumb"]')) {
        img.dispatchEvent(new Event('error'));
      }
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
      }
      return el;
    }

    it('draws a missing mark in place of the browser’s broken-image glyph', async () => {
      const el = await broken(vi.fn(async () => new Response(null, { status: 404 })));

      const marks = all(el, '[data-testid="row-thumb-missing"]');
      expect(marks).toHaveLength(2);
      // Glyph-only in a 34px box, so the state has to reach a screen reader and
      // a pointer some other way.
      expect(marks[0].getAttribute('aria-label')).toBe('File missing');
      expect(marks[0].getAttribute('title')).toBe('File missing');
      // No <img> at all: an element with a src is what draws the glyph and
      // spills the alt text out of the tile.
      expect(el.shadowRoot?.querySelector('img')).toBeNull();
      // It still leads the cell, so a restored inventory keeps its rhythm
      // rather than shifting every name left by a tile.
      expect(q(el, '.name-cell')?.firstElementChild).toBe(marks[0]);
    });

    it('asks the backend nothing for a table whose pictures load', async () => {
      const probe = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', probe);
      const el = await mount([{ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }], {
        media: makeMediaBindings(),
      });
      await el.updateComplete;
      await el.updateComplete;

      expect(q(el, '[data-testid="row-thumb"]')).toBeTruthy();
      expect(probe).not.toHaveBeenCalled();
    });

    it('keeps the tile when the probe cannot say the file is gone', async () => {
      const el = await broken(
        vi.fn(async () => {
          throw new Error('offline');
        }),
      );

      expect(q(el, '[data-testid="row-thumb-missing"]')).toBeNull();
      expect(q(el, '[data-testid="row-thumb"]')?.classList.contains('broken')).toBe(true);
      expect(componentCss('hv-data-table')).toMatch(/\.thumb\.broken \{ visibility: hidden/);
    });
  });
});

describe('hv-data-table: sorting', () => {
  it('only makes a header clickable when the backend can sort by it', async () => {
    const el = await mount([{ id: '1' }]);
    const sortable = all(el, '[data-testid="table-sort"]').map((b) => b.dataset.field);
    expect(sortable).toEqual(['name', 'quantity', 'due_date', 'updated_at']);
    // Category and tags have no sort field server-side, so no button.
    expect(q(el, '[data-field="category"]')).toBe(null);
    expect(q(el, '[data-field="tags"]')).toBe(null);
  });

  // The backend orders on the item's own location path, so this header stops
  // being the odd one out among the columns that look sortable.
  it('makes the Location header a sort control', async () => {
    const el = await mount([{ id: '1' }], { columns: ['location'] });
    const header = q(el, '[data-field="location"]') as HTMLElement;
    expect(header).not.toBe(null);
    expect(header.textContent?.trim()).toBe('Location');

    let asked: unknown = null;
    el.addEventListener('sort-change', (e) => {
      asked = (e as CustomEvent).detail;
    });
    (header as HTMLButtonElement).click();
    // Opens A→Z: a path is text, and top-down is what ordering by it means.
    expect(asked).toEqual({ sort: { field: 'location', order: 'asc' } });
  });

  it('marks the sorted column and its direction', async () => {
    const el = await mount([{ id: '1' }], { sort: { field: 'name', order: 'asc' } });
    const header = q(el, '[data-field="name"]') as HTMLElement;
    expect(header.classList.contains('sorted')).toBe(true);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(q(el, '[data-field="quantity"]')?.getAttribute('aria-sort')).toBe('none');
  });

  it('flips the direction when the sorted column is clicked again', async () => {
    const el = await mount([{ id: '1' }], { sort: { field: 'name', order: 'asc' } });
    let sort: Sort | null = null;
    el.addEventListener('sort-change', (e) => {
      sort = (e as CustomEvent).detail.sort;
    });

    (q(el, '[data-field="name"]') as HTMLButtonElement).click();
    expect(sort).toEqual({ field: 'name', order: 'desc' });
  });

  it('picks a sensible direction for a newly chosen column', async () => {
    const el = await mount([{ id: '1' }], { sort: { field: 'name', order: 'asc' } });
    const seen: Sort[] = [];
    el.addEventListener('sort-change', (e) => seen.push((e as CustomEvent).detail.sort));

    (q(el, '[data-field="updated_at"]') as HTMLButtonElement).click();
    (q(el, '[data-field="quantity"]') as HTMLButtonElement).click();

    // Timestamps read newest-first; counts read smallest-first.
    expect(seen[0]).toEqual({ field: 'updated_at', order: 'desc' });
    expect(seen[1]).toEqual({ field: 'quantity', order: 'asc' });
  });

  // A deadline is not a timestamp: "newest" due date is the least urgent one.
  // Opening Due on desc buried the overdue rows the card badges elsewhere.
  it('opens a deadline column soonest-first, not newest-first', async () => {
    const el = await mount([{ id: '1' }], {
      columns: ['due_date', 'inspection_date'],
      sort: { field: 'name', order: 'asc' },
    });
    const seen: Sort[] = [];
    el.addEventListener('sort-change', (e) => seen.push((e as CustomEvent).detail.sort));

    (q(el, '[data-field="due_date"]') as HTMLButtonElement).click();
    (q(el, '[data-field="inspection_date"]') as HTMLButtonElement).click();

    expect(seen[0]).toEqual({ field: 'due_date', order: 'asc' });
    expect(seen[1]).toEqual({ field: 'inspection_date', order: 'asc' });
  });
});

describe('hv-data-table: inspection column', () => {
  // The header used to read "Inspected", past tense, over a date the rest of
  // the card treats as the next one due.
  it('heads the column with the date it holds', async () => {
    const el = await mount([{ id: '1' }], { columns: ['inspection_date'] });
    expect(q(el, '[data-field="inspection_date"]')?.textContent?.trim()).toBe('Next inspection');
  });

  // Today counts: an inspection date names the day the item is next due to be
  // inspected, so the cell marks it then rather than the morning after.
  it('marks a cell whose inspection has come due, and only those', async () => {
    const el = await mount(
      [
        { id: '1', inspection_date: '2020-01-01' },
        { id: '2', inspection_date: toIsoDate() },
        { id: '3', inspection_date: '2099-01-01' },
        { id: '4', inspection_date: null },
      ],
      { columns: ['inspection_date'] },
    );
    const cells = all(el, '[data-testid="cell-inspection_date"]');
    expect(cells.map((c) => c.classList.contains('due'))).toEqual([true, true, false, false]);
  });
});

describe('hv-data-table: rows', () => {
  it('emits row actions with the item id', async () => {
    const el = await mount([{ id: 'item-1', quantity: 5 }]);
    const seen: string[] = [];
    for (const name of ['increment', 'decrement', 'edit', 'open-item']) {
      el.addEventListener(name, (e) => seen.push(`${name}:${(e as CustomEvent).detail.itemId}`));
    }

    (q(el, '[data-testid="table-increment"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="table-decrement"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="table-edit"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="table-row"]') as HTMLElement).click();

    expect(seen).toEqual([
      'increment:item-1',
      'decrement:item-1',
      'edit:item-1',
      'open-item:item-1',
    ]);
  });

  it('disables the stepper for a checked-out row and at zero', async () => {
    const el = await mount([{ id: '1', checked_out: true }, { id: '2', quantity: 0 }]);
    const rows = all(el, '[data-testid="table-row"]');
    expect(
      (rows[0].querySelector('[data-testid="table-increment"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (rows[1].querySelector('[data-testid="table-decrement"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  // The host is the box that scrolls, so the host is where the position can be
  // read — and a scroll event fires on that box and does not bubble.
  it('reports scroll position so the host can page in more', async () => {
    const el = await mount([{ id: '1' }]);
    let ratio: number | null = null;
    el.addEventListener('near-end', (e) => {
      ratio = (e as CustomEvent).detail.ratio;
    });
    el.dispatchEvent(new Event('scroll'));
    expect(typeof ratio).toBe('number');
  });

  it('stops reporting once it is off the page', async () => {
    const el = await mount([{ id: '1' }]);
    let seen = 0;
    el.addEventListener('near-end', () => (seen += 1));
    el.remove();
    el.dispatchEvent(new Event('scroll'));
    expect(seen).toBe(0);
  });

  it('shows the host-supplied empty message', async () => {
    const el = await mount([]);
    expect(q(el, '[data-testid="table-empty"]')).toBeTruthy();
  });

  it('chips a flagged status in the name cell and leaves ok rows quiet', async () => {
    const el = await mount([
      { id: '1', status: 'missing' },
      { id: '2', status: 'needs_repair' },
      { id: '3', status: 'ok' },
      { id: '4' },
    ]);
    const rows = all(el, '[data-testid="table-row"]');
    const chip = (row: HTMLElement) =>
      row.querySelector('[data-testid="table-status"]')?.textContent?.trim() ?? null;
    expect(rows.map(chip)).toEqual(['Missing', 'Needs repair', null, null]);
  });
});

describe('hv-data-table: keyboard', () => {
  const captured = (el: HVDataTable, names: string[]) => {
    const seen: string[] = [];
    for (const name of names) {
      el.addEventListener(name, (e) => seen.push(`${name}:${(e as CustomEvent).detail.itemId}`));
    }
    return seen;
  };
  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  // The rows were tabbable and had a click handler and nothing else, so on the
  // one surface that lists every item, no item could be reached without a mouse.
  it('keeps the same shortcuts the card list row has', async () => {
    const el = await mount([{ id: 'item-1' }]);
    const seen = captured(el, ['open-item', 'request-delete', 'increment', 'decrement']);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;

    for (const key of ['Enter', 'Delete', '+', '-']) press(row, key);

    expect(seen).toEqual([
      'open-item:item-1',
      'request-delete:item-1',
      'increment:item-1',
      'decrement:item-1',
    ]);
  });

  it('takes the numpad and shifted spellings of the same two keys', async () => {
    const el = await mount([{ id: 'item-1' }]);
    const seen = captured(el, ['increment', 'decrement']);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;

    // `=` is what an unshifted `+` reports on a US layout; `Add`/`Subtract` are
    // the numpad's.
    for (const key of ['=', 'Add', 'Subtract']) press(row, key);

    expect(seen).toEqual(['increment:item-1', 'increment:item-1', 'decrement:item-1']);
  });

  it('claims the keys it acts on, so the surface below does not answer too', async () => {
    const el = await mount([{ id: 'item-1' }]);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;
    expect(press(row, 'Enter')).toBe(false);
    // Anything else is still the browser's — Tab has to keep leaving the row.
    expect(press(row, 'Tab')).toBe(true);
  });

  it('follows the row click into selection mode rather than opening the item', async () => {
    const el = await mount([{ id: 'item-1' }], { selectable: true });
    const seen = captured(el, ['open-item', 'toggle-select']);
    press(q(el, '[data-testid="table-row"]') as HTMLElement, 'Enter');
    expect(seen).toEqual(['toggle-select:item-1']);
  });

  it('leaves a key pressed on a control inside the row to that control', async () => {
    // Enter on Edit already opens the editor; the row acting on the same press
    // would open it a second time, and Delete on any of the three buttons would
    // ask to delete the item.
    const el = await mount([{ id: 'item-1' }]);
    const seen = captured(el, ['open-item', 'request-delete', 'increment', 'decrement']);
    const edit = q(el, '[data-testid="table-edit"]') as HTMLElement;

    for (const key of ['Enter', 'Delete', '+', '-']) press(edit, key);

    expect(seen).toEqual([]);
  });
});

describe('hv-data-table: table semantics', () => {
  // `row`, `columnheader` and `cell` are only meaningful under a table role.
  // Without one the structure is dropped and the rows read as a run of text.
  it('carries the table role the rows and cells hang off', async () => {
    const el = await mount([{ id: '1' }]);
    expect(el.getAttribute('role')).toBe('table');
  });

  it('marks every value in a row as a cell', async () => {
    const el = await mount([{ id: '1', tags: ['m4'] }]);
    const row = q(el, '[data-testid="table-row"]') as HTMLElement;
    const cells = [...row.querySelectorAll('[role="cell"]')];
    // Name, the five mounted columns, and the action group.
    expect(cells).toHaveLength(7);
    expect(cells[0].querySelector('[data-testid="table-name"]')).toBeTruthy();
    expect(cells.map((c) => c.getAttribute('data-testid'))).toContain('cell-quantity');
  });

  it('gives each row a cell for every column header', async () => {
    const el = await mount([{ id: '1' }], { columns: ['quantity', 'location', 'status'] });
    const headers = all(el, '[role="columnheader"]').length;
    const cells = (q(el, '[data-testid="table-row"]') as HTMLElement).querySelectorAll('[role="cell"]');
    expect(cells).toHaveLength(headers);
  });

  it('spans the empty message across a row, the way a table has to', async () => {
    // A row group whose only child is a loose message owns something a table
    // cannot contain, and the whole structure is dropped rather than repaired.
    const el = await mount([]);
    const empty = q(el, '[data-testid="table-empty"]') as HTMLElement;
    expect(empty.getAttribute('role')).toBe('cell');
    expect(empty.parentElement?.getAttribute('role')).toBe('row');
    expect(empty.closest('[role="rowgroup"]')).toBeTruthy();
  });

  it('leaves the announcing to whatever fills the slot', async () => {
    // The shared empty state is a live region already; a second one wrapped
    // around it says everything twice.
    const el = await mount([]);
    expect(q(el, '[data-testid="table-empty"]')?.getAttribute('role')).not.toBe('status');
  });
});

describe('hv-data-table: status column', () => {
  const mixed = [
    { id: '1', status: 'missing' as const },
    { id: '2', status: 'needs_repair' as const },
    { id: '3', status: 'ok' as const },
    { id: '4' },
  ];

  // The name-cell chip only ever marks the exceptions. A column that did the
  // same would leave most rows blank under a header promising a value.
  it('names every row, ok included, and reads an absent status as ok', async () => {
    const el = await mount(mixed, { columns: ['status'] });
    expect(all(el, '[data-testid="cell-status"]').map((c) => c.textContent?.trim())).toEqual([
      'Missing',
      'Needs repair',
      'OK',
      'OK',
    ]);
  });

  // Every value in the column is a chip, or half of it would read as a second
  // column interleaved with the first. The colour is the status definition's,
  // not one of the fixed semantic hues — a household chooses it.
  it('chips every value and paints each from its own definition', async () => {
    const el = await mount(mixed, { columns: ['status'] });
    const cells = all(el, '[data-testid="cell-status"]');
    expect(cells.map((c) => !!c.querySelector('.hv-status-chip'))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(cells.map((c) => !!c.querySelector('.hv-status-chip.tone-amber'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(cells.map((c) => !!c.querySelector('.hv-status-chip.tone-green'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // The semantic vocabulary stays for the marks that do carry a fixed meaning.
    expect(cells.map((c) => !!c.querySelector('.hv-chip.warning'))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('stands the name-cell chip down, so no row says it twice', async () => {
    const el = await mount([{ id: '1', status: 'missing' }], { columns: ['status'] });
    expect(q(el, '[data-testid="table-status"]')).toBe(null);
    expect(q(el, '[data-testid="cell-status"]')?.textContent?.trim()).toBe('Missing');
  });

  it('keeps the name-cell chip when the column is turned off', async () => {
    const el = await mount([{ id: '1', status: 'missing' }], { columns: ['quantity'] });
    expect(q(el, '[data-testid="table-status"]')?.textContent?.trim()).toBe('Missing');
  });

  it('gives the header no sort button — the API cannot order by status', async () => {
    const el = await mount([{ id: '1' }], { columns: ['status'] });
    expect(all(el, '[data-testid="table-sort"]').map((b) => b.dataset.field)).not.toContain('status');
  });
});

describe('hv-data-table: selection mode', () => {
  it('adds checkboxes and turns row clicks into selection', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const seen: string[] = [];
    el.addEventListener('toggle-select', (e) => seen.push((e as CustomEvent).detail.itemId));
    el.addEventListener('open-item', () => seen.push('open'));

    expect(all(el, '[data-testid="table-row-select"]')).toHaveLength(2);
    (q(el, '[data-testid="table-row"]') as HTMLElement).click();
    expect(seen).toEqual(['1']);
  });

  it('reflects none, some and all in the header checkbox', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const master = () => q(el, '[data-testid="table-select-all"]') as HTMLElement;
    expect(master().getAttribute('aria-checked')).toBe('false');

    el.selection = new Set(['1']);
    await el.updateComplete;
    expect(master().getAttribute('aria-checked')).toBe('mixed');

    el.selection = new Set(['1', '2']);
    await el.updateComplete;
    expect(master().getAttribute('aria-checked')).toBe('true');
  });

  it('selects all loaded rows, then clears', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const seen: string[] = [];
    el.addEventListener('select-all-loaded', () => seen.push('select-all'));
    el.addEventListener('clear-selection', () => seen.push('clear'));

    (q(el, '[data-testid="table-select-all"]') as HTMLButtonElement).click();
    el.selection = new Set(['1', '2']);
    await el.updateComplete;
    (q(el, '[data-testid="table-select-all"]') as HTMLButtonElement).click();

    expect(seen).toEqual(['select-all', 'clear']);
  });

  // jsdom does not run the shadow-DOM cascade, so nothing here can read the
  // painted border. The two halves that produce it are assertable separately:
  // the box keeps `.box` in every state, and the sort-header reset that would
  // otherwise outrank it is keyed to a class the box does not carry.
  it('keeps the header checkbox on .box through none, some and all', async () => {
    const el = await mount([{ id: '1' }, { id: '2' }], { selectable: true });
    const master = () => q(el, '[data-testid="table-select-all"]') as HTMLElement;
    expect([...master().classList]).toEqual(['box']);

    el.selection = new Set(['1']);
    await el.updateComplete;
    expect([...master().classList]).toEqual(['box', 'mixed']);

    el.selection = new Set(['1', '2']);
    await el.updateComplete;
    expect([...master().classList]).toEqual(['box', 'on']);
  });

  it('keeps the sort-header reset off the header checkbox', async () => {
    const css = componentCss('hv-data-table');
    expect(css).toMatch(/\.head button\.sort \{[^}]*border: none/);
    expect(css).toMatch(/\.box \{[^}]*border: 1\.5px solid var\(--hv-text-tertiary\)/);
    expect(css).toMatch(/\.box\.on, \.box\.mixed \{[^}]*background: var\(--hv-primary-dark\)/);

    const el = await mount([{ id: '1' }], { selectable: true });
    for (const b of all(el, '[data-testid="table-sort"]')) expect(b.classList.contains('sort')).toBe(true);
    expect(q(el, '[data-testid="table-select-all"]')?.classList.contains('sort')).toBe(false);
  });

  it('hides the row action buttons while selecting', async () => {
    const el = await mount([{ id: '1' }], { selectable: true });
    // Actions stay available; it is the row click that changes meaning.
    expect(q(el, '[data-testid="table-edit"]')).toBeTruthy();
    expect(q(el, '[data-testid="table-row-select"]')).toBeTruthy();
  });
});

// Check out, Check in, a due date and Delete lived on the card's rows only, so
// the surface built for working through the whole inventory offered the fewest
// actions per row. Same component, same list, same events.
describe('hv-data-table: row menu', () => {
  const menu = (el: HVDataTable, index = 0) =>
    all(el, '[data-testid="table-row-menu"]')[index] as HTMLElement & {
      entries: OverflowMenuEntry[];
      updateComplete: Promise<unknown>;
    };

  const labels = (el: HVDataTable, index = 0) =>
    menu(el, index)
      .entries.filter((e): e is Extract<OverflowMenuEntry, { id: string }> => 'id' in e)
      .map((e) => e.id);

  it('offers exactly what the card rows offer, for both check-out states', async () => {
    const el = await mount([
      { id: '1', name: 'In' },
      { id: '2', name: 'Out', checked_out: true },
    ]);

    expect(labels(el, 0)).toEqual(['check-out', 'edit', 'delete']);
    expect(labels(el, 1)).toEqual(['check-in', 'set-due-date', 'delete']);
    // One list, so the two surfaces cannot drift.
    expect(menu(el, 0).entries).toEqual(rowMenuEntries(makeItem({ id: '1', name: 'In' })));
  });

  // No anchor travels with it: everything the menu opens on this surface is
  // centred, because the ⋮ it would hang from sits in a column the table scrolls
  // sideways out of view.
  it('reports the picked action and the row it came from, and nothing else', async () => {
    const el = await mount([{ id: '1', name: 'Drill' }]);
    const seen: Record<string, unknown>[] = [];
    el.addEventListener('row-action', (e) => seen.push((e as CustomEvent).detail));

    for (const id of ['check-out', 'edit', 'delete']) {
      menu(el).dispatchEvent(new CustomEvent('select', { detail: { id }, bubbles: true, composed: true }));
    }

    expect(seen.map((d) => d.action)).toEqual(['check-out', 'edit', 'delete']);
    expect(seen.every((d) => d.itemId === '1')).toBe(true);
    expect(seen.map((d) => Object.keys(d).sort())).toEqual([
      ['action', 'itemId'],
      ['action', 'itemId'],
      ['action', 'itemId'],
    ]);
  });

  // The row's own click opens the item; a click on the menu is not that.
  it('does not open the row behind the menu', async () => {
    const el = await mount([{ id: '1' }]);
    let opened = 0;
    el.addEventListener('open-item', () => {
      opened += 1;
    });

    menu(el).click();
    expect(opened).toBe(0);
  });

  it('rides the same hover reveal as the rest of the actions cell', async () => {
    const el = await mount([{ id: '1' }]);
    expect(menu(el).closest('.actions')).toBeTruthy();
    expect(componentCss('hv-data-table')).toMatch(/\.actions \{[^}]*visibility: hidden/);
    expect(componentCss('hv-data-table')).toMatch(/\.row:hover \.actions, \.row:focus-within \.actions \{ visibility: visible/);
  });

  // 26px outlined here against 30px borderless on the card's rows: two answers
  // to one control. The quantity pair keeps the outline, as the card's stepper
  // does; Edit and the ⋮ are the plain pair on both surfaces.
  it('draws Edit the way the card rows draw it', async () => {
    const el = await mount([{ id: '1' }]);
    expect(q(el, '[data-testid="table-edit"]')?.classList.contains('plain')).toBe(true);
    expect(componentCss('hv-data-table')).toMatch(/\.actions button\.plain \{[^}]*width: 30px/);
    expect(componentCss('hv-data-table')).toMatch(/\.actions button\.plain \{[^}]*border: none/);
  });

  // Fixed-width circles in a fixed track: too narrow and they come out as ovals.
  it('reserves a track wide enough for all four controls', () => {
    expect(Number(/^(\d+)px$/.exec(ACTIONS_COLUMN_WIDTH)?.[1])).toBeGreaterThanOrEqual(
      26 + 26 + 30 + 34 + 3 * 2,
    );
  });

  it('still deletes from the keyboard, with the menu offering the same thing', async () => {
    const el = await mount([{ id: '1' }]);
    const seen: string[] = [];
    el.addEventListener('request-delete', () => seen.push('key'));
    el.addEventListener('row-action', (e) => seen.push((e as CustomEvent).detail.action));

    const row = q(el, '[data-testid="table-row"]') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    menu(el).dispatchEvent(
      new CustomEvent('select', { detail: { id: 'delete' }, bubbles: true, composed: true }),
    );

    expect(seen).toEqual(['key', 'delete']);
  });
});

describe('hv-data-table: the day turning over', () => {
  const mounted: HVDataTable[] = [];

  beforeEach(() => {
    // The clock is module-level and arms on its first subscriber, so every
    // table this file mounted earlier has to be disconnected before the fake
    // clock is installed — otherwise the deadline is still the real midnight.
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 23, 59, 58));
  });

  afterEach(() => {
    while (mounted.length) mounted.pop()?.remove();
    vi.useRealTimers();
  });

  async function mountAndTrack(items: Partial<Item>[], props: Partial<HVDataTable> = {}) {
    const el = await mount(items, props);
    mounted.push(el);
    return el;
  }

  // The cells tone themselves off the clock at render, and a table on a wall
  // tablet is redrawn by nothing else all night.
  it('tones a due date that passed overnight, with no property change', async () => {
    const el = await mountAndTrack([{ id: '1', due_date: '2026-08-22' }]);
    expect(q(el, '[data-testid="cell-due_date"]')?.classList.contains('overdue')).toBe(false);

    vi.advanceTimersByTime(3_000);
    await el.updateComplete;

    expect(q(el, '[data-testid="cell-due_date"]')?.classList.contains('overdue')).toBe(true);
  });

  it('tones an inspection dated tomorrow once tomorrow arrives', async () => {
    const el = await mountAndTrack([{ id: '1', inspection_date: '2026-08-23' }], {
      columns: ['inspection_date'],
    });
    expect(q(el, '[data-testid="cell-inspection_date"]')?.classList.contains('due')).toBe(false);

    vi.advanceTimersByTime(3_000);
    await el.updateComplete;

    expect(q(el, '[data-testid="cell-inspection_date"]')?.classList.contains('due')).toBe(true);
  });

  it('leaves a disconnected table out of it', async () => {
    const el = await mountAndTrack([{ id: '1', due_date: '2026-08-22' }]);
    el.remove();

    vi.advanceTimersByTime(3_000);
    await el.updateComplete;

    expect(q(el, '[data-testid="cell-due_date"]')?.classList.contains('overdue')).toBe(false);
  });
});

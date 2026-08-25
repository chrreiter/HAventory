import { html, render } from 'lit';
import {
  isLowStock,
  renderNameChips,
  renderRowThumb,
  rowKeyAction,
  rowMenuEntries,
} from './row-chrome';
import { MEDIA_NAME_TOKEN_PARAM, MEDIA_SIZE_PARAM, MediaUrls, PictureFallback, attachmentNameToken } from './media';
import { makeAttachment, makeItem } from '../test.utils';
import type { NameChipOptions } from './row-chrome';
import type { Item, StatusDefinition } from '../store/types';

/** A host that only has to answer `requestUpdate`, which is all these need. */
function host() {
  return { requestUpdate() {} };
}

function draw(template: unknown) {
  const box = document.createElement('div');
  render(html`${template}`, box);
  return box;
}

const testids = (box: HTMLElement) =>
  [...box.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));

/** A keydown as a row receives it: on the row itself, or on a control inside it. */
function press(key: string, from: 'row' | 'control' = 'row'): KeyboardEvent {
  const row = document.createElement('div');
  const inner = document.createElement('button');
  row.append(inner);
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'currentTarget', { value: row });
  Object.defineProperty(e, 'target', { value: from === 'row' ? row : inner });
  return e;
}

describe('isLowStock', () => {
  it('treats a null threshold as never low', () => {
    expect(isLowStock(makeItem({ quantity: 0, low_stock_threshold: null }))).toBe(false);
  });

  it('is low at or below the threshold', () => {
    expect(isLowStock(makeItem({ quantity: 3, low_stock_threshold: 3 }))).toBe(true);
    expect(isLowStock(makeItem({ quantity: 4, low_stock_threshold: 3 }))).toBe(false);
  });
});

describe('rowMenuEntries', () => {
  const ids = (item: Item) =>
    rowMenuEntries(item)
      .filter((e): e is Extract<ReturnType<typeof rowMenuEntries>[number], { id: string }> =>
        'id' in e,
      )
      .map((e) => e.id);

  it('offers the way out of a loan for an item that is out', () => {
    expect(ids(makeItem({ checked_out: true }))).toEqual(['check-in', 'set-due-date', 'delete']);
  });

  it('offers the way into one for an item on the shelf', () => {
    expect(ids(makeItem())).toEqual(['check-out', 'edit', 'delete']);
  });

  // The one entry whose label depends on the item rather than on its state.
  it('names the due-date entry for what pressing it would do', () => {
    const labels = (item: Item) =>
      rowMenuEntries(item)
        .filter((e): e is Extract<ReturnType<typeof rowMenuEntries>[number], { id: string }> =>
          'id' in e,
        )
        .find((e) => e.id === 'set-due-date')?.label;

    expect(labels(makeItem({ checked_out: true }))).toBe('Set due date…');
    expect(labels(makeItem({ checked_out: true, due_date: '2099-01-01' }))).toBe('Change due date…');
  });
});

describe('rowKeyAction', () => {
  it('names the four actions a row answers to', () => {
    expect(rowKeyAction(press('Enter'))).toBe('open-item');
    expect(rowKeyAction(press('Delete'))).toBe('request-delete');
    expect(rowKeyAction(press('+'))).toBe('increment');
    expect(rowKeyAction(press('-'))).toBe('decrement');
  });

  it('takes the numpad and unshifted spellings of the same two keys', () => {
    expect(rowKeyAction(press('='))).toBe('increment');
    expect(rowKeyAction(press('Add'))).toBe('increment');
    expect(rowKeyAction(press('Subtract'))).toBe('decrement');
  });

  it('claims a key it acts on, and leaves every other one to the browser', () => {
    const enter = press('Enter');
    rowKeyAction(enter);
    expect(enter.defaultPrevented).toBe(true);

    const tab = press('Tab');
    expect(rowKeyAction(tab)).toBe(null);
    expect(tab.defaultPrevented).toBe(false);
  });

  // Enter on Edit is that button's, and an open ⋮ menu holds the keyboard.
  it('leaves a key pressed on a control inside the row to that control', () => {
    for (const key of ['Enter', 'Delete', '+', '-']) {
      const e = press(key, 'control');
      expect(rowKeyAction(e), key).toBe(null);
      expect(e.defaultPrevented, key).toBe(false);
    }
  });
});

describe('renderNameChips', () => {
  const rowOptions = (patch: Partial<NameChipOptions> = {}): NameChipOptions => ({
    prefix: 'row',
    overdueText: 'overdueOn',
    ...patch,
  });
  const tableOptions = (patch: Partial<NameChipOptions> = {}): NameChipOptions => ({
    prefix: 'table',
    overdueText: 'overdue',
    ...patch,
  });
  const flagged: StatusDefinition[] = [
    { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
    { slug: 'missing', label: 'Missing', order: 1, color: 'amber', icon: 'alert' },
  ];
  const everything = {
    quantity: 1,
    low_stock_threshold: 5,
    status: 'missing',
    checked_out: true,
  };

  it('says the three things in the order they interrupt in', () => {
    const box = draw(renderNameChips(makeItem(everything), flagged, rowOptions()));
    expect(testids(box)).toEqual(['row-low', 'row-status', 'row-checked-out']);
  });

  // Same chips, same order, the surface's own names — the browser harnesses
  // locate the two sets separately.
  it("carries each surface's own test ids", () => {
    const box = draw(renderNameChips(makeItem(everything), flagged, tableOptions()));
    expect(testids(box)).toEqual(['table-low', 'table-status', 'table-checked-out']);
  });

  it('says nothing at all about an item with nothing to report', () => {
    expect(testids(draw(renderNameChips(makeItem(), flagged, rowOptions())))).toEqual([]);
  });

  it('drops a chip the surface has no room for', () => {
    const box = draw(
      renderNameChips(makeItem(everything), flagged, tableOptions({ lowChip: false, statusChip: false })),
    );
    expect(testids(box)).toEqual(['table-checked-out']);
  });

  // The card's row has nowhere else to put the date; the table's Due column
  // already carries it.
  it('spells an overdue loan the way its surface asks for', () => {
    const overdue = makeItem({ checked_out: true, due_date: '2020-01-01' });

    const withDate = draw(renderNameChips(overdue, flagged, rowOptions()));
    expect(withDate.querySelector('[data-testid="row-checked-out"]')?.textContent?.trim()).toBe(
      'Overdue · Jan 1, 2020',
    );

    const bare = draw(renderNameChips(overdue, flagged, tableOptions()));
    expect(bare.querySelector('[data-testid="table-checked-out"]')?.textContent?.trim()).toBe(
      'Overdue',
    );
  });

  it('leaves a loan that still has time to run in the calm tone', () => {
    const box = draw(
      renderNameChips(makeItem({ checked_out: true, due_date: '2099-01-01' }), flagged, rowOptions()),
    );
    const chip = box.querySelector('[data-testid="row-checked-out"]');
    expect(chip?.classList.contains('state')).toBe(true);
    expect(chip?.classList.contains('error')).toBe(false);
    expect(chip?.textContent?.trim()).toBe('Checked out');
  });
});

describe('renderRowThumb', () => {
  const picture = makeAttachment({ id: 'att-1' });
  const item = makeItem({ id: 'i-1', name: 'Cordless drill', attachments: [picture] });

  /**
   * The tile once the signing and the presence probe have both landed.
   *
   * Each render asks one more question — sign the tile's URL, sign the one the
   * probe reads, then run the probe — and a component gets those turns from its
   * host's `requestUpdate`. Here they are taken by hand.
   */
  async function settled(urls: MediaUrls, thumbs: PictureFallback) {
    let box = draw(null);
    for (let turn = 0; turn < 4; turn += 1) {
      box = draw(renderRowThumb(item, urls, thumbs));
      await new Promise((done) => setTimeout(done, 0));
    }
    return box;
  }

  /** Signs immediately, so one turn is enough for the URL to be there. */
  function signed(fetch?: () => Promise<{ ok: boolean; status: number }>) {
    const h = host();
    const urls = new MediaUrls(h, fetch ? { fetch } : {});
    urls.configure(async (path: string) => `${path}&authSig=test`);
    return { urls, thumbs: new PictureFallback(h, urls) };
  }

  it('renders nothing for an item with no picture', () => {
    const { urls, thumbs } = signed();
    expect(renderRowThumb(makeItem(), urls, thumbs)).toBe(null);
  });

  it('renders nothing while there is no signed URL to show', () => {
    const urls = new MediaUrls(host());
    expect(renderRowThumb(item, urls, new PictureFallback(host(), urls))).toBe(null);
  });

  // `size=thumb`: a 34px tile served the stored file is up to 8 MB of download
  // per row. The parameter is signed with the path, so it has to be on the URL
  // before signing rather than appended to a signed one.
  it('asks for the thumb variant of the first picture', async () => {
    const { urls, thumbs } = signed();
    renderRowThumb(item, urls, thumbs);
    await Promise.resolve();

    const img = draw(renderRowThumb(item, urls, thumbs)).querySelector('img');
    expect(img?.getAttribute('data-testid')).toBe('row-thumb');
    expect(img?.getAttribute('src')).toBe(
      `/api/haventory/media/i-1/att-1?${MEDIA_NAME_TOKEN_PARAM}=${attachmentNameToken(picture)}`
        + `&${MEDIA_SIZE_PARAM}=thumb&authSig=test`,
    );
    expect(img?.getAttribute('alt')).toBe('Photo of Cordless drill');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('keeps the box for a picture whose file the backend no longer has', async () => {
    const { urls, thumbs } = signed(async () => ({ ok: false, status: 404 }));
    thumbs.noteError('i-1', 'att-1');

    const mark = (await settled(urls, thumbs)).querySelector(
      '[data-testid="row-thumb-missing"]',
    );
    expect(mark?.classList.contains('missing')).toBe(true);
    expect(mark?.getAttribute('aria-label')).toBe('File missing');
  });

  // An inconclusive probe is not proof the picture is gone, so the tile stays
  // an image and only hides the browser's broken-image glyph.
  it('hides a tile the probe cannot explain rather than marking it missing', async () => {
    const { urls, thumbs } = signed(async () => ({ ok: false, status: 500 }));
    thumbs.noteError('i-1', 'att-1');

    const box = await settled(urls, thumbs);
    expect(box.querySelector('[data-testid="row-thumb-missing"]')).toBe(null);
    expect(box.querySelector('img')?.classList.contains('broken')).toBe(true);
  });
});

import { html, render } from 'lit';
import {
  SEARCH_DEBOUNCE_MS,
  priceStaged,
  renderFilterHead,
  renderSearch,
  renderStagedFooter,
  searchDebounce,
} from './filter-chrome';
import { defaultFilters } from '../store/store';
import type { Store } from '../store/store';
import type { StoreFilters } from '../store/types';

/** Just enough store for the two debounced writers to act on. */
function fakeStore(count: number | null = 7) {
  const patches: Partial<StoreFilters>[] = [];
  const priced: StoreFilters[] = [];
  const store = {
    setFilters: (patch: Partial<StoreFilters>) => patches.push(patch),
    countMatching: (filters: StoreFilters) => {
      priced.push(filters);
      return Promise.resolve(count);
    },
  };
  return { patches, priced, store: store as unknown as Store };
}

function draw(template: unknown) {
  const host = document.createElement('div');
  render(html`${template}`, host);
  return host;
}

describe('searchDebounce', () => {
  it('waits for the typing to stop before it touches the store', async () => {
    const { patches, store } = fakeStore();
    const emit = searchDebounce(() => store);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      emit('gl');
      emit('glu');
      emit('glue');
      // Still nothing on the last millisecond of the window...
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
      expect(patches).toEqual([]);

      // ...and one write, of the last thing typed, on the next one.
      await vi.advanceTimersByTimeAsync(1);
      expect(patches).toEqual([{ q: 'glue' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A host builds its debouncer in a field initializer, which runs before Home
  // Assistant has handed it anything — a store captured there would be
  // undefined for the life of the element.
  it('reads the store per call rather than capturing it', async () => {
    let attached: Store | undefined;
    const emit = searchDebounce(() => attached);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { patches, store } = fakeStore();
      emit('glue');
      attached = store;
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
      expect(patches).toEqual([{ q: 'glue' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('priceStaged', () => {
  it('counts the staged set once the edits have stopped landing', async () => {
    const { priced, store } = fakeStore(2);
    const counts: (number | null)[] = [];
    const price = priceStaged(() => store, (count) => counts.push(count));
    const staged = { ...defaultFilters(), lowStockOnly: true };

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      price({ ...defaultFilters() });
      price(staged);
      expect(priced).toEqual([]);

      await vi.advanceTimersByTimeAsync(150);
      expect(priced).toEqual([staged]);
      expect(counts).toEqual([2]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A store that cannot answer leaves the button on its uncounted wording
  // rather than claiming a number.
  it('passes on a count the store could not give', async () => {
    const { store } = fakeStore(null);
    const counts: (number | null)[] = [];
    const price = priceStaged(() => store, (count) => counts.push(count));

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      price(defaultFilters());
      await vi.advanceTimersByTimeAsync(150);
      expect(counts).toEqual([null]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('renderSearch', () => {
  const box = (total: number | null, onInput: (q: string) => void = () => undefined) =>
    draw(renderSearch({ testid: 'search-input', draft: 'glue', total, onInput }));

  it('offers the whole inventory in the placeholder, and says so once counted', () => {
    expect((box(null).querySelector('input') as HTMLInputElement).placeholder).toBe('Search items…');
    expect((box(3).querySelector('input') as HTMLInputElement).placeholder).toBe('Search all 3 items…');
    expect((box(1).querySelector('input') as HTMLInputElement).placeholder).toBe('Search all 1 item…');
  });

  it('shows the draft it is handed and reports every keystroke back', () => {
    const typed: string[] = [];
    const host = box(3, (q) => typed.push(q));
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('glue');
    expect(input.dataset.testid).toBe('search-input');

    input.value = 'wood';
    input.dispatchEvent(new Event('input'));
    expect(typed).toEqual(['wood']);
  });

  // The glyph carries no name, so the field has one that is not drawn.
  it('names the field for a reader who cannot see the magnifier', () => {
    expect(box(null).querySelector('.hv-sr-only')?.textContent).toBe('Search items');
  });
});

describe('renderFilterHead', () => {
  it('counts the staged set and names each surface the way that surface asked', () => {
    const cleared: string[] = [];
    const sheet = draw(
      renderFilterHead({
        rowClass: 'sheet-head',
        testids: { clear: 'sheet-clear-all' },
        staged: 1,
        onClear: () => cleared.push('sheet'),
      }),
    );
    const panel = draw(
      renderFilterHead({
        rowClass: 'panel-head',
        testids: { row: 'full-panel-head', count: 'full-panel-count', clear: 'full-panel-clear' },
        staged: 0,
        onClear: () => cleared.push('panel'),
      }),
    );

    expect([...(sheet.firstElementChild as HTMLElement).classList]).toEqual([
      'hv-sheet-head',
      'sheet-head',
    ]);
    expect(sheet.querySelector('[data-testid="full-panel-head"]')).toBe(null);
    expect(sheet.textContent).toContain('1 active');
    expect(panel.querySelector('[data-testid="full-panel-count"]')?.textContent).toBe('0 active');

    (sheet.querySelector('[data-testid="sheet-clear-all"]') as HTMLButtonElement).click();
    (panel.querySelector('[data-testid="full-panel-clear"]') as HTMLButtonElement).click();
    expect(cleared).toEqual(['sheet', 'panel']);
  });
});

describe('renderStagedFooter', () => {
  function foot(stagedCount: number | null, panel: { apply: () => void } | null) {
    const cancelled: string[] = [];
    const host = draw(
      renderStagedFooter({
        prefix: 'sheet',
        rowClass: 'sheet-footer',
        slot: 'footer',
        cancelClass: 'cancel',
        applyClass: 'hv-pill large apply',
        stagedCount,
        panel: () => panel as never,
        onCancel: () => cancelled.push('cancel'),
      }),
    );
    return { host, cancelled };
  }

  it('says what committing would show, and nothing it cannot count', () => {
    expect(
      (foot(null, null).host.querySelector('[data-testid="sheet-apply"]') as HTMLElement).textContent?.trim(),
    ).toBe('Show items');
    expect(
      (foot(2, null).host.querySelector('[data-testid="sheet-apply"]') as HTMLElement).textContent?.trim(),
    ).toBe('Show 2 items');
  });

  // The panel does not exist on the render that first draws this row, so a
  // reference captured here would leave the button doing nothing.
  it('resolves the panel it commits per click', () => {
    const applied: string[] = [];
    const { host, cancelled } = foot(2, { apply: () => applied.push('apply') });
    (host.querySelector('[data-testid="sheet-apply"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="sheet-cancel"]') as HTMLButtonElement).click();
    expect(applied).toEqual(['apply']);
    expect(cancelled).toEqual(['cancel']);
  });

  it('takes the slot and the classes its surface hands it', () => {
    const row = foot(2, null).host.firstElementChild as HTMLElement;
    expect(row.getAttribute('slot')).toBe('footer');
    expect([...row.classList]).toEqual(['sheet-footer']);
    expect(row.hasAttribute('data-testid')).toBe(false);
  });
});

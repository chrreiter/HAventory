import { html, render } from 'lit';
import { renderStatBadges } from './stat-badges';
import { defaultFilters } from '../store/store';
import type { StatBadgeOptions, StatBadgeState } from './stat-badges';
import type { StatsCounts, StoreFilters } from '../store/types';

const NO_COUNTS: StatsCounts = {
  items_total: 0,
  locations_total: 0,
  no_location_count: 0,
  low_stock_count: 0,
  checked_out_count: 0,
  overdue_count: 0,
  inspection_due_count: 0,
  reminder_due_count: 0,
};

/** What an older backend sends: the required counts and none of the derived ones. */
const OLDER_BACKEND: StatsCounts = {
  items_total: 3,
  locations_total: 0,
  no_location_count: 0,
  low_stock_count: 0,
  checked_out_count: 0,
};

function state(counts: Partial<StatsCounts>, filters: Partial<StoreFilters> = {}): StatBadgeState {
  return {
    statsCounts: { ...NO_COUNTS, ...counts },
    filters: { ...defaultFilters(), ...filters },
  };
}

/** The card's header dressing, which is one of the two the parameters carry. */
function cardOptions(patch: Partial<StatBadgeOptions> = {}): StatBadgeOptions {
  return {
    prefix: 'badge',
    chipClass: (tone) => `badge toggle ${tone}`,
    total: 'badge quiet',
    setFilters: () => undefined,
    ...patch,
  };
}

/** The bar's dressing: no blue on a blue bar, and its own test-id prefix. */
function barOptions(patch: Partial<StatBadgeOptions> = {}): StatBadgeOptions {
  return {
    prefix: 'full-badge',
    chipClass: (tone) => (tone === 'state' ? 'pill' : `pill ${tone}`),
    setFilters: () => undefined,
    ...patch,
  };
}

function draw(
  st: StatBadgeState | null,
  quickFilters: Parameters<typeof renderStatBadges>[1],
  opts: StatBadgeOptions,
) {
  const badges = renderStatBadges(st, quickFilters, opts);
  const host = document.createElement('div');
  render(html`${badges?.total}${badges?.pills}`, host);
  return { badges, host };
}

const testids = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));

describe('renderStatBadges', () => {
  const stocked = () => state({ items_total: 2, low_stock_count: 1, checked_out_count: 1 });

  it('says nothing at all until the store has counted something', () => {
    expect(renderStatBadges(null, null, cardOptions())).toBe(null);
    expect(renderStatBadges({ statsCounts: null, filters: defaultFilters() }, null, cardOptions())).toBe(
      null,
    );
  });

  // The pills are filter toggles, not decoration; a dashboard that never checks
  // anything out has no use for the checked-out one. The config decides what is
  // on offer, the count still decides whether there is anything to say.
  it('draws every pill by default', () => {
    const { host } = draw(stocked(), null, cardOptions());
    expect(testids(host)).toEqual(['badge-total', 'badge-low', 'badge-out']);
  });

  it('draws only the pills the config names', () => {
    const { host } = draw(stocked(), ['low_stock'], cardOptions());
    expect(testids(host)).toEqual(['badge-low']);
  });

  // Allowed is not the same as shown: the count gate is unchanged.
  it('still hides an allowed pill whose count is zero', () => {
    // The total is not in this config either, so the row comes out empty — which
    // is what `any` is for: a surface that gives the badges a row of their own
    // has to know there is nothing to put in it.
    const { host, badges } = draw(state({ items_total: 1 }), ['low_stock', 'checked_out'], cardOptions());
    expect(testids(host)).toEqual([]);
    expect(badges?.any).toBe(false);
  });

  // The calendar-derived counts are optional, because an older backend does not
  // send them; absent has to read as none rather than as a pill saying NaN.
  it('reads a count an older backend never sent as nothing to report', () => {
    const { host } = draw({ statsCounts: OLDER_BACKEND, filters: defaultFilters() }, null, cardOptions());
    expect(testids(host)).toEqual(['badge-total']);
  });

  it('turns its own filter on when pressed', () => {
    const patches: Partial<StoreFilters>[] = [];
    const { host } = draw(stocked(), null, cardOptions({ setFilters: (patch) => patches.push(patch) }));
    (host.querySelector('[data-testid="badge-low"]') as HTMLButtonElement).click();
    expect(patches).toEqual([{ lowStockOnly: true }]);
  });

  it('takes its own filter back off when pressed again', () => {
    const patches: Partial<StoreFilters>[] = [];
    const { host } = draw(
      state({ items_total: 2, low_stock_count: 1 }, { lowStockOnly: true }),
      null,
      cardOptions({ setFilters: (patch) => patches.push(patch) }),
    );
    (host.querySelector('[data-testid="badge-low"]') as HTMLButtonElement).click();
    expect(patches).toEqual([{ lowStockOnly: false }]);
  });

  it('says an applied filter back through aria-pressed and the applied ring', () => {
    const { host } = draw(
      state({ items_total: 2, low_stock_count: 1 }, { lowStockOnly: true }),
      null,
      cardOptions(),
    );
    const low = host.querySelector('[data-testid="badge-low"]') as HTMLButtonElement;
    expect(low.getAttribute('aria-pressed')).toBe('true');
    expect(low.classList.contains('on')).toBe(true);
  });

  // Per-surface test ids and chip classes are what the browser harnesses and
  // each shadow root's own CSS locate, so one renderer keeps them apart on
  // purpose rather than by accident.
  it('names and dresses each surface the way that surface asked', () => {
    const { host: card } = draw(stocked(), null, cardOptions());
    const { host: bar } = draw(stocked(), null, barOptions());

    expect(testids(card)).toEqual(['badge-total', 'badge-low', 'badge-out']);
    expect(testids(bar)).toEqual(['full-badge-low', 'full-badge-out']);

    const cardLow = card.querySelector('[data-testid="badge-low"]') as HTMLElement;
    const barLow = bar.querySelector('[data-testid="full-badge-low"]') as HTMLElement;
    expect([...cardLow.classList]).toEqual(['hv-chip', 'badge', 'toggle', 'warning']);
    expect([...barLow.classList]).toEqual(['hv-chip', 'pill', 'warning']);

    // The card's checked-out badge is its one blue one; the bar paints its own
    // fills and has no blue to spare on a blue bar.
    expect([...(card.querySelector('[data-testid="badge-out"]') as HTMLElement).classList]).toContain(
      'state',
    );
    expect([
      ...(bar.querySelector('[data-testid="full-badge-out"]') as HTMLElement).classList,
    ]).toEqual(['hv-chip', 'pill']);
  });

  // The total reports rather than filters, so it is the one chip a surface can
  // decline — the card's phone row does, and the bar never had one.
  it('draws the total only for a surface that asked for one, and only when allowed', () => {
    expect(testids(draw(stocked(), null, cardOptions({ total: undefined })).host)).toEqual([
      'badge-low',
      'badge-out',
    ]);
    expect(testids(draw(stocked(), ['low_stock'], cardOptions()).host)).toEqual(['badge-low']);
    expect(testids(draw(stocked(), null, barOptions()).host)).toEqual([
      'full-badge-low',
      'full-badge-out',
    ]);
  });
});

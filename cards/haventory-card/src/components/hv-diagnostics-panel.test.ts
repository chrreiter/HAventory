import './hv-diagnostics-panel';
import type { HVDiagnosticsPanel } from './hv-diagnostics-panel';
import type { DegradedState, HealthResult, StatsCounts } from '../store/types';
import { mountComponent, q, settle } from '../test.utils';
// The clipboard itself is `ui/clipboard`'s own test; what this panel owes is
// asking the helper and believing its answer, which needs both answers.
vi.mock('../ui/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/clipboard')>()),
  copyText: vi.fn(async () => true),
}));
import { copyText } from '../ui/clipboard';

const counts: StatsCounts = {
  items_total: 250,
  low_stock_count: 6,
  checked_out_count: 3,
  locations_total: 13,
  no_location_count: 3,
};

function health(patch: Partial<HealthResult> = {}): HealthResult {
  return {
    healthy: true,
    issues: [],
    counts,
    ...patch,
  };
}

const NO_DEGRADATION: DegradedState = {
  connectionLost: false,
  reloading: false,
  liveUpdates: 'live',
  liveUpdatesReason: null,
  nextLiveRetryAt: null,
};

async function mount(props: Partial<HVDiagnosticsPanel> = {}) {
  const { el } = await mountComponent<HVDiagnosticsPanel>('hv-diagnostics-panel', {
    open: true,
    health: health(),
    counts,
    version: { integration_version: '0.0.1', schema_version: 4 },
    degraded: { ...NO_DEGRADATION },
    connected: { items: true, stats: true },
    loadedItems: 50,
    ...props,
  });
  return el;
}

describe('hv-diagnostics-panel: healthy', () => {
  it('collapses to one green line when there is nothing to report', async () => {
    const el = await mount();
    const status = q(el, '[data-testid="diagnostics-status"]') as HTMLElement;
    expect(status.classList.contains('ok')).toBe(true);
    expect(status.textContent).toContain('No issues');
    expect(status.textContent).toContain('live');
  });

  it('shows where the data came from', async () => {
    const el = await mount();
    expect(q(el, '[data-testid="diagnostics-loaded"]')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '50 of 250 items · 13 locations',
    );
    expect(q(el, '[data-testid="diagnostics-version"]')?.textContent?.trim()).toBe('0.0.1');
  });
});

describe('hv-diagnostics-panel: not live', () => {
  it('says the list only changes on refresh when subscriptions are down', async () => {
    const el = await mount({
      connected: { items: false, stats: false },
      degraded: { ...NO_DEGRADATION, connectionLost: true },
    });

    expect(q(el, '[data-testid="diagnostics-status"]')?.textContent).toContain('Not live');
    expect(q(el, '[data-testid="diagnostics-subscriptions"]')?.textContent).toContain('not connected');
  });
});

describe('hv-diagnostics-panel: actions', () => {
  it('offers the refresh the contract prescribes as recovery', async () => {
    const el = await mount();
    let refreshes = 0;
    el.addEventListener('refresh', () => {
      refreshes += 1;
    });
    (q(el, '[data-testid="health-refresh"]') as HTMLButtonElement).click();
    expect(refreshes).toBe(1);
  });

  it('disables refresh while one is in flight', async () => {
    const el = await mount({ busy: true });
    expect((q(el, '[data-testid="health-refresh"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('builds a copyable report covering everything on screen', async () => {
    const el = await mount();
    expect(el.report).toContain('integration 0.0.1');
    expect(el.report).toContain('"items_total":250');
    expect(el.report).toContain('subscriptions: items=true');
  });

  it('copies the report and says so once the copy has happened', async () => {
    const el = await mount();
    const button = q(el, '[data-testid="diagnostics-copy"]') as HTMLButtonElement;

    button.click();
    await settle(el);

    expect(copyText).toHaveBeenCalledWith(el.report);
    expect(button.textContent?.trim()).toBe('Copied');
  });

  // A report the household is told it has, and has not, is worse than a button
  // that stayed put: Home Assistant over plain http:// is not a secure context,
  // and an old browser there has no fallback either.
  it('says nothing about a copy the browser refused', async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    const el = await mount();
    const button = q(el, '[data-testid="diagnostics-copy"]') as HTMLButtonElement;

    button.click();
    await settle(el);

    expect(button.textContent?.trim()).toBe('Copy report');
  });

  // This panel writes nothing, so its way out must not wear the shape that
  // means "commit" on every other surface of the card.
  it('draws its close as an outline, not as the filled primary', async () => {
    const el = await mount();
    const close = q(el, '[data-testid="diagnostics-close"]') as HTMLElement;
    expect(close.textContent?.trim()).toBe('Close');
    expect(close.className.split(/\s+/)).toEqual(['hv-pill', 'outline']);
  });

  it('closes from the button, the backdrop and Escape', async () => {
    for (const trigger of ['button', 'backdrop', 'escape'] as const) {
      const el = await mount();
      let cancels = 0;
      el.addEventListener('cancel', () => {
        cancels += 1;
      });

      if (trigger === 'button') (q(el, '[data-testid="diagnostics-close"]') as HTMLButtonElement).click();
      else if (trigger === 'backdrop') (q(el, '.backdrop') as HTMLElement).click();
      else
        (q(el, '[data-testid="diagnostics-panel"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

      expect(cancels, trigger).toBe(1);
      el.remove();
    }
  });
});

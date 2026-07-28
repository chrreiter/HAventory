import './hv-diagnostics-panel';
import type { HVDiagnosticsPanel } from './hv-diagnostics-panel';
import type { DegradedState, HealthResult, StatsCounts } from '../store/types';

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
    generation: 42,
    rate_limit: { enabled: false, dropped_commands: 0, dropped_events: 0 },
    ...patch,
  };
}

const NO_DEGRADATION: DegradedState = {
  rateLimited: false,
  connectionLost: false,
  retrying: 0,
  nextRetryAt: null,
  reloading: false,
  liveUpdates: 'live',
  nextLiveRetryAt: null,
};

async function mount(props: Partial<HVDiagnosticsPanel> = {}) {
  const el = document.createElement('hv-diagnostics-panel') as HVDiagnosticsPanel;
  el.open = true;
  el.health = health();
  el.counts = counts;
  el.version = { integration_version: '0.0.1', schema_version: 4 };
  el.degraded = { ...NO_DEGRADATION };
  el.connected = { items: true, stats: true };
  el.loadedItems = 50;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVDiagnosticsPanel, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVDiagnosticsPanel, sel: string) =>
  [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

describe('hv-diagnostics-panel: healthy', () => {
  it('collapses to one green line when there is nothing to report', async () => {
    const el = await mount();
    const status = q(el, '[data-testid="diagnostics-status"]') as HTMLElement;
    expect(status.classList.contains('ok')).toBe(true);
    expect(status.textContent).toContain('No issues');
    expect(status.textContent).toContain('live');
    expect(q(el, '[data-testid="diagnostics-issue"]')).toBe(null);
  });

  it('shows the counters at zero and where the data came from', async () => {
    const el = await mount();
    expect(q(el, '[data-testid="diagnostics-dropped-commands"]')?.textContent?.trim()).toBe('0');
    expect(q(el, '[data-testid="diagnostics-dropped-events"]')?.textContent?.trim()).toBe('0');
    expect(q(el, '[data-testid="diagnostics-loaded"]')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '50 of 250 items · 13 locations',
    );
    expect(q(el, '[data-testid="diagnostics-version"]')?.textContent?.trim()).toBe('0.0.1');
  });
});

describe('hv-diagnostics-panel: rate limiting', () => {
  it('names it, and shows how much has been dropped', async () => {
    const el = await mount({
      health: health({ rate_limit: { enabled: true, dropped_commands: 7, dropped_events: 23 } }),
      degraded: { ...NO_DEGRADATION, rateLimited: true },
    });

    const status = q(el, '[data-testid="diagnostics-status"]') as HTMLElement;
    expect(status.classList.contains('bad')).toBe(true);
    expect(status.textContent).toContain('Degraded');
    expect(status.textContent).toContain('rate limiting is active');
    expect(q(el, '[data-testid="diagnostics-dropped-commands"]')?.textContent?.trim()).toBe('7');
    expect(q(el, '[data-testid="diagnostics-dropped-events"]')?.textContent?.trim()).toBe('23');
  });
});

describe('hv-diagnostics-panel: integrity issues', () => {
  it('turns repeated bare codes into one counted sentence each', async () => {
    const el = await mount({
      health: health({
        healthy: false,
        issues: [
          'item_references_missing_location',
          'item_references_missing_location',
          'item_references_missing_location',
          'low_stock_count_mismatch',
        ],
      }),
    });

    const issues = all(el, '[data-testid="diagnostics-issue"]');
    expect(issues).toHaveLength(2);
    expect(issues[0].dataset.code).toBe('item_references_missing_location');
    expect(issues[0].textContent).toContain('3 item(s) reference a location that no longer exists');
    expect(q(el, '[data-testid="diagnostics-status"]')?.textContent).toContain('Issues found');
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

describe('hv-diagnostics-panel: fits the screen', () => {
  /** jsdom lays out no shadow DOM, so sizing rules are asserted on the sheet. */
  const css = () => {
    const styles = (customElements.get('hv-diagnostics-panel') as typeof HVDiagnosticsPanel).styles;
    return (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
  };

  // The centring grid's implicit track was auto-sized, so it took the panel's
  // own 470px however narrow the screen was, and the panel's max-width: 100%
  // resolved against that track rather than the viewport. At 390px the panel
  // measured 470 wide: the third tile and the Close button hung off the edge.
  it('sizes its track to the viewport, not to the panel inside it', () => {
    expect(css()).toMatch(/\.wrap \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css()).toMatch(/\.wrap \{[^}]*grid-template-rows: minmax\(0, 1fr\)/);
    // Which is what the panel's own clamps are relying on.
    expect(css()).toMatch(/\.panel \{[^}]*max-width: 100%/);
    expect(css()).toMatch(/\.panel \{[^}]*max-height: 100%/);
  });

  it('lets the three counter tiles wrap once there is no room for three', () => {
    expect(css()).toMatch(/\.tiles \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(96px, 1fr\)\)/);
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
    const el = await mount({
      health: health({ healthy: false, issues: ['low_stock_count_mismatch'] }),
    });
    expect(el.report).toContain('integration 0.0.1');
    expect(el.report).toContain('healthy: false');
    expect(el.report).toContain('low_stock_count_mismatch');
    expect(el.report).toContain('subscriptions: items=true');
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

import './hv-banner';
import type { HVBanner } from './hv-banner';
import { mountComponent } from '../test.utils';

async function mount(props: Partial<HVBanner> = {}, light = '') {
  const { el } = await mountComponent<HVBanner>('hv-banner', props, { light });
  return el;
}

describe('hv-banner', () => {
  it('renders the message with an alert role', async () => {
    const el = await mount({ kind: 'error', message: "Couldn't save — the integration failed to write." });
    const banner = el.shadowRoot?.querySelector('[data-testid="banner"]') as HTMLElement;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.dataset.kind).toBe('error');
    expect(el.shadowRoot?.querySelector('[data-testid="banner-message"]')?.textContent).toContain(
      "Couldn't save",
    );
  });

  it('renders a bold lead-in when given a heading', async () => {
    const el = await mount({ heading: 'Busy — retrying', message: ' · 2 changes queued' });
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('Busy — retrying');
    expect(text).toContain('2 changes queued');
    expect(el.shadowRoot?.querySelector('.heading')).toBeTruthy();
  });

  it('omits the lead-in when there is no heading', async () => {
    const el = await mount({ message: 'plain' });
    expect(el.shadowRoot?.querySelector('.heading')).toBe(null);
  });

  it('picks a glyph per kind and allows an override', async () => {
    const warn = await mount({ kind: 'warning' });
    expect(warn.shadowRoot?.querySelector('svg')?.dataset.icon).toBe('alert');

    const conn = await mount({ kind: 'error', glyph: 'wifiOff' });
    expect(conn.shadowRoot?.querySelector('svg')?.dataset.icon).toBe('wifiOff');
  });

  it('falls back to the warning treatment for an unknown kind', async () => {
    const el = await mount({ kind: 'bogus' as never, message: 'x' });
    expect((el.shadowRoot?.querySelector('[data-testid="banner"]') as HTMLElement).dataset.kind).toBe(
      'warning',
    );
  });

  it('exposes slots for trailing and stacked actions', async () => {
    const el = await mount(
      { message: 'Someone changed this while you were editing.' },
      '<button slot="actions">Retry now</button><button slot="below">View latest</button>',
    );
    const sr = el.shadowRoot as ShadowRoot;
    const actions = sr.querySelector('slot[name="actions"]') as HTMLSlotElement;
    const below = sr.querySelector('slot[name="below"]') as HTMLSlotElement;
    expect(actions.assignedElements()).toHaveLength(1);
    expect(below.assignedElements()).toHaveLength(1);
  });
});

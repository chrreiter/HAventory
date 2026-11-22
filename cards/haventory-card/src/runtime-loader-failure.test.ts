import { vi } from 'vitest';

// A chunk the server no longer has: what an upgrade leaves an open tab holding.
// The last block here lets the import through, as a dropped download's retry would.
const runtimeImport = vi.hoisted(() => ({ fails: true }));

vi.mock('./runtime', async (importOriginal) => {
  if (runtimeImport.fails) throw new Error('Failed to fetch dynamically imported module');
  return importOriginal();
});

import './index';
import { de } from './i18n/de';
import { en } from './i18n/en';
import { loadRuntime, loadedRuntime } from './runtime-loader';
import { StoreHostElement } from './store-host';
import { makeMockHass, mountComponent, q, settle } from './test.utils';

type Host = HTMLElement & { hass?: unknown; updateComplete: Promise<unknown> };
type Card = Host & { setConfig(cfg: unknown): void };

const FAILED = '[data-testid="placeholder-load-failed"]';
const RELOAD = '[data-testid="placeholder-reload"]';

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function mountCard(language?: string): Promise<Card> {
  const { el } = await mountComponent<Card>('haventory-card');
  el.setConfig({ title: 'Garage shelf' });
  el.hass = Object.assign(makeMockHass(), { language });
  await el.updateComplete;
  return el;
}

async function mountPanel(language?: string): Promise<Host> {
  const { el } = await mountComponent<Host>('haventory-panel', {
    hass: Object.assign(makeMockHass(), { language }),
  });
  return el;
}

/** The failure notice, once the import the host started has been refused. */
async function failureOf(el: Host): Promise<{ line: HTMLElement; reload: HTMLButtonElement }> {
  await vi.waitFor(() => expect(q(el, FAILED)).toBeTruthy());
  return { line: q(el, FAILED) as HTMLElement, reload: q<HTMLButtonElement>(el, RELOAD) as HTMLButtonElement };
}

describe('a runtime that will not load', () => {
  it('reports it, and lets the next element try again', async () => {
    await expect(loadRuntime()).rejects.toThrow();
    await expect(loadRuntime()).rejects.toThrow();

    expect(loadedRuntime()).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(2);
  });

  // A tab left open across an upgrade asks for the old runtime hash and gets a
  // 404; without a word here the frame stays empty and busy for good.
  it('turns the card from busy to saying so, with a reload, in the user language', async () => {
    const card = await mountCard('de');
    const { line, reload } = await failureOf(card);

    expect(line.textContent?.trim()).toBe(de['hv.loader.failed']);
    expect(reload.textContent?.trim()).toBe(de['hv.loader.reload']);
    expect(reload.type).toBe('button');
    expect(q(card, '[role="alert"]')?.contains(line)).toBe(true);
    expect(q(card, '.placeholder-body')?.getAttribute('aria-busy')).toBe('false');
    // The head stays: the dashboard's title says which card this is.
    expect(q(card, '[data-testid="card-placeholder-title"]')?.textContent).toBe('Garage shelf');
  });

  it('says the same on the panel, under its bar', async () => {
    const panel = await mountPanel();
    const { line, reload } = await failureOf(panel);

    expect(line.textContent?.trim()).toBe(en['hv.loader.failed']);
    expect(reload.textContent?.trim()).toBe(en['hv.loader.reload']);
    expect(q(panel, '[data-testid="panel-placeholder"] .placeholder-body')?.contains(reload)).toBe(true);
  });

  it('reloads the page from its button', async () => {
    const reloaded = vi
      .spyOn(StoreHostElement.prototype as unknown as { reloadPage(): void }, 'reloadPage')
      .mockImplementation(() => undefined);
    const card = await mountCard();
    const { reload } = await failureOf(card);

    reload.click();
    expect(reloaded).toHaveBeenCalledTimes(1);
  });

  // Home Assistant detaches a dashboard's cards and the panel on navigation and
  // re-attaches them on the way back; that is the retry a dropped download gets.
  it('asks again on the next connect, and renders in full once the runtime is in', async () => {
    const panel = await mountPanel();
    await failureOf(panel);

    runtimeImport.fails = false;
    panel.remove();
    document.body.appendChild(panel);
    await panel.updateComplete;
    expect(q(panel, FAILED)).toBeNull();

    await vi.waitFor(() => expect(loadedRuntime()).toBeTruthy(), { timeout: 20_000 });
    await settle(panel);
    expect(q(panel, '[data-testid="panel-full-view"]')).toBeTruthy();
    expect(q(panel, '[data-testid="panel-placeholder"]')).toBeNull();
  }, 30_000);
});

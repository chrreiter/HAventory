import { vi } from 'vitest';

/**
 * The runtime arrives only when the last block here lets it, so every case
 * before that meets a host that is still waiting for it: a dashboard opened on
 * a slow link, where the card's own share of the blank was three seconds.
 */
const runtimeGate = vi.hoisted(() => {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open: () => open(), opened };
});

vi.mock('./runtime', async (importOriginal) => {
  await runtimeGate.opened;
  return importOriginal();
});

import { PLACEHOLDER_HEAD_PX, PLACEHOLDER_MOBILE_MAX_PX } from './index';
import { HAventoryPanel, MENU_ICON_PATH } from './haventory-panel';
import { loadRuntime } from './runtime-loader';
// Defined for its stylesheet only; the hosts still wait on the runtime above.
import './components/hv-card-shell';
import { ICONS } from './ui/icons';
import { MOBILE_BREAKPOINT } from './ui/responsive';
import { hostTokens } from './ui/host-tokens';
import { tokens } from './ui/tokens';
import { componentCss, makeMockHass, mountComponent, q, settle, sheetsOf } from './test.utils';

type Host = HTMLElement & { hass?: unknown; updateComplete: Promise<unknown> };
type Card = Host & { setConfig(cfg: unknown): void };
type Panel = Host & { narrow: boolean; panel?: unknown };

const SIDEBAR_TOGGLE = 'Sidebar toggle';

/** A `hass` whose catalog knows the one key the panel's placeholder asks for. */
function hassWithCatalog(
  localize = (key: string) => (key === 'ui.sidebar.sidebar_toggle' ? SIDEBAR_TOGGLE : ''),
) {
  return Object.assign(makeMockHass(), { localize });
}

async function mountCard(config: unknown): Promise<Card> {
  const { el } = await mountComponent<Card>('haventory-card');
  el.setConfig(config);
  el.hass = makeMockHass();
  await el.updateComplete;
  return el;
}

async function mountPanel(props: Partial<Panel>): Promise<Panel> {
  const { el } = await mountComponent<Panel>('haventory-panel', props);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('haventory-card while its runtime is loading', () => {
  it('draws its frame with the dashboard title and no word of its own', async () => {
    const el = await mountCard({ title: 'Garage shelf' });

    const placeholder = q(el, '[data-testid="card-placeholder"]');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.textContent?.trim()).toBe('Garage shelf');
    expect(q(el, '.placeholder-body')?.getAttribute('aria-busy')).toBe('true');
    expect(q(el, '[data-testid="card-shell"]')).toBeNull();
  });

  // The integration's title and the built-in default come with the store and
  // the catalogs; guessing one here would change the heading under the user.
  it('writes no text at all when the dashboard sets no title', async () => {
    const el = await mountCard({});

    expect(q(el, '[data-testid="card-placeholder"]')?.textContent?.trim()).toBe('');
    expect(q(el, '[data-testid="card-placeholder-title"]')).toBeNull();
  });

  // jsdom lays nothing out, so the sizing is read off the stylesheet. One rule
  // sizes the frame and the shell that replaces it, in a sections cell and in
  // a masonry column alike, so the swap moves no edge; the body takes what the
  // head leaves.
  it('is sized by the rule that sizes the shell replacing it', async () => {
    const el = await mountCard({});
    const css = componentCss('haventory-card');

    expect(el.hasAttribute('loading')).toBe(true);
    expect(css).toMatch(/\.placeholder, hv-card-shell \{ flex: 1 1 \d+px; min-height: 0; \}/);
    expect(css).toMatch(/\.placeholder \{[^}]*box-sizing: border-box;[^}]*border: 1px solid/);
    expect(css).toMatch(/\.placeholder-head \{ flex: none;[^}]*height: var\(--hv-placeholder-head\);/);
    expect(css).toMatch(/\.placeholder-body \{ flex: 1 1 0; \}/);
  });

  // The head stands in for the shell's header row, whose height is its padding
  // around buttons that grow on a card the shell calls mobile.
  it("takes the shell's header row at the shell's own breakpoint", () => {
    const shell = componentCss('hv-card-shell');
    expect(shell).toMatch(/\.header \{[^}]*padding: 14px 16px 10px;/);
    expect(shell).toMatch(/\.header \.expand \{[^}]*height: var\(--hv-tap-min, 36px\);/);
    expect(shell).toMatch(/:host\(\[mobile\]\) \{[^}]*--hv-tap-min: 44px;/);
    expect(PLACEHOLDER_HEAD_PX).toEqual({ wide: 14 + 36 + 10, mobile: 14 + 44 + 10 });
    expect(PLACEHOLDER_MOBILE_MAX_PX).toBe(MOBILE_BREAKPOINT + 2);

    const css = componentCss('haventory-card');
    expect(css).toMatch(/--hv-placeholder-head: 60px;/);
    expect(css).toMatch(
      /@container \(max-width: 602px\) \{ \.placeholder \{ --hv-placeholder-head: 68px; \} \}/,
    );
    // A size container is the containing block for `position: fixed`, which
    // the real tree's full view and sheets are.
    expect(css).toMatch(/:host\(\[loading\]\) \{[^}]*container-type: inline-size;/);
    expect(css).not.toMatch(/:host \{[^}]*container-type/);
  });

  // The frame the shell draws and the one standing in for it read one set of
  // declarations, so a theme cannot paint the two differently.
  it('paints with the tokens the shell paints with', () => {
    expect(sheetsOf('haventory-card')).toContain(hostTokens);
    expect(sheetsOf('haventory-panel')).toContain(hostTokens);
    expect(tokens.cssText).toContain(hostTokens.cssText);
  });
});

describe('haventory-panel while its runtime is loading', () => {
  it('draws the app bar with the registered title over an empty, busy page', async () => {
    const el = await mountPanel({ hass: hassWithCatalog(), panel: { config: { title: 'Vorrat' } } });

    const placeholder = q(el, '[data-testid="panel-placeholder"]');
    expect(placeholder?.textContent?.trim()).toBe('Vorrat');
    expect(q(el, '.placeholder-body')?.getAttribute('aria-busy')).toBe('true');
    expect(q(el, '[data-testid="panel-full-view"]')).toBeNull();
    // Home Assistant's own sidebar is on screen, so the bar offers no way to it.
    expect(q(el, '[data-testid="panel-placeholder-menu"]')).toBeNull();
  });

  it('offers the sidebar toggle when narrow, named as Home Assistant names its own', async () => {
    const el = await mountPanel({ hass: hassWithCatalog(), narrow: true });
    const toggles: Event[] = [];
    // Where `home-assistant-main` listens: above the panel, outside its shadow root.
    const listen = (e: Event) => toggles.push(e);
    document.addEventListener('hass-toggle-menu', listen);

    const button = q<HTMLButtonElement>(el, '[data-testid="panel-placeholder-menu"]');
    expect(button?.getAttribute('aria-label')).toBe(SIDEBAR_TOGGLE);
    expect(button?.querySelector('path')?.getAttribute('d')).toBe(ICONS.menu);
    button?.click();
    document.removeEventListener('hass-toggle-menu', listen);

    expect(toggles).toHaveLength(1);
    expect(toggles[0]?.composed).toBe(true);
  });

  it('draws no nameless button when Home Assistant has no name for it', async () => {
    const el = await mountPanel({ hass: hassWithCatalog(() => ''), narrow: true });
    expect(q(el, '[data-testid="panel-placeholder-menu"]')).toBeNull();
  });

  // Home Assistant hands down a new `hass` on every state change in the house,
  // and a new `localize` only when its translations change.
  it('redraws for a new Home Assistant catalog and for nothing else', async () => {
    const el = await mountPanel({ hass: makeMockHass(), narrow: true });
    expect(q(el, '[data-testid="panel-placeholder-menu"]')).toBeNull();

    const hass = hassWithCatalog();
    el.hass = hass;
    await el.updateComplete;
    expect(q(el, '[data-testid="panel-placeholder-menu"]')).toBeTruthy();

    const redraws = vi.spyOn(el as unknown as { requestUpdate: () => void }, 'requestUpdate');
    for (let i = 0; i < 5; i++) el.hass = { ...hass };
    expect(redraws).not.toHaveBeenCalled();
  });

  it('keeps the menu glyph the real bar draws', () => {
    expect(MENU_ICON_PATH).toBe(ICONS.menu);
  });
});

describe('the runtime arriving', () => {
  /** What one shadow root showed each time it changed: the placeholder, the real tree, both or neither. */
  function watch(el: Host, real: string): string[] {
    const seen: string[] = [];
    const root = el.shadowRoot as ShadowRoot;
    const show = () => {
      const placeholder = root.querySelector('.placeholder') !== null;
      const tree = root.querySelector(real) !== null;
      seen.push(placeholder && tree ? 'both' : placeholder ? 'placeholder' : tree ? 'real' : 'neither');
    };
    new MutationObserver(show).observe(root, { childList: true, subtree: true });
    return seen;
  }

  it('replaces each placeholder with the real tree in one update', async () => {
    const card = await mountCard({ title: 'Garage shelf' });
    const panel = await mountPanel({ hass: hassWithCatalog(), panel: { config: { title: 'Vorrat' } } });
    expect(q(card, '[data-testid="card-placeholder"]')).toBeTruthy();
    expect(q(panel, '[data-testid="panel-placeholder"]')).toBeTruthy();
    const cardSeen = watch(card, '[data-testid="card-shell"]');
    const panelSeen = watch(panel, '[data-testid="panel-full-view"]');

    runtimeGate.open();
    // The promise both hosts are already waiting on.
    await loadRuntime();
    await settle(card);
    await settle(panel);

    expect(new Set(cardSeen)).toEqual(new Set(['real']));
    expect(new Set(panelSeen)).toEqual(new Set(['real']));
    expect(card.hasAttribute('loading')).toBe(false);
    expect(panel.hasAttribute('loading')).toBe(false);
  });

  // A second card on the page, or the panel opened after a dashboard, finds the
  // runtime already in and has nothing to stand in for.
  it('draws no placeholder for a host that connects after it', async () => {
    const drawn = vi.spyOn(
      HAventoryPanel.prototype as unknown as { renderPlaceholder(): unknown },
      'renderPlaceholder',
    );
    const el = await mountPanel({ hass: hassWithCatalog() });

    expect(q(el, '[data-testid="panel-full-view"]')).toBeTruthy();
    expect(drawn).not.toHaveBeenCalled();
    expect(el.hasAttribute('loading')).toBe(false);
  });
});

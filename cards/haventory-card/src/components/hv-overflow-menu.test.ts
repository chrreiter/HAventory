import './hv-overflow-menu';
import { placeMenu } from './hv-overflow-menu';
import type { HVOverflowMenu } from './hv-overflow-menu';
import { NARROW_QUERY } from '../ui/responsive';

async function mount(entries: HVOverflowMenu['entries']) {
  const el = document.createElement('hv-overflow-menu') as HVOverflowMenu;
  el.entries = entries;
  document.body.appendChild(el);
  await el.updateComplete;
  (el.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
  await el.updateComplete;
  return el;
}

const item = (el: HVOverflowMenu, id: string) =>
  el.shadowRoot?.querySelector(`[data-testid="overflow-item"][data-id="${id}"]`) as HTMLElement;

describe('hv-overflow-menu', () => {
  it('opens on the trigger and reports the chosen entry once', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);
    const picked: string[] = [];
    el.addEventListener('select', (e) => picked.push((e as CustomEvent).detail.id));

    item(el, 'refresh').click();
    await el.updateComplete;

    expect(picked).toEqual(['refresh']);
    expect(el.shadowRoot?.querySelector('[data-testid="overflow-menu"]')).toBe(null);
  });

  // A long hint used to sit beside the label as a non-shrinking sibling: inside
  // a 250px menu that left "Organize…" a sliver to render in, and an unbreakable
  // word simply overflowed across the hint.
  it('stacks a long hint under its label instead of beside it', async () => {
    const el = await mount([
      { id: 'organize', label: 'Organize…', meta: 'Locations · Tags · Categories' },
      { id: 'export', label: 'Export backup', sub: 'All 556 items · all locations' },
    ]);

    const labels = item(el, 'organize').querySelector('.labels') as HTMLElement;
    expect(labels.textContent).toContain('Organize…');
    // Same block as the label — not a sibling competing for the same line.
    expect(labels.querySelector('.meta')?.textContent).toContain('Locations · Tags · Categories');
    expect(item(el, 'organize').querySelector(':scope > .meta')).toBe(null);

    // `sub` keeps its existing treatment, and both read the same way.
    const exportLabels = item(el, 'export').querySelector('.labels') as HTMLElement;
    expect(exportLabels.querySelector('.sub')?.textContent).toContain('All 556 items');
  });

  it('keeps a badge on the entry row, where it is a status not a hint', async () => {
    const el = await mount([{ id: 'diagnostics', label: 'Diagnostics', badge: '2' }]);
    expect(item(el, 'diagnostics').querySelector(':scope > .badge')?.textContent).toContain('2');
  });

  it('ignores a disabled entry', async () => {
    const el = await mount([{ id: 'export-view', label: 'Export current view', disabled: true }]);
    const picked: string[] = [];
    el.addEventListener('select', (e) => picked.push((e as CustomEvent).detail.id));

    item(el, 'export-view').click();
    await el.updateComplete;

    expect(picked).toEqual([]);
  });
});

describe('hv-overflow-menu: narrow screens', () => {
  const narrow = () => {
    const styles = (customElements.get('hv-overflow-menu') as typeof HVOverflowMenu).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
    const start = css.indexOf(`@media ${NARROW_QUERY}`);
    expect(start, 'no narrow-viewport block').toBeGreaterThan(-1);
    return css.slice(start);
  };

  // The card once carried three phone breakpoints — this menu at 600px, the
  // card element at 600px and the full view's viewport at 700px — so a window
  // between them showed a sheet menu over centred dialogs. Every overlay now
  // flips at the one viewport width; CSS cannot read the constant, so the two
  // spellings are pinned to each other here.
  it('rises at the same viewport width as every other overlay', () => {
    expect(NARROW_QUERY).toBe('(max-width: 700px)');
    expect(narrow()).toContain('@media (max-width: 700px)');
  });

  // A 250px trigger-anchored dropdown covered most of the list it was acting
  // on, and "Export current view" wrapped onto two lines inside it. The base
  // rule already carries position: fixed; the sheet is the inset overriding
  // the measured coordinates.
  it('becomes a bottom sheet instead of an anchored dropdown', () => {
    const css = narrow();
    expect(css).toMatch(/\.menu \{[^}]*inset: auto 0 0 0/);
    expect(css).toMatch(/\.menu \{[^}]*max-width: none/);
  });

  it('keeps the scrim from swallowing the tap that should close it', () => {
    // The menu closes on any outside pointerdown, and that check asks whether
    // the composed path includes this element. A scrim that took the tap would
    // be inside that path, so tapping away would leave the menu open.
    expect(narrow()).toMatch(/\.scrim \{[^}]*pointer-events: none/);
  });

  // The scrim was a ::before on the menu. A negative-z-index child paints after
  // the background of the element establishing the stacking context and before
  // its content, so the wash landed on top of the menu's own white surface and
  // under its text: the sheet looked like it had no background at all.
  it('paints the scrim behind the sheet, not over its surface', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);
    const scrim = el.shadowRoot?.querySelector('[data-testid="overflow-scrim"]') as HTMLElement;
    const menu = el.shadowRoot?.querySelector('[data-testid="overflow-menu"]') as HTMLElement;

    // A sibling, so it is outside the menu's stacking context...
    expect(scrim).toBeTruthy();
    expect(menu.contains(scrim)).toBe(false);
    // ...and one layer under it.
    const z = (n: HTMLElement) => Number(/z-index: (\d+)/.exec(n.getAttribute('style') ?? '')?.[1]);
    expect(z(scrim)).toBeLessThan(z(menu));
    // The surface itself is untouched.
    expect(narrow()).not.toMatch(/\.menu::before/);
    expect(String((customElements.get('hv-overflow-menu') as never as { styles: unknown[] }).styles)).toContain(
      'background: var(--hv-surface)',
    );
  });

  it('gives the entries a touch-sized row', () => {
    expect(narrow()).toMatch(/\.entry \{[^}]*min-height: 48px/);
  });

  it('still closes on an outside pointerdown once it is a sheet', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);
    expect(el.shadowRoot?.querySelector('[data-testid="overflow-menu"]')).toBeTruthy();

    // jsdom has no PointerEvent; the handler only reads composedPath().
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('[data-testid="overflow-menu"]')).toBe(null);
  });

  it('takes focus when it opens', async () => {
    // The Escape handler is a keydown listener on the menu, so it only fires
    // while focus is already inside it — opening has to move focus there.
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);
    expect(el.shadowRoot?.activeElement).toBe(el.shadowRoot?.querySelector('[data-testid="overflow-menu"]'));
  });

  it('closes on Escape', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);

    (el.shadowRoot?.querySelector('[data-testid="overflow-menu"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('[data-testid="overflow-menu"]')).toBe(null);
  });

  it('hands focus back to whatever opened it', async () => {
    // A real pointer click focuses the trigger before the menu opens; jsdom's
    // programmatic click does not, so focus it explicitly to reproduce that.
    const el = document.createElement('hv-overflow-menu') as HVOverflowMenu;
    el.entries = [{ id: 'refresh', label: 'Refresh data' }];
    document.body.appendChild(el);
    await el.updateComplete;

    const trigger = el.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await el.updateComplete;
    expect(el.shadowRoot?.activeElement).toBe(el.shadowRoot?.querySelector('[data-testid="overflow-menu"]'));

    (el.shadowRoot?.querySelector('[data-testid="overflow-menu"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await el.updateComplete;

    expect(el.shadowRoot?.activeElement).toBe(trigger);
  });
});

// A list filtered down to a single row leaves hv-list's scroller shorter than
// the open menu (#389). Anchoring the popup inside the row put it inside that
// scroller's clip, where neither opening direction could fit — opening down and
// flipping up both left a ~6px sliver. The menu is viewport-fixed instead, so
// no ancestor's overflow can cut it.
describe('hv-overflow-menu: escaping ancestor clips', () => {
  // The first .menu block is the base rule; the sheet's overrides live in the
  // narrow @media block after it.
  const baseMenuRule = () => {
    const styles = (customElements.get('hv-overflow-menu') as typeof HVOverflowMenu).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
    return /\.menu \{[^}]*\}/.exec(css)?.[0] ?? '';
  };

  it('draws the dropdown viewport-fixed, from measured coordinates', () => {
    expect(baseMenuRule()).toContain('position: fixed');
    expect(baseMenuRule()).toContain('top: var(--hv-menu-top');
    expect(baseMenuRule()).toContain('left: var(--hv-menu-left');
  });

  it('carries live placement coordinates while open', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);
    // jsdom has no layout — every rect is zero — so both axes clamp to the
    // 8px viewport margin; what matters is that the coordinates are set.
    expect(el.style.getPropertyValue('--hv-menu-top')).toBe('8px');
    expect(el.style.getPropertyValue('--hv-menu-left')).toBe('8px');
  });

  it('follows the trigger when a composed ancestor scrolls', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);
    const trigger = el.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLElement;
    trigger.getBoundingClientRect = () => ({ top: 100, right: 600, bottom: 124 }) as DOMRect;

    document.body.dispatchEvent(new Event('scroll'));

    expect(el.style.getPropertyValue('--hv-menu-top')).toBe('130px');
    expect(el.style.getPropertyValue('--hv-menu-left')).toBe('600px');
  });

  it('releases its reflow listeners when it closes', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh data' }]);
    // The body is one of the composed ancestors the open menu listens on.
    const removed = vi.spyOn(document.body, 'removeEventListener');
    el.close();
    expect(removed.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
  });
});

describe('placeMenu', () => {
  const menu = { width: 250, height: 137 };
  const viewport = { width: 1280, height: 900 };

  it('hangs just under the trigger, right edges aligned, when there is room below', () => {
    expect(placeMenu({ top: 210, right: 1200, bottom: 244 }, menu, viewport)).toEqual({
      top: 250,
      left: 950,
    });
  });

  it('flips above the trigger when the room below runs out', () => {
    expect(placeMenu({ top: 800, right: 1200, bottom: 834 }, menu, viewport)).toEqual({
      top: 657,
      left: 950,
    });
  });

  it('pins to the viewport margin when neither side could hold it whole', () => {
    // 120px of viewport against a 137px menu: below overflows, above is
    // negative — the clamp keeps the top edge and the first entries on-screen.
    expect(placeMenu({ top: 60, right: 400, bottom: 84 }, menu, { width: 1280, height: 120 })).toEqual({
      top: 8,
      left: 150,
    });
  });

  it('keeps the menu inside the left viewport edge', () => {
    expect(placeMenu({ top: 210, right: 200, bottom: 244 }, menu, viewport).left).toBe(8);
  });
});

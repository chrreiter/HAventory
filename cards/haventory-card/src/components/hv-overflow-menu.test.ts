import './hv-overflow-menu';
import type { HVOverflowMenu } from './hv-overflow-menu';

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
    const start = css.indexOf('@media (max-width: 600px)');
    expect(start, 'no narrow-viewport block').toBeGreaterThan(-1);
    return css.slice(start);
  };

  // A 250px anchored dropdown covered most of the list it was acting on, and
  // "Export current view" wrapped onto two lines inside it.
  it('becomes a bottom sheet instead of an anchored dropdown', () => {
    const css = narrow();
    expect(css).toMatch(/\.menu \{[^}]*position: fixed/);
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

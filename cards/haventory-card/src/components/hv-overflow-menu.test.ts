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

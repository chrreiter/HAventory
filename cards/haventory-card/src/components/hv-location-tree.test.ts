import './hv-location-tree';
import type { HVLocationTree } from './hv-location-tree';
import type { LocationTreeNode } from '../store/types';

function node(
  id: string,
  name: string,
  parentId: string | null,
  counts: [number, number],
  children: LocationTreeNode[] = [],
  areaId: string | null = null,
): LocationTreeNode {
  const display = parentId ? `${parentId} / ${name}` : name;
  return {
    id,
    name,
    parent_id: parentId,
    area_id: areaId,
    path: { id_path: [id], name_path: [name], display_path: display, sort_key: display.toLowerCase() },
    direct_item_count: counts[0],
    subtree_item_count: counts[1],
    children,
  };
}

const tree: LocationTreeNode[] = [
  node('garage', 'Garage', null, [1, 64], [
    node('shelf-a', 'Shelf A', 'garage', [38, 38]),
    node('shelf-b', 'Shelf B', 'garage', [25, 25], [node('bin-3', 'Bin 3', 'shelf-b', [0, 0])]),
  ]),
  node('kitchen', 'Kitchen', null, [57, 57], [], 'area-kitchen'),
];

async function mount(props: Partial<HVLocationTree> = {}) {
  const el = document.createElement('hv-location-tree') as HVLocationTree;
  el.nodes = tree;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const rows = (el: HVLocationTree) =>
  [...(el.shadowRoot?.querySelectorAll('[data-testid="tree-row"]') ?? [])] as HTMLElement[];
const ids = (el: HVLocationTree) => rows(el).map((r) => r.dataset.id);
const q = (el: HVLocationTree, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;

describe('hv-location-tree: hierarchy', () => {
  it('starts collapsed, showing only the roots', async () => {
    const el = await mount();
    expect(ids(el)).toEqual(['garage', 'kitchen']);
  });

  it('expands and collapses a branch', async () => {
    const el = await mount();
    (el.shadowRoot?.querySelector('[data-testid="tree-twisty"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(ids(el)).toEqual(['garage', 'shelf-a', 'shelf-b', 'kitchen']);

    (el.shadowRoot?.querySelector('[data-testid="tree-twisty"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(ids(el)).toEqual(['garage', 'kitchen']);
  });

  it('indents children by depth — a real tree, not a padded flat list', async () => {
    const el = await mount();
    el.revealPathTo('bin-3');
    await el.updateComplete;
    const depths = Object.fromEntries(rows(el).map((r) => [r.dataset.id, r.dataset.depth]));
    expect(depths).toMatchObject({ garage: '0', 'shelf-b': '1', 'bin-3': '2' });
  });

  it('opens the ancestors of a deep selection', async () => {
    const el = await mount({ selectedId: 'bin-3' });
    expect(ids(el)).not.toContain('bin-3');
    el.revealPathTo('bin-3');
    await el.updateComplete;
    expect(ids(el)).toContain('bin-3');
  });

  it('shows a leaf without a twisty', async () => {
    const el = await mount();
    el.revealPathTo('shelf-a');
    await el.updateComplete;
    const shelfRow = rows(el).find((r) => r.dataset.id === 'shelf-a')!;
    expect(shelfRow.querySelector('.twisty.placeholder')).toBeTruthy();
  });
});

describe('hv-location-tree: counts and decorations', () => {
  it('renders the backend subtree counts, not a client-side sum', async () => {
    const el = await mount({ showCounts: true });
    const counts = [...(el.shadowRoot?.querySelectorAll('[data-testid="tree-count"]') ?? [])].map(
      (c) => c.textContent?.trim(),
    );
    expect(counts).toEqual(['64', '57']);
  });

  it('omits counts unless asked', async () => {
    const el = await mount();
    expect(q(el, '[data-testid="tree-count"]')).toBe(null);
  });

  it('chips the area only where one is explicitly set', async () => {
    const el = await mount({ showAreas: true, areas: [{ id: 'area-kitchen', name: 'Kitchen' }] });
    const chips = [...(el.shadowRoot?.querySelectorAll('[data-testid="tree-area"]') ?? [])];
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Area: Kitchen');
  });

  it('adds All items and No location rows on request', async () => {
    const el = await mount({ showAll: true, showOrphans: true, showCounts: true, totalCount: 250, orphanCount: 3 });
    expect(q(el, '[data-testid="tree-all"]')?.textContent).toContain('All items');
    expect(q(el, '[data-testid="tree-all"]')?.textContent).toContain('250');
    expect(q(el, '[data-testid="tree-orphans"]')?.textContent).toContain('No location');
    expect(q(el, '[data-testid="tree-orphans"]')?.textContent).toContain('3');
  });
});

describe('hv-location-tree: selection', () => {
  it('emits the picked location', async () => {
    const el = await mount();
    let detail: { locationId?: string | null } = {};
    el.addEventListener('select', (e) => {
      detail = (e as CustomEvent).detail;
    });
    (q(el, '[data-testid="tree-select"][data-id="garage"]') as HTMLButtonElement).click();
    expect(detail.locationId).toBe('garage');
  });

  it('clears the location from the All items row', async () => {
    const el = await mount({ showAll: true });
    let detail: { locationId?: string | null } = { locationId: 'x' };
    el.addEventListener('select', (e) => {
      detail = (e as CustomEvent).detail;
    });
    (q(el, '[data-testid="tree-all"]') as HTMLButtonElement).click();
    expect(detail.locationId).toBe(null);
  });

  it('marks the selected row, and never marks a location while orphans are selected', async () => {
    const el = await mount({ selectedId: 'garage' });
    expect(rows(el).find((r) => r.dataset.id === 'garage')?.classList.contains('selected')).toBe(true);

    el.orphansSelected = true;
    await el.updateComplete;
    expect(rows(el).find((r) => r.dataset.id === 'garage')?.classList.contains('selected')).toBe(false);
  });

  it('emits a distinct event for the orphans row', async () => {
    const el = await mount({ showOrphans: true });
    let fired = 0;
    el.addEventListener('select-orphans', () => {
      fired += 1;
    });
    (q(el, '[data-testid="tree-orphans"]') as HTMLButtonElement).click();
    expect(fired).toBe(1);
  });
});

describe('hv-location-tree: filtering and cycle guard', () => {
  it('keeps a branch visible when a descendant matches, and auto-expands', async () => {
    const el = await mount({ filterText: 'bin' });
    expect(ids(el)).toEqual(['garage', 'shelf-b', 'bin-3']);
  });

  it('says so when nothing matches', async () => {
    const el = await mount({ filterText: 'zzz' });
    expect(q(el, '[data-testid="tree-empty"]')?.textContent).toContain('No locations match');
  });

  it('reports an empty tree distinctly from an empty filter result', async () => {
    const el = await mount({ nodes: [] });
    expect(q(el, '[data-testid="tree-empty"]')?.textContent).toContain('No locations yet');
  });

  it('disables a node and its descendants when excluded, so a parent picker cannot make a cycle', async () => {
    const el = await mount({ excludeSubtreeOf: 'shelf-b' });
    el.revealPathTo('bin-3');
    await el.updateComplete;

    const disabled = rows(el)
      .filter((r) => r.hasAttribute('disabled'))
      .map((r) => r.dataset.id);
    expect(disabled).toEqual(['shelf-b', 'bin-3']);
  });

  it('ignores a click on an excluded node', async () => {
    const el = await mount({ excludeSubtreeOf: 'garage' });
    let fired = 0;
    el.addEventListener('select', () => {
      fired += 1;
    });
    (q(el, '[data-testid="tree-select"][data-id="garage"]') as HTMLButtonElement).click();
    expect(fired).toBe(0);
  });
});

describe('hv-location-tree: manage mode', () => {
  it('offers edit and delete only when managing', async () => {
    const plain = await mount();
    expect(q(plain, '[data-testid="tree-edit"]')).toBe(null);

    const managed = await mount({ manage: true });
    expect(q(managed, '[data-testid="tree-edit"]')).toBeTruthy();
    expect(q(managed, '[data-testid="tree-delete"]')).toBeTruthy();
  });

  it('emits edit and delete with the location id, without selecting it', async () => {
    const el = await mount({ manage: true });
    const seen: string[] = [];
    let editId: string | null = null;
    el.addEventListener('select', () => seen.push('select'));
    el.addEventListener('edit-location', (e) => {
      seen.push('edit');
      editId = (e as CustomEvent).detail.locationId;
    });
    el.addEventListener('delete-location', () => seen.push('delete'));

    (q(el, '[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement).click();

    expect(seen).toEqual(['edit', 'delete']);
    expect(editId).toBe('garage');
  });
});

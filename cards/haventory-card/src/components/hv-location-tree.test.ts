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
  node('kitchen', 'Kitchen', null, [57, 57]),
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

  it('puts the whole path in reach of a pointer', async () => {
    // Names clip with an ellipsis in a 264px sidebar, and a picker shows the
    // leaf name only — so the path is where the tooltip earns its keep.
    const el = await mount();
    (q(el, '[data-testid="tree-twisty"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="tree-select"][data-id="shelf-a"]')?.getAttribute('title')).toBe(
      'garage / Shelf A',
    );
  });

  it('adds All items and No location rows on request', async () => {
    const el = await mount({ showAll: true, showOrphans: true, showCounts: true, totalCount: 250, orphanCount: 3 });
    expect(q(el, '[data-testid="tree-all"]')?.textContent).toContain('All items');
    expect(q(el, '[data-testid="tree-all"]')?.textContent).toContain('250');
    expect(q(el, '[data-testid="tree-orphans"]')?.textContent).toContain('No location');
    expect(q(el, '[data-testid="tree-orphans"]')?.textContent).toContain('3');
  });

  // The row clears the location either way, but a picker is assigning one, not
  // browsing: "All items" there read as a set of items and delivered an empty
  // location field.
  it('lets the host rename the clear row for a picker', async () => {
    const el = await mount({ showAll: true, allLabel: 'No location', allIcon: 'close' });
    const row = q(el, '[data-testid="tree-all"]');
    expect(row?.textContent).toContain('No location');
    expect(row?.textContent).not.toContain('All items');
    expect(row?.querySelector('[data-icon="close"]')).toBeTruthy();
    expect(row?.querySelector('[data-icon="home"]')).toBe(null);
  });
});

// A total that ignores the active filter says nothing about where the matches
// are, which is the one question a location sidebar exists to answer.
describe('hv-location-tree: counts under a filter', () => {
  const matched: LocationTreeNode[] = [
    { ...tree[0], matching_direct_count: 0, matching_subtree_count: 4 },
    { ...tree[1], matching_direct_count: 2, matching_subtree_count: 2 },
  ];

  it('reads "matching / total" on every row once the backend sends both', async () => {
    const el = await mount({ nodes: matched, showCounts: true });
    const counts = [...(el.shadowRoot?.querySelectorAll('[data-testid="tree-count"]') ?? [])].map(
      (c) => c.textContent?.trim(),
    );
    expect(counts).toEqual(['4 / 64', '2 / 57']);
  });

  it('falls back to the plain total when nothing is filtered', async () => {
    const el = await mount({ showCounts: true });
    expect(q(el, '[data-testid="tree-count"]')?.textContent?.trim()).toBe('64');
  });

  it('pairs the All items row and derives the orphan share as the remainder', async () => {
    const el = await mount({
      nodes: matched,
      showAll: true,
      showOrphans: true,
      showCounts: true,
      totalCount: 250,
      orphanCount: 3,
      // 4 + 2 are filed, so the last one has no location.
      matchingTotalCount: 7,
    });
    expect(q(el, '[data-testid="tree-all"]')?.textContent).toContain('7 / 250');
    expect(q(el, '[data-testid="tree-orphans"]')?.textContent).toContain('1 / 3');
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

// aria-expanded on its own says only that something opened; which element it
// opened was left to whatever happened to follow the row in reading order — and
// a collapsed node renders no descendants at all, so there was nothing to name.
describe('hv-location-tree: what a row discloses', () => {
  const row = (el: HVLocationTree, id: string) =>
    q(el, `[data-testid="tree-row"][data-id="${id}"]`) as HTMLElement;
  const twisty = (el: HVLocationTree, id: string) =>
    q(el, `[data-testid="tree-row"][data-id="${id}"] [data-testid="tree-twisty"]`) as HTMLButtonElement;

  it('names the container its children go in, collapsed or expanded', async () => {
    const el = await mount();
    const id = row(el, 'garage').getAttribute('aria-controls') as string;
    expect(id).toBeTruthy();
    expect(row(el, 'garage').getAttribute('aria-expanded')).toBe('false');

    // The id has to resolve in both states — a row pointing at nothing announces
    // as controlling nothing — so the container stays behind, emptied.
    const shut = el.shadowRoot?.getElementById(id);
    expect(shut, 'container while collapsed').toBeTruthy();
    expect(shut?.querySelector('[data-testid="tree-row"]'), 'no children while collapsed').toBe(null);

    twisty(el, 'garage').click();
    await el.updateComplete;

    expect(row(el, 'garage').getAttribute('aria-expanded')).toBe('true');
    expect(row(el, 'garage').getAttribute('aria-controls')).toBe(id);
    const open = el.shadowRoot?.getElementById(id);
    expect(
      [...(open?.querySelectorAll('[data-testid="tree-row"]') ?? [])].map((r) => (r as HTMLElement).dataset.id),
    ).toEqual(['shelf-a', 'shelf-b']);
  });

  it('gives each node a container of its own that survives a re-render', async () => {
    const el = await mount();
    el.revealPathTo('bin-3');
    await el.updateComplete;

    const named = Object.fromEntries(rows(el).map((r) => [r.dataset.id, r.getAttribute('aria-controls')]));
    expect(named.garage).toBeTruthy();
    expect(named['shelf-b']).toBeTruthy();
    expect(named.garage, 'two nodes, two containers').not.toBe(named['shelf-b']);
    // A leaf discloses nothing, so it names nothing rather than a dead id.
    expect(named['shelf-a']).toBe(null);
    expect(named['bin-3']).toBe(null);

    const before = named.garage;
    el.showCounts = !el.showCounts;
    await el.updateComplete;
    expect(row(el, 'garage').getAttribute('aria-controls'), 'derived from the node id, not the render').toBe(
      before,
    );
  });

  // Location ids are uuids today, so the escaping is what keeps this honest for
  // ids from anywhere else: distinct keys can never land on one container, and
  // what comes out has to be usable as a selector.
  it('keeps two ids apart however the raw ids are punctuated', async () => {
    const kid = (parent: string) => [node(`${parent}/kid`, 'Kid', parent, [1, 1])];
    const el = await mount({
      nodes: [
        node('a b', 'Spaced', null, [1, 2], kid('a b')),
        node('a-b', 'Hyphened', null, [1, 2], kid('a-b')),
      ],
    });

    const spaced = row(el, 'a b').getAttribute('aria-controls') as string;
    const hyphened = row(el, 'a-b').getAttribute('aria-controls') as string;
    expect(spaced).not.toBe(hyphened);
    for (const id of [spaced, hyphened]) {
      expect(el.shadowRoot?.getElementById(id), id).toBeTruthy();
      expect(el.shadowRoot?.querySelector(`#${id}`), `${id} as a selector`).toBeTruthy();
    }
  });
});

describe('hv-location-tree: area grouping', () => {
  const AREAS = [
    { id: 'area-kitchen', name: 'Kitchen' },
    { id: 'area-garage', name: 'Garage' },
  ];
  const areaTree: LocationTreeNode[] = [
    node('fridge', 'Fridge', null, [3, 9], [node('top', 'Top Shelf', 'fridge', [6, 6])], 'area-kitchen'),
    node('bench', 'Bench', null, [2, 2], [], 'area-garage'),
    node('attic', 'Attic', null, [5, 5]),
  ];
  const mountAreas = (props: Partial<HVLocationTree> = {}) =>
    mount({ nodes: areaTree, areas: AREAS, ...props });

  const heads = (el: HVLocationTree) =>
    [...(el.shadowRoot?.querySelectorAll('[data-testid="tree-area-head"]') ?? [])] as HTMLElement[];
  const headNames = (el: HVLocationTree) => heads(el).map((h) => h.textContent?.replace(/\s+/g, ' ').trim());

  it('files each root under its area, areas first and in name order', async () => {
    const el = await mountAreas();
    expect(headNames(el)).toEqual(['Area: Garage', 'Area: Kitchen', 'No area']);
    expect(ids(el)).toEqual(['bench', 'fridge', 'attic']);
  });

  // A band collapses the same way a node does, and its key carries a colon that
  // could not be written into a selector as it stands.
  it('names the roots each band discloses, collapsed or expanded', async () => {
    const el = await mountAreas();
    const head = () => heads(el)[0];
    const id = head().getAttribute('aria-controls') as string;
    expect(id).toBeTruthy();
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(el.shadowRoot?.getElementById(id)?.querySelector('[data-testid="tree-row"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector(`#${id}`), 'usable as a selector').toBeTruthy();
    // Each band names its own, so collapsing one says nothing about the others.
    expect(new Set(heads(el).map((h) => h.getAttribute('aria-controls'))).size).toBe(heads(el).length);

    (head().querySelector('[data-testid="tree-area-twisty"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(head().getAttribute('aria-expanded')).toBe('false');
    expect(head().getAttribute('aria-controls')).toBe(id);
    const shut = el.shadowRoot?.getElementById(id);
    expect(shut, 'container while collapsed').toBeTruthy();
    expect(shut?.querySelector('[data-testid="tree-row"]'), 'no roots while collapsed').toBe(null);
  });

  it('marks an area with the chip every surface uses, not as a path segment', async () => {
    const el = await mountAreas();
    expect(heads(el)[0].querySelector('.hv-area-chip')).toBeTruthy();
    expect(heads(el)[0].querySelector('[data-icon="home"]')).toBeTruthy();
  });

  it('leaves an inventory that assigns no areas exactly as it was', async () => {
    const el = await mount();
    expect(heads(el)).toEqual([]);
    expect(rows(el).map((r) => r.dataset.depth)).toEqual(['0', '0']);
  });

  it('indents a grouped root one level below its header', async () => {
    const el = await mountAreas();
    expect(rows(el).map((r) => r.dataset.depth)).toEqual(['1', '1', '1']);
  });

  it('opens its members by default and hides them once collapsed', async () => {
    const el = await mountAreas();
    const twisty = el.shadowRoot?.querySelector(
      '[data-testid="tree-area-twisty"][data-area="area-kitchen"]',
    ) as HTMLButtonElement;
    twisty.click();
    await el.updateComplete;
    expect(ids(el)).toEqual(['bench', 'attic']);
    expect(headNames(el)).toEqual(['Area: Garage', 'Area: Kitchen', 'No area']);

    twisty.click();
    await el.updateComplete;
    expect(ids(el)).toEqual(['bench', 'fridge', 'attic']);
  });

  it('is a label, not a control, unless the host says otherwise', async () => {
    const el = await mountAreas();
    const fired: string[] = [];
    el.addEventListener('select', () => fired.push('select'));
    el.addEventListener('select-area', () => fired.push('select-area'));
    (heads(el)[0].querySelector('[data-testid="tree-area-select"]') as HTMLElement | null)?.click();
    heads(el)[0].click();
    expect(fired).toEqual([]);
  });

  it('filters by area when the host browses rather than assigns', async () => {
    const el = await mountAreas({ areaSelectable: true });
    let areaId: string | null = null;
    const fired: string[] = [];
    el.addEventListener('select', () => fired.push('select'));
    el.addEventListener('select-area', (e) => {
      fired.push('select-area');
      areaId = (e as CustomEvent).detail.areaId;
    });
    (heads(el)[1].querySelector('[data-testid="tree-area-select"]') as HTMLButtonElement).click();
    expect(fired).toEqual(['select-area']);
    expect(areaId).toBe('area-kitchen');
  });

  it('never offers the no-area tail as a filter — it is the absence of one', async () => {
    const el = await mountAreas({ areaSelectable: true });
    let fired = 0;
    el.addEventListener('select-area', () => {
      fired += 1;
    });
    const tail = heads(el)[2];
    (tail.querySelector('[data-testid="tree-area-select"]') as HTMLElement | null)?.click();
    tail.click();
    expect(fired).toBe(0);
  });

  it('marks the area the list is filtered to, and yields to a picked location', async () => {
    const el = await mountAreas({ areaSelectable: true, selectedAreaId: 'area-kitchen' });
    expect(heads(el)[1].classList.contains('selected')).toBe(true);

    el.selectedId = 'bench';
    await el.updateComplete;
    expect(heads(el)[1].classList.contains('selected')).toBe(false);
  });

  it('totals its members on the header, matching half included', async () => {
    const el = await mountAreas({ showCounts: true });
    const headCount = (i: number) => heads(el)[i].querySelector('[data-testid="tree-area-count"]')?.textContent?.trim();
    expect(headCount(1)).toBe('9');

    el.nodes = areaTree.map((n) => ({ ...n, matching_subtree_count: n.id === 'fridge' ? 4 : 1 }));
    await el.updateComplete;
    expect(headCount(1)).toBe('4 / 9');
  });

  it('keeps a header while a member still matches the filter, and drops it when none do', async () => {
    const el = await mountAreas({ filterText: 'top shelf' });
    expect(headNames(el)).toEqual(['Area: Kitchen']);
    expect(ids(el)).toEqual(['fridge', 'top']);

    el.filterText = 'kitchen';
    await el.updateComplete;
    // The header names the area; the rows name locations. Only rows match.
    expect(headNames(el)).toEqual([]);
    expect(q(el, '[data-testid="tree-empty"]')).toBeTruthy();
  });

  it('reopens a collapsed group to reveal a location inside it', async () => {
    const el = await mountAreas();
    (
      el.shadowRoot?.querySelector(
        '[data-testid="tree-area-twisty"][data-area="area-kitchen"]',
      ) as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(ids(el)).not.toContain('fridge');

    el.revealPathTo('top');
    await el.updateComplete;
    expect(ids(el)).toContain('top');
  });

  it('never disables a header, whatever subtree the picker excludes', async () => {
    const el = await mountAreas({ excludeSubtreeOf: 'fridge' });
    expect(heads(el).some((h) => h.hasAttribute('disabled'))).toBe(false);
    expect(rows(el).find((r) => r.dataset.id === 'fridge')?.hasAttribute('disabled')).toBe(true);
  });

  it('tells assistive tech the header is a level above its members', async () => {
    const el = await mountAreas();
    expect(heads(el)[0].getAttribute('role')).toBe('treeitem');
    expect(heads(el)[0].getAttribute('aria-expanded')).toBe('true');
    expect(heads(el)[0].getAttribute('aria-level')).toBe('1');
    expect(rows(el)[0].getAttribute('aria-level')).toBe('2');
  });

  it('leaves an ungrouped tree at the top level for assistive tech', async () => {
    const el = await mount();
    expect(rows(el)[0].getAttribute('aria-level')).toBe('1');
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

import './hv-editor-location';
import { componentCss, mountComponent, q } from '../test.utils';
import type { HVEditorLocation } from './hv-editor-location';
import type { Location, LocationTreeNode } from '../store/types';

const garage: Location = {
  id: 'garage',
  name: 'Garage',
  parent_id: null,
  area_id: null,
  path: { id_path: ['garage'], name_path: ['Garage'], display_path: 'Garage', sort_key: 'garage' },
};

const tree: LocationTreeNode[] = [{ ...garage, direct_item_count: 0, subtree_item_count: 0, children: [] }];

/**
 * The field as the editor holds it: every `change` is written back as
 * `.value`, which is what the trigger names and the tree marks.
 */
async function mount(props: Partial<HVEditorLocation> = {}) {
  const { el } = await mountComponent<HVEditorLocation>('hv-editor-location', {
    locations: [garage],
    locationTree: tree,
    ...props,
  });
  const changes: { locationId: string | null }[] = [];
  el.addEventListener('change', (e) => {
    const detail = (e as CustomEvent<{ locationId: string | null }>).detail;
    changes.push(detail);
    el.value = detail.locationId;
  });
  return { el, changes };
}

const trigger = (el: HVEditorLocation) => q(el, '[data-testid="editor-location"]') as HTMLButtonElement;
const treeEl = (el: HVEditorLocation) => el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;

/** Type a name into the empty picker's create row and submit it. */
async function submitCreate(el: HVEditorLocation, name: string) {
  const opened = treeEl(el) as HTMLElement & { updateComplete: Promise<unknown> };
  (opened.shadowRoot?.querySelector('[data-testid="tree-create"]') as HTMLButtonElement).click();
  await opened.updateComplete;
  const input = opened.shadowRoot?.querySelector('[data-testid="tree-create-name"]') as HTMLInputElement;
  input.value = name;
  input.dispatchEvent(new Event('input'));
  await opened.updateComplete;
  (opened.shadowRoot?.querySelector('[data-testid="tree-create-submit"]') as HTMLButtonElement).click();
  for (let i = 0; i < 4; i += 1) await el.updateComplete;
}

describe('hv-editor-location', () => {
  it('names an empty location the way the editor reads it', async () => {
    const { el } = await mount();
    expect(trigger(el).textContent).toContain('No location');
  });

  it('picks a location from a tree inside the field, never a second dialog', async () => {
    const { el, changes } = await mount({ value: null });
    expect(q(el, '[data-testid="editor-location-tree"]')).toBe(null);

    trigger(el).click();
    await el.updateComplete;
    treeEl(el)
      .shadowRoot?.querySelector<HTMLButtonElement>('[data-testid="tree-row"][data-id="garage"]')
      ?.click();
    await el.updateComplete;

    expect(changes).toEqual([{ locationId: 'garage' }]);
    // Picked in place, and the tree closed again.
    expect(trigger(el).textContent).toContain('Garage');
    expect(treeEl(el)).toBeNull();
    expect(el.open).toBe(false);
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the button in reading order.
  it('names the holder the location field discloses, open or shut', async () => {
    const { el } = await mount();
    const id = 'editor-location-tree-holder';

    expect(trigger(el).getAttribute('aria-controls')).toBe(id);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
    // The id has to resolve in both states — a button pointing at nothing
    // announces as controlling nothing — so the holder outlives the tree in it.
    const shut = el.shadowRoot?.getElementById(id);
    expect(shut, 'holder shut').toBeTruthy();
    expect(shut?.querySelector('hv-location-tree'), 'no tree while shut').toBe(null);

    trigger(el).click();
    await el.updateComplete;

    expect(trigger(el).getAttribute('aria-expanded')).toBe('true');
    expect(trigger(el).getAttribute('aria-controls')).toBe(id);
    expect(el.shadowRoot?.getElementById(id)?.querySelector('hv-location-tree')).toBeTruthy();
  });

  // The modal had a dedicated Clear button next to the location field; here the
  // same job belongs to the tree's own clear row, and it has to reach the form
  // as a null rather than being quietly dropped.
  //
  // That row is called "All items" in the sidebar, where clearing the location
  // does show every item. In a picker it assigns one, so the same wording
  // promised a set of items and produced an empty field instead.
  it('puts an item back to no location at all', async () => {
    const { el, changes } = await mount({ value: 'garage' });

    trigger(el).click();
    await el.updateComplete;
    const clearRow = treeEl(el).shadowRoot?.querySelector('[data-testid="tree-all"]') as HTMLButtonElement;
    expect(clearRow.textContent).toContain('No location');
    expect(clearRow.textContent).not.toContain('All items');
    clearRow.click();
    await el.updateComplete;

    expect(trigger(el).textContent).toContain('No location');
    expect(changes).toEqual([{ locationId: null }]);
  });

  it('marks the area behind the chosen location, apart from the path itself', async () => {
    const { el } = await mount({
      value: 'garage',
      locations: [{ ...garage, area_id: 'area-kitchen' }],
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });
    expect(trigger(el).querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(trigger(el).querySelector('.value')?.textContent).toBe('Garage');
  });

  // Naming a root after the room it stands in is the ordinary thing a household
  // does, and the field then printed the same word twice with a chip's edge
  // between them. Same rule as the rows, the table cell and the sheet's crumb —
  // the picker elides too, and the pairing survives in the button's title.
  it('drops the area mark when the chosen path already opens with that name', async () => {
    const kitchen = { id: 'kitchen', name: 'Kitchen', parent_id: null, area_id: 'area-kitchen' };
    for (const path of ['Kitchen', 'Kitchen / Pantry']) {
      const { el } = await mount({
        value: 'kitchen',
        locations: [
          {
            ...kitchen,
            path: { id_path: ['kitchen'], name_path: [], display_path: path, sort_key: '' },
          },
        ],
        areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
      });
      const pretty = path.replace(' / ', ' › ');
      expect(trigger(el).querySelector('.hv-area-chip'), path).toBe(null);
      expect(trigger(el).querySelector('.value')?.textContent, path).toBe(pretty);
      expect(trigger(el).getAttribute('title'), path).toBe(`Area: Kitchen · ${pretty}`);
      el.remove();
    }
  });

  it('keeps the mark when the area only reappears further down the path', async () => {
    const { el } = await mount({
      value: 'kitchen',
      locations: [
        {
          id: 'kitchen',
          name: 'Kitchen',
          parent_id: null,
          area_id: 'area-kitchen',
          path: {
            id_path: ['kitchen'],
            name_path: [],
            display_path: 'Cellar / Kitchen',
            sort_key: '',
          },
        },
      ],
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });
    expect(trigger(el).querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(trigger(el).querySelector('.value')?.textContent).toBe('Cellar › Kitchen');
  });

  it('shows no area chip for a location in no area', async () => {
    const { el } = await mount({ value: 'garage', areas: [{ id: 'area-kitchen', name: 'Kitchen' }] });
    expect(trigger(el).querySelector('.hv-area-chip')).toBeNull();
    expect(trigger(el).querySelector('.value')?.textContent).toBe('Garage');
  });

  it('closes the picker, clears its error and puts focus back on the trigger', async () => {
    const { el } = await mount({
      createLocation: async () => {
        throw new Error('A location called Shed already exists');
      },
      locations: [],
      locationTree: [],
    });
    trigger(el).click();
    await el.updateComplete;
    expect(el.open).toBe(true);

    await submitCreate(el, 'Shed');
    expect(q(el, '[data-testid="editor-location-error"]')).toBeTruthy();

    el.close();
    await el.updateComplete;

    expect(el.open).toBe(false);
    expect(treeEl(el)).toBeNull();
    expect(q(el, '[data-testid="editor-location-error"]')).toBe(null);
    expect(el.shadowRoot?.activeElement).toBe(trigger(el));
  });

  it('gives the trigger a finger-sized height on a phone', async () => {
    expect(componentCss('hv-editor-location')).toMatch(
      /:host\(\[mobile\]\) \.hv-input,\s*:host\(\[mobile\]\) \.field-button \{[^}]*min-height: 48px/,
    );
  });
});

// The first minute of a fresh install: an item form whose most important field
// cannot be satisfied, and no way in sight to make it satisfiable.
describe('hv-editor-location: creating the first location from the picker', () => {
  const empty = { locationTree: [] as LocationTreeNode[], locations: [] as Location[] };

  const created: Location = {
    id: 'loc-new',
    name: 'Shed',
    parent_id: null,
    area_id: null,
    path: { id_path: ['loc-new'], name_path: ['Shed'], display_path: 'Shed', sort_key: 'shed' },
  };

  async function openTree(el: HVEditorLocation) {
    trigger(el).click();
    await el.updateComplete;
    const opened = treeEl(el) as HTMLElement & { updateComplete: Promise<unknown> };
    await opened.updateComplete;
    return opened;
  }

  it('offers no create affordance when the host cannot run the command', async () => {
    const { el } = await mount(empty);
    const opened = await openTree(el);

    expect(opened.shadowRoot?.querySelector('[data-testid="tree-empty"]')).toBeTruthy();
    expect(opened.shadowRoot?.querySelector('[data-testid="tree-create"]')).toBe(null);
  });

  it('creates the location and files the item in it', async () => {
    const names: string[] = [];
    const { el, changes } = await mount({
      ...empty,
      createLocation: async (name: string) => {
        names.push(name);
        return created;
      },
    });
    const leaked: Event[] = [];
    el.addEventListener('create-location', (e) => leaked.push(e));
    await openTree(el);
    await submitCreate(el, 'Shed');

    expect(names).toEqual(['Shed']);
    expect(leaked, "the tree's create request stops here").toEqual([]);
    expect(changes).toEqual([{ locationId: 'loc-new' }]);
    // Picked, and the picker closed behind it — the same shape as picking an
    // existing location.
    expect(treeEl(el)).toBeNull();
  });

  // The inline expander reaches this form through a template callback `hv-list`
  // re-invokes only when one of its own properties changes. A location create
  // changes none of them, so `locations` can stay empty for as long as the form
  // is open — and the field would name nothing it had just filled.
  it('names the location it created even when the host list never catches up', async () => {
    const { el } = await mount({ ...empty, createLocation: async () => created });
    await openTree(el);
    await submitCreate(el, 'Shed');

    expect(el.locations).toEqual([]);
    expect(trigger(el).textContent).toContain('Shed');
  });

  it('lists what it created when the picker is reopened', async () => {
    const { el } = await mount({ ...empty, createLocation: async () => created });
    await openTree(el);
    await submitCreate(el, 'Shed');
    const reopened = await openTree(el);

    // Still the empty state would offer to create the same name a second time.
    expect(reopened.shadowRoot?.querySelector('[data-testid="tree-empty"]')).toBe(null);
    expect(reopened.shadowRoot?.textContent).toContain('Shed');
  });

  it('does not double the row once the host list carries it too', async () => {
    const { el } = await mount({ ...empty, createLocation: async () => created });
    await openTree(el);
    await submitCreate(el, 'Shed');

    el.locations = [created];
    el.locationTree = [{ ...created, direct_item_count: 0, subtree_item_count: 0, children: [] }];
    await el.updateComplete;
    const reopened = await openTree(el);

    const rows = [...(reopened.shadowRoot?.querySelectorAll('[data-testid="tree-row"]') ?? [])];
    expect(rows.filter((r) => r.textContent?.includes('Shed'))).toHaveLength(1);
  });

  it('reports a refused name against the field instead of swallowing it', async () => {
    const { el, changes } = await mount({
      ...empty,
      createLocation: async () => {
        throw new Error('A location called Shed already exists');
      },
    });
    await openTree(el);
    await submitCreate(el, 'Shed');

    expect(q(el, '[data-testid="editor-location-error"]')?.textContent).toContain('already exists');
    expect(changes).toEqual([]);
    // The picker stays open so the name can be corrected where it was typed.
    expect(treeEl(el)).toBeTruthy();
  });
});

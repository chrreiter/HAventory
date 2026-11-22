/**
 * The Locations tab of the organize dialog, mounted on its own: the managed
 * tree, the editor, the area consequence, merge, the delete guard and the id
 * an automation names. How the dialog hosts the tab is `hv-organize-dialog.test.ts`.
 */
import './hv-organize-locations';
import { componentCss, defined, makeItem, mountHost, q, settle, stubClipboard } from '../test.utils';
import type { ClipboardStub } from '../test.utils';
import type { HVOrganizeLocations } from './hv-organize-locations';
import type { AreaRef, Item, Location } from '../store/types';

function loc(id: string, name: string, parentId: string | null = null, areaId: string | null = null): Location {
  const display = parentId ? `${parentId} / ${name}` : name;
  return {
    id,
    name,
    parent_id: parentId,
    area_id: areaId,
    path: {
      id_path: parentId ? [parentId, id] : [id],
      name_path: parentId ? [parentId, name] : [name],
      display_path: display,
      sort_key: display.toLowerCase(),
    },
  };
}

/** The registry every area-facing test picks from; empty is its own case. */
const AREAS = [
  { id: 'area-garage', name: 'Garage area' },
  { id: 'area-kitchen', name: 'Kitchen' },
];

async function mount(
  opts: { items?: Item[]; locations?: Location[]; areas?: AreaRef[]; mobile?: boolean } = {},
) {
  return mountHost<HVOrganizeLocations>(
    'hv-organize-locations',
    {
      items: opts.items ?? [],
      locations: opts.locations ?? [],
      areas: opts.areas ?? AREAS,
    },
    { mobile: opts.mobile ?? false },
    { renders: 2 },
  );
}

/** jsdom lays out no shadow DOM, so geometry is asserted on the stylesheet. */
const locationsCss = () => {
  return componentCss('hv-organize-locations');
};

describe('hv-organize-locations: locations', () => {
  const locations = [loc('garage', 'Garage', null, 'area-garage'), loc('shelf-a', 'Shelf A', 'garage')];

  it('lists the tree with counts and area chips', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    // The count names its unit here, exactly as the category and tag rows do.
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-count"]')?.textContent?.trim()).toBe('1 item');
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-edit"]')).toBeTruthy();
  });

  it('edits a location in place and saves name, area and parent in one call', async () => {
    const { el, store, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    const editor = q(sr, '[data-testid="location-editor"]') as HTMLElement;
    expect(editor).toBeTruthy();
    const name = q(sr, '[data-testid="location-name"]') as HTMLInputElement;
    expect(name.value).toBe('Garage');
    name.value = 'Big Garage';
    name.dispatchEvent(new Event('input'));

    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.locationsFlatCache?.find((l) => l.id === 'garage')?.name).toBe('Big Garage');
    expect(q(sr, '[data-testid="location-editor"]')).toBe(null);
  });

  // Categories and tags each printed "N categories" above their list; locations
  // was the one tab that stated no total at all.
  it('states how many locations there are, counting every depth', async () => {
    const { sr } = await mount({ locations });
    expect(q(sr, '[data-testid="organize-location-count"]')?.textContent?.trim()).toBe('2 locations');
  });

  it('counts against the filter, like the value tabs do', async () => {
    const { el, sr } = await mount({ locations });
    const filter = q(sr, '[data-testid="organize-filter"]') as HTMLInputElement;
    filter.value = 'shelf';
    filter.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="organize-location-count"]')?.textContent?.trim()).toBe('1 location');
  });

  it('refuses to save a location with no name', async () => {
    const { el, sr } = await mount({ locations });
    (q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="location-error"]')?.textContent).toContain('needs a name');
  });

  it('creates a new location from the toolbar', async () => {
    const { el, store, sr } = await mount({ locations });
    (q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement).click();
    await settle(el);

    const name = q(sr, '[data-testid="location-name"]') as HTMLInputElement;
    name.value = 'Attic';
    name.dispatchEvent(new Event('input'));
    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.locationsFlatCache?.some((l) => l.name === 'Attic')).toBe(true);
  });

  // The area dropdown's empty value has to say what it does. The backend keeps a tree's
  // area on the tree root and resolves it downwards, so a nested location inherits from
  // the tree rather than from the parent named in the picker below it, and a top-level
  // location has nothing above it to inherit from at all.
  describe('area default option', () => {
    const areaDefault = (sr: ShadowRoot) =>
      (q(sr, '[data-testid="location-area"]') as HTMLSelectElement).options[0]?.textContent?.trim();

    it('reads as "No area" for a new location, which starts at the top level', async () => {
      const { el, sr } = await mount({ locations });
      (q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement).click();
      await settle(el);

      expect(areaDefault(sr)).toBe('No area');
    });

    it('reads as "No area" when editing a location that has no parent', async () => {
      const { el, sr } = await mount({ locations });
      const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
      (
        tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
      ).click();
      await settle(el);

      expect(areaDefault(sr)).toBe('No area');
    });

    it('names the location tree, not the immediate parent, once there is a parent', async () => {
      const { el, sr } = await mount({ locations });
      const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
      (
        tree.shadowRoot?.querySelector(
          '[data-testid="tree-row"][data-id="garage"] [data-testid="tree-twisty"]',
        ) as HTMLButtonElement
      ).click();
      await settle(el);
      (
        tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="shelf-a"]') as HTMLButtonElement
      ).click();
      await settle(el);

      expect(areaDefault(sr)).toBe('Inherit from location tree');
    });
  });

  // The select reads like a per-location field and is not one: the backend keeps a
  // tree's area on its root, so saving one rewrites every location in the tree —
  // including the ones the editor does not show.
  describe('area change preview', () => {
    const previewText = (sr: ShadowRoot) =>
      q(sr, '[data-testid="location-area-preview"]')?.textContent?.replace(/\s+/g, ' ').trim();

    async function editLocation(id: 'garage' | 'shelf-a', opts: { areas?: AreaRef[] } = {}) {
      const ctx = await mount({ locations, areas: opts.areas });
      const tree = q(ctx.sr, '[data-testid="organize-tree"]') as HTMLElement;
      if (id === 'shelf-a') {
        // The tree opens collapsed, so Shelf A is only reachable under Garage.
        (
          tree.shadowRoot?.querySelector(
            '[data-testid="tree-row"][data-id="garage"] [data-testid="tree-twisty"]',
          ) as HTMLButtonElement
        ).click();
        await settle(ctx.el);
      }
      (
        tree.shadowRoot?.querySelector(`[data-testid="tree-edit"][data-id="${id}"]`) as HTMLButtonElement
      ).click();
      await settle(ctx.el);
      return ctx;
    }

    async function pickArea(el: HVOrganizeLocations, sr: ShadowRoot, areaId: string) {
      const select = q(sr, '[data-testid="location-area"]') as HTMLSelectElement;
      select.value = areaId;
      select.dispatchEvent(new Event('change'));
      await settle(el);
    }

    // The Parent location picker below it draws the card's chevron, so the
    // select beside it draws the same one instead of the browser's arrow.
    it('draws the card chevron on the area select', async () => {
      const { sr } = await editLocation('shelf-a');
      const select = q(sr, '[data-testid="location-area"]') as HTMLSelectElement;

      expect(select.parentElement?.classList.contains('hv-select')).toBe(true);
      expect(
        select.parentElement?.querySelector(':scope > .chevron > svg[data-icon="chevronDown"]'),
      ).toBeTruthy();
    });

    it('says an area picked on a nested location lands on the tree root', async () => {
      const { el, sr } = await editLocation('shelf-a');
      await pickArea(el, sr, 'area-kitchen');

      const text = previewText(sr);
      expect(text).toContain('Kitchen');
      expect(text).toContain('the whole Garage tree, 2 locations');
      expect(text).toContain('stored on Garage, not on this one');
      // The area name gets the same chip every other surface prints it in.
      expect(q(sr, '[data-testid="location-area-preview"]')?.querySelector('.hv-area-chip')).toBeTruthy();
    });

    it('says clearing the area empties the whole tree, and updates as the select changes', async () => {
      const { el, sr } = await editLocation('garage');
      expect(previewText(sr)).toBeUndefined();

      await pickArea(el, sr, 'area-kitchen');
      expect(previewText(sr)).toContain('Assigns');

      await pickArea(el, sr, '');
      expect(previewText(sr)).toBe('Removes the area from the whole Garage tree, 2 locations.');
    });

    it('drops the tree wording for a location that is a tree of one', async () => {
      const { el, sr } = await mount({ locations: [loc('attic', 'Attic')] });
      const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
      (
        tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="attic"]') as HTMLButtonElement
      ).click();
      await settle(el);
      await pickArea(el, sr, 'area-kitchen');

      expect(previewText(sr)).toBe('Assigns Area: Kitchen to this location.');
    });

    it('names the area a nested location inherits, which the select cannot show', async () => {
      // "Inherit from location tree" says where the area comes from but never what it is.
      const { sr } = await editLocation('shelf-a');
      expect(previewText(sr)).toBe('Inherits Area: Garage area from its location tree.');
    });

    it('stays quiet for a selection that changes nothing on save', async () => {
      const { sr } = await editLocation('garage');
      expect(q(sr, '[data-testid="location-area-preview"]')).toBe(null);
    });

    it('hides the area field altogether when Home Assistant defines no areas', async () => {
      const { sr } = await editLocation('garage', { areas: [] });
      expect(q(sr, '[data-testid="location-area"]')).toBe(null);
      expect(q(sr, '[data-testid="location-area-preview"]')).toBe(null);
      // With nothing beside it, the name field takes the row rather than half of it.
      expect(q(sr, '[data-testid="location-name"]')?.parentElement?.classList.contains('wide')).toBe(true);
    });
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the picker in reading order.
  it('names the holder each location picker discloses, open or shut', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { el, sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    for (const [action, picker, holderId] of [
      ['tree-edit', 'location-parent', 'location-parent-tree-holder'],
      ['tree-merge', 'merge-target', 'merge-target-tree-holder'],
    ]) {
      const id = defined(holderId, 'holder id');
      (
        tree.shadowRoot?.querySelector(`[data-testid="${action}"][data-id="garage"]`) as HTMLButtonElement
      ).click();
      await settle(el);
      const control = () => q(sr, `[data-testid="${picker}"]`) as HTMLButtonElement;

      expect(control().getAttribute('aria-controls'), picker).toBe(id);
      expect(control().getAttribute('aria-expanded'), picker).toBe('false');
      // The id has to resolve in both states — a picker pointing at nothing
      // announces as controlling nothing — so the holder outlives the tree.
      const shut = sr.getElementById(id);
      expect(shut, `${picker} shut`).toBeTruthy();
      expect(shut?.querySelector('hv-location-tree'), `${picker}: no tree while shut`).toBe(null);

      control().click();
      await settle(el);

      expect(control().getAttribute('aria-expanded'), picker).toBe('true');
      expect(control().getAttribute('aria-controls'), picker).toBe(id);
      expect(sr.getElementById(id)?.querySelector('hv-location-tree'), `${picker} open`).toBeTruthy();
      // The tree opens under the control, or under the row holding it — never
      // as another item inside that row: the merge row is a flex line carrying
      // the source, the arrow and the target, and a 200px box would join it.
      const holder = sr.getElementById(id) as HTMLElement;
      const after = control().parentElement === holder.parentElement ? control() : control().parentElement;
      expect(holder.previousElementSibling, `${picker} placement`).toBe(after);
    }
  });

  it('excludes the location itself from its own parent picker, so no cycle is possible', async () => {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    (q(sr, '[data-testid="location-parent"]') as HTMLButtonElement).click();
    await settle(el);

    const picker = q(sr, '[data-testid="location-parent-tree"]') as HTMLElement;
    const disabled = [...(picker.shadowRoot?.querySelectorAll('[data-testid="tree-row"][disabled]') ?? [])].map(
      (r) => (r as HTMLElement).dataset.id,
    );
    expect(disabled).toContain('garage');
  });

  // Re-parenting rides along with the rename in one `location/update`. The two
  // halves that matter — send the move only when the parent really changed, and
  // send an explicit null for "top level" — were asserted only by the POC's
  // location selector, which spoke to the host in `update-location` events.
  describe('re-parenting', () => {
    const tree = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage'), loc('attic', 'Attic')];

    async function editShelfA() {
      const ctx = await mount({ locations: tree });
      const calls: { id: string; changes: Record<string, unknown> }[] = [];
      const real = ctx.store.updateLocation.bind(ctx.store);
      ctx.store.updateLocation = (id, changes) => {
        calls.push({ id, changes });
        return real(id, changes);
      };

      // The tree opens collapsed, so Shelf A is only reachable under Garage.
      const treeEl = q(ctx.sr, '[data-testid="organize-tree"]') as HTMLElement;
      (
        treeEl.shadowRoot?.querySelector(
          '[data-testid="tree-row"][data-id="garage"] [data-testid="tree-twisty"]',
        ) as HTMLButtonElement
      ).click();
      await settle(ctx.el);
      (
        treeEl.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="shelf-a"]') as HTMLButtonElement
      ).click();
      await settle(ctx.el);
      return { ...ctx, calls };
    }

    async function pickParent(el: HVOrganizeLocations, sr: ShadowRoot, testid: string) {
      (q(sr, '[data-testid="location-parent"]') as HTMLButtonElement).click();
      await settle(el);
      const picker = q(sr, '[data-testid="location-parent-tree"]') as HTMLElement;
      (picker.shadowRoot?.querySelector(testid) as HTMLButtonElement).click();
      await settle(el);
    }

    it('leaves the parent out of a rename that did not move anything', async () => {
      const { el, sr, calls } = await editShelfA();
      const name = q(sr, '[data-testid="location-name"]') as HTMLInputElement;
      name.value = 'Shelf B';
      name.dispatchEvent(new Event('input'));

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.changes.name).toBe('Shelf B');
      expect('newParentId' in defined(calls[0], 'first call').changes).toBe(false);
    });

    it('moves the subtree when a different parent is picked', async () => {
      const { el, sr, calls } = await editShelfA();
      await pickParent(el, sr, '[data-testid="tree-row"][data-id="attic"]');

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls[0]?.changes.newParentId).toBe('attic');
    });

    it('sends an explicit null when the location is moved to the top level', async () => {
      const { el, sr, calls } = await editShelfA();
      await pickParent(el, sr, '[data-testid="tree-all"]');

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls[0]?.changes.newParentId).toBeNull();
    });
  });

  // An area heads the top level rather than sitting anywhere in the tree, so
  // moving a subtree into one is both halves at once: out to the top level, and
  // into that area. The picker is where both are said in one gesture.
  describe('filing a subtree under an area', () => {
    const tree = [loc('garage', 'Garage', null, 'area-garage'), loc('shelf-a', 'Shelf A', 'garage')];

    async function openParentPicker() {
      const ctx = await mount({ locations: tree });
      const calls: { id: string; changes: Record<string, unknown> }[] = [];
      const real = ctx.store.updateLocation.bind(ctx.store);
      ctx.store.updateLocation = (id, changes) => {
        calls.push({ id, changes });
        return real(id, changes);
      };

      const treeEl = q(ctx.sr, '[data-testid="organize-tree"]') as HTMLElement;
      (
        treeEl.shadowRoot?.querySelector(
          '[data-testid="tree-row"][data-id="garage"] [data-testid="tree-twisty"]',
        ) as HTMLButtonElement
      ).click();
      await settle(ctx.el);
      (
        treeEl.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="shelf-a"]') as HTMLButtonElement
      ).click();
      await settle(ctx.el);
      (q(ctx.sr, '[data-testid="location-parent"]') as HTMLButtonElement).click();
      await settle(ctx.el);
      const picker = q(ctx.sr, '[data-testid="location-parent-tree"]') as HTMLElement;
      return { ...ctx, calls, picker };
    }

    it('offers every area, including the one nothing is filed under yet', async () => {
      const { picker } = await openParentPicker();
      const offered = [...(picker.shadowRoot?.querySelectorAll('[data-testid="tree-area-select"]') ?? [])].map(
        (b) => (b as HTMLElement).dataset.area,
      );
      expect(offered).toEqual(['area-garage', 'area-kitchen']);
    });

    it('moves the subtree to the top level of the area picked, in one save', async () => {
      const { el, sr, picker, calls } = await openParentPicker();
      (
        picker.shadowRoot?.querySelector(
          '[data-testid="tree-area-select"][data-area="area-kitchen"]',
        ) as HTMLButtonElement
      ).click();
      await settle(el);

      // Both halves of the move, on both controls that state them.
      expect(q(sr, '[data-testid="location-parent"]')?.textContent).toContain('Top level · Kitchen');
      expect((q(sr, '[data-testid="location-area"]') as HTMLSelectElement).value).toBe('area-kitchen');
      expect(q(sr, '[data-testid="location-area-preview"]')?.textContent).toContain('Kitchen');

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls[0]?.changes.newParentId).toBeNull();
      expect(calls[0]?.changes.areaId).toBe('area-kitchen');
    });
  });

  it('guards a delete with an inline explanation, never a browser confirm', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { el, store, sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (
      tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    const guard = q(sr, '[data-testid="location-guard"]');
    expect(guard?.textContent).toContain('still contains');
    expect(guard?.textContent).toContain('1 item');
    expect(guard?.textContent).toContain('1 sub-location');
    // Nothing was deleted.
    expect(store.state.value.locationsFlatCache).toHaveLength(2);
  });

  // The mark sat on `.glyph`, the icon-picker button's class, so a span that
  // does nothing rendered as a 30×26 bordered box under a pointer cursor.
  it('inks the guard mark with warn and gives it nothing a button carries', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { el, sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (
      tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    const guard = q(sr, '[data-testid="location-guard"]');
    expect(guard?.querySelector('.guard-mark')).not.toBe(null);
    expect(guard?.querySelector('.glyph')).toBe(null);

    const css = locationsCss();
    expect(css).toMatch(/\.guard-mark \{[^}]*color: var\(--hv-warn\)/);
    expect(css).toMatch(/\.guard-mark \{[^}]*flex: none/);
  });

  it('deletes an empty location without a guard', async () => {
    const { el, store, sr } = await mount({ locations: [loc('spare', 'Spare')] });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (
      tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="spare"]') as HTMLButtonElement
    ).click();
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="location-guard"]')).toBe(null);
    expect(store.state.value.locationsFlatCache).toHaveLength(0);
  });

  // Every row in Organize opens the items behind it the same way, so a
  // location row is not the odd one out: a name that does nothing beside a
  // category row whose count is the way in.
  it('opens the items behind a location from its name or its count', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    for (const testid of ['tree-row', 'tree-count']) {
      const { el, store, sr } = await mount({ items, locations });
      const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
      let browsed = 0;
      el.addEventListener('browse', () => {
        browsed += 1;
      });

      (
        tree.shadowRoot?.querySelector(`[data-testid="${testid}"][data-id="garage"]`) as HTMLButtonElement
      ).click();
      await settle(el);

      expect(store.state.value.filters.locationIds, testid).toEqual(['garage']);
      // Organizing happens full-screen; so should the list it hands back.
      expect(browsed, testid).toBe(1);
      el.remove();
    }
  });

  // Touch has no hover, so the row's icons would be unreachable — the value rows
  // already solved this with a ⋮ and a sheet.
  it('puts a location’s actions in a sheet on touch, like the value rows', async () => {
    const items = [makeItem({ id: '1', location_id: 'garage' })];
    const { el, sr } = await mount({ items, locations, mobile: true });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-edit"]')).toBe(null);

    (
      tree.shadowRoot?.querySelector('[data-testid="tree-more"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    const sheet = q(sr, '[data-testid="location-sheet"]') as HTMLElement;
    expect(sheet.querySelector('[data-testid="location-sheet-show"]')?.textContent).toContain('Show 1 item');
    (sheet.querySelector('[data-testid="location-sheet-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-merge"]')).toBeTruthy();
    expect(q(sr, '[data-testid="location-sheet"]')).toBe(null);
  });

  it('merges a location: items move, children re-parent, the husk is deleted', async () => {
    const items = [makeItem({ id: '1', location_id: 'garage' }), makeItem({ id: '2', location_id: 'garage' })];
    const { el, store, sr } = await mount({
      items,
      locations: [...locations, loc('workshop', 'Workshop')],
    });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (
      tree.shadowRoot?.querySelector('[data-testid="tree-merge"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);
    expect(q(sr, '[data-testid="merge-effect"]')?.textContent).toContain('Pick a location');
    // The one row in that picker a merge cannot land on, and why.
    expect(q(sr, '[data-testid="merge-effect"]')?.textContent).toContain('hold no items themselves');

    (q(sr, '[data-testid="merge-target"]') as HTMLButtonElement).click();
    await settle(el);
    const picker = q(sr, '[data-testid="merge-target-tree"]') as HTMLElement;
    // The target cannot be inside what is being merged away — neither the
    // location itself nor anything under it.
    const disabled = () =>
      [...(picker.shadowRoot?.querySelectorAll('[data-testid="tree-row"][disabled]') ?? [])].map(
        (r) => (r as HTMLElement).dataset.id,
      );
    expect(disabled()).toContain('garage');
    (picker.shadowRoot?.querySelector('[data-testid="tree-twisty"]') as HTMLButtonElement).click();
    await settle(el);
    expect(disabled()).toEqual(expect.arrayContaining(['garage', 'shelf-a']));

    (
      picker.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="workshop"]') as HTMLButtonElement
    ).click();
    await settle(el);
    expect(q(sr, '[data-testid="merge-effect"]')?.textContent).toContain('2 items and 1 sub-location');

    (q(sr, '[data-testid="merge-apply"]') as HTMLButtonElement).click();
    for (let i = 0; i < 6; i += 1) await settle(el);

    expect(store.state.value.items.every((i) => i.location_id === 'workshop')).toBe(true);
    expect(store.state.value.locationsFlatCache?.find((l) => l.id === 'shelf-a')?.parent_id).toBe('workshop');
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === 'garage')).toBe(false);
    expect(q(sr, '[data-testid="rewrite-label"]')?.textContent?.trim()).toBe('Merged 2 items');
  });

  it('keeps the location when its items could not all be moved', async () => {
    const items = [makeItem({ id: '1', location_id: 'garage' })];
    const { el, store, sr } = await mount({
      items,
      locations: [...locations, loc('workshop', 'Workshop')],
    });
    // The batch reports per-operation failures rather than throwing.
    store.bulkExecute = async () => ({
      succeeded: [],
      failed: [
        {
          op: { op_id: 'x', kind: 'item_move', payload: { item_id: '1' } },
          error: { code: 'conflict', message: 'stale' },
          itemId: '1',
        },
      ],
      cancelled: false,
    });

    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-merge"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);
    (q(sr, '[data-testid="merge-target"]') as HTMLButtonElement).click();
    await settle(el);
    const picker = q(sr, '[data-testid="merge-target-tree"]') as HTMLElement;
    (
      picker.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="workshop"]') as HTMLButtonElement
    ).click();
    await settle(el);
    (q(sr, '[data-testid="merge-apply"]') as HTMLButtonElement).click();
    for (let i = 0; i < 4; i += 1) await settle(el);

    // Deleting it would have failed anyway — say why instead.
    expect(store.state.value.locationsFlatCache?.some((l) => l.id === 'garage')).toBe(true);
    expect(q(sr, '[data-testid="rewrite-error"]')?.textContent).toContain('was kept');
  });
});

// Every disclosure renders after the row that opened it, inside a `.body` that
// scrolls, so one opened from a row near the bottom lands below the fold and
// the tap reads as having done nothing.
describe('hv-organize-locations: disclosures come into view', () => {
  const locations = [loc('garage', 'Garage', null, 'area-garage'), loc('shelf-a', 'Shelf A', 'garage')];
  const items = [
    makeItem({ id: '1', location_id: 'shelf-a', tags: ['battery'], category: 'Tools' }),
    makeItem({ id: '2', tags: ['aa'], category: 'Consumables', status: 'missing' }),
  ];

  // jsdom performs no layout and implements no `scrollIntoView`, so these pin
  // the call and its options; whether the element ends up visible is a live
  // check.
  type Scrollable = { scrollIntoView?: (options?: unknown) => void };
  let scrolls: { el: Element; options: unknown }[] = [];
  beforeEach(() => {
    scrolls = [];
    (Element.prototype as Scrollable).scrollIntoView = function (this: Element, options?: unknown) {
      scrolls.push({ el: this, options });
    };
  });
  afterEach(() => {
    delete (Element.prototype as Scrollable).scrollIntoView;
    document.body.innerHTML = '';
  });

  const scrolled = () => scrolls.map((s) => s.el);

  // This one renders after the whole tree rather than beside its row, so it is
  // below the fold for any tree taller than the panel.
  it('brings the location delete guard into view', async () => {
    const { el, sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="location-guard"]')]);
    expect(q(sr, '[data-testid="location-guard"]')?.contains(sr.activeElement)).toBe(false);
  });

  it('brings the location editor into view and puts the caret in its name field', async () => {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="location-editor"]')]);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="location-name"]'));
  });

  // The pane must not jump while the household is typing in the form it just
  // opened, nor when anything else re-renders the tab.
  it('scrolls once per open, not on the re-renders that follow', async () => {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);
    expect(scrolls).toHaveLength(1);

    const name = q(sr, '[data-testid="location-name"]') as HTMLInputElement;
    name.value = 'Big Garage';
    name.dispatchEvent(new Event('input'));
    await settle(el);

    el.requestUpdate();
    await settle(el);

    expect(scrolls).toHaveLength(1);
  });

  it('scrolls again when a second row opens the same kind of disclosure', async () => {
    const { el, sr } = await mount({ locations: [loc('garage', 'Garage'), loc('attic', 'Attic')] });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="attic"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]?.el).toBe(q(sr, '[data-testid="location-editor"]'));
  });

  // On a phone the ⋮ sheet replaces the row's separate buttons, so it is the
  // only way into edit, merge and delete — and opened from a row near the
  // bottom it stands almost entirely off screen unless it is scrolled to.
  it('brings the location ⋮ sheet into view', async () => {
    const { el, sr } = await mount({ items, locations, mobile: true });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-more"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="location-sheet"]')]);
    expect(scrolls[0]?.options).toEqual({ block: 'nearest' });
    // A menu of what the row can do, not a form: it claims no field, so the
    // caret stays where the tap left it.
    expect(q(sr, '[data-testid="location-sheet"]')?.contains(sr.activeElement)).toBe(false);
  });

  // The sheet closes as the editor it launched opens, and it is the editor the
  // household is now looking at.
  it('follows the ⋮ sheet to the editor it opens', async () => {
    const { el, sr } = await mount({ items, locations, mobile: true });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-more"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);
    (q(sr, '[data-testid="location-sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-sheet"]')).toBe(null);
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]?.el).toBe(q(sr, '[data-testid="location-editor"]'));
    expect(sr.activeElement).toBe(q(sr, '[data-testid="location-name"]'));
  });
});

describe('hv-organize-locations: the id an automation names', () => {
  const locations = [loc('garage', 'Garage', null, 'area-garage'), loc('shelf-a', 'Shelf A', 'garage')];
  let clipboard: ClipboardStub;

  /** Open the editor over an existing location, the way the tree's ✎ does. */
  async function editing(id: string) {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector(`[data-testid="tree-edit"][data-id="${id}"]`) as HTMLButtonElement).click();
    await settle(el);
    return { el, sr };
  }

  beforeEach(() => {
    clipboard = stubClipboard();
  });

  afterEach(() => clipboard());

  // What raising the label takes and how it goes away are `CopyFlash`'s own
  // spec in `ui/clipboard.test.ts`. What the tab owes is the wiring: the id
  // of the location under edit goes in, the label comes back off the
  // controller, and the next open of the editor takes it back.
  it('shows a location its id, copies it, and forgets it on the next open', async () => {
    const { el, sr } = await editing('garage');
    expect(q(sr, '[data-testid="location-id"]')?.textContent?.trim()).toBe('garage');

    const button = q<HTMLButtonElement>(sr, '[data-testid="location-copy-id"]')!;
    expect(button.textContent?.trim()).toBe('Copy');
    button.click();
    await settle(el);

    expect(clipboard.writes).toEqual(['garage']);
    expect(q(sr, '[data-testid="location-copy-id"]')?.textContent?.trim()).toBe('Copied');

    (q(sr, '[data-testid="location-cancel"]') as HTMLButtonElement).click();
    await settle(el);
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-copy-id"]')?.textContent?.trim()).toBe('Copy');
  });

  it('offers no id on the editor for a location that does not exist yet', async () => {
    const { el, sr } = await mount({ locations });
    (q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-editor"]')).toBeTruthy();
    expect(q(sr, '[data-testid="location-id"]')).toBe(null);
    expect(q(sr, '[data-testid="location-copy-id"]')).toBe(null);
  });
});

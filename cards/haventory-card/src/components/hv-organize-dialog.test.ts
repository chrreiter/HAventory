import { setLanguage } from '../i18n';
import './hv-organize-dialog';
import { all, componentCss, defined, makeItem, mountHost, q, settle, stubClipboard } from '../test.utils';
import type { ClipboardStub } from '../test.utils';
import { HVOrganizeDialog } from './hv-organize-dialog';
import type { OrganizeTab } from './hv-organize-dialog';
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
  opts: {
    items?: Item[];
    locations?: Location[];
    areas?: AreaRef[];
    tab?: OrganizeTab;
    mobile?: boolean;
  } = {},
) {
  return mountHost<HVOrganizeDialog>(
    'hv-organize-dialog',
    {
      items: opts.items ?? [],
      locations: opts.locations ?? [],
      areas: opts.areas ?? AREAS,
    },
    { tab: opts.tab ?? 'locations', mobile: opts.mobile ?? false, open: true },
    { renders: 2 },
  );
}

/** jsdom lays out no shadow DOM, so geometry is asserted on the stylesheet. */
const dialogCss = () => {
  return componentCss('hv-organize-dialog');
};

describe('hv-organize-dialog: shell', () => {
  it('renders nothing when closed', async () => {
    const { el, sr } = await mount();
    el.open = false;
    await el.updateComplete;
    expect(q(sr, '[data-testid="organize-dialog"]')).toBe(null);
  });

  it('replaces four separate browsers with one tabbed dialog', async () => {
    const { sr } = await mount();
    expect(all(sr, '[data-testid="organize-tab"]').map((t) => t.dataset.tab)).toEqual([
      'locations',
      'categories',
      'tags',
      'statuses',
    ]);
  });

  it('switches tabs and resets the filter with them', async () => {
    const { el, sr } = await mount();
    const filter = q(sr, '[data-testid="organize-filter"]') as HTMLInputElement;
    filter.value = 'gar';
    filter.dispatchEvent(new Event('input'));
    await settle(el);

    (q(sr, '[data-tab="tags"]') as HTMLButtonElement).click();
    await settle(el);
    expect(el.tab).toBe('tags');
    expect((q(sr, '[data-testid="organize-filter"]') as HTMLInputElement).value).toBe('');
  });

  it('closes from the ✕, the backdrop and Escape', async () => {
    for (const trigger of ['close', 'backdrop', 'escape'] as const) {
      const { el, sr } = await mount();
      let cancels = 0;
      el.addEventListener('cancel', () => {
        cancels += 1;
      });

      if (trigger === 'close') (q(sr, '[data-testid="organize-close"]') as HTMLButtonElement).click();
      else if (trigger === 'backdrop') (q(sr, '.backdrop') as HTMLElement).click();
      else
        (q(sr, '[data-testid="organize-dialog"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

      expect(cancels, trigger).toBe(1);
      el.remove();
    }
  });

  it('is a full-bleed page with a back arrow on mobile', async () => {
    const { sr } = await mount({ mobile: true });
    expect(q(sr, '[data-testid="organize-back"]')).toBeTruthy();
    expect(q(sr, '[data-testid="organize-close"]')).toBe(null);
  });

  // The surface answered to three names — "Organize…" in the menu, "Organize
  // inventory" on a wide screen and "Organize" on a narrow one — so the heading
  // never confirmed which thing the menu entry had opened.
  it('calls itself Organize at every width', async () => {
    for (const mobile of [false, true]) {
      const { el, sr } = await mount({ mobile });
      expect(q(sr, 'h2')?.textContent?.trim(), `mobile=${mobile}`).toBe('Organize');
      expect(q(sr, '[data-testid="organize-dialog"]')?.getAttribute('aria-label')).toBe('Organize');
      el.remove();
    }
  });
});

describe('hv-organize-dialog: locations', () => {
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

  it('gives the create action the primary treatment', async () => {
    const { sr } = await mount({ locations });
    const button = q(sr, '[data-testid="organize-new-location"]') as HTMLButtonElement;
    // Outlined, it reads as secondary next to the filter box and gets missed.
    expect(button.classList.contains('hv-pill')).toBe(true);
    expect(button.classList.contains('outline')).toBe(false);
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

    async function pickArea(el: HVOrganizeDialog, sr: ShadowRoot, areaId: string) {
      const select = q(sr, '[data-testid="location-area"]') as HTMLSelectElement;
      select.value = areaId;
      select.dispatchEvent(new Event('change'));
      await settle(el);
    }

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

    async function pickParent(el: HVOrganizeDialog, sr: ShadowRoot, testid: string) {
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

    it('calls the row that clears the parent what it does in a parent picker', async () => {
      const { picker } = await openParentPicker();
      expect(picker.shadowRoot?.querySelector('[data-testid="tree-all"]')?.textContent?.trim()).toContain(
        'Top level',
      );
    });
  });

  it('drops a failed save off the screen when the dialog is reopened', async () => {
    const { el, store, sr } = await mount({ locations });
    store.updateLocation = () => Promise.reject(new Error('Location is busy'));

    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement
    ).click();
    await settle(el);
    (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-error"]')?.textContent).toContain('Location is busy');

    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect(q(sr, '[data-testid="location-error"]')).toBe(null);
    expect(q(sr, '[data-testid="location-editor"]')).toBe(null);
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

    const css = dialogCss();
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

  // Every row in this dialog opens the items behind it the same way, so a
  // location row is not the odd one out: a name that does nothing beside a
  // category row whose count is the way in.
  it('opens the items behind a location from its name or its count', async () => {
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    for (const testid of ['tree-row', 'tree-count']) {
      const { el, store, sr } = await mount({ items, locations });
      const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
      let browsed = 0;
      let dismissed = 0;
      el.addEventListener('browse', () => {
        browsed += 1;
      });
      el.addEventListener('cancel', () => {
        dismissed += 1;
      });

      (
        tree.shadowRoot?.querySelector(`[data-testid="${testid}"][data-id="garage"]`) as HTMLButtonElement
      ).click();
      await settle(el);

      expect(store.state.value.filters.locationIds, testid).toEqual(['garage']);
      // Organizing happens full-screen; so should the list it hands back.
      expect(browsed, testid).toBe(1);
      expect(dismissed, testid).toBe(1);
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

describe('hv-organize-dialog: tags and categories', () => {
  const items = [
    makeItem({ id: '1', tags: ['battery', 'aa'], category: 'Consumables' }),
    makeItem({ id: '2', tags: ['batery'], category: 'Tools' }),
    makeItem({ id: '3', tags: ['batery'], category: 'Tools' }),
  ];

  it('lists values with counts, and links the count to the filtered list', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const rows = all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value);
    expect(rows).toEqual(['aa', 'batery', 'battery']);
    let dismissed = 0;
    el.addEventListener('cancel', () => {
      dismissed += 1;
    });

    (all(sr, '[data-testid="value-count"]')[1] as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.filters.tags).toEqual(['batery']);
    expect(dismissed).toBe(1);
  });

  // Two tabs of the same shape, so the chip has to say which facet is on
  // screen — the tab strip is at the top of the dialog, the rows are not.
  it('chips a tag as a tag and a category as a category', async () => {
    const tags = await mount({ items, tab: 'tags' });
    const tagChip = q(tags.sr, '[data-testid="value-row"] .hv-chip')!;
    expect(tagChip.classList.contains('tag')).toBe(true);
    expect(tagChip.textContent?.trim()).toBe('#aa');

    const categories = await mount({ items, tab: 'categories' });
    const categoryChip = q(categories.sr, '[data-testid="value-row"] .hv-chip')!;
    expect(categoryChip.classList.contains('tag')).toBe(false);
    expect(categoryChip.textContent?.trim()).toBe('Consumables');
  });

  async function create(el: HVOrganizeDialog, sr: ShadowRoot, name: string) {
    (q(sr, '[data-testid="organize-new-value"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="new-value-name"]') as HTMLInputElement;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    await settle(el);
    (q(sr, '[data-testid="new-value-create"]') as HTMLButtonElement).click();
    await settle(el);
  }

  it('names a new category, which then shows up as a suggestion', async () => {
    const { el, store, sr } = await mount({ items, tab: 'categories' });
    await create(el, sr, 'Spare parts');

    const rows = all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value);
    expect(rows).toEqual(['Consumables', 'Spare parts', 'Tools']);
    // Nothing to create server-side, so it has to be honest about that.
    expect(q(sr, '[data-testid="value-draft"]')?.textContent).toContain('not saved');
    expect(store.state.value.distinctValuesCache?.categories).toContainEqual({
      value: 'Spare parts',
      count: 0,
    });
  });

  it('names a new tag the way the backend would store it', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    await create(el, sr, 'Power Tools');
    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).toContain('power tools');
  });

  it('refuses a name that is already in use', async () => {
    const { el, sr } = await mount({ items, tab: 'categories' });
    await create(el, sr, 'tools');

    expect(q(sr, '[data-testid="new-value-error"]')?.textContent).toContain('already');
    expect(all(sr, '[data-testid="value-row"]')).toHaveLength(2);
  });

  it('discards a named value that never made it onto an item', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    await create(el, sr, 'seasonal');

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'seasonal')!;
    (row.querySelector('[data-testid="value-discard"]') as HTMLButtonElement).click();
    await settle(el);

    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).not.toContain('seasonal');
    expect(store.state.value.distinctValuesCache?.tags.map((t) => t.value)).not.toContain('seasonal');
  });

  it('offers no rename or merge on a value no item carries yet', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    await create(el, sr, 'seasonal');
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'seasonal')!;

    // Both rewrite every matching item, and there are none — they would look
    // like they worked and do nothing.
    expect(row.querySelector('[data-testid="value-rename"]')).toBe(null);
    expect(row.querySelector('[data-testid="value-merge"]')).toBe(null);
  });

  it('filters the value list', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const filter = q(sr, '[data-testid="organize-filter"]') as HTMLInputElement;
    filter.value = 'bat';
    filter.dispatchEvent(new Event('input'));
    await settle(el);

    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).toEqual(['batery', 'battery']);
  });

  /** Open one row's merge editor, which is where the target is picked. */
  async function openMerge(el: HVOrganizeDialog, sr: ShadowRoot, value: string) {
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === value)!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);
  }

  const targets = (sr: ShadowRoot) =>
    all(sr, '[data-testid="value-target-option"]').map((o) => o.dataset.value);

  it('pre-fills the merge target with the closest existing value', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    await openMerge(el, sr, 'batery');

    expect(q(sr, '[data-testid="value-target"]')?.textContent?.trim()).toBe('#battery');
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain(
      'Retags 2 items, then removes "batery"',
    );
  });

  // A browser draws a `<datalist>` as chrome of its own, and the Home Assistant
  // companion app's Android WebView draws none at all: a list the browser owns
  // never opens there, so the targets have to be the card's own elements.
  it('draws the merge targets itself rather than as browser suggestions', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });

    for (const mode of ['rename', 'merge'] as const) {
      const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
      (row.querySelector(`[data-testid="value-${mode}"]`) as HTMLButtonElement).click();
      await settle(el);
      const editor = q(sr, '[data-testid="value-editor"]') as HTMLElement;
      expect(editor.dataset.mode, mode).toBe(mode);
      expect(editor.querySelector('datalist'), mode).toBe(null);
      expect(editor.querySelector('[list]'), mode).toBe(null);
    }
  });

  it('offers every other value of the tab, and never the one being merged', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    await openMerge(el, sr, 'batery');

    const trigger = q(sr, '[data-testid="value-target"]') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(targets(sr)).toEqual([]);

    trigger.click();
    await settle(el);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(targets(sr)).toEqual(['aa', 'battery']);
    // Two rows fit in the box without scrolling, so there is nothing to narrow.
    expect(q(sr, '[data-testid="value-target-filter"]')).toBe(null);
  });

  it('merges into the value picked from the list', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    // "aa" is nothing like the other two, so nothing is pre-filled and the
    // pick is the whole of what makes the merge possible.
    await openMerge(el, sr, 'aa');
    expect((q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).disabled).toBe(true);

    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);
    const option = all(sr, '[data-testid="value-target-option"]').find((o) => o.dataset.value === 'battery')!;
    option.click();
    await settle(el);

    // The pick is what the trigger says, and it shuts the list behind it.
    expect(q(sr, '[data-testid="value-target"]')?.textContent?.trim()).toBe('#battery');
    expect(q(sr, '[data-testid="value-target"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain('removes "aa"');

    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    for (let i = 0; i < 3; i += 1) await settle(el);

    const tags = store.state.value.items.flatMap((i) => i.tags);
    expect(tags).not.toContain('aa');
    expect(tags.filter((t) => t === 'battery')).toHaveLength(1);
  });

  it('narrows a long list of targets, and says when nothing is left', async () => {
    const many = [
      makeItem({ id: 'm1', tags: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] }),
      makeItem({ id: 'm2', tags: ['zeta', 'eta', 'theta', 'iota', 'kappa'] }),
    ];
    const { el, sr } = await mount({ items: many, tab: 'tags' });
    await openMerge(el, sr, 'alpha');
    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);

    expect(targets(sr)).toHaveLength(9);
    const filter = q(sr, '[data-testid="value-target-filter"]') as HTMLInputElement;
    filter.value = 'the';
    filter.dispatchEvent(new Event('input'));
    await settle(el);
    expect(targets(sr)).toEqual(['theta']);

    filter.value = 'nothing like it';
    filter.dispatchEvent(new Event('input'));
    await settle(el);
    expect(targets(sr)).toEqual([]);
    expect(q(sr, '[data-testid="value-target-none"]')?.textContent).toContain('No tags match');

    // The filter belongs to the list, not to the row: shutting it discards it.
    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);
    expect((q(sr, '[data-testid="value-target-filter"]') as HTMLInputElement).value).toBe('');
    expect(targets(sr)).toHaveLength(9);
  });

  it('says so when the value is the only one there is', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1', tags: ['battery'] })], tab: 'tags' });
    await openMerge(el, sr, 'battery');

    expect((q(sr, '[data-testid="value-target"]') as HTMLButtonElement).disabled).toBe(true);
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain(
      'There are no other tags to merge into',
    );
    expect((q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('merges a tag across every affected item', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    const tags = store.state.value.items.flatMap((i) => i.tags);
    expect(tags).not.toContain('batery');
    expect(tags.filter((t) => t === 'battery')).toHaveLength(3);
    // Said once, in the past tense: the count of both halves and the caveat
    // about partial application only matter when something actually failed.
    expect(q(sr, '[data-testid="rewrite-label"]')?.textContent?.trim()).toBe('Merged 2 items');
    expect(q(sr, '[data-testid="rewrite-status"]')?.textContent).not.toContain('one batch call');
  });

  it('will not apply a rename to the same value', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames a category across its items', async () => {
    const { el, store, sr } = await mount({ items, tab: 'categories' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'Tools')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    const target = q(sr, '[data-testid="value-target"]') as HTMLInputElement;
    target.value = 'Instruments';
    target.dispatchEvent(new Event('input'));
    await settle(el);
    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(store.state.value.items.filter((i) => i.category === 'Instruments')).toHaveLength(2);
  });

  it('reports the rows a rewrite could not touch', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const realBulk = store['ws'].bulk.bind(store['ws']);
    store['ws'].bulk = async (ops) => {
      const res = await realBulk(ops);
      const first = defined(ops[0], 'first op');
      res.results[first.op_id] = {
        success: false,
        error: { code: 'conflict', message: 'version conflict', context: {} },
      };
      return res;
    };

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="rewrite-failed"]')?.textContent).toContain('1 failed');
    expect(q(sr, '[data-testid="rewrite-failure"]')?.textContent).toContain('changed by another client');
  });

  it('confirms before removing a value from every item', async () => {
    const { el, store, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = q(sr, '[data-testid="organize-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    expect(confirm.shadowRoot?.textContent).toContain('Remove "batery" from 2 items?');

    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(store.state.value.items.flatMap((i) => i.tags)).not.toContain('batery');
  });

  // The confirmation is a dialog inside this one and reports its own dismissal
  // as `cancel` — the same event, on the same element, that tells the host to
  // take this dialog down. Backing out of one tag's delete must not read as
  // "Organize was dismissed".
  it('keeps Organize open when the remove confirmation is cancelled', async () => {
    for (const how of ['click', 'escape'] as const) {
      const { el, sr } = await mount({ items, tab: 'tags' });
      let dismissed = 0;
      el.addEventListener('cancel', () => {
        dismissed += 1;
      });

      const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
      const remove = row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement;
      remove.focus();
      remove.click();
      await settle(el);

      const confirm = q(sr, '[data-testid="organize-confirm"]') as HTMLElement & { open: boolean };
      expect(confirm.open, how).toBe(true);
      if (how === 'click') {
        (confirm.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
      } else {
        (confirm.shadowRoot?.querySelector('[data-testid="confirm-dialog"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      }
      await settle(el);

      expect(dismissed, how).toBe(0);
      expect(confirm.open, how).toBe(false);
      expect(q(sr, '[data-testid="organize-dialog"]'), how).toBeTruthy();
      // Back where the question was asked from, so the next key press acts on
      // the row rather than on whatever the browser fell back to.
      expect(sr.activeElement, how).toBe(remove);
      el.remove();
    }
  });

  // What a real browser does with that return: the ✕ sits in row actions that
  // are `visibility: hidden` again once the pointer is on the confirmation,
  // and focusing an undrawn element is a silent no-op — jsdom lays nothing out
  // and accepts it, so the refusal is modelled by stubbing the button's
  // `focus`. The rescue lands on the row, whose `:focus-within` re-reveals the
  // actions, and Tab continues from the user's place in the list (#678).
  it('lands focus on the row when the browser refuses the hidden ✕', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    const remove = row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement;
    remove.focus();
    remove.click();
    await settle(el);

    remove.focus = () => undefined;
    const confirm = q(sr, '[data-testid="organize-confirm"]') as HTMLElement;
    (confirm.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
    await settle(el);

    expect(sr.activeElement).toBe(row);
  });

  it('keeps an accepted removal from reading as this dialog answering', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    let answered = 0;
    el.addEventListener('confirm', () => {
      answered += 1;
    });

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="organize-confirm"]') as HTMLElement).shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')
      ?.click();
    await settle(el);

    expect(answered).toBe(0);
  });

  it('says so when there is nothing to organize', async () => {
    const { sr } = await mount({ items: [], tab: 'tags' });
    expect(q(sr, '[data-testid="organize-empty"]')?.textContent).toContain('No tags in use yet');
  });
});

describe('hv-organize-dialog: mobile value actions', () => {
  const items = [makeItem({ id: '1', tags: ['batery'] }), makeItem({ id: '2', tags: ['battery'] })];

  it('replaces hover actions with a tap-to-open action sheet', async () => {
    const { el, sr } = await mount({ items, tab: 'tags', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    expect(row.querySelector('[data-testid="value-rename"]')).toBe(null);

    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = q(sr, '[data-testid="value-sheet"]') as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(sheet.querySelector('[data-testid="sheet-show"]')?.textContent).toContain('Show 1 item');
    // The merge row suggests the likely typo fix up front.
    expect(sheet.querySelector('[data-testid="sheet-merge-suggestion"]')?.textContent).toContain('battery');
  });

  it('opens the merge editor from the sheet', async () => {
    const { el, sr } = await mount({ items, tab: 'tags', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="sheet-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-editor"]') as HTMLElement).dataset.mode).toBe('merge');
    expect(q(sr, '[data-testid="value-sheet"]')).toBe(null);
  });
});

// Every disclosure renders after the row that opened it, inside a `.body` that
// scrolls, so one opened from a row near the bottom lands below the fold and
// the tap reads as having done nothing.
describe('hv-organize-dialog: disclosures come into view', () => {
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

  it('brings the value editor into view and puts the caret in its target field', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="value-editor"]')]);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="value-target"]'));
  });

  // The pane must not jump while the household is typing in the form it just
  // opened, nor when anything else re-renders the dialog.
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

  // The mode is half a value editor's identity: switching a row from rename to
  // merge swaps the form under one element, and it is a different question.
  it('reveals the value editor again when the same row switches mode', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="value-editor"]') as HTMLElement;
    expect(editor.dataset.mode).toBe('merge');
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]?.el).toBe(editor);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="value-target"]'));
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

  // The statuses tab keeps a half-typed status across a tab switch and a close,
  // and coming back to the tab brings it into view again. Re-opening the dialog
  // is DialogFocus's moment instead: it puts focus on the panel, and the
  // carried-over disclosure must not pull it away.
  it('moves nothing when the dialog re-opens with a disclosure still expanded', async () => {
    const { el, sr } = await mount({ tab: 'statuses', items });
    const tab = q(sr, 'hv-organize-statuses') as HTMLElement;
    const editor = () => q(tab.shadowRoot as ShadowRoot, '[data-testid="status-editor"]');
    (q(tab.shadowRoot as ShadowRoot, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(tab);
    expect(scrolls).toHaveLength(1);

    for (const name of ['locations', 'statuses']) {
      (q(sr, `[data-tab="${name}"]`) as HTMLButtonElement).click();
      await settle(el);
    }
    expect(q(sr, 'hv-organize-statuses')).toBe(tab);
    expect(editor()).not.toBe(null);
    expect(scrolls).toHaveLength(2);

    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect(editor()).not.toBe(null);
    expect(scrolls).toHaveLength(2);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="organize-dialog"]'));
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

  it('brings the value ⋮ sheet into view', async () => {
    const { el, sr } = await mount({ items, tab: 'tags', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="value-sheet"]')]);
    expect(q(sr, '[data-testid="value-sheet"]')?.contains(sr.activeElement)).toBe(false);
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

describe('hv-organize-dialog: the id an automation names', () => {
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
  // spec in `ui/clipboard.test.ts`. What the dialog owes is the wiring: the id
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

describe('hv-organize-dialog: the language in force', () => {
  it('names its four tabs in German', async () => {
    setLanguage('de');
    const { el } = await mount();
    const tabs = all<HTMLElement>(el, '[data-testid="organize-tab"]').map((b) => (b.textContent ?? '').trim());
    expect(tabs).toEqual(['Orte', 'Kategorien', 'Labels', 'Status']);
  });

  it('names the button that creates a value in German too', async () => {
    setLanguage('de');
    const { el, sr } = await mount({ tab: 'tags' });
    (q(sr, '[data-testid="organize-new-value"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="new-value-create"]')?.textContent?.trim()).toBe('Erstellen');
  });

  it('composes the {noun} strings without an article, so both genders read right', async () => {
    // "Kategorie" is feminine and "Label" neuter; a German value carrying
    // "Ein …" or "Neues …" in front of the placeholder is wrong for one of
    // the two. The categories tab is the one that broke, so it is the pin.
    setLanguage('de');
    const { el, sr } = await mount({ tab: 'categories' });
    (q(sr, '[data-testid="organize-new-value"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="new-value-name"]') as HTMLInputElement;
    expect(input.placeholder).toBe('Kategorie hinzufügen …');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(el);
    expect(q(sr, '[data-testid="new-value-error"]')?.textContent?.trim()).toBe(
      'Kategorie braucht einen Namen.',
    );
  });
});

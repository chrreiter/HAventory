import { setLanguage } from '../i18n';
import './hv-organize-dialog';
import { all, componentCss, makeItem, mountHost, q, settle } from '../test.utils';
// The clipboard itself is `ui/clipboard`'s own test; what the dialog owes is
// asking the helper and believing its answer, which needs both answers.
vi.mock('../ui/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/clipboard')>()),
  copyText: vi.fn(async () => true),
}));
import { copyText } from '../ui/clipboard';
import { HVOrganizeDialog } from './hv-organize-dialog';
import type { OrganizeTab } from './hv-organize-dialog';
import type { AreaRef, Item, Location, StatusDefinition } from '../store/types';

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
    statuses?: StatusDefinition[];
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
      ...(opts.statuses ? { statuses: opts.statuses } : {}),
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
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-count"]')?.textContent?.trim()).toBe(
      '1 item',
    );
    expect(tree.shadowRoot?.querySelector('[data-testid="tree-edit"]')).toBeTruthy();
  });

  it('edits a location in place and saves name, area and parent in one call', async () => {
    const { el, store, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
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
      (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
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
      (tree.shadowRoot?.querySelector(`[data-testid="tree-edit"][data-id="${id}"]`) as HTMLButtonElement).click();
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
      (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="attic"]') as HTMLButtonElement).click();
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

    for (const [action, picker, id] of [
      ['tree-edit', 'location-parent', 'location-parent-tree-holder'],
      ['tree-merge', 'merge-target', 'merge-target-tree-holder'],
    ]) {
      (tree.shadowRoot?.querySelector(`[data-testid="${action}"][data-id="garage"]`) as HTMLButtonElement).click();
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
      const after =
        control().parentElement === holder.parentElement ? control() : control().parentElement;
      expect(holder.previousElementSibling, `${picker} placement`).toBe(after);
    }
  });

  it('excludes the location itself from its own parent picker, so no cycle is possible', async () => {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
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
        calls.push({ id, changes: changes as Record<string, unknown> });
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
      expect(calls[0].changes.name).toBe('Shelf B');
      expect('newParentId' in calls[0].changes).toBe(false);
    });

    it('moves the subtree when a different parent is picked', async () => {
      const { el, sr, calls } = await editShelfA();
      await pickParent(el, sr, '[data-testid="tree-row"][data-id="attic"]');

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls[0].changes.newParentId).toBe('attic');
    });

    it('sends an explicit null when the location is moved to the top level', async () => {
      const { el, sr, calls } = await editShelfA();
      await pickParent(el, sr, '[data-testid="tree-all"]');

      (q(sr, '[data-testid="location-save"]') as HTMLButtonElement).click();
      await settle(el);

      expect(calls[0].changes.newParentId).toBeNull();
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
        calls.push({ id, changes: changes as Record<string, unknown> });
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
      const offered = [
        ...(picker.shadowRoot?.querySelectorAll('[data-testid="tree-area-select"]') ?? []),
      ].map((b) => (b as HTMLElement).dataset.area);
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

      expect(calls[0].changes.newParentId).toBeNull();
      expect(calls[0].changes.areaId).toBe('area-kitchen');
    });

    it('calls the row that clears the parent what it does in a parent picker', async () => {
      const { picker } = await openParentPicker();
      expect(
        picker.shadowRoot?.querySelector('[data-testid="tree-all"]')?.textContent?.trim(),
      ).toContain('Top level');
    });
  });

  it('drops a failed save off the screen when the dialog is reopened', async () => {
    const { el, store, sr } = await mount({ locations });
    store.updateLocation = () => Promise.reject(new Error('Location is busy'));

    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
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

    (tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement).click();
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

    (tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement).click();
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

    (tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="spare"]') as HTMLButtonElement).click();
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

      (tree.shadowRoot?.querySelector(`[data-testid="${testid}"][data-id="garage"]`) as HTMLButtonElement).click();
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

    (tree.shadowRoot?.querySelector('[data-testid="tree-more"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = q(sr, '[data-testid="location-sheet"]') as HTMLElement;
    expect(sheet.querySelector('[data-testid="location-sheet-show"]')?.textContent).toContain('Show 1 item');
    (sheet.querySelector('[data-testid="location-sheet-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-merge"]')).toBeTruthy();
    expect(q(sr, '[data-testid="location-sheet"]')).toBe(null);
  });

  it('merges a location: items move, children re-parent, the husk is deleted', async () => {
    const items = [
      makeItem({ id: '1', location_id: 'garage' }),
      makeItem({ id: '2', location_id: 'garage' }),
    ];
    const { el, store, sr } = await mount({
      items,
      locations: [...locations, loc('workshop', 'Workshop')],
    });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;

    (tree.shadowRoot?.querySelector('[data-testid="tree-merge"][data-id="garage"]') as HTMLButtonElement).click();
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

    (picker.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="workshop"]') as HTMLButtonElement).click();
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
    (tree.shadowRoot?.querySelector('[data-testid="tree-merge"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="merge-target"]') as HTMLButtonElement).click();
    await settle(el);
    const picker = q(sr, '[data-testid="merge-target-tree"]') as HTMLElement;
    (picker.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="workshop"]') as HTMLButtonElement).click();
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

  it('pre-fills the merge target with the closest existing value', async () => {
    const { el, sr } = await mount({ items, tab: 'tags' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-target"]') as HTMLInputElement).value).toBe('battery');
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain(
      'Retags 2 items, then removes "batery"',
    );
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
      const first = ops[0];
      res.results[first.op_id] = { success: false, error: { code: 'conflict', message: 'version conflict' } };
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

describe('hv-organize-dialog: statuses', () => {
  const ladder = makeItem({ id: 'i1', name: 'Ladder', status: 'missing' });

  it('lists the vocabulary in display order, with each definition its own chip', async () => {
    const { sr } = await mount({ tab: 'statuses' });

    expect(all(sr, '[data-testid="status-row"]').map((r) => r.dataset.value)).toEqual([
      'ok',
      'missing',
      'needs_repair',
    ]);
    expect(q(sr, '[data-testid="status-chip"]')?.classList.contains('tone-green')).toBe(true);
  });

  // The chip already names each status in the household's own words; printing
  // "needs_repair" beside "Needs repair" only said the same thing in code.
  it('leaves the slug out of the list rows and keeps it in the editor', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });

    expect(all(sr, '[data-testid="status-slug"]')).toEqual([]);

    (
      all(sr, '[data-testid="status-row"]')
        .find((r) => r.dataset.value === 'needs_repair')
        ?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-slug-preview"]')?.textContent?.trim()).toBe('needs_repair');
  });

  it('counts the items on each status', async () => {
    const { sr } = await mount({ tab: 'statuses', items: [ladder] });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    expect(row?.querySelector('[data-testid="status-count"]')?.textContent?.trim()).toBe('1 item');
  });

  // The count is this tab's answer to "which items?", so it has to land on
  // those items — the way a location count and a category count already do.
  it('opens the items behind a status from its count', async () => {
    const { el, store, sr } = await mount({
      tab: 'statuses',
      items: [ladder, makeItem({ id: 'i2', name: 'Rake' })],
    });
    let browsed = 0;
    let dismissed = 0;
    el.addEventListener('browse', () => {
      browsed += 1;
    });
    el.addEventListener('cancel', () => {
      dismissed += 1;
    });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-count"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.filters.status).toBe('missing');
    // Organizing happens full-screen; so should the list it hands back.
    expect(browsed).toBe(1);
    expect(dismissed).toBe(1);
  });

  it('creates a status, deriving the slug from the label', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses' });

    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Lent out';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-slug-preview"]')?.textContent?.trim()).toBe('lent_out');

    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    const sent = hass.__messages.find((m) => m.type === 'haventory/status/create');
    expect(sent).toMatchObject({ slug: 'lent_out', label: 'Lent out' });
  });

  it('renames without touching any item', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses', items: [ladder] });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Gone walkabout';
    input.dispatchEvent(new Event('input'));
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/update')).toMatchObject({
      slug: 'missing',
      label: 'Gone walkabout',
    });
    expect(hass.__messages.some((m) => m.type === 'haventory/item/update')).toBe(false);
  });

  // The command takes the whole permutation, so a partial list cannot leave two
  // definitions claiming one position.
  it('moves a status by sending every slug in the new order', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses' });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-down"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/reorder')).toMatchObject({
      slugs: ['ok', 'needs_repair', 'missing'],
    });
  });

  it('cannot move the first row up or the last row down', async () => {
    const { sr } = await mount({ tab: 'statuses' });

    const rows = all(sr, '[data-testid="status-row"]');
    expect((rows[0].querySelector('[data-testid="status-up"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (rows[rows.length - 1].querySelector('[data-testid="status-down"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // The backend takes label, colour and icon changes for any slug, the default
  // included — a household that wants a quieter "OK", or one in its own
  // language, has to be able to say so. Only the delete stays withheld.
  it('withholds delete from the default status but not the rename', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'ok');
    expect(row?.querySelector('[data-testid="status-default"]')).not.toBe(null);
    expect(row?.querySelector('[data-testid="status-remove"]')).toBe(null);

    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-editor"]')).not.toBe(null);
    expect((q(sr, '[data-testid="status-label"]') as HTMLInputElement).value).toBe('OK');
  });

  it('renames the default status without the backend hearing about any item', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses' });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'ok');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'In Ordnung';
    input.dispatchEvent(new Event('input'));
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/update')).toMatchObject({
      slug: 'ok',
      label: 'In Ordnung',
    });
  });

  // The backend refuses this regardless; the guard is the explanation, and the
  // target is what turns the refusal into a completed move.
  it('guards a delete that would orphan items, then reassigns them', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses', items: [ladder] });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const guard = q(sr, '[data-testid="status-guard"]');
    expect(guard?.textContent).toContain('1 item');
    expect(hass.__messages.some((m) => m.type === 'haventory/status/delete')).toBe(false);

    (q(sr, '[data-testid="status-guard-confirm"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/delete')).toMatchObject({
      slug: 'missing',
      reassign_to: 'ok',
    });
  });

  // One question, one idiom, whichever branch it is: a modal for the unused
  // status beside an inline disclosure for the in-use one puts the lighter
  // ceremony on the consequential path.
  it('asks in the same disclosure when nothing carries the status', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const guard = q(sr, '[data-testid="status-guard"]');
    expect(guard).toBeTruthy();
    expect(guard?.textContent).toContain('No item carries this status');
    // Nothing to reassign, so the select the in-use branch needs is absent...
    expect(guard?.querySelector('[data-testid="status-reassign"]')).toBe(null);
    // ...and the action says what it does rather than promising a reassign.
    expect(q(sr, '[data-testid="status-guard-confirm"]')?.textContent?.trim()).toBe('Delete');
    // No modal branch anywhere in the component: both go through the disclosure.
    expect(q(sr, '[data-testid="organize-status-confirm"]')).toBe(null);
  });

  it('deletes an unused status once the disclosure is confirmed', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses' });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="status-guard-confirm"]') as HTMLButtonElement).click();
    await settle(el);

    const deleted = hass.__messages.filter((m) => m.type === 'haventory/status/delete');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].slug).toBe('missing');
    // No reassign target travels with a status nothing carries.
    expect(deleted[0].reassign_to ?? null).toBe(null);
  });

  it('backs out of an unused status delete', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses' });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="status-guard-cancel"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-guard"]')).toBe(null);
    expect(hass.__messages.some((m) => m.type === 'haventory/status/delete')).toBe(false);
  });

  it('sends the colour and glyph chosen in the picker', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses' });

    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Lent out';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    (
      all(sr, '[data-testid="status-color"]').find(
        (b) => (b as HTMLElement).dataset.value === 'blue_strong',
      ) as HTMLButtonElement
    ).click();
    (
      all(sr, '[data-testid="status-icon"]').find(
        (b) => (b as HTMLElement).dataset.value === 'hand',
      ) as HTMLButtonElement
    ).click();
    await settle(el);
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/create')).toMatchObject({
      color: 'blue_strong',
      icon: 'hand',
    });
  });

  // A tone is a tint plus the ink that reads on it. Painting only the tint left
  // the five light tones near-identical on white and near-black in dark, where
  // they are washes never meant to stand on their own.
  it('paints each swatch as a miniature chip carrying the glyph being chosen', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const swatches = all(sr, '[data-testid="status-color"]');
    expect(swatches).toHaveLength(10);
    for (const s of swatches) {
      expect(s.querySelector('svg')?.getAttribute('data-icon')).toBe('check');
    }
    // Both halves of the tone: the fill comes from the class, the ink with it.
    expect(swatches.map((s) => s.dataset.value)).toContain('amber_strong');
    expect(
      swatches.find((s) => s.dataset.value === 'amber_strong')?.classList.contains('tone-amber-strong'),
    ).toBe(true);

    (
      all(sr, '[data-testid="status-icon"]').find((b) => b.dataset.value === 'truck') as HTMLButtonElement
    ).click();
    await settle(el);

    for (const s of all(sr, '[data-testid="status-color"]')) {
      expect(s.querySelector('svg')?.getAttribute('data-icon')).toBe('truck');
    }
  });

  // The eleventh swatch is the household's own colour. It is the only control
  // on the card that produces a value the ten tokens cannot express, so what
  // matters is that the value reaches the backend as typed.
  it('sends a colour picked outside the ten as the literal it is', async () => {
    const { el, sr, hass } = await mount({ tab: 'statuses' });

    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    const label = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    label.value = 'Lent out';
    label.dispatchEvent(new Event('input'));
    const picker = q(sr, '[data-testid="status-color-hex"]') as HTMLInputElement;
    picker.value = '#2F6F4F';
    picker.dispatchEvent(new Event('input'));
    await settle(el);

    // Folded to one spelling, so the stored colour can be compared and not
    // only rendered.
    const swatch = q(sr, '[data-testid="status-color-custom"]') as HTMLElement;
    expect(swatch.classList.contains('on')).toBe(true);
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/create')).toMatchObject({
      color: '#2f6f4f',
    });
  });

  it('paints the custom swatch in the chosen colour, with the ink derived from it', async () => {
    const { el, sr } = await mount({
      tab: 'statuses',
      statuses: [{ slug: 'sold', label: 'Sold', order: 0, color: '#ffe082', icon: 'check' }],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'sold');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const custom = q(sr, '[data-testid="status-color-custom"]') as HTMLElement;
    expect(custom.style.getPropertyValue('--hv-status-bg')).toBe('#ffe082');
    expect(custom.style.getPropertyValue('--hv-status-fg')).toBe('#000000');
    // None of the ten reads as chosen while a literal colour is in force.
    expect(all(sr, '[data-testid="status-color"]').some((b) => b.classList.contains('on'))).toBe(
      false,
    );
  });

  // The one element on the card that ignores the Home Assistant theme, so the
  // editor says so rather than letting a household find out on a theme switch.
  it('says a literal colour ignores the theme, and only while one is chosen', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-color-custom-hint"]')).toBe(null);

    const picker = q(sr, '[data-testid="status-color-hex"]') as HTMLInputElement;
    picker.value = '#2f6f4f';
    picker.dispatchEvent(new Event('input'));
    await settle(el);

    expect((q(sr, '[data-testid="status-color-custom-hint"]') as HTMLElement).textContent).toMatch(
      /same in every Home\s+Assistant theme/,
    );

    (
      all(sr, '[data-testid="status-color"]').find((b) => b.dataset.value === 'red') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-color-custom-hint"]')).toBe(null);
  });

  // An import can define a status naming a glyph this bundle has never carried.
  // The swatch still has to put ink on its tint, or the tone is half-shown again.
  it('letters a swatch whose glyph this bundle does not carry', async () => {
    const { el, sr } = await mount({
      tab: 'statuses',
      statuses: [
        { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
        { slug: 'sold', label: 'Sold', order: 1, color: 'red', icon: 'not-a-glyph' },
      ],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'sold');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    for (const s of all(sr, '[data-testid="status-color"]')) {
      expect(s.querySelector('svg')).toBe(null);
      expect(s.querySelector('.letters')?.textContent).toBe('Aa');
    }
  });

  // Two statuses labelled the same are indistinguishable in every row badge,
  // filter chip and select — only the slug tells them apart, and the slug is
  // what this editor hides.
  it('warns when a label collides with one already in use, without blocking it', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = '  missing ';
    input.dispatchEvent(new Event('input'));
    await settle(el);

    expect(q(sr, '[data-testid="status-duplicate-hint"]')?.textContent).toContain('Missing');
    // A warning, not a refusal: creating anyway stays available.
    expect((q(sr, '[data-testid="status-save"]') as HTMLButtonElement).disabled).toBe(false);
    // The slug dedupe stays as the backstop the backend needs.
    expect(q(sr, '[data-testid="status-slug-preview"]')?.textContent?.trim()).toBe('missing_2');
  });

  it('drops the hint once the label is its own again', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Missing';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-duplicate-hint"]')).not.toBe(null);

    input.value = 'Lent out';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-duplicate-hint"]')).toBe(null);
  });

  it('does not call a status a duplicate of itself while it is being edited', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="status-label"]') as HTMLInputElement).value).toBe('Missing');
    expect(q(sr, '[data-testid="status-duplicate-hint"]')).toBe(null);
  });

  // The preview exists for people writing automations, and it was eliding the
  // identifier it exists to show while the row still had free width.
  it('shows the derived slug in full, and titles it', async () => {
    const { el, sr } = await mount({ tab: 'statuses' });
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Lent out to the neighbours';
    input.dispatchEvent(new Event('input'));
    await settle(el);

    const preview = q(sr, '[data-testid="status-slug-preview"]');
    expect(preview?.textContent?.trim()).toBe('lent_out_to_the_neighbours');
    expect(preview?.getAttribute('title')).toBe('lent_out_to_the_neighbours');
  });

  // The sentence naming where 40 items are about to go carried .note's tertiary
  // grey, which measures 2.5:1 over the guard's fill. It is the guard's own
  // message, so it takes the guard's ink.
  it('inks the guard message with the guard, not with a note grey', async () => {
    const { el, sr } = await mount({
      tab: 'statuses',
      items: [makeItem({ id: 'i8', name: 'Ladder', status: 'missing' })],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const message = q(sr, '[data-testid="status-guard-message"]');
    expect(message?.textContent).toContain('1 item');
    expect(message?.classList.contains('note')).toBe(false);
  });

  it('marks the guard so its stacking cannot reach the location guard', async () => {
    const { el, sr } = await mount({
      tab: 'statuses',
      items: [makeItem({ id: 'i9', name: 'Ladder', status: 'missing' })],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const guard = q(sr, '[data-testid="status-guard"]');
    expect(guard?.classList.contains('status-guard')).toBe(true);
    expect(guard?.querySelector('.guard-target select')).not.toBe(null);
  });

  it('draws a chevron big enough to read at the button it sits in', async () => {
    const { sr } = await mount({ tab: 'statuses' });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    for (const dir of ['up', 'down'] as const) {
      const glyph = row?.querySelector(`[data-testid="status-${dir}"] svg`) as SVGElement;
      expect(glyph?.getAttribute('width'), dir).toBe('18');
    }
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

  // The destructive one: it stands between a tap and every item on a status
  // being reassigned, so rendering it off-screen makes delete look broken and
  // invites the second tap.
  it('brings the status delete guard into view', async () => {
    const { el, sr } = await mount({ tab: 'statuses', items });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="status-guard"]')]);
    // 'nearest' scrolls no further than it must, so a disclosure already on
    // screen does not move; no `behavior`, so there is no motion to gate on a
    // reduced-motion preference.
    expect(scrolls[0].options).toEqual({ block: 'nearest' });
    // A guard announces itself through role="alert" and takes no focus.
    expect(q(sr, '[data-testid="status-guard"]')?.contains(sr.activeElement)).toBe(false);
  });

  // This one renders after the whole tree rather than beside its row, so it is
  // below the fold for any tree taller than the panel.
  it('brings the location delete guard into view', async () => {
    const { el, sr } = await mount({ items, locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-delete"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="location-guard"]')]);
    expect(q(sr, '[data-testid="location-guard"]')?.contains(sr.activeElement)).toBe(false);
  });

  it('brings the location editor into view and puts the caret in its name field', async () => {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
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

  it('brings the status editor into view and puts the caret in its label field', async () => {
    const { el, sr } = await mount({ tab: 'statuses', items });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'ok');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="status-editor"]')]);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="status-label"]'));
  });

  // The pane must not jump while the household is typing in the form it just
  // opened, nor when anything else re-renders the dialog.
  it('scrolls once per open, not on the re-renders that follow', async () => {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
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
    expect(scrolls[1].el).toBe(editor);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="value-target"]'));
  });

  it('scrolls again when a second row opens the same kind of disclosure', async () => {
    const { el, sr } = await mount({ locations: [loc('garage', 'Garage'), loc('attic', 'Attic')] });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    (tree.shadowRoot?.querySelector('[data-testid="tree-edit"][data-id="attic"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolls).toHaveLength(2);
    expect(scrolls[1].el).toBe(q(sr, '[data-testid="location-editor"]'));
  });

  // Re-opening the dialog is DialogFocus's moment: it puts focus on the panel,
  // and a disclosure carried over from last time must not pull it away.
  it('moves nothing when the dialog re-opens with a disclosure still expanded', async () => {
    const { el, sr } = await mount({ tab: 'statuses', items });
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    expect(scrolls).toHaveLength(1);

    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect(q(sr, '[data-testid="status-editor"]')).not.toBe(null);
    expect(scrolls).toHaveLength(1);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="organize-dialog"]'));
  });

  // On a phone the ⋮ sheet replaces the row's separate buttons, so it is the
  // only way into edit, merge and delete — and opened from a row near the
  // bottom it stands almost entirely off screen unless it is scrolled to.
  it('brings the location ⋮ sheet into view', async () => {
    const { el, sr } = await mount({ items, locations, mobile: true });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (tree.shadowRoot?.querySelector('[data-testid="tree-more"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="location-sheet"]')]);
    expect(scrolls[0].options).toEqual({ block: 'nearest' });
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
    (tree.shadowRoot?.querySelector('[data-testid="tree-more"][data-id="garage"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="location-sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="location-sheet"]')).toBe(null);
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1].el).toBe(q(sr, '[data-testid="location-editor"]'));
    expect(sr.activeElement).toBe(q(sr, '[data-testid="location-name"]'));
  });
});

describe('hv-organize-dialog: the id an automation names', () => {
  const locations = [loc('garage', 'Garage', null, 'area-garage'), loc('shelf-a', 'Shelf A', 'garage')];
  const copy = vi.mocked(copyText);

  /** Open the editor over an existing location, the way the tree's ✎ does. */
  async function editing(id: string) {
    const { el, sr } = await mount({ locations });
    const tree = q(sr, '[data-testid="organize-tree"]') as HTMLElement;
    (
      tree.shadowRoot?.querySelector(`[data-testid="tree-edit"][data-id="${id}"]`) as HTMLButtonElement
    ).click();
    await settle(el);
    return { el, sr };
  }

  beforeEach(() => {
    copy.mockReset();
    copy.mockResolvedValue(true);
  });

  it('shows a location its id, and copies it', async () => {
    const { el, sr } = await editing('garage');
    expect(q(sr, '[data-testid="location-id"]')?.textContent?.trim()).toBe('garage');

    const button = q<HTMLButtonElement>(sr, '[data-testid="location-copy-id"]')!;
    expect(button.textContent?.trim()).toBe('Copy');
    button.click();
    await settle(el);

    expect(copy).toHaveBeenCalledWith('garage');
    expect(q(sr, '[data-testid="location-copy-id"]')?.textContent?.trim()).toBe('Copied');
  });

  // The same refusal the detail sheet answers for: over plain http:// there may
  // be no clipboard at all, and a button that says Copied anyway names whatever
  // was on it before.
  it('claims nothing when the browser refused the copy', async () => {
    copy.mockResolvedValue(false);
    const { el, sr } = await editing('garage');

    q<HTMLButtonElement>(sr, '[data-testid="location-copy-id"]')!.click();
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

  it('forgets it copied when the editor is opened again', async () => {
    const { el, sr } = await editing('garage');
    q<HTMLButtonElement>(sr, '[data-testid="location-copy-id"]')!.click();
    await settle(el);
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
});

describe('hv-organize-dialog: the language in force', () => {
  it('names its four tabs in German', async () => {
    setLanguage('de');
    const { el } = await mount();
    const tabs = all<HTMLElement>(el, '[data-testid="organize-tab"]').map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(tabs).toEqual(['Orte', 'Kategorien', 'Labels', 'Status']);
  });
});

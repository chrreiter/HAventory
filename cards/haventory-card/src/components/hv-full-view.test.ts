import './hv-full-view';
import {
  componentCss,
  defined,
  discardAsker,
  makeItem,
  mountHost,
  q,
  settle,
  stubViewport,
} from '../test.utils';
import { deepActiveElement, deepFocusables } from '../ui/dialog-focus';
import { makeBulkOp } from '../store/store';
import type { HVFullView } from './hv-full-view';
import type { Item, Location, StatusDefinition } from '../store/types';

const DELETED_ELSEWHERE = 'This item was deleted on another device.';
const DELETED_ELSEWHERE_UNSAVED =
  'This item was deleted on another device. Your unsaved changes were not saved.';

/** What the view says about a form or sheet another device's delete closed, or null. */
function deletedNotice(sr: ShadowRoot): string | null {
  return q<HTMLElement & { message: string }>(sr, '[data-testid="deleted-notice"] hv-banner')?.message ?? null;
}

function loc(id: string, name: string, parentId: string | null = null): Location {
  const display = parentId ? `${parentId} / ${name}` : name;
  return {
    id,
    name,
    parent_id: parentId,
    area_id: null,
    path: {
      id_path: parentId ? [parentId, id] : [id],
      name_path: parentId ? [parentId, name] : [name],
      display_path: display,
      sort_key: display.toLowerCase(),
    },
  };
}

/**
 * Every mount stands a host beside the surface, the way the card and the panel
 * do: the discard dialog is the host's, and a surface mounted without one would
 * answer its own question by not asking it.
 */
async function mount(
  opts: {
    items?: Item[];
    locations?: Location[];
    areas?: { id: string; name: string }[];
    statuses?: StatusDefinition[];
    embedded?: boolean;
    narrow?: boolean;
  } = {},
) {
  const host = discardAsker();
  const mounted = await mountHost<HVFullView>(
    'hv-full-view',
    {
      items: opts.items ?? [],
      locations: opts.locations ?? [],
      areas: opts.areas ?? [],
      ...(opts.statuses ? { statuses: opts.statuses } : {}),
    },
    {
      columns: ['quantity', 'category'],
      confirmDiscard: host.ask,
      ...(opts.embedded ? { embedded: true } : {}),
      ...(opts.narrow ? { narrow: true } : {}),
      open: true,
    },
    { renders: 2 },
  );
  return { ...mounted, host };
}

describe('hv-full-view: phone-width context bar and panel', () => {
  // The crumb and its count can fill a phone-width row on their own. The
  // filter toggle and the column picker then have to move down together:
  // as separate flex items the picker wrapped alone under the toggle.
  it('moves the filter toggle and the column picker as one unit', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    const toggle = q(sr, '[data-testid="full-filters-toggle"]') as HTMLElement;
    const columns = q(sr, '[data-testid="columns-expanded"]') as HTMLElement;
    expect(toggle.parentElement).toBe(columns.parentElement);
    expect(toggle.parentElement?.classList.contains('context-actions')).toBe(true);
    expect(toggle.parentElement?.parentElement?.classList.contains('context')).toBe(true);
    expect(componentCss('hv-full-view')).toMatch(/\.context-actions \{[^}]*margin-left: auto/);
  });

  it('keeps the apply button out of the scroll, where the count is visible', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
    await settle(el);

    const scroll = q(sr, '.panel-scroll') as HTMLElement;
    expect(scroll?.querySelector('[data-testid="full-filter-panel"]')).toBeTruthy();
    // The commit row is a sibling of the scroll box, not inside it, so the
    // count on the apply button stays visible while the filters move.
    expect(scroll.querySelector('.panel-foot')).toBe(null);
    expect(componentCss('hv-full-view')).toMatch(/\.panel-foot \{[^}]*flex: none/);
    // The phone panel's commit row is where the spacer class earns its keep.
    expect(componentCss('hv-full-view')).toMatch(/\.spacer \{[^}]*margin-left: auto/);
  });
});

/** The bar's shadow root, where its controls are drawn. */
const barOf = (sr: ShadowRoot) => (q(sr, 'hv-full-app-bar') as HTMLElement).shadowRoot as ShadowRoot;

describe('hv-full-view: shell', () => {
  it('renders nothing when closed', async () => {
    const { el, sr } = await mount();
    el.open = false;
    await el.updateComplete;
    expect(q(sr, '[data-testid="full-view"]')).toBe(null);
  });

  it('is a modal dialog with the coloured app bar as the mode signal', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    const shell = q(sr, '[data-testid="full-view"]') as HTMLElement;
    expect(shell.getAttribute('role')).toBe('dialog');
    expect(shell.getAttribute('aria-modal')).toBe('true');
    expect(q(barOf(sr), '.appbar')).toBeTruthy();
  });

  it('closes from the app bar, the backdrop and Escape', async () => {
    for (const trigger of ['button', 'backdrop', 'escape'] as const) {
      const { el, sr } = await mount();
      let closes = 0;
      el.addEventListener('close', () => {
        closes += 1;
      });

      if (trigger === 'button') (q(barOf(sr), '[data-testid="expand-toggle"]') as HTMLButtonElement).click();
      else if (trigger === 'backdrop') (q(sr, '.backdrop') as HTMLElement).click();
      else
        (q(sr, '[data-testid="full-view"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

      expect(closes, `close via ${trigger}`).toBe(1);
      expect(el.open).toBe(false);
      el.remove();
    }
  });

  it('keeps the expand-toggle testid the POC card used', async () => {
    const { sr } = await mount();
    expect(q(barOf(sr), '[data-testid="expand-toggle"]')).toBeTruthy();
  });
});

// The same surface, hosted by a Home Assistant panel rather than by the card.
// It is a page there: nothing sits behind it, it has nowhere to close to, and
// it shares the tab order and the Escape key with the rest of the frontend.
describe('hv-full-view: embedded', () => {
  it('renders neither backdrop nor focus sentinels', async () => {
    const { sr } = await mount({ embedded: true });
    expect(q(sr, '.backdrop')).toBe(null);
    expect(sr.querySelectorAll('.sentinel')).toHaveLength(0);
  });

  it('drops the dialog semantics but keeps the surface', async () => {
    const { sr } = await mount({ embedded: true, items: [makeItem({ id: '1' })] });
    const shell = q(sr, '[data-testid="full-view"]') as HTMLElement;
    expect(shell.hasAttribute('role')).toBe(false);
    expect(shell.hasAttribute('aria-modal')).toBe(false);
    expect(shell.getAttribute('aria-label')).toBe('HAventory');
    expect(q(barOf(sr), '.appbar')).toBeTruthy();
    expect(q(sr, '[data-testid="full-table"]')).toBeTruthy();
    expect(q(sr, '[data-testid="full-sidebar"]')).toBeTruthy();
  });

  it('has no close button — a page has nowhere to close to', async () => {
    const { sr } = await mount({ embedded: true });
    expect(q(barOf(sr), '[data-testid="expand-toggle"]')).toBe(null);
  });

  // Swallowing Escape here would take the key away from whatever Home Assistant
  // has open over the panel.
  it('ignores Escape, and lets it through', async () => {
    const { el, sr } = await mount({ embedded: true });
    let closes = 0;
    el.addEventListener('close', () => {
      closes += 1;
    });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (q(sr, '[data-testid="full-view"]') as HTMLElement).dispatchEvent(event);
    await el.updateComplete;

    expect(closes).toBe(0);
    expect(el.open).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not pull focus into itself the way a dialog does', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { el } = await mount({ embedded: true });
    await el.updateComplete;

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('leaves the overlay variant modal', async () => {
    const { sr } = await mount();
    const shell = q(sr, '[data-testid="full-view"]') as HTMLElement;
    expect(shell.getAttribute('role')).toBe('dialog');
    expect(shell.getAttribute('aria-modal')).toBe('true');
    expect(q(sr, '.backdrop')).toBeTruthy();
    expect(sr.querySelectorAll('.sentinel')).toHaveLength(2);
    expect(q(barOf(sr), '[data-testid="expand-toggle"]')).toBeTruthy();
  });

  // The trap's two ends came from a query rooted in this shadow root, which
  // stops at every `hv-*` boundary below it. The rows, the sidebar tree and the
  // editor were all past one, so "last focusable" landed in the middle of the
  // surface and Tab walked out through everything behind it.
  it('bounces off the end of the trap into a child component, not out of it', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' }), makeItem({ id: '2' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    const rows = [...(table.shadowRoot?.querySelectorAll('[data-testid="table-row"]') ?? [])];
    // The row menu is the row's last control, and its trigger lives one shadow
    // root deeper still — which is the case this test exists for.
    const lastMenu = defined(rows[rows.length - 1], 'last table row')
      .querySelector('[data-testid="table-row-menu"]')
      ?.shadowRoot?.querySelector('.trigger');

    // Shift+Tab off the front lands on the leading sentinel, which sends focus
    // to the last thing inside the trap.
    (sr.querySelector('.sentinel') as HTMLElement).focus();
    await el.updateComplete;

    expect(deepActiveElement()).toBe(lastMenu);
  });

  it('opens on the first control of the surface, not on something nested in it', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect(deepActiveElement()).toBe(q(barOf(sr), '[data-testid="expand-toggle"]'));
  });
});

describe('hv-full-view: sidebar', () => {
  it('assigns only real locations from the pickers, never an area', async () => {
    const areaLocations = [{ ...loc('garage', 'Garage'), area_id: 'area-garage' }];
    const { el, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'garage' })],
      locations: areaLocations,
      areas: [{ id: 'area-garage', name: 'Garage' }],
    });
    (q(barOf(sr), '[data-testid="full-add-item"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    const locationField = q(editor, 'hv-editor-location') as HTMLElement;
    (locationField.shadowRoot?.querySelector('[data-testid="editor-location"]') as HTMLButtonElement).click();
    await settle(el);

    const picker = locationField.shadowRoot?.querySelector(
      '[data-testid="editor-location-tree"]',
    ) as HTMLElement;
    const head = picker.shadowRoot?.querySelector('[data-testid="tree-area-head"]');
    expect(head, 'the picker groups by area too').toBeTruthy();
    expect(picker.shadowRoot?.querySelector('[data-testid="tree-area-select"]')).toBe(null);
  });

  // The sidebar only asks: this surface keeps which sections are open and
  // raises `menu-action`.
  it('answers the sidebar: a heading collapses its section and a "+" opens Organize', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1', category: 'Tools' })] });
    const sidebar = (q(sr, '[data-testid="full-sidebar"]') as HTMLElement).shadowRoot as ShadowRoot;
    const seen: unknown[] = [];
    el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail));

    (q(sidebar, '[data-testid="sidebar-toggle-categories"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sidebar, '[data-testid="sidebar-toggle-categories"]')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(sidebar.querySelectorAll('[data-testid="sidebar-categories-row"]')).toHaveLength(0);
    expect(q(sidebar, '[data-testid="sidebar-toggle-tags"]')?.getAttribute('aria-expanded')).toBe('true');

    (q(sidebar, '[data-testid="sidebar-new-categories"]') as HTMLButtonElement).click();
    expect(seen).toEqual([{ id: 'organize', tab: 'categories' }]);
  });
});

describe('hv-full-view: context bar and table', () => {
  it('breadcrumbs the selected location with its filtered count', async () => {
    const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage')];
    const items = [makeItem({ id: '1', location_id: 'shelf-a' })];
    const { el, store, sr } = await mount({ items, locations });

    expect(q(sr, '[data-testid="full-breadcrumb"]')?.textContent).toContain('All items');

    store.setFilters({ locationIds: ['shelf-a'] });
    await settle(el);
    const crumb = q(sr, '[data-testid="full-breadcrumb"]')?.textContent?.replace(/\s+/g, ' ');
    expect(crumb).toContain('garage › Shelf A');
    // One item is one item, not "1 items".
    expect(crumb).toContain('1 item');
  });

  it('marks the area behind the crumb, where a segment span would read as part of the path', async () => {
    const locations = [
      { ...loc('garage', 'Garage'), area_id: 'area-kitchen' },
      loc('shelf-a', 'Shelf A', 'garage'),
    ];
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'shelf-a' })],
      locations,
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });

    store.setFilters({ locationIds: ['shelf-a'] });
    await settle(el);
    const crumb = q(sr, '[data-testid="full-breadcrumb"]');
    expect(crumb?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(crumb?.textContent?.replace(/\s+/g, ' ')).toContain('garage › Shelf A');
  });

  // Browsing into a root named after its own room must not write the room
  // twice — "Kitchen  Kitchen › Pantry". The crumb elides like every other
  // surface that marks an area, and the pairing stays in the title.
  it('drops the area mark when the crumb already opens with the area name', async () => {
    const kitchen = { ...loc('kitchen', 'Kitchen'), area_id: 'area-kitchen' };
    const pantry: Location = {
      ...loc('pantry', 'Pantry', 'kitchen'),
      path: {
        id_path: ['kitchen', 'pantry'],
        name_path: ['Kitchen', 'Pantry'],
        display_path: 'Kitchen / Pantry',
        sort_key: '',
      },
    };
    for (const [id, path] of [
      ['kitchen', 'Kitchen'],
      ['pantry', 'Kitchen › Pantry'],
    ]) {
      const { el, store, sr } = await mount({
        items: [makeItem({ id: '1', location_id: id })],
        locations: [kitchen, pantry],
        areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
      });
      store.setFilters({ locationIds: [defined(id, 'location id')] });
      await settle(el);

      const crumb = q(sr, '[data-testid="full-breadcrumb"]');
      expect(crumb?.querySelector('.hv-area-chip'), path).toBe(null);
      expect(crumb?.textContent?.replace(/\s+/g, ' ').trim(), path).toContain(path);
      expect(crumb?.getAttribute('title'), path).toBe(`Area: Kitchen · ${path}`);
      el.remove();
    }
  });

  it('leaves the crumb of an arealess tree exactly as it was', async () => {
    const locations = [loc('garage', 'Garage'), loc('shelf-a', 'Shelf A', 'garage')];
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', location_id: 'shelf-a' })],
      locations,
      areas: [{ id: 'area-kitchen', name: 'Kitchen' }],
    });

    store.setFilters({ locationIds: ['shelf-a'] });
    await settle(el);
    expect(q(sr, '[data-testid="full-breadcrumb"]')?.querySelector('.hv-area-chip')).toBeNull();
  });

  it('sorts from the table headers', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;

    (table.shadowRoot?.querySelector('[data-field="name"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.sort).toEqual({ field: 'name', order: 'asc' });
  });

  it('adjusts quantity from the table row actions', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', quantity: 5 })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;

    (table.shadowRoot?.querySelector('[data-testid="table-increment"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.items[0]?.quantity).toBe(6);
  });

  it('opens the filter panel from the Filters button', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect(sr.querySelector('hv-filter-panel')).toBe(null);

    (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    expect(sr.querySelector('hv-filter-panel')).toBeTruthy();
  });

  it('hands the column picker up to the host card', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const seen: string[] = [];
    el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail.id));

    (q(sr, '[data-testid="columns-expanded"]') as HTMLButtonElement).click();
    expect(seen).toEqual(['columns']);
  });

  // Organize has a button of its own on the app bar, embedded and modal alike;
  // the ⋮ entry stays beside it, held by the hosts' menu-order pins.
  it('opens Organize from a button on the app bar', async () => {
    for (const embedded of [false, true]) {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      el.embedded = embedded;
      await settle(el);
      const seen: unknown[] = [];
      el.addEventListener('menu-action', (e) => seen.push((e as CustomEvent).detail));

      const button = q(barOf(sr), '[data-testid="full-organize"]') as HTMLButtonElement;
      expect(button, embedded ? 'embedded' : 'modal').toBeTruthy();
      expect(button.getAttribute('aria-label')).toBe('Organize');
      button.click();

      // No tab named: Organize opens on its default, Locations.
      expect(seen).toEqual([{ id: 'organize' }]);
      el.remove();
    }
  });

  // The same sentence the card's footer prints: one fact, one phrasing, and it
  // names what it is counting.
  it('counts loaded rows against the filtered total, in the words the card uses', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}`, checked_out: true }));
    const { el, store, sr } = await mount({ items });
    expect(q(sr, '[data-testid="full-footer"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Showing 50 of 60 items · scroll to load more',
    );

    store.setFilters({ q: 'i1' });
    await settle(el);
    await settle(el);
    expect(q(sr, '[data-testid="full-footer"]')?.textContent).toContain('matching item');
  });
});

// The card's list named the situation, explained it and offered a way out. This
// table answered with one bare sentence and nothing to press — on the surface
// with a sidebar, an app-bar search and a filter panel, where you are most
// likely to filter yourself down to nothing.
describe('hv-full-view: empty table', () => {
  it('offers a way out of an over-filtered table', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    store.setFilters({ q: 'nothing matches this' });
    await settle(el);
    await settle(el);

    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    expect(table.shadowRoot?.querySelector('[data-testid="table-empty"]')).toBeTruthy();
    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('no-matches');
    expect(empty.textContent).toContain('No items match these filters');

    (q(sr, '[data-testid="empty-action"][data-id="clear-filters"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.filters.q).toBe('');
  });

  it('treats a lone location filter as an empty location, and offers to fill it', async () => {
    const { el, store, sr } = await mount({ items: [], locations: [loc('garage', 'Garage')] });
    store.setFilters({ locationIds: ['garage'] });
    await settle(el);
    await settle(el);

    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('empty-location');
    expect(empty.textContent).toContain('Nothing in Garage');

    (q(sr, '[data-testid="empty-action"][data-id="add-item"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();
  });

  it('names an untouched inventory rather than the filters', async () => {
    const { sr } = await mount({ items: [] });
    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('no-items');
    expect(empty.textContent).toContain('No items yet');
  });

  it('waits for the fetch instead of blaming the filters for the gap', async () => {
    // Changing a filter clears the rows and asks for the next page, so between
    // the two the table has nothing to show and no answer yet. Filling that gap
    // with "No items match these filters" and a Clear all button blames a
    // filter nothing has been counted for.
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    store.setFilters({ q: 'wood' });
    await el.updateComplete;

    const empty = q(sr, '[data-testid="empty-state"]') as HTMLElement;
    expect(empty.dataset.kind).toBe('loading');
    expect(empty.textContent).toContain('Loading items');
    expect(q(sr, '[data-testid="empty-action"]')).toBe(null);

    await settle(el);
    await settle(el);
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    expect(table.shadowRoot?.querySelector('[data-testid="table-row"]')).toBeTruthy();
  });
});

describe('hv-full-view: editing', () => {
  it('edits in place above the table', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;

    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    expect(editor).toBeTruthy();
    expect(editor.shadowRoot?.textContent).toContain('Wood Glue — editing');
  });

  // What reaches the server is the whole point of the diff: the household's
  // ordinary case is two members on one item, and the frame is where the other
  // one's change is either kept or quietly written back.
  it('sends the edited field and the version it was checked against, nothing more', async () => {
    const { el, store, hass, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Wood Glue', quantity: 10, version: 2 })],
    });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    const description = editor.shadowRoot?.querySelector(
      '[data-testid="editor-description"]',
    ) as HTMLTextAreaElement;
    description.value = 'mine';
    description.dispatchEvent(new Event('input'));
    await settle(el);

    // The other member bumps the quantity from their own phone, and the event
    // reaches this card while the form is open.
    const bumped = makeItem({ id: '1', name: 'Wood Glue', quantity: 15, version: 3 });
    hass.__setItems([bumped]);
    hass.__emit('items', 'updated', { item: bumped });
    await settle(el);

    (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    const frame = hass.__messages.filter((m) => m.type === 'haventory/item/update').at(-1);
    expect(frame).toEqual({
      type: 'haventory/item/update',
      item_id: '1',
      description: 'mine',
      expected_version: 3,
    });
    expect(store.state.value.items.find((i) => i.id === '1')?.quantity).toBe(15);
  });

  it('adds an item from the app bar', async () => {
    const { el, store, sr } = await mount({ items: [] });
    (q(barOf(sr), '[data-testid="full-add-item"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'From full view';
    name.dispatchEvent(new Event('input'));
    (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(store.state.value.items.map((i) => i.name)).toContain('From full view');
    expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
  });

  // Without this the editor renders `.item` as null once the row is gone —
  // and a null item is the create form. On the panel there is no shell to
  // clean up after the editor, so the view closes it itself, and says why when
  // the delete was not sent from here.
  it.each([
    { from: 'this view', embedded: false, typed: true, notice: null },
    { from: 'another device', embedded: false, typed: false, notice: DELETED_ELSEWHERE },
    { from: 'another device', embedded: true, typed: true, notice: DELETED_ELSEWHERE_UNSAVED },
  ])(
    'closes the editor when the item being edited is deleted from $from (embedded: $embedded)',
    async ({ from, embedded, typed, notice }) => {
      const { el, store, hass, sr } = await mount({
        items: [makeItem({ id: '1', name: 'Wood Glue' })],
        embedded,
      });
      const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
      (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
      await settle(el);
      const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
      expect(editor).toBeTruthy();
      if (typed) {
        const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
        name.value = 'Typed but unsaved';
        name.dispatchEvent(new Event('input'));
        await settle(el);
      }

      if (from === 'this view') await store.deleteItem('1', 1);
      else hass.__deleteElsewhere('1');
      await settle(el);

      expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
      expect(deletedNotice(sr)).toBe(notice);
    },
  );

  // The backend announces each row of a batch before it answers the batch, so
  // these deletes arrive as events before the store hears they were its own.
  it('closes the editor without a notice on a batch delete sent from here', async () => {
    const { el, store, hass, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();
    const call = hass.callWS.bind(hass);
    hass.callWS = async <T>(msg: Record<string, unknown>): Promise<T> => {
      const answer = await call<T>(msg);
      if (msg.type === 'haventory/item/delete') {
        hass.__emit('items', 'deleted', { item: makeItem({ id: String(msg.item_id), name: 'Wood Glue' }) });
      }
      return answer;
    };

    const outcome = await store.bulkExecute([makeBulkOp('item_delete', { item_id: '1', expected_version: 1 })]);
    await settle(el);

    expect(outcome.failed).toEqual([]);
    expect(store.state.value.items).toEqual([]);
    expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
    expect(deletedNotice(sr)).toBe(null);
  });

  it('keeps the editor open when some other item is deleted', async () => {
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Wood Glue' }), makeItem({ id: '2', name: 'Clamps' })],
    });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();

    await store.deleteItem('2', 1);
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();
  });

  // A row that stops matching is not a row that stopped existing: the typed
  // edits are still worth saving, so the form is pinned and says why.
  it('pins the editor when a filter change drops the item from the list', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement & { item: { name: string } | null };
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'Wood Glue EDITED';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(el);

    store.setFilters({ q: 'matches nothing at all' });
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBe(editor);
    expect(editor.item?.name).toBe('Wood Glue');
    expect((editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement).value).toBe(
      'Wood Glue EDITED',
    );
    expect(q(sr, '[data-testid="pinned-editor-hint"]')?.textContent).toContain(
      'No longer matches the current filters',
    );
  });

  // The form is keyed by item id, so another row's form starts from that row
  // with nothing carried over, and takes the focus as a first open does.
  it('starts a new form for another row', async () => {
    const { el, sr, host } = await mount({
      items: [makeItem({ id: '1', name: 'Wood Glue' }), makeItem({ id: '2', name: 'Epoxy' })],
    });
    const edits = () => [
      ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll<HTMLButtonElement>(
        '[data-testid="table-edit"]',
      ) ?? []),
    ];
    defined(edits()[0], 'first edit button').click();
    await settle(el);
    const first = q(sr, '[data-testid="full-editor"]') as HTMLElement & { dirty: boolean };
    const name = first.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'Wood Glue EDITED';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(el);

    defined(edits()[1], 'second edit button').click();
    await settle(el);
    host.answer('discard');
    await settle(el);

    const next = q(sr, '[data-testid="full-editor"]') as HTMLElement & { dirty: boolean };
    expect(next).not.toBe(first);
    expect(next.dirty).toBe(false);
    const nextName = next.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    expect(nextName.value).toBe('Epoxy');
    expect(next.shadowRoot?.activeElement).toBe(nextName);
  });

  // This surface fills the screen, so the card's banner list is not behind it:
  // without a sentence inside the form the user is left with a form that did not
  // close and no account of why.
  describe('a rejected save', () => {
    const openEditor = async (el: HVFullView, sr: ShadowRoot) => {
      const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
      (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
      await settle(el);
      return q(sr, '[data-testid="full-editor"]') as HTMLElement & { busy: boolean };
    };
    const save = async (el: HVFullView, sr: ShadowRoot) => {
      const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
      const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
      name.value = 'New';
      name.dispatchEvent(new Event('input'));
      (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);
    };
    const errorText = (sr: ShadowRoot) =>
      q<HTMLElement>(sr, '[data-testid="full-editor"]')?.shadowRoot?.querySelector(
        '[data-testid="editor-error"]',
      )?.textContent;

    it('names itself inside the open form and clears the busy state', async () => {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      store['ws'].updateItem = async () => {
        throw { code: 'storage_error', message: 'the store is read-only' };
      };

      const editor = await openEditor(el, sr);
      await save(el, sr);

      expect(errorText(sr)).toContain('the store is read-only');
      expect(editor.busy).toBe(false);
      expect(
        (
          editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement
        ).textContent?.trim(),
      ).toBe('Save');
    });

    // Version numbers say nothing to someone looking at a form, and the two
    // hosts of the editor share the sentence rather than each writing one.
    it('says a conflict in the same words the card does', async () => {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      store['ws'].updateItem = async () => {
        throw { code: 'conflict', message: 'version conflict: expected 1, actual 2' };
      };

      await openEditor(el, sr);
      await save(el, sr);

      expect(errorText(sr)).toContain('Someone else changed this item');
    });

    it('clears once the save lands', async () => {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      const reject = async () => {
        throw { code: 'storage_error', message: 'the store is read-only' };
      };
      store['ws'].updateItem = reject;

      await openEditor(el, sr);
      await save(el, sr);
      expect(errorText(sr)).toContain('the store is read-only');

      store['ws'].updateItem = async (id: string) => ({ ...makeItem({ id, name: 'New' }), version: 2 });
      await save(el, sr);

      expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
    });

    it('drops the error again when the next edit opens', async () => {
      const { el, store, sr, host } = await mount({
        items: [makeItem({ id: '1', name: 'Old' }), makeItem({ id: '2', name: 'Other' })],
      });
      store['ws'].updateItem = async () => {
        throw { code: 'storage_error', message: 'the store is read-only' };
      };

      await openEditor(el, sr);
      await save(el, sr);
      expect(errorText(sr)).toContain('the store is read-only');

      const rows = [
        ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
          '[data-testid="table-edit"]',
        ) ?? []),
      ] as HTMLButtonElement[];
      defined(rows[rows.length - 1], 'last edit button').click();
      await settle(el);
      // The refused save left the typed name in the form, so the switch asks
      // before it takes it away.
      expect(host.asked).toBe(1);
      host.answer('discard');
      await settle(el);

      expect(q(sr, '[data-testid="full-editor"]')?.shadowRoot?.textContent).toContain('Other — editing');
      expect(errorText(sr)).toBeUndefined();
    });
  });

  it('releases the pin when the editor is cancelled', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Wood Glue' })] });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    store.setFilters({ q: 'matches nothing at all' });
    await settle(el);
    await settle(el);
    expect(q(sr, '[data-testid="pinned-editor-hint"]')).toBeTruthy();

    q(sr, '[data-testid="full-editor"]')?.dispatchEvent(
      new CustomEvent('cancel', { bubbles: true, composed: true }),
    );
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
    expect(q(sr, '[data-testid="pinned-editor-hint"]')).toBe(null);
  });
});

// Switching rows, the backdrop and Escape all wiped a form mid-sentence. The
// card's row switch had asked since it shipped; this surface asked nowhere.
describe('hv-full-view: leaving a dirty form always asks', () => {
  /** Open the first row's editor and type into it. */
  async function dirtyEditor(items: Item[]) {
    const mounted = await mount({ items });
    const { el, sr } = mounted;
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'Typed but unsaved';
    name.dispatchEvent(new Event('input'));
    await settle(el);
    return mounted;
  }

  const editorName = (sr: ShadowRoot) =>
    (
      q<HTMLElement>(sr, '[data-testid="full-editor"]')?.shadowRoot?.querySelector(
        '[data-testid="editor-name"]',
      ) as HTMLInputElement | null
    )?.value;

  const two = () => [makeItem({ id: '1', name: 'First' }), makeItem({ id: '2', name: 'Second' })];

  /** Every way out of the open form on this surface. */
  const leave = {
    'row switch': (sr: ShadowRoot) => {
      const rows = [
        ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
          '[data-testid="table-edit"]',
        ) ?? []),
      ] as HTMLButtonElement[];
      defined(rows[rows.length - 1], 'last edit button').click();
    },
    backdrop: (sr: ShadowRoot) => (q(sr, '.backdrop') as HTMLElement).click(),
    escape: (sr: ShadowRoot) =>
      (q(sr, '[data-testid="full-view"]') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    close: (sr: ShadowRoot) => (q(barOf(sr), '[data-testid="expand-toggle"]') as HTMLButtonElement).click(),
  } as const;

  it.each(Object.keys(leave) as (keyof typeof leave)[])(
    '%s asks first and changes nothing until it is answered',
    async (how) => {
      const { el, sr, host } = await dirtyEditor(two());
      let closes = 0;
      el.addEventListener('close', () => {
        closes += 1;
      });

      leave[how](sr);
      await settle(el);

      expect(host.asked).toBe(1);
      expect(closes).toBe(0);
      expect(el.open).toBe(true);
      expect(editorName(sr)).toBe('Typed but unsaved');
    },
  );

  it('opens the other row once the discard is confirmed', async () => {
    const { el, sr, host } = await dirtyEditor(two());

    leave['row switch'](sr);
    await settle(el);
    host.answer('discard');
    await settle(el);

    expect(q(sr, '[data-testid="full-editor"]')?.shadowRoot?.textContent).toContain('Second — editing');
    expect(editorName(sr)).toBe('Second');
  });

  it.each(['backdrop', 'escape', 'close'] as const)('closes the view once %s is confirmed', async (how) => {
    const { el, sr, host } = await dirtyEditor(two());
    let closes = 0;
    el.addEventListener('close', () => {
      closes += 1;
    });

    leave[how](sr);
    await settle(el);
    host.answer('discard');
    await settle(el);

    expect(closes).toBe(1);
    expect(el.open).toBe(false);
  });

  it('leaves a clean form without a word', async () => {
    const { el, sr, host } = await mount({ items: two() });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);

    leave['row switch'](sr);
    await settle(el);

    expect(host.asked).toBe(0);
    expect(editorName(sr)).toBe('Second');
  });

  // The panel has no backdrop, no Escape and no close button, but it switches
  // rows in the same table.
  it('asks on a row switch in the embedded panel too', async () => {
    const { el, sr, host } = await mount({ items: two(), embedded: true });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const name = (q(sr, '[data-testid="full-editor"]') as HTMLElement).shadowRoot?.querySelector(
      '[data-testid="editor-name"]',
    ) as HTMLInputElement;
    name.value = 'Typed but unsaved';
    name.dispatchEvent(new Event('input'));
    await settle(el);

    leave['row switch'](sr);
    await settle(el);

    expect(host.asked).toBe(1);
    expect(editorName(sr)).toBe('Typed but unsaved');
  });

  // The form inside asks through the same host, so this surface's ways out and
  // the form's own Cancel cannot become two different questions.
  it('hands the form the same asker it uses itself', async () => {
    const { sr, host } = await dirtyEditor(two());
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement & { confirmDiscard: unknown };
    expect(editor.confirmDiscard).toBe(host.ask);
  });

  it('keeps the form when the question is declined', async () => {
    const { el, sr, host } = await dirtyEditor(two());

    leave.backdrop(sr);
    await settle(el);
    host.answer('keep');
    await settle(el);

    expect(el.open).toBe(true);
    expect(editorName(sr)).toBe('Typed but unsaved');
  });
});

// This surface switches its own layout on a media query, but its two biggest
// children switch theirs on a `mobile` property that only the card ever set —
// so at 375px the expanded view drew the editor's three-column desktop grid in
// 156px + 78px + 78px, with "Low-stock at" wrapping over its own field.
describe('hv-full-view: phone-width children', () => {
  it('tells the item editor when it is on a phone', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [] });
      (q(barOf(sr), '[data-testid="full-add-item"]') as HTMLButtonElement).click();
      await settle(el);
      expect(q(sr, '[data-testid="full-editor"]')?.hasAttribute('mobile')).toBe(true);
    } finally {
      restore();
    }
  });

  it('leaves the editor on its desktop layout at desktop widths', async () => {
    const restore = stubViewport(false);
    try {
      const { el, sr } = await mount({ items: [] });
      (q(barOf(sr), '[data-testid="full-add-item"]') as HTMLButtonElement).click();
      await settle(el);
      expect(q(sr, '[data-testid="full-editor"]')?.hasAttribute('mobile')).toBe(false);
    } finally {
      restore();
    }
  });

  // The table is scrolled sideways at this width, so its LOCATION column is off
  // the screen — and a wrapped path there was still setting the row's height.
  // The table cannot read the media query itself; this is where it learns.
  it('tells the table when it is on a phone', async () => {
    for (const narrow of [true, false]) {
      const restore = stubViewport(narrow);
      try {
        const { sr } = await mount({ items: [makeItem({ id: '1' })] });
        expect(q(sr, '[data-testid="full-table"]')?.hasAttribute('narrow'), String(narrow)).toBe(narrow);
      } finally {
        restore();
      }
    }
  });

  // The panel stages its edits on a phone and drops its own footer, expecting
  // its host to provide one. Telling it "phone" without that would stage every
  // edit with no way to apply it.
  it('stages the phone filter panel behind a commit row', async () => {
    const restore = stubViewport(true);
    try {
      const { el, store, sr } = await mount({
        items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })],
      });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      expect(panel.hasAttribute('mobile')).toBe(true);
      expect(q(sr, '[data-testid="full-panel-foot"]')).toBeTruthy();

      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      // Staged, not applied.
      expect(store.state.value.filters.lowStockOnly).toBe(false);

      (q(sr, '[data-testid="full-panel-apply"]') as HTMLButtonElement).click();
      await settle(el);
      expect(store.state.value.filters.lowStockOnly).toBe(true);
      // Applying closes the panel, as it does in the card's filter sheet.
      expect(q(sr, '[data-testid="full-filter-panel"]')).toBe(null);
    } finally {
      restore();
    }
  });

  // aria-expanded on its own says only that something opened; which element it
  // opened was left to whatever happened to follow the button in reading order.
  it('names the holder the Filters button discloses, open or shut', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const toggle = () => q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement;
    const id = 'full-view-filter-panel';

    expect(toggle().getAttribute('aria-controls')).toBe(id);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // The id has to resolve in both states — a button pointing at nothing
    // announces as controlling nothing — so the holder outlives the panel.
    const shut = sr.getElementById(id);
    expect(shut, 'holder shut').toBeTruthy();
    expect(shut?.querySelector('[data-testid="full-filter-panel"]'), 'no panel while shut').toBe(null);

    toggle().click();
    await settle(el);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(id);
    expect(sr.getElementById(id)?.querySelector('[data-testid="full-filter-panel"]')).toBeTruthy();
  });

  // The holder sets a display of its own, which outranks the browser's rule for
  // [hidden] — without this it would lay out its padding while empty.
  it('takes the shut holder out of the layout it would otherwise pad', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect((sr.getElementById('full-view-filter-panel') as HTMLElement).hidden).toBe(true);
    expect(componentCss('hv-full-view')).toMatch(/\.panel-holder\[hidden\] \{[^}]*display: none/);

    (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
    await settle(el);
    expect((sr.getElementById('full-view-filter-panel') as HTMLElement).hidden).toBe(false);
  });

  it('keeps the desktop panel live-applying, with no commit row', async () => {
    const restore = stubViewport(false);
    try {
      const { el, store, sr } = await mount({
        items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })],
      });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      expect(panel.hasAttribute('mobile')).toBe(false);
      expect(q(sr, '[data-testid="full-panel-foot"]')).toBe(null);

      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      expect(store.state.value.filters.lowStockOnly).toBe(true);
    } finally {
      restore();
    }
  });

  // Three controls on one 375px row is one too many for a language that spells
  // `hv.action.clearAll` in two long words: the clear button broke over two
  // lines and stacked the primary button's count sentence over three. The
  // card's filter sheet already carries the clear in a head row; this is that
  // shape.
  it('carries the clear-all in a head row and leaves the phone footer two buttons', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const head = q(sr, '[data-testid="full-panel-head"]') as HTMLElement;
      expect(head).toBeTruthy();
      expect(head.querySelector('[data-testid="full-panel-clear"]')).toBeTruthy();

      const foot = q(sr, '[data-testid="full-panel-foot"]') as HTMLElement;
      expect([...foot.querySelectorAll('button')].map((b) => b.dataset.testid)).toEqual([
        'full-panel-cancel',
        'full-panel-apply',
      ]);
      // The head is read before the filters it clears, so it sits above the
      // scroll box rather than after it.
      expect(head.nextElementSibling?.classList.contains('panel-scroll')).toBe(true);
    } finally {
      restore();
    }
  });

  it('clears the staged set from the moved clear button, and counts what is staged', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const count = () => (q(sr, '[data-testid="full-panel-count"]') as HTMLElement).textContent?.trim();
      expect(count()).toBe('0 active');

      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      expect(count()).toBe('1 active');

      (q(sr, '[data-testid="full-panel-clear"]') as HTMLButtonElement).click();
      await settle(el);
      expect(count()).toBe('0 active');
      expect(
        (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLElement).getAttribute(
          'aria-pressed',
        ),
      ).toBe('false');
    } finally {
      restore();
    }
  });

  // Turn the phone sideways with the panel open and the panel drops its own
  // draft, because it is no longer the surface that stages one. A staged set
  // held across that flip would leave the head row counting filters the
  // controls under it no longer carry.
  it('drops the staged set when the viewport stops being narrow', async () => {
    // The stub is the restore, and it announces the flip.
    const viewport = stubViewport(true);
    try {
      const { el, sr } = await mount({
        items: [makeItem({ id: '1', quantity: 0, low_stock_threshold: 5 })],
      });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      const count = () => (q(sr, '[data-testid="full-panel-count"]') as HTMLElement).textContent?.trim();
      const panel = q(sr, '[data-testid="full-filter-panel"]') as HTMLElement;
      (panel.shadowRoot?.querySelector('[data-testid="filter-low-stock-only"]') as HTMLButtonElement).click();
      await settle(el);
      expect(count()).toBe('1 active');

      viewport.announce(false);
      await settle(el);
      expect(q(sr, '[data-testid="full-panel-head"]'), 'no phone head row on a desktop width').toBe(null);

      viewport.announce(true);
      await settle(el);
      expect(count()).toBe('0 active');
    } finally {
      viewport();
    }
  });

  it('leaves the desktop panel without a head row', async () => {
    const restore = stubViewport(false);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
      (q(sr, '[data-testid="full-filters-toggle"]') as HTMLButtonElement).click();
      await settle(el);

      expect(q(sr, '[data-testid="full-panel-head"]')).toBe(null);
      expect(q(sr, '[data-testid="full-panel-clear"]')).toBe(null);
    } finally {
      restore();
    }
  });

  // The ⋮ menu carries "Columns…" on every host, so the phone toolbar can drop
  // the icon button and keep its remaining controls on one row.
  it('drops the column picker button on a phone', async () => {
    const restore = stubViewport(true);
    try {
      const { sr } = await mount({ items: [makeItem({ id: '1' })] });
      expect(q(sr, '[data-testid="columns-expanded"]')).toBe(null);
    } finally {
      restore();
    }
  });

  it('keeps the column picker button where the row has room for it', async () => {
    const restore = stubViewport(false);
    try {
      const { sr } = await mount({ items: [makeItem({ id: '1' })] });
      expect(q(sr, '[data-testid="columns-expanded"]')).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe('hv-full-view: selection and bulk actions', () => {
  const table = (sr: ShadowRoot) => sr.querySelector('[data-testid="full-table"]') as HTMLElement;

  async function enterSelection(el: HVFullView, sr: ShadowRoot) {
    const menu = barOf(sr).querySelector('[data-testid="full-overflow"]') as HTMLElement;
    (menu.shadowRoot?.querySelector('[data-testid="overflow-trigger"]') as HTMLButtonElement).click();
    await settle(el);
    (menu.shadowRoot?.querySelector('[data-id="select-items"]') as HTMLButtonElement).click();
    await settle(el);
  }

  const withSelectEntry = { entries: [{ id: 'select-items', label: 'Select items…' }] };

  it('swaps the app bar for the selection bar', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1' })] });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    expect(q(barOf(sr), '[data-testid="selection-bar"]')).toBe(null);

    await enterSelection(el, sr);
    expect(q(barOf(sr), '[data-testid="selection-bar"]')).toBeTruthy();
    // The normal app bar is gone, not stacked.
    expect(q(barOf(sr), '[data-testid="full-add-item"]')).toBe(null);
  });

  it('counts the selection honestly against the filtered total', async () => {
    const items = Array.from({ length: 60 }, (_, i) => makeItem({ id: `i${i}`, checked_out: true }));
    const { el, store, sr } = await mount({ items });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(barOf(sr), '[data-testid="selection-count"]')?.textContent).toContain('50 selected');
    expect(q(barOf(sr), '[data-testid="selection-subcount"]')?.textContent).toContain('of 60 matching');
    // And it says out loud that select-all only covered what is loaded.
    expect(q(sr, '[data-testid="selection-honesty"]')?.textContent).toContain(
      'Select-all covers loaded rows only',
    );
    expect(store.state.value.selection.size).toBe(50);

    // The bar in the child reaches the same store: one action runs end to end.
    const bar = q(sr, 'hv-full-bulk')!.shadowRoot as ShadowRoot;
    (q(bar, 'hv-bulk-bar')!.shadowRoot?.querySelector('[data-action="check-in"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(store.state.value.items.every((i) => !i.checked_out)).toBe(true);
  });

  it('exits selection mode and clears the selection', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1' })] });
    el.menuEntries = withSelectEntry.entries;
    await settle(el);
    await enterSelection(el, sr);

    (table(sr).shadowRoot?.querySelector('[data-testid="table-select-all"]') as HTMLButtonElement).click();
    await settle(el);
    expect(store.state.value.selection.size).toBe(1);

    (q(barOf(sr), '[data-testid="exit-selection"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.selection.size).toBe(0);
    expect(q(barOf(sr), '[data-testid="selection-bar"]')).toBe(null);
    expect(q(barOf(sr), '[data-testid="full-add-item"]')).toBeTruthy();
  });
});

// A lost connection, paused live updates and a refused operation showed on the
// card and nowhere else — and this surface and the panel are the ones that fill
// the screen, so the card's copy is not behind them to be read.
describe('hv-full-view: failures are visible here too', () => {
  const banner = (sr: ShadowRoot, testid: string) => q(sr, `[data-testid="${testid}"]`);

  it('says nothing while everything is fine', async () => {
    const { sr } = await mount({ items: [makeItem({ id: '1' })] });
    expect(banner(sr, 'degraded-banners')).toBe(null);
    expect(banner(sr, 'banners')).toBe(null);
  });

  it('says the connection is lost and asks its host for the re-read', async () => {
    const { el, store, hass, sr } = await mount({ items: [makeItem({ id: '1' })] });
    const actions: string[] = [];
    el.addEventListener('menu-action', (e) => actions.push((e as CustomEvent).detail.id));

    hass.__failNext(2, new Error('socket closed'));
    await store.refreshStats().catch(() => undefined);
    await store.refreshStats().catch(() => undefined);
    await settle(el);

    expect(banner(sr, 'degraded-offline')).toBeTruthy();
    (banner(sr, 'degraded-reconnect') as HTMLButtonElement).click();
    // The dialogs and the re-read live in the host's HostSurfaces, and both
    // hosts already answer this entry.
    expect(actions).toEqual(['refresh']);
  });

  it('carries the error queue with its conflict actions', async () => {
    const { el, store, hass, sr } = await mount({ items: [makeItem({ id: '1', name: 'A' })] });
    store['pushError'](
      { code: 'conflict', message: 'version conflict' },
      { itemId: '1', changes: { name: 'B' } },
    );
    await settle(el);

    expect((banner(sr, 'banner-entry') as HTMLElement).dataset.code).toBe('conflict');
    expect(banner(sr, 'banner-view-latest')).toBeTruthy();

    hass.__setConflict(false);
    (banner(sr, 'banner-reapply') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.items.find((i) => i.id === '1')?.name).toBe('B');
    expect(banner(sr, 'banner-entry')).toBe(null);
  });

  // Re-apply resends what the refused save carried, on whatever version the
  // server now holds. That payload is the diff, so the retry lands the typed
  // field and leaves the change that caused the conflict standing.
  it('re-applies only the field the refused save changed', async () => {
    const { el, store, hass, sr } = await mount({
      items: [makeItem({ id: '1', name: 'A', quantity: 10, version: 2 })],
    });
    hass.__setConflict(true);

    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    const description = editor.shadowRoot?.querySelector(
      '[data-testid="editor-description"]',
    ) as HTMLTextAreaElement;
    description.value = 'mine';
    description.dispatchEvent(new Event('input'));
    await settle(el);
    (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    // The change this card never saw is what the conflict was about, and it is
    // still on the server when the retry goes out.
    hass.__setItems([makeItem({ id: '1', name: 'A', quantity: 15, version: 3 })]);
    hass.__setConflict(false);
    (banner(sr, 'banner-reapply') as HTMLButtonElement).click();
    await settle(el);

    const frame = hass.__messages.filter((m) => m.type === 'haventory/item/update').at(-1);
    expect(frame).toEqual({ type: 'haventory/item/update', item_id: '1', description: 'mine' });
    expect(store.state.value.items.find((i) => i.id === '1')?.quantity).toBe(15);
  });

  // "View latest" is how the member whose save lost the race sees what the
  // other one wrote; the panel renders this view embedded, so both carry it.
  it.each([
    { variant: 'the overlay', embedded: false },
    { variant: 'the panel', embedded: true },
  ])('starts the open form over from the newer version in $variant', async ({ embedded }) => {
    const { el, hass, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Old', version: 4 })],
      embedded,
    });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const form = () => (q(sr, '[data-testid="full-editor"]') as HTMLElement).shadowRoot;
    const name = form()?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'Mine';
    name.dispatchEvent(new Event('input'));
    await settle(el);
    hass.__setConflict(true);
    (form()?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    expect(form()?.querySelector('[data-testid="editor-error"]')).toBeTruthy();

    hass.__setConflict(false);
    hass.__setItems([makeItem({ id: '1', name: 'Theirs', version: 5 })]);
    (banner(sr, 'banner-view-latest') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect((form()?.querySelector('[data-testid="editor-name"]') as HTMLInputElement).value).toBe('Theirs');
    expect(form()?.querySelector('[data-testid="editor-version"]')?.textContent).toContain('v5');
    expect(form()?.querySelector('[data-testid="editor-error"]')).toBe(null);
  });

  it('dismisses a plain error, which carries no conflict actions', async () => {
    const { el, store, sr } = await mount({ items: [] });
    store['pushError']({ code: 'storage_error', message: 'disk full' });
    await settle(el);

    expect(banner(sr, 'banner-view-latest')).toBe(null);
    (banner(sr, 'banner-dismiss') as HTMLButtonElement).click();
    await settle(el);
    expect(banner(sr, 'banner-entry')).toBe(null);
  });

  // The panel renders nothing but this component's embedded variant, so this is
  // the only place its banners can come from.
  it('renders them in the embedded variant the panel uses', async () => {
    const { el, store, sr } = await mount({ items: [], embedded: true });
    store['pushError']({ code: 'storage_error', message: 'disk full' });
    await settle(el);

    expect(banner(sr, 'banner-entry')?.shadowRoot?.textContent).toContain('disk full');
  });

  // Two ways of saying a save failed would be one too many. The sentence in the
  // form is the save's; the queue carries everything with nowhere else to be.
  it('leaves the open form to speak for a refused save', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
    store['ws'].updateItem = async () => {
      throw { code: 'storage_error', message: 'the store is read-only' };
    };
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(sr, '[data-testid="full-editor"]') as HTMLElement;
    (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);

    expect(
      (q(sr, '[data-testid="full-editor"]') as HTMLElement).shadowRoot?.querySelector(
        '[data-testid="editor-error"]',
      )?.textContent,
    ).toContain('the store is read-only');
    // And the queue still holds it, so dismissing the form does not lose it.
    expect(banner(sr, 'banner-entry')).toBeTruthy();
  });
});

// Every action the card's rows offer is on the table's rows too, through a
// visible control rather than a key with nothing on screen to match it.
describe('hv-full-view: table row actions', () => {
  const pick = (sr: ShadowRoot, id: string, row = 0) => {
    const menus = [
      ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
        '[data-testid="table-row-menu"]',
      ) ?? []),
    ];
    defined(menus[row], `menu ${row}`).dispatchEvent(
      new CustomEvent('select', { detail: { id }, bubbles: true, composed: true }),
    );
  };

  it('checks an item back in', async () => {
    const { el, store, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Drill', checked_out: true })],
    });

    pick(sr, 'check-in');
    await settle(el);

    expect(store.state.value.items.find((i) => i.id === '1')?.checked_out).toBe(false);
  });

  it('asks for a due date before checking out, and applies the one picked', async () => {
    const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });

    pick(sr, 'check-out');
    await settle(el);
    const popover = q(sr, '[data-testid="full-checkout"]') as HTMLElement & { open: boolean };
    expect(popover.open).toBe(true);

    (popover.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    await settle(el);

    expect(popover.open).toBe(false);
    expect(store.state.value.items.find((i) => i.id === '1')?.checked_out).toBe(true);
  });

  // The popover's inline step is a static card meant to sit inside the body of
  // the surface that opened it — and this call site is a sibling at the end of
  // the shell with no body around it, so the step landed stranded and unscrimmed
  // at the foot of the page. Anchoring is no better here: the ⋮ it would hang
  // from sits in a column the table scrolls sideways out of view. It presents
  // the way the bulk popover does. How big its controls are is a separate ask,
  // which is why `touch` follows the narrow branch while the placement does not.
  it('presents the single-row check-out centred and scrimmed at every width', async () => {
    for (const narrow of [false, true]) {
      const restore = stubViewport(narrow);
      try {
        const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
        pick(sr, 'check-out');
        await settle(el);

        const popover = q(sr, '[data-testid="full-checkout"]') as HTMLElement & {
          open: boolean;
          inline: boolean;
          touch: boolean;
          anchor: DOMRect | null;
        };
        const where = `narrow=${narrow}`;
        expect(popover.open, where).toBe(true);
        expect(popover.inline, where).toBe(false);
        expect(popover.touch, where).toBe(narrow);
        expect(popover.anchor, where).toBe(null);

        const scrim = popover.shadowRoot?.querySelector('.scrim');
        expect(scrim?.classList.contains('dim'), where).toBe(true);
        const card = popover.shadowRoot?.querySelector('[data-testid="checkout-popover"]');
        expect(card?.getAttribute('style'), where).toContain('left: 50%');

        el.remove();
      } finally {
        restore();
      }
    }
  });

  it('sets a due date on an item already out', async () => {
    const { el, sr } = await mount({
      items: [makeItem({ id: '1', name: 'Drill', checked_out: true })],
    });

    pick(sr, 'set-due-date');
    await settle(el);

    const popover = q(sr, '[data-testid="full-checkout"]') as HTMLElement & {
      open: boolean;
      mode: string;
    };
    expect(popover.open).toBe(true);
    expect(popover.mode).toBe('set-due-date');
  });

  it('hands Delete to the host, which owns the confirmation', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
    const asked: { itemId: string; name: string }[] = [];
    el.addEventListener('request-delete', (e) => asked.push((e as CustomEvent).detail));

    pick(sr, 'delete');
    await settle(el);

    expect(asked).toEqual([{ itemId: '1', name: 'Drill' }]);
  });

  it('opens the form from the menu, through the same dirty guard as a row click', async () => {
    const { el, sr, host } = await mount({
      items: [makeItem({ id: '1', name: 'First' }), makeItem({ id: '2', name: 'Second' })],
    });
    const table = q(sr, '[data-testid="full-table"]') as HTMLElement;
    (table.shadowRoot?.querySelector('[data-testid="table-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const name = (q(sr, '[data-testid="full-editor"]') as HTMLElement).shadowRoot?.querySelector(
      '[data-testid="editor-name"]',
    ) as HTMLInputElement;
    name.value = 'Typed but unsaved';
    name.dispatchEvent(new Event('input'));
    await settle(el);

    pick(sr, 'edit', 1);
    await settle(el);

    expect(host.asked).toBe(1);
  });
});

// The card answers a tap on a row with the detail sheet; this surface answered
// it with the edit form, so the sidebar page at phone width had no read view at
// all — the table it would have been is off the side of the screen.
describe('hv-full-view: the detail sheet is the narrow read view', () => {
  const sheet = (sr: ShadowRoot) =>
    q<HTMLElement & { open: boolean; item: Item | null; updateComplete: Promise<unknown> }>(
      sr,
      '[data-testid="full-detail-sheet"]',
    );
  const openRow = async (el: HVFullView, sr: ShadowRoot, index = 0) => {
    const rows = [
      ...((q(sr, '[data-testid="full-table"]') as HTMLElement).shadowRoot?.querySelectorAll(
        '[data-testid="table-row"]',
      ) ?? []),
    ] as HTMLElement[];
    defined(rows[index], `row ${index}`).click();
    await settle(el);
    await settle(el);
  };

  it('opens the sheet on a row tap, not the form', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
      await openRow(el, sr);

      expect(sheet(sr)?.open).toBe(true);
      expect(sheet(sr)?.item?.name).toBe('Drill');
      expect(q(sr, '[data-testid="full-editor"]')).toBe(null);
    } finally {
      restore();
    }
  });

  it('puts Edit one tap deeper, inside the sheet', async () => {
    const restore = stubViewport(true);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
      await openRow(el, sr);

      const inner = sheet(sr)!;
      (inner.shadowRoot?.querySelector('[data-testid="sheet-edit"]') as HTMLButtonElement).click();
      await inner.updateComplete;

      expect(inner.shadowRoot?.querySelector('[data-testid="sheet-editor"]')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('saves through the surface that owns the store', async () => {
    const restore = stubViewport(true);
    try {
      const { el, store, sr } = await mount({ items: [makeItem({ id: '1', name: 'Old' })] });
      await openRow(el, sr);

      const inner = sheet(sr)!;
      (inner.shadowRoot?.querySelector('[data-testid="sheet-edit"]') as HTMLButtonElement).click();
      await inner.updateComplete;
      const editor = inner.shadowRoot?.querySelector('[data-testid="sheet-editor"]') as HTMLElement;
      const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
      name.value = 'New';
      name.dispatchEvent(new Event('input'));
      await inner.updateComplete;
      (editor.shadowRoot?.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      expect(store.state.value.items.find((i) => i.id === '1')?.name).toBe('New');
      // The sheet is the only surface at this width, so it answers for the save
      // itself: still up, back on the read view, showing what was written.
      expect(sheet(sr)?.open).toBe(true);
      expect(inner.shadowRoot?.querySelector('[data-testid="sheet-editor"]')).toBe(null);
      expect(inner.shadowRoot?.querySelector('[data-testid="sheet-name"]')?.textContent).toContain('New');
    } finally {
      restore();
    }
  });

  // The sheet's scrim covers this view's banner stack. The panel at phone width
  // is this view embedded, so both carry the conflict inside the sheet.
  it.each([
    { variant: 'the overlay', embedded: false },
    { variant: 'the panel', embedded: true },
  ])('offers View latest and Re-apply inside the sheet in $variant', async ({ embedded }) => {
    const restore = stubViewport(true);
    try {
      const { el, hass, sr } = await mount({
        items: [makeItem({ id: '1', name: 'Old', version: 4 })],
        embedded,
      });
      await openRow(el, sr);
      const inner = sheet(sr)!;
      (inner.shadowRoot?.querySelector('[data-testid="sheet-edit"]') as HTMLButtonElement).click();
      await inner.updateComplete;
      const form = () =>
        (inner.shadowRoot?.querySelector('[data-testid="sheet-editor"]') as HTMLElement)
          .shadowRoot as ShadowRoot;
      const name = form().querySelector('[data-testid="editor-name"]') as HTMLInputElement;
      name.value = 'Mine';
      name.dispatchEvent(new Event('input'));
      await inner.updateComplete;
      hass.__setConflict(true);
      (form().querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
      await settle(el);
      await settle(el);

      const dialog = inner.shadowRoot
        ?.querySelector('hv-bottom-sheet')
        ?.shadowRoot?.querySelector('[data-testid="bottom-sheet"]');
      const controls = deepFocusables(dialog);
      const order = controls.map((c) => c.dataset.testid);
      expect(order).toContain('banner-reapply');
      expect(order.indexOf('banner-view-latest')).toBeGreaterThan(order.indexOf('editor-save'));
      expect(q(sr, '[data-testid="banners"]')).toBe(null);

      // What the other member saved, which reached the server but not this view.
      hass.__setConflict(false);
      hass.__setItems([makeItem({ id: '1', name: 'Theirs', version: 5 })]);
      defined(controls.find((c) => c.dataset.testid === 'banner-view-latest')).click();
      await settle(el);
      await settle(el);

      expect((form().querySelector('[data-testid="editor-name"]') as HTMLInputElement).value).toBe('Theirs');
      expect(form().querySelector('[data-testid="editor-error"]')).toBe(null);
      expect(q(sr, '[data-testid="banner-entry"]')).toBe(null);
    } finally {
      restore();
    }
  });

  it.each([
    { from: 'this view', notice: null },
    { from: 'another device', notice: DELETED_ELSEWHERE },
  ])('closes the sheet when the item it shows is deleted from $from', async ({ from, notice }) => {
    const restore = stubViewport(true);
    try {
      const { el, store, hass, sr } = await mount({
        items: [makeItem({ id: '1', name: 'Drill' })],
        embedded: true,
      });
      await openRow(el, sr);
      expect(sheet(sr)?.open).toBe(true);

      const item = defined(store.state.value.items[0], 'first item');
      if (from === 'this view') await store.deleteItem(item.id, item.version);
      else hass.__deleteElsewhere(item.id);
      await settle(el);

      expect(sheet(sr)?.open).toBe(false);
      expect(deletedNotice(sr)).toBe(notice);
    } finally {
      restore();
    }
  });

  // The table is its own read surface at a width that can show it, and the row
  // says most of what the sheet would.
  it('keeps the inline form on a desktop viewport', async () => {
    const restore = stubViewport(false);
    try {
      const { el, sr } = await mount({ items: [makeItem({ id: '1', name: 'Drill' })] });
      await openRow(el, sr);

      expect(q(sr, '[data-testid="full-detail-sheet"]')).toBe(null);
      expect(q(sr, '[data-testid="full-editor"]')).toBeTruthy();
    } finally {
      restore();
    }
  });
});

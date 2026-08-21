import './hv-list-row';
import { makeAttachment, makeItem, makeManual, makeMediaBindings, mountComponent, q } from '../test.utils';
import { MEDIA_NAME_TOKEN_PARAM, attachmentNameToken } from '../ui/media';
import { elideMobilePath, elidePath, isLowStock, rowMenuEntries } from './hv-list-row';
import { addDays, toIsoDate } from '../ui/relative-time';
import type { HVListRow } from './hv-list-row';
import type { Item } from '../store/types';

async function mount(item: Partial<Item>, props: Partial<HVListRow> = {}) {
  const { el } = await mountComponent<HVListRow>('hv-list-row', { item: makeItem(item), ...props });
  return el;
}

function captured(el: HVListRow, names: string[]) {
  const seen: string[] = [];
  for (const name of names) el.addEventListener(name, () => seen.push(name));
  return seen;
}

describe('isLowStock', () => {
  it('treats a null threshold as never low', () => {
    expect(isLowStock(makeItem({ quantity: 0, low_stock_threshold: null }))).toBe(false);
  });

  it('is low at or below the threshold', () => {
    expect(isLowStock(makeItem({ quantity: 3, low_stock_threshold: 3 }))).toBe(true);
    expect(isLowStock(makeItem({ quantity: 4, low_stock_threshold: 3 }))).toBe(false);
  });
});

describe('elidePath', () => {
  it('leaves a path that already fits alone', () => {
    expect(elidePath('Garage')).toBe('Garage');
    expect(elidePath('Garage › Shelf A')).toBe('Garage › Shelf A');
  });

  // The leaf is the whole point: it is the segment that says where the item
  // actually is, and right-clipping was dropping exactly that.
  it('drops the middle rather than the leaf', () => {
    expect(elidePath('Workshop › Parts Cabinet › Drawer A › Small Bin')).toBe('Workshop › … › Small Bin');
  });

  // A phone row has ~200px for this line, and three real segments plus a
  // category needs well over that, so three has to elide as well.
  it('elides at three segments, not just at four', () => {
    expect(elidePath('Workshop › Parts Cabinet › Drawer A')).toBe('Workshop › … › Drawer A');
  });

  it('keeps both ends however deep the tree gets', () => {
    expect(elidePath('A › B › C › D › E › F')).toBe('A › … › F');
  });

  it('handles an item with no location at all', () => {
    expect(elidePath('')).toBe('');
  });
});

describe('elideMobilePath', () => {
  // The area still has to travel through the elision as the leading segment, or
  // a deep path would drop it; what comes back is the same line with the area
  // separated out for the row to mark instead of punctuate.
  it('keeps the room and the bin, and hands the room back on its own', () => {
    expect(elideMobilePath('Garage', 'Workshop › Parts Cabinet › Drawer A › Small Bin')).toEqual({
      area: 'Garage',
      rest: '… › Small Bin',
    });
  });

  it('leaves a path that fits alone, area and all', () => {
    expect(elideMobilePath('Garage', 'Shelf A')).toEqual({ area: 'Garage', rest: 'Shelf A' });
  });

  it('gives back exactly what elidePath does when there is no area', () => {
    const path = 'Workshop › Parts Cabinet › Drawer A › Small Bin';
    expect(elideMobilePath(null, path)).toEqual({ area: null, rest: elidePath(path) });
  });

  // An area name carrying the separator lands as two segments, so the elided
  // string no longer starts with it and there is nothing safe to mark. The line
  // then reads as it always did — the wrong words marked would be worse.
  it('marks nothing when the area name is itself split by the separator', () => {
    const result = elideMobilePath('Kitchen › Pantry', 'Shelf A › Box 2');
    expect(result.area).toBe(null);
    expect(result.rest).toBe(elidePath('Kitchen › Pantry › Shelf A › Box 2'));
  });

  it('marks an area that has no path under it', () => {
    expect(elideMobilePath('Garage', '')).toEqual({ area: 'Garage', rest: '' });
  });
});

describe('hv-list-row: content', () => {
  it('shows the name over location and category', async () => {
    const el = await mount({
      name: 'AA Batteries',
      category: 'Consumables',
      location_path: { id_path: [], name_path: [], display_path: 'Kitchen / Pantry', sort_key: '' },
    });
    expect(q(el, '[data-testid="row-name"]')?.textContent).toContain('AA Batteries');
    expect(el.shadowRoot?.textContent).toContain('Kitchen › Pantry · Consumables');
  });

  it('says so when an item has no location at all', async () => {
    const el = await mount({ name: 'Orphan', category: null });
    expect(el.shadowRoot?.textContent).toContain('No location');
  });

  it('badges low stock and colours the quantity', async () => {
    const el = await mount({ quantity: 2, low_stock_threshold: 8 });
    expect(q(el, '[data-testid="row-low"]')).toBeTruthy();
    expect(q(el, '[data-testid="row-qty"]')?.classList.contains('low')).toBe(true);
  });

  // The stepper used to sit there greyed and check-in was reachable only through
  // the ⋮ menu, which a wide row hides until the row is hovered.
  it('gives a checked-out row the check-in button in the stepper place, at any width', async () => {
    for (const mobile of [false, true]) {
      const el = await mount({ checked_out: true }, { mobile });
      const where = `mobile=${mobile}`;

      expect(q(el, '[data-testid="row-stepper"]'), where).toBe(null);
      const button = q(el, '[data-testid="row-check-in"]');
      expect(button?.textContent?.trim(), where).toBe('Check in');

      const emitted: string[] = [];
      el.addEventListener('check-in', () => emitted.push('check-in'));
      (button as HTMLButtonElement).click();
      expect(emitted, where).toEqual(['check-in']);

      el.remove();
    }

    // Still a secondary path, so a user who reaches for the menu keeps it.
    expect(
      rowMenuEntries(makeItem({ checked_out: true })).some((e) => 'id' in e && e.id === 'check-in'),
    ).toBe(true);
  });

  it('marks a checked-out item on the wide row and keeps its location beside it', async () => {
    const el = await mount({
      checked_out: true,
      category: 'Tools',
      location_path: {
        id_path: [],
        name_path: [],
        display_path: 'Workshop / Drawer A',
        sort_key: '',
      },
    });
    expect(q(el, '[data-testid="row-checked-out"]')?.textContent).toContain('Checked out');
    const secondary = q(el, '[data-testid="row-secondary"]')?.textContent;
    expect(secondary).toContain('Drawer A');
    expect(secondary).toContain('Tools');
  });

  it('calls out an overdue check-out in error colour', async () => {
    const el = await mount({ checked_out: true, due_date: '2020-01-01' });
    const chip = q(el, '[data-testid="row-checked-out"]');
    expect(chip?.classList.contains('error')).toBe(true);
    expect(chip?.textContent).toContain('Overdue');
  });

  it('does not call a future due date overdue', async () => {
    const el = await mount({ checked_out: true, due_date: '2099-01-01' });
    const chip = q(el, '[data-testid="row-checked-out"]');
    expect(chip?.classList.contains('error')).toBe(false);
    expect(chip?.classList.contains('state')).toBe(true);
  });

  // `inspection_date` says when the item is next due for inspection, so a date
  // behind us is a chore waiting — on an item nobody has to have borrowed.
  it('badges a row whose next inspection has passed', async () => {
    const el = await mount({ inspection_date: '2020-01-01' });
    expect(q(el, '[data-testid="row-inspection-due"]')?.textContent?.trim()).toBe('Inspection due');
    expect(q(el, '[data-testid="row-checked-out"]')).toBe(null);
  });

  it('leaves a future or unset inspection date unbadged', async () => {
    for (const mobile of [false, true]) {
      const future = await mount({ inspection_date: '2099-01-01' }, { mobile });
      expect(q(future, '[data-testid="row-inspection-due"]'), `mobile=${mobile}`).toBe(null);

      const unset = await mount({ inspection_date: null }, { mobile });
      expect(q(unset, '[data-testid="row-inspection-due"]'), `mobile=${mobile}`).toBe(null);
    }
  });

  // The standard card is in its phone layout at any ordinary dashboard width,
  // and that branch hangs no chips off the row at all — so the one line it has
  // says it instead, and the badge is not invisible on the commonest surface.
  it('says it on the phone row, where there is no room for a chip', async () => {
    const el = await mount({ inspection_date: '2020-05-06' }, { mobile: true });
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(q(el, '[data-testid="row-inspection-due"]')).toBeTruthy();
    expect(secondary?.textContent).toContain('Inspection due');
    expect(secondary?.classList.contains('inspect')).toBe(true);
  });

  // Someone holding the item outranks a chore on the shelf, so the line keeps
  // saying who has it.
  it('yields the phone line to the checkout state', async () => {
    const el = await mount(
      { checked_out: true, due_date: '2099-01-01', inspection_date: '2020-05-06' },
      { mobile: true },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.textContent).toContain('Checked out');
    expect(secondary?.textContent).not.toContain('Inspection due');
  });

  // An inspection date names the day the item is next due to be inspected, so
  // that day is already asking — the same inclusive boundary the pill's count
  // and the `inspection_due_only` filter use, so the row and the pill agree.
  it('badges an inspection due today', async () => {
    for (const mobile of [false, true]) {
      const el = await mount({ inspection_date: toIsoDate() }, { mobile });
      expect(q(el, '[data-testid="row-inspection-due"]'), `mobile=${mobile}`).toBeTruthy();
    }
  });

  it('leaves an inspection still ahead of today unbadged', async () => {
    for (const mobile of [false, true]) {
      const el = await mount({ inspection_date: addDays(1) }, { mobile });
      expect(q(el, '[data-testid="row-inspection-due"]'), `mobile=${mobile}`).toBe(null);
    }
  });

  it('chips a flagged status on the wide row and leaves ok rows quiet', async () => {
    const missing = await mount({ status: 'missing' });
    expect(q(missing, '[data-testid="row-status"]')?.textContent?.trim()).toBe('Missing');

    const repair = await mount({ status: 'needs_repair' });
    expect(q(repair, '[data-testid="row-status"]')?.textContent?.trim()).toBe('Needs repair');

    // ok explicitly, and absent (an older backend's payload) — quiet both ways.
    for (const partial of [{ status: 'ok' as const }, {}]) {
      const quiet = await mount(partial);
      expect(q(quiet, '[data-testid="row-status"]')).toBe(null);
    }
  });

  it('says the flagged status on the phone line, keeping the amber tone', async () => {
    const el = await mount({ status: 'needs_repair' }, { mobile: true });
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(q(el, '[data-testid="row-status"]')?.textContent?.trim()).toBe('Needs repair');
    expect(secondary?.classList.contains('inspect')).toBe(true);
  });

  it('lets the flagged status outrank the inspection chore, but not the checkout', async () => {
    const flaggedAndDue = await mount(
      { status: 'missing', inspection_date: '2020-05-06' },
      { mobile: true },
    );
    const secondary = q(flaggedAndDue, '[data-testid="row-secondary"]');
    expect(secondary?.textContent).toContain('Missing');
    expect(secondary?.textContent).not.toContain('Inspection due');

    const out = await mount({ status: 'missing', checked_out: true }, { mobile: true });
    expect(q(out, '[data-testid="row-secondary"]')?.textContent).toContain('Checked out');
    expect(q(out, '[data-testid="row-status"]')).toBe(null);
  });
});

describe('hv-list-row: interaction', () => {
  it('emits stepper events with the item id', async () => {
    const el = await mount({ id: 'item-1', quantity: 5 });
    let detail: { itemId?: string } = {};
    el.addEventListener('increment', (e) => {
      detail = (e as CustomEvent).detail;
    });
    (q(el, '[data-testid="row-increment"]') as HTMLButtonElement).click();
    expect(detail.itemId).toBe('item-1');
  });

  it('does not open the row when the stepper is used', async () => {
    const el = await mount({ id: 'item-1' });
    const seen = captured(el, ['open-item']);
    (q(el, '[data-testid="row-increment"]') as HTMLButtonElement).click();
    expect(seen).toEqual([]);
  });

  it('keeps the keyboard shortcuts the POC row had', async () => {
    const el = await mount({ id: 'item-1' });
    const seen = captured(el, ['open-item', 'request-delete', 'increment', 'decrement']);
    const row = q(el, '[data-testid="list-row"]') as HTMLElement;

    for (const key of ['Enter', 'Delete', '+', '-']) {
      row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(seen).toEqual(['open-item', 'request-delete', 'increment', 'decrement']);
  });

  it('offers edit and row-menu actions, hidden on touch by the mobile attribute', async () => {
    const desktop = await mount({ id: '1' });
    expect(q(desktop, '[data-testid="row-edit"]')).toBeTruthy();
    expect(q(desktop, '[data-testid="row-menu"]')).toBeTruthy();

    // jsdom does not evaluate shadow-DOM CSS, so assert the hook the stylesheet
    // keys off (`:host([mobile]) .hover-actions { display: none }`) rather than
    // a computed style it cannot produce.
    const mobile = await mount({ id: '1' }, { mobile: true });
    expect(mobile.hasAttribute('mobile')).toBe(true);
    expect(mobile.shadowRoot?.querySelector('.hover-actions')).toBeTruthy();
  });

  it('opens the item when the row is tapped', async () => {
    const el = await mount({ id: 'item-1' }, { mobile: true });
    const seen = captured(el, ['open-item']);
    (q(el, '[data-testid="list-row"]') as HTMLElement).click();
    expect(seen).toEqual(['open-item']);
  });
});

describe('hv-list-row: area', () => {
  const AREAS = [{ id: 'area-kitchen', name: 'Kitchen' }];
  const pantry = { id_path: [], name_path: [], display_path: 'Fridge / Pantry', sort_key: '' };

  it('marks which room the item is in, beside the path', async () => {
    const el = await mount(
      { effective_area_id: 'area-kitchen', category: 'Consumables', location_path: pantry },
      { areas: AREAS },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(secondary?.textContent).toContain('Fridge › Pantry · Consumables');
    expect(secondary?.getAttribute('title')).toBe('Area: Kitchen · Fridge › Pantry · Consumables');
  });

  it('shows an area the cache has no name for rather than dropping it', async () => {
    const el = await mount({ effective_area_id: 'area-gone', location_path: pantry }, { areas: AREAS });
    expect(q(el, '[data-testid="row-secondary"]')?.querySelector('.hv-area-chip')?.textContent).toContain(
      'area-gone',
    );
  });

  it('reads exactly as before for an item in no area', async () => {
    const el = await mount({ category: 'Consumables', location_path: pantry }, { areas: AREAS });
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.querySelector('.hv-area-chip')).toBe(null);
    expect(secondary?.textContent?.trim()).toBe('Fridge › Pantry · Consumables');
    expect(secondary?.getAttribute('title')).toBe('Fridge › Pantry · Consumables');
  });

  it('reads exactly as before for a host that passes no areas at all', async () => {
    const el = await mount({ effective_area_id: 'area-kitchen', location_path: pantry });
    // The id is all there is to show without the cache, but the row still works.
    expect(q(el, '[data-testid="row-secondary"]')?.textContent).toContain('Fridge › Pantry');
  });
});

describe('hv-list-row: mobile affordances', () => {
  const deepPath = {
    id_path: [],
    name_path: [],
    display_path: 'Workshop / Parts Cabinet / Drawer A / Small Bin',
    sort_key: '',
  };

  it('elides a deep path so the phone row still names the bin', async () => {
    const el = await mount({ category: null, location_path: deepPath }, { mobile: true });
    expect(q(el, '[data-testid="row-secondary"]')?.textContent).toContain('Workshop › … › Small Bin');
  });

  it('leaves the full path on the desktop row, which has the room', async () => {
    const el = await mount({ category: null, location_path: deepPath });
    expect(q(el, '[data-testid="row-secondary"]')?.textContent).toContain(
      'Workshop › Parts Cabinet › Drawer A › Small Bin',
    );
  });

  it('spends the phone row on the room, and marks it as a room', async () => {
    // The area travels through the elision as the leading segment — the half
    // elidePath keeps — and comes back out of it as the pill the wide row hangs
    // beside a path. As plain text it was only a space away from the path.
    const el = await mount(
      { category: null, effective_area_id: 'area-workshop', location_path: deepPath },
      { mobile: true, areas: [{ id: 'area-workshop', name: 'Garage' }] },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    const mark = secondary?.querySelector('[data-testid="area-chip"]');
    expect(mark?.classList.contains('hv-area-chip')).toBe(true);
    expect(mark?.textContent).toContain('Garage');
    expect(mark?.querySelector('svg')).toBeTruthy();
    expect(secondary?.textContent).toContain('… › Small Bin');
    // The pill is the separator now.
    expect(secondary?.textContent).not.toContain('Garage › ');
  });

  // An area "Küche" over a root location "Küche" — the way a household names
  // both — printed "Küche Küche", two identical words a single space apart.
  it('drops the area mark when the path already opens with that name', async () => {
    const kitchen = {
      id_path: [],
      name_path: [],
      display_path: 'Küche / Oberstes Fach',
      sort_key: '',
    };
    for (const mobile of [false, true]) {
      const el = await mount(
        { category: null, effective_area_id: 'area-kitchen', location_path: kitchen },
        { mobile, areas: [{ id: 'area-kitchen', name: 'Küche' }] },
      );
      const secondary = q(el, '[data-testid="row-secondary"]');
      const where = `mobile=${mobile}`;

      expect(secondary?.querySelector('[data-testid="area-chip"]'), where).toBe(null);
      expect(secondary?.textContent?.replace(/\s+/g, ' ').trim(), where).toBe(
        'Küche › Oberstes Fach',
      );
      // The pairing is still readable in full where the row keeps it.
      expect(secondary?.getAttribute('title'), where).toBe('Area: Küche · Küche › Oberstes Fach');
      el.remove();
    }
  });

  it('renders no mark at all on a phone row with no area', async () => {
    const el = await mount({ category: null, location_path: deepPath }, { mobile: true });
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.querySelector('[data-testid="area-chip"]')).toBe(null);
    expect(secondary?.textContent?.trim()).toBe('Workshop › … › Small Bin');
  });

  it('puts the mark after the status a flagged phone row leads with', async () => {
    const el = await mount(
      {
        category: null,
        status: 'needs_repair',
        effective_area_id: 'area-workshop',
        location_path: deepPath,
      },
      { mobile: true, areas: [{ id: 'area-workshop', name: 'Garage' }] },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.textContent).toContain('Needs repair');
    expect(secondary?.querySelector('[data-testid="area-chip"]')?.textContent).toContain('Garage');
    expect(secondary?.textContent).toContain('… › Small Bin');
  });

  it('still says "No location" when there is neither a path nor a category', async () => {
    const el = await mount({ category: null, location_path: undefined }, { mobile: true });
    expect(q(el, '[data-testid="row-secondary"]')?.textContent?.trim()).toBe('No location');
  });

  // The mark is decorative, so the word has to be there for a reader who cannot
  // see it — and the row's own title already spells the area out, which is the
  // one place it must not be doubled.
  it('names the area for a screen reader without repeating it in the title', async () => {
    const el = await mount(
      { category: null, effective_area_id: 'area-workshop', location_path: deepPath },
      { mobile: true, areas: [{ id: 'area-workshop', name: 'Garage' }] },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.querySelector('[data-testid="area-chip"] .hv-sr-only')?.textContent).toBe(
      'Area: ',
    );
    expect(secondary?.getAttribute('title')).toBe(
      'Area: Garage · Workshop › Parts Cabinet › Drawer A › Small Bin',
    );
  });

  // Being out used to take the line rather than lead it, so the one row you most
  // want the shelf of — the borrowed one — was the row that stopped naming it.
  it('leads a checked-out phone row with the checkout and keeps the location behind it', async () => {
    const el = await mount(
      { checked_out: true, due_date: '2099-07-31', effective_area_id: 'area-workshop', location_path: deepPath },
      { mobile: true, areas: [{ id: 'area-workshop', name: 'Garage' }] },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    const text = secondary?.textContent?.replace(/\s+/g, ' ') ?? '';

    expect(text).toContain('Checked out · due');
    expect(secondary?.querySelector('[data-testid="area-chip"]')?.textContent).toContain('Garage');
    expect(text).toContain('… › Small Bin');
    expect(text.indexOf('Checked out')).toBeLessThan(text.indexOf('Small Bin'));
  });

  // Both lines clip with an ellipsis, and the phone row drops the middle of the
  // path on purpose — so the whole value has to be readable somewhere.
  it('carries the unelided path and the full name in tooltips', async () => {
    const el = await mount({ name: 'Torque Wrench M4 #23', category: 'Tools', location_path: deepPath }, { mobile: true });
    expect(q(el, '[data-testid="row-name"]')?.getAttribute('title')).toBe('Torque Wrench M4 #23');
    expect(q(el, '[data-testid="row-secondary"]')?.getAttribute('title')).toBe(
      'Workshop › Parts Cabinet › Drawer A › Small Bin · Tools',
    );
  });

  it('marks low stock with a dot instead of a badge', async () => {
    const el = await mount({ quantity: 1, low_stock_threshold: 5 }, { mobile: true });
    expect(q(el, '[data-testid="row-low-dot"]')).toBeTruthy();
    expect(q(el, '[data-testid="row-low"]')).toBe(null);
  });

  // Pinned clock: the due date has to stay in the future *and* in the current
  // year for the label to read "due Jul 28" — a literal date drifts into
  // "Overdue" and into the with-year format as the real calendar moves.
  it('replaces the stepper with Check in for a checked-out row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 20));
    try {
      const el = await mount({ checked_out: true, due_date: '2026-07-28' }, { mobile: true });
      expect(q(el, '[data-testid="row-stepper"]')).toBe(null);
      const btn = q(el, '[data-testid="row-check-in"]');
      expect(btn?.textContent).toContain('Check in');
      expect(el.shadowRoot?.textContent).toContain('Checked out · due Jul 28');
    } finally {
      vi.useRealTimers();
    }
  });

  // A passed date used to render exactly like an upcoming one — same wording,
  // same blue — so the row said nothing about being late.
  it('says a passed due date is overdue, and colours it that way', async () => {
    const el = await mount({ checked_out: true, due_date: '2000-01-02' }, { mobile: true });
    const secondary = q(el, '[data-testid="row-secondary"]');

    expect(secondary?.textContent).toContain('Overdue · due Jan 2, 2000');
    expect(secondary?.classList.contains('overdue')).toBe(true);
  });

  it('leaves an upcoming due date alone', async () => {
    const el = await mount({ checked_out: true, due_date: '2999-12-31' }, { mobile: true });
    const secondary = q(el, '[data-testid="row-secondary"]');

    expect(secondary?.textContent).toContain('Checked out · due Dec 31, 2999');
    expect(secondary?.classList.contains('overdue')).toBe(false);
  });
});

describe('hv-list-row: selection mode', () => {
  it('swaps row navigation for a checkbox', async () => {
    const el = await mount({ id: 'item-1' }, { selectable: true });
    const seen = captured(el, ['open-item', 'toggle-select']);

    expect(q(el, '[data-testid="row-select"]')).toBeTruthy();
    expect(q(el, '[data-testid="row-edit"]')).toBe(null);

    (q(el, '[data-testid="list-row"]') as HTMLElement).click();
    expect(seen).toEqual(['toggle-select']);
  });

  it('reflects the selected state on the checkbox', async () => {
    const el = await mount({ id: 'item-1' }, { selectable: true, selected: true });
    expect(q(el, '[data-testid="row-select"]')?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('hv-list-row thumbnail', () => {
  it('shows the first picture with alt text naming the item', async () => {
    const media = makeMediaBindings();
    const el = await mount(
      { id: 'i-thumb', name: 'Cordless drill', attachments: [makeAttachment({ id: 'att-1' })] },
      { media },
    );
    // One more frame: the signed URL arrives from a resolved promise.
    await el.updateComplete;
    await el.updateComplete;

    const img = q(el, '[data-testid="row-thumb"]') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe(
      `/api/haventory/media/i-thumb/att-1?${MEDIA_NAME_TOKEN_PARAM}=`
        + `${attachmentNameToken(makeAttachment({ id: 'att-1' }))}&authSig=test`,
    );
    expect(img?.getAttribute('alt')).toBe('Photo of Cordless drill');
    // Nothing is thumbnailed server-side, so the browser must be told not to
    // fetch and decode every row's full-size photo at once.
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
  });

  // A placeholder here would add a column of empty squares to a mostly
  // photo-less inventory.
  it('renders no image element at all for a row without a picture', async () => {
    const el = await mount({ name: 'Screws' }, { media: makeMediaBindings() });
    await el.updateComplete;

    expect(q(el, '[data-testid="row-thumb"]')).toBeNull();
    expect(el.shadowRoot?.querySelector('img')).toBeNull();
  });

  it('shows nothing rather than a broken image when signing fails', async () => {
    const el = await mount(
      { attachments: [makeAttachment()] },
      { media: makeMediaBindings({ signFails: true }) },
    );
    await el.updateComplete;
    await el.updateComplete;

    expect(q(el, '[data-testid="row-thumb"]')).toBeNull();
  });

  it('ignores a non-picture attachment', async () => {
    const el = await mount(
      { attachments: [makeAttachment({ kind: 'manual', mime: 'application/pdf' })] },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    await el.updateComplete;

    expect(q(el, '[data-testid="row-thumb"]')).toBeNull();
  });
});

describe('hv-list-row: document marker', () => {
  it('marks a row whose item holds a manual', async () => {
    const el = await mount({ attachments: [makeManual({ id: 'm-1' })] });
    await el.updateComplete;

    const mark = q(el, '[data-testid="row-has-document"]');
    expect(mark).toBeTruthy();
    // Glyph-only, so it needs a name of its own to reach a screen reader.
    expect(mark?.getAttribute('aria-label')).toBe('Has a document');
  });

  it('marks nothing for an item with only pictures', async () => {
    const el = await mount({ attachments: [makeAttachment({ id: 'p-1' })] });
    await el.updateComplete;

    expect(q(el, '[data-testid="row-has-document"]')).toBeNull();
  });

  // A marker that only appeared on desktop would make the phone list, which is
  // where an item is most often looked up, silent about its documents.
  it('marks a mobile row too', async () => {
    const el = await mount({ attachments: [makeManual({ id: 'm-1' })] }, { mobile: true });
    await el.updateComplete;

    expect(q(el, '[data-testid="row-has-document"]')).toBeTruthy();
  });

  // Left on the row it was anchored to the free space: against the name on a
  // row with a thumbnail, and out at the quantity stepper on one without.
  it('sits on the line the name owns, whatever else the row carries', async () => {
    const el = await mount({ attachments: [makeManual({ id: 'm-1' })] });
    await el.updateComplete;

    const mark = q(el, '[data-testid="row-has-document"]');
    const line = mark?.parentElement;
    expect(line?.classList.contains('name-line')).toBe(true);
    expect(line?.querySelector('[data-testid="row-name"]')).toBeTruthy();
    // Immediately after the name, so it reads as belonging to it.
    expect(mark?.previousElementSibling?.getAttribute('data-testid')).toBe('row-name');
  });

});

import './hv-list-row';
import { makeAttachment, makeItem, makeManual, makeMediaBindings } from '../test.utils';
import { elidePath, isLowStock } from './hv-list-row';
import { toIsoDate } from '../ui/relative-time';
import type { HVListRow } from './hv-list-row';
import type { Item } from '../store/types';

async function mount(item: Partial<Item>, props: Partial<HVListRow> = {}) {
  const el = document.createElement('hv-list-row') as HVListRow;
  el.item = makeItem(item);
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVListRow, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;

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

  it('marks a checked-out item and disables its stepper', async () => {
    const el = await mount({ checked_out: true });
    expect(q(el, '[data-testid="row-checked-out"]')?.textContent).toContain('Checked out');
    expect((q(el, '[data-testid="row-increment"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(el, '[data-testid="row-decrement"]') as HTMLButtonElement).disabled).toBe(true);
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

  // Today's inspection has not been missed — same strictly-before boundary the
  // backend count and filter use, so the row and the pill cannot disagree.
  it('does not badge an inspection due today', async () => {
    for (const mobile of [false, true]) {
      const el = await mount({ inspection_date: toIsoDate() }, { mobile });
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

  it('spends the phone row on the room, which the elision keeps', async () => {
    // No chip fits this line, so the area goes in as the leading segment — the
    // half elidePath keeps.
    const el = await mount(
      { category: null, effective_area_id: 'area-workshop', location_path: deepPath },
      { mobile: true, areas: [{ id: 'area-workshop', name: 'Garage' }] },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.textContent).toContain('Garage › … › Small Bin');
    expect(secondary?.querySelector('.hv-area-chip')).toBe(null);
  });

  it('leaves a checked-out phone row saying what it always said', async () => {
    const el = await mount(
      { checked_out: true, due_date: '2099-07-31', effective_area_id: 'area-workshop', location_path: deepPath },
      { mobile: true, areas: [{ id: 'area-workshop', name: 'Garage' }] },
    );
    const secondary = q(el, '[data-testid="row-secondary"]');
    expect(secondary?.textContent).toContain('Checked out');
    expect(secondary?.textContent).not.toContain('Garage');
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

describe('hv-list-row: truncation', () => {
  // jsdom does not lay shadow DOM out, so the stylesheet itself is the only
  // thing here worth asserting on — and the bug was entirely in the stylesheet.
  const styleText = () => {
    const styles = (customElements.get('hv-list-row') as typeof HVListRow).styles;
    return (Array.isArray(styles) ? styles : [styles]).map((s) => String(s.cssText)).join('\n');
  };
  const rule = (selector: string) => {
    const css = styleText();
    const start = css.indexOf(`${selector} {`);
    expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start)).replace(/\s+/g, ' ');
  };

  // `overflow`/`text-overflow` are ignored on an inline box, and `text-overflow`
  // is ignored on a flex container. Both lines asked for an ellipsis from a box
  // that could never draw one, so a long path hard-cut mid-character instead.
  it('gives the name line a box an ellipsis can apply to', () => {
    const css = rule('.name');
    expect(css).toMatch(/display: block/);
    expect(css).toMatch(/text-overflow: ellipsis/);
    expect(css).not.toMatch(/display: flex/);
  });

  it('gives the location line a box an ellipsis can apply to', () => {
    const css = rule('.secondary');
    expect(css).toMatch(/display: block/);
    expect(css).toMatch(/text-overflow: ellipsis/);
    expect(css).not.toMatch(/display: flex/);
  });

  it('keeps the low-stock dot on the same line once that line is a block', () => {
    // It used to be a flex item; as a block child it would have stacked above
    // the text and pushed every row 6px taller.
    expect(rule('.dot')).toMatch(/display: inline-block/);
  });

  // 34x34, fifteen to a screen, with − directly beside + — the control most
  // likely to be mis-tapped and the one where a mis-tap moves stock.
  it('sizes the stepper from the inherited touch target on a phone', () => {
    expect(rule(':host([mobile]) .stepper button')).toMatch(/width: var\(--hv-tap-min, 34px\)/);
  });

  it('expands the selection checkbox hit area without resizing the box', () => {
    // The row toggles the same selection, so the grown area can only agree
    // with what is underneath it.
    expect(rule(':host([mobile]) .box::after')).toMatch(
      /inset: calc\(\(var\(--hv-tap-min, 16px\) - 16px\) \/ -2\)/,
    );
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
    expect(img?.getAttribute('src')).toBe('/api/haventory/media/i-thumb/att-1?authSig=test');
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

  // A flex item takes an automatic minimum width from its content, so the name
  // stops eliding the moment it shares a line with the mark unless it gives
  // that minimum up.
  it('leaves the name able to shrink on that line', () => {
    const styles = (customElements.get('hv-list-row') as typeof HVListRow).styles;
    const css = (Array.isArray(styles) ? styles : [styles])
      .map((s) => String(s.cssText))
      .join('\n')
      .replace(/\s+/g, ' ');
    expect(css).toMatch(/\.name-line \{[^}]*display: flex/);
    expect(css).toMatch(/\.name \{[^}]*min-width: 0[^}]*text-overflow: ellipsis/);
  });
});
